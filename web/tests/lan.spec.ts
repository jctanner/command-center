import {enableFeatures} from './feature-fixture';
import {test,expect} from '@playwright/test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
const lanIp=process.env.CC_TEST_LAN_IP;
test.skip(!lanIp,'Set CC_TEST_LAN_IP to an assigned private IPv4 address for LAN integration.');
let dir:string,socket:string,lan:string,loopback:string,backend:ChildProcess;
function tm(...args:string[]){const r=spawnSync('tmux',['-S',socket,...args],{encoding:'utf8',env:{...process.env,TMUX:''}});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
async function port(host:string){return new Promise<number>((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,host,()=>{const port=(server.address() as {port:number}).port;server.close(()=>resolve(port));});});}
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-lan-browser-'));socket=join(dir,'tmux.sock');tm('-f','/dev/null','new-session','-d','-s','lan-fixture','-x','120','-y','35','/bin/sleep','86400');
 const localPort=await port('127.0.0.1'),lanPort=await port(lanIp!);loopback=`http://127.0.0.1:${localPort}`;lan=`http://${lanIp}:${lanPort}`;
 const config=join(dir,'config.toml');writeFileSync(config,`[[hosts]]\nid="local"\nname="LAN fixture"\nsocket=${JSON.stringify(socket)}\n`);
 backend=spawn(resolve(process.env.CC_BINARY||'../target/debug/command-center'),['--listen',`127.0.0.1:${localPort}`,'--lan-listen',`${lanIp}:${lanPort}`,'--config',config,'--web-dir',resolve(process.env.CC_WEB_DIR||'dist')],{stdio:'pipe'});
 await expect.poll(async()=>{try{return(await fetch(lan+'/api/v1/health')).status;}catch{return 0;}}).toBe(200);await enableFeatures(loopback);
});
test.afterAll(()=>{backend?.kill('SIGTERM');if(socket)spawnSync('tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});
test('LAN serves the frontend/API and attaches terminal WebSockets while preserving loopback',async({page,request})=>{
 expect((await request.get(loopback+'/api/v1/health')).status()).toBe(200);const pid=tm('display-message','-p','-t','lan-fixture','#{pane_pid}');let terminalOrigin='';page.on('websocket',ws=>{if(ws.url().includes('/terminal?'))terminalOrigin=new URL(ws.url()).host;});await page.goto(lan);await expect(page.locator('#connection')).toHaveText('Attached');expect(terminalOrigin).toBe(new URL(lan).host);expect(tm('display-message','-p','-t','lan-fixture','#{pane_pid}')).toBe(pid);await page.close();
});
test('LAN keeps exact Host and same-origin HTTP/WebSocket guards',async({page,request})=>{
 expect((await request.get(lan+'/api/v1/health',{headers:{Host:'evil.example:8080'}})).status()).toBe(403);
 expect((await request.get(lan+'/api/v1/health',{headers:{Origin:'http://evil.example'}})).status()).toBe(403);
 expect((await request.post(lan+'/api/v1/slack/inbox',{data:{},headers:{Origin:loopback}})).status()).toBe(403);
 expect((await request.post(lan+'/api/v1/slack/inbox',{data:{},headers:{Origin:lan}})).status()).toBe(422);
 await page.goto(loopback);const result=await page.evaluate(url=>new Promise<string>(resolve=>{const socket=new WebSocket(url.replace('http:','ws:')+'/api/v1/hosts/local/terminal?session=bad&window=bad&pane=bad');socket.onopen=()=>{socket.close();resolve('opened');};socket.onerror=()=>resolve('rejected');}),lan);expect(result).toBe('rejected');
});
