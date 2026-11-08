import {LanguageDescription} from '@codemirror/language';
import {languages} from '@codemirror/language-data';
import {highlightTree,tagHighlighter,tags} from '@lezer/highlight';

const highlighter=tagHighlighter([
  {tag:tags.keyword,class:'chat-token-keyword'},
  {tag:[tags.string,tags.regexp],class:'chat-token-string'},
  {tag:[tags.number,tags.bool,tags.null],class:'chat-token-number'},
  {tag:[tags.typeName,tags.className,tags.namespace],class:'chat-token-type'},
  {tag:[tags.function(tags.variableName),tags.propertyName],class:'chat-token-property'},
  {tag:tags.comment,class:'chat-token-comment'},
  {tag:tags.invalid,class:'chat-token-invalid'},
]);

/** Only decorate sanitized text. No HTML generation, language guessing or editor instances. */
export function highlightChatCode(body:HTMLElement){
  let remaining=64000,blocks=0;
  for(const code of body.querySelectorAll<HTMLElement>('pre > code')){
    const label=[...code.classList].find(c=>c.startsWith('language-'))?.slice(9);
    const text=code.textContent||'';
    if(!label||!text||text.length>16000||text.length>remaining||blocks>=8)continue;
    const language=LanguageDescription.matchLanguageName(languages,label,false);
    if(!language)continue;
    remaining-=text.length;blocks++;
    // Leave the initial message render responsive while a grammar loads locally.
    window.setTimeout(()=>{void decorate(code,text,language);},0);
  }
}

async function decorate(code:HTMLElement,text:string,language:LanguageDescription){
  try{
    const support=await language.load();
    if(!code.isConnected||code.textContent!==text)return;
    const content=document.createDocumentFragment();let position=0;
    highlightTree(support.language.parser.parse(text),highlighter,(from,to,classes)=>{
      if(from>position)content.append(document.createTextNode(text.slice(position,from)));
      const span=document.createElement('span');span.className=classes;span.textContent=text.slice(from,to);
      content.append(span);position=to;
    });
    if(position<text.length)content.append(document.createTextNode(text.slice(position)));
    code.replaceChildren(content);code.dataset.highlighted=language.name;
  }catch{/* Keep exact plain code when a local grammar cannot load or parse. */}
}
