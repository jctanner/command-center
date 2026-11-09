import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, renameSync, existsSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
let dir:string, socket:string, base:string, backend:ChildProcess, sshd:ChildProcess|undefined, project:string, home:string, bin:string;
function command(program:string,args:string[]) {const r=spawnSync(program,args,{encoding:'utf8',env:{...process.env,TMUX:''}});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
function tmux(...args:string[]) {return command('tmux',['-S',socket,...args]);}
async function port() {return new Promise<number>(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>r(p));});});}
async function api(path:string,body?:unknown) {return fetch(base+path,body===undefined?{}:{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});}
async function prepare(provider='codex',path=project,host='local',model='') {const hosts=await(await api('/api/v1/hosts')).json();const revision=hosts.find((h:{id:string})=>h.id===host).connection_revision;const r=await api(`/api/v1/hosts/${host}/agents/launch-options?${new URLSearchParams({provider,path,connection_revision:revision,model})}`);expect(r.status).toBe(200);return {...await r.json(),revision};}
async function launch(prepared:{token:string},conversation:string|null=null,host='local') {return api(`/api/v1/hosts/${host}/agents/launch`,{token:prepared.token,conversation});}
async function status(prepared:{launch_id:string;revision:string;endpoint:string},host='local') {const r=await api(`/api/v1/hosts/${host}/agents/launch-status?${new URLSearchParams({launch_id:prepared.launch_id,connection_revision:prepared.revision,endpoint:prepared.endpoint})}`);expect(r.status).toBe(200);return r.json();}
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-launch-'));socket=join(dir,'tmux.sock');home=join(dir,'home');bin=join(dir,'bin');project=join(dir,"project ' ; literal");
 mkdirSync(project);mkdirSync(bin);mkdirSync(home);mkdirSync(join(dir,'calls'));
 const script=join(dir,'fake-agent.py');writeFileSync(script,String.raw`import os, sys, json, time
if '--help' in sys.argv:
 print('Fixture CLI '+('--approve-for-me' if os.path.exists('FIXTURE_POLICY_SUPPORT') else ''));sys.exit(0)
with open(os.path.join('FIXTURE_CALLS_DIRECTORY',str(os.getpid())+'.json'),'w') as f:
 json.dump(dict(args=sys.argv[1:],cwd=os.getcwd()),f)
print('Fixture agent ready',flush=True)
while True: time.sleep(1)
`.replace('FIXTURE_CALLS_DIRECTORY',join(dir,'calls')).replace('FIXTURE_POLICY_SUPPORT',join(dir,'policy-support')));
 for(const kind of ['codex','claude','pi']){const path=join(bin,kind);writeFileSync(path,`#!/bin/bash\nexec -a ${kind} /usr/bin/python3 ${script} "$@"\n`);chmodSync(path,0o755);}
 const codexHome=join(home,'codex'),claudeHome=join(home,'claude');
 const logs=join(codexHome,'sessions/2026/11/01');mkdirSync(logs,{recursive:true});
 writeFileSync(join(logs,'rollout-existing.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',cwd:project,timestamp:'2026-11-01T12:00:00Z'}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Continue building the test project'}]}})+'\n');
 const claudeLogs=join(claudeHome,'projects',project.replace(/[^a-zA-Z0-9]/g,'-'));mkdirSync(claudeLogs,{recursive:true});writeFileSync(join(claudeLogs,'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl'),JSON.stringify({type:'user',cwd:project,sessionId:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',timestamp:'2026-11-01T12:00:00Z',message:{role:'user',content:'Resume the Claude test task'}})+'\n');
 tmux('-f','/dev/null','new-session','-d','-s','original','-c',project,'-x','150','-y','45','/bin/sleep','86400');
 let remote='';
 if(existsSync('/usr/sbin/sshd')){
  command('ssh-keygen',['-q','-t','ed25519','-N','','-f',join(dir,'hostkey')]);command('ssh-keygen',['-q','-t','ed25519','-N','','-f',join(dir,'identity')]);writeFileSync(join(dir,'authorized_keys'),readFileSync(join(dir,'identity.pub')),{mode:0o600});const p=await port();
  // Only the fixture SSH daemon supplies these test homes and PATH.
  writeFileSync(join(dir,'sshd_config'),`Port ${p}\nListenAddress 127.0.0.1\nHostKey ${dir}/hostkey\nAuthorizedKeysFile ${dir}/authorized_keys\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nPidFile ${dir}/sshd.pid\nAllowUsers ${userInfo().username}\nSetEnv PATH=${bin}:/usr/local/bin:/usr/bin:/bin CODEX_HOME=${codexHome} CLAUDE_CONFIG_DIR=${claudeHome} CC_FIXTURE_CALLS=${dir}/calls\nLogLevel ERROR\n`);
  sshd=spawn('/usr/sbin/sshd',['-D','-e','-f',join(dir,'sshd_config')],{stdio:'pipe'});
  writeFileSync(join(dir,'known_hosts'),`[127.0.0.1]:${p} ${readFileSync(join(dir,'hostkey.pub'),'utf8')}`);
  writeFileSync(join(dir,'ssh_config'),`Host launch-fixture\n HostName 127.0.0.1\n Port ${p}\n User ${userInfo().username}\n IdentityFile ${dir}/identity\n IdentitiesOnly yes\n UserKnownHostsFile ${dir}/known_hosts\n`);
  remote=`\n[[hosts]]\nid="remote"\nname="Remote"\nsocket=${JSON.stringify(socket)}\nssh="launch-fixture"\nssh_config=${JSON.stringify(join(dir,'ssh_config'))}\n`;
 }
 const p=await port();base=`http://127.0.0.1:${p}`;
 writeFileSync(join(dir,'config'),`[[hosts]]\nid="local"\nname="Local"\nsocket=${JSON.stringify(socket)}\n[[hosts.projects]]\npath=${JSON.stringify(project)}\nname="Pinned test project"\n${remote}`);
 backend=spawn(resolve(process.env.CC_BINARY||'../target/debug/command-center'),['--listen',`127.0.0.1:${p}`,'--config',join(dir,'config'),'--web-dir',resolve(process.env.CC_WEB_DIR||'dist')],{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,CODEX_HOME:codexHome,CLAUDE_CONFIG_DIR:claudeHome,PI_CODING_AGENT_DIR:join(dir,'pi-home'),CC_FIXTURE_CALLS:join(dir,'calls')},stdio:'pipe'});
 await expect.poll(async()=>{try{return(await api('/api/v1/health')).status;}catch{return 0;}}).toBe(200);
});
test.afterAll(()=>{backend?.kill('SIGTERM');sshd?.kill('SIGTERM');if(socket)spawnSync('tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});
function calls(){return readdirSync(join(dir,'calls')).map(f=>JSON.parse(readFileSync(join(dir,'calls',f),'utf8')));}

test('new and resumed agents use literal directories, explicit session IDs and single-use grants',async()=>{
 const before=tmux('display-message','-p','-t','original','#{window_width}x#{window_height}/#{pane_pid}');
 const prepared=await prepare();expect(prepared.project).toBe(project);expect(prepared.conversations[0].title).toContain('Continue building');
 expect((await launch(prepared,'unlisted')).status).toBe(400);
 const r=await launch(prepared);expect(r.status,await r.clone().text()).toBe(200);const started=await r.json();
 await expect.poll(async()=> (await status(prepared)).running).toBe(true);
 expect((await launch(prepared)).status).toBe(410);
 await expect.poll(()=>calls().length).toBe(1);expect(calls()[0].cwd).toBe(project);expect(calls()[0].args).toEqual([]);
 expect(tmux('display-message','-p','-t','original','#{window_width}x#{window_height}/#{pane_pid}')).toBe(before);
 const resume=await prepare();const rr=await launch(resume,resume.conversations[0].id);expect(rr.status).toBe(200);
 await expect.poll(()=>calls().length).toBe(2);expect(calls().some(c=>JSON.stringify(c.args)===JSON.stringify(['resume','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']))).toBe(true);
 const active=await prepare();expect(active.conversations[0].active).toBe(true);
 const claude=await prepare('claude');expect((await launch(claude,claude.conversations[0].id)).status).toBe(200);
 await expect.poll(()=>calls().length).toBe(3);expect(calls().some(c=>JSON.stringify(c.args)===JSON.stringify(['--resume','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']))).toBe(true);
 const freshClaude=await prepare('claude');expect((await launch(freshClaude)).status).toBe(200);
 await expect.poll(()=>calls().length).toBe(4);expect(calls().some(c=>JSON.stringify(c.args)===JSON.stringify(['--session-id',freshClaude.launch_id]))).toBe(true);
 expect(started.session).toMatch(/^\$/);
 const other=tmux('new-window','-P','-F','#{window_id}','-t',started.session,'-n','other-window','/bin/sleep','86400');
 const recovered=await status(prepared);expect(recovered.pane).toBe(started.pane);expect(recovered.window).toBe(started.window);
 tmux('kill-window','-t',other);
});

test('launch rejects replaced directories and stale endpoints; SSH launches survive backend restart',async()=>{
 const target=join(dir,'symlink-project');symlinkSync(project,target);
 const stale=await prepare('codex',target);const moved=join(dir,'moved');mkdirSync(moved);rmSync(target);symlinkSync(moved,target);
 // Canonical preparation makes the original directory authoritative; changing
 // the alias cannot redirect a launch into another directory.
 expect((await launch(stale)).status).toBe(200);
 const replacedDir=join(dir,'replace-me');mkdirSync(replacedDir);const replaced=await prepare('codex',replacedDir);renameSync(replacedDir,replacedDir+'-old');mkdirSync(replacedDir);
 expect((await launch(replaced)).status).toBe(409);
 const settings=await(await api('/api/v1/settings/hosts')).json();const old=await prepare();const alias=join(dir,'alias.sock');symlinkSync(socket,alias);
 const edit=await fetch(base+'/api/v1/hosts/local',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({revision:settings.revision,host:{name:'Local',socket:alias,ssh:null,ssh_config:null}})});expect(edit.status).toBe(200);expect((await launch(old)).status).toBe(409);
 if(sshd){const remote=await prepare('codex',project,'remote');expect((await launch(remote,null,'remote')).status).toBe(200);await expect.poll(async()=>(await status(remote,'remote')).running).toBe(true);
 const args=backend.spawnargs.slice(),env=backend.spawnfile;const exit=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exit;
 backend=spawn(args[0],args.slice(1),{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,CODEX_HOME:join(home,'codex'),CLAUDE_CONFIG_DIR:join(home,'claude'),PI_CODING_AGENT_DIR:join(dir,'pi-home'),CC_FIXTURE_CALLS:join(dir,'calls')},stdio:'pipe'});
 await expect.poll(async()=>{try{return(await api('/api/v1/health')).status;}catch{return 0;}}).toBe(200);expect((await status(remote,'remote')).found).toBe(true);expect((await launch(remote,null,'remote')).status).toBe(410);expect(env).toBeTruthy();}
});

test('phone launcher uses shared pinned projects, launches a new chat and never attaches a terminal',async({page})=>{
 test.setTimeout(60000);const terminal:string[]=[];page.on('request',r=>{if(r.url().includes('/terminal'))terminal.push(r.url());});
 await page.setViewportSize({width:393,height:852});await page.goto(base);
 await page.getByRole('button',{name:'Start agent',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Start an agent'});
 await expect(dialog.getByLabel('Agent project',{exact:true})).toContainText('Pinned test project');
 await dialog.getByLabel('Agent provider',{exact:true}).selectOption('claude');
 await expect(dialog.getByRole('button',{name:'Start Claude',exact:true})).toBeEnabled({timeout:15000});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'../test-results/agent-launch-phone.png'});
 await dialog.getByRole('button',{name:'Start Claude',exact:true}).click();
 await expect(dialog).toBeHidden({timeout:20000});
 await expect(page.getByRole('button',{name:'← Agents',exact:true})).toBeVisible();await expect(page.locator('.queue-chat-subtitle')).toContainText('Local');expect(terminal).toEqual([]);
});

test('manual directories can be pinned and resumed from the same shared project inventory',async({page})=>{
 const manual=join(dir,'manual project');mkdirSync(manual);
 writeFileSync(join(home,'codex/sessions/2026/11/01/rollout-manual.jsonl'),JSON.stringify({type:'session_meta',payload:{id:'cccccccc-cccc-cccc-cccc-cccccccccccc',cwd:manual,timestamp:'2026-11-01T13:00:00Z'}})+'\n'+JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'Resume this manual project'}]}})+'\n');
 await page.setViewportSize({width:393,height:852});await page.goto(base);await page.getByRole('button',{name:'Start agent',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Start an agent'});
 await expect(dialog.getByLabel('Agent project',{exact:true})).toContainText('Another directory');
 await dialog.getByLabel('Agent project',{exact:true}).selectOption('');await dialog.getByLabel('Project directory',{exact:true}).fill(manual);
 await dialog.getByRole('checkbox').check();await dialog.getByRole('textbox',{name:'Pinned project name',exact:true}).fill('My manual project');
 await dialog.getByRole('button',{name:'Check project',exact:true}).click();
 await expect(dialog.getByLabel('Start or resume',{exact:true})).toContainText('Resume this manual project');
 const conversation=await dialog.getByLabel('Start or resume',{exact:true}).locator('option').nth(1).getAttribute('value');
 await dialog.getByLabel('Start or resume',{exact:true}).selectOption(conversation!);
 await dialog.getByRole('button',{name:'Resume Codex',exact:true}).click();await expect(dialog).toBeHidden({timeout:15000});
 const projects=await(await api('/api/v1/hosts/local/projects')).json();expect(projects.projects.some((p:{path:string;name:string;pinned:boolean})=>p.path===manual&&p.name==='My manual project'&&p.pinned)).toBe(true);
 expect(calls().some(c=>c.cwd===manual&&JSON.stringify(c.args)===JSON.stringify(['resume','cccccccc-cccc-cccc-cccc-cccccccccccc']))).toBe(true);
});

