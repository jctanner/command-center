import {enableFeatures} from './feature-fixture';
import { makeSlackSource } from './slack-fixture';
import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

let dir: string, socket: string, backend: ChildProcess, sshd: ChildProcess, base: string;
let sshLog = '';
function command(program: string, args: string[]) {
  const result = spawnSync(program, args, { encoding: 'utf8', env: { ...process.env, TMUX: '' } });
  if (result.status !== 0) throw new Error(`${program}: ${result.stderr}`);
  return result.stdout.trim();
}
function tmux(...args: string[]) { return command('tmux', ['-S', socket, ...args]); }
async function port() {
  return new Promise<number>(resolvePort => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = (s.address() as { port: number }).port; s.close(() => resolvePort(port)); }); });
}
test.beforeAll(async () => {
  test.skip(!existsSync('/usr/sbin/sshd'), 'SSH integration requires OpenSSH server');
  dir = mkdtempSync(join(tmpdir(), 'cc-ssh-')); socket = join(dir, "tmux's socket");
  command('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'hostkey')]);
  command('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'identity')]);
  writeFileSync(join(dir, 'authorized_keys'), readFileSync(join(dir, 'identity.pub')), { mode: 0o600 });
  const sshPort = await port();
  writeFileSync(join(dir, 'sshd_config'), `Port ${sshPort}\nListenAddress 127.0.0.1\nHostKey ${dir}/hostkey\nAuthorizedKeysFile ${dir}/authorized_keys\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nPidFile ${dir}/sshd.pid\nAllowUsers ${userInfo().username}\nLogLevel ERROR\n`);
  sshd = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', join(dir, 'sshd_config')], { stdio: 'pipe' });
  sshd.stderr?.on('data', data => { sshLog += data.toString(); });
  writeFileSync(join(dir, 'known_hosts'), `[127.0.0.1]:${sshPort} ${readFileSync(join(dir, 'hostkey.pub'), 'utf8')}`);
  const sshConfig = join(dir, 'ssh_config');
  const unreachablePort = await port();
  writeFileSync(sshConfig, `Host cc-fixture\n  HostName 127.0.0.1\n  Port ${sshPort}\n  User ${userInfo().username}\n  IdentityFile ${dir}/identity\n  IdentitiesOnly yes\n  UserKnownHostsFile ${dir}/known_hosts\nHost cc-unreachable\n  HostName 127.0.0.1\n  Port ${unreachablePort}\n`);
  tmux('-f', '/dev/null', 'new-session', '-d', '-s', 'remote', '-n', 'ssh terminal');
  const backendPort = await port(); base = `http://127.0.0.1:${backendPort}`;
  const config = join(dir, 'config.toml');
  writeFileSync(config, `[[hosts]]\nid="ssh"\nname="SSH fixture"\nssh="cc-fixture"\nssh_config=${JSON.stringify(sshConfig)}\nsocket=${JSON.stringify(socket)}\n`);
  backend = spawn(resolve(process.env.CC_BINARY || '../target/debug/command-center'), ['--listen', `127.0.0.1:${backendPort}`, '--config', config, '--web-dir', resolve(process.env.CC_WEB_DIR || 'dist')], { stdio: 'pipe' });
  await expect.poll(async () => { try { return (await fetch(`${base}/api/v1/health`)).status; } catch { return 0; } }).toBe(200);await enableFeatures(base);
});
test.afterAll(async () => {
  backend?.kill('SIGTERM'); sshd?.kill('SIGTERM');
  if (socket) spawnSync('tmux', ['-S', socket, 'kill-server']);
  if (dir) rmSync(dir, { recursive: true, force: true });
});
test('real SSH discovery, PTY input, and reconnect preserve remote processes', async ({ page }) => {
  await page.goto(base);
  await expect(page.locator('#connection'), sshLog).toHaveText('Attached', { timeout: 15000 });
  await expect(page.getByRole('button', { name: /^0\s+ssh terminal$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = page.locator('#machine-dialog');
  await expect(dialog.getByLabel('Display name', { exact: true })).toHaveValue('SSH fixture');
  await dialog.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Connected · tmux');
  await dialog.getByLabel('SSH destination', { exact: true }).fill('cc-unreachable');
  await dialog.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('refused');
  await expect(page.locator('#connection')).toHaveText('Connected');
  await dialog.getByLabel('SSH destination', { exact: true }).fill('cc-fixture');
  await dialog.getByRole('button', { name: 'Done editing machines', exact: true }).click();
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type("printf 'CC_SSH_%s\\n' WORKS"); await page.keyboard.press('Enter');
  await expect(page.locator('.xterm-rows')).toContainText('CC_SSH_WORKS');
  expect(tmux('show-options', '-A', '-v', '-t', 'remote', 'destroy-unattached')).toBe('off');
  await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
  await expect(page.locator('#connection')).toHaveText('Attached');
  expect(tmux('list-sessions', '-F', '#{session_name}')).toContain('remote');
  await expect(page.locator('.xterm-rows')).toContainText('CC_SSH_WORKS');
  expect(tmux('list-panes', '-a', '-F', '#{pane_id}').split('\n').filter((value, index, all) => all.indexOf(value) === index)).toHaveLength(1);
});


test('SSH can bootstrap a stopped tmux server, rename by stable IDs, and reject stale endpoints',async()=>{
 tmux('kill-server');
 const hosts=await(await fetch(base+'/api/v1/hosts')).json();const revision=hosts[0].connection_revision;
 const post=(path:string,body:object)=>fetch(base+'/api/v1/hosts/ssh/'+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const directory=join(dir,"literal #{name} ' project");mkdirSync(directory);
 const response=await post('sessions',{connection_revision:revision,name:'cold-ssh',directory});expect(response.status,await response.clone().text()).toBe(200);const created=await response.json();
 expect(tmux('display-message','-p','-t',created.pane,'#{pane_current_path}')).toBe(directory);
 const pid=tmux('display-message','-p','-t',created.pane,'#{pane_pid}');
 const old=tmux('display-message','-p','-t',created.window,'#{window_name}');
 const result=await post('windows/rename',{connection_revision:revision,session:created.session,window:created.window,expected_name:old,name:'SSH workspace 日本語'});expect(result.status).toBe(200);
 expect(tmux('display-message','-p','-t',created.window,'#{window_name}')).toBe('SSH workspace 日本語');expect(tmux('display-message','-p','-t',created.pane,'#{pane_pid}')).toBe(pid);
 const clipboard=await(await fetch(base+'/api/v1/hosts/ssh/clipboard?'+new URLSearchParams({connection_revision:revision}))).json();
 expect((await post('clipboard',{connection_revision:revision,expected_mode:clipboard.mode,mode:'on'})).status).toBe(200);
 expect(tmux('show-options','-s','-v','set-clipboard')).toBe('on');
 expect((await post('clipboard',{connection_revision:'stale',expected_mode:'on',mode:'off'})).status).toBe(409);
 expect((await post('clipboard',{connection_revision:revision,expected_mode:'on',mode:clipboard.mode})).status).toBe(200);
 const oldIndex=Number(tmux('display-message','-p','-t',created.session+':'+created.window,'#{window_index}'));
 const numbering={connection_revision:revision,session:created.session,window:created.window,expected_windows:[[created.window,oldIndex]],index:3};
 expect((await post('windows/renumber',numbering)).status).toBe(200);
 expect(tmux('display-message','-p','-t',created.session+':'+created.window,'#{window_index}')).toBe('3');
 expect(tmux('display-message','-p','-t',created.pane,'#{pane_pid}')).toBe(pid);
 expect((await post('windows/renumber',numbering)).status).toBe(409);
 expect((await post('sessions',{connection_revision:'replaced-endpoint',name:'wrong-host'})).status).toBe(409);
 expect((await post('windows/rename',{connection_revision:revision,session:'$99999',window:created.window,expected_name:'SSH workspace 日本語',name:'wrong'})).status).toBe(409);
});


test('ProxyJump supports two-hop discovery, terminal input and files while verifying both host keys',async({page})=>{
 test.setTimeout(60000);
 const targetPort=await port();
 command('ssh-keygen',['-q','-t','ed25519','-N','','-f',join(dir,'target-hostkey')]);
 writeFileSync(join(dir,'target-sshd-config'),`Port ${targetPort}\nListenAddress 127.0.0.1\nHostKey ${dir}/target-hostkey\nAuthorizedKeysFile ${dir}/authorized_keys\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nPidFile ${dir}/target-sshd.pid\nAllowUsers ${userInfo().username}\nLogLevel VERBOSE\n`);
 const target=spawn('/usr/sbin/sshd',['-D','-e','-f',join(dir,'target-sshd-config')],{stdio:'pipe'});
 let targetLog='';target.stderr?.on('data',data=>{targetLog+=data.toString();});
 const config=join(dir,'ssh_config');
 const original=readFileSync(config,'utf8');
 writeFileSync(join(dir,'known_hosts'),readFileSync(join(dir,'known_hosts'),'utf8')+`[127.0.0.1]:${targetPort} ${readFileSync(join(dir,'target-hostkey.pub'),'utf8')}`);
 writeFileSync(join(dir,'unknown_hosts'),'');
 // Direct access through this alias is intentionally blocked; explicit -J must
 // override it. The jump host is still the original fixture SSH server.
 writeFileSync(config,original+`\nHost cc-jump-target\n HostName 127.0.0.1\n Port ${targetPort}\n User ${userInfo().username}\n IdentityFile ${dir}/identity\n IdentitiesOnly yes\n UserKnownHostsFile ${dir}/known_hosts\n ProxyCommand /bin/false\nHost cc-unknown-jump\n HostName 127.0.0.1\n Port ${original.match(/Port (\d+)/)![1]}\n User ${userInfo().username}\n IdentityFile ${dir}/identity\n UserKnownHostsFile ${dir}/unknown_hosts\n StrictHostKeyChecking no\n`);
 const draft={name:'Jump laptop',ssh:'cc-jump-target',ssh_jump:'cc-fixture',ssh_config:config,socket};
 const post=(path:string,body:object)=>fetch(base+'/api/v1'+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try {
  const direct=await post('/settings/hosts/test',{...draft,ssh_jump:null});expect(direct.status).toBe(502);
  const check=await post('/settings/hosts/test',draft);expect(check.status,await check.clone().text()).toBe(200);
  const unknown=await post('/settings/hosts/test',{...draft,ssh_jump:'cc-unknown-jump'});expect(unknown.status).toBe(502);expect(await unknown.text()).toMatch(/host key verification failed|connection closed/i);expect(readFileSync(join(dir,'unknown_hosts'),'utf8')).toBe('');
  const settings=await(await fetch(base+'/api/v1/settings/hosts')).json();const added=await post('/hosts',{revision:settings.revision,host:draft});expect(added.status).toBe(200);const saved=await added.json();const host=saved.hosts.find((h:{name:string})=>h.name==='Jump laptop');
  expect(host.ssh_jump).toBe('cc-fixture');
  await page.goto(base);await page.getByRole('button',{name:'Jump laptop',exact:true}).click();await expect(page.locator('#connection')).toHaveText('Attached',{timeout:15000});
  await page.locator('.xterm-helper-textarea').focus();await page.keyboard.type("printf 'CC_JUMP_%s\\n' WORKS");await page.keyboard.press('Enter');await expect(page.locator('.xterm-rows')).toContainText('CC_JUMP_WORKS');
  const folder=join(dir,"jump ' project");mkdirSync(folder);
  const inv=await(await fetch(base+`/api/v1/hosts/${host.id}/inventory`)).json();const sourceSession=inv.sessions[0],sourceWindow=sourceSession.windows[0],sourcePane=sourceWindow.panes[0];
  const previousPid=tmux('display-message','-p','-t',sourcePane.id,'#{pane_pid}');
  const currentHost=(await(await fetch(base+'/api/v1/hosts')).json()).find((h:{id:string})=>h.id===host.id);
  const createdWindow=await post(`/hosts/${host.id}/windows`,{connection_revision:currentHost.connection_revision,session:sourceSession.id,window:sourceWindow.id,pane:sourcePane.id,expected_directory:sourcePane.cwd,directory:folder,name:'jump-created'});expect(createdWindow.status,await createdWindow.clone().text()).toBe(200);const newWindow=await createdWindow.json();
  const split=await post(`/hosts/${host.id}/panes`,{connection_revision:currentHost.connection_revision,session:newWindow.session,window:newWindow.window,pane:newWindow.pane,expected_directory:folder,directory:null,direction:'below'});expect(split.status,await split.clone().text()).toBe(200);const newPane=await split.json();
  expect(tmux('display-message','-p','-t',newPane.pane,'#{pane_current_path}')).toBe(folder);expect(tmux('display-message','-p','-t',sourcePane.id,'#{pane_pid}')).toBe(previousPid);

  const listing=await fetch(base+`/api/v1/hosts/${host.id}/fs?`+new URLSearchParams({path:folder}));expect(listing.status).toBe(200);
  await page.getByRole('button',{name:'Settings',exact:true}).click();const dialog=page.locator('#machine-dialog');await dialog.getByRole('button',{name:'Jump laptop',exact:true}).click();
  await expect(dialog.getByLabel('Jump host (optional)',{exact:true})).toHaveValue('cc-fixture');
  await dialog.getByLabel('Jump host (optional)',{exact:true}).fill('cc-unknown-jump');await dialog.getByRole('button',{name:'Save machine',exact:true}).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved. Changes are live.');
  const before=(await(await fetch(base+'/api/v1/hosts')).json()).find((h:{id:string})=>h.id===host.id).connection_revision;
  await dialog.getByLabel('Jump host (optional)',{exact:true}).fill('cc-fixture');await dialog.getByRole('button',{name:'Save machine',exact:true}).click();await expect(dialog.getByRole('status')).toHaveText('Saved. Changes are live.');
  const after=(await(await fetch(base+'/api/v1/hosts')).json()).find((h:{id:string})=>h.id===host.id).connection_revision;expect(after).not.toBe(before);
  await dialog.getByRole('button',{name:'Done editing machines',exact:true}).click();
  const slackProject=join(dir,"slack ' project");makeSlackSource(slackProject);
  const slackSettings=await(await fetch(base+'/api/v1/slack/settings')).json();
  const slackSource=await fetch(base+'/api/v1/slack/settings',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({revision:slackSettings.revision,host:host.id,connection_revision:after,project:slackProject})});expect(slackSource.status).toBe(200);const slackConfigured=await slackSource.json();
  const slackRead=await post('/slack/read',{revision:slackConfigured.revision,connection_revision:after,operation:'history',channel:'C000001'});expect(slackRead.status,await slackRead.clone().text()).toBe(200);const slackText=await slackRead.text();expect(slackText).toContain('Latest');expect(slackText).not.toContain('FAKE_AUTH_SECRET');
  const piHome=join(dir,'pi-home'),piProject=join(dir,"pi ' project"),script=join(dir,'fake-pi.py');mkdirSync(piProject);
  const encoded='--'+piProject.replace(/^[\\/]+/,'').replace(/[\\/:]/g,'-')+'--';const piLogs=join(piHome,'sessions',encoded);mkdirSync(piLogs,{recursive:true});
  const piSession='11111111-1111-7111-8111-111111111111';
  const record=(id:string,parentId:string|null,role:string,text:string)=>({type:'message',id,parentId,message:{role,content:[{type:'text',text}]}});
  const log=join(piLogs,'current.jsonl');
  writeFileSync(log,[{type:'session',version:3,id:piSession,cwd:piProject,timestamp:'2026-11-01T00:00:00Z'},record('u',null,'user','Pi user message'),record('old','u','assistant','PI_ABANDONED'),record('a','u','assistant','Pi visible answer')].map(r=>JSON.stringify(r)).join('\n')+'\n');
  writeFileSync(join(piLogs,'other.jsonl'),JSON.stringify({type:'session',version:3,id:'22222222-2222-7222-8222-222222222222',cwd:piProject,timestamp:'2026-10-31T00:00:00Z'})+'\n');
  writeFileSync(script,"import sys\nprint('Pi fixture ready',flush=True)\nfor line in sys.stdin: print('PI_RECEIVED: '+line,flush=True)\n");
  const piPane=tmux('new-window','-d','-P','-F','#{pane_id}','-t','cold-ssh','-n','pi','-c',piProject,'/usr/bin/env',`PI_CODING_AGENT_DIR=${piHome}`,'/bin/bash','-c','exec -a pi /usr/bin/python3 "$1"','cc-pi',script);
  const piWindow=tmux('display-message','-p','-t',piPane,'#{window_id}'),piRoot=tmux('display-message','-p','-t','cold-ssh','#{session_id}');
  await expect.poll(()=>tmux('display-message','-p','-t',piPane,'#{pane_current_command}')).toBe('pi');
  const hostInfo=(await(await fetch(base+'/api/v1/hosts')).json()).find((h:{id:string})=>h.id===host.id);
  const query=new URLSearchParams({session:piRoot,window:piWindow,pane:piPane,connection_revision:hostInfo.connection_revision});
  const conversation=async()=>{const r=await fetch(base+`/api/v1/hosts/${host.id}/agents/conversation?${query}`);expect(r.status,await r.clone().text()).toBe(200);return r.json();};
  const first=await conversation();expect(first.provider).toBe('pi');expect(first.conversations.length).toBe(2);expect(first.selected).toBeNull();expect(first.activity.state).toBe('unknown');
  const chosen=first.conversations.find((c:{session:string})=>c.session===piSession);query.set('conversation',chosen.id);
  const details=await conversation();expect(details.association).toBe('project');expect(details.messages.map((m:{text:string})=>m.text)).toEqual(['Pi user message','Pi visible answer']);
  const message=await post(`/hosts/${host.id}/agents/message`,{token:details.message_token,text:'PI_FIXTURE_MESSAGE'});expect(message.status).toBe(200);
  await expect.poll(()=>tmux('capture-pane','-p','-t',piPane)).toContain('PI_RECEIVED: PI_FIXTURE_MESSAGE');
  expect((await post(`/hosts/${host.id}/agents/message`,{token:details.message_token,text:'PI_DUPLICATE'})).status).toBe(410);
  await expect.poll(async()=>{const q=await(await fetch(base+'/api/v1/queue')).json();return q.hosts.find((h:{id:string})=>h.id===host.id).items.some((i:{pane:string})=>i.pane===piPane);},{timeout:15000}).toBe(true);
  await page.setViewportSize({width:393,height:852});await page.goto(base);await page.locator('#show-queue').click();
  await page.locator('.queue-filter-panel>summary').click();await page.getByLabel('Queue machine',{exact:true}).selectOption(host.id);await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.locator('.queue-card').filter({hasText:"pi ' project"}).click();await page.getByRole('button',{name:'Details',exact:true}).click();
  await page.getByLabel('Conversation history',{exact:true}).selectOption(chosen.id);await expect(page.getByLabel('Conversation messages')).toContainText('Pi visible answer');
  await expect(page.getByLabel('Conversation messages')).not.toContainText('PI_ABANDONED');
  await page.getByRole('button',{name:'Details',exact:true}).click();await page.screenshot({path:'../test-results/pi-queue-phone.png'});
  writeFileSync(log,readFileSync(log,'utf8')+JSON.stringify(record('new','u','assistant','Pi new branch'))+'\n');
  await expect(page.getByLabel('Conversation messages')).toContainText('Pi new branch',{timeout:10000});await expect(page.getByLabel('Conversation messages')).not.toContainText('Pi visible answer');
  const piPid=Number(tmux('display-message','-p','-t',piPane,'#{pane_pid}'));
  const stat=readFileSync(`/proc/${piPid}/stat`,'utf8');const start=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/)[19];
  const statusDir=join(piHome,'command-center-status');mkdirSync(statusDir);
  const bridge=(state:string,leaf='new')=>writeFileSync(join(statusDir,`${piPid}.json`),JSON.stringify({schema:1,pid:piPid,proc_start:start,boot_id:readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),cwd:piProject,tmux_pane:piPane,session_id:piSession,session_file:log,leaf_id:leaf,state,transition:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',updated_at:Date.now()/1000}),{mode:0o600});
  bridge('working');query.delete('conversation');
  const linked=await conversation();expect(linked.association).toBe('process');expect(linked.selected).toBe(chosen.id);expect(linked.activity.source).toBe('pi_bridge');expect(linked.activity.state).toBe('working');
  // The live branch can change without a log append; invalidate history caches.
  bridge('working','a');query.set('known_version',linked.history_version);query.set('known_branch','new');
  const branch=await conversation();expect(branch.history_unchanged).not.toBe(true);expect(branch.history_reset).toBe(true);expect(branch.messages.map((m:{text:string})=>m.text)).toEqual(['Pi user message','Pi visible answer']);
  query.delete('known_version');query.delete('known_branch');
  bridge('waiting','a');const blocked=await conversation();expect(blocked.send_available).toBe(false);expect(blocked.approval).toBeNull();expect(blocked.activity.state).toBe('approval');
  expect((await post(`/hosts/${host.id}/agents/message`,{token:linked.message_token,text:'PI_DIALOG_WRONG_INPUT'})).status).toBe(409);
  await expect(page.locator('.queue-detail .agent-state')).toHaveText('Awaiting input',{timeout:10000});
  await expect(page.getByLabel('Conversation messages')).toContainText('Pi visible answer',{timeout:10000});
  await expect(page.locator('.queue-chat-subtitle')).not.toContainText('Project history');
  await expect(page.locator('.agent-live-activity')).toHaveText('Waiting for input · respond in terminal');
  await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
  await page.screenshot({path:'../test-results/pi-bridge-phone.png'});
  bridge('ready','a');
  const old=await conversation();tmux('respawn-pane','-k','-t',piPane,'/bin/sleep','86400');
  expect((await post(`/hosts/${host.id}/agents/message`,{token:old.message_token,text:'PI_WRONG_PROCESS'})).status).toBe(409);
  tmux('kill-window','-t',piWindow);
  expect(targetLog).toContain('Accepted publickey');
 } finally {target.kill('SIGTERM');writeFileSync(config,original);}
});

test('window close over SSH targets stable IDs and preserves other windows',async()=>{
 const sid=tmux('new-session','-d','-P','-F','#{session_id}','-s','ssh-close','-n','keep','/bin/sleep','86400');const keep=tmux('display-message','-p','-t',sid,'#{window_id}');const target=tmux('new-window','-d','-P','-F','#{window_id}','-t',sid,'-n',"close ' #{literal} 日本語",'/bin/sleep','86400');const original=tmux('list-panes','-t',keep,'-F','#{pane_id}/#{pane_pid}');const hosts=await(await fetch(base+'/api/v1/hosts')).json();const revision=hosts.find((h:any)=>h.id==='ssh').connection_revision;const r=await fetch(base+'/api/v1/hosts/ssh/windows/close?'+new URLSearchParams({connection_revision:revision,session:sid,window:target}));expect(r.status,await r.clone().text()).toBe(200);const preview=await r.json();const close=(connection_revision:string)=>fetch(base+'/api/v1/hosts/ssh/windows/close',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({connection_revision,session:sid,window:target,expected:preview.expected})});expect((await close('stale-endpoint')).status).toBe(409);expect(tmux('list-windows','-t',sid,'-F','#{window_id}').split('\n')).toContain(target);expect((await close(revision)).status).toBe(200);expect(tmux('list-windows','-t',sid,'-F','#{window_id}')).toBe(keep);expect(tmux('list-panes','-t',keep,'-F','#{pane_id}/#{pane_pid}')).toBe(original);
});
