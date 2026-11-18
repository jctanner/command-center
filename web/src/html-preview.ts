import DOMPurify from 'dompurify';

const limit=1024*1024;
const policy="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/** Static, isolated document only: never insert the result into CC's DOM. */
export function htmlPreview(text:string):HTMLIFrameElement {
 if(new TextEncoder().encode(text).length>limit)throw Error('HTML preview is limited to 1 MiB.');
 const content=DOMPurify.sanitize(text,{
  WHOLE_DOCUMENT:true,RETURN_DOM:true,USE_PROFILES:{html:true},
  FORBID_TAGS:['script','noscript','iframe','frame','frameset','object','embed','form','input','button','select','textarea','base','meta','link','audio','video','source','track'],
  FORBID_ATTR:['href','xlink:href','action','formaction','target','ping','download','srcdoc','srcset','background','poster','autofocus'],
  ALLOWED_URI_REGEXP:/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i,
 }) as HTMLElement;
 for(const node of content.querySelectorAll('[src]')){
  if(node.tagName!=='IMG'||!/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(node.getAttribute('src')||''))node.removeAttribute('src');
 }
 const frame=document.createElement('iframe');frame.title='Rendered HTML';frame.setAttribute('sandbox','');frame.referrerPolicy='no-referrer';
 // Our policy precedes all file content. File-supplied meta/base/navigation tags
 // are removed, rather than relying on unsupported CSP navigation directives.
 frame.srcdoc=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html{color-scheme:light;background:white;color:#171717}body{margin:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${content.outerHTML}</body></html>`;
 return frame;
}
