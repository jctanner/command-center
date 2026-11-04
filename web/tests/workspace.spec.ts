import {test,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
let dir:string,socket:string,base:string,backend:ChildProcess,project:string,override:string,sid:string,wid:string,pane:string;
function tm(...args:string[]){const r=spawnSync('tmux',['-S',socket,...args],{encoding:'utf8',env:{...process.env,TMUX:''}});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
function identities(){return tm('list-panes','-s','-t',sid,'-F','#{pane_id} #{pane_pid}').split('\n');}
let original:string[];
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-workspace-'));socket=join(dir,'tmux.sock');project=join(dir,"project ' #{session_name} ; café");override=join(dir,"override ' #{pane_id}");mkdirSync(project);mkdirSync(override);
 sid=tm('-f','/dev/null','new-session','-d','-P','-F','#{session_id}','-s','workspace','-n','source','-c',project.replace(/#/g,'##'),'-x','140','-y','40','/bin/sleep','86400');
 wid=tm('display-message','-p','-t',sid,'#{window_id}');pane=tm('display-message','-p','-t',sid,'#{pane_id}');
 tm('split-window','-h','-d','-t',sid+':'+wid,'-c',project.replace(/#/g,'##'),'/bin/sleep','86400');original=identities();
 const port=await new Promise<number>(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>r(p));});});base=`http://127.0.0.1:${port}`;
 const config=join(dir,'config');writeFileSync(config,`[[hosts]]\nid="test"\nname="Workspace fixture"\nsocket=${JSON.stringify(socket)}\n`);
 backend=spawn(resolve(process.env.CC_BINARY||'../target/debug/command-center'),['--listen',`127.0.0.1:${port}`,'--config',config,'--web-dir',resolve(process.env.CC_WEB_DIR||'dist')],{stdio:'pipe'});
 await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status;}catch{return 0;}}).toBe(200);
});
test.afterAll(()=>{backend?.kill('SIGTERM');if(socket)spawnSync('tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});
async function ready(page:import('@playwright/test').Page){await page.goto(base);await expect(page.locator('#connection')).toHaveText('Attached');}
async function request(path:string,body:object){return fetch(base+'/api/v1/hosts/test/'+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});}
async function source(){const hosts=await(await fetch(base+'/api/v1/hosts')).json();return{connection_revision:hosts[0].connection_revision,session:sid,window:wid,pane,expected_directory:project,directory:null,name:null};}
function preserved(){for(const entry of original)expect(identities()).toContain(entry);}

test('new window inherits the active directory, treats names literally and leaves peer selection and processes intact',async({page,context})=>{
 await ready(page);const peer=await context.newPage();await ready(peer);
 const active=tm('display-message','-p','-t',sid,'#{window_id}');const marker=join(dir,'injection-marker');const name=`Tools ' #{window_id} #(touch ${marker})`;
 await page.getByRole('button',{name:'+ Window',exact:true}).click();const dialog=page.getByRole('dialog',{name:'New tmux window',exact:true});
 await expect(dialog.getByRole('textbox',{name:'Working directory',exact:true})).toHaveValue(project);
 await dialog.getByRole('textbox',{name:'Tmux name',exact:true}).fill(name);await page.screenshot({path:'../test-results/new-window-dialog.png'});
 await dialog.getByRole('button',{name:'Create window',exact:true}).click();await expect(dialog).toBeHidden();
 await expect(page.locator('#windows button[aria-current=true]')).toContainText(name);
 const newWindow=tm('list-windows','-t',sid,'-F','#{window_id} #{window_name}').split('\n').find(line=>line.includes(name))!.split(' ')[0];
 const newPane=tm('display-message','-p','-t',sid+':'+newWindow,'#{pane_id}');expect(tm('display-message','-p','-t',newPane,'#{pane_current_path}')).toBe(project);
 expect(tm('display-message','-p','-t',sid,'#{window_id}')).toBe(active);await expect(peer.locator('#windows button[aria-current=true]')).toContainText('source');preserved();expect(existsSync(marker)).toBe(false);
 await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type("printf 'CC_NEW_WINDOW_%s\\n' WORKS");await page.keyboard.press('Enter');await expect.poll(()=>tm('capture-pane','-p','-t',newPane)).toContain('CC_NEW_WINDOW_WORKS');await peer.close();
});

test('keyboard pane menu splits the exact inactive pane right, supports a directory override, and splits below from zoom',async({page})=>{
 await ready(page);await page.locator('#windows button').filter({hasText:'0 source'}).click();await expect(page.locator('.pane-control')).toHaveCount(2);
 const oldLeft=Number(tm('display-message','-p','-t',pane,'#{pane_left}'));
 tm('select-pane','-t',tm('list-panes','-t',sid+':'+wid,'-F','#{pane_id}').split('\n')[1]);
 const control=page.locator('.pane-control>button:first-child').first();await control.focus();await page.keyboard.press('Shift+F10');await page.getByRole('button',{name:'Split right…',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'Split pane right',exact:true});await expect(dialog.getByRole('textbox',{name:'Working directory',exact:true})).toHaveValue(project);await dialog.getByRole('textbox',{name:'Working directory',exact:true}).fill(override);await dialog.getByRole('button',{name:'Split pane',exact:true}).click();await expect(dialog).toBeHidden();
 await expect(page.locator('.pane-control')).toHaveCount(3);
 const right=tm('list-panes','-t',sid+':'+wid,'-F','#{pane_id} #{pane_current_path}').split('\n').find(line=>line.includes(override))!.split(' ')[0];
 expect(Number(tm('display-message','-p','-t',right,'#{pane_left}'))).toBeGreaterThan(oldLeft);await expect.poll(()=>tm('display-message','-p','-t',right,'#{pane_active}')).toBe('1');
 await page.getByRole('button',{name:`Maximize pane ${right}`,exact:true}).click();await expect.poll(()=>tm('display-message','-p','-t',wid,'#{window_zoomed_flag}')).toBe('1');
 await page.locator('.pane-control.active>button:first-child').focus();await page.keyboard.press('Shift+F10');await page.getByRole('button',{name:'Split below…',exact:true}).click();dialog=page.getByRole('dialog',{name:'Split pane below',exact:true});
 await expect(dialog.getByRole('textbox',{name:'Working directory',exact:true})).toHaveValue(override);await dialog.getByRole('textbox',{name:'Working directory',exact:true}).fill('');await dialog.getByRole('button',{name:'Split pane',exact:true}).click();await expect(dialog).toBeHidden();
 await expect(page.locator('.pane-control')).toHaveCount(4);expect(tm('display-message','-p','-t',wid,'#{window_zoomed_flag}')).toBe('0');
 const below=tm('display-message','-p','-t',wid,'#{pane_id}');expect(below).not.toBe(right);expect(Number(tm('display-message','-p','-t',below,'#{pane_top}'))).toBeGreaterThan(Number(tm('display-message','-p','-t',right,'#{pane_top}')));expect(tm('display-message','-p','-t',below,'#{pane_current_path}')).toBe(override);preserved();await page.screenshot({path:'../test-results/split-panes-desktop.png'});
});

test('stale endpoints, moved panes, changed directories and invalid overrides create nothing',async()=>{
 const body=await source();const before=identities().length;
 for(const patch of [{connection_revision:'stale'},{window:'@99999'},{expected_directory:'/old'},{directory:'relative'},{directory:join(dir,'missing')},{name:';'}])expect((await request('windows',{...body,...patch})).status).toBeGreaterThanOrEqual(400);
 expect((await request('panes',{...body,direction:'diagonal'})).status).toBe(400);expect(identities().length).toBe(before);preserved();
});

test('lost creation response is never automatically retried',async({page})=>{
 await ready(page);const before=tm('list-windows','-t',sid,'-F','#{window_id}').split('\n').length;let calls=0;
 await page.route('**/api/v1/hosts/test/windows',async route=>{calls++;const response=await route.fetch();expect(response.status()).toBe(200);await route.abort();});
 await page.getByRole('button',{name:'+ Window',exact:true}).click();const dialog=page.getByRole('dialog',{name:'New tmux window',exact:true});await dialog.getByRole('button',{name:'Create window',exact:true}).click();await expect(dialog.getByRole('status')).toContainText('may have completed');await expect(dialog.getByRole('button',{name:'Create window',exact:true})).toBeDisabled();
 expect(tm('list-windows','-t',sid,'-F','#{window_id}').split('\n').length).toBe(before+1);expect(calls).toBe(1);await dialog.getByRole('button',{name:'Check sessions',exact:true}).click();await expect(dialog).toBeHidden();expect(calls).toBe(1);preserved();
});
