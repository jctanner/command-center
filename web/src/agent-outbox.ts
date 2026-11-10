export class OutboxSendError extends Error {constructor(message:string,public uncertain:boolean){super(message);}}
export type OutboxEntry = {
 id:string;host:string;session:string;window:string;pane:string;instance:string;conversation?:string;
 text:string;status:string;note:string;revision:number;created_at:number;updated_at:number;seen_message?:number;command_message?:number;local?:boolean;
};
export type OutboxTarget = {host:string;session:string;window:string;pane:string;instance:string;conversation?:string};
const labels:Record<string,string>={queued:'Queued in CC',submitting:'Submitting…',submitted:'Submitted to terminal',seen:'Seen in conversation',command:'Interpreted as CLI command',uncertain:'Delivery uncertain',blocked:'Blocked · review needed',cancelled:'Cancelled in CC',archived:'Archived'};
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
function messageId(){
 const source=globalThis.crypto;
 if(typeof source?.randomUUID==='function')return source.randomUUID();
 if(typeof source?.getRandomValues!=='function')throw Error('Secure message ID generation is unavailable. Your draft was not sent.');
 const bytes=source.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('').replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5');
}
const key='cc-agent-outbox-pending-v1';
export class AgentOutbox {
 private server:OutboxEntry[]=[];
 private local:OutboxEntry[]=[];
 private running?:Promise<void>;
 private storageError='';
 private actionErrors=new Map<string,string>();
 private activeActions=new Set<string>();
 private notice=element('p');
 private dialog=element('dialog');
 private content=element('div');
 private bulkBusy=false;private bulkFeedback='';private cancelAll=element('button','Cancel all queued');private archiveAll=element('button','Archive all receipts');
 constructor(private changed:()=>void,private receipt:(entry:OutboxEntry)=>void=()=>{}){
  try{
   const raw=localStorage.getItem(key);if(raw&&raw.length>300000)throw Error('Pending message storage is too large');
   const parsed=raw?JSON.parse(raw):[];
   if(!Array.isArray(parsed)||parsed.length>50)throw Error('Invalid pending message storage');
   this.local=parsed.filter((e:OutboxEntry)=>e&&typeof e.id==='string'&&typeof e.text==='string'&&typeof e.host==='string'&&typeof e.instance==='string').map((e:OutboxEntry)=>({...e,local:true,status:e.status==='submitting'?'uncertain':e.status,note:e.status==='submitting'?'The page closed before a receipt arrived. Checking CC; no message will be resent.':e.note}));
  }catch{this.storageError='Pending message storage is unavailable. Sending is blocked so your message cannot disappear.';}
  this.dialog.className='agent-outbox-dialog';this.dialog.setAttribute('aria-label','Agent outbox');
  const close=element('button','Close outbox');close.onclick=()=>this.dialog.close();
  const refresh=element('button','Refresh outbox');refresh.onclick=()=>{void this.refresh();};
  this.cancelAll.type=this.archiveAll.type='button';this.cancelAll.onclick=()=>{void this.bulk('cancel');};this.archiveAll.onclick=()=>{void this.bulk('archive');};
  const bulk=element('div');bulk.className='outbox-bulk-actions';bulk.append(this.cancelAll,this.archiveAll);
  this.notice.setAttribute('role','status');this.content.className='agent-outbox-list';
  this.dialog.append(element('h2','Agent outbox'),element('p','Messages stay here until their delivery is resolved. Submitted input is never retried automatically.'),close,refresh,bulk,this.notice,this.content);
  document.body.append(this.dialog);
 }
 entries(){const ids=new Set(this.server.map(r=>r.id));return [...this.server,...this.local.filter(r=>!ids.has(r.id))].sort((a,b)=>a.created_at-b.created_at);}
 private persist(){
  if(this.storageError)throw Error(this.storageError);
  const raw=JSON.stringify(this.local);
  if(this.local.length>50||raw.length>200000)throw Error('Pending message storage is full. Review your outbox before sending more.');
  try{localStorage.setItem(key,raw);}catch{throw Error('Cannot save the pending message in this browser. Your draft was not sent.');}
 }
 private update(){this.renderDialog();this.changed();}
 private accept(entry:OutboxEntry){
  if(this.server.some(e=>e.id===entry.id&&e.revision>entry.revision))return;
  this.server=this.server.filter(e=>e.id!==entry.id);this.server.push(entry);
  this.local=this.local.filter(e=>e.id!==entry.id);
  try{this.persist();}catch{this.notice.textContent='CC saved the receipt, but this browser could not clean up its local copy. Refreshing will reconcile it without resending.';}
  this.receipt(entry);this.update();
 }
 async send(target:OutboxTarget,token:string,text:string){
  let id:string;try{id=messageId();}catch(error){throw new OutboxSendError(String(error),false);}
  const entry:OutboxEntry={...target,id,text,status:'submitting',note:'Saving this message in CC before delivery.',revision:0,created_at:Date.now(),updated_at:Date.now(),local:true};
  this.local.push(entry);
  try{this.persist();}catch(error){this.local=this.local.filter(r=>r.id!==entry.id);throw new OutboxSendError(String(error),false);}
  this.receipt(entry);this.update();
  try{
   const response=await fetch(`/api/v1/hosts/${encodeURIComponent(target.host)}/agents/message`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:entry.id,token,text}),signal:AbortSignal.timeout(25000)});
   const body=await response.json();
   if(!response.ok){entry.status=response.status>=500||response.status===410?'uncertain':'blocked';entry.note=body.error||'Message could not be queued.';throw Error(entry.note);}
   if(body.outbox){this.accept(body.outbox);return body.outbox as OutboxEntry;}
   // Compatibility with older servers: retain an honest local receipt rather
   // than claiming provider acceptance or replaying terminal input.
   entry.status='submitted';entry.note='Submitted to terminal; conversation acceptance is not confirmed.';this.persist();this.update();return entry;
  }catch(error){
   if(entry.status==='submitting'){entry.status='uncertain';entry.note='No durable response received. Checking CC; this message will not be resent.';}
   if(this.local.some(r=>r.id===entry.id)){try{this.persist();}catch{/* original draft is preserved by the composer */}}
   this.update();void this.refresh();throw new OutboxSendError(String(error),entry.status!=='blocked');
  }
 }
 refresh(){
  if(this.running)return this.running;
  this.running=(async()=>{
   try{
    const response=await fetch('/api/v1/agents/outbox',{cache:'no-store',signal:AbortSignal.timeout(10000)});const data=await response.json();
    if(!response.ok||!Array.isArray(data.entries))throw Error(data.error||'Could not read the agent outbox');
    this.server=data.entries.map((entry:OutboxEntry)=>{const old=this.server.find(e=>e.id===entry.id);return old&&old.revision>entry.revision?old:entry;});for(const entry of this.server)this.receipt(entry);
    const known=new Set(this.server.map(e=>e.id));this.local=this.local.filter(e=>!known.has(e.id));
    try{this.persist();}catch(error){this.notice.textContent=String(error);}
    if(!this.storageError)this.notice.textContent='';this.update();
   }catch(error){this.notice.textContent=`Outbox unavailable: ${String(error)}. Existing message receipts were kept.`;}
  })().finally(()=>{this.running=undefined;});return this.running;
 }
 open(){this.renderDialog();this.dialog.showModal();void this.refresh();}
 button(){const button=element('button','Outbox');button.type='button';button.className='queue-outbox-button';button.onclick=()=>this.open();return button;}
 ingest(entries:OutboxEntry[]){
  const known=new Map(this.server.map(e=>[e.id,e]));
  for(const entry of entries){const old=known.get(entry.id);if(!old||old.revision<=entry.revision){known.set(entry.id,entry);this.receipt(entry);}}
  this.server=[...known.values()];const ids=new Set(entries.map(e=>e.id));this.local=this.local.filter(e=>!ids.has(e.id));
  try{this.persist();}catch{this.notice.textContent='CC saved the receipts, but local cleanup failed. Refresh to reconcile; no input will be resent.';}
  this.update();
 }
 private matches(r:OutboxEntry,target:OutboxTarget){return r.host===target.host&&r.session===target.session&&r.window===target.window&&r.pane===target.pane&&r.instance===target.instance&&r.conversation===target.conversation;}
 private inlineScope='';
 private awaitingNative=new Set<string>();
 inline(target:OutboxTarget,renderedUserIds:ReadonlySet<string>){
  const scope=JSON.stringify(target);
  if(scope!==this.inlineScope){this.inlineScope=scope;this.awaitingNative.clear();}
  const entries=this.entries(),ids=new Set(entries.map(r=>r.id));
  for(const id of this.awaitingNative)if(!ids.has(id))this.awaitingNative.delete(id);
  return entries.filter(r=>{
   if(r.host!==target.host||r.session!==target.session||r.window!==target.window||r.pane!==target.pane||r.status==='archived'){this.awaitingNative.delete(r.id);return false;}
   if(r.status!=='seen'){
    if(this.matches(r,target)&&['queued','submitting','submitted','uncertain'].includes(r.status))this.awaitingNative.add(r.id);
    return true;
   }
   // A Seen receipt can arrive before the independently polled native page.
   // Bridge only bubbles this view already showed; never resurrect old receipts.
   if(!this.matches(r,target)||r.seen_message==null||renderedUserIds.has(String(r.seen_message))){this.awaitingNative.delete(r.id);return false;}
   return this.awaitingNative.has(r.id);
  }).map(r=>this.row(r,false,r.instance!==target.instance));
 }
 seen(target:OutboxTarget,messageId:string){return this.entries().some(r=>this.matches(r,target)&&r.status==='seen'&&String(r.seen_message)===messageId);}
 // Strip a provider paste envelope only when the original CC receipt proves
 // which text was submitted. Literal/ambiguous XML and native logs stay intact.
 visibleUserText(target:OutboxTarget,messageId:string,text:string,provider:string){
  if(provider!=='claude')return text;
  const wrapped=/^<pasted_content id="([0-9a-f]{4,64})">\n([\s\S]*)\n<\/pasted_content id="\1">$/.exec(text.replace(/\r\n/g,'\n').trim());
  if(!wrapped||wrapped[2].includes('<pasted_content')||wrapped[2].includes('</pasted_content'))return text;
  const normalized=(value:string)=>value.replace(/\r\n/g,'\n').trim();
  const receipt=this.entries().find(r=>this.matches(r,target)&&r.status==='seen'&&r.seen_message!=null&&String(r.seen_message)===messageId&&normalized(r.text)===normalized(wrapped[2]));
  return receipt?receipt.text:text;
 }
 private renderDialog(){
  const entries=this.entries().filter(e=>e.status!=='archived').reverse();
  this.cancelAll.disabled=this.archiveAll.disabled=this.bulkBusy||this.activeActions.size>0;
  if(this.bulkFeedback)this.notice.textContent=this.bulkFeedback;
  this.content.replaceChildren(...entries.map(r=>this.row(r,true,false)));
  if(!entries.length)this.content.append(element('p','No outbox messages.'));
  if(this.storageError)this.notice.textContent=this.storageError;
 }
 private row(r:OutboxEntry,global:boolean,replaced:boolean){
  const row=element('article');row.className='agent-message user agent-outbox-message';row.dataset.outboxId=r.id;row.dataset.state=r.status;
  if(!global){
   row.classList.add('outbox-inline');
   const header=element('small');header.className='outbox-inline-status';
   const pending=['queued','submitting','submitted'].includes(r.status)&&!replaced;
   if(pending){const spinner=element('span');spinner.className='outbox-spinner';spinner.setAttribute('aria-hidden','true');header.append(spinner);}
   header.append(element('span',`You · ${labels[r.status]||r.status}${replaced?' · previous agent process':''}`));row.append(header);
   const text=element('div',r.text);text.className='outbox-text';row.append(text);
   const details=element('button','Message details');details.type='button';details.className='outbox-inline-details';details.onclick=()=>this.open();row.append(details);
   if(replaced||['uncertain','blocked','cancelled','command'].includes(r.status)){const warning=element('p',r.note);warning.className='outbox-inline-warning';row.append(warning);}
   return row;
  }

  row.append(element('small',`You · ${labels[r.status]||r.status}${replaced?' · previous agent process':''}`));
  if(global)row.append(element('small',`${r.host} · ${r.session}:${r.window}.${r.pane} · ${new Date(r.created_at).toLocaleString()}`));
  const text=element('div',r.text);text.className='outbox-text';row.append(text,element('p',r.note));
  const actions=element('div');actions.className='outbox-actions';
  const act=(label:string,action:string)=>{const button=element('button',label);button.type='button';button.disabled=this.bulkBusy||this.activeActions.has(r.id);button.onclick=()=>{void this.act(r,action,button);};actions.append(button);};
  if(!r.local){
   if(r.status==='queued'||r.status==='blocked'){act('Cancel message','cancel');if(!replaced)act('Submit now','submit');}
   if(r.status==='submitted'||r.status==='uncertain')act('Check delivery','check');
   if(r.status!=='queued'&&r.status!=='submitting')act('Archive receipt','archive');
  }else{
   const dismiss=element('button','Dismiss local receipt');dismiss.onclick=()=>{if(confirm('Dismiss this local receipt? This does not undo any input or remove a message already saved in CC.')){this.local=this.local.filter(e=>e.id!==r.id);try{this.persist();this.update();}catch(error){this.notice.textContent=String(error);}}};actions.append(dismiss);
  }
  if(r.text){const copy=element('button','Copy message');copy.type='button';copy.onclick=()=>{void navigator.clipboard.writeText(r.text).catch(()=>{const selection=getSelection();const range=document.createRange();range.selectNodeContents(text);selection?.removeAllRanges();selection?.addRange(range);});};actions.append(copy);}
  row.append(actions);const error=this.actionErrors.get(r.id);if(error){const note=element('p',error);note.setAttribute('role','status');row.append(note);}return row;
 }
 private async bulk(action:'cancel'|'archive'){
  if(this.bulkBusy||this.activeActions.size)return;
  this.bulkBusy=true;this.bulkFeedback='Checking all stored receipts…';this.update();
  try{
   const response=await fetch(`/api/v1/agents/outbox/bulk?action=${action}`,{cache:'no-store',signal:AbortSignal.timeout(10000)});const preview=await response.json();
   if(!response.ok)throw Error(preview.error||'Could not inspect all receipts');
   if(!preview.count){this.bulkFeedback='No eligible messages or receipts.';return;}
   const local=this.local.length?` ${this.local.length} browser-only receipt(s) will be kept for individual review.`:'';
   const warning=action==='cancel'?`Cancel all ${preview.count} queued/blocked messages across ALL machines? Already submitting, submitted or uncertain input cannot be cancelled.`:`Archive all ${preview.count} eligible receipts across ALL machines and remove their stored message text? This includes ${preview.submitted} submitted and ${preview.uncertain} uncertain receipt(s). Archiving does not undo terminal input. Queued messages behind these receipts may proceed.`;
   if(!confirm(`${warning} ${preview.skipped} ineligible record(s) will be left unchanged.${local}`)){this.bulkFeedback='Bulk action cancelled. Nothing was changed.';return;}
   this.bulkFeedback='Applying the reviewed batch…';this.update();
   const applied=await fetch('/api/v1/agents/outbox/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,expected:preview.expected}),signal:AbortSignal.timeout(15000)});const data=await applied.json();
   if(!applied.ok)throw Error(data.error||'Bulk action failed');
   this.bulkFeedback=`${action==='cancel'?'Cancelled':'Archived'} ${data.count} ${action==='cancel'?'messages':'receipts'}.`;
   if(Array.isArray(data.entries))this.ingest(data.entries);
  }catch(error){this.bulkFeedback=`${String(error)} Refresh the outbox before taking another action; this batch will not be retried automatically.`;}
  finally{this.bulkBusy=false;this.update();}
 }
 private async act(r:OutboxEntry,action:string,button:HTMLButtonElement){
  if(action==='submit'&&!confirm('Submit this message to the terminal now? The CLI may queue or ignore input while busy. CC will keep the receipt; it will not retry uncertain input.'))return;
  if(action==='archive'&&!confirm('Archive this receipt and remove its text from CC? This does not undo terminal input. Any queued messages behind it may proceed.'))return;
  if(this.bulkBusy||this.activeActions.has(r.id))return;
  this.activeActions.add(r.id);this.actionErrors.delete(r.id);button.disabled=true;
  try{
   let token:string|undefined;
   if(action==='submit'){
    const hosts=await(await fetch('/api/v1/hosts',{cache:'no-store'})).json();const host=hosts.find((h:{id:string})=>h.id===r.host);
    if(!host)throw Error('Original machine is unavailable');
    const query=new URLSearchParams({session:r.session,window:r.window,pane:r.pane,connection_revision:host.connection_revision});
    const response=await fetch(`/api/v1/hosts/${encodeURIComponent(r.host)}/agents/conversation?${query}`,{cache:'no-store',signal:AbortSignal.timeout(25000)});const detail=await response.json();
    if(!response.ok||detail.instance!==r.instance||!detail.message_token)throw Error(detail.send_reason||detail.error||'Original agent is unavailable or awaiting a decision');
    token=detail.message_token;
   }
   const snapshot=await fetch('/api/v1/agents/outbox',{cache:'no-store',signal:AbortSignal.timeout(10000)});const currentData=await snapshot.json();
   if(!snapshot.ok)throw Error(currentData.error||'Could not refresh the message receipt');
   const current=(currentData.entries as OutboxEntry[]).find(e=>e.id===r.id);
   if(!current||current.status!==r.status||current.instance!==r.instance||current.text!==r.text)throw Error('Message status changed. Review its latest receipt before acting.');
   const response=await fetch(`/api/v1/agents/outbox/${encodeURIComponent(r.id)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,revision:current.revision,token}),signal:AbortSignal.timeout(25000)});const data=await response.json();
   if(!response.ok)throw Error(data.error||'Outbox action failed');
   if(data.outbox)this.accept(data.outbox);
  }catch(error){this.actionErrors.set(r.id,String(error));this.notice.textContent=String(error);void this.refresh();}
  finally{this.activeActions.delete(r.id);button.disabled=false;this.update();}
 }
}