test('a lost launch response survives a phone reload and recovery never launches a second agent',async({page})=>{
 await page.setViewportSize({width:393,height:852});await page.goto(base);await page.getByRole('button',{name:'Start agent',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Start an agent'});
 await expect(dialog.getByRole('button',{name:'Start Codex',exact:true})).toBeEnabled({timeout:10000});
 const before=calls().length;
 await page.route('**/agents/launch',async route=>{const response=await route.fetch();expect(response.status()).toBe(200);await route.fulfill({status:502,json:{error:'Fixture lost launch response'}});});
 await dialog.getByRole('button',{name:'Start Codex',exact:true}).click();
 await expect(dialog).toContainText('Use Check launch');await expect.poll(()=>calls().length).toBe(before+1);
 const receipt=await page.evaluate(()=>JSON.parse(localStorage.getItem('cc.pending-agent-launch.v1')!));expect(receipt.id).toBeTruthy();
 await page.reload();await page.getByRole('button',{name:'Start agent',exact:true}).click();
 await expect(dialog.getByLabel('Agent machine',{exact:true})).toBeDisabled();
 await dialog.getByRole('button',{name:'Check launch',exact:true}).click();await expect(dialog).toBeHidden({timeout:15000});
 expect(calls().length).toBe(before+1);expect(await page.evaluate(()=>localStorage.getItem('cc.pending-agent-launch.v1'))).toBeNull();
 await expect(page.getByRole('button',{name:'← Agents',exact:true})).toBeVisible();
});


test('explicit models are bound to preparation and passed literally for new and resumed harnesses',async()=>{
 const custom=join(dir,'model-project');mkdirSync(custom);
 const codex=await prepare('codex',custom,'local','fixture-model-v1');expect(codex.model).toBe('fixture-model-v1');
 const start=await launch(codex);expect(start.status).toBe(200);expect((await start.json()).model).toBe('fixture-model-v1');
 await expect.poll(()=>calls().some(c=>c.cwd===custom&&JSON.stringify(c.args)===JSON.stringify(['--model','fixture-model-v1']))).toBe(true);
 const fresh=await prepare('claude',custom,'local','fixture-alias[1m]');expect((await launch(fresh)).status).toBe(200);
 await expect.poll(()=>calls().some(c=>c.cwd===custom&&JSON.stringify(c.args)===JSON.stringify(['--session-id',fresh.launch_id,'--model','fixture-alias[1m]']))).toBe(true);
 const id='dddddddd-dddd-dddd-dddd-dddddddddddd';
 writeFileSync(join(home,'codex/sessions/2026/11/01/rollout-model.jsonl'),JSON.stringify({type:'session_meta',payload:{id,cwd:custom,timestamp:'2026-11-01T14:00:00Z'}})+'\n');
 const resume=await prepare('codex',custom,'local','fixture-resume-model');expect((await launch(resume,resume.conversations[0].id)).status).toBe(200);
 await expect.poll(()=>calls().some(c=>JSON.stringify(c.args)===JSON.stringify(['resume',id,'--model','fixture-resume-model']))).toBe(true);
 const claudeId='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
 const claudeLogs=join(home,'claude/projects',custom.replace(/[^a-zA-Z0-9]/g,'-'));mkdirSync(claudeLogs,{recursive:true});
 writeFileSync(join(claudeLogs,claudeId+'.jsonl'),JSON.stringify({type:'user',cwd:custom,sessionId:claudeId,message:{role:'user',content:'Resume model fixture'}})+'\n');
 const claudeResume=await prepare('claude',custom,'local','fixture-resume-alias');expect((await launch(claudeResume,claudeResume.conversations[0].id)).status).toBe(200);
 await expect.poll(()=>calls().some(c=>JSON.stringify(c.args)===JSON.stringify(['--resume',claudeId,'--model','fixture-resume-alias']))).toBe(true);
 if(sshd){const remote=await prepare('codex',custom,'remote','fixture-ssh-model');expect((await launch(remote,null,'remote')).status).toBe(200);await expect.poll(()=>calls().some(c=>JSON.stringify(c.args)===JSON.stringify(['--model','fixture-ssh-model']))).toBe(true);}
 const hosts=await(await api('/api/v1/hosts')).json();
 const bad=await api('/api/v1/hosts/local/agents/launch-options?'+new URLSearchParams({provider:'codex',path:custom,connection_revision:hosts.find((h:{id:string})=>h.id==='local').connection_revision,model:'--bad-flag'}));expect(bad.status).toBe(400);
});

test('phone model selection defaults to the harness and resets when changing providers',async({page})=>{
 await page.setViewportSize({width:393,height:852});await page.goto(base);await page.getByRole('button',{name:'Start agent',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Start an agent'}), model=dialog.getByRole('textbox',{name:'Agent model',exact:true});
 await expect(model).toHaveValue('');await expect(model).toHaveAttribute('placeholder','Harness default');
 await model.fill('fixture-phone-model');await dialog.getByRole('button',{name:'Check project',exact:true}).click();await expect(dialog.getByRole('button',{name:'Start Codex',exact:true})).toBeEnabled();
 await dialog.getByLabel('Agent provider',{exact:true}).selectOption('claude');await expect(model).toHaveValue('');
 await model.fill('fixture-claude-model');await dialog.getByRole('button',{name:'Check project',exact:true}).click();await expect(dialog.getByRole('button',{name:'Start Claude',exact:true})).toBeEnabled();
 await page.screenshot({path:'../test-results/agent-model-phone.png'});
 await dialog.getByRole('button',{name:'Start Claude',exact:true}).click();await expect(dialog).toBeHidden({timeout:15000});
 expect(calls().some(c=>c.args.includes('--model')&&c.args.includes('fixture-claude-model'))).toBe(true);
});


test('pi supports native fresh launch, explicit file resume, model override and replay protection',async()=>{
 const prepared=await prepare('pi',project,'local','provider/model');
 const before=calls().length;
 expect((await launch(prepared)).status).toBe(200);
 await expect.poll(()=>calls().length).toBe(before+1);
 expect(calls().some(c=>JSON.stringify(c.args)===JSON.stringify(['--model','provider/model']))).toBe(true);
 expect((await launch(prepared)).status).toBe(410);
 const logs=join(dir,'pi-sessions');mkdirSync(logs);
 const file=join(logs,'pi.jsonl');
 writeFileSync(file,JSON.stringify({type:'session',version:3,id:'dddddddd-dddd-dddd-dddd-dddddddddddd',cwd:project,timestamp:'2026-11-01T12:00:00Z'})+'\n'+JSON.stringify({type:'message',id:'one',parentId:null,message:{role:'user',content:'Continue the pi task'}})+'\n');
 // Use an explicit provider directory supplied by the fixture backend.
 const encoded='--'+project.replace(/^[/\\]+/,'').replace(/[/\\:]/g,'-')+'--';
 const native=join(dir,'pi-home','sessions',encoded);mkdirSync(native,{recursive:true});
 const {copyFileSync}=await import('node:fs');copyFileSync(file,join(native,'pi.jsonl'));
 const resume=await prepare('pi');expect(resume.conversations).toHaveLength(1);expect(resume.conversations[0].title).toBe('Continue the pi task');
 expect((await launch(resume,resume.conversations[0].id)).status).toBe(200);
 await expect.poll(()=>calls().length).toBe(before+2);
 expect(calls().some(c=>JSON.stringify(c.args)===JSON.stringify(['--session',join(native,'pi.jsonl')]))).toBe(true);
 expect((await prepare('pi')).conversations[0].active).toBe(true);
});


test('phone launcher offers pi and starts it without a terminal viewer',async({page})=>{
 const terminal:string[]=[];page.on('request',r=>{if(r.url().includes('/terminal'))terminal.push(r.url());});
 await page.setViewportSize({width:393,height:852});await page.goto(base);
 await page.getByRole('button',{name:'Start agent',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Start an agent'});
 await dialog.getByLabel('Agent provider',{exact:true}).selectOption('pi');
 await expect(dialog.getByRole('button',{name:'Start pi',exact:true})).toBeEnabled({timeout:15000});
 await expect(dialog).toContainText('pi available');
 await dialog.getByRole('button',{name:'Start pi',exact:true}).click();
 await expect(dialog).toBeHidden({timeout:15000});expect(terminal).toEqual([]);
});

// Tickets exercise the same native launcher using fixture executables only.
async function boardTicket(title='Board fixture',provider='codex',host='local') {
 const hosts=await(await api('/api/v1/hosts')).json(),m=hosts.find((h:{id:string})=>h.id===host);
 const r=await api('/api/v1/board/tickets',{id:crypto.randomUUID(),revision:null,title,description:'## Work\n\nDo the fixture task. <img src="https://ticket-spy.invalid/pixel">',status:'ready',priority:'high',context:{host,path:project,provider,model:'',session:'',window:'',pane:'',session_name:'',window_name:'',conversation:''},checklist:[{id:'one',text:'Validate the result',done:false}],host_revision:m.connection_revision});expect(r.status,await r.clone().text()).toBe(200);return r.json();
}
async function boardPrepare(t:any,provider='codex',host='local',prompt='Ticket fixture prompt\n$(touch /tmp/cc-ticket-must-not-exist) `literal` #{pane_id} --model malicious') {
 const hosts=await(await api('/api/v1/hosts')).json(),m=hosts.find((h:{id:string})=>h.id===host);
 const r=await api(`/api/v1/board/tickets/${t.id}/prepare`,{revision:t.revision,host,connection_revision:m.connection_revision,path:project,provider,model:'fixture/model',prompt});expect(r.status,await r.clone().text()).toBe(200);return r.json();
}
test('tickets launch native Codex, Claude and pi with reviewed literal prompts and durable links',async()=>{
 const before=tmux('display-message','-p','-t','original','#{pane_pid}/#{window_width}x#{window_height}');
 for(const provider of ['codex','claude','pi']){const t=await boardTicket(`Ticket ${provider}`,provider);const p=await boardPrepare(t,provider);const n=calls().length;const r=await api(`/api/v1/board/tickets/${t.id}/launch`,{token:p.token});expect(r.status,await r.clone().text()).toBe(200);await expect.poll(()=>calls().length).toBe(n+1);const c=calls().find(c=>c.args.at(-1)?.startsWith('Ticket fixture prompt')&&c.args.includes('fixture/model'));expect(c).toBeTruthy();expect(c.args.at(-2)).toBe('--');expect(existsSync('/tmp/cc-ticket-must-not-exist')).toBe(false);const saved=await(await api(`/api/v1/board/tickets/${t.id}`)).json();expect(saved.status).toBe('in_progress');expect(saved.runs).toHaveLength(1);expect(saved.runs[0].prompt).toContain('$(touch');expect(saved.runs[0].result.context).toBeUndefined();expect((await api(`/api/v1/board/tickets/${t.id}/launch`,{token:p.token})).status).toBe(410);const target=await(await api(`/api/v1/board/tickets/${t.id}/target`)).json();expect(target.terminal.pane).toBe(saved.runs[0].result.pane);}
 expect(tmux('display-message','-p','-t','original','#{pane_pid}/#{window_width}x#{window_height}')).toBe(before);
});
test('ticket launch claims reject competing clients, stale edits and cross-ticket grants',async()=>{
 const t=await boardTicket('Concurrent launch'),other=await boardTicket('Other ticket');const a=await boardPrepare(t),b=await boardPrepare(t);expect((await api(`/api/v1/board/tickets/${other.id}/launch`,{token:a.token})).status).toBe(409);const before=calls().length;const responses=await Promise.all([a,b].map(p=>api(`/api/v1/board/tickets/${t.id}/launch`,{token:p.token})));expect(responses.map(r=>r.status).sort()).toEqual([200,409]);await expect.poll(()=>calls().length).toBe(before+1);
 const stale=await boardTicket('Changed before launch'),grant=await boardPrepare(stale);const moved=await api(`/api/v1/board/tickets/${stale.id}/move`,{revision:stale.revision,status:'blocked'});expect(moved.status).toBe(200);expect((await api(`/api/v1/board/tickets/${stale.id}/launch`,{token:grant.token})).status).toBe(409);expect(calls().length).toBe(before+1);
});
test('board supports context capture, Markdown, checklist, drag and move without losing conflicting drafts',async({page,browser})=>{
 await page.addInitScript(()=>Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true}));await page.goto(base);await expect(page.locator('#connection')).toHaveText('Attached');await page.locator('#ticket-from-terminal').click();const d=page.getByRole('dialog',{name:'Ticket',exact:true});await expect(d.getByLabel('Ticket machine',{exact:true})).toHaveValue('local');await d.getByLabel('Ticket title',{exact:true}).fill('Build fixture board');await d.getByLabel('Ticket Markdown description',{exact:true}).fill('## Acceptance\n\n**Bold fixture**\n<script>window.ticketScript=true</script>');await d.getByRole('button',{name:'Add checklist item',exact:true}).click();await d.getByLabel('Checklist item',{exact:true}).fill('Run checks');await d.getByRole('button',{name:'Save ticket',exact:true}).click();await expect(d).toContainText('Saved');await d.getByRole('button',{name:'Preview Markdown',exact:true}).click();await expect(d.locator('.ticket-markdown strong')).toHaveText('Bold fixture');expect(await page.evaluate(()=>(window as any).ticketScript)).toBeUndefined();const title=d.getByLabel('Ticket title',{exact:true});await title.fill('Preserved conflicting draft');const list=await(await api('/api/v1/board/tickets')).json();const t=list.tickets.find((t:any)=>t.title==='Build fixture board');await api(`/api/v1/board/tickets/${t.id}/move`,{revision:t.revision,status:'ready'});await d.getByRole('button',{name:'Save ticket',exact:true}).click();await expect(d).toContainText('Ticket changed in another client');await expect(title).toHaveValue('Preserved conflicting draft');page.once('dialog',dialog=>dialog.accept());await d.getByRole('button',{name:'Close',exact:true}).click();await page.locator('#show-board').click();const card=page.locator('.ticket-card').filter({hasText:'Build fixture board'});await card.dragTo(page.locator('.board-lane[data-status=blocked]'),{targetPosition:{x:100,y:20}});await expect(page.locator('.board-lane[data-status=blocked]')).toContainText('Build fixture board');await page.screenshot({path:'../test-results/board-desktop.png'});
 const phone=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});let sockets=0;phone.on('websocket',s=>{if(s.url().includes('/terminal?'))sockets++;});const before=tmux('display-message','-p','-t','original','#{pane_pid}/#{window_width}x#{window_height}');await phone.goto(base);await phone.locator('#show-board').click();await phone.getByLabel('Board column',{exact:true}).selectOption('blocked');await phone.getByRole('button',{name:'Build fixture board',exact:true}).click();await expect(phone.getByRole('button',{name:'Open terminal',exact:true})).toBeHidden();await phone.screenshot({path:'../test-results/board-ticket-phone.png'});await phone.getByRole('button',{name:'Close',exact:true}).click();await phone.screenshot({path:'../test-results/board-phone.png'});expect(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(sockets).toBe(0);expect(tmux('display-message','-p','-t','original','#{pane_pid}/#{window_width}x#{window_height}')).toBe(before);await phone.close();
});
test('lost ticket launch response checks the existing agent and survives backend restart without retry',async({page})=>{
 const t=await boardTicket('Recover fixture launch','pi');await page.setViewportSize({width:393,height:852});await page.goto(base);await page.locator('#show-board').click();await page.getByRole('button',{name:t.title,exact:true}).click();await page.getByRole('dialog',{name:'Ticket',exact:true}).getByRole('button',{name:'Start agent',exact:true}).click();const d=page.getByRole('dialog',{name:'Start ticket agent',exact:true});await expect(d.getByLabel('Ticket agent provider',{exact:true})).toHaveValue('pi');await d.getByRole('button',{name:'Check project',exact:true}).click();await expect(d.getByRole('button',{name:'Start agent',exact:true})).toBeEnabled();const before=calls().length;await page.route(`**/api/v1/board/tickets/${t.id}/launch`,async route=>{await route.fetch();await route.abort();});await d.getByRole('button',{name:'Start agent',exact:true}).click();await expect(d).toBeHidden();await expect.poll(()=>calls().length).toBe(before+1);await expect(page.getByRole('dialog',{name:'Ticket',exact:true}).getByRole('button',{name:'Check launch',exact:true})).toBeVisible();
 const args=backend.spawnargs.slice(),env=backend.spawnfile;const exited=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exited;backend=spawn(args[0],args.slice(1),{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,CODEX_HOME:join(home,'codex'),CLAUDE_CONFIG_DIR:join(home,'claude'),PI_CODING_AGENT_DIR:join(dir,'pi-home'),CC_FIXTURE_CALLS:join(dir,'calls')},stdio:'pipe'});await expect.poll(async()=>{try{return(await api('/api/v1/health')).status;}catch{return 0;}}).toBe(200);const saved=await(await api(`/api/v1/board/tickets/${t.id}`)).json();expect(saved.runs).toHaveLength(1);expect(saved.runs[0].prompt).toContain(t.title);expect((await api(`/api/v1/board/tickets/${t.id}/check`,{revision:saved.revision})).status).toBe(200);expect(calls().length).toBe(before+1);expect(env).toBeTruthy();
});

test('SSH ticket launches retain endpoint-qualified links and reject a changed remote endpoint',async()=>{
 test.skip(!sshd,'fixture SSH daemon unavailable');const t=await boardTicket('Remote ticket','pi','remote'),p=await boardPrepare(t,'pi','remote');const before=calls().length;const r=await api(`/api/v1/board/tickets/${t.id}/launch`,{token:p.token});expect(r.status,await r.clone().text()).toBe(200);await expect.poll(()=>calls().length).toBe(before+1);const saved=await(await api(`/api/v1/board/tickets/${t.id}`)).json();const hosts=await(await api('/api/v1/settings/hosts')).json();const host=hosts.hosts.find((h:any)=>h.id==='remote');const alias=join(dir,'board-remote.sock');symlinkSync(socket,alias);const edit=await fetch(base+'/api/v1/hosts/remote',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({revision:hosts.revision,host:{name:host.name,ssh:host.ssh,socket:alias,ssh_config:host.ssh_config,ssh_jump:host.ssh_jump||null}})});expect(edit.status).toBe(200);expect((await api(`/api/v1/board/tickets/${t.id}/target`)).status).toBe(409);expect((await api(`/api/v1/board/tickets/${t.id}/check`,{revision:saved.revision})).status).toBe(409);const machine=(await(await api('/api/v1/hosts')).json()).find((h:any)=>h.id==='remote');const update=await api('/api/v1/board/tickets',{id:t.id,revision:saved.revision,title:saved.title,description:'Notes remain editable after a machine route changes',status:saved.status,priority:saved.priority,context:saved.context,checklist:saved.checklist,host_revision:machine.connection_revision});expect(update.status).toBe(200);expect((await update.json()).context.endpoint).toBe(saved.context.endpoint);expect(calls().length).toBe(before+1);
});

test('successful ticket UI launch opens the original agent conversation without attaching a phone terminal',async({page})=>{
 const t=await boardTicket('Review and start fixture','claude');await page.setViewportSize({width:393,height:852});let sockets=0;page.on('websocket',w=>{if(w.url().includes('/terminal?'))sockets++;});await page.goto(base);await page.locator('#show-board').click();await page.getByRole('button',{name:t.title,exact:true}).click();await page.getByRole('dialog',{name:'Ticket',exact:true}).getByRole('button',{name:'Start agent',exact:true}).click();const launch=page.getByRole('dialog',{name:'Start ticket agent',exact:true});await expect(launch.getByLabel('Tmux window name',{exact:true})).toHaveValue(`CC-${t.number}`);await launch.getByLabel('Tmux window name',{exact:true}).fill('Ticket UI window');await launch.getByLabel('Agent card name',{exact:true}).fill('Ticket UI agent');await launch.getByLabel('Ticket agent model',{exact:true}).fill('fixture-ui-model');await launch.getByLabel('Initial ticket prompt',{exact:true}).fill('Reviewed UI fixture prompt');await launch.getByRole('button',{name:'Check project',exact:true}).click();await expect(launch.getByRole('button',{name:'Start agent',exact:true})).toBeEnabled();await launch.getByRole('button',{name:'Start agent',exact:true}).click();await expect(launch).toBeHidden({timeout:15000});const ticket=page.getByRole('dialog',{name:'Ticket',exact:true});await expect(ticket.getByRole('button',{name:'Open agent conversation',exact:true})).toBeVisible();const saved=await(await api(`/api/v1/board/tickets/${t.id}`)).json();expect(saved.runs[0].model).toBe('fixture-ui-model');expect(saved.runs[0].window_name).toBe('Ticket UI window');expect(saved.runs[0].card_name).toBe('Ticket UI agent');expect(tmux('display-message','-p','-t',saved.runs[0].result.window,'#{window_name}')).toBe('Ticket UI window');const queue=await(await api('/api/v1/queue')).json();const card=queue.hosts.flatMap((h:any)=>h.items).find((a:any)=>a.pane===saved.runs[0].result.pane);expect(card.card.name).toBe('Ticket UI agent');expect(saved.runs[0].result.identity).toMatch(/^[a-f0-9]{64}$/);await ticket.getByRole('button',{name:'Open agent conversation',exact:true}).click();await expect(ticket).toBeHidden();await expect(page.locator('#queue-pane')).toBeVisible();await expect(page.locator('.queue-chat-header')).toBeVisible();expect(sockets).toBe(0);
});

test('an exited ticket agent stays In progress until human review and explicitly allows another attempt',async()=>{
 const t=await boardTicket('Explicitly review completed attempt'),p=await boardPrepare(t);const started=await api(`/api/v1/board/tickets/${t.id}/launch`,{token:p.token});expect(started.status).toBe(200);const result=await started.json();let saved=await(await api(`/api/v1/board/tickets/${t.id}`)).json();expect((await api(`/api/v1/board/tickets/${t.id}/release`,{revision:saved.revision})).status).toBe(409);tmux('send-keys','-t',result.pane,'C-c');await expect.poll(()=>tmux('display-message','-p','-t',result.pane,'#{pane_dead}')).toBe('1');expect((await api(`/api/v1/board/tickets/${t.id}/check`,{revision:saved.revision})).status).toBe(200);saved=await(await api(`/api/v1/board/tickets/${t.id}`)).json();expect(saved.status).toBe('in_progress');expect(saved.runs[0].result.exited).toBe(true);const released=await api(`/api/v1/board/tickets/${t.id}/release`,{revision:saved.revision});expect(released.status).toBe(200);const ticket=await released.json();expect(ticket.runs[0].released).toBe(true);const another=await boardPrepare(ticket);expect(another.launch_id).not.toBe(p.launch_id);expect((await api(`/api/v1/board/tickets/${t.id}/move`,{revision:ticket.revision,status:'done'})).status).toBe(200);
});

async function windowPrepare(target_session:string,provider='codex',host='local'){
 const hosts=await(await api('/api/v1/hosts')).json(),revision=hosts.find((h:any)=>h.id===host).connection_revision;
 const r=await api(`/api/v1/hosts/${host}/agents/launch-options?${new URLSearchParams({provider,path:project,connection_revision:revision,target_session})}`);expect(r.status,await r.clone().text()).toBe(200);return {...await r.json(),revision};
}
test('new windows in an existing session preserve selection, panes and per-agent recovery metadata',async()=>{
 const sid=tmux('display-message','-p','-t','original','#{session_id}');const before=tmux('list-panes','-t',sid,'-F','#{pane_id}/#{pane_pid}/#{window_width}x#{window_height}');const active=tmux('display-message','-p','-t',sid,'#{window_id}');const sessionNames=tmux('list-sessions','-F','#{session_id}');
 const a=await windowPrepare(sid),b=await windowPrepare(sid,'pi');const ar=await launch(a),br=await launch(b);expect(ar.status,await ar.clone().text()).toBe(200);expect(br.status,await br.clone().text()).toBe(200);const one=await ar.json(),two=await br.json();expect(one.session).toBe(sid);expect(two.session).toBe(sid);expect(one.window).not.toBe(two.window);expect(one.destination).toBe('window');expect(tmux('list-sessions','-F','#{session_id}')).toBe(sessionNames);expect(tmux('display-message','-p','-t',sid,'#{window_id}')).toBe(active);expect(tmux('list-panes','-t',sid+':'+active,'-F','#{pane_id}/#{pane_pid}/#{window_width}x#{window_height}')).toBe(before);
 tmux('rename-window','-t',one.window,'Agent renamed');tmux('move-window','-s',sid+':'+one.window,'-t',sid+':99');tmux('rename-session','-t',sid,'renamed original');expect((await status(a)).pane).toBe(one.pane);expect((await status(b)).pane).toBe(two.pane);expect((await launch(a)).status).toBe(410);tmux('rename-session','-t',sid,'original');
});
test('removed or private viewer session destinations fail closed without falling back to a new session',async()=>{
 const sid=tmux('new-session','-d','-P','-F','#{session_id}','-s','launch-parent','-c',project,'/bin/sleep','86400');const p=await windowPrepare(sid);tmux('kill-session','-t',sid);const before=calls().length;expect((await launch(p)).status).toBe(409);expect(calls().length).toBe(before);expect((await status(p)).found).toBe(false);
 const viewer=tmux('new-session','-d','-P','-F','#{session_id}','-s','cc-view-fixture-parent','/bin/sleep','86400');const hosts=await(await api('/api/v1/hosts')).json();const query=new URLSearchParams({provider:'pi',path:project,connection_revision:hosts.find((h:any)=>h.id==='local').connection_revision,target_session:viewer});expect((await api('/api/v1/hosts/local/agents/launch-options?'+query)).status).toBe(409);tmux('kill-session','-t',viewer);
});
test('ticket window launches persist the destination and recover two launches in the same session',async()=>{
 const sid=tmux('display-message','-p','-t','original','#{session_id}');for(let n=0;n<2;n++){const t=await boardTicket('Window ticket '+n,'pi');const hosts=await(await api('/api/v1/hosts')).json();const r=await api(`/api/v1/board/tickets/${t.id}/prepare`,{revision:t.revision,host:'local',connection_revision:hosts.find((h:any)=>h.id==='local').connection_revision,path:project,provider:'pi',model:null,prompt:'Window ticket fixture',target_session:sid});expect(r.status).toBe(200);const p=await r.json();expect((await api(`/api/v1/board/tickets/${t.id}/launch`,{token:p.token})).status).toBe(200);const saved=await(await api(`/api/v1/board/tickets/${t.id}`)).json();expect(saved.runs[0].target_session).toBe(sid);expect(saved.runs[0].result.session).toBe(sid);expect((await api(`/api/v1/board/tickets/${t.id}/check`,{revision:saved.revision})).status).toBe(200);}
});
test('phone launch dialogs offer existing sessions without attaching a viewer',async({page})=>{
 const sid=tmux('display-message','-p','-t','original','#{session_id}');await page.setViewportSize({width:393,height:852});let sockets=0;page.on('websocket',s=>{if(s.url().includes('/terminal?'))sockets++;});await page.goto(base);await page.getByRole('button',{name:'Start agent',exact:true}).click();const modal=page.getByRole('dialog',{name:'Start an agent',exact:true});await expect(modal.getByLabel('Agent tmux destination',{exact:true})).toHaveValue('');await modal.getByLabel('Agent tmux destination',{exact:true}).selectOption(sid);await expect(modal.getByRole('button',{name:'Start Codex',exact:true})).toBeEnabled();await expect(modal).toContainText('New window in original');await page.screenshot({path:'../test-results/launch-window-phone.png'});await modal.getByRole('button',{name:'Cancel',exact:true}).click();
 const t=await boardTicket('Phone window launch UI','pi');await page.locator('#show-board').click();await page.getByRole('button',{name:t.title,exact:true}).click();await page.getByRole('dialog',{name:'Ticket',exact:true}).getByRole('button',{name:'Start agent',exact:true}).click();const ticket=page.getByRole('dialog',{name:'Start ticket agent',exact:true});await ticket.getByLabel('Ticket agent tmux destination',{exact:true}).selectOption(sid);await ticket.getByRole('button',{name:'Check project',exact:true}).click();await expect(ticket.getByRole('button',{name:'Start agent',exact:true})).toBeEnabled();await expect(ticket).toContainText('New window in original');await page.screenshot({path:'../test-results/ticket-window-phone.png'});expect(sockets).toBe(0);
});
test('SSH window launches and recovery use the original session and survive backend restart',async()=>{
 test.skip(!sshd,'fixture SSH unavailable');const sid=tmux('display-message','-p','-t','original','#{session_id}');const p=await windowPrepare(sid,'pi','remote'),response=await launch(p,null,'remote');expect(response.status,await response.clone().text()).toBe(200);const created=await response.json();expect(created.session).toBe(sid);const args=backend.spawnargs.slice();const exit=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exit;backend=spawn(args[0],args.slice(1),{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,CODEX_HOME:join(home,'codex'),CLAUDE_CONFIG_DIR:join(home,'claude'),PI_CODING_AGENT_DIR:join(dir,'pi-home'),CC_FIXTURE_CALLS:join(dir,'calls')},stdio:'pipe'});await expect.poll(async()=>{try{return(await api('/api/v1/health')).status;}catch{return 0;}}).toBe(200);expect((await status(p,'remote')).pane).toBe(created.pane);expect((await launch(p,null,'remote')).status).toBe(410);
});

