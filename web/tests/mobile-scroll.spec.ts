import {enableFeatures} from './feature-fixture';
import {test,expect,type Page,type Locator} from '@playwright/test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
let dir:string,base:string,backend:ChildProcess;
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-mobile-scroll-'));const server=createServer();const port=await new Promise<number>(r=>server.listen(0,'127.0.0.1',()=>r((server.address() as {port:number}).port)));await new Promise<void>(r=>server.close(()=>r()));base=`http://127.0.0.1:${port}`;
 writeFileSync(join(dir,'config'),`[[hosts]]\nid="local"\nname="Scroll fixture"\nsocket=${JSON.stringify(join(dir,'unused.sock'))}\n`);
 backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',`127.0.0.1:${port}`,'--config',join(dir,'config'),'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{stdio:'pipe'});
 await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status;}catch{return 0;}}).toBe(200);await enableFeatures(base);
});
test.afterAll(()=>{backend?.kill('SIGTERM');if(dir)rmSync(dir,{recursive:true,force:true});});
async function swipe(page:Page,area:Locator,up:boolean){
 const box=(await area.boundingBox())!;const viewport=page.viewportSize()!;const top=Math.max(box.y,0)+25,bottom=Math.min(box.y+box.height,viewport.height)-25;
 const start=up?bottom:top,end=up?top:bottom,x=box.x+box.width*.55;
 const session=await page.context().newCDPSession(page);
 await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:start,id:0}]});
 for(let i=1;i<=10;i++){
  await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:start+(end-start)*i/10,id:0}]});await page.waitForTimeout(20);
 }
 await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await session.detach();await page.waitForTimeout(250);
}
async function checkScroll(page:Page,selector:string){
 const area=page.locator(selector);await expect(area).toBeVisible();
 expect(await area.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeGreaterThan(100);
 const box=(await area.boundingBox())!;expect(box.y+box.height).toBeLessThanOrEqual(page.viewportSize()!.height+1);
 const before=await area.evaluate(el=>el.scrollTop);await swipe(page,area,true);await expect.poll(()=>area.evaluate(el=>el.scrollTop)).toBeGreaterThan(before+40);
 const moved=await area.evaluate(el=>el.scrollTop);await swipe(page,area,false);await expect.poll(()=>area.evaluate(el=>el.scrollTop)).toBeLessThan(moved-40);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
}

test('mobile Board accepts upward and downward swipes inside cards',async({browser})=>{
 const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});let terminalSockets=0;page.on('websocket',socket=>{if(socket.url().includes('/terminal?'))terminalSockets++;});
 await page.route('**/api/v1/board/tickets',route=>route.fulfill({json:{tickets:Array.from({length:35},(_,i)=>({id:`ticket-${i}`,number:i+1,revision:'fixture',title:`Swipe ticket ${i}`,status:'backlog',priority:'normal',context:{host:'',path:'/fixture/project',provider:'',session:'',window:'',pane:''},checks:0,checked:0,updated_at:0}))}}));
 await page.route('**/api/v1/board/activity',route=>route.fulfill({json:{items:{}}}));
 await page.goto(base+'/#/board');await expect(page.locator('.ticket-card')).toHaveCount(35);await checkScroll(page,'.board-lanes');
 await page.screenshot({path:'../test-results/board-mobile-swipe.png'});expect(terminalSockets).toBe(0);await page.close();
});

test('mobile Email inbox and long threads accept upward and downward swipes',async({browser})=>{
 const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});let terminalSockets=0;page.on('websocket',socket=>{if(socket.url().includes('/terminal?'))terminalSockets++;});
 const host=(await(await fetch(base+'/api/v1/hosts')).json())[0];
 const messages=Array.from({length:35},(_,i)=>({id:`message-${i}`,thread_id:`thread-${i}`,subject:`Swipe email ${i}`,from:'Fixture sender',to:'Fixture recipient',date:'Today',snippet:'A message to exercise the scroll viewport.',unread:true}));
 await page.route('**/api/v1/email/settings',route=>route.fulfill({json:{revision:'fixture',connection_revision:host.connection_revision,source:{host:'local',project:'/fixture'}}}));
 await page.route('**/api/v1/email/read',route=>{const request=route.request().postDataJSON();return route.fulfill({json:request.operation==='labels'?{labels:[{id:'INBOX',name:'Inbox'}],checked_at:Date.now()}:request.operation==='thread'?{messages:[{...messages[0],body:Array.from({length:120},(_,i)=>`Line ${i}: long thread content for scrolling.`).join('\n')}],checked_at:Date.now()}:{messages,checked_at:Date.now()}});});
 await page.goto(base+'/#/email');await expect(page.locator('.email-message')).toHaveCount(35);await checkScroll(page,'.email-list');
 await page.locator('.email-message').first().click();await expect(page.locator('.email-reader')).toContainText('Line 119');await checkScroll(page,'.email-reader');
 await page.screenshot({path:'../test-results/email-mobile-swipe.png'});expect(terminalSockets).toBe(0);await page.close();
});
