import {test,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';import {randomUUID} from 'node:crypto';
let dir:string,base:string,backend:ChildProcess;const tickets:any[]=[];
async function api(path:string,body?:unknown){const response=await fetch(base+'/api/v1/'+path,body?{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)}:{});expect(response.ok).toBe(true);return response.json();}
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-ticket-layout-'));const port=await new Promise<number>(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>r(p));});});base=`http://127.0.0.1:${port}`;
 writeFileSync(join(dir,'config.toml'),`[[hosts]]\nid="fixture"\nname="Fixture workstation"\nsocket=${JSON.stringify(join(dir,'unused-tmux.sock'))}\n`);
 backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',`127.0.0.1:${port}`,'--config',join(dir,'config.toml'),'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{stdio:'pipe'});
 await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status;}catch{return 0;}}).toBe(200);
 const host=(await api('hosts'))[0];
 for(let i=0;i<26;i++)tickets.push(await api('board/tickets',{id:randomUUID(),title:`Fixture ${String(i+1).padStart(2,'0')}: ${['Improve runtime event handling','Review shared ownership and next steps','Validate cross-machine workflow','Resolve the upstream review feedback','Document remaining implementation work'][i%5]}`,description:`## Intent\n\nMake the workflow easy to understand and validate. This ticket records intent, completed findings, and future work.\n\n## Completed findings\n\n- Reviewed current behavior.\n- Identified the remaining validation.\n\n## Next steps\n\n1. Implement the reviewed change.\n2. Run focused validation.\n\n### Execution evidence\n\nPID: 12345 (synthetic). Directory: /workspace/synthetic/project.\n\n${'Additional review context and supporting evidence. '.repeat(18)}`,status:['backlog','ready','in_progress','blocked','done'][i%5],priority:i%4===0?'high':'normal',context:{host:'fixture',endpoint:null,path:'/workspace/synthetic/project/with/a/long/location',session:'$0',session_name:'development',window:'@1',window_number:4,window_name:'project',pane:'%2',provider:i%2?'pi':'codex',model:'model-fixture',conversation:'synthetic-session'},host_revision:host.connection_revision,checklist:[{id:'review',text:'Confirm validation and remaining work',done:false}]}));
});
test.afterAll(()=>{backend?.kill('SIGTERM');if(dir)rmSync(dir,{recursive:true,force:true});});