test('legacy dedicated launch metadata and multiple child windows coexist without overwriting session receipts',async()=>{
 const p=await prepare('claude'),response=await launch(p);expect(response.status).toBe(200);const original=await response.json();tmux('set-option','-uw','-t',original.window,'@cc_launch');const legacy=tmux('show-options','-v','-t',original.session,'@cc_launch');expect((await status(p)).pane).toBe(original.pane);const child=await windowPrepare(original.session,'pi');const created=await launch(child);expect(created.status).toBe(200);const result=await created.json();expect(result.session).toBe(original.session);expect(tmux('show-options','-v','-t',original.session,'@cc_launch')).toBe(legacy);expect((await status(p)).pane).toBe(original.pane);expect((await status(child)).pane).toBe(result.pane);
});
test('recovery refuses a moved agent window instead of treating it as an absent launch',async()=>{
 const sid=tmux('display-message','-p','-t','original','#{session_id}'),p=await windowPrepare(sid),response=await launch(p);expect(response.status).toBe(200);const created=await response.json();const other=tmux('new-session','-d','-P','-F','#{session_id}','-s','window-move-destination','/bin/sleep','86400');tmux('move-window','-s',sid+':'+created.window,'-t',other+':');const r=await api(`/api/v1/hosts/local/agents/launch-status?${new URLSearchParams({launch_id:p.launch_id,endpoint:p.endpoint})}`);expect(r.status).toBe(409);
});


