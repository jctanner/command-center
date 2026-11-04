/** Delegated compact-message gestures; native scrolling and interactive children keep ownership. */
export function messageThreadGestures(container:HTMLElement,isCompact:()=>boolean,open:(article:HTMLElement)=>void){
 type Press={article:HTMLElement;id:number;x:number;y:number;at:number;type:string;held:boolean};
 let press:Press|undefined,lastTap:{article:HTMLElement;at:number;x:number;y:number}|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const interactive=(target:EventTarget|null)=>target instanceof Element&&!!target.closest('a,button,input,textarea,select,summary,pre,code,[contenteditable="true"]');
 const articleFor=(target:EventTarget|null)=>{const article=target instanceof Element?target.closest<HTMLElement>('article.slack-message'):null;return article?.parentElement===container?article:undefined;};
 const selected=()=>!!window.getSelection()?.toString();
 const cancel=()=>{clearTimeout(timer);press=undefined;};
 const activate=(article:HTMLElement)=>{if(!isCompact()||!article.isConnected||!article.getClientRects().length)return;lastTap=undefined;open(article);};
 container.addEventListener('pointerdown',event=>{
  cancel();if(!event.isPrimary){lastTap=undefined;return;}if(!isCompact()||event.button!==0||interactive(event.target)||selected()){lastTap=undefined;return;}const article=articleFor(event.target);if(!article)return;
  const current:Press={article,id:event.pointerId,x:event.clientX,y:event.clientY,at:performance.now(),type:event.pointerType,held:false};press=current;
  timer=setTimeout(()=>{if(press!==current)return;current.held=true;lastTap=undefined;activate(article);},500);
 });
 window.addEventListener('pointermove',event=>{if(press&&event.pointerId===press.id&&Math.hypot(event.clientX-press.x,event.clientY-press.y)>10){cancel();lastTap=undefined;}});
 container.addEventListener('pointerup',event=>{
  const current=press;if(!current||event.pointerId!==current.id)return;cancel();if(current.held||interactive(event.target)||articleFor(event.target)!==current.article)return;
  const now=performance.now();if(current.type==='touch'||current.type==='pen'){
   if(lastTap?.article===current.article&&now-lastTap.at<350&&Math.hypot(event.clientX-lastTap.x,event.clientY-lastTap.y)<24){activate(current.article);lastTap=undefined;}
   else lastTap={article:current.article,at:now,x:event.clientX,y:event.clientY};
  }
 });
 window.addEventListener('pointerup',event=>{if(press?.id===event.pointerId){cancel();lastTap=undefined;}});
 window.addEventListener('pointercancel',()=>{cancel();lastTap=undefined;});
 window.addEventListener('blur',()=>{cancel();lastTap=undefined;});
 container.addEventListener('scroll',()=>{cancel();lastTap=undefined;},{passive:true});
 container.addEventListener('dragstart',()=>{cancel();lastTap=undefined;});
 container.addEventListener('dblclick',event=>{if(interactive(event.target))return;const article=articleFor(event.target);if(article)activate(article);});
 container.addEventListener('contextmenu',event=>{if(press&&press.type!=='mouse'&&!interactive(event.target)){event.preventDefault();press.held=true;activate(press.article);}});
 container.addEventListener('keydown',event=>{if(event.target instanceof HTMLElement&&event.target.matches('article.slack-message')&&isCompact()&&(event.key==='Enter'||event.key==='F10'&&event.shiftKey)){event.preventDefault();activate(event.target);}});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){cancel();lastTap=undefined;}});
}
