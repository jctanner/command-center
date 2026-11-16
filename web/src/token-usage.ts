import {tokenNumber,type TokenMetrics} from './agent-token-metrics';
type UsageItem={status?:string;token_metrics?:TokenMetrics|null};
type UsageHost={id:string;name:string;connection_revision:string;error?:string;items:UsageItem[]};
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const el=document.createElement(tag);el.textContent=text;return el;};
const known=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>=0;
export class TokenUsage {
 private active=false;private controller?:AbortController;
 private status=document.getElementById('token-usage-status')!;
 private results=document.getElementById('token-usage-results')!;
 private refreshButton=document.getElementById('refresh-token-usage') as HTMLButtonElement;
 constructor(){this.refreshButton.onclick=()=>void this.refresh();}
 setVisible(visible:boolean){if(this.active===visible)return;this.active=visible;if(visible)void this.refresh();else{this.controller?.abort();this.controller=undefined;this.refreshButton.disabled=false;}}
 private async refresh(){
  this.controller?.abort();const controller=new AbortController();this.controller=controller;
  this.refreshButton.disabled=true;this.status.textContent='Loading usage…';this.results.replaceChildren();
  try{
   const response=await fetch('/api/v1/queue',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])});
   if(!response.ok)throw Error('Usage unavailable. Refresh to try again.');
   const data=await response.json() as {hosts:UsageHost[]};
   if(!this.active||this.controller!==controller)return;
   let grandTotal=0,conversations=0;
   for(const host of data.hosts){
    const section=node('article');section.className='token-usage-machine';section.append(node('h3',host.name));
    const unique=new Map<string,TokenMetrics>();let excluded=0;
    for(const item of host.items){
     const metrics=item.token_metrics;
     if(host.error||item.status==='disconnected'||metrics?.stale||metrics?.association!=='process'||!metrics.conversation||!known(metrics.session?.total)){excluded++;continue;}
     const key=JSON.stringify([metrics.provider,metrics.conversation]);const previous=unique.get(key);
     if(!previous||metrics.observed_at>previous.observed_at)unique.set(key,metrics);
    }
    const total=[...unique.values()].reduce((sum,m)=>sum+m.session.total!,0);
    grandTotal+=total;conversations+=unique.size;
    section.append(node('p',`${unique.size?tokenNumber(total):'No'} reported tokens · ${unique.size} conversation${unique.size===1?'':'s'}`));
    if(host.error)section.append(node('p','Machine unavailable; its counters are excluded.'));
    if(excluded)section.append(node('p',`${excluded} agent${excluded===1?'':'s'} unavailable, unverified or without reported totals.`));
    if([...unique.values()].some(m=>!m.complete||m.limited))section.append(node('p','Partial scan: reported totals may still be accumulating.'));
    if(unique.size){
     const cacheIncluded=[...unique.values()].filter(m=>m.input_includes_cache).length;
     section.append(node('p',cacheIncluded===unique.size?'Input includes cache reads; do not add the cache column again.':cacheIncluded===0?'Cache reads are reported separately from input.':'Input/cache accounting differs by conversation; cache is included in input for some providers.'));
     const wrap=node('div');wrap.className='token-usage-table';const table=node('table');table.setAttribute('aria-label',`${host.name} conversation usage`);
     const head=node('thead'),heading=node('tr');for(const label of ['Provider / model','Conversation','Total','Input','Output','Cache read','Cache write']){const th=node('th',label);th.scope='col';heading.append(th);}head.append(heading);table.append(head);
     const body=node('tbody');for(const metrics of unique.values()){
      const row=node('tr');row.append(node('td',`${metrics.provider}${metrics.model?` / ${metrics.model}`:''}`));const id=node('td',metrics.conversation);id.className='usage-conversation';row.append(id);
      for(const count of [metrics.session.total,metrics.session.input,metrics.session.output,metrics.session.cached_input,metrics.session.cache_write]){const cell=node('td',known(count)?count.toLocaleString():'unknown');row.append(cell);}
      row.title=`${metrics.input_includes_cache?'Input includes cache reads.':'Cache reads are reported separately from input.'} ${metrics.note||''}`;body.append(row);
     }table.append(body);wrap.append(table);section.append(wrap);
    }
    this.results.append(section);
   }
   this.status.textContent=`${conversations?tokenNumber(grandTotal):'No'} reported tokens across ${conversations} unique machine conversations. Checked ${new Date().toLocaleTimeString()}. Unavailable and unverified counters excluded.`;
   if(!data.hosts.length)this.results.append(node('p','No machines configured.'));
  }catch(error){if(this.active&&this.controller===controller&&!controller.signal.aborted)this.status.textContent=error instanceof Error?error.message:'Usage unavailable.';}
  finally{if(this.controller===controller){this.controller=undefined;this.refreshButton.disabled=false;}}
 }
}