test('named ticket windows retain editable cards through checks, rename, and process replacement',async()=>{
 const t=await boardTicket('Named window fixture','pi'),host=(await(await api('/api/v1/hosts')).json()).find((h:any)=>h.id==='local');
 const sid=tmux('display-message','-p','-t','original','#{session_id}');const name="Work ' ; $(literal)";
 const response=await api(`/api/v1/board/tickets/${t.id}/prepare`,{revision:t.revision,host:'local',connection_revision:host.connection_revision,path:project,provider:'pi',model:null,prompt:'Named fixture prompt',target_session:sid,window_name:name,card_name:'Named fixture agent'});expect(response.status).toBe(200);const p=await response.json();
 expect((await api(`/api/v1/board/tickets/${t.id}/launch`,{token:p.token})).status).toBe(200);
 let saved=await(await api(`/api/v1/board/tickets/${t.id}`)).json();await expect.poll(async()=>{saved=await(await api(`/api/v1/board/tickets/${t.id}`)).json();await api(`/api/v1/board/tickets/${t.id}/check`,{revision:saved.revision});saved=await(await api(`/api/v1/board/tickets/${t.id}`)).json();return saved.runs[0].card_initialized;}).toBe(true);
 const result=saved.runs[0].result;expect(result.session).toBe(sid);expect(tmux('display-message','-p','-t',result.window,'#{window_name}')).toBe(name);expect(tmux('show-options','-wv','-t',result.window,'automatic-rename')).toBe('off');
 const target={session:result.session,window:result.window,pane:result.pane,connection_revision:host.connection_revision,instance:result.identity};
 const url='/api/v1/hosts/local/agents/card';const read=async()=>{const response=await fetch(base+url+'?'+new URLSearchParams(target));expect(response.status).toBe(200);return response.json();};
 let card=await read();expect(card.name).toBe('Named fixture agent');
 const edited=await fetch(base+url,{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({target,revision:card.revision,name:'Later edit',notes:'Keep my notes'})});expect(edited.status).toBe(200);
 await api(`/api/v1/board/tickets/${t.id}/check`,{revision:saved.revision});card=await read();expect(card.name).toBe('Later edit');expect(card.notes).toBe('Keep my notes');
 tmux('rename-window','-t',result.window,'Renamed later');saved=await(await api(`/api/v1/board/tickets/${t.id}`)).json();expect((await api(`/api/v1/board/tickets/${t.id}/check`,{revision:saved.revision})).status).toBe(200);expect((await read()).name).toBe('Later edit');
 const args=backend.spawnargs.slice();const exited=new Promise<void>(resolve=>backend.once('exit',()=>resolve()));backend.kill('SIGTERM');await exited;backend=spawn(args[0],args.slice(1),{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,CODEX_HOME:join(home,'codex'),CLAUDE_CONFIG_DIR:join(home,'claude'),PI_CODING_AGENT_DIR:join(dir,'pi-home'),CC_FIXTURE_CALLS:join(dir,'calls')},stdio:'pipe'});await expect.poll(async()=>{try{return(await api('/api/v1/health')).status;}catch{return 0;}}).toBe(200);target.connection_revision=(await(await api('/api/v1/hosts')).json()).find((h:any)=>h.id==='local').connection_revision;expect((await read()).name).toBe('Later edit');
 tmux('respawn-pane','-k','-t',result.pane,join(bin,'pi'));await expect.poll(async()=>{const details=await(await api('/api/v1/hosts/local/agents/conversation?'+new URLSearchParams({session:target.session,window:target.window,pane:target.pane,connection_revision:target.connection_revision}))).json();return details.instance!==target.instance?details.card?.name:undefined;},{timeout:15000}).toBe('');
});

