import {test,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
let dir:string,base:string,backend:ChildProcess;
test.beforeAll(async()=>{dir=mkdtempSync(join(tmpdir(),'cc-background-'));const config=join(dir,'config.toml');writeFileSync(config,'hosts = []\n');const s=createServer();const port=await new Promise<number>(r=>s.listen(0,'127.0.0.1',()=>r((s.address() as {port:number}).port)));await new Promise<void>(r=>s.close(()=>r()));base=`http://127.0.0.1:${port}`;backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',base.slice(7),'--config',config,'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{stdio:'ignore'});await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status}catch{return 0}}).toBe(200);});
test.afterAll(async()=>{if(backend&&backend.exitCode===null){const exit=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exit;}if(dir)rmSync(dir,{recursive:true,force:true});});

test('phone receipts distinguish attachment verification and allow read-only recovery without terminal traffic',async({page})=>{
 await page.setViewportSize({width:393,height:852});
 const host={id:'fixture',name:'Fixture',connection_revision:'connection'};
 const receipt:any={id:'11111111-1111-4111-8111-111111111111',host:'fixture',session:'$0',window:'@0',pane:'%0',instance:'process',conversation:'conversation',text:'Review the synthetic diagram.',status:'blocked',note:'Attachment copy uncertain; no native input was sent.',revision:2,created_at:Date.now(),updated_at:Date.now(),attachment:{state:'uncertain',path:'/home/fixture/.cache/command-center/attachments/11111111-1111-4111-8111-111111111111/whiteboard-22222222-2222-4222-8222-222222222222.png',manifest:{sha256:'a'.repeat(64),bytes:2000},error:'Check the original copy; no retry.',expires_at:Date.now()+604800000}};
 const writes:any[]=[];let sockets=0;
 await page.route('**/api/v1/hosts',r=>r.fulfill({json:[host]}));
 await page.route('**/api/v1/queue',r=>r.fulfill({json:{checked_at:Date.now()/1000,hosts:[{...host,items:[{id:'fixture-agent',session:'$0',window:'@0',pane:'%0',session_name:'Fixture',window_name:'Attachment fixture',project:'/fixture',agent:'codex',prompt:'Live agent',status:'live',context:'',attention:{instance:'process'}}]}]}}));
 await page.route('**/agents/conversation?*',r=>r.fulfill({json:{instance:'process',provider:'codex',project:'/fixture',context:'',selected:'conversation',association:'process',conversations:[{id:'conversation',session:'session',timestamp:'',linked:true}],messages:[],send_available:false,attention:false,outbox_entries:[receipt]}}));
 await page.route('**/api/v1/agents/outbox',r=>r.fulfill({json:{entries:[receipt]}}));
 await page.route('**/api/v1/agents/outbox/'+receipt.id,r=>{writes.push(r.request().postDataJSON());receipt.attachment.state='verified';receipt.attachment.error=null;receipt.status='queued';receipt.revision++;receipt.note='Target checksum verified; waiting for native input.';return r.fulfill({json:{outbox:receipt}});});
 page.on('websocket',()=>sockets++);
 await page.goto(base+'/#/queue');await page.locator('.queue-card').click();
 const bubble=page.locator('.agent-history .agent-outbox-message');await expect(bubble).toHaveCount(1);await expect(bubble).toContainText('image uncertain');
 await bubble.getByRole('button',{name:'Message details',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Agent outbox'});
 await expect(dialog.getByRole('button',{name:'Submit now',exact:true})).toHaveCount(0);
 await dialog.locator('summary').click();await expect(dialog).toContainText(receipt.attachment.path);await expect(dialog).toContainText('SHA-256: '+'a'.repeat(64));
 expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
 await dialog.getByRole('button',{name:'Check attachment',exact:true}).click();
 await expect(dialog.locator('summary')).toHaveText('Attachment · verified');await expect(dialog.getByRole('button',{name:'Submit now',exact:true})).toBeVisible();expect(writes).toEqual([{action:'check_attachment',revision:2}]);expect(sockets).toBe(0);
 await page.screenshot({path:'../test-results/attachment-receipt-phone.png'});
});