test('compact cards, sortable list, spacious details and safe sequential ticket browsing',async({page})=>{
 let sockets=0;page.on('websocket',()=>sockets++);await page.goto(base+'/#/board');await expect(page.locator('.ticket-card')).toHaveCount(26);
 await expect(page.locator('.ticket-card select')).toHaveCount(0);expect((await page.locator('.ticket-card').allTextContents()).join(' ')).not.toContain('/workspace/synthetic');
 expect(await page.locator('.ticket-card').first().evaluate(el=>el.getBoundingClientRect().height)).toBeLessThan(160);
 await page.screenshot({path:'../test-results/tickets-board-after.png'});
 await page.getByRole('button',{name:'List view',exact:true}).click();await expect(page.getByRole('table',{name:'Tickets',exact:true})).toBeVisible();await expect(page.locator('.ticket-table tbody tr')).toHaveCount(26);
 await page.getByLabel('Sort tickets',{exact:true}).selectOption('number');await expect(page.locator('.ticket-table tbody tr').first()).toContainText('CC-1');await page.screenshot({path:'../test-results/tickets-list-after.png'});
 await page.getByLabel('Board column',{exact:true}).selectOption('blocked');await expect(page.locator('.ticket-table tbody tr')).toHaveCount(5);await page.getByLabel('Filter tickets',{exact:true}).fill('Fixture 04');await expect(page.locator('.ticket-table tbody tr')).toHaveCount(1);
 await page.getByLabel('Filter tickets',{exact:true}).fill('');await page.getByLabel('Board column',{exact:true}).selectOption('');
 await page.locator('.ticket-list-title').first().click();const dialog=page.getByRole('dialog',{name:'Ticket',exact:true});await expect(dialog).toBeVisible();const bounds=await dialog.boundingBox();expect(bounds!.width).toBeGreaterThan(1440*.9);expect(bounds!.height).toBeGreaterThan(900*.9);
 await expect(dialog.locator('.ticket-markdown h2').first()).toHaveText('Intent');await expect(dialog.getByLabel('Ticket Markdown description',{exact:true})).toBeHidden();await expect(dialog.getByLabel('Directory',{exact:true})).toHaveValue('/workspace/synthetic/project/with/a/long/location');
 await expect(dialog.getByRole('button',{name:'Previous ticket',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Next ticket',exact:true}).click();await expect(dialog.getByLabel('Ticket title',{exact:true})).toHaveValue(tickets[1].title);
 const edited='Keep this unsaved draft';await dialog.getByLabel('Ticket title',{exact:true}).fill(edited);page.once('dialog',d=>d.dismiss());await dialog.getByRole('button',{name:'Next ticket',exact:true}).click();await expect(dialog.getByLabel('Ticket title',{exact:true})).toHaveValue(edited);
 page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Next ticket',exact:true}).click();await expect(dialog.getByLabel('Ticket title',{exact:true})).toHaveValue(tickets[2].title);expect((await api('board/tickets/'+tickets[1].id)).title).toBe(tickets[1].title);
 await dialog.getByRole('button',{name:'Edit Markdown',exact:true}).click();await expect(dialog.getByLabel('Ticket Markdown description',{exact:true})).toBeVisible();await dialog.getByRole('button',{name:'Preview Markdown',exact:true}).click();await expect(dialog.locator('.ticket-markdown h2').first()).toHaveText('Intent');await page.screenshot({path:'../test-results/ticket-detail-after.png'});
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.reload();await expect(page.getByRole('button',{name:'List view',exact:true})).toHaveAttribute('aria-pressed','true');expect(sockets).toBe(0);
});

test('phone list and full-screen detail scroll naturally and keep terminal traffic absent',async({browser})=>{
 const page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});let sockets=0;page.on('websocket',()=>sockets++);
 try{
  await page.goto(base+'/#/board');await page.getByRole('button',{name:'List view',exact:true}).click();await expect(page.locator('.ticket-table tbody tr')).toHaveCount(26);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect((await page.getByLabel('Board column',{exact:true}).boundingBox())!.width).toBeGreaterThan(150);expect((await page.getByLabel('Sort tickets',{exact:true}).boundingBox())!.width).toBeGreaterThan(150);await page.screenshot({path:'../test-results/tickets-list-phone.png'});
  await page.locator('.ticket-list-title').first().click();const dialog=page.getByRole('dialog',{name:'Ticket',exact:true});const box=await dialog.boundingBox();expect(box!.width).toBe(393);expect(box!.height).toBe(852);
  const layout=dialog.locator('.ticket-detail-layout');expect(await layout.evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);await layout.evaluate(el=>{el.scrollTop=150;});expect(await layout.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);await layout.evaluate(el=>{el.scrollTop=0;});await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeInViewport();await page.screenshot({path:'../test-results/ticket-detail-phone.png'});
  await page.setViewportSize({width:852,height:393});await expect(dialog).toBeVisible();expect(await dialog.evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true);await expect(dialog.getByRole('button',{name:'Close',exact:true})).toBeInViewport();expect(sockets).toBe(0);
 }finally{await page.close();}
});

test('editing a draft while the next ticket loads cannot discard the newer draft',async({page})=>{
 await page.goto(base+'/#/board');await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByLabel('Sort tickets',{exact:true}).selectOption('number');await page.locator('.ticket-list-title').first().click();const dialog=page.getByRole('dialog',{name:'Ticket',exact:true});
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 await page.route('**/board/tickets/'+tickets[1].id,async route=>{await gate;await route.continue();});
 const requested=page.waitForRequest(r=>r.url().endsWith('/board/tickets/'+tickets[1].id));await dialog.getByRole('button',{name:'Next ticket',exact:true}).click();await requested;
 await dialog.getByLabel('Ticket title',{exact:true}).fill('New edit while waiting');const returned=page.waitForResponse(r=>r.url().endsWith('/board/tickets/'+tickets[1].id));release();await returned;
 await expect(dialog.getByLabel('Ticket title',{exact:true})).toHaveValue('New edit while waiting');expect((await api('board/tickets/'+tickets[0].id)).title).toBe(tickets[0].title);
});

test('saving a ticket outside the active filter updates browsing controls without closing detail',async({page})=>{
 await page.goto(base+'/#/board');await page.getByRole('button',{name:'List view',exact:true}).click();await page.getByLabel('Board column',{exact:true}).selectOption('backlog');await page.getByLabel('Sort tickets',{exact:true}).selectOption('number');await page.locator('.ticket-list-title').first().click();const dialog=page.getByRole('dialog',{name:'Ticket',exact:true});
 await dialog.getByLabel('Ticket status',{exact:true}).selectOption('done');await dialog.getByRole('button',{name:'Save ticket',exact:true}).click();await expect(dialog).toContainText('Saved');await expect(dialog.locator('.ticket-detail-position')).toHaveText('Outside filters');await expect(dialog.getByRole('button',{name:'Next ticket',exact:true})).toBeDisabled();await expect(dialog.getByRole('button',{name:'Previous ticket',exact:true})).toBeDisabled();await expect(dialog.getByLabel('Ticket title',{exact:true})).toHaveValue(tickets[0].title);
});

test('late machine discovery replaces opaque Board IDs with display names',async({page})=>{
 let release!:()=>void;const ready=new Promise<void>(r=>{release=r;});
 await page.route('**/api/v1/hosts',async route=>{await ready;await route.continue();});
 try{
  await page.goto(base+'/#/board');const footer=page.locator('.ticket-card-footer').first();await expect(footer).toContainText('fixture');release();await expect(footer).toContainText('Fixture workstation');
 }finally{release();}
});
