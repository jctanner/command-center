import {test,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
let dir:string,base:string,backend:ChildProcess;
test.beforeAll(async()=>{dir=mkdtempSync(join(tmpdir(),'cc-background-'));const config=join(dir,'config.toml');writeFileSync(config,'hosts = []\n');const s=createServer();const port=await new Promise<number>(r=>s.listen(0,'127.0.0.1',()=>r((s.address() as {port:number}).port)));await new Promise<void>(r=>s.close(()=>r()));base=`http://127.0.0.1:${port}`;backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',base.slice(7),'--config',config,'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{stdio:'ignore'});await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status}catch{return 0}}).toBe(200);});
test.afterAll(async()=>{if(backend&&backend.exitCode===null){const exit=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exit;}if(dir)rmSync(dir,{recursive:true,force:true});});

for(const provider of ['claude','codex','pi'])test(`${provider} paste envelope display requires exact Seen receipt evidence`,async({page})=>{
 await page.setViewportSize({width:393,height:852});const now=Math.floor(Date.now()/1000);let available=false,receiptReads=0,posts=0,spies=0;
 const wrap=(text:string,id='abcd')=>`\n\n<pasted_content id="${id}">\n${text}\n</pasted_content id="${id}">\n`;
 const original='  My prompt\n<img src="https://paste-spy.invalid/pixel"> & literal text  ',wrapped=wrap(original);
 const texts=[wrapped,wrap('Intentional XML'),wrap('Different closing ID').replace('</pasted_content id="abcd">','</pasted_content id="ffff">'),'Prefix '+wrap('Embedded'),wrap(wrap('Nested')),wrap('Wrong process'),wrap('Wrong conversation'),wrap('No receipt')];
 const messages=texts.map((text,i)=>({id:String(10+i),role:'user',text,timestamp:''}));
 const target={host:'local',session:'$0',window:'@0',pane:'%0',instance:'process',conversation:'conversation'};
 const receipt=(index:number,text:string,extra={})=>({...target,id:`receipt-${index}`,text,status:'seen',note:'Seen in conversation.',revision:4,created_at:1,updated_at:2,seen_message:10+index,...extra});
 const receipts=[receipt(0,original),receipt(1,texts[1]),receipt(2,'Different closing ID'),receipt(3,'Embedded'),receipt(4,wrap('Nested')),receipt(5,'Wrong process',{instance:'other'}),receipt(6,'Wrong conversation',{conversation:'other'})];
 const activity={state:'ready',source:provider+'_events',reason:'Turn finished',observed_at:now,evidence_at:now};
 page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/agents/'))posts++;if(r.url().includes('paste-spy.invalid'))spies++;});
 await page.route('**/api/v1/agents/outbox',r=>{if(available)receiptReads++;return r.fulfill({json:{entries:available?receipts:[]}});});
 await page.route('**/api/v1/queue',r=>r.fulfill({json:{checked_at:now,hosts:[{id:'local',name:'Fixture',connection_revision:'revision',error:null,limited:false,items:[{id:'fixture',session:'$0',session_name:'fixture',window:'@0',window_name:'fixture',pane:'%0',project:'/fixture',agent:provider,prompt:'Live agent',context:'',status:'live',activity,attention:{instance:'process'},card:{revision:1,name:'Paste fixture',notes:'',color:'',pinned:false}}]}]}}));
 await page.route('**/agents/conversation?*',r=>{const known=new URL(r.request().url()).searchParams.has('known_version');return r.fulfill({json:{provider,association:'process',selected:'conversation',instance:'process',context:'',project:'/fixture',activity,attention:false,send_available:false,conversations:[],history_version:'fixed-version',history_unchanged:known,messages:known?[]:messages,activities:[]}});});
 await page.goto(base+'/#/queue');await page.locator('.queue-card').click();const native=page.locator('.agent-message.user[data-message-id="10"] .agent-user-text');await expect(native).toHaveText(wrapped);
 // Receipt arrives independently after history is already rendered/unchanged.
 available=true;await expect.poll(()=>receiptReads,{timeout:10000}).toBeGreaterThan(0);
 await expect(native).toHaveText(provider==='claude'?original:wrapped);
 expect(await native.textContent()).toBe(provider==='claude'?original:wrapped);
 for(let i=1;i<texts.length;i++)expect(await page.locator(`.agent-message.user[data-message-id="${10+i}"] .agent-user-text`).textContent()).toBe(texts[i]);
 expect(await page.locator('.agent-history img').count()).toBe(0);expect(spies).toBe(0);expect(posts).toBe(0);
 // API fixture/native records were never rewritten by the presentation cleanup.
 expect(messages[0].text).toBe(wrapped);
});
