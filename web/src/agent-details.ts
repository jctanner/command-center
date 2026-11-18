import {compactClient,compactViewport} from './layout';
let serial=0;

/** One live set of controls: inline on compact screens, in a modal on desktop. */
export class AgentDetails {
 private readonly dialog=document.createElement('dialog');
 private readonly closeButton=document.createElement('button');
 private readonly description=document.createElement('p');
 private anchor?:Comment;
 private context='';
 constructor(private readonly trigger:HTMLButtonElement,private readonly content:HTMLElement){
  const id=++serial;this.dialog.id=`agent-details-dialog-${id}`;this.dialog.className='agent-details-dialog';this.dialog.setAttribute('aria-label','Agent details');
  const heading=document.createElement('div');heading.className='agent-details-heading';const titles=document.createElement('div');const title=document.createElement('h2');title.textContent='Agent details';titles.append(title,this.description);
  this.closeButton.type='button';this.closeButton.textContent='Close';this.closeButton.setAttribute('aria-label','Close details');this.closeButton.onclick=()=>this.close();heading.append(titles,this.closeButton);this.dialog.append(heading);
  if(!content.id)content.id=`agent-details-content-${id}`;content.hidden=true;content.after(this.dialog);
  trigger.onclick=()=>{if(compactClient()){content.hidden=!content.hidden;this.sync();}else if(this.dialog.open)this.close();else this.open();};
  this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.close();});
  this.dialog.addEventListener('close',()=>{if(!this.dialog.open)this.restore();});
  this.dialog.addEventListener('click',event=>{if(event.target!==this.dialog)return;const rect=this.dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)this.close();});
  compactViewport.addEventListener('change',()=>{this.reset();this.sync();});this.sync();
 }
 get modalOpen(){return this.dialog.open;}
 setContext(key:string,label:string){if(key!==this.context){this.reset();this.context=key;}this.description.textContent=label;}
 open(){
  if(compactClient()){this.content.hidden=false;this.sync();return;}
  if(this.dialog.open)return;
  this.anchor=document.createComment('agent details');this.content.before(this.anchor);this.dialog.append(this.content);this.content.hidden=false;
  this.dialog.showModal();this.sync();this.closeButton.focus({preventScroll:true});
 }
 close(restoreFocus=true){if(this.dialog.open)this.dialog.close();this.restore();if(restoreFocus&&this.trigger.isConnected&&this.trigger.getClientRects().length)this.trigger.focus({preventScroll:true});}
 reset(){this.close(false);this.content.hidden=true;this.sync();}
 private restore(){if(this.anchor){this.anchor.replaceWith(this.content);this.anchor=undefined;}this.content.hidden=true;this.sync();}
 private sync(){this.trigger.setAttribute('aria-controls',compactClient()?this.content.id:this.dialog.id);this.trigger.setAttribute('aria-expanded',String(this.dialog.open||compactClient()&&!this.content.hidden));if(compactClient())this.trigger.removeAttribute('aria-haspopup');else this.trigger.setAttribute('aria-haspopup','dialog');}
}
