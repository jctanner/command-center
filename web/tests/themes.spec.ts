import {test,expect,type Page} from '@playwright/test';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
let dir:string,socket:string,base:string,backend:ChildProcess;
const catalog=JSON.parse(readFileSync(resolve('src/theme-palettes.json'),'utf8')).themes as {id:string;name:string;colors:{background:string;mode:string}}[];
function tm(...args:string[]){const r=spawnSync('tmux',['-S',socket,...args],{encoding:'utf8',env:{...process.env,TMUX:''}});if(r.status)throw Error(r.stderr);return r.stdout.trim();}
function panes(){return tm('list-panes','-a','-F','#{pane_id} #{pane_pid} #{pane_width}x#{pane_height}');}
async function appearance(page:Page){await page.locator('#open-settings').click();await page.locator('#settings-appearance-tab').click();await expect(page.locator('#theme-select')).toBeVisible();}
async function background(page:Page){return page.locator('html').evaluate(el=>getComputedStyle(el).backgroundColor);}
const rgb=(hex:string)=>`rgb(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join(', ')})`;
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-themes-'));socket=join(dir,'tmux.sock');writeFileSync(join(dir,'main.ts'),'const greeting = "hello";\n');writeFileSync(join(dir,'other.ts'),'const second = 2;\n');
 tm('-f','/dev/null','new-session','-d','-s','themes','-c',dir,'-x','120','-y','35','/bin/sh','-c',"printf '\\033[31mRed \\033[32mGreen \\033[34mBlue\\033[0m Theme fixture\\n'; exec sleep 86400");
 const server=createServer();const port=await new Promise<number>(r=>server.listen(0,'127.0.0.1',()=>r((server.address() as {port:number}).port)));await new Promise<void>(r=>server.close(()=>r()));base=`http://127.0.0.1:${port}`;
 writeFileSync(join(dir,'config.toml'),`[[hosts]]\nid="test"\nname="Theme fixture"\nsocket=${JSON.stringify(socket)}\n[[hosts.projects]]\npath=${JSON.stringify(dir)}\nname="Theme fixture"\n`);
 backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',`127.0.0.1:${port}`,'--config',join(dir,'config.toml'),'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{stdio:'pipe'});
 await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status;}catch{return 0;}}).toBe(200);
});
test.afterAll(()=>{backend?.kill('SIGTERM');if(socket)spawnSync('tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});
test('all pinned palettes switch locally with readable text, persistence and cross-tab synchronization',async({page,context})=>{
 await page.goto(base+'/#/settings');await page.locator('#settings-appearance-tab').click();expect(catalog).toHaveLength(24);await expect(page.locator('#theme-select option')).toHaveCount(catalog.length);
 let mutations=0;page.on('request',r=>{if(r.url().includes('/api/')&&r.method()!=='GET')mutations++;});
 for(const theme of catalog){await page.locator('#theme-select').selectOption(theme.id);await expect(page.locator('html')).toHaveAttribute('data-theme',theme.id);expect(await background(page)).toBe(rgb(theme.colors.background));
  const ratios=await page.locator('#settings-appearance').evaluate(panel=>{const style=getComputedStyle(panel);const parse=(value:string)=>value.match(/[\d.]+/g)!.slice(0,3).map(Number);const lum=(color:number[])=>color.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);const bg=lum(parse(style.backgroundColor));return [...panel.querySelectorAll('p,label')].map(el=>{const fg=lum(parse(getComputedStyle(el).color));return(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);});});
  expect(Math.min(...ratios),theme.id).toBeGreaterThanOrEqual(4.49);
 }
 await page.locator('#theme-select').selectOption('tokyo-night');await page.screenshot({path:'../test-results/theme-tokyo-night-desktop.png'});
 const peer=await context.newPage();await peer.goto(base+'/#/settings');await expect(peer.locator('html')).toHaveAttribute('data-theme','tokyo-night');await peer.locator('#settings-appearance-tab').click();await expect(peer.locator('#theme-select')).toHaveValue('tokyo-night');
 await page.locator('#theme-select').selectOption('flexoki-light');await expect(peer.locator('#theme-select')).toHaveValue('flexoki-light');await page.screenshot({path:'../test-results/theme-flexoki-light-desktop.png'});await peer.close();
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','flexoki-light');expect(mutations).toBe(0);
});
test('saved palette applies before the main application and invalid/blocked storage falls back safely',async({browser})=>{
 const page=await browser.newPage();await page.addInitScript(()=>localStorage.setItem('cc.theme','catppuccin-latte'));
 let release!:()=>void;const held=new Promise<void>(r=>release=r);await page.route('**/assets/index-*.js',async route=>{await held;await route.continue();});
 await page.goto(base+'/#/settings',{waitUntil:'commit'});await expect(page.locator('html')).toHaveAttribute('data-theme','catppuccin-latte');await expect.poll(()=>background(page)).toBe(rgb(catalog.find(t=>t.id==='catppuccin-latte')!.colors.background));release();await page.waitForLoadState('load');await page.close();
 const invalid=await browser.newPage();await invalid.addInitScript(()=>localStorage.setItem('cc.theme','not-a-real-palette'));await invalid.goto(base+'/#/settings');await expect(invalid.locator('html')).toHaveAttribute('data-theme','command-center');await invalid.close();
 const blocked=await browser.newPage();await blocked.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage blocked','SecurityError');}}));await blocked.goto(base+'/#/settings');await blocked.locator('#settings-appearance-tab').click();await blocked.locator('#theme-select').selectOption('nord');await expect(blocked.locator('html')).toHaveAttribute('data-theme','nord');await blocked.close();
});
test('theme changes preserve active and inactive file drafts, language highlighting and undo',async({page})=>{
 await page.addInitScript(path=>{localStorage.setItem('cc.files.host','test');localStorage.setItem('cc.files.locations',JSON.stringify({test:path}));},dir);
 await page.goto(base+'/#/files');const tree=page.locator('#directory-tree');await tree.getByRole('button',{name:'main.ts',exact:true}).click();const editor=page.locator('#code-editor .cm-content');await editor.click();await editor.press('Control+End');await page.keyboard.insertText('// first pending\n');
 await tree.getByRole('button',{name:'other.ts',exact:true}).click();await editor.click();await editor.press('Control+End');await page.keyboard.insertText('// second pending\n');
 await appearance(page);await page.locator('#theme-select').selectOption('flexoki-light');await page.locator('#toggle-files').click();await expect(editor).toContainText('second pending');await expect(page.locator('.cm-editor')).toHaveCSS('background-color',rgb(catalog.find(t=>t.id==='flexoki-light')!.colors.background));
 await page.locator('#file-tabs button').filter({hasText:'main.ts'}).click();await expect(editor).toContainText('first pending');await editor.click();await editor.press('Control+z');await expect(editor).not.toContainText('first pending');await expect(editor).toContainText('const greeting');await expect(editor.locator('span')).not.toHaveCount(0);
});
test('desktop and compact theme changes leave tmux process, dimensions and input untouched',async({page,browser})=>{
 let sockets=0;const traffic:string[]=[];page.on('websocket',ws=>{if(ws.url().includes('/terminal?')){sockets++;ws.on('framesent',frame=>{if(typeof frame.payload==='string')traffic.push(frame.payload);else traffic.push('binary input');});}});
 await page.goto(base+'/#/terminal');await expect(page.locator('#connection')).toHaveText('Attached');await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));const before=panes();traffic.length=0;
 await appearance(page);await page.locator('#theme-select').selectOption('tokyo-night');await page.locator('#theme-select').selectOption('rose-pine');await page.locator('#show-terminal').click();await expect(page.locator('#connection')).toHaveText('Attached');expect(sockets).toBe(1);expect(panes()).toBe(before);expect(traffic.filter(value=>value==='binary input'||/"type":"(?:resize|input|select_window)"/.test(value))).toEqual([]);
 await page.screenshot({path:'../test-results/theme-terminal-light.png'});
 const phone=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});let phoneSockets=0;phone.on('websocket',()=>phoneSockets++);await phone.goto(base+'/#/settings');await phone.locator('#settings-appearance-tab').click();await phone.locator('#theme-select').selectOption('catppuccin-latte');await phone.screenshot({path:'../test-results/theme-phone.png'});
 for(const viewport of [{width:393,height:852},{width:852,height:393}]){await phone.setViewportSize(viewport);await expect.poll(()=>phone.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);await expect(phone.locator('#theme-select')).toBeInViewport();}
 expect(phoneSockets).toBe(0);expect(panes()).toBe(before);await expect(page.locator('html')).toHaveAttribute('data-theme','rose-pine');await phone.close();
});

