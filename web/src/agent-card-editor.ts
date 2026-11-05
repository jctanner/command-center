export type AgentCard={revision:number;name:string;notes:string;color?:string;pinned?:boolean};
export type CardTarget={host:string;connection_revision:string;session:string;window:string;pane:string;instance:string;label:string};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
export class AgentCardEditor {
 private dialog=el('dialog');private name=el('input');private notes=el('textarea');private color=el('input');private pinned=el('input');private colorValue=el('span','Default');private resetColor=el('button','Use default color');private chosenColor='';
 private feedback=el('p');private save=el('button','Save card');private reload=el('button','Reload saved card');private cancel=el('button','Cancel');private automatic=el('button','Use automatic name');private target?:CardTarget;private revision=0;private epoch=0;private busy=false;private dirty=false;
 constructor(private changed:(target:CardTarget,card:AgentCard)=>void){
  this.dialog.className='agent-card-editor';this.dialog.setAttribute('aria-label','Edit agent card');this.name.setAttribute('aria-label','Agent card name');this.name.maxLength=240;this.notes.setAttribute('aria-label','Agent card notes');this.notes.maxLength=8000;this.notes.rows=6;this.feedback.setAttribute('role','status');
  const n=el('label','Name');n.append(this.name);const notes=el('label','Notes');notes.append(this.notes);
  this.color.type='color';this.color.setAttribute('aria-label','Agent card color');this.color.value='#70e0b1';this.colorValue.className='agent-card-color-value';const colorLabel=el('label','Card color');const colorRow=el('div');colorRow.className='agent-card-color-controls';colorRow.append(this.color,this.colorValue,this.resetColor);const colorHelp=el('small','Choose a color, then press Save card to apply it.');colorHelp.id='agent-card-color-help';this.color.setAttribute('aria-describedby',colorHelp.id);colorLabel.append(colorRow,colorHelp);
  this.pinned.type='checkbox';this.pinned.setAttribute('aria-label','Pin agent card');const pinLabel=el('label','Pin to the top of matching agents');pinLabel.className='agent-card-pin-control';pinLabel.prepend(this.pinned);
  const form=el('form');form.onsubmit=e=>{e.preventDefault();void this.submit();};this.save.type='submit';this.save.className='primary';for(const b of [this.reload,this.cancel,this.automatic,this.resetColor])b.type='button';
  const actions=el('div');actions.className='agent-card-actions';actions.append(this.save,this.reload,this.cancel);form.append(el('h2','Edit agent card'),el('p','Press Save card to apply your changes for this agent process. Leave the name blank to use the automatic title.'),n,this.automatic,colorLabel,pinLabel,notes,this.feedback,actions);this.dialog.append(form);document.body.append(this.dialog);
  this.name.oninput=this.notes.oninput=()=>{this.dirty=true;};this.pinned.onchange=()=>{this.dirty=true;};this.color.oninput=this.color.onchange=()=>{this.chosenColor=this.color.value;this.colorValue.textContent=this.chosenColor;this.dirty=true;};this.resetColor.onclick=()=>{this.chosenColor='';this.color.value='#70e0b1';this.colorValue.textContent='Default';this.dirty=true;};
  this.automatic.onclick=()=>{this.name.value='';this.dirty=true;this.name.focus();};this.cancel.onclick=()=>{if(!this.busy&&(!this.dirty||confirm('Discard unsaved card changes?'))){this.epoch++;this.dialog.close();}};this.reload.onclick=()=>{if(this.target&&(!this.dirty||confirm('Discard your draft and reload the saved card?')))void this.open(this.target);};this.dialog.addEventListener('cancel',e=>{if(this.busy||this.dirty&&!confirm('Discard unsaved card changes?'))e.preventDefault();else this.epoch++;});
 }
 private fields(disabled:boolean){for(const control of [this.save,this.name,this.notes,this.automatic,this.color,this.pinned,this.resetColor])control.disabled=disabled;}
 private async request(target:CardTarget,body?:unknown):Promise<AgentCard>{const {host,label,...query}=target;const url=`/api/v1/hosts/${encodeURIComponent(host)}/agents/card`+(body===undefined?'?'+new URLSearchParams(query):'');const response=await fetch(url,{method:body===undefined?'GET':'PUT',headers:{...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(25000),cache:'no-store'});const value=await response.json();if(!response.ok)throw new Error(value.error||'Agent card could not be saved');return value;}
 async open(target:CardTarget){
  if(this.busy)return;this.target={...target};const epoch=++this.epoch;this.dirty=false;this.name.value='';this.notes.value='';this.chosenColor='';this.color.value='#70e0b1';this.colorValue.textContent='Default';this.pinned.checked=false;this.name.placeholder=target.label;this.feedback.textContent='Loading saved card…';this.fields(true);if(!this.dialog.open)this.dialog.showModal();
  try{const v=await this.request(target);if(epoch!==this.epoch||!this.dialog.open)return;this.revision=v.revision;this.name.value=v.name;this.notes.value=v.notes;this.chosenColor=v.color||'';this.color.value=this.chosenColor||'#70e0b1';this.colorValue.textContent=this.chosenColor||'Default';this.pinned.checked=!!v.pinned;this.feedback.textContent='';this.fields(false);this.name.focus();}catch(e){if(epoch===this.epoch)this.feedback.textContent=String(e);}
 }
 async setPinned(target:CardTarget,pinned:boolean){
  if(this.busy)throw Error('A card update is already in progress');this.busy=true;
  try{const old=await this.request(target);const {host,label,...t}=target;const card=await this.request(target,{target:t,revision:old.revision,name:old.name,notes:old.notes,pinned});this.changed(target,card);}finally{this.busy=false;}
 }
 private async submit(){
  const target=this.target;if(!target||this.busy||this.save.disabled)return;
  // Native pickers can defer input events. Read the current control while
  // preserving the explicit default/reset state when its swatch is unchanged.
  if(this.color.value!==(this.chosenColor||'#70e0b1'))this.chosenColor=this.color.value;
  this.busy=true;this.fields(true);this.reload.disabled=this.cancel.disabled=true;this.feedback.textContent='Saving…';
  try{const {host,label,...t}=target;const card=await this.request(target,{target:t,revision:this.revision,name:this.name.value,notes:this.notes.value,color:this.chosenColor,pinned:this.pinned.checked});this.changed(target,card);this.dirty=false;this.dialog.close();}catch(e){this.feedback.textContent=String(e);}finally{this.busy=false;this.fields(false);this.reload.disabled=this.cancel.disabled=false;}
 }
}
