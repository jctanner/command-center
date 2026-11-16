export type TokenCounts={input:number|null;output:number|null;cached_input:number|null;cache_write:number|null;reasoning_output:number|null;total:number|null};
export type TokenMetrics={stale?:boolean;source:string;provider:string;conversation:string;instance?:string|null;association:string;complete:boolean;limited:boolean;session:TokenCounts;input_includes_cache:boolean;context:{used:number|null;window:number|null;reported_at:string|null};model?:string|null;observed_at:number;note:string};
const el=<K extends keyof HTMLElementTagNameMap>(tag:K,text='')=>{const n=document.createElement(tag);n.textContent=text;return n;};
const valid=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export function tokenNumber(v:unknown){if(!valid(v))return 'unknown';if(v>=1000000)return `${Number((v/1000000).toFixed(2))}M`;if(v>=1000)return `${Number((v/1000).toFixed(1))}k`;return String(v);}
export class AgentTokenMetrics{
 readonly element=el('div');private summary=el('span');private meter=el('meter');private details=el('details');private rows=el('dl');private note=el('p');private cardContext=el('span');private cardTotal=el('span');private detail:boolean;
 constructor(detail=false){this.detail=detail;this.cardContext.className='agent-context-bar';this.cardTotal.className='agent-session-total';this.element.className=detail?'agent-token-metrics agent-token-detail':'agent-token-metrics';this.summary.className='agent-token-summary';this.meter.min=0;this.meter.max=100;this.meter.low=70;this.meter.high=90;this.meter.optimum=30;this.meter.setAttribute('aria-label','Last reported context usage');this.element.append(this.summary,this.meter);if(!detail){this.meter.hidden=true;this.summary.append(this.cardContext,this.cardTotal);}if(detail){this.details.append(el('summary','Token details'),this.rows,this.note);this.element.append(this.details);}}
 update(data?:TokenMetrics|null,stale=false){
  stale=stale||!!data?.stale;
  const used=data?.context?.used,window=data?.context?.window,percent=valid(used)&&valid(window)&&window>0?Math.round(used/window*100):null;
  const prefix=stale?'Last observed · ':data?.association==='project'?'Selected history · ':'';
  const context=valid(used)?`Context ${tokenNumber(used)}${valid(window)&&window>0?` / ${tokenNumber(window)} (${percent}%)`:''}`:'';
  const total=valid(data?.session?.total)?`${tokenNumber(data?.session.total)} tokens`:'';
  if(this.detail)this.summary.textContent=prefix+([context,total].filter(Boolean).join(' · ')||'Usage unreported');
  else{
    this.cardContext.textContent=prefix+(context||'Usage unreported');
    this.cardTotal.textContent=total;this.cardTotal.hidden=!total;
    this.cardContext.dataset.known=String(percent!==null);
    this.cardContext.style.setProperty('--context-fill',`${Math.min(100,percent||0)}%`);
    this.cardContext.dataset.level=percent!==null&&percent>=90?'high':percent!==null&&percent>=70?'medium':'normal';
    this.cardContext.setAttribute('role',percent===null?'note':'meter');
    this.cardContext.setAttribute('aria-label',prefix+(context||'Context usage unreported'));
    for(const [key,value] of Object.entries({'aria-valuemin':'0','aria-valuemax':'100','aria-valuenow':String(Math.min(100,percent||0)),'aria-valuetext':context})){
      if(percent===null)this.cardContext.removeAttribute(key);else this.cardContext.setAttribute(key,value);
    }
  }
  this.summary.setAttribute('aria-label',`${prefix}${context||'Context usage unreported'}; ${total||'Session total unreported'}${valid(used)&&!valid(window)?'; context capacity unreported':''}`);
  this.element.dataset.stale=String(stale);this.meter.hidden=!this.detail||percent===null;this.meter.value=Math.min(100,percent||0);this.meter.title=percent===null?'Context window not reported':`${percent}% of the provider-reported window (last reported request)`;
  this.element.title=stale?'Connection unavailable; these are last-observed counters.':[data?.note||'No provider-reported token metrics available for this agent.',valid(used)&&!valid(window)?'Context capacity is unreported; no limit is inferred.':''].filter(Boolean).join(' ');
  const counts=data?.session;const values:[string,unknown][]=[['Session total',counts?.total],['Input'+(data?.input_includes_cache?' (includes cache read)':''),counts?.input],['Output',counts?.output],['Cache read'+(data?.input_includes_cache?' (included in input)':''),counts?.cached_input],['Cache write',counts?.cache_write],['Reasoning (included in output)',counts?.reasoning_output]];
  this.rows.replaceChildren(...values.flatMap(([label,value])=>[el('dt',label),el('dd',valid(value)?value.toLocaleString():'unknown')]));
  const reported=data?.context?.reported_at;this.note.textContent=`${data?.association==='project'?'These counters describe selected project history, not a verified live conversation. ':''}${stale?'Last observed while connected. ':''}${data?.note||'Metrics unknown: no verified native usage record.'}${data?.model?` Reported model: ${data.model}.`:''}${reported&&Number.isFinite(Date.parse(reported))?` Last reported: ${new Date(reported).toLocaleString()}.`:''}${data?.source?` Source: ${data.source}.`:''}`;
 }
}
