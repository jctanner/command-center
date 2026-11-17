import type {CardTarget} from './agent-card-editor';
type Receipt={mode:string;python_venv?:string|null;id:string;state:string;note:string;provider:string;session:string;project:string;command:string[]};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
export class AgentModeSwitcher {
 private dialog=el('dialog');private description=el('p');private command=el('pre');private feedback=el('p');private cancel=el('button','Cancel');private confirm=el('button','Switch connection mode');private check=el('button','Check switch status');private dismiss=el('button','I’ve checked the pane');
 private notice=el('div');private noticeTimer=0;
 private target?:(CardTarget&{mode:string;broker?:string;broker_instance?:string});private receipt?:Receipt;private epoch=0;private timer=0;private busy=false;
 constructor(private changed:()=>Promise<void>){
  this.notice.className='agent-restart-notice';this.notice.setAttribute('role','status');this.notice.setAttribute('aria-label','Agent connection mode result');this.notice.hidden=true;document.body.append(this.notice);
  this.dialog.className='agent-close-dialog agent-restart-dialog';this.dialog.setAttribute('aria-label','Switch connection mode');this.feedback.setAttribute('role','status');this.confirm.className='danger';this.command.style.whiteSpace='pre-wrap';this.command.style.overflowWrap='anywhere';
  for(const b of [this.cancel,this.confirm,this.check,this.dismiss])b.type='button';
  const actions=el('div');actions.className='agent-card-actions';actions.append(this.cancel,this.confirm,this.check,this.dismiss);this.dialog.append(el('h2','Switch connection mode in this pane?'),this.description,this.command,this.feedback,actions);document.body.append(this.dialog);
  this.cancel.onclick=()=>this.close();this.confirm.onclick=()=>void this.start();this.check.onclick=()=>void this.status(this.epoch,0);
  this.dismiss.onclick=()=>{if(this.target)localStorage.removeItem(this.key(this.target));this.close();};
  this.dialog.addEventListener('cancel',event=>{if(this.busy)event.preventDefault();else{clearTimeout(this.timer);this.epoch++;}});
 }
 private key(t:CardTarget){return 'cc.mode-switch.'+JSON.stringify([t.host,t.session,t.window,t.pane]);}
 private close(){if(this.busy)return;clearTimeout(this.timer);this.epoch++;this.dialog.close();}
 private async request(path:string,body?:unknown):Promise<Receipt>{const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(25000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Mode switch unavailable');return data;}
 async open(target:CardTarget&{mode:string;broker?:string;broker_instance?:string}){
  if(this.busy)return;clearTimeout(this.timer);const epoch=++this.epoch;this.target={...target};this.receipt=undefined;this.confirm.disabled=true;this.confirm.hidden=false;this.check.hidden=this.dismiss.hidden=true;this.command.textContent='';this.description.textContent=target.label;this.feedback.textContent='Verifying the active session…';if(!this.dialog.open)this.dialog.showModal();this.cancel.focus();
  try{
   const pending=localStorage.getItem(this.key(target));
   if(pending){this.receipt={id:pending,state:'checking',note:'',provider:'',session:'',project:'',command:[],mode:target.mode};this.confirm.hidden=true;this.check.hidden=false;this.dismiss.hidden=false;await this.status(epoch,0);return;}
   const {host,label,acp,...fields}=target;void acp;const params=new URLSearchParams();for(const [key,value]of Object.entries(fields))if(value!==undefined)params.set(key,value);
   const receipt=await this.request(`/api/v1/hosts/${encodeURIComponent(host)}/agents/connection-mode?${params}`);
   if(epoch!==this.epoch||!this.dialog.open)return;this.receipt=receipt;this.describe(receipt);this.feedback.textContent='Switch only while idle. The agent process will be replaced and this exact conversation resumed. Drafts stay with the old process and are not resent. An unsupported resume fails without creating another conversation.';this.confirm.textContent=`Switch to ${receipt.mode==='acp'?'ACP':'native'}`;this.confirm.disabled=false;this.cancel.focus();
  }catch(error){if(epoch===this.epoch)this.feedback.textContent=String(error);}
 }
 private describe(r:Receipt){this.description.textContent=`${this.target?.label} · ${r.provider} · Session ${r.session} · ${r.project}${r.python_venv?" · Python venv: "+r.python_venv:""}. Switch to ${r.mode==='acp'?'ACP (adapter session/load)':'native (codex resume)'}, replacing this pane’s agent and shell while resuming this exact conversation. The tmux window, pane and sibling panes remain. Card name, notes, color and pin carry over after verification.`;this.command.textContent=r.command.map(a=>JSON.stringify(a)).join(' ');}
 private async start(){
  const target=this.target,r=this.receipt;if(!target||!r||this.busy)return;
  // Save only an opaque receipt ID, before issuing the one human-confirmed POST.
  try{localStorage.setItem(this.key(target),r.id);}catch{this.feedback.textContent='Cannot remember this switch receipt in the browser. No switch was attempted.';return;}
  this.busy=true;this.confirm.disabled=this.cancel.disabled=true;this.feedback.textContent='Switching once…';
  try{this.receipt=await this.request(`/api/v1/hosts/${encodeURIComponent(target.host)}/agents/connection-mode`,{id:r.id});}
  catch(error){this.feedback.textContent=`${String(error)} Delivery is uncertain. Check status or inspect the pane; this action will not be retried.`;}
  finally{this.busy=false;this.cancel.disabled=false;this.confirm.hidden=true;this.check.hidden=this.dismiss.hidden=false;}
  await this.status(this.epoch,20);
 }
 private async status(epoch:number,remaining:number){
  const target=this.target,r=this.receipt;if(!target||!r)return;clearTimeout(this.timer);this.check.disabled=true;
  try{
   const receipt=await this.request(`/api/v1/hosts/${encodeURIComponent(target.host)}/agents/connection-mode-status?${new URLSearchParams({id:r.id})}`);
   if(epoch!==this.epoch||!this.dialog.open)return;this.receipt=receipt;this.describe(receipt);this.feedback.textContent=receipt.note;
   if(receipt.state==='not_sent'){localStorage.removeItem(this.key(target));this.confirm.hidden=true;this.check.hidden=true;}
   else if(receipt.state==='complete'){
    try{localStorage.removeItem(this.key(target));}catch{/* Server verification still establishes success. */}
    this.close();clearTimeout(this.noticeTimer);this.notice.textContent=`Connection mode switched · ${target.label} · ${receipt.provider} session ${receipt.session.slice(0,8)} resumed.`;this.notice.hidden=false;this.noticeTimer=window.setTimeout(()=>{this.notice.hidden=true;},10000);
    void this.changed().catch(()=>{this.notice.textContent+=' Refresh Agents to see the updated process.';});
   }
   else if(remaining>0)this.timer=window.setTimeout(()=>void this.status(epoch,remaining-1),1500);
  }catch(error){if(epoch===this.epoch)this.feedback.textContent=`${String(error)} Inspect the pane before taking another action. Checking status never repeats the switch.`;}
  finally{if(epoch===this.epoch)this.check.disabled=false;}
 }
}
