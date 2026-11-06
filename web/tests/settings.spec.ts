import {test,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
let dir:string,base:string,backend:ChildProcess;
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-settings-'));writeFileSync(join(dir,'config.toml'),'hosts = []\n');
 const server=createServer();const port=await new Promise<number>(r=>server.listen(0,'127.0.0.1',()=>r((server.address() as {port:number}).port)));await new Promise<void>(r=>server.close(()=>r()));base=`http://127.0.0.1:${port}`;
 backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',`127.0.0.1:${port}`,'--config',join(dir,'config.toml'),'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{stdio:'pipe'});
 await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status;}catch{return 0;}}).toBe(200);
});
test.afterAll(()=>{backend?.kill('SIGTERM');if(dir)rmSync(dir,{recursive:true,force:true});});
async function snapshot(){return(await fetch(base+'/api/v1/settings/features')).json();}
async function save(value:unknown){return fetch(base+'/api/v1/settings/features',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(value)});}
test('fresh flags fail closed across routes and bookmark redirects without integration IO',async({page})=>{
 expect((await snapshot()).features).toEqual({slack:false,email:false,jira:false});
 for(const feature of ['slack','email','jira']){
  expect((await fetch(base+`/api/v1/${feature}/settings`)).status).toBe(403);
  expect((await fetch(base+`/api/v1/${feature}/read`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).status).toBe(403);
 }
 let terminals=0,integrations=0;page.on('websocket',()=>terminals++);page.on('request',r=>{if(/api\/v1\/(slack|email|jira)\//.test(r.url()))integrations++;});
 await page.goto(base+'/#/slack');await expect(page).toHaveURL(/#\/settings$/);await expect(page.locator('#settings-features')).toBeVisible();await expect(page.locator('#show-slack')).toBeHidden();expect(terminals).toBe(0);expect(integrations).toBe(0);
 expect(statSync(join(dir,'config.features.json')).mode&0o777).toBe(0o600);
});
test('explicit saves reveal workspaces, reject stale revisions and preserve source metadata when disabled',async({page})=>{
 await page.goto(base+'/#/settings');await page.locator('#settings-features-tab').click();
 const old=await snapshot();await page.locator('#feature-slack').check();await expect(page.locator('#show-slack')).toBeHidden();await page.locator('#save-features').click();await expect(page.locator('#features-feedback')).toContainText('Features saved');await expect(page.locator('#show-slack')).toBeVisible();expect((await fetch(base+'/api/v1/slack/settings')).status).toBe(200);
 expect((await save(old)).status).toBe(409);
 const metadata=JSON.stringify({source:null,fixture:'retained'});writeFileSync(join(dir,'config.slack.json'),metadata);
 await page.locator('#feature-slack').uncheck();await page.locator('#save-features').click();await expect(page.locator('#show-slack')).toBeHidden();expect((await fetch(base+'/api/v1/slack/settings')).status).toBe(403);expect(readFileSync(join(dir,'config.slack.json'),'utf8')).toBe(metadata);
 expect(JSON.parse(readFileSync(join(dir,'config.features.json'),'utf8')).features.slack).toBe(false);
 await page.locator('#settings-machines-tab').click();await expect(page.locator('#machine-form')).toBeVisible();
});
test('phone settings fit portrait and landscape and never open a terminal',async({browser})=>{
 const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});let sockets=0;page.on('websocket',()=>sockets++);
 await page.goto(base+'/#/settings');await page.locator('#settings-features-tab').click();await expect(page.locator('#settings-features')).toBeVisible();await page.screenshot({path:'../test-results/settings-phone.png'});
 for(const viewport of [{width:393,height:852},{width:852,height:393}]){await page.setViewportSize(viewport);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);const area=page.locator('#settings-pane');await expect.poll(async()=>(await area.boundingBox())!.height).toBeLessThanOrEqual(viewport.height);await area.evaluate(el=>el.scrollTop=el.scrollHeight);await expect(page.locator('#save-features')).toBeInViewport();}
 expect(sockets).toBe(0);await page.close();
});

test('shared changes redirect an open integration and preserve conflicting feature drafts',async({browser})=>{
 const first=await browser.newPage(),second=await browser.newPage();
 await first.goto(base+'/#/settings');await first.locator('#settings-features-tab').click();
 await first.locator('#feature-slack').check();await first.locator('#save-features').click();await expect(first.locator('#show-slack')).toBeVisible();
 await second.goto(base+'/#/slack');await expect(second.locator('#slack-pane')).toBeVisible();
 await first.locator('#feature-slack').uncheck();await first.locator('#save-features').click();await expect(first.locator('#show-slack')).toBeHidden();
 await expect(second).toHaveURL(/#\/settings$/,{timeout:15000});await expect(second.locator('#settings-features')).toBeVisible();
 await first.locator('#feature-email').check();const current=await snapshot();await save({...current,features:{slack:false,email:false,jira:true}});
 await first.locator('#settings-machines-tab').click({trial:true});await first.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await expect(first.locator('#features-feedback')).toContainText('changed elsewhere');await expect(first.locator('#feature-email')).toBeChecked();await expect(first.locator('#save-features')).toBeDisabled();
 await first.close();await second.close();
});

test('disabled bookmarks respect an unsaved machine draft',async({page})=>{
 const current=await snapshot();await save({...current,features:{slack:false,email:false,jira:false}});
 await page.goto(base+'/#/settings');await page.locator('#machine-name').fill('Keep this draft');
 page.once('dialog',dialog=>dialog.dismiss());await page.evaluate(()=>location.hash='#/slack');
 await expect(page).toHaveURL(/#\/settings$/);await expect(page.locator('#settings-machines')).toBeVisible();await expect(page.locator('#machine-name')).toHaveValue('Keep this draft');
});
