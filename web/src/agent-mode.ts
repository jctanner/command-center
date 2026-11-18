import type {CardTarget} from './agent-card-editor';
type Receipt={container?:{profile:string;image:string;model:string;volume:string}|null;connection_revision?:string;installation?:{package:string;version:string;prefix:string}|null;mode:string;python_venv?:string|null;id:string;state:string;note:string;provider:string;session:string;project:string;command:string[]};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
export class AgentModeSwitcher {
 private dialog=el('dialog');private description=el('p');private command=el('pre');private feedback=el('p');private cancel=el('button','Cancel');private confirm=el('button','Switch connection mode');private check=el('button','Check progress');private dismiss=el('button','I’ve checked the pane');
 private resolveRecovery=el('button','Resolve recovered switch');private installAdapter=el('button','Install adapter and review switch');private notice=el('div');private noticeTimer=0;
 private target?:(CardTarget&{mode:string;broker?:string;broker_instance?:string});private receipt?:Receipt;private epoch=0;private timer=0;private busy=false;
 constructor(private changed:()=>Promise<void>){
  this.notice.className='agent-restart-notice';this.notice.setAttribute('role','status');this.notice.setAttribute('aria-label','Agent connection mode result');this.notice.hidden=true;document.body.append(this.notice);
  this.dialog.className='agent-close-dialog agent-restart-dialog';this.dialog.setAttribute('aria-label','Switch connection mode');this.feedback.setAttribute('role','status');this.confirm.className='danger';this.command.style.whiteSpace='pre-wrap';this.command.style.overflowWrap='anywhere';this.description.style.overflowWrap='anywhere';
  for(const b of [this.cancel,this.confirm,this.installAdapter,this.check,this.dismiss,this.resolveRecovery])b.type='button';
  const actions=el('div');actions.className='agent-card-actions';actions.append(this.cancel,this.confirm,this.installAdapter,this.check,this.dismiss,this.resolveRecovery);this.dialog.append(el('h2','Switch connection mode in this pane?'),this.description,this.command,this.feedback,actions);document.body.append(this.dialog);
  this.resolveRecovery.hidden=true;this.resolveRecovery.onclick=()=>void this.recover();this.installAdapter.hidden=true;this.installAdapter.onclick=()=>void this.install();this.cancel.onclick=()=>this.close();this.confirm.onclick=()=>void this.start();this.check.onclick=()=>void this.status(this.epoch,this.receipt?.state==='installing'?180:0);
  this.dismiss.onclick=()=>{if(this.target)localStorage.removeItem(this.key(this.target));this.close();};
  this.dialog.addEventListener('cancel',event=>{if(this.busy)event.preventDefault();else{clearTimeout(this.timer);this.epoch++;}});
 }
 private key(t:CardTarget){return 'cc.mode-switch.'+JSON.stringify([t.host,t.session,t.window,t.pane]);}
 private close(){if(this.busy)return;clearTimeout(this.timer);this.epoch++;this.dialog.close();}
 private async request(path:string,body?:unknown):Promise<Receipt>{const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(25000)});const data=await response.json();if(!response.ok)throw Error(data.error||'Mode switch unavailable');return data;}
 async open(target:CardTarget&{mode:string;broker?:string;broker_instance?:string}){
  if(this.busy)return;clearTimeout(this.timer);const epoch=++this.epoch;this.target={...target};this.receipt=undefined;this.resolveRecovery.hidden=true;this.cancel.textContent='Cancel';this.check.disabled=false;this.confirm.disabled=true;this.confirm.hidden=false;this.installAdapter.hidden=true;this.check.hidden=this.dismiss.hidden=true;this.command.textContent='';this.description.textContent=target.label;this.feedback.textContent='Verifying the active session…';if(!this.dialog.open)this.dialog.showModal();this.dialog.setAttribute('aria-label',target.mode==='acp_restart'?'Restart ACP agent':'Switch connection mode');this.dialog.querySelector('h2')!.textContent=target.mode==='acp_restart'?'Restart and update this broker?':'Switch connection mode in this pane?';this.cancel.focus();
  try{
   const pending=localStorage.getItem(this.key(target));
   if(pending){this.resolveRecovery.hidden=!!target.broker||target.mode!=='acp';this.cancel.textContent='Close';this.receipt={id:pending,state:'checking',note:'',provider:'',session:'',project:'',command:[],mode:target.mode};this.confirm.hidden=true;this.check.hidden=false;this.dismiss.hidden=false;await this.status(epoch,180);return;}
   const {host,label,acp,...fields}=target;void acp;const params=new URLSearchParams();for(const [key,value]of Object.entries(fields))if(value!==undefined)params.set(key,value);
   const receipt=await this.request(`/api/v1/hosts/${encodeURIComponent(host)}/agents/connection-mode?${params}`);
   if(epoch!==this.epoch||!this.dialog.open)return;this.receipt=receipt;this.describe(receipt);this.feedback.textContent='Switch only while idle. The agent process will be replaced and this exact conversation resumed. Drafts stay with the old process and are not resent. An unsupported resume fails without creating another conversation.';this.confirm.textContent=receipt.mode==='acp_restart'?'Restart & update broker':`Switch to ${receipt.mode==='acp'?'ACP':'native'}`;this.confirm.disabled=false;this.confirm.hidden=receipt.state==='install_required';this.installAdapter.hidden=receipt.state!=='install_required';this.installAdapter.disabled=false;if(receipt.state==='install_required')this.feedback.textContent='Install this pinned adapter first. No agent will be stopped; the switch gets a fresh review after installation.';this.cancel.focus();
  }catch(error){
   if(epoch!==this.epoch)return;this.feedback.textContent=String(error);
   if(!target.broker&&target.mode==='acp'&&String(error).includes('earlier switch')){
    try{
     const {host,label,acp,...fields}=target;void label;void acp;const params=new URLSearchParams();for(const [key,value]of Object.entries(fields))if(value!==undefined)params.set(key,value);
     const receipt=await this.request(`/api/v1/hosts/${encodeURIComponent(host)}/agents/connection-mode-recover?${params}`);
     if(epoch!==this.epoch||!this.dialog.open)return;this.receipt=receipt;this.describe(receipt);this.feedback.textContent='An earlier switch is unresolved, but the original conversation is verified in a recovered native process. Resolve that receipt before reviewing a new switch. This sends no input.';this.confirm.hidden=true;this.resolveRecovery.hidden=false;this.check.hidden=false;
    }catch{/* Preserve the original conflict when no exact native recovery can be proven. */}
   }
  }
 }
 private describe(r:Receipt){this.dismiss.textContent=r.installation?'I’ve checked the installation':'I’ve checked the pane';if(r.installation){this.cancel.textContent=r.state==='install_required'?'Cancel':'Close';this.description.textContent=`${this.target?.label} · ${r.provider} session ${r.session} · ${r.project}. Install ${r.installation.package}@${r.installation.version} in ${r.installation.prefix}. Package scripts are disabled. This leaves the native harness and current agent unchanged; the switch is reviewed again afterward.`;this.command.textContent='';return;}this.description.textContent=`${this.target?.label} · ${r.provider} · Session ${r.session} · ${r.project}${r.python_venv?" · Python venv: "+r.python_venv:""}. Switch to ${r.mode==='acp_restart'?'ACP with the current deployed broker (session/load)':r.mode==='acp'?'ACP (adapter session/load)':r.provider==='claude'?'native (claude --resume)':'native (codex resume)'}, replacing this pane’s agent and shell while resuming this exact conversation. The tmux window, pane and sibling panes remain. Card name, notes, color and pin carry over after verification.`;if(r.container)this.description.textContent+=` Container profile: ${r.container.profile} · Model: ${r.container.model} · Image: ${r.container.image} · Preserved state volume: ${r.container.volume}.`;this.command.textContent=r.command.map(a=>JSON.stringify(a)).join(' ');}
 private async recover(){
  const target=this.target,r=this.receipt;if(!target||!r||this.busy)return;
  clearTimeout(this.timer);this.epoch++;this.busy=true;this.resolveRecovery.disabled=this.cancel.disabled=true;
  try{
   const {host,label,acp,...fields}=target;void label;void acp;
   const receipt=await this.request(`/api/v1/hosts/${encodeURIComponent(host)}/agents/connection-mode-recover`,{id:r.id,target:fields});
   this.receipt=receipt;
   localStorage.removeItem(this.key(target));
   this.busy=false;this.cancel.disabled=false;
   await this.open({...target,connection_revision:receipt.connection_revision||target.connection_revision});
  }catch(error){this.feedback.textContent=`${error} Nothing was sent to the agent; the original receipt remains for review.`;}
  finally{this.busy=false;this.cancel.disabled=this.resolveRecovery.disabled=false;}
 }
 private async install(){
  const target=this.target,r=this.receipt;if(!target||!r||r.state!=='install_required'||this.busy)return;
  try{localStorage.setItem(this.key(target),r.id);}catch{this.feedback.textContent='Cannot retain the installation receipt; nothing was installed.';return;}
  this.busy=true;this.installAdapter.disabled=this.cancel.disabled=true;this.feedback.textContent='Starting isolated adapter installation…';
  try{this.receipt=await this.request(`/api/v1/hosts/${encodeURIComponent(target.host)}/agents/connection-mode-install`,{id:r.id});}
  catch(error){this.feedback.textContent=`${error} Check the original receipt; installation will not be retried automatically.`;}
  finally{this.busy=false;this.cancel.disabled=false;this.cancel.textContent='Close';this.installAdapter.hidden=this.confirm.hidden=true;this.check.hidden=this.dismiss.hidden=false;}
  await this.status(this.epoch,180);
 }
 private async start(){
  const target=this.target,r=this.receipt;if(!target||!r||this.busy)return;
  // Save only an opaque receipt ID, before issuing the one human-confirmed POST.
  try{localStorage.setItem(this.key(target),r.id);}catch{this.feedback.textContent='Cannot remember this switch receipt in the browser. No switch was attempted.';return;}
  this.busy=true;this.confirm.disabled=this.cancel.disabled=true;this.feedback.textContent=target.mode==='acp_restart'?'Restarting and updating once…':'Switching once…';
  try{this.receipt=await this.request(`/api/v1/hosts/${encodeURIComponent(target.host)}/agents/connection-mode`,{id:r.id});}
  catch(error){this.feedback.textContent=`${String(error)} Delivery is uncertain. Check status or inspect the pane; this action will not be retried.`;}
  finally{this.busy=false;this.cancel.disabled=false;this.confirm.hidden=true;this.check.hidden=this.dismiss.hidden=false;}
  await this.status(this.epoch,20);
 }
 private async status(epoch:number,remaining:number){
  const target=this.target,r=this.receipt;if(!target||!r)return;clearTimeout(this.timer);this.check.disabled=true;
  try{
   const receipt=await this.request(`/api/v1/hosts/${encodeURIComponent(target.host)}/agents/connection-mode-status?${new URLSearchParams({id:r.id})}`);
   if(epoch!==this.epoch||!this.dialog.open)return;this.receipt=receipt;this.describe(receipt);this.feedback.textContent=receipt.note;this.resolveRecovery.hidden=receipt.state!=='checking'||receipt.mode!=='acp'||!!target.broker;
   if(receipt.state==='recovered'){localStorage.removeItem(this.key(target));await this.open({...target,connection_revision:receipt.connection_revision||target.connection_revision});return;}
   if(receipt.state==='installed'){localStorage.removeItem(this.key(target));await this.open({...target,connection_revision:receipt.connection_revision||target.connection_revision});return;}
   if(receipt.state==='install_failed'){localStorage.removeItem(this.key(target));this.confirm.hidden=this.installAdapter.hidden=true;this.check.hidden=true;return;}
   if(receipt.state==='install_uncertain'){this.confirm.hidden=this.installAdapter.hidden=true;return;}
   if(receipt.state==='not_sent'){localStorage.removeItem(this.key(target));this.confirm.hidden=true;this.check.hidden=true;}
   else if(receipt.state==='complete'){
    try{localStorage.removeItem(this.key(target));}catch{/* Server verification still establishes success. */}
    this.close();clearTimeout(this.noticeTimer);this.notice.textContent=`${receipt.mode==='acp_restart'?'Broker restarted and updated':'Connection mode switched'} · ${target.label} · ${receipt.provider} session ${receipt.session.slice(0,8)} resumed.`;this.notice.hidden=false;this.noticeTimer=window.setTimeout(()=>{this.notice.hidden=true;},10000);
    void this.changed().catch(()=>{this.notice.textContent+=' Refresh Agents to see the updated process.';});
   }
   else if(remaining>0)this.timer=window.setTimeout(()=>void this.status(epoch,remaining-1),1500);
  }catch(error){if(epoch===this.epoch)this.feedback.textContent=`${String(error)} Inspect the pane before taking another action. Checking status never repeats the switch.`;}
  finally{if(epoch===this.epoch)this.check.disabled=false;}
 }
}
