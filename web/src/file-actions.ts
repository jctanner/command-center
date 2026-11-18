export type FileLocation={host:string;connection:string;path:string;machine:string;open?:()=>void};
export function fileDownloadUrl(location:Pick<FileLocation,'host'|'connection'|'path'>):string{
 return `/api/v1/hosts/${encodeURIComponent(location.host)}/file/download?`+new URLSearchParams({connection_revision:location.connection,path:location.path});
}
let dismiss:(()=>void)|undefined;
export function showFileActions(trigger:HTMLElement,location:FileLocation,x?:number,y?:number){
 dismiss?.();const menu=document.createElement('div');menu.className='file-actions-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','File actions');const controller=new AbortController(),signal=controller.signal;const close=()=>{controller.abort();menu.remove();dismiss=undefined;};dismiss=close;
 const title=document.createElement('div');title.className='file-actions-location';title.textContent=`${location.machine} › ${location.path}`;menu.append(title);
 if(location.open){const open=document.createElement('button');open.type='button';open.setAttribute('role','menuitem');open.textContent='Open in Files';open.onclick=()=>{close();location.open!();};menu.append(open);}
 const download=document.createElement('a');download.setAttribute('role','menuitem');download.textContent='Download file';download.href=fileDownloadUrl(location);download.download=location.path.split('/').at(-1)||'download';download.onclick=()=>{queueMicrotask(close);};menu.append(download);document.body.append(menu);
 const bounds=trigger.getBoundingClientRect();menu.style.left=`${Math.max(8,Math.min(x??bounds.left,innerWidth-menu.offsetWidth-8))}px`;menu.style.top=`${Math.max(8,Math.min(y??bounds.bottom,innerHeight-menu.offsetHeight-8))}px`;
 document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target as Node))close();},{capture:true,signal});window.addEventListener('resize',close,{signal});window.addEventListener('scroll',event=>{if(!menu.contains(event.target as Node))close();},{capture:true,signal});document.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();if(trigger.isConnected)trigger.focus();}else if(event.key==='Tab')close();else if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const items=[...menu.querySelectorAll<HTMLElement>('[role=menuitem]')],at=items.indexOf(document.activeElement as HTMLElement);items[(at+(event.key==='ArrowDown'?1:-1)+items.length)%items.length].focus();}},{signal});menu.querySelector<HTMLElement>('[role=menuitem]')?.focus();
}
export function bindFileActions(target:HTMLElement,location:FileLocation){
 target.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation();showFileActions(target,location,event.clientX,event.clientY);});target.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();showFileActions(target,location);}});
}
export function fileActionsButton(location:FileLocation):HTMLButtonElement{
 const action=document.createElement('button');action.type='button';action.className='file-actions-toggle';action.textContent='⋯';action.setAttribute('aria-label',`File actions for ${location.path} on ${location.machine}`);action.setAttribute('aria-haspopup','menu');action.title='File actions';action.onclick=event=>{event.stopPropagation();showFileActions(action,location);};return action;
}
