import {bindFileActions,fileActionsButton,showFileActions} from './file-actions';
import { highlightChatCode } from './chat-code';
import { markdownContent } from './markdown';

export type ChatFileContext={project:string;machine:string;references?:readonly string[];download?:{host:string;connection:string};openFile:(path:string)=>Promise<void>};
function filePath(href:string,project:string,literal=false):string|null{
  try{
    const raw=href.trim();
    if(!raw||raw.length>16384||raw.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(raw)||raw.startsWith('//'))return null;
    const path=literal?raw:decodeURIComponent(raw.split(/[?#]/,1)[0]);
    if(!path||path.length>4096||path.startsWith('//')||(path.startsWith('~')&&!path.startsWith('~/'))||/^[a-z][a-z0-9+.-]*:/i.test(path)||/[\\\x00-\x1f\x7f-\x9f]/.test(path))return null;
    if(path.startsWith('~/'))return path;
    if(!path.startsWith('/')&&!project.startsWith('/'))return null;
    const parts:string[]=[];
    for(const part of (path.startsWith('/')?path:project.replace(/\/$/,'')+'/'+path).split('/')){
      if(!part||part==='.')continue;if(part==='..'){parts.pop();continue;}parts.push(part);
    }
    return '/'+parts.join('/');
  }catch{return null;}
}
function explicitFilePaths(text:string):string[]{
  const paths=new Set<string>();
  const source=text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g,'');
  for(const m of source.matchAll(/`([^`\n]+)`|\[[^\]\n]*\]\(([^)\n]+)\)/g)){
    const raw=m[1]??m[2];if(!raw.startsWith('/')&&!raw.startsWith('~/'))continue;
    const path=filePath(raw,'',!!m[1]);if(path&&/\.[a-z0-9]{1,12}$/i.test(path))paths.add(path);
    if(paths.size>=256)break;
  }
  return [...paths];
}
export function conversationFilePaths(messages:readonly {id?:string;text:string;role?:string;kind?:string}[],cache?:Map<string,{text:string;paths:string[]}>):string[]{
  const paths=new Set<string>();let budget=1024*1024;
  const seen=new Set<string>();for(const m of messages){if(m.role!=='assistant'||m.kind||budget<=0)continue;const text=m.text.slice(0,budget);budget-=text.length;if(m.id)seen.add(m.id);const existing=m.id&&cache?.get(m.id),found=existing&&existing.text===text?existing.paths:explicitFilePaths(text);if(m.id&&cache)cache.set(m.id,{text,paths:found});for(const path of found){paths.add(path);if(paths.size>=256)break;}if(paths.size>=256)break;}
  if(cache)for(const id of cache.keys())if(!seen.has(id))cache.delete(id);return [...paths];
}
function resolveFilePath(href:string,files:ChatFileContext,text:string,literal=false):string|null{
  const path=filePath(href,files.project,literal);if(!path||href.startsWith('/')||href.startsWith('~/'))return path;
  const relative=(literal?href:decodeURIComponent(href.split(/[?#]/,1)[0])).replace(/^\.\//,'');
  if(relative.split('/').some(p=>p==='..'))return path;
  // An explicit "same folder" statement binds a bare sibling filename to the
  // one directory actually named in this message, never to a guessed worktree.
  if(!relative.includes('/')){
    const code='`'+href+'`',at=text.indexOf(code),tail=at<0?'':text.slice(at+code.length,at+code.length+100);
    if(/^\s+(?:is\s+)?(?:in\s+)?(?:the\s+)?same\s+(?:folder|directory)\b/i.test(tail)){
      const dirs=[...new Set(explicitFilePaths(text).map(p=>p.slice(0,p.lastIndexOf('/'))))];
      if(dirs.length===1)return filePath(dirs[0]+'/'+relative,files.project,true);
    }
  }
  const matches=[...new Set((files.references||[]).filter(p=>p.endsWith('/'+relative)))];
  return matches.length===1?matches[0]:path;
}
function fileButton(content:HTMLElement,files:ChatFileContext,path:string):HTMLElement{
  const button=document.createElement('button');button.type='button';button.className='chat-file-link';
  if(content.tagName==='CODE')button.append(content);else button.append(...content.childNodes);
  button.title=`${files.machine} › ${path}`;button.setAttribute('aria-label',`Open ${button.textContent||'file'} in Files on ${files.machine}`);
  button.onclick=()=>{void files.openFile(path).catch(error=>{if(!button.isConnected)return;const note=document.createElement('span');note.className='chat-file-error';note.setAttribute('role','status');note.textContent=String(error);button.after(note);});};if(files.download){const binary=/\.(?:mp4|webm|mov|mkv|m4v|avi|mp3|wav|flac|ogg|zip|gz|tar|7z|png|jpe?g|gif|webp|pdf)$/i.test(path),location={...files.download,path,machine:files.machine,...(!binary?{open:()=>button.click()}:{})};if(binary){button.setAttribute('aria-label',`Open file actions for ${button.textContent||'file'} on ${files.machine}`);button.onclick=()=>showFileActions(button,location);}bindFileActions(button,location);const group=document.createElement('span');group.className='chat-file-reference';group.append(button,fileActionsButton(location));return group;}return button;
}
export function chatMarkdown(text: string,files?:ChatFileContext): HTMLElement {
  const body = document.createElement('div'); body.className = 'agent-markdown';
  body.append(markdownContent(text, ['input', 'select', 'textarea', 'option']));
  for (const link of body.querySelectorAll<HTMLAnchorElement>('a')) {
    const href = link.getAttribute('href') || '';
    if (/^(https?:|mailto:)/i.test(href)) {link.target='_blank';link.rel='noopener noreferrer';continue;}
    const path=files&&resolveFilePath(href,files,text);
    if(!files||!path){link.removeAttribute('href');continue;}
    link.replaceWith(fileButton(link,files,path));
  }
  if(files)for(const code of body.querySelectorAll<HTMLElement>('code')){
    if(code.closest('pre,a,button'))continue;
    const value=code.textContent||'';
    // Whole, file-like tokens only; don't reinterpret code, URLs or shell paths.
    if(!(/^(?:~\/|\/|\.\.?\/)?[a-z0-9_@+.-]+(?:\/[a-z0-9_@+.-]+)*\.(?:html?|md|markdown|txt|json|jsonl|ya?ml|toml|csv|ts|tsx|js|jsx|py|rs|sh|css|sql|log|svg|png|jpe?g|gif|webp|pdf|mp4|webm|mov|mkv|m4v|avi|mp3|wav|flac|ogg|zip|gz|tar|7z)$/i.test(value)||/^(?:~\/|\/)[^\\\x00-\x1f\x7f]+\.(?:html?|md|txt|json|png|jpe?g|gif|webp|svg|pdf|mp4|webm|mov|mkv|m4v|avi|mp3|wav|flac|ogg|zip|gz|tar|7z)$/i.test(value)))continue;
    const path=resolveFilePath(value,files,text,true);if(!path)continue;
    const button=fileButton(code.cloneNode(true) as HTMLElement,files,path);code.replaceWith(button);
  }
  if(files){const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);const nodes:Text[]=[];while(walker.nextNode()){const n=walker.currentNode as Text;if(!n.parentElement?.closest('pre,code,a,button'))nodes.push(n);}for(const n of nodes){const text=n.data,pattern=/(?:^|[\s(])(\/(?!\/)[^\s<>"'`(),;]+\.(?:html?|md|txt|json|png|jpe?g|gif|webp|pdf|mp4|webm|mov|mkv|m4v|avi|mp3|wav|flac|ogg|zip|gz|tar|7z))(?=$|[\s),.;])/gi;let end=0,matched=false;const fragment=document.createDocumentFragment();for(const m of text.matchAll(pattern)){const start=m.index!+m[0].length-m[1].length,path=resolveFilePath(m[1],files,text,true);if(!path)continue;fragment.append(text.slice(end,start));const label=document.createElement('span');label.textContent=m[1];fragment.append(fileButton(label,files,path));end=start+m[1].length;matched=true;}if(matched){fragment.append(text.slice(end));n.replaceWith(fragment);}}}
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