test('launch names reject control characters and oversized UTF-8 before creating tmux targets',async()=>{
 const t=await boardTicket('Invalid names fixture','pi'),host=(await(await api('/api/v1/hosts')).json()).find((h:any)=>h.id==='local');const before=tmux('list-windows','-a','-F','#{window_id}');
 for(const names of [{window_name:'bad\nname'},{window_name:'é'.repeat(61)},{card_name:'bad\u0000name'},{card_name:'é'.repeat(121)}]){
  const response=await api(`/api/v1/board/tickets/${t.id}/prepare`,{revision:t.revision,host:'local',connection_revision:host.connection_revision,path:project,provider:'pi',model:null,prompt:'Name validation fixture',...names});expect(response.status).toBe(400);
 }
 expect(tmux('list-windows','-a','-F','#{window_id}')).toBe(before);
});


for(const provider of ['codex','claude','pi'])test(`new ${provider} agent receives the initial prompt once as literal input`,async()=>{
 const prompt='  Initial fixture task.\n\nKeep $(touch /tmp/cc-initial-must-not-exist), `literal`, "quotes" and --resume untouched.  ';
 const p=await prepare(provider);const before=calls().length;
 const response=await api('/api/v1/hosts/local/agents/launch',{token:p.token,conversation:null,initial_prompt:prompt});expect(response.status).toBe(200);
 await expect.poll(()=>calls().length).toBe(before+1);const call=calls().find(c=>c.args.at(-1)===prompt);expect(call).toBeTruthy();expect(call.args.at(-2)).toBe('--');expect(call.cwd).toBe(project);expect(existsSync('/tmp/cc-initial-must-not-exist')).toBe(false);
 expect((await api('/api/v1/hosts/local/agents/launch',{token:p.token,initial_prompt:prompt})).status).toBe(410);expect(calls().length).toBe(before+1);
 if(provider==='codex'&&(await(await api('/api/v1/hosts')).json()).some((h:any)=>h.id==='remote')){const remote=await prepare('codex',project,'remote');const text=prompt+' Remote fixture.';expect((await api('/api/v1/hosts/remote/agents/launch',{token:remote.token,initial_prompt:text})).status).toBe(200);await expect.poll(()=>calls().some(c=>c.args.at(-1)===text)).toBe(true);expect(existsSync('/tmp/cc-initial-must-not-exist')).toBe(false);}
});

