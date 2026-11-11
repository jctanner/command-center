// Explicit native question controls. Never reuse ordinary message/approval input.
export type QuestionReceipt={id:string;host:string;session:string;window:string;pane:string;instance:string;conversation:string;question:string;status:string;note:string};
export type InputQuestion={id:string;title:string;context:string;choices?:{id:string;label:string;description:string}[];text_available?:boolean;text_max_bytes?:number;token?:string;submitted?:boolean;receipt?:QuestionReceipt;reason?:string};
export type QuestionTarget={host:string;session:string;window:string;pane:string;instance:string;conversation:string};
type Pending={id:string;key:string;target:QuestionTarget;question:string};
const storageKey='cc.agent-question.pending.v1';
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
function uuid(){const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;return Array.from(b,v=>v.toString(16).padStart(2,'0')).join('').replace(/^(........)(....)(....)(....)(............)$/,'$1-$2-$3-$4-$5');}
export class QuestionControls{
 private pending=new Map<string,Pending>();private drafts=new Map<string,string>();private results=new Map<string,QuestionReceipt>();private feedback=new Map<string,string>();private storageError='';private active=false;
 private current?:{key:string;target:QuestionTarget;question:InputQuestion;disabled:boolean};private rendered='';private root=node('div');private title=node('p');private detail=node('details');private context=node('pre');private choices=node('div');private input=node('input');private other=node('button','Submit other answer');private status=node('p');private check=node('button','Check response');
 constructor(private busy:(value:boolean)=>void,private refresh:()=>void){
  try{const raw=localStorage.getItem(storageKey)||'[]';if(raw.length>65536)throw Error('Question receipts exceed browser storage limit');const values=JSON.parse(raw);if(!Array.isArray(values)||values.length>100)throw Error('Invalid question receipt storage');for(const p of values){if(typeof p?.id!=='string'||typeof p.key!=='string'||typeof p.question!=='string'||!p.target||['host','session','window','pane','instance','conversation'].some(k=>typeof p.target[k]!=='string'))throw Error('Invalid saved question receipt');this.pending.set(p.key,p);}}
  catch{this.storageError='Saved question response state is unavailable. Check the terminal; answering here is disabled.';}
 }
 private persist(){const raw=JSON.stringify([...this.pending.values()]);if(raw.length>65536)throw Error('Question receipt storage limit reached');localStorage.setItem(storageKey,raw);}
 render(container:HTMLElement,target:QuestionTarget,question:InputQuestion,disabled:boolean){
  const key=JSON.stringify([target.host,target.session,target.window,target.pane,target.instance,target.conversation,question.id]);this.current={key,target,question,disabled};
  const capable=!!(question.token||question.submitted||question.receipt||this.pending.has(key)||this.results.has(key));const renderKey=key+'|'+capable;
  if(this.rendered!==renderKey){
   this.rendered=renderKey;this.root=node('div');this.title=node('p');this.detail=node('details');this.detail.open=!capable;this.detail.append(node('summary','Review native question'),this.context=node('pre'));this.choices=node('div');this.choices.className='approval-choices question-choices';
   for(const choice of capable?question.choices||[]:[]){const b=node('button');b.type='button';b.append(node('strong',choice.label));if(choice.description)b.append(node('small',choice.description));b.onclick=()=>{void this.submit(key,choice.id);};this.choices.append(b);}
   const label=node('label','Other answer');this.input=node('input');this.input.type='text';this.input.setAttribute('aria-label','Other answer');this.input.value=this.drafts.get(key)||'';this.input.oninput=()=>{this.drafts.set(key,this.input.value);if(!this.blocked())this.feedback.delete(key);this.update();};this.input.onpaste=event=>{const text=event.clipboardData?.getData('text/plain');if(text&&/[\u0000-\u001f\u007f-\u009f]/.test(text)){event.preventDefault();this.feedback.set(key,'Use a single-line answer without control characters. The paste was not changed or sent.');this.update();}};this.input.onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!event.isComposing&&event.keyCode!==229&&!event.repeat){event.preventDefault();if(!this.other.disabled)void this.submit(key,'other',this.drafts.get(key)||'');}};label.append(this.input);
   this.other=node('button','Submit other answer');this.other.type='button';this.other.onclick=()=>{void this.submit(key,'other',this.drafts.get(key)||'');};
   this.check=node('button','Check response');this.check.type='button';this.check.onclick=()=>{void this.inspect(key);};this.status=node('p');this.status.setAttribute('role','status');this.root.append(node('strong','Input required'),this.title,this.choices,label,this.other,this.detail,this.check,this.status);
  }
  if(!container.contains(this.root))container.replaceChildren(this.root);
  this.title.textContent=question.title;if(this.context.textContent!==question.context)this.context.textContent=question.context;
  this.input.parentElement!.hidden=this.other.hidden=!question.text_available||!capable;
  this.input.maxLength=2048;
  if(question.receipt&&this.valid(question.receipt,{id:question.receipt.id,key,target,question:question.id})){const pending=this.pending.get(key);if(pending?.id===question.receipt.id)this.accept(pending,question.receipt);else this.results.set(key,question.receipt);}
  this.update();
 }
 private blocked(){const c=this.current;if(!c)return true;const r=this.results.get(c.key)||c.question.receipt;return c.disabled||this.active||!!this.storageError||!c.question.token||!!c.question.submitted||this.pending.has(c.key)||!!r&&r.status!=='rejected';}
 private update(){const c=this.current;if(!c)return;const disabled=this.blocked();for(const b of this.choices.querySelectorAll('button'))b.disabled=disabled;this.input.disabled=disabled;const text=this.drafts.get(c.key)||'';const limit=c.question.text_max_bytes||0;
  this.other.disabled=disabled||!text||text.trim()!==text||/[\u0000-\u001f\u007f-\u009f]/.test(text)||new TextEncoder().encode(text).length>limit;
  const receipt=this.results.get(c.key)||c.question.receipt;this.check.hidden=!this.pending.has(c.key);this.check.disabled=this.active;
  const bytes=new TextEncoder().encode(text).length;const validation=text&&(text.trim()!==text||/[\u0000-\u001f\u007f-\u009f]/.test(text))?'Use one line without control characters or edge whitespace.':bytes>limit&&text?`Other answer is ${bytes} UTF-8 bytes; the current limit is ${limit}.`:'';
  this.status.textContent=this.storageError||this.feedback.get(c.key)||receipt?.note||validation||(c.question.submitted?'A response is already submitted or uncertain. Check the terminal; do not repeat it.':c.question.reason)||(!c.question.token?'Answer this question in tmux; no guarded response is available for this view.':`Choose an answer, or enter a single-line Other answer (up to ${limit} UTF-8 bytes).`);
 }
 private valid(r:QuestionReceipt,p:Pending){return r.id===p.id&&r.host===p.target.host&&r.session===p.target.session&&r.window===p.target.window&&r.pane===p.target.pane&&r.instance===p.target.instance&&r.conversation===p.target.conversation&&r.question===p.question&&['submitting','submitted','uncertain','rejected'].includes(r.status);}
 private accept(p:Pending,r:QuestionReceipt){if(!this.valid(r,p))throw Error('Question receipt target does not match the original answer. Check the terminal.');this.results.set(p.key,r);this.feedback.set(p.key,r.note);if(r.status==='rejected'||r.status==='submitted'){this.pending.delete(p.key);try{this.persist();}catch{this.pending.set(p.key,p);}}}
 private async submit(key:string,choice:string,text?:string){
  const c=this.current;if(!c||c.key!==key||this.blocked()||(choice==='other'&&this.other.disabled))return;
  let p:Pending;
  try{if(this.pending.size>=100)throw Error('Saved question receipt capacity reached; check existing responses first.');p={id:uuid(),key,target:{...c.target},question:c.question.id};this.pending.set(key,p);this.persist();}
  catch(error){this.pending.delete(key);this.feedback.set(key,`${String(error)} Nothing was sent.`);this.update();return;}
  this.active=true;this.feedback.set(key,'Submitting answer once…');this.busy(true);this.update();
  try{
   const response=await fetch(`/api/v1/hosts/${encodeURIComponent(c.target.host)}/agents/question`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:p.id,token:c.question.token,choice,...text!==undefined?{text}:{}}),signal:AbortSignal.timeout(25000)});const data=await response.json();
   if(!response.ok){if([400,409,410,422,429].includes(response.status)){this.pending.delete(key);try{this.persist();}catch{this.pending.set(key,p);}throw Error((data.error||'Question response rejected')+'. No input was sent by this attempt. Refresh and review.');}throw Error(data.error||'Question response did not return a receipt');}this.accept(p,data.receipt);
  }catch(error){this.feedback.set(key,`${String(error)} Check response or the terminal; this answer will not be resent automatically.`);}
  finally{c.question.token=undefined;this.active=false;this.busy(false);this.update();this.refresh();}
 }
 private async inspect(key:string){const p=this.pending.get(key);if(!p||this.active)return;this.active=true;this.update();try{const response=await fetch(`/api/v1/agents/questions/${encodeURIComponent(p.id)}`,{cache:'no-store',signal:AbortSignal.timeout(10000)});const data=await response.json();if(!response.ok)throw Error(data.error||'No response receipt is available yet');this.accept(p,data.receipt);}catch(error){this.feedback.set(key,`${String(error)} Check the terminal before responding again. No input was retried.`);}finally{this.active=false;this.update();this.refresh();}}
}
