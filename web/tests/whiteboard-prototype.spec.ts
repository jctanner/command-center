import {test,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
let dir:string,base:string,backend:ChildProcess;
test.beforeAll(async()=>{dir=mkdtempSync(join(tmpdir(),'cc-background-'));const config=join(dir,'config.toml');writeFileSync(config,'hosts = []\n');const s=createServer();const port=await new Promise<number>(r=>s.listen(0,'127.0.0.1',()=>r((s.address() as {port:number}).port)));await new Promise<void>(r=>s.close(()=>r()));base=`http://127.0.0.1:${port}`;backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',base.slice(7),'--config',config,'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{stdio:'ignore'});await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status}catch{return 0}}).toBe(200);});
test.afterAll(async()=>{if(backend&&backend.exitCode===null){const exit=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exit;}if(dir)rmSync(dir,{recursive:true,force:true});});


const state=async(page:any)=>page.evaluate(()=>JSON.parse(localStorage.getItem('cc.whiteboard-prototype.v1')!).items);
async function drag(page:any,x:number,y:number,dx:number,dy:number){await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();}

test('lightweight sketch editing, bound arrows, undo, local persistence and exports',async({page})=>{
 const errors:string[]=[],api:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/'))api.push(r.url());});
 await page.goto(base+'/whiteboard-prototype.html');await expect(page.locator('[data-element-id]')).toHaveCount(10);await page.screenshot({path:'../test-results/whiteboard-prototype-desktop.png'});
 const initial=await state(page),human=initial.find((s:any)=>s.text==='Human'),bound=page.locator(`[data-kind=arrow][data-from="${human.id}"] path`).first(),oldArrow=await bound.getAttribute('d'),node=page.locator(`[data-element-id="${human.id}"]`),box=(await node.boundingBox())!;
 await drag(page,box.x+box.width/2,box.y+box.height/2,65,25);await expect.poll(async()=>(await state(page)).find((s:any)=>s.id===human.id).x).toBeGreaterThan(human.x+20);
 await expect(bound).not.toHaveAttribute('d',oldArrow!);await expect(page.locator('[data-handle]')).toHaveCount(4);const moved=(await state(page)).find((s:any)=>s.id===human.id);const arrow=page.locator(`[data-kind=arrow][data-from="${human.id}"]`);await expect(arrow).toHaveCount(1);
 const handle=(await page.locator('[data-handle=se]').boundingBox())!;await drag(page,handle.x+5,handle.y+5,35,22);await expect.poll(async()=>(await state(page)).find((s:any)=>s.id===human.id).w).toBeGreaterThan(human.w);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await state(page)).find((s:any)=>s.id===human.id).w).toBe(human.w);
 await page.getByRole('button',{name:'Undo',exact:true}).click();expect((await state(page)).find((s:any)=>s.id===human.id).x).toBe(human.x);
 await page.getByRole('button',{name:'Redo',exact:true}).click();expect((await state(page)).find((s:any)=>s.id===human.id).x).toBe(moved.x);
 await node.dblclick();await page.getByRole('textbox',{name:'Edit canvas text'}).fill('<img src=x onerror=alert(1)>');await page.getByRole('textbox',{name:'Edit canvas text'}).press('Enter');await expect(node).toContainText('<img');await expect(page.locator('svg img')).toHaveCount(0);
 const sourceBox=(await node.boundingBox())!,targetNode=page.locator(`[data-element-id="${initial.find((s:any)=>s.text==='Rust backend').id}"]`),targetBox=(await targetNode.boundingBox())!;
 await page.getByRole('button',{name:'Arrow',exact:true}).click();await drag(page,sourceBox.x+sourceBox.width/2,sourceBox.y+sourceBox.height/2,targetBox.x+targetBox.width/2-sourceBox.x-sourceBox.width/2,targetBox.y+targetBox.height/2-sourceBox.y-sourceBox.height/2);
 const newArrow=(await state(page)).at(-1);expect(newArrow.from).toBe(human.id);expect(newArrow.to).toBe(initial.find((s:any)=>s.text==='Rust backend').id);
 await page.getByRole('button',{name:'Undo',exact:true}).click();
 await page.getByRole('button',{name:'Sticky note',exact:true}).click();const stage=(await page.locator('#wb-canvas').boundingBox())!;await page.mouse.click(stage.x+stage.width*.6,stage.y+stage.height*.7);await expect.poll(async()=>(await state(page)).length).toBe(11);
 await page.getByRole('button',{name:'Agent view ↗',exact:true}).click();await page.getByRole('button',{name:'Add example agent flow',exact:true}).click();await expect(page.getByLabel('Scene description')).toContainText('Coordinator (demo)');await expect.poll(async()=>(await state(page)).length).toBe(16);
 await page.reload();await expect(page.locator('[data-element-id]')).toHaveCount(16);await expect(page.locator('#wb-save')).toContainText('Saved only in this browser');
 await page.getByRole('button',{name:'Export',exact:true}).click();for(const type of ['SVG','PNG','JSON']){const pending=page.waitForEvent('download');await page.getByRole('button',{name:`Download ${type}`,exact:true}).click();const download=await pending;expect(download.suggestedFilename()).toMatch(new RegExp('\\.'+type.toLowerCase()+'$'));expect(await download.failure()).toBeNull();}
 expect(api).toEqual([]);expect(errors).toEqual([]);
});

test('mobile touch drawing and pinch leave CC and tmux untouched',async({browser})=>{
 const context=await browser.newContext({viewport:{width:393,height:852},hasTouch:true,isMobile:true});const page=await context.newPage();const api:string[]=[],sockets:string[]=[],errors:string[]=[];page.on('request',r=>{if(r.url().includes('/api/'))api.push(r.url());});page.on('websocket',s=>sockets.push(s.url()));page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/whiteboard-prototype.html');await expect(page.locator('[data-element-id]')).toHaveCount(10);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.locator('#wb-inspector')).not.toHaveAttribute('open');
 await page.getByRole('button',{name:'Rectangle',exact:true}).tap();const r=(await page.locator('#wb-canvas').boundingBox())!,cdp=await context.newCDPSession(page);
 const touch=async(type:string,points:any[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
 const a={x:r.x+90,y:r.y+220,id:1},b={x:r.x+230,y:r.y+320,id:1};await touch('touchStart',[a]);await touch('touchMove',[b]);await touch('touchEnd',[]);await expect.poll(async()=>(await state(page)).length).toBe(11);
 const before=await page.locator('#wb-world').getAttribute('transform');await touch('touchStart',[{x:r.x+110,y:r.y+260,id:1},{x:r.x+230,y:r.y+260,id:2}]);await touch('touchMove',[{x:r.x+70,y:r.y+260,id:1},{x:r.x+270,y:r.y+260,id:2}]);await touch('touchEnd',[]);await expect(page.locator('#wb-world')).not.toHaveAttribute('transform',before!);expect((await state(page)).length).toBe(11);
 await page.getByRole('button',{name:'Zoom out',exact:true}).tap();await page.getByLabel('Color scheme',{exact:true}).selectOption('catppuccin-latte');await expect(page.locator('html')).toHaveAttribute('data-theme','catppuccin-latte');await page.screenshot({path:'../test-results/whiteboard-prototype-mobile.png'});
 expect(api).toEqual([]);expect(sockets).toEqual([]);expect(errors).toEqual([]);await context.close();
});