test('initial prompt validation preserves launch grants and ticket-owned prompts',async()=>{
 const p=await prepare();const before=calls().length;
 for(const prompt of ['x'.repeat(24001),'😀'.repeat(6001),'bad\0prompt','bad\u001bprompt']){
  expect((await api('/api/v1/hosts/local/agents/launch',{token:p.token,initial_prompt:prompt})).status).toBe(400);
 }
 expect((await api('/api/v1/hosts/local/agents/launch',{token:p.token,conversation:p.conversations[0].id,initial_prompt:'Must not inject into resumed history'})).status).toBe(400);expect(calls().length).toBe(before);
 expect((await api('/api/v1/hosts/local/agents/launch',{token:p.token,initial_prompt:'Validated fixture prompt'})).status).toBe(200);await expect.poll(()=>calls().length).toBe(before+1);
 const ticket=await boardTicket('Protected prompt fixture');const prepared=await boardPrepare(ticket,'codex','local','Reviewed ticket prompt');
 expect((await api('/api/v1/hosts/local/agents/launch',{token:prepared.token,initial_prompt:'Unreviewed override'})).status).toBe(400);
 expect((await api(`/api/v1/board/tickets/${ticket.id}/launch`,{token:prepared.token})).status).toBe(200);
 await expect.poll(()=>calls().some(c=>c.args.at(-1)==='Reviewed ticket prompt')).toBe(true);expect(calls().some(c=>c.args.includes('Unreviewed override'))).toBe(false);
 const full='"'.repeat(24000), large=await prepare();expect((await api('/api/v1/hosts/local/agents/launch',{token:large.token,initial_prompt:full})).status).toBe(200);await expect.poll(()=>calls().some(c=>c.args.at(-1)===full)).toBe(true);
});

