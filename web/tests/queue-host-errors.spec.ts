import {test,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
let dir:string,base:string,backend:ChildProcess;
test.beforeAll(async()=>{dir=mkdtempSync(join(tmpdir(),'cc-background-'));const config=join(dir,'config.toml');writeFileSync(config,'hosts = []\n');const s=createServer();const port=await new Promise<number>(r=>s.listen(0,'127.0.0.1',()=>r((s.address() as {port:number}).port)));await new Promise<void>(r=>s.close(()=>r()));base=`http://127.0.0.1:${port}`;backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',base.slice(7),'--config',config,'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{stdio:'ignore'});await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status}catch{return 0}}).toBe(200);});
test.afterAll(async()=>{if(backend&&backend.exitCode===null){const exit=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exit;}if(dir)rmSync(dir,{recursive:true,force:true});});


for(const width of [1440,393])test(`host failures stay compact and recover at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:850});let recovered=false,sockets=0;const writes:string[]=[];
 const warning='WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!\nHost key verification failed.\n<img src=x onerror=alert(1)>\n'+'Diagnostic detail\n'.repeat(50);
 page.on('websocket',()=>sockets++);page.on('request',r=>{if(r.method()!=='GET')writes.push(r.url());});
 await page.route('**/api/v1/queue',r=>r.fulfill({json:{checked_at:Date.now()/1000,hosts:[{id:'alternate',name:'Dual boot fixture',connection_revision:'same-endpoint',limited:false,error:recovered?null:warning,items:[]},{id:'healthy',name:'Healthy fixture',connection_revision:'healthy',limited:false,items:[]}]}}));
 await page.goto(base+'/#/queue');const issues=page.locator('.queue-host-issues');
 await expect(issues).toBeVisible();await expect(issues.locator('summary')).toHaveText('1 machine unavailable or limited');await expect(issues).not.toHaveAttribute('open');
 await expect(page.locator('#queue-pane > p[role=status]')).not.toContainText('WARNING');expect((await issues.boundingBox())!.height).toBeLessThan(40);
 await issues.locator('summary').click();await expect(issues).toContainText('SSH identity not verified');await expect(issues).toContainText('dual-boot');await expect(issues.locator('pre')).toHaveText(warning);await expect(issues.locator('img')).toHaveCount(0);
 if(width===393)await page.locator('.queue-filter-panel > summary').click();
 await page.getByRole('button',{name:'Refresh queue',exact:true}).click();await expect(issues).toHaveAttribute('open','');
 recovered=true;await page.getByRole('button',{name:'Refresh queue',exact:true}).click();await expect(issues).toBeHidden();await expect(issues).not.toHaveAttribute('open');expect(writes).toEqual([]);expect(sockets).toBe(0);
});
