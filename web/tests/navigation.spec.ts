import {test,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn,spawnSync,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
let dir:string,socket:string,base:string,backend:ChildProcess;
function tmux(...args:string[]){const r=spawnSync('tmux',['-S',socket,...args],{encoding:'utf8',env:{...process.env,TMUX:''}});if(r.status)throw Error(r.stderr);return r.stdout.trim();}
const ids={terminal:'show-terminal',files:'toggle-files',queue:'show-queue',slack:'show-slack',email:'show-email',board:'show-board'};
const panes={terminal:'terminal-pane',files:'files-pane',queue:'queue-pane',slack:'slack-pane',email:'email-pane',board:'board-pane'};
test.beforeAll(async()=>{dir=mkdtempSync(join(tmpdir(),'cc-navigation-'));socket=join(dir,'tmux.sock');writeFileSync(join(dir,'README.md'),'# Navigation fixture\n');tmux('-f','/dev/null','new-session','-d','-s','navigation','-c',dir,'-x','120','-y','35');writeFileSync(join(dir,'config.toml'),`[[hosts]]\nid="test"\nname="Navigation fixture"\nsocket=${JSON.stringify(socket)}\n[[hosts.projects]]\npath=${JSON.stringify(dir)}\nname="Navigation fixture"\n`);const p=await new Promise<number>(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>r(p));});});base=`http://127.0.0.1:${p}`;backend=spawn(resolve(process.env.CC_BINARY||'../target/debug/command-center'),['--listen',`127.0.0.1:${p}`,'--config',join(dir,'config.toml'),'--web-dir',resolve(process.env.CC_WEB_DIR||'dist')],{stdio:'pipe'});await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status;}catch{return 0;}}).toBe(200);});
test.afterAll(()=>{backend?.kill('SIGTERM');if(socket)spawnSync('tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});
test('workspace bookmarks and reloads restore the tab before any terminal attachment',async({browser})=>{
 for(const workspace of ['files','queue','slack','email','board'] as const){const page=await browser.newPage();let sockets=0;page.on('websocket',w=>{if(w.url().includes('/terminal?'))sockets++;});await page.addInitScript(path=>{localStorage.setItem('cc.files.host','test');localStorage.setItem('cc.files.locations',JSON.stringify({test:path}));},dir);for(let i=0;i<2;i++){const inventory=page.waitForResponse(r=>r.url().includes('/inventory'));if(i===0)await page.goto(base+'/#/'+workspace);else await page.reload();await expect(page.locator('#'+ids[workspace])).toHaveAttribute('aria-pressed','true');await expect(page.locator('#'+panes[workspace])).toBeVisible();await expect(page.locator('#terminal-pane')).toBeHidden();await inventory;await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));expect(sockets).toBe(0);if(workspace==='files')await expect(page.locator('#browser-machine')).toHaveValue('test');}await page.close();}
});
test('Back and Forward restore workspace tabs and preserve an unsaved file draft without duplicate history',async({page})=>{
 await page.addInitScript(path=>{localStorage.setItem('cc.files.host','test');localStorage.setItem('cc.files.locations',JSON.stringify({test:path}));},dir);await page.goto(base+'/#/files');await expect(page.locator('#browser-machine')).toHaveValue('test');await page.locator('#directory-tree').getByRole('button',{name:'README.md',exact:true}).click();const editor=page.locator('#code-editor .cm-content');await editor.click();await editor.press('Control+a');await page.keyboard.insertText('# Unsaved routing draft\n');await page.locator('#show-board').click();await expect(page).toHaveURL(/#\/board$/);await page.locator('#show-queue').click();await expect(page).toHaveURL(/#\/queue$/);const length=await page.evaluate(()=>history.length);await page.locator('#show-queue').click();await page.locator('#show-queue').click();expect(await page.evaluate(()=>history.length)).toBe(length);await page.goBack();await expect(page.locator('#board-pane')).toBeVisible();await expect(page).toHaveURL(/#\/board$/);await page.goBack();await expect(page.locator('#files-pane')).toBeVisible();await expect(editor).toContainText('Unsaved routing draft');await page.goForward();await expect(page.locator('#board-pane')).toBeVisible();await page.goForward();await expect(page.locator('#queue-pane')).toBeVisible();await page.evaluate(()=>{location.hash='#/email';});await expect(page.locator('#email-pane')).toBeVisible();await page.goBack();await expect(page.locator('#queue-pane')).toBeVisible();
});
test('compact bookmarked routes survive refresh and cannot attach or constrain a desktop terminal',async({browser,page})=>{
 await page.goto(base+'/#/terminal');await expect(page.locator('#connection')).toHaveText('Attached');const before=tmux('list-panes','-a','-F','#{pane_id} #{pane_pid} #{pane_width}x#{pane_height}');const phone=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});let sockets=0;phone.on('websocket',w=>{if(w.url().includes('/terminal?'))sockets++;});for(const workspace of ['queue','board','email','slack','files','terminal']){await phone.goto(base+'/#/'+workspace);const actual=workspace==='terminal'?'queue':workspace;await expect(phone).toHaveURL(new RegExp('#/'+actual+'$'));await expect(phone.locator('#'+ids[actual as keyof typeof ids])).toHaveAttribute('aria-pressed','true');await phone.reload();await expect(phone.locator('#'+panes[actual as keyof typeof panes])).toBeVisible();}expect(sockets).toBe(0);expect(tmux('list-panes','-a','-F','#{pane_id} #{pane_pid} #{pane_width}x#{pane_height}')).toBe(before);await phone.close();
});
test('terminal routing keeps its contextual Files drawer and safely normalizes unknown routes and viewport changes',async({page})=>{
 await page.goto(base);await expect(page).toHaveURL(/#\/terminal$/);await expect(page.locator('#connection')).toHaveText('Attached');await page.locator('#terminal-files').click();await expect(page.locator('#workspace')).toHaveClass(/with-files/);await expect(page).toHaveURL(/#\/terminal$/);await page.locator('#show-board').click();await page.goBack();await expect(page.locator('#workspace')).toHaveClass(/with-files/);await expect(page).toHaveURL(/#\/terminal$/);await page.setViewportSize({width:393,height:852});await expect(page).toHaveURL(/#\/queue$/);await expect(page.locator('#queue-pane')).toBeVisible();await expect(page.locator('#terminal-pane')).toBeHidden();await page.evaluate(()=>{location.hash='#/not-a-workspace';});await expect(page).toHaveURL(/#\/queue$/);await page.setViewportSize({width:1440,height:900});await expect(page.locator('#queue-pane')).toBeVisible();await page.locator('#show-terminal').click();await expect(page).toHaveURL(/#\/terminal$/);await expect(page.locator('#connection')).toHaveText('Attached');
});

test('phone installation manifest launches Agents without changing an attached desktop terminal',async({browser,page})=>{
 await page.goto(base+'/#/terminal');await expect(page.locator('#connection')).toHaveText('Attached');
 const before=tmux('list-panes','-a','-F','#{pane_id} #{pane_pid} #{pane_width}x#{pane_height}');
 const phone=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
 let terminals=0;phone.on('websocket',socket=>{if(socket.url().includes('/terminal?'))terminals++;});
 await phone.goto(base+'/#/queue');
 const manifestLink=phone.locator('link[rel="manifest"]');await expect(manifestLink).toHaveAttribute('href','/manifest.webmanifest');
 const response=await phone.request.get(base+'/manifest.webmanifest');expect(response.ok()).toBe(true);expect(response.headers()['content-type']).toMatch(/json|manifest/);
 const manifest=await response.json();expect(manifest).toMatchObject({id:'/',name:'Command Center',short_name:'CC',start_url:'/#/queue',scope:'/',display:'standalone'});
 expect(manifest.icons.some((icon:{purpose:string})=>icon.purpose==='maskable')).toBe(true);
 for(const icon of [...manifest.icons,{src:'/icons/apple-touch-icon.png',sizes:'180x180'}]){
  const asset=await phone.request.get(base+icon.src);expect(asset.ok()).toBe(true);expect(asset.headers()['content-type']).toContain('image/png');
  const size=await phone.evaluate(async src=>{const image=new Image();image.src=src;await image.decode();return `${image.naturalWidth}x${image.naturalHeight}`;},icon.src);expect(size).toBe(icon.sizes);
 }
 await expect(phone.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content','yes');
 await expect(phone.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href','/icons/apple-touch-icon.png');
 const cdp=await phone.context().newCDPSession(phone);
 const parsed=await cdp.send('Page.getAppManifest');expect(parsed.errors).toEqual([]);expect(parsed.url).toBe(base+'/manifest.webmanifest');
 await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'display-mode',value:'standalone'}]});
 await phone.goto(base+manifest.start_url);await expect(phone.locator('#queue-pane')).toBeVisible();await expect(phone.locator('#show-terminal')).toBeHidden();
 await phone.locator('#show-board').click();await expect(phone.locator('#board-pane')).toBeVisible();await phone.reload();await expect(phone.locator('#board-pane')).toBeVisible();
 await phone.setViewportSize({width:852,height:393});await phone.goto(base+manifest.start_url);await expect(phone.locator('#queue-pane')).toBeVisible();await expect(phone.locator('#show-terminal')).toBeHidden();
 expect(terminals).toBe(0);expect(tmux('list-panes','-a','-F','#{pane_id} #{pane_pid} #{pane_width}x#{pane_height}')).toBe(before);
 await phone.close();
});