test('phone initial prompt preserves drafts across resume selection and sends once',async({page})=>{
 await page.setViewportSize({width:393,height:852});let sockets=0;page.on('websocket',s=>{if(s.url().includes('/terminal?'))sockets++;});
 await page.goto(base);await page.getByRole('button',{name:'Start agent',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Start an agent',exact:true});
 const prompt=dialog.getByRole('textbox',{name:'Initial prompt',exact:true});await expect(prompt).toBeEnabled();const text='Plan the mobile fixture.\nThen implement and verify it.';await prompt.fill(text);
 const conversations=dialog.getByLabel('Start or resume',{exact:true});await expect(conversations.locator('option')).not.toHaveCount(1);const id=await conversations.locator('option:not([disabled])').nth(1).getAttribute('value');await conversations.selectOption(id!);await expect(prompt).toBeDisabled();await expect(prompt).toHaveValue(text);await conversations.selectOption('');await expect(prompt).toBeEnabled();await expect(prompt).toHaveValue(text);
 await prompt.fill('😀'.repeat(6001));await expect(dialog.getByRole('button',{name:'Start Codex',exact:true})).toBeDisabled();await expect(dialog).toContainText('Prompt is too long');await prompt.fill(text);
 await page.screenshot({path:'../test-results/launch-initial-prompt-phone.png'});expect(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 await dialog.getByRole('button',{name:'Start Codex',exact:true}).click();await expect(dialog).toBeHidden({timeout:15000});expect(calls().filter(c=>c.args.at(-1)===text)).toHaveLength(1);expect(sockets).toBe(0);
 await page.getByRole('button',{name:'← Agents',exact:true}).click();await page.getByRole('button',{name:'Start agent',exact:true}).click();await expect(prompt).toHaveValue('');
});


test('Codex approval policy is explicit, grant-bound, persisted and rejected when unsupported',async()=>{
 const hosts=await(await api('/api/v1/hosts')).json(),revision=hosts.find((h:any)=>h.id==='local').connection_revision;
 const options=(provider:string,policy:string,host='local')=>api(`/api/v1/hosts/${host}/agents/launch-options?`+new URLSearchParams({provider,path:project,connection_revision:hosts.find((h:any)=>h.id===host).connection_revision,approval_policy:policy}));
 const before=tmux('list-panes','-a','-F','#{pane_id}');
 expect((await options('codex','approve-for-me')).status).toBe(400);
 for(const [provider,policy] of [['codex','never'],['codex','--dangerously-bypass-approvals-and-sandbox'],['claude','approve-for-me'],['pi','approve-for-me']])expect((await options(provider,policy)).status).toBe(400);
 expect(tmux('list-panes','-a','-F','#{pane_id}')).toBe(before);
 writeFileSync(join(dir,'policy-support'),'yes');
 try{
  const p=await(await options('codex','approve-for-me')).json();expect(p.approval_policy).toBe('approve-for-me');
  // Start cannot override the reviewed policy (or any other grant field).
  expect((await api('/api/v1/hosts/local/agents/launch',{token:p.token,conversation:null,approval_policy:'default'})).status).toBe(422);
  const n=calls().length;expect((await launch(p)).status).toBe(200);await expect.poll(()=>calls().length).toBe(n+1);expect(calls().at(-1).args).toEqual(['--approve-for-me']);
  expect((await status({...p,revision})).approval_policy).toBe('approve-for-me');
  expect((await launch(p)).status).toBe(410);
  const ticket=await boardTicket('Approval policy ticket');
  const r=await api(`/api/v1/board/tickets/${ticket.id}/prepare`,{revision:ticket.revision,host:'local',connection_revision:revision,path:project,provider:'codex',approval_policy:'approve-for-me',prompt:'Policy ticket fixture'});expect(r.status).toBe(200);const prepared=await r.json();
  expect((await api(`/api/v1/board/tickets/${ticket.id}/launch`,{token:prepared.token})).status).toBe(200);
  const saved=await(await api(`/api/v1/board/tickets/${ticket.id}`)).json();expect(saved.runs[0].approval_policy).toBe('approve-for-me');
  await expect.poll(()=>calls().some(c=>JSON.stringify(c.args)===JSON.stringify(['--approve-for-me','--','Policy ticket fixture']))).toBe(true);
  if(sshd){const remote=await(await options('codex','approve-for-me','remote')).json();expect((await launch(remote,null,'remote')).status).toBe(200);expect((await status({...remote,revision:hosts.find((h:any)=>h.id==='remote').connection_revision},'remote')).approval_policy).toBe('approve-for-me');}
 }finally{rmSync(join(dir,'policy-support'),{force:true});}
});

test('phone launchers expose Codex automatic review and reset it for other harnesses',async({page})=>{
 writeFileSync(join(dir,'policy-support'),'yes');
 try{
  await page.setViewportSize({width:393,height:852});await page.goto(base);await page.getByRole('button',{name:'Start agent',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Start an agent'}),policy=dialog.getByLabel('Codex approval policy',{exact:true});
  await expect(policy).toHaveValue('');await policy.selectOption('approve-for-me');await expect(dialog.getByRole('status')).toContainText('Automatic review (workspace-write)');
  await dialog.getByLabel('Agent provider',{exact:true}).selectOption('pi');await expect(policy).toHaveValue('');await expect(policy).toBeDisabled();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  const t=await boardTicket('Policy UI ticket');await page.getByRole('button',{name:'Board',exact:true}).click();await page.getByRole('button',{name:'Policy UI ticket',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Start agent',exact:true}).click();
  const ticketDialog=page.getByRole('dialog',{name:'Start ticket agent'});await ticketDialog.getByLabel('Ticket Codex approval policy',{exact:true}).selectOption('approve-for-me');
  await ticketDialog.getByRole('button',{name:'Check project',exact:true}).click();await expect(ticketDialog.getByRole('status')).toContainText('Automatic review (workspace-write)');
  await ticketDialog.getByLabel('Ticket agent provider',{exact:true}).selectOption('claude');await expect(ticketDialog.getByLabel('Ticket Codex approval policy',{exact:true})).toBeDisabled();await expect(ticketDialog.getByRole('button',{name:'Start agent',exact:true})).toBeDisabled();
 }finally{rmSync(join(dir,'policy-support'),{force:true});}
});