test('agent Markdown and custom card colors remain readable in dark and light themes',async({page})=>{
 const now=Math.floor(Date.now()/1000),attention={key:'theme-key',instance:'theme-instance',revision:1,finished:false,new_approval:false,unread_reply:false,needs_attention:false};
 const activity={state:'ready',source:'claude_events',reason:'Fixture ready',observed_at:now,evidence_at:now,transition:'theme-turn'};
 const card={id:'test/revision/$0/@0/%0',session:'$0',session_name:'fixture',window:'@0',window_name:'fixture',pane:'%0',project:'/fixture/project',agent:'claude',prompt:'Live agent',context:'',status:'live',activity,attention,card:{revision:1,name:'Theme preview',notes:'',color:'#d08770',pinned:true}};
 const message='## Release checklist\nThe **preview** is ready for review. Keep `drafts` safe.\n\n- Colors update immediately\n- Terminal sessions keep running\n\n```ts\nconst theme = "Tokyo Night";\n```\n\n| Area | Status |\n| --- | --- |\n| Editor | Ready |\n| Terminal | Ready |';
 await page.route('**/api/v1/queue',route=>route.fulfill({json:{checked_at:now,hosts:[{id:'test',name:'Theme fixture',connection_revision:'revision',items:[card],error:null,limited:false}]}}));
 await page.route('**/agents/conversation?*',route=>route.fulfill({json:{provider:'claude',association:'process',selected:'conversation',instance:'theme-instance',context:'',project:'/fixture/project',activity,attention:false,send_available:true,message_token:'not-used',read_state:attention,conversations:[],history_version:'theme-version',messages:[{id:'1',role:'user',text:'Could you check the release?',timestamp:''},{id:'2',role:'assistant',text:message,timestamp:''}],activities:[]}}));
 await page.goto(base+'/#/queue');await page.locator('.queue-card').click();await expect(page.locator('.agent-markdown h2')).toHaveText('Release checklist');
 for(const id of ['tokyo-night','flexoki-light']){await appearance(page);await page.locator('#theme-select').selectOption(id);await page.locator('#show-queue').click();await expect(page.locator('.agent-markdown')).toContainText('Terminal sessions keep running');await expect(page.locator('.queue-card')).toHaveClass(/has-custom-color/);expect(await page.locator('.queue-card').evaluate(el=>el.style.getPropertyValue('--agent-card-color'))).toBe('#d08770');await page.screenshot({path:`../test-results/theme-agent-${id}.png`});}
});
