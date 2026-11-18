import {bindFileActions,fileActionsButton} from './file-actions';
import { highlightChatCode } from './chat-code';
import { markdownContent } from './markdown';

export type ChatFileContext={project:string;machine:string;download?:{host:string;connection:string};openFile:(path:string)=>Promise<void>};
function filePath(href:string,project:string,literal=false):string|null{
  try{
    const raw=href.trim();
    if(!raw||raw.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(raw)||raw.startsWith('//'))return null;
    const path=literal?raw:decodeURIComponent(raw.split(/[?#]/,1)[0]);
    if(!path||path.startsWith('//')||path.startsWith('~')||/^[a-z][a-z0-9+.-]*:/i.test(path)||/[\\\x00-\x1f\x7f-\x9f]/.test(path))return null;
    if(!path.startsWith('/')&&!project.startsWith('/'))return null;
    const parts:string[]=[];
    for(const part of (path.startsWith('/')?path:project.replace(/\/$/,'')+'/'+path).split('/')){
      if(!part||part==='.')continue;if(part==='..'){parts.pop();continue;}parts.push(part);
    }
    return '/'+parts.join('/');
  }catch{return null;}
}
function fileButton(content:HTMLElement,files:ChatFileContext,path:string):HTMLElement{
  const button=document.createElement('button');button.type='button';button.className='chat-file-link';
  if(content.tagName==='CODE')button.append(content);else button.append(...content.childNodes);
  button.title=`${files.machine} › ${path}`;button.setAttribute('aria-label',`Open ${button.textContent||'file'} in Files on ${files.machine}`);
  button.onclick=()=>{void files.openFile(path).catch(error=>{if(!button.isConnected)return;const note=document.createElement('span');note.className='chat-file-error';note.setAttribute('role','status');note.textContent=String(error);button.after(note);});};if(files.download){const location={...files.download,path,machine:files.machine,open:()=>button.click()};bindFileActions(button,location);const group=document.createElement('span');group.className='chat-file-reference';group.append(button,fileActionsButton(location));return group;}return button;
}
export function chatMarkdown(text: string,files?:ChatFileContext): HTMLElement {
  const body = document.createElement('div'); body.className = 'agent-markdown';
  body.append(markdownContent(text, ['input', 'select', 'textarea', 'option']));
  for (const link of body.querySelectorAll<HTMLAnchorElement>('a')) {
    const href = link.getAttribute('href') || '';
    if (/^(https?:|mailto:)/i.test(href)) {link.target='_blank';link.rel='noopener noreferrer';continue;}
    const path=files&&filePath(href,files.project);
    if(!files||!path){link.removeAttribute('href');continue;}
    link.replaceWith(fileButton(link,files,path));
  }
  if(files)for(const code of body.querySelectorAll<HTMLElement>('code')){
    if(code.closest('pre,a,button'))continue;
    const value=code.textContent||'';
    // Whole, file-like tokens only; don't reinterpret code, URLs or shell paths.
    if(!(/^(?:\/|\.\.?\/)?[a-z0-9_@+.-]+(?:\/[a-z0-9_@+.-]+)*\.(?:html?|md|markdown|txt|json|jsonl|ya?ml|toml|csv|ts|tsx|js|jsx|py|rs|sh|css|sql|log|svg|png|jpe?g|gif|webp|pdf|mp4|webm|mov|mkv|m4v|avi|mp3|wav|flac|ogg|zip|gz|tar|7z)$/i.test(value)||/^\/[^\\\x00-\x1f\x7f]+\.(?:html?|md|txt|json|png|jpe?g|gif|webp|svg|pdf|mp4|webm|mov|mkv|m4v|avi|mp3|wav|flac|ogg|zip|gz|tar|7z)$/i.test(value)))continue;
    const path=filePath(value,files.project,true);if(!path)continue;
    const button=fileButton(code.cloneNode(true) as HTMLElement,files,path);code.replaceWith(button);
  }
  if(files){const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);const nodes:Text[]=[];while(walker.nextNode()){const n=walker.currentNode as Text;if(!n.parentElement?.closest('pre,code,a,button'))nodes.push(n);}for(const n of nodes){const text=n.data,pattern=/(?:^|[\s(])(\/(?!\/)[^\s<>"'`(),;]+\.(?:html?|md|txt|json|png|jpe?g|gif|webp|pdf|mp4|webm|mov|mkv|m4v|avi|mp3|wav|flac|ogg|zip|gz|tar|7z))(?=$|[\s),.;])/gi;let end=0,matched=false;const fragment=document.createDocumentFragment();for(const m of text.matchAll(pattern)){const start=m.index!+m[0].length-m[1].length,path=filePath(m[1],files.project,true);if(!path)continue;fragment.append(text.slice(end,start));const label=document.createElement('span');label.textContent=m[1];fragment.append(fileButton(label,files,path));end=start+m[1].length;matched=true;}if(matched){fragment.append(text.slice(end));n.replaceWith(fragment);}}}
  for (const table of body.querySelectorAll('table')) {
    const scroll = document.createElement('div'); scroll.className = 'chat-table-scroll';
    scroll.tabIndex = 0; scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Message table');
    table.replaceWith(scroll); scroll.append(table);
  }
  for (const pre of body.querySelectorAll('pre')) {
    pre.tabIndex = 0;
    const wrapper = document.createElement('div'); wrapper.className = 'chat-code-block';
    const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy'; copy.className = 'chat-code-copy'; copy.setAttribute('aria-label', 'Copy code');
    copy.onclick = async () => {
      const text = pre.querySelector('code')?.textContent || pre.textContent || '';
      try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; }
      catch { const range = document.createRange(); range.selectNodeContents(pre); const selection = getSelection(); selection?.removeAllRanges(); selection?.addRange(range); copy.textContent = 'Select and copy'; }
    };
    pre.replaceWith(wrapper); wrapper.append(copy, pre);
  }
  highlightChatCode(body);
  return body;
}
