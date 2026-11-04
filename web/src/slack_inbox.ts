export type InboxItem={id:string;kind:'channel'|'dm'|'thread';channel:string;name:string;thread_ts:string|null;read:string;latest:string;pinned:boolean;incomplete:boolean};
export type InboxSnapshot={revision:string;connection_revision:string;version:number;counts:{all:number;channels:number;dms:number;threads:number};items:InboxItem[]};
type Filter='all'|'channels'|'dms'|'threads';
type Thread={channel:string;ts:string;followed:boolean};
type Dependencies={snapshot:(filter:Filter)=>Promise<InboxSnapshot>;catalog:(op:'channels'|'dms',cursor:string|undefined,refresh:boolean)=>Promise<{next_cursor?:string;limited?:boolean}>;ensure:(active:()=>boolean)=>Promise<void>;threads:()=>Thread[];check:(thread:Thread)=>Promise<unknown>;open:(item:InboxItem,snapshot:InboxSnapshot)=>Promise<void>;mark:(item:InboxItem,snapshot:InboxSnapshot)=>Promise<void>};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
export class SlackInbox {
 readonly root=el('section');private list=el('div');private filter=el('select');private feedback=el('p');private summary=el('p');private refresh=el('button','Refresh Inbox');private stopButton=el('button','Stop Inbox refresh');private data?:InboxSnapshot;
 private showing=0;private visible=false;private run=0;private request=0;private refreshing=false;private timer?:ReturnType<typeof setTimeout>;
 constructor(private deps:Dependencies){
  this.root.className='slack-inbox';this.root.hidden=true;this.root.setAttribute('aria-label','Slack Inbox');const heading=el('div');heading.className='slack-pane-heading';heading.append(el('h2','Inbox'),this.refresh,this.stopButton);this.stopButton.hidden=true;this.refresh.onclick=()=>{void this.refreshAll();};this.stopButton.onclick=()=>this.stop();this.filter.setAttribute('aria-label','Filter inbox');
  for(const [value,label] of [['all','All types'],['channels','Channels'],['dms','DMs'],['threads','Threads']]){const option=el('option',label);option.value=value;this.filter.append(option);}this.filter.onchange=()=>{void this.load();};this.feedback.setAttribute('role','status');this.list.className='slack-inbox-list';this.root.append(heading,el('p','Observed unread activity in CC. Reading here does not change Slack’s read state.'),this.filter,this.summary,this.feedback,this.list);
 }
 async show(){const showing=++this.showing;this.visible=true;this.root.hidden=false;await this.load();if(!this.visible||showing!==this.showing)return;try{await this.deps.ensure(()=>this.visible&&showing===this.showing);if(this.visible&&showing===this.showing)await this.load();}catch(error){if(this.visible&&showing===this.showing)this.feedback.textContent=`Some conversation details are unavailable: ${String(error)}`;}}
 hide(){++this.showing;this.stop();this.visible=false;this.root.hidden=true;++this.request;clearTimeout(this.timer);}
 clear(){this.hide();this.data=undefined;this.list.replaceChildren();this.summary.textContent='';this.feedback.textContent='';this.filter.value='all';}
 update(){if(!this.visible)return;clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.load();},150);}
 stop(){++this.showing;++this.run;if(this.refreshing)this.feedback.textContent='Refresh stopped. An in-flight check may finish.';this.refreshing=false;this.refresh.disabled=false;this.stopButton.hidden=true;}
 async refreshAll(){
  if(!this.visible||this.refreshing)return;const run=++this.run;this.refreshing=true;this.refresh.disabled=true;this.stopButton.hidden=false;let checks=0,partial=false;
  const active=()=>this.visible&&this.run===run;
  try{
   for(const op of ['channels','dms'] as const){let cursor:string|undefined;for(let page=1;page<=10;page++){if(!active())return;this.feedback.textContent=`Checking ${op==='dms'?'DMs':'channels'} · page ${page}…`;const data=await this.deps.catalog(op,cursor,true);if(!active())return;checks++;partial ||= !!data.limited;cursor=data.next_cursor||undefined;if(!cursor)break;if(page===10)partial=true;}}
   const threads=this.deps.threads().filter(t=>t.followed).slice(0,50);for(const [index,thread] of threads.entries()){if(!active())return;this.feedback.textContent=`Checking followed thread ${index+1} of ${threads.length}…`;await this.deps.check(thread);if(!active())return;checks++;}
   this.feedback.textContent=`Refresh finished · ${checks} checks${partial?' · Some directory entries remain unchecked.':''}`;
  }catch(error){if(active())this.feedback.textContent=`Refresh incomplete: ${String(error)}`;}
  finally{if(active()){this.refreshing=false;this.refresh.disabled=false;this.stopButton.hidden=true;await this.load();}}
 }
 private async load(){const request=++this.request;try{const data=await this.deps.snapshot(this.filter.value as Filter);if(!this.visible||request!==this.request)return;this.data=data;this.render();}catch(error){if(this.visible&&request===this.request)this.feedback.textContent=`Inbox unavailable: ${String(error)}`;}}
 private render(){
  const data=this.data;if(!data)return;this.summary.textContent=`${data.items.length} shown · ${data.counts.all} observed unread items`;this.list.replaceChildren(...data.items.map(item=>{
   const card=el('article');card.className='slack-inbox-card';const destination=item.channel.startsWith('D')?`DM with ${item.name}`:`#${item.name}`;const title=item.kind==='thread'?`Thread in ${destination}`:destination;const open=el('button',title);const identity=item.kind==='thread'?`thread ${item.thread_ts} in ${destination}`:title;open.setAttribute('aria-label',`Open ${identity}`);open.onclick=()=>{void this.deps.open(item,data).catch(error=>{if(this.visible)this.feedback.textContent=String(error);});};const kind=el('span',item.kind==='channel'?'Channel':item.kind==='dm'?'DM':'Thread');kind.className='slack-inbox-kind';const details=el('p',`${item.thread_ts?`Started ${new Date(Number(item.thread_ts)*1000).toLocaleString()} · `:''}Latest observed ${new Date(Number(item.latest)*1000).toLocaleString()}${item.incomplete?' · More replies may need checking.':''}`);const mark=el('button','Mark read in CC');mark.setAttribute('aria-label',`Mark ${identity} read in CC`);mark.onclick=async()=>{mark.disabled=true;try{await this.deps.mark(item,data);if(this.visible)await this.load();}catch(error){if(this.visible)this.feedback.textContent=`Could not mark read: ${String(error)}`;}finally{mark.disabled=false;}};card.append(kind,open,details,mark);return card;
  }));if(!data.items.length)this.list.append(el('p',this.filter.value==='all'?'No observed unread items. Refresh Inbox to check recent activity.':'No observed unread items match this filter.'));
 }
}
