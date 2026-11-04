import {test,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
let dir:string,socket:string,base:string,backend:ChildProcess,log:string,otherLog:string;
function tm(...args:string[]){const r=spawnSync('tmux',['-S',socket,...args],{encoding:'utf8',env:{...process.env,TMUX:''}});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
const bytes=(file=log)=>existsSync(file)?readFileSync(file):Buffer.alloc(0);
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-clipboard-browser-'));socket=join(dir,'tmux.sock');log=join(dir,'input.log');otherLog=join(dir,'other.log');const script=join(dir,'tui.py');
 writeFileSync(script,`import os,sys,tty\ntty.setraw(0)\nos.write(1,b'\\x1b[?1049h\\x1b[?1003h\\x1b[?1006h\\x1b[?2004h\\x1b[2J\\x1b[HCLIPBOARD_TARGET_1234567890\\r\\nMouse-reporting clipboard fixture')\nwhile True:\n data=os.read(0,4096)\n with open(sys.argv[1],'ab') as f:f.write(data)\n if b'o' in data:os.write(1,b'\\x1b]52;c;QVBQX0NPUFlfVEFSR0VU\\x07')\n if b'q' in data:os.write(1,b'\\x1b]52;c;?\\x07')\n`);
 tm('-f','/dev/null','new-session','-d','-s','fixture','-x','120','-y','35','python3',script,log);
 tm('new-window','-d','-t','fixture','-n','other','python3',script,otherLog);tm('set-option','-s','set-clipboard','external');
 const port=await new Promise<number>(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>r(p));});});base=`http://127.0.0.1:${port}`;
 const config=join(dir,'config');writeFileSync(config,`[[hosts]]\nid="test"\nname="Clipboard fixture"\nsocket=${JSON.stringify(socket)}\n`);
 backend=spawn(resolve(process.env.CC_BINARY||'../target/debug/command-center'),['--listen',`127.0.0.1:${port}`,'--config',config,'--web-dir',resolve(process.env.CC_WEB_DIR||'dist')],{stdio:'pipe'});
 await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status;}catch{return 0;}}).toBe(200);
});
test.afterAll(()=>{backend?.kill('SIGTERM');if(socket)spawnSync('tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});
async function ready(page:import('@playwright/test').Page){await page.goto(base);await expect(page.locator('#connection')).toHaveText('Attached');await expect(page.locator('.xterm-rows')).toContainText('CLIPBOARD_TARGET');}
async function select(page:import('@playwright/test').Page){
 const screen=(await page.locator('.xterm-screen').boundingBox())!,row=(await page.locator('.xterm-rows>div').first().boundingBox())!;const cell=screen.width/Number(tm('display-message','-p','-t','fixture:0','#{window_width}'));const y=row.y+row.height/2;
 await page.mouse.move(screen.x+1,y);await page.keyboard.down('Shift');await page.mouse.down();await page.mouse.move(screen.x+cell*26.8,y,{steps:15});await page.mouse.up();await page.keyboard.up('Shift');
 await expect(page.locator('.xterm-selection>div').first()).toBeVisible();
}
async function menu(page:import('@playwright/test').Page){await page.locator('.xterm-screen').click({button:'right',position:{x:20,y:8}});}

test('mouse reporting preserves Shift selection and explicit copy/paste shortcuts and menu actions',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await ready(page);
 await select(page);await page.keyboard.press('Control+Shift+c');await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toContain('CLIPBOARD_TARGET_1234567890');
 await menu(page);await expect(page.getByRole('button',{name:'Copy selection',exact:true})).toBeEnabled();await page.screenshot({path:'../test-results/terminal-clipboard-menu.png'});
 await page.evaluate(()=>navigator.clipboard.writeText('previous'));await page.getByRole('button',{name:'Copy selection',exact:true}).click();await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toContain('CLIPBOARD_TARGET');
 await page.evaluate(()=>navigator.clipboard.writeText('paste-one\npaste-two'));await page.locator('.xterm-helper-textarea').focus();const before=bytes().length;await page.keyboard.press('Control+Shift+v');
 await expect.poll(()=>bytes().subarray(before).toString()).toBe('\x1b[200~paste-one\rpaste-two\x1b[201~');
 await page.evaluate(()=>navigator.clipboard.writeText('MENU_PASTE'));await menu(page);await page.getByRole('button',{name:'Paste',exact:true}).click();await expect.poll(()=>bytes().toString()).toContain('\x1b[200~MENU_PASTE\x1b[201~');
 await page.locator('.xterm-helper-textarea').focus();const interrupt=bytes().length;await page.keyboard.press('Control+c');await expect.poll(()=>bytes().subarray(interrupt).toString('hex')).toBe('03');
 const reserved=bytes().length;await page.keyboard.press('Control+Shift+c');await expect(page.locator('#notice')).toContainText('Select terminal text first');expect(bytes().length).toBe(reserved);
});

test('application clipboard requests require browser opt-in and explicit guarded tmux setting; queries never read clipboard',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
 let terminalSocket: import('@playwright/test').WebSocketRoute | undefined;
 const outputAcks: boolean[] = [];
 await page.routeWebSocket('**/terminal?*',route=>{
   terminalSocket=route;const server=route.connectToServer();
   server.onMessage(message=>{if(Buffer.isBuffer(message))outputAcks.push(true);route.send(message);});
   route.onMessage(message=>{
     if(typeof message==='string' && JSON.parse(message).type==='ack' && outputAcks.shift()===false)return;
     server.send(message);
   });
 });
 // Injected parser fixtures do not consume the backend's output-credit window.
 const inject=(message:Buffer)=>{outputAcks.push(false);terminalSocket!.send(message);};
 await ready(page);
 const hosts=await(await fetch(base+'/api/v1/hosts')).json();const revision=hosts[0].connection_revision;
 const post=(body:object)=>fetch(base+'/api/v1/hosts/test/clipboard',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 expect((await post({connection_revision:'stale',expected_mode:'external',mode:'on'})).status).toBe(409);
 expect((await post({connection_revision:revision,expected_mode:'external',mode:';kill-server'})).status).toBe(400);
 await page.evaluate(()=>navigator.clipboard.writeText('previous'));await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('o');
 inject(Buffer.from('\x1b]52;c;QVBQX0NPUFlfVEFSR0VU\x07'));await page.waitForTimeout(100);expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('previous');
 await menu(page);await page.getByRole('button',{name:'Clipboard settings…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Terminal clipboard settings',exact:true});
 await expect(dialog.getByRole('status')).toContainText('set-clipboard external');
 await dialog.getByLabel('Allow application copy requests in this browser',{exact:true}).check();await dialog.getByLabel('tmux clipboard mode',{exact:true}).selectOption('on');await dialog.getByRole('button',{name:'Apply tmux setting',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('set-clipboard on · saved');
 expect(tm('show-options','-s','-v','set-clipboard')).toBe('on');expect((await post({connection_revision:revision,expected_mode:'external',mode:'off'})).status).toBe(409);
 await page.screenshot({path:'../test-results/terminal-clipboard-settings.png'});await dialog.getByRole('button',{name:'Close',exact:true}).click();
 await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type('o');await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('APP_COPY_TARGET');
 await page.evaluate(()=>{const w=window as unknown as {clipboardReads:number};w.clipboardReads=0;const read=navigator.clipboard.readText.bind(navigator.clipboard);Object.defineProperty(navigator.clipboard,'readText',{configurable:true,value:()=>{w.clipboardReads++;return read();}});});
 await page.keyboard.type('q');inject(Buffer.from('\x1b]52;c;?\x07'));inject(Buffer.from('\x1b]52;c;@@@@\x07'));
 inject(Buffer.from('\x1b]52;c;'+Buffer.from('x'.repeat(128*1024+1)).toString('base64')+'\x07'));
 await page.waitForTimeout(150);expect(await page.evaluate(()=>(window as unknown as {clipboardReads:number}).clipboardReads)).toBe(0);
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('APP_COPY_TARGET');
 await page.locator('#reconnect').focus();inject(Buffer.from('\x1b]52;c;U0hPVUxEX05PVF9DT1BZ\x07'));await page.waitForTimeout(100);expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('APP_COPY_TARGET');
 // Hidden terminal output cannot overwrite the clipboard.
 await page.locator('#show-queue').click();await page.evaluate(()=>navigator.clipboard.writeText('protected'));tm('send-keys','-t','fixture:0','o');await page.waitForTimeout(150);expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe('protected');
 tm('set-option','-s','set-clipboard','external');
});

test('pending menu paste is discarded after switching windows; read denial preserves keyboard paste',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});await ready(page);
 await page.evaluate(()=>{const w=window as unknown as {releaseClipboard?:()=>void};Object.defineProperty(navigator.clipboard,'readText',{configurable:true,value:()=>new Promise<string>(r=>{w.releaseClipboard=()=>r('WRONG_WINDOW_PASTE');})});});
 await menu(page);await page.getByRole('button',{name:'Paste',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>!!(window as unknown as {releaseClipboard?:()=>void}).releaseClipboard)).toBe(true);
 await page.locator('#windows button').filter({hasText:'1 other'}).click();await expect(page.locator('#connection')).toHaveText('Attached');
 // Returning to the original window must not revive the pending permission grant.
 await page.locator('#windows button').first().click();await expect(page.locator('#connection')).toHaveText('Attached');const before=bytes().length,otherBefore=bytes(otherLog).length;
 await page.evaluate(()=>(window as unknown as {releaseClipboard:()=>void}).releaseClipboard());await expect(page.locator('#notice')).toContainText('Terminal target changed');expect(bytes().length).toBe(before);expect(bytes(otherLog).length).toBe(otherBefore);
 await page.locator('#windows button').filter({hasText:'1 other'}).click();await expect(page.locator('#connection')).toHaveText('Attached');
 await page.evaluate(()=>{Object.defineProperty(navigator.clipboard,'readText',{configurable:true,value:()=>Promise.reject(new Error('Denied'))});});
 await menu(page);await page.getByRole('button',{name:'Paste',exact:true}).click();await expect(page.locator('#notice')).toContainText('Denied');
 await page.evaluate(()=>navigator.clipboard.writeText('NATIVE_PASTE'));await page.locator('.xterm-helper-textarea').focus();await page.keyboard.press('Control+Shift+v');await expect.poll(()=>bytes(otherLog).toString()).toContain('\x1b[200~NATIVE_PASTE\x1b[201~');
});
