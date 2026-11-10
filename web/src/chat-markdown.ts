import { highlightChatCode } from './chat-code';
import { markdownContent } from './markdown';

export type ChatFileContext={project:string;machine:string;openFile:(path:string)=>Promise<void>};
function filePath(href:string,project:string):string|null{
  try{
    const raw=href.trim();
    if(!raw||raw.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(raw)||raw.startsWith('//'))return null;
    const path=decodeURIComponent(raw.split(/[?#]/,1)[0]);
    if(!path||path.startsWith('//')||path.startsWith('~')||/^[a-z][a-z0-9+.-]*:/i.test(path)||/[\\\x00-\x1f\x7f-\x9f]/.test(path))return null;
    if(!path.startsWith('/')&&!project.startsWith('/'))return null;
    const parts:string[]=[];
    for(const part of (path.startsWith('/')?path:project.replace(/\/$/,'')+'/'+path).split('/')){
      if(!part||part==='.')continue;if(part==='..'){parts.pop();continue;}parts.push(part);
    }
    return '/'+parts.join('/');
  }catch{return null;}
}
export function chatMarkdown(text: string,files?:ChatFileContext): HTMLElement {
  const body = document.createElement('div'); body.className = 'agent-markdown';
  body.append(markdownContent(text, ['input', 'select', 'textarea', 'option']));
  for (const link of body.querySelectorAll<HTMLAnchorElement>('a')) {
    const href = link.getAttribute('href') || '';
    if (/^(https?:|mailto:)/i.test(href)) {link.target='_blank';link.rel='noopener noreferrer';continue;}
    const path=files&&filePath(href,files.project);
    if(!files||!path){link.removeAttribute('href');continue;}
    // A button has no navigable filesystem/HTTP URL or implicit prefetch.
    const button=document.createElement('button');button.type='button';button.className='chat-file-link';
    button.append(...link.childNodes);button.title=`${files.machine} › ${path}`;
    button.setAttribute('aria-label',`Open ${button.textContent||'file'} in Files on ${files.machine}`);
    button.onclick=()=>{void files.openFile(path).catch(error=>{
      if(!button.isConnected)return;
      const note=document.createElement('span');note.className='chat-file-error';note.setAttribute('role','status');note.textContent=String(error);button.after(note);
    });};link.replaceWith(button);
  }
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