test('mobile app reload confirms draft loss, keeps the route, and leaves desktop tmux alone',async({browser,page})=>{
 await page.goto(base+'/#/terminal');await expect(page.locator('#connection')).toHaveText('Attached');
 const before=tmux('list-panes','-a','-F','#{pane_id} #{pane_pid} #{pane_width}x#{pane_height}');
 const phone=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});let terminals=0;
 phone.on('websocket',socket=>{if(socket.url().includes('/terminal?'))terminals++;});
 await phone.goto(base+'/#/board');await expect(phone.locator('#board-pane')).toBeVisible();
 const reload=phone.getByRole('button',{name:'Reload app',exact:true});const bounds=await reload.boundingBox();expect(bounds!.width).toBeGreaterThanOrEqual(44);expect(bounds!.height).toBeGreaterThanOrEqual(44);
 let navigations=0;phone.on('framenavigated',frame=>{if(frame===phone.mainFrame())navigations++;});
 await reload.click();const dialog=phone.getByRole('dialog',{name:'Reload app?'});await expect(dialog).toBeVisible();await expect(dialog).toContainText('unsent drafts');await expect(phone.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
 await phone.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).not.toBeVisible();expect(navigations).toBe(0);
 await reload.click();await phone.keyboard.press('Escape');await expect(dialog).not.toBeVisible();expect(navigations).toBe(0);
 await reload.click();await Promise.all([phone.waitForEvent('load'),phone.getByRole('button',{name:'Reload now',exact:true}).click()]);
 await expect(phone).toHaveURL(/#\/board$/);await expect(phone.locator('#board-pane')).toBeVisible();expect(navigations).toBe(1);expect(terminals).toBe(0);
 expect(tmux('list-panes','-a','-F','#{pane_id} #{pane_pid} #{pane_width}x#{pane_height}')).toBe(before);await phone.close();
});

test('cancelling app reload preserves an unsaved file draft in another workspace',async({page})=>{
 await page.addInitScript(path=>{localStorage.setItem('cc.files.host','test');localStorage.setItem('cc.files.locations',JSON.stringify({test:path}));},dir);
 await page.goto(base+'/#/files');await page.locator('#directory-tree').getByRole('button',{name:'README.md',exact:true}).click();const editor=page.locator('#code-editor .cm-content');await editor.click();await editor.press('Control+a');await page.keyboard.insertText('# Keep this unsaved reload draft\n');
 await page.locator('#show-queue').click();await page.getByRole('button',{name:'Reload app',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();
 await page.locator('#toggle-files').click();await expect(editor).toContainText('Keep this unsaved reload draft');
});
