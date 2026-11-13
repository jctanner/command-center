import {test,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
test.setTimeout(60000);
let dir:string,socket:string,base:string,config:string,home:string,pane:string,session:string,windowId:string,backend:ChildProcess;
const native='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function run(program:string,args:string[]){const r=spawnSync(program,args,{encoding:'utf8',env:{...process.env,TMUX:''}});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
const tmux=(...args:string[])=>run('/usr/bin/tmux',['-S',socket,...args]);
const post=(path:string,body:unknown)=>fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
async function json(path:string){const r=await fetch(base+path);expect(r.status).toBe(200);return r.json();}
async function target(){const hosts=await json('/api/v1/hosts');const revision=hosts.find((h:any)=>h.id==='local').connection_revision;const d=await json('/api/v1/hosts/local/agents/conversation?'+new URLSearchParams({session,window:windowId,pane,connection_revision:revision}));return{connection_revision:revision,session,window:windowId,pane,instance:d.instance};}
async function prepare(t:Record<string,string>){return json('/api/v1/hosts/local/agents/restart?'+new URLSearchParams(t));}
async function complete(id:string){let result:any;await expect.poll(async()=>{result=await json('/api/v1/hosts/local/agents/restart-status?'+new URLSearchParams({id}));return result.state;},{timeout:20000}).toBe('complete');return result;}
async function startBackend(){backend=spawn(resolve(process.cwd(),process.env.CC_BINARY||'../target/release/command-center'),['--listen',base.slice(7),'--config',config,'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH},stdio:'ignore'});await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/hosts')).status}catch{return 0}}).toBe(200);}
async function stopBackend(){if(!backend||backend.exitCode!==null)return;const stopped=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await stopped;}
test.beforeEach(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-restart-'));socket=join(dir,'tmux.sock');config=join(dir,'config.toml');home=join(dir,'home');mkdirSync(join(dir,'bin'));mkdirSync(home);
 const portServer=createServer();const port=await new Promise<number>(r=>portServer.listen(0,'127.0.0.1',()=>r((portServer.address() as {port:number}).port)));await new Promise<void>(r=>portServer.close(()=>r()));base=`http://127.0.0.1:${port}`;
 const source=join(dir,'harness.c');writeFileSync(source,'#include <stdio.h>\n#include <string.h>\nint main(int argc,char**argv){if(argc>1&&!strcmp(argv[1],"--help")){puts("Fixture resume harness");return 0;}puts("Fixture agent ready");fflush(stdout);char line[8192];while(fgets(line,sizeof(line),stdin)){printf("INPUT:%s",line);fflush(stdout);}return 0;}');
 for(const provider of ['codex','claude','pi'])run('cc',[source,'-o',join(dir,'bin',provider)]);
 tmux('-f','/dev/null','new-session','-d','-s','fixture','-c',dir,'sleep','86400');session=tmux('display-message','-p','-t','fixture','#{session_id}');windowId=tmux('display-message','-p','-t','fixture','#{window_id}');pane=tmux('display-message','-p','-t','fixture','#{pane_id}');
 writeFileSync(config,`[[hosts]]\nid="local"\nname="Restart fixture"\nsocket=${JSON.stringify(socket)}\n`);await startBackend();
});
test.afterEach(async()=>{await stopBackend();if(socket)spawnSync('/usr/bin/tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});
async function harness(provider:string,venv=''){
 let path:string;
 if(provider==='codex'){path=join(home,'sessions/2026/11/05/log.jsonl');mkdirSync(join(home,'sessions/2026/11/05'),{recursive:true});writeFileSync(path,JSON.stringify({type:'session_meta',payload:{id:native,cwd:dir}})+'\n');}
 else if(provider==='claude'){const project=dir.replace(/[^a-zA-Z0-9]/g,'-');mkdirSync(join(home,'projects',project),{recursive:true});path=join(home,'projects',project,native+'.jsonl');writeFileSync(path,JSON.stringify({type:'user',sessionId:native,cwd:dir,timestamp:new Date().toISOString(),message:{role:'user',content:'Fixture conversation'}})+'\n');}
 else{path=join(dir,'pi-session.jsonl');writeFileSync(path,JSON.stringify({type:'session',version:3,id:native,cwd:dir})+'\n');}
 const args=provider==='codex'?['resume',native]:provider==='claude'?['--resume',native]:['--session',path];
 const command=`exec env ${venv?`VIRTUAL_ENV='${venv}' PATH='${venv}/bin:/usr/bin:/bin' `:''}CODEX_HOME='${home}' CLAUDE_CONFIG_DIR='${home}' PI_CODING_AGENT_DIR='${home}' '${join(dir,'bin',provider)}' ${args.map(a=>`'${a}'`).join(' ')}`;
 tmux('respawn-pane','-k','-t',pane,command);await expect.poll(()=>tmux('display-message','-p','-t',pane,'#{pane_current_command}')).toBe(provider);
}
for(const provider of ['codex','claude','pi'])test(`${provider} restart retains pane, exact conversation and card settings without replay`,async({page})=>{
 await harness(provider);const t=await target();const fields={target:t,revision:0,name:'Restart me',notes:'Keep these notes',color:'#46acec',pinned:true};
 const save=await fetch(base+'/api/v1/hosts/local/agents/card',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(fields)});expect(save.status).toBe(200);
 const sibling=tmux('split-window','-d','-P','-F','#{pane_id} #{pane_pid}','-t',pane,'sleep','86400');const oldPid=tmux('display-message','-p','-t',pane,'#{pane_pid}');
 await page.goto(base+'/#/queue');const card=page.locator('.queue-card').filter({hasText:'Restart me'});await card.click({button:'right'});await page.getByRole('menuitem',{name:'Restart agent…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Restart agent',exact:true});await expect(dialog).toContainText(native);await expect(dialog).toContainText('shell and child processes');await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(tmux('display-message','-p','-t',pane,'#{pane_pid}')).toBe(oldPid);
 const prepared=await prepare(t);expect(prepared.command.slice(-2)).toEqual(provider==='pi'?['--session',join(dir,'pi-session.jsonl')]:[provider==='codex'?'resume':'--resume',native]);
 const result=await post('/api/v1/hosts/local/agents/restart',{id:prepared.id});expect(result.status).toBe(200);await complete(prepared.id);
 const resumed=await target();expect(resumed.instance).not.toBe(t.instance);expect(resumed.pane).toBe(pane);expect(resumed.window).toBe(windowId);expect(tmux('display-message','-p','-t',pane,'#{pane_pid}')).not.toBe(oldPid);
 expect(tmux('display-message','-p','-t',sibling.split(' ')[0],'#{pane_id} #{pane_pid}')).toBe(sibling);
 const cardData=await json('/api/v1/hosts/local/agents/card?'+new URLSearchParams(resumed));expect(cardData).toMatchObject({name:'Restart me',notes:'Keep these notes',color:'#46acec',pinned:true});
 expect((await post('/api/v1/hosts/local/agents/restart',{id:prepared.id})).status).toBe(409);
 await stopBackend();await startBackend();expect((await json('/api/v1/hosts/local/agents/restart-status?id='+prepared.id)).state).toBe('complete');expect((await post('/api/v1/hosts/local/agents/restart',{id:prepared.id})).status).toBe(409);
 await page.setViewportSize({width:393,height:852});await page.reload();await page.locator('.queue-card').filter({hasText:'Restart me'}).click();await page.getByRole('button',{name:'Details',exact:true}).click();await page.locator('.queue-agent-metadata').getByRole('button',{name:'Restart agent…',exact:true}).click();await expect(dialog).toContainText(native);
 expect(tmux('capture-pane','-p','-t',pane)).not.toContain('INPUT:');
});

test('stale preview cannot kill a replacement and pending messages never follow a restart',async()=>{
 await harness('codex');const t=await target();const prepared=await prepare(t);await harness('codex');const replacedPid=tmux('display-message','-p','-t',pane,'#{pane_pid}');
 expect((await post('/api/v1/hosts/local/agents/restart',{id:prepared.id})).status).toBe(200);
 expect(tmux('display-message','-p','-t',pane,'#{pane_pid}')).toBe(replacedPid);expect((await fetch(base+'/api/v1/hosts/local/agents/restart-status?id='+prepared.id)).status).toBe(409);
 const current=await target();const detail=await json('/api/v1/hosts/local/agents/conversation?'+new URLSearchParams({session,window:windowId,pane,connection_revision:current.connection_revision}));
 const queued=await post('/api/v1/hosts/local/agents/message',{id:crypto.randomUUID(),token:detail.message_token,text:'DO_NOT_REPLAY'});expect(queued.status).toBe(200);const receipt=(await queued.json()).outbox;
 const restart=await prepare(current);await post('/api/v1/hosts/local/agents/restart',{id:restart.id});await complete(restart.id);
 await expect.poll(async()=>(await json('/api/v1/agents/outbox')).entries.find((r:any)=>r.id===receipt.id)?.status,{timeout:15000}).toBe('blocked');
 expect(tmux('capture-pane','-p','-t',pane)).not.toContain('DO_NOT_REPLAY');
});

test('phone restart recovers a lost response across reload without a second POST',async({page})=>{
 await harness('codex');await page.setViewportSize({width:393,height:852});
 const t=await target();const save=await fetch(base+'/api/v1/hosts/local/agents/card',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({target:t,revision:0,name:'Recovered card',notes:'Recovery notes',color:'#46acec',pinned:true})});expect(save.status).toBe(200);
 let posts=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/agents/restart'))posts++;});
 await page.route('**/agents/restart',async route=>{if(route.request().method()==='POST'){await route.fetch();await route.abort('failed');}else await route.continue();});
 await page.route('**/agents/restart-status?*',route=>route.abort('failed'));
 let terminalSockets=0;page.on('websocket',socket=>{if(socket.url().includes('/terminal?'))terminalSockets++;});
 await page.goto(base+'/#/queue');await page.locator('.queue-card').click();await page.getByRole('button',{name:'Details',exact:true}).click();await page.locator('.queue-agent-metadata').getByRole('button',{name:'Restart agent…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Restart agent',exact:true});await expect(dialog).toContainText(native);
 await dialog.getByRole('button',{name:'Restart agent',exact:true}).click();await expect(dialog).toContainText('Checking status never repeats');
 const newPid=tmux('display-message','-p','-t',pane,'#{pane_pid}');expect((await target()).instance).not.toBe(t.instance);
 await stopBackend();await startBackend();await page.unroute('**/agents/restart-status?*');await page.reload();await page.locator('.queue-card').click();await page.getByRole('button',{name:'Details',exact:true}).click();await page.locator('.queue-agent-metadata').getByRole('button',{name:'Restart agent…',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(page.getByRole('status',{name:'Agent restart result',exact:true})).toContainText('Agent restarted');
 expect(posts).toBe(1);expect(terminalSockets).toBe(0);expect(tmux('display-message','-p','-t',pane,'#{pane_pid}')).toBe(newPid);
 const card=await json('/api/v1/hosts/local/agents/card?'+new URLSearchParams(await target()));expect(card).toMatchObject({name:'Recovered card',notes:'Recovery notes',color:'#46acec',pinned:true});
 await page.screenshot({path:'../test-results/restart-phone.png'});
});


test('desktop confirmed restart closes the modal and shows a clear success result',async({page})=>{
 await harness('codex');const pid=tmux('display-message','-p','-t',pane,'#{pane_pid}');
 let posts=0;page.on('request',r=>{if(r.method()==='POST'&&r.url().endsWith('/agents/restart'))posts++;});
 await page.goto(base+'/#/queue');await page.locator('.queue-card').click({button:'right'});await page.getByRole('menuitem',{name:'Restart agent…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Restart agent',exact:true});await expect(dialog).toContainText(native);await dialog.getByRole('button',{name:'Restart agent',exact:true}).click();
 await expect(dialog).not.toBeVisible();await expect(page.getByRole('status',{name:'Agent restart result',exact:true})).toContainText('Agent restarted');expect(posts).toBe(1);expect(tmux('display-message','-p','-t',pane,'#{pane_pid}')).not.toBe(pid);
 await page.screenshot({path:'../test-results/restart-success-desktop.png'});
});

async function wrappedHarness(provider:string,mode='foreground'){
 await harness(provider);
 const args=provider==='codex'?['resume',native]:provider==='claude'?['--resume',native]:['--session',join(dir,'pi-session.jsonl')];
 const literal=(s:string)=>`'${s.replace(/'/g,"'\\''")}'`;
 let body=`${literal(join(dir,'bin',provider))} ${args.map(literal).join(' ')}\nresult=$?\nexit "$result"\n`;
 if(mode==='background')body=`set -m\n${literal(join(dir,'bin','codex'))} resume ${native} </dev/tty &\nsleep 86400\n`;
 if(mode==='ambiguous')body=`set +m\n${literal(join(dir,'bin','codex'))} resume ${native} </dev/tty &\n${literal(join(dir,'bin','claude'))} --resume ${native} </dev/tty &\nwait\n`;
 const script=join(dir,'SESSION.sh');writeFileSync(script,'#!/bin/bash\n'+body);
 tmux('respawn-pane','-k','-t',pane,`exec env CODEX_HOME=${literal(home)} CLAUDE_CONFIG_DIR=${literal(home)} PI_CODING_AGENT_DIR=${literal(home)} /bin/bash ${literal(script)}`);
 await expect.poll(()=>tmux('display-message','-p','-t',pane,'#{pane_current_command}')).toMatch(mode==='background'?/sleep|bash/:/bash|SESSION/);
}
for(const provider of ['codex','claude','pi'])test(`foreground ${provider} behind SESSION.sh is discovered and can safely resume`,async({page})=>{
 await wrappedHarness(provider);const snapshot=await json('/api/v1/queue');const item=snapshot.hosts.find((h:any)=>h.id==='local').items.find((i:any)=>i.pane===pane);expect(item).toBeTruthy();expect(item.agent).toBe(provider);expect(item.attention.instance).toBeTruthy();
 const t=await target();expect(t.instance).toBe(item.attention.instance);const before=tmux('display-message','-p','-t',pane,'#{pane_pid}');
 await page.goto(base+'/#/queue');await expect(page.locator('.queue-card')).toContainText(provider);
 const prepared=await prepare(t);expect(prepared.session).toBe(native);expect((await post('/api/v1/hosts/local/agents/restart',{id:prepared.id})).status).toBe(200);await complete(prepared.id);expect(tmux('display-message','-p','-t',pane,'#{pane_pid}')).not.toBe(before);
});
test('background jobs and ambiguous same-terminal agents do not become pane cards',async()=>{
 await wrappedHarness('codex','background');let snapshot=await json('/api/v1/queue');expect(snapshot.hosts.find((h:any)=>h.id==='local').items).toHaveLength(0);
 await wrappedHarness('codex','ambiguous');await stopBackend();await startBackend();snapshot=await json('/api/v1/queue');expect(snapshot.hosts.find((h:any)=>h.id==='local').items).toHaveLength(0);
});


test('Claude resumed from an old repository auto-selects its exact native log',async({page})=>{
 await wrappedHarness('claude');const source=join(home,'projects',dir.replace(/[^a-zA-Z0-9]/g,'-'),native+'.jsonl');const previous=join(home,'projects','old-repository');mkdirSync(previous);writeFileSync(join(previous,native+'.jsonl'),JSON.stringify({type:'user',sessionId:native,cwd:'/fixture/old-repository',timestamp:new Date().toISOString(),message:{role:'user',content:'Exact resumed history'}})+'\n');rmSync(source);
 const t=await target();const d=await json('/api/v1/hosts/local/agents/conversation?'+new URLSearchParams({session,window:windowId,pane,connection_revision:t.connection_revision}));expect(d.association).toBe('process');expect(d.conversations.find((c:any)=>c.id===d.selected).session).toBe(native);
 await page.goto(base+'/#/queue');await page.locator('.queue-card').click();await expect(page.locator('.agent-history')).toContainText('Exact resumed history');await expect(page.getByLabel('Conversation history',{exact:true})).toHaveValue(d.selected);
});


function upgradeFixture(provider:string){
 const source=join(dir,'upgrade.c');writeFileSync(source,'#include <stdio.h>\n#include <string.h>\nint main(int argc,char**argv){if(argc>1&&!strcmp(argv[1],"--help")){puts("Fixture upgraded resume harness");return 0;}puts("FIXTURE_UPGRADED_'+provider+'");for(int i=1;i<argc;i++)printf("ARG:%s\\n",argv[i]);fflush(stdout);char line[8192];while(fgets(line,sizeof(line),stdin)){printf("INPUT:%s",line);fflush(stdout);}return 0;}');
 run('cc',[source,'-o',join(dir,'bin',provider+'.new')]);renameSync(join(dir,'bin',provider+'.new'),join(dir,'bin',provider));
}
for(const provider of ['codex','claude','pi'])test(`post-update restart uses newly installed ${provider} and exact saved conversation`,async()=>{
 await harness(provider);const original=await target(),oldPid=tmux('display-message','-p','-t',pane,'#{pane_pid}');upgradeFixture(provider);
 const prepared=await prepare(original);expect(prepared.command[0]).toBe(join(dir,'bin',provider));expect(prepared.session).toBe(native);expect(prepared.state).toBe('prepared');
 await post('/api/v1/hosts/local/agents/restart',{id:prepared.id});await complete(prepared.id);
 expect(tmux('display-message','-p','-t',pane,'#{pane_pid}')).not.toBe(oldPid);expect((await target()).instance).not.toBe(original.instance);const output=tmux('capture-pane','-p','-t',pane);expect(output).toContain('FIXTURE_UPGRADED_'+provider);expect(output).toContain(provider==='pi'?join(dir,'pi-session.jsonl'):native);expect((await post('/api/v1/hosts/local/agents/restart',{id:prepared.id})).status).toBe(409);
});
test('an installation changed after preparation cannot kill the original process',async()=>{
 await harness('codex');const original=await target(),pid=tmux('display-message','-p','-t',pane,'#{pane_pid}'),prepared=await prepare(original);upgradeFixture('codex');
 const response=await post('/api/v1/hosts/local/agents/restart',{id:prepared.id});expect(response.status).toBe(200);expect((await response.json()).state).toBe('checking');expect(tmux('display-message','-p','-t',pane,'#{pane_pid}')).toBe(pid);expect((await target()).instance).toBe(original.instance);expect(tmux('capture-pane','-p','-t',pane)).not.toContain('FIXTURE_UPGRADED_codex');expect((await json('/api/v1/hosts/local/agents/restart-status?id='+prepared.id)).state).toBe('checking');expect((await post('/api/v1/hosts/local/agents/restart',{id:prepared.id})).status).toBe(409);
});


test('restart preserves a manually activated venv in the actual resumed process',async()=>{
 const venv=join(dir,'.venv');run('/usr/bin/python3',['-m','venv','--without-pip',venv]);await harness('pi',venv);const old=await target();const prepared=await prepare(old);expect(prepared.python_venv).toBe(venv);const before=tmux('display-message','-p','-t',pane,'#{pane_pid}');expect((await post('/api/v1/hosts/local/agents/restart',{id:prepared.id})).status).toBe(200);await complete(prepared.id);const after=tmux('display-message','-p','-t',pane,'#{pane_pid}');expect(after).not.toBe(before);const env=Object.fromEntries(readFileSync('/proc/'+after+'/environ','utf8').split('\0').filter(v=>v.includes('=')).map(v=>{const at=v.indexOf('=');return[v.slice(0,at),v.slice(at+1)];}));expect(env.VIRTUAL_ENV).toBe(venv);expect(env.PATH.startsWith(venv+'/bin:')).toBe(true);expect(tmux('capture-pane','-p','-t',pane)).not.toContain('INPUT:');
});
