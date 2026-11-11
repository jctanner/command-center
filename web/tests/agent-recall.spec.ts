import {test,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
let dir:string,base:string,backend:ChildProcess;
test.beforeAll(async()=>{dir=mkdtempSync(join(tmpdir(),'cc-background-'));const config=join(dir,'config.toml');writeFileSync(config,'hosts = []\n');const s=createServer();const port=await new Promise<number>(r=>s.listen(0,'127.0.0.1',()=>r((s.address() as {port:number}).port)));await new Promise<void>(r=>s.close(()=>r()));base=`http://127.0.0.1:${port}`;backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',base.slice(7),'--config',config,'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{stdio:'ignore'});await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status}catch{return 0}}).toBe(200);});
test.afterAll(async()=>{if(backend&&backend.exitCode===null){const exit=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exit;}if(dir)rmSync(dir,{recursive:true,force:true});});


for(const width of [1440,393])test(`agent message recall and draft preservation at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:850});let conversation='one',blocked=false,pending=false,reads=0;const writes:string[]=[];let sockets=0;
 const host={id:'fixture',name:'Fixture',connection_revision:'endpoint',remote:false};
 const messages=[{id:'1',role:'user',text:'First prompt',timestamp:''},{id:'2',role:'assistant',text:'Do not recall assistant',timestamp:''},{id:'3',role:'user',text:'Second prompt',timestamp:''},{id:'4',role:'user',text:'Incomplete',timestamp:'',truncated:true}];
 await page.route('**/api/v1/events/hosts',r=>r.fulfill({contentType:'text/event-stream',body:'event: hosts\ndata: '+JSON.stringify({hosts:[host]})+'\n\n'}));
 await page.route('**/api/v1/hosts',r=>r.fulfill({json:[host]}));await page.route('**/api/v1/hosts/*/inventory',r=>r.fulfill({json:{sessions:[]}}));
 await page.route('**/api/v1/queue',r=>r.fulfill({json:{checked_at:Date.now()/1000,hosts:[{...host,limited:false,items:[{id:'agent',session:'$0',session_name:'fixture',window:'@0',window_name:'fixture',pane:'%0',project:'/fixture',agent:'codex',status:'live',attention:{instance:'process'}}]}]}}));
 await page.route('**/api/v1/agents/outbox',r=>r.fulfill({json:{entries:[]}}));
 await page.route('**/agents/conversation?*',r=>{reads++;return r.fulfill({json:{instance:'process',provider:'codex',project:'/fixture',context:'',selected:conversation,association:'process',conversations:[{id:'one',session:'one',timestamp:'',linked:true},{id:'two',session:'two',timestamp:'',linked:false}],messages:conversation==='one'?messages:[{id:'5',role:'user',text:'Other conversation',timestamp:''}],outbox_entries:pending?['queued','uncertain','cancelled'].map((status,i)=>({id:'receipt-'+i,host:'fixture',session:'$0',window:'@0',pane:'%0',instance:'process',conversation:'two',status,text:status+' prompt',revision:1,created_at:i+1,updated_at:i+1,note:''})):[],send_available:true,message_token:'fixture-token',attention:blocked}});});
 page.on('websocket',()=>sockets++);page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
 await page.goto(base+'/#/queue');await page.locator('.queue-card').click();const input=page.getByRole('textbox',{name:'Message to agent',exact:true});await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
 await input.fill('My draft');await input.press('ArrowUp');await expect(input).toHaveValue('Second prompt');await input.press('ArrowUp');await expect(input).toHaveValue('First prompt');await input.press('ArrowUp');await expect(input).toHaveValue('First prompt');
 await input.press('ArrowDown');await expect(input).toHaveValue('Second prompt');await input.press('ArrowDown');await expect(input).toHaveValue('My draft');
 await input.fill('top\nbottom');await input.press('ArrowUp');await expect(input).toHaveValue('top\nbottom');await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(0,0));await input.press('Shift+ArrowUp');await expect(input).toHaveValue('top\nbottom');
 await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(0,0));await input.press('ArrowUp');await expect(input).toHaveValue('Second prompt');
 // A normal polling refresh must not overwrite recalled text or restart the cursor.
 const before=reads;await expect.poll(()=>reads,{timeout:10000}).toBeGreaterThan(before);await expect(input).toHaveValue('Second prompt');await input.press('ArrowUp');await expect(input).toHaveValue('First prompt');
 await input.press('ArrowDown');await input.press('ArrowDown');await expect(input).toHaveValue('top\nbottom');
 // Editing recalled text makes that text the new draft.
 await input.evaluate((el:HTMLTextAreaElement)=>el.setSelectionRange(0,0));await input.press('ArrowUp');await input.fill('Edited recall');await input.press('ArrowDown');await expect(input).toHaveValue('Edited recall');
 await input.press('ArrowUp');await expect(input).toHaveValue('Second prompt');conversation='two';await page.locator('.queue-detail').getByText('Details',{exact:true}).click();await page.getByLabel('Conversation history',{exact:true}).selectOption('two');await expect(input).toHaveValue('Edited recall');await input.press('ArrowUp');await expect(input).toHaveValue('Other conversation');
 await input.press('ArrowDown');await expect(input).toHaveValue('Edited recall');
 await input.dispatchEvent('keydown',{key:'ArrowUp',isComposing:true});await expect(input).toHaveValue('Edited recall');
 pending=true;await page.getByLabel('Conversation history',{exact:true}).dispatchEvent('change');await expect(page.getByLabel('Conversation messages').getByText('queued prompt',{exact:true})).toBeVisible();
 await input.press('ArrowUp');await expect(input).toHaveValue('queued prompt');await input.press('ArrowUp');await expect(input).toHaveValue('Other conversation');await input.press('ArrowDown');await input.press('ArrowDown');await expect(input).toHaveValue('Edited recall');
 blocked=true;await page.getByLabel('Conversation history',{exact:true}).dispatchEvent('change');await expect(input).toHaveAttribute('readonly','');await input.press('ArrowUp');await expect(input).toHaveValue('Edited recall');
 expect(writes).toEqual([]);expect(sockets).toBe(0);
});
