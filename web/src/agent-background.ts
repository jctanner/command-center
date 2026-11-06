export type BackgroundTask={id:string;title:string;state:'running'|'waiting'|'unverified'|'completed'|'failed'|'cancelled';started_at?:number|null;updated_at:number;finished_at?:number;summary:string};
export type BackgroundSnapshot={source:string;conversation:string;observed_at:number;tasks:BackgroundTask[];limited:boolean;unavailable:boolean};
const terminal=(t:BackgroundTask)=>['completed','failed','cancelled'].includes(t.state);
const labels:Record<BackgroundTask['state'],string>={running:'In background',waiting:'Waiting on child tasks',unverified:'Completion unverified',completed:'Finished',failed:'Failed',cancelled:'Cancelled'};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
const age=(seconds:number)=>seconds<60?`${Math.max(0,Math.floor(seconds))}s`:seconds<3600?`${Math.floor(seconds/60)}m`:`${Math.floor(seconds/3600)}h ${Math.floor(seconds%3600/60)}m`;
function tasks(snapshot:BackgroundSnapshot,unavailable=false){const stale=unavailable||snapshot.unavailable||Date.now()/1000-snapshot.observed_at>45;return snapshot.tasks.slice(0,8).map(t=>stale&&!terminal(t)?{...t,state:'unverified' as const}:t);}
export function backgroundLabel(snapshot?:BackgroundSnapshot|null,unavailable=false){
 if(!snapshot)return '';const entries=tasks(snapshot,unavailable),active=entries.filter(t=>!terminal(t)),unknown=active.some(t=>t.state==='unverified');
 if(active.length)return `${active.length} background${unknown?' · unverified':''}`;
 const recent=entries.find(t=>Date.now()/1000-t.updated_at<300);
 return recent?`Background ${recent.state==='failed'?'failed':recent.state==='cancelled'?'cancelled':'finished'}`:snapshot.unavailable?'Background unverified':'';
}
export class BackgroundTasks {
 readonly element=el('details');private heading=el('summary');private list=el('div');private note=el('small');private signature='';
 constructor(){this.element.className='agent-background-tasks';this.element.setAttribute('aria-label','Background tasks');this.element.hidden=true;this.list.className='agent-background-list';this.list.tabIndex=0;this.element.append(this.heading,this.list,this.note);}
 update(snapshot?:BackgroundSnapshot|null,unavailable=false){
  this.element.hidden=!snapshot||(!snapshot.tasks.length&&!snapshot.unavailable);if(!snapshot)return;
  const entries=tasks(snapshot,unavailable);const signature=JSON.stringify([snapshot.conversation,entries,snapshot.limited,snapshot.unavailable,unavailable,Math.floor(Date.now()/60000)]);if(signature===this.signature)return;this.signature=signature;
  const active=entries.filter(t=>!terminal(t));const heading=active.length?`${active.length} background task${active.length===1?'':'s'}${active.some(t=>t.state==='unverified')?' · completion unverified':''}`:`Background tasks · ${entries.some(t=>t.state==='failed')?'failed':'finished'}`;
  this.heading.replaceChildren(el('strong',snapshot.unavailable?'Background status unavailable':heading));
  const latest=active[0]||entries[0];if(latest){const title=el('span',latest.title);title.title=latest.title;this.heading.append(title);}
  this.list.replaceChildren(...entries.map(task=>{
   const row=el('article');row.dataset.taskId=task.id;row.dataset.state=task.state;row.append(el('strong',task.title),el('span',labels[task.state]));
   const now=Date.now()/1000,start=task.started_at,end=task.finished_at;
   const elapsed=typeof start==='number'&&Number.isFinite(start)?`${age(Math.max(0,(end||now)-start))} ${end?'duration':'since start'} · `:'';
   row.append(el('small',`${elapsed}updated ${age(Math.max(0,now-task.updated_at))} ago`));if(task.summary)row.append(el('p',task.summary));return row;
  }));
  this.note.textContent=snapshot.unavailable||unavailable?'Task observations unavailable. Completion is not assumed.':snapshot.limited?'Recent process-linked task evidence only; older tasks may be outside the history window.':'From process-linked provider task records. Foreground Ready does not mean background work has finished.';
 }
}
