import type {CardTarget} from './agent-card-editor';
type Preview={name:string;index:number;panes:number;expected:string;affected_sessions:{name:string;last_window:boolean}[]};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
export class AgentCloser {
 private dialog=el('dialog');private description=el('p');private feedback=el('p');private cancel=el('button','Cancel');private confirm=el('button','Close agent and window');private check=el('button','Check agents');private target?:CardTarget;private preview?:Preview;private epoch=0;private busy=false;
 constructor(private changed:()=>Promise<void>){
  this.dialog.className='agent-close-dialog';this.dialog.setAttribute('aria-label','Close agent');this.description.id='agent-close-description';this.dialog.setAttribute('aria-describedby',this.description.id);this.feedback.setAttribute('role','status');this.confirm.className='danger';
  for(const b of [this.cancel,this.confirm,this.check])b.type='button';
  const actions=el('div');actions.className='agent-card-actions';actions.append(this.cancel,this.confirm,this.check);this.dialog.append(el('h2','Close agent and tmux window?'),this.description,this.feedback,actions);document.body.append(this.dialog);
  this.cancel.onclick=()=>{this.epoch++;this.dialog.close();};this.confirm.onclick=()=>void this.close();this.check.onclick=async()=>{this.dialog.close();await this.changed();};
  this.dialog.addEventListener('cancel',e=>{if(this.busy)e.preventDefault();else this.epoch++;});
 }
 private fields(target:CardTarget){return{connection_revision:target.connection_revision,session:target.session,window:target.window,agent_pane:target.pane,agent_instance:target.instance};}
 async open(target:CardTarget){
  if(this.busy)return;this.target={...target};this.preview=undefined;const epoch=++this.epoch;this.description.textContent=target.label;this.feedback.textContent='Checking the agent and affected window…';this.confirm.disabled=true;this.cancel.disabled=false;this.check.hidden=true;if(!this.dialog.open)this.dialog.showModal();this.cancel.focus();
  try{const response=await fetch(`/api/v1/hosts/${encodeURIComponent(target.host)}/windows/close?${new URLSearchParams(this.fields(target))}`,{cache:'no-store',signal:AbortSignal.timeout(25000)});const value=await response.json();if(!response.ok)throw Error(value.error||'Could not inspect agent');if(epoch!==this.epoch||!this.dialog.open)return;
   this.preview=value;const p=value as Preview;const ending=p.affected_sessions.filter(s=>s.last_window).map(s=>s.name);
   this.description.textContent=`${target.label} · Window ${p.index}: ${p.name} · ${p.panes} pane${p.panes===1?'':'s'}. This terminates the agent CLI and ALL other processes in this window, and removes its live agent cards. Unsaved work and unsent drafts may be lost.${p.affected_sessions.length>1?' Linked sessions: '+p.affected_sessions.map(s=>s.name).join(', ')+'.':''}${ending.length?' This is the last window in '+ending.join(', ')+', so those sessions will also close.':''} Stored tickets and message receipts remain in CC.`;
   this.feedback.textContent='';this.confirm.disabled=false;this.cancel.focus();
  }catch(error){if(epoch===this.epoch)this.feedback.textContent=String(error);}
 }
 private async close(){const target=this.target,preview=this.preview;if(!target||!preview||this.busy)return;this.busy=true;this.confirm.disabled=this.cancel.disabled=true;this.feedback.textContent='Closing agent window…';
  try{const response=await fetch(`/api/v1/hosts/${encodeURIComponent(target.host)}/windows/close`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...this.fields(target),expected:preview.expected}),signal:AbortSignal.timeout(25000)});const value=await response.json();if(!response.ok)throw Error(value.error||'Close failed');this.dialog.close();await this.changed();}
  catch(error){this.feedback.textContent=`${String(error)} Check agents before taking another action. This close will not be retried.`;this.check.hidden=false;}
  finally{this.busy=false;this.cancel.disabled=false;this.preview=undefined;}
 }
}
