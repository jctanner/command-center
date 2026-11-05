import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync, symlinkSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
let dir: string, socket: string, backend: ChildProcess, sshd: ChildProcess | undefined, base: string, pane: string, window: string, session: string, home: string;
function command(program: string, args: string[]) { const r = spawnSync(program, args, { encoding:'utf8', env:{...process.env, TMUX:''} }); if(r.status!==0) throw Error(r.stderr); return r.stdout.trim(); }
function tmux(...args:string[]) { return command('tmux',['-S',socket,...args]); }
async function port() { return new Promise<number>(r=>{ const s=createServer(); s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>r(p));});}); }
function agentCommand() { return `printf '› \\n'; exec env CODEX_HOME=${home} ${join(dir,'codex')}`; }
function resetAgent() { tmux('respawn-pane','-k','-t',pane,'-c',dir,agentCommand()); }
test.beforeAll(async()=>{
  dir=mkdtempSync(join(tmpdir(),'cc-agents-')); socket=join(dir,'tmux.sock');home=join(dir,'codex-home');
  copyFileSync('/bin/cat',join(dir,'codex'));
  const sessions=join(home,'sessions','2026','10','31');mkdirSync(sessions,{recursive:true});
  const records: object[]=[{type:'session_meta',payload:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',cwd:dir,timestamp:'2026-10-31T12:00:00Z'}}];
  for(let i=0;i<125;i++) records.push({type:'response_item',timestamp:'2026-10-31T12:00:00Z',payload:{type:'message',role:i%2?'assistant':'user',content:[{type:'output_text',text:`Conversation message ${i}${i===124?' <img src=x onerror=alert(1)>':''}`}]}});
  records.push({type:'response_item',payload:{type:'reasoning',content:[{type:'text',text:'HIDDEN_REASONING'}]}});
  writeFileSync(join(sessions,'rollout-test.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  tmux('-f','/dev/null','new-session','-d','-s','agents','-n','active','-c',dir,'-x','100','-y','35',agentCommand());
  pane=tmux('display-message','-p','-t','agents','#{pane_id}');window=tmux('display-message','-p','-t','agents','#{window_id}');session=tmux('display-message','-p','-t','agents','#{session_id}');
  let remote='';
  if(existsSync('/usr/sbin/sshd')) {
    command('ssh-keygen',['-q','-t','ed25519','-N','','-f',join(dir,'hostkey')]);command('ssh-keygen',['-q','-t','ed25519','-N','','-f',join(dir,'identity')]);
    writeFileSync(join(dir,'authorized_keys'),readFileSync(join(dir,'identity.pub')),{mode:0o600});const sshPort=await port();
    writeFileSync(join(dir,'sshd_config'),`Port ${sshPort}\nListenAddress 127.0.0.1\nHostKey ${dir}/hostkey\nAuthorizedKeysFile ${dir}/authorized_keys\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nPidFile ${dir}/sshd.pid\nAllowUsers ${userInfo().username}\nLogLevel ERROR\n`);
    sshd=spawn('/usr/sbin/sshd',['-D','-e','-f',join(dir,'sshd_config')],{stdio:'pipe'});
    writeFileSync(join(dir,'known_hosts'),`[127.0.0.1]:${sshPort} ${readFileSync(join(dir,'hostkey.pub'),'utf8')}`);
    writeFileSync(join(dir,'ssh_config'),`Host agent-fixture\n HostName 127.0.0.1\n Port ${sshPort}\n User ${userInfo().username}\n IdentityFile ${dir}/identity\n IdentitiesOnly yes\n UserKnownHostsFile ${dir}/known_hosts\n`);
    remote=`\n[[hosts]]\nid="remote"\nname="Remote agents"\nsocket=${JSON.stringify(socket)}\nssh="agent-fixture"\nssh_config=${JSON.stringify(join(dir,'ssh_config'))}\n`;
  }
  const backendPort=await port();base=`http://127.0.0.1:${backendPort}`;
  writeFileSync(join(dir,'config'),`[[hosts]]\nid="local"\nname="Local agents"\nsocket=${JSON.stringify(socket)}\n${remote}`);
  backend=spawn(resolve(process.env.CC_BINARY||'../target/debug/command-center'),['--listen',`127.0.0.1:${backendPort}`,'--config',join(dir,'config'),'--web-dir',resolve(process.env.CC_WEB_DIR||'dist')],{stdio:'pipe'});
  await expect.poll(async()=>{try{return(await fetch(`${base}/api/v1/health`)).status;}catch{return 0;}}).toBe(200);
  await expect.poll(()=>tmux('display-message','-p','-t',pane,'#{pane_current_command}')).toBe('codex');
});
test.afterAll(()=>{backend?.kill('SIGTERM');sshd?.kill('SIGTERM');if(socket)spawnSync('tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});
async function detail(host='local', extra: Record<string,string>={}) {
  const hosts=await(await fetch(`${base}/api/v1/hosts`)).json();
  const query=new URLSearchParams({session,window,pane,connection_revision:hosts.find((h:{id:string})=>h.id===host).connection_revision,...extra});
  const r=await fetch(`${base}/api/v1/hosts/${host}/agents/conversation?${query}`);expect(r.status).toBe(200);return r.json();
}
async function send(token:string,text:string,host='local') { return fetch(`${base}/api/v1/hosts/${host}/agents/message`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token,text})}); }

test('live agents, native history, pagination, draft preservation, and narrow-screen navigation',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('#show-queue').click();
  await expect(page.locator('.queue-card').first()).toContainText('Unknown');
  await expect(page.locator('#queue-count')).toHaveText('0');
  await expect(page.getByLabel('Conversation history',{exact:true}).locator('option')).toHaveCount(2);
  const select=page.getByLabel('Conversation history',{exact:true});const value=await select.locator('option').nth(1).getAttribute('value');await expect(select).toHaveValue(value!);
  await expect(page.getByLabel('Conversation messages')).toContainText('Conversation message 124');
  await expect(page.getByLabel('Conversation messages')).not.toContainText('HIDDEN_REASONING');
  await expect(page.getByLabel('Conversation messages').locator('img')).toHaveCount(0);
  await expect(page.getByLabel('Conversation messages').locator('article')).toHaveCount(100);
  await expect(page.locator('#queue-agent-metadata')).toBeHidden();
  const layout = await page.locator('.queue-body').boundingBox();
  const sidebar = await page.locator('.queue-list').boundingBox();
  const history = await page.getByLabel('Conversation messages').boundingBox();
  expect(sidebar!.width).toBeLessThanOrEqual(320);
  const appHeader = await page.locator('#app>header').boundingBox();
  expect(layout!.y - (appHeader!.y + appHeader!.height)).toBeLessThan(80);
  await expect(page.getByRole('heading',{name:'AI Queue',exact:true})).toBeHidden();
  expect(history!.height / layout!.height).toBeGreaterThan(0.65);
  await page.getByRole('button',{name:'Details',exact:true}).click();
  await expect(page.getByLabel('Conversation history',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Details',exact:true}).click();
  await page.screenshot({path:'../test-results/live-agents-desktop.png'});
  await page.getByRole('button',{name:'Load older messages'}).click();await expect(page.getByLabel('Conversation messages')).toContainText('Conversation message 0');
  const composer=page.getByRole('textbox',{name:'Message to agent'});await composer.fill('retained draft');
  await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());await expect(composer).toHaveValue('retained draft');
  await page.setViewportSize({width:390,height:844});await page.locator('.queue-card').first().click();await expect(composer).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const composerBounds=await composer.boundingBox();expect(composerBounds!.y+composerBounds!.height).toBeLessThanOrEqual(844);
  await page.screenshot({path:'../test-results/live-agents-compact.png'});
  await page.getByRole('button',{name:'← Agents',exact:true}).click();await expect(page.locator('.queue-card').first()).toBeVisible();
  await page.locator('.queue-card').first().click();
  await composer.fill('CC_BROWSER_AGENT_MESSAGE');
  await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeEnabled();
  await composer.press('End');await composer.press('Shift+Enter');await page.keyboard.insertText('CC_BROWSER_AGENT_SECOND_LINE');
  await expect(composer).toHaveValue('CC_BROWSER_AGENT_MESSAGE\nCC_BROWSER_AGENT_SECOND_LINE');
  await composer.press('Enter');
  await expect(composer).toHaveValue('');
  await page.locator('.agent-outbox-message').filter({hasText:'CC_BROWSER_AGENT_MESSAGE'}).getByRole('button',{name:'Message details',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Submit now',exact:true}).click();
  await page.getByRole('button',{name:'Close outbox',exact:true}).click();
  await expect.poll(()=>tmux('capture-pane','-p','-t',pane)).toContain('CC_BROWSER_AGENT_MESSAGE');
  await expect.poll(()=>tmux('capture-pane','-p','-t',pane)).toContain('CC_BROWSER_AGENT_SECOND_LINE');
  // An uncertain network response preserves the draft and requires explicit review.
  await page.route('**/agents/message',route=>route.fulfill({status:502,json:{error:'Fixture delivery uncertain'}}));
  await composer.fill('Keep this uncertain draft');
  await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(composer).toHaveValue('Keep this uncertain draft');
  await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'I’ve checked delivery',exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

test('messages target the current process, reject replay and stale screens, and work over SSH',async()=>{
  resetAgent();await expect.poll(()=>tmux('display-message','-p','-t',pane,'#{pane_current_command}')).toBe('codex');
  const first=await detail();expect(first.instance).toBeTruthy();expect(first.message_token).toBeTruthy();
  const sent=await send(first.message_token,'CC_AGENT_MESSAGE café');expect(sent.status).toBe(200);
  await expect.poll(()=>tmux('capture-pane','-p','-t',pane)).toContain('CC_AGENT_MESSAGE café');
  expect((await send(first.message_token,'DUPLICATE_SHOULD_NOT_SEND')).status).toBe(410);
  expect(tmux('capture-pane','-p','-t',pane)).not.toContain('DUPLICATE_SHOULD_NOT_SEND');
  const log=first.conversations[0]; const history=await detail('local',{conversation:log.id});
  const unchanged=await detail('local',{conversation:log.id,known_version:history.history_version});
  expect(unchanged.history_unchanged).toBe(true);expect(unchanged.messages).toHaveLength(0);
  const stale=await detail();tmux('send-keys','-t',pane,'-l','external input');
  await expect.poll(()=>tmux('capture-pane','-p','-t',pane)).toContain('external input');
  expect((await send(stale.message_token,'STALE_SCREEN')).status).toBe(409);
  const replaced=await detail();resetAgent();await expect.poll(async()=> (await detail()).instance).not.toBe(replaced.instance);
  expect((await send(replaced.message_token,'WRONG_PROCESS')).status).toBe(409);
  expect(tmux('capture-pane','-p','-t',pane)).not.toContain('WRONG_PROCESS');
  if(sshd) {const remote=await detail('remote');expect(remote.conversations.length).toBe(1);expect((await send(remote.message_token,'CC_REMOTE_AGENT','remote')).status).toBe(200);await expect.poll(()=>tmux('capture-pane','-p','-t',pane)).toContain('CC_REMOTE_AGENT');}
  const old=await detail(); const settings=await(await fetch(`${base}/api/v1/settings/hosts`)).json();
  const alias=join(dir,'alias.sock');symlinkSync(socket,alias);
  const edit=await fetch(`${base}/api/v1/hosts/local`,{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({revision:settings.revision,host:{name:'Local agents',socket:alias,ssh:null,ssh_config:null}})});
  expect(edit.status).toBe(200);expect((await send(old.message_token,'WRONG_ENDPOINT')).status).toBe(409);
  expect(tmux('capture-pane','-p','-t',pane)).not.toContain('WRONG_ENDPOINT');
  tmux('send-keys','-t',pane,'-l','Would you like to run this command?\n1. Yes\n2. No\nEsc to cancel\n');
  await expect.poll(async()=> (await detail()).attention).toBe(true);
  const approval=await detail();expect(approval.send_available).toBe(false);expect(approval.message_token).toBeUndefined();
});

test('provider status transitions update filters and disconnected agents remain visible', async ({page}) => {
  test.setTimeout(60000);
  copyFileSync('/bin/cat',join(dir,'claude'));
  const providerHome=join(dir,'claude-home');mkdirSync(join(providerHome,'sessions'),{recursive:true});
  const providerPane=tmux('new-window','-d','-P','-F','#{pane_id}','-t','agents','-n','provider','-c',dir,`exec env CLAUDE_CONFIG_DIR=${providerHome} ${join(dir,'claude')}`);
  await expect.poll(()=>tmux('display-message','-p','-t',providerPane,'#{pane_current_command}')).toBe('claude');
  const pid=tmux('display-message','-p','-t',providerPane,'#{pane_pid}');
  const providerWindow=tmux('display-message','-p','-t',providerPane,'#{window_id}');
  const raw=readFileSync(`/proc/${pid}/stat`,'utf8');const start=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/)[19];
  const started=Date.now()-1000;
  function status(value:string) {const now=Date.now();writeFileSync(join(providerHome,'sessions',`${pid}.json`),JSON.stringify({pid:Number(pid),procStart:start,sessionId:'cccccccc-cccc-cccc-cccc-cccccccccccc',tmux:`${session.slice(1)}:${providerWindow}.${providerPane}`,cwd:dir,startedAt:started,status:value,statusUpdatedAt:now,updatedAt:now}));}
  async function observed() {const data=await(await fetch(`${base}/api/v1/queue`)).json();return data.hosts.find((h:{id:string})=>h.id==='local').items.find((i:{pane:string})=>i.pane===providerPane);}
  status('idle');
  await expect.poll(async()=> (await observed())?.activity.state,{timeout:15000}).toBe('ready');
  await page.goto(base);await page.locator('#show-queue').click();
  await page.getByLabel('Queue machine',{exact:true}).selectOption('local');
  const filter=page.getByLabel('Agent status',{exact:true});await filter.selectOption('ready');
  await expect(page.locator('.queue-card')).toHaveCount(1);await expect(page.locator('.queue-card')).toContainText('Ready');
  await filter.selectOption('');
  status('working');await expect.poll(async()=> (await observed())?.activity.state,{timeout:15000}).toBe('working');
  await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());await filter.selectOption('working');
  await expect(page.locator('.queue-card')).toHaveCount(1);await expect(page.locator('.queue-card')).toContainText('Working');
  status('idle');await expect.poll(async()=> (await observed())?.activity.state,{timeout:15000}).toBe('ready');
  expect((await observed()).attention.finished).toBe(true);
  status('waiting_for_approval');await expect.poll(async()=> (await observed())?.activity.state,{timeout:15000}).toBe('approval');
  await filter.selectOption('');await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());
  const providerCard=page.locator('.queue-card').filter({hasText:'provider'});await expect(providerCard).toContainText('Awaiting approval');await providerCard.click();
  await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
  // Replacing the process leaves a briefly retained card, never a false Ready.
  tmux('respawn-pane','-k','-t',providerPane,'exec /bin/cat');
  await expect.poll(async()=> (await observed())?.activity.state,{timeout:15000}).toBe('disconnected');
  await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());await filter.selectOption('disconnected');
  await expect(page.locator('.queue-card')).toHaveCount(1);await expect(page.locator('.queue-card')).toContainText('Disconnected');
  await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
  await page.route('**/api/v1/queue',route=>route.abort());
  await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());
  await expect(page.locator('#queue-count')).toHaveText('?');
  await expect(page.locator('.queue-card')).toHaveCount(2);
  await expect(page.locator('.queue-card .agent-state')).toHaveText(['Disconnected','Disconnected']);
  await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
  await page.unroute('**/api/v1/queue');await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());
  await expect(page.locator('.queue-card')).toHaveCount(1);
  tmux('set-option','-w','-t',window,'remain-on-exit','on');tmux('send-keys','-t',pane,'C-c');
  await expect.poll(()=>tmux('display-message','-p','-t',pane,'#{pane_dead}')).toBe('1');
  await expect.poll(async()=> {const data=await(await fetch(`${base}/api/v1/queue`)).json();return data.hosts.find((h:{id:string})=>h.id==='local').items.find((i:{pane:string})=>i.pane===pane)?.activity.state;},{timeout:15000}).toBe('disconnected');
  await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());
  await page.locator('.queue-card').filter({hasText:'active'}).click();
  await page.getByRole('button',{name:'Details',exact:true}).click();
  // Opening the expanded thread may already acknowledge its visible events.
  const markRead = page.getByRole('button',{name:'Mark read',exact:true});
  if (await markRead.isVisible()) await markRead.click();
  await expect(page.locator('.queue-card.selected .attention-flags')).not.toContainText('New approval');
  await expect(markRead).toBeHidden();
  await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
});

test('new replies need attention until explicitly opened, and read state survives backend restart', async ({page,browser}) => {
  test.setTimeout(60000);
  const project=join(dir,'attention-project'),providerHome=join(dir,'attention-home'),logs=join(providerHome,'sessions/2026/10/31');
  mkdirSync(project);mkdirSync(logs,{recursive:true});
  const log=join(logs,'rollout-attention.jsonl');
  const assistant=(text:string)=>({type:'response_item',timestamp:new Date().toISOString(),payload:{type:'message',role:'assistant',content:[{type:'output_text',text}]}});
  writeFileSync(log,JSON.stringify({type:'session_meta',payload:{id:'dddddddd-dddd-dddd-dddd-dddddddddddd',cwd:project}})+'\n'+Array.from({length:110},(_,i)=>JSON.stringify(assistant(`Already existing history ${i}`))).join('\n')+'\n');
  const target=tmux('new-window','-d','-P','-F','#{pane_id}','-t','agents','-n','attention-test','-c',project,`exec env CODEX_HOME=${providerHome} ${join(dir,'codex')}`);
  await expect.poll(()=>tmux('display-message','-p','-t',target,'#{pane_current_command}')).toBe('codex');
  async function item() {const data=await(await fetch(`${base}/api/v1/queue`)).json();return data.hosts.find((h:{id:string})=>h.id==='local').items.find((i:{pane:string})=>i.pane===target);}
  await expect.poll(async()=>!!await item(),{timeout:15000}).toBe(true);
  expect((await item()).attention.unread_reply).toBe(false);
  await page.goto(base);
  writeFileSync(log,readFileSync(log,'utf8')+JSON.stringify(assistant('A new unread reply'))+'\n');
  await expect.poll(async()=> (await item()).attention.unread_reply,{timeout:15000}).toBe(true);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#show-queue').click();await page.locator('.queue-filter-panel>summary').click();await page.getByLabel('Queue machine',{exact:true}).selectOption('local');
  await page.getByLabel('Agent status',{exact:true}).selectOption('needs_attention');
  await page.getByRole('button',{name:'Done',exact:true}).click();
  const card=page.locator('.queue-card').filter({hasText:'attention-test'});await expect(card).toContainText('Unread reply');
  // Automatic previews must not clear unread badges or drain the filter.
  expect((await item()).attention.unread_reply).toBe(true);
  await page.screenshot({path:'../test-results/attention-unread-desktop.png'});
  await card.click();await expect(page.getByLabel('Conversation messages')).toContainText('A new unread reply');
  await expect.poll(async()=> (await item()).attention.unread_reply).toBe(false);
  await expect(page.getByLabel('Conversation messages').getByText('A new unread reply',{exact:true})).toBeInViewport();
  await page.screenshot({path:'../test-results/attention-unread-compact.png'});
  await expect(card).toHaveCount(0);
  await expect(page.getByLabel('Conversation messages')).toContainText('A new unread reply');
  const peer=await browser.newPage();await peer.goto(base);await peer.locator('#show-queue').click();await peer.getByLabel('Queue machine',{exact:true}).selectOption('local');await peer.getByLabel('Agent status',{exact:true}).selectOption('needs_attention');
  await expect(peer.locator('.queue-card').filter({hasText:'attention-test'})).toHaveCount(0);await peer.close();
  await page.getByRole('button',{name:'← Agents',exact:true}).click();
  const args=backend.spawnargs.slice();const exited=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exited;
  backend=spawn(args[0],args.slice(1),{stdio:'pipe'});
  await expect.poll(async()=>{try{return(await fetch(`${base}/api/v1/health`)).status;}catch{return 0;}}).toBe(200);
  expect((await item()).attention.unread_reply).toBe(false);
  writeFileSync(log,readFileSync(log,'utf8')+JSON.stringify(assistant('Reply after restart'))+'\n');
  await expect.poll(async()=> (await item()).attention.unread_reply,{timeout:15000}).toBe(true);
});

test('phone chat uses the viewport for messages and keeps the composer above the keyboard', async ({page}) => {
  // Use deterministic responses to exercise layout without sending to an agent.
  const hosts=await(await fetch(`${base}/api/v1/hosts`)).json();const host=hosts[0];
  await page.route('**/api/v1/queue',route=>route.fulfill({json:{checked_at:Math.floor(Date.now()/1000),hosts:[{...host,items:[{id:'layout-agent',session:'$0',session_name:'work',window:'@0',window_name:'command-center',pane:'%0',project:'/home/user/projects/command-center',agent:'codex',prompt:'Live agent',context:'›',status:'live',activity:{state:'unknown',source:'none',reason:'No process-linked provider status',observed_at:0}}]}]}}));
  await page.route('**/agents/conversation?*',route=>route.fulfill({json:{instance:'layout-process',context:'›',project:'/home/user/projects/command-center',provider:'codex',selected:'conversation',association:'project',conversations:[{id:'conversation',session:'session-one',timestamp:'2026-11-01T00:00:00Z',linked:false}],messages:Array.from({length:25},(_,i)=>({id:String(i),role:i%2?'assistant':'user',text:`Conversation message ${i}. This is readable text on a phone.`,timestamp:'2026-11-01T00:00:00Z'})),send_available:true,message_token:'layout-only',attention:false}}));
  await page.setViewportSize({width:393,height:852});await page.goto(base);
  await expect(page.locator('.queue-filter-panel')).not.toHaveAttribute('open');
  await expect(page.locator('.queue-card')).toBeVisible();
  await page.screenshot({path:'../test-results/queue-list-phone.png'});
  await page.locator('.queue-card').click();
  await expect(page.getByLabel('Conversation messages')).toContainText('Conversation message 24');
  await expect(page.locator('#app>header')).toBeHidden();
  await expect(page.getByLabel('Conversation history',{exact:true})).toBeHidden();
  const history=page.getByLabel('Conversation messages'),composer=page.getByRole('textbox',{name:'Message to agent'});
  expect((await history.boundingBox())!.height).toBeGreaterThan(852*.65);
  expect((await history.boundingBox())!.width).toBeGreaterThan(393*.95);
  await composer.fill('A draft kept while the keyboard opens');
  await page.screenshot({path:'../test-results/queue-chat-phone.png'});
  await page.getByRole('button',{name:'Details',exact:true}).click();
  await expect(page.getByLabel('Conversation history',{exact:true})).toBeVisible();
  await expect(page.locator('.queue-agent-metadata')).toContainText('not verified');
  await page.getByRole('button',{name:'Details',exact:true}).click();
  await page.evaluate(()=>{const viewport=window.visualViewport!;Object.defineProperty(viewport,'height',{configurable:true,value:380});viewport.dispatchEvent(new Event('resize'));});
  await expect.poll(async()=> (await composer.boundingBox())!.y+(await composer.boundingBox())!.height).toBeLessThanOrEqual(380);
  expect((await history.boundingBox())!.height).toBeGreaterThan(180);
  await expect(composer).toHaveValue('A draft kept while the keyboard opens');
  await page.screenshot({path:'../test-results/queue-chat-keyboard.png'});
  await page.evaluate(()=>{delete (window.visualViewport as unknown as {height?:number}).height;window.visualViewport!.dispatchEvent(new Event('resize'));});
  await page.setViewportSize({width:844,height:393});
  await expect(page.getByRole('button',{name:'← Agents',exact:true})).toBeVisible();
  expect((await history.boundingBox())!.width).toBeGreaterThan(844*.95);
  await expect(page.locator('#show-terminal')).toBeHidden();
});


test('tool approvals work on phones and SSH, reject stale targets and cross-client duplicate decisions', async ({page}) => {
  test.setTimeout(90000);
  const fixture=join(dir,'approval-fixture.py'), keys=join(dir,'approval-keys'), bin=join(dir,'approval-bin');
  mkdirSync(bin);for(const kind of ['codex','claude'])copyFileSync('/usr/bin/python3',join(bin,kind));
  writeFileSync(fixture,String.raw`import ctypes, os, sys, tty, time
ctypes.CDLL(None).prctl(15, sys.argv[1].encode(), 0, 0, 0)
tty.setraw(0)
kind=sys.argv[1]
menu=("Would you like to run this command?\n  $ cargo test\n› 1. Yes, proceed (y)\n  2. No, and tell Codex what to do differently (esc)\nPress enter to confirm or esc to cancel" if kind=='codex' else "Bash command: cargo test\nDo you want to proceed?\n❯ 1. Yes\n  2. Yes, and don't ask again for cargo test commands\n  3. No\nEsc to cancel · Tab to amend")
def paint(text):
    os.write(1, ('\x1b[2J\x1b[H'+text.replace('\n','\r\n')).encode())
paint(menu)
while True:
    key=os.read(0,1)
    with open(sys.argv[2],'ab') as f: f.write(key)
    if key==b'x': paint(menu.replace('cargo test','cargo build'))
    elif sys.argv[3]!='hold': paint('Agent is working')
`);
  const target=tmux('new-window','-d','-P','-F','#{pane_id}','-t','agents','-n','approval-fixture','-c',dir,`exec ${join(bin,'codex')} ${fixture} codex ${keys} hold`);
  const targetWindow=tmux('display-message','-p','-t',target,'#{window_id}');
  async function approvalDetail(host='local') {
    const hosts=await(await fetch(`${base}/api/v1/hosts`)).json();
    const query=new URLSearchParams({session,window:targetWindow,pane:target,connection_revision:hosts.find((h:{id:string})=>h.id===host).connection_revision});
    const r=await fetch(`${base}/api/v1/hosts/${host}/agents/conversation?${query}`);expect(r.status).toBe(200);return r.json();
  }
  async function decide(token:string,choice='1',host='local') {return fetch(`${base}/api/v1/hosts/${host}/agents/approval`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token,choice})});}
  async function reset(kind='codex', mode='hold') {
    writeFileSync(keys,'');tmux('respawn-pane','-k','-t',target,`exec ${join(bin,kind)} ${fixture} ${kind} ${keys} ${mode}`);
    await expect.poll(()=>tmux('display-message','-p','-t',target,'#{pane_current_command}')).toBe(kind);
    await expect.poll(async()=>!!(await approvalDetail()).approval?.token).toBe(true);
  }
  await expect.poll(()=>tmux('display-message','-p','-t',target,'#{pane_current_command}')).toBe('codex');
  await expect.poll(async()=>!!(await approvalDetail()).approval?.token).toBe(true);
  const first=await approvalDetail(),second=await approvalDetail();
  expect(first.send_available).toBe(false);expect(first.approval.choices[0].key).toBeUndefined();
  expect((await decide(first.approval.token,'99')).status).toBe(400);
  const responses=await Promise.all([decide(first.approval.token),decide(second.approval.token)]);
  expect(responses.map(r=>r.status).sort()).toEqual([200,410]);
  await expect.poll(()=>readFileSync(keys,'utf8')).toBe('y');
  expect((await decide(first.approval.token)).status).toBe(410);
  expect((await approvalDetail()).approval.submitted).toBe(true);
  // A backend restart must preserve the prompt claim, not enable a new token.
  const args=backend.spawnargs.slice(), exited=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exited;
  backend=spawn(args[0],args.slice(1),{stdio:'pipe'});
  await expect.poll(async()=>{try{return(await fetch(`${base}/api/v1/health`)).status;}catch{return 0;}}).toBe(200);
  expect((await approvalDetail()).approval.token).toBeUndefined();
  expect(readFileSync(keys,'utf8')).toBe('y');
  await reset();const stale=await approvalDetail();tmux('send-keys','-t',target,'-l','x');
  await expect.poll(()=>tmux('capture-pane','-p','-t',target)).toContain('cargo build');
  expect((await decide(stale.approval.token)).status).toBe(409);expect(readFileSync(keys,'utf8')).toBe('x');
  const replaced=await approvalDetail();await reset();
  expect((await decide(replaced.approval.token)).status).toBe(409);expect(readFileSync(keys,'utf8')).toBe('');
  if(sshd) {const remote=await approvalDetail('remote');expect((await decide(remote.approval.token,'2','remote')).status).toBe(200);await expect.poll(()=>readFileSync(keys,'utf8')).toBe('\x1b');}
  await reset('claude','continue');
  const terminalRequests:string[]=[];page.on('request',r=>{if(r.url().includes('/terminal'))terminalRequests.push(r.url());});
  await page.setViewportSize({width:393,height:852});await page.goto(base);
  await expect(page.locator('.queue-card').filter({hasText:'approval-fixture'}).first()).toBeVisible({timeout:20000});
  await page.locator('.queue-card').filter({hasText:'approval-fixture'}).first().click();
  const card=page.getByRole('region',{name:'Tool approval'});
  await expect(card).toContainText('cargo test');
  const button=card.getByRole('button',{name:'Yes',exact:true});await expect(button).toBeEnabled();
  await expect.poll(async()=> (await button.boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'../test-results/queue-tool-approval-phone.png'});
  await button.click();await expect.poll(()=>readFileSync(keys,'utf8')).toBe('1');
  await expect(card).toBeHidden({timeout:15000});
  expect(terminalRequests).toEqual([]);
  // Uncertain network delivery must stay disabled through subsequent polling.
  await reset('claude','hold');await page.reload();
  await page.locator('.queue-card').filter({hasText:'approval-fixture'}).first().click();
  await expect(card.getByRole('button',{name:'Yes',exact:true})).toBeEnabled();
  await page.route('**/agents/approval',r=>r.fulfill({status:502,json:{error:'Fixture delivery uncertain'}}));
  await card.getByRole('button',{name:'No',exact:true}).click();
  await expect(card).toContainText('delivery may be uncertain');
  await expect(card.getByRole('button',{name:'Yes',exact:true})).toBeDisabled();
  await page.waitForTimeout(6500);
  await expect(card.getByRole('button',{name:'Yes',exact:true})).toBeDisabled();
  expect(readFileSync(keys,'utf8')).toBe('');
  expect(terminalRequests).toEqual([]);
  tmux('kill-pane','-t',target);
});


test('phone conversation shows working feedback before a reply and clears it on completion or disconnect', async ({page}) => {
  test.setTimeout(60000);
  let state='ready', reply=false, fail=false, holdNext=false, answer='Finished response';
  let release: (()=>void) | undefined;
  const stamp=Math.floor(Date.now()/1000);
  const activity=()=>({state,source:'claude_registry',reason:`Claude reports ${state}`,observed_at:stamp+1,evidence_at:stamp,transition:state});
  await page.route('**/api/v1/queue',r=>r.fulfill({json:{checked_at:stamp,hosts:[{id:'local',name:'Local',connection_revision:'fixture',items:[{id:'working-test',session:'$0',session_name:'work',window:'@0',window_name:'feedback-test',pane:'%0',project:'/projects/example',agent:'claude',prompt:'Live agent',context:'',activity:activity()}]}]}}));
  await page.route('**/agents/conversation?*',async r=>{
    if(holdNext) { holdNext=false; await new Promise<void>(resolve=>{release=resolve;}); }
    return fail ? r.fulfill({status:502,json:{error:'Fixture disconnected'}}) : r.fulfill({json:{instance:'working-process',context:'',project:'/projects/example',provider:'claude',selected:'chat',association:'process',conversations:[{id:'chat',session:'chat',timestamp:'',linked:true}],messages:reply?[{id:'1',role:'assistant',text:answer,timestamp:''}]:[],send_available:true,message_token:'fixture',attention:false,activity:activity()}}); });
  await page.route('**/agents/message',r=>r.fulfill({json:{sent:true}}));
  await page.setViewportSize({width:393,height:852});await page.goto(base);await page.locator('.queue-card').click();
  const indicator=page.locator('.agent-live-activity');
  await expect(indicator).toHaveText('Ready');
  await page.getByRole('textbox',{name:'Message to agent'}).fill('Please work on this');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(indicator).toContainText('waiting for agent activity');
  state='working';
  await expect(indicator).toHaveText('Agent is working…',{timeout:8000});
  expect((await indicator.boundingBox())!.y).toBeLessThan(852);
  await expect(page.getByLabel('Conversation messages')).not.toContainText('Finished response');
  await page.screenshot({path:'../test-results/queue-working-phone.png'});
  state='ready';reply=true;
  await expect(indicator).toHaveText('Ready',{timeout:8000});
  await expect(page.getByLabel('Conversation messages')).toContainText('Finished response');
  holdNext=true;await expect.poll(()=>!!release,{timeout:10000}).toBe(true);
  await page.getByRole('textbox',{name:'Message to agent'}).fill('Another request during a refresh');
  state='working';await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(indicator).toHaveText('Agent is working…',{timeout:10000});
  release!();
  fail=true;await expect(indicator).toContainText('reconnecting',{timeout:8000});
  fail=false;state='unknown';answer='Second finished response';
  await expect(indicator).toHaveText('Live status unverified',{timeout:10000});
});

test('desktop notifications are opt-in, deduplicate across tabs, mute agents and open guarded targets',async({page,context})=>{
 let revision=0, cursor='baseline', instance='notify-process';
 let requestedHistory=''; let mode='reply';
 const hosts=await(await fetch(base+'/api/v1/hosts')).json();const host=hosts[0];
 const item=()=>({id:'notify-agent',session:'$0',session_name:'work',window:'@0',window_name:'Notify project',pane:'%0',project:'/fixture/notify',agent:'pi',prompt:'Live agent',context:'',status:'live',activity:{state:'unknown',source:'none',reason:'Unverified',observed_at:0},attention:{key:'notify-scope',instance,revision,finished:mode==='finished',new_approval:mode==='approval',unread_reply:true,needs_attention:true,conversation:'conversation-key',history_id:'notify-history',reply_cursor:cursor}});
 await context.addInitScript(()=>{
  const w=window as unknown as {testNotices:{title:string;body:string;onclick?:()=>void}[];testPermission:string;testRequests:number;Notification:unknown};
  w.testNotices=[];w.testPermission='granted';w.testRequests=0;
  w.Notification=class {static get permission(){return w.testPermission;}static async requestPermission(){w.testRequests++;w.testPermission='granted';return 'granted';}onclick?:()=>void;constructor(public title:string,options:{body:string}){w.testNotices.push(this as unknown as {title:string;body:string});Object.assign(this,{body:options.body});}close(){}};
 });
 await context.route('**/api/v1/queue',route=>route.fulfill({json:{checked_at:Math.floor(Date.now()/1000),hosts:[{...host,items:[item()]}]}}));
 await context.route('**/agents/conversation?*',route=>{requestedHistory=new URL(route.request().url()).searchParams.get('conversation') || '';return route.fulfill({json:{instance,project:'/fixture/notify',provider:'pi',context:'',association:'none',conversations:[],messages:[],send_available:false,attention:false}});});
 await page.goto(base);await page.locator('#show-queue').click();
 const notices=(p=page)=>p.evaluate(()=> (window as unknown as {testNotices:unknown[]}).testNotices.length);
 expect(await page.evaluate(()=> (window as unknown as {testRequests:number}).testRequests)).toBe(0);
 await page.getByRole('button',{name:'Notifications',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Agent notifications',exact:true});await dialog.getByRole('button',{name:'Enable notifications',exact:true}).click();
 await expect(dialog.getByRole('status')).toContainText('On while');await page.screenshot({path:'../test-results/agent-notifications-desktop.png'});await dialog.getByRole('button',{name:'Close',exact:true}).click();
 const peer=await context.newPage();await peer.goto(base);await peer.locator('#show-queue').click();
 const refresh=async(p=page)=>{await p.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());};
 expect(await notices()).toBe(0); // Existing unread history is a baseline.
 cursor='reply-one';revision++;
 await Promise.all([refresh(),refresh(peer)]);
 await expect.poll(async()=>await notices()+await notices(peer)).toBe(1);
 await refresh();expect(await notices()+await notices(peer)).toBe(1);
 await page.getByRole('button',{name:'Details',exact:true}).click();await page.getByRole('button',{name:'Mute notifications',exact:true}).click();
 cursor='reply-muted';revision++;await Promise.all([refresh(),refresh(peer)]);expect(await notices()+await notices(peer)).toBe(1);
 await page.getByRole('button',{name:'Unmute notifications',exact:true}).click();
 cursor='reply-two';revision++;await refresh();await expect.poll(async()=>await notices()+await notices(peer)).toBe(2);
 mode='approval';revision++;await refresh();await expect.poll(async()=>await notices()+await notices(peer)).toBe(3);
 mode='finished';revision++;await refresh();await expect.poll(async()=>await notices()+await notices(peer)).toBe(4);
 const bodies=await page.evaluate(()=> (window as unknown as {testNotices:{body:string}[]}).testNotices.map(n=>n.body));
 expect(bodies).toContain('Agent needs approval');expect(bodies).toContain('New agent reply');
 const recipient=(await notices())?page:peer;
 await recipient.evaluate(()=>{const w=window as unknown as {testNotices:{onclick?:()=>void}[]};w.testNotices.at(-1)!.onclick!();});
 await expect(recipient.locator('.queue-card.selected')).toContainText('Notify project');
 await expect(recipient.locator('#show-queue')).toHaveAttribute('aria-pressed','true');
 await expect.poll(()=>requestedHistory).toBe('notify-history');
 // A replaced process cannot be opened by an old notification.
 instance='replacement';await refresh(recipient);
 await recipient.evaluate(()=>{const w=window as unknown as {testNotices:{onclick?:()=>void}[]};w.testNotices.at(-1)!.onclick!();});
 await expect(recipient.locator('#queue-pane')).toContainText('notified agent is no longer available');
 await page.reload();await page.locator('#show-queue').click();expect(await notices()).toBe(0);
 await peer.close();
});

test('notification permission denial stays explicit and does not affect queue use',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(window,'Notification',{value:class {static permission='denied';static async requestPermission(){return 'denied';}}});});
 await page.goto(base);await page.getByRole('button',{name:'Notifications',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Agent notifications',exact:true})).toContainText('Notifications are blocked');
 await page.getByRole('button',{name:'Close',exact:true}).click();await page.locator('#show-queue').click();await expect(page.locator('#queue-pane')).toBeVisible();
});

async function cardTarget(host='local') {const d=await detail(host);const hosts=await(await fetch(base+'/api/v1/hosts')).json();return {session,window,pane,connection_revision:hosts.find((h:any)=>h.id===host).connection_revision,instance:d.instance};}
async function cardRead(target:any,host='local'){return fetch(`${base}/api/v1/hosts/${host}/agents/card?${new URLSearchParams(target)}`);}
async function cardSave(target:any,revision:number,name:string,notes='',host='local'){return fetch(`${base}/api/v1/hosts/${host}/agents/card`,{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({target,revision,name,notes})});}
test('agent names and notes persist across restart without tmux input and remain scoped by machine and process',async()=>{
 resetAgent();const target=await cardTarget();const before=tmux('capture-pane','-p','-t',pane),dimensions=tmux('display-message','-p','-t',pane,'#{pane_pid}/#{window_width}x#{window_height}');const existing=await(await cardRead(target)).json();const save=await cardSave(target,existing.revision,'Review fixture','Work notes <script>literal</script>');expect(save.status,await save.clone().text()).toBe(200);const card=await save.json();expect((await detail()).card.name).toBe('Review fixture');await expect.poll(async()=>{const snap=await(await fetch(base+'/api/v1/queue')).json();return snap.hosts.find((h:any)=>h.id==='local')?.items.find((i:any)=>i.pane===pane)?.card.notes;},{timeout:10000}).toBe('Work notes <script>literal</script>');expect((await cardSave(target,existing.revision,'Stale writer')).status).toBe(409);if(sshd){const remote=await cardTarget('remote');expect((await(await cardRead(remote,'remote')).json()).name).toBe('');}
 const args=backend.spawnargs.slice();const exited=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exited;backend=spawn(args[0],args.slice(1),{stdio:'pipe'});await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status;}catch{return 0;}}).toBe(200);const fresh=await cardTarget();expect(fresh.instance).toBe(target.instance);expect((await(await cardRead(fresh)).json()).name).toBe('Review fixture');expect(tmux('capture-pane','-p','-t',pane)).toBe(before);expect(tmux('display-message','-p','-t',pane,'#{pane_pid}/#{window_width}x#{window_height}')).toBe(dimensions);
 resetAgent();const replaced=await cardTarget();expect(replaced.instance).not.toBe(target.instance);expect((await cardSave({...target,connection_revision:replaced.connection_revision},card.revision,'Wrong replacement')).status).toBe(409);expect((await(await cardRead(replaced)).json()).name).toBe('');
});
test('cards can be renamed from right-click and phone Details while conflicts preserve the draft',async({page,browser})=>{
 resetAgent();const current=await cardTarget();await expect.poll(async()=>{const data=await(await fetch(base+'/api/v1/queue')).json();return data.hosts.find((h:any)=>h.id==='local').items.find((a:any)=>a.pane===pane)?.attention?.instance;},{timeout:15000}).toBe(current.instance);await page.goto(base);await page.locator('#show-queue').click();await page.getByLabel('Queue machine',{exact:true}).selectOption('local');const card=page.locator('.queue-card').filter({hasText:pane}).first();await card.click({button:'right'});await page.getByRole('menuitem',{name:'Edit card',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit agent card',exact:true});await expect(dialog.getByLabel('Agent card name',{exact:true})).toBeEnabled();await dialog.getByLabel('Agent card name',{exact:true}).fill('Fixture workbench');await dialog.getByLabel('Agent card notes',{exact:true}).fill('Keep this note\n<script>window.cardScript=true</script>');await dialog.getByRole('button',{name:'Save card',exact:true}).click();await expect(dialog).toBeHidden();await expect(page.locator('.queue-card').filter({hasText:pane}).first()).toContainText('Fixture workbench');expect(await page.evaluate(()=>(window as any).cardScript)).toBeUndefined();await page.screenshot({path:'../test-results/agent-card-name-desktop.png'});
 const phone=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});let sockets=0;phone.on('websocket',w=>{if(w.url().includes('/terminal?'))sockets++;});const before=tmux('display-message','-p','-t',pane,'#{pane_pid}/#{window_width}x#{window_height}');await phone.goto(base);await phone.locator('#show-queue').click();await phone.locator('.queue-card').filter({hasText:'Fixture workbench'}).first().click();await phone.getByRole('button',{name:'Details',exact:true}).click();await phone.getByRole('button',{name:'Edit card',exact:true}).click();const editor=phone.getByRole('dialog',{name:'Edit agent card',exact:true});await expect(editor.getByLabel('Agent card name',{exact:true})).toHaveValue('Fixture workbench');await editor.getByLabel('Agent card name',{exact:true}).fill('My unsaved phone name');await editor.getByLabel('Agent card notes',{exact:true}).fill('Draft kept after a conflict');const target=await cardTarget();const saved=await(await cardRead(target)).json();expect((await cardSave(target,saved.revision,'Changed by desktop')).status).toBe(200);await editor.getByRole('button',{name:'Save card',exact:true}).click();await expect(editor).toContainText('edited in another client');await expect(editor.getByLabel('Agent card name',{exact:true})).toHaveValue('My unsaved phone name');await phone.screenshot({path:'../test-results/agent-card-edit-phone.png'});phone.once('dialog',d=>d.accept());await editor.getByRole('button',{name:'Reload saved card',exact:true}).click();await expect(editor.getByLabel('Agent card name',{exact:true})).toHaveValue('Changed by desktop');await editor.getByRole('button',{name:'Use automatic name',exact:true}).click();await editor.getByRole('button',{name:'Save card',exact:true}).click();await expect(editor).toBeHidden();await expect(phone.locator('.queue-chat-header')).not.toContainText('Changed by desktop');expect(sockets).toBe(0);expect(tmux('display-message','-p','-t',pane,'#{pane_pid}/#{window_width}x#{window_height}')).toBe(before);await phone.close();
});
test('a replaced foreground process and invalid card fields cannot receive a stale edit',async({page})=>{
 resetAgent();const target=await cardTarget();expect((await cardSave(target,0,'x'.repeat(241))).status).toBe(400);expect((await cardSave(target,0,'bad\nname')).status).toBe(400);expect((await cardSave(target,0,'OK','x'.repeat(8001))).status).toBe(400);await page.goto(base);await page.locator('#show-queue').click();await page.getByLabel('Queue machine',{exact:true}).selectOption('local');await page.locator('.queue-card').filter({hasText:pane}).first().click({button:'right'});await page.getByRole('menuitem',{name:'Edit card',exact:true}).click();const editor=page.getByRole('dialog',{name:'Edit agent card',exact:true});await expect(editor.getByLabel('Agent card name',{exact:true})).toBeEnabled();await editor.getByLabel('Agent card name',{exact:true}).fill('Old process draft');resetAgent();await editor.getByRole('button',{name:'Save card',exact:true}).click();await expect(editor).toContainText('Agent changed or is unavailable');await expect(editor.getByLabel('Agent card name',{exact:true})).toHaveValue('Old process draft');const fresh=await cardTarget();expect((await(await cardRead(fresh)).json()).name).toBe('');
});

test('closing an agent window removes its card rather than retaining a disconnected ghost',async({page})=>{
 const agentPane=tmux('new-window','-d','-P','-F','#{pane_id}','-t','agents','-n','slack-emu-fixture','-c',dir,agentCommand());const agentWindow=tmux('display-message','-p','-t',agentPane,'#{window_id}');await expect.poll(()=>tmux('display-message','-p','-t',agentPane,'#{pane_current_command}')).toBe('codex');const item=async()=>{const data=await(await fetch(base+'/api/v1/queue')).json();return data.hosts.find((h:any)=>h.id==='local').items.find((i:any)=>i.pane===agentPane);};await expect.poll(async()=>!!await item(),{timeout:15000}).toBe(true);await page.goto(base+'/#/queue');await page.getByLabel('Queue machine',{exact:true}).selectOption('local');const card=page.locator('.queue-card').filter({hasText:'slack-emu-fixture'});await expect(card).toBeVisible();const hosts=await(await fetch(base+'/api/v1/hosts')).json();const revision=hosts.find((h:any)=>h.id==='local').connection_revision;const r=await fetch(base+'/api/v1/hosts/local/windows/close?'+new URLSearchParams({connection_revision:revision,session,window:agentWindow}));expect(r.status).toBe(200);const preview=await r.json();const closed=await fetch(base+'/api/v1/hosts/local/windows/close',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({connection_revision:revision,session,window:agentWindow,expected:preview.expected})});expect(closed.status).toBe(200);await expect.poll(item,{timeout:15000}).toBeUndefined();await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());await expect(card).toHaveCount(0);expect(tmux('list-panes','-a','-F','#{pane_id}').split('\n')).not.toContain(agentPane);
});

test('agent chat Enter sends, Shift+Enter adds a line, and composition, busy and uncertain states never send accidentally',async({browser})=>{
 const host=(await(await fetch(base+'/api/v1/hosts')).json())[0];
 for(const width of [1440,393]){
  const page=await browser.newPage({viewport:{width,height:900}});const posts:{token:string;text:string}[]=[];let blocked=false,uncertain=false,release:(()=>void)|undefined;
  await page.route('**/api/v1/queue',r=>r.fulfill({json:{checked_at:Date.now()/1000,hosts:[{...host,items:[{id:'keyboard-fixture',session:'$0',session_name:'keyboard',window:'@0',window_name:'Keyboard fixture',pane:'%0',project:'/fixture',agent:'codex',prompt:'Live agent',context:'',status:'live',activity:{state:'unknown',source:'none',reason:'Fixture',observed_at:Date.now()/1000}}]}]}}));
  await page.route('**/agents/conversation?*',r=>r.fulfill({json:{instance:'keyboard-process',context:'',project:'/fixture',provider:'codex',association:'none',conversations:[],messages:[],send_available:!blocked,message_token:blocked?undefined:'keyboard-token',attention:false}}));
  await page.route('**/agents/message',async r=>{posts.push(r.request().postDataJSON());if(posts.length===1)await new Promise<void>(resolve=>{release=resolve;});await r.fulfill(uncertain?{status:502,json:{error:'Fixture uncertain delivery'}}:{json:{sent:true}});});
  await page.goto(base+'/#/queue');await expect(page.locator('#workspace-nav button').first()).toHaveAttribute('id','show-queue');const composer=page.getByRole('textbox',{name:'Message to agent',exact:true});if(width<900)await page.locator('.queue-card').click();await composer.fill('First line');await composer.press('End');await composer.press('Shift+Enter');await page.keyboard.insertText('Second line');await expect(composer).toHaveValue('First line\nSecond line');expect(posts).toHaveLength(0);await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeEnabled();await composer.dispatchEvent('keydown',{key:'Enter',isComposing:true,keyCode:229});await composer.dispatchEvent('compositionstart');await composer.dispatchEvent('keydown',{key:'Enter'});expect(posts).toHaveLength(0);await composer.dispatchEvent('compositionend');await composer.press('Enter');await expect.poll(()=>posts.length).toBe(1);expect(posts[0].text).toBe('First line\nSecond line');await composer.dispatchEvent('keydown',{key:'Enter',repeat:true});expect(posts).toHaveLength(1);release!();await expect(composer).toHaveValue('');await composer.press('Enter');await expect(composer).toHaveValue('');expect(posts).toHaveLength(1);
  blocked=true;await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());await composer.fill('Blocked draft');await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();await composer.press('Enter');await expect(composer).toHaveValue('Blocked draft');expect(posts).toHaveLength(1);
  blocked=false;uncertain=true;await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());await expect(page.getByRole('button',{name:'Send message',exact:true})).toBeEnabled();await composer.press('Enter');await expect.poll(()=>posts.length).toBe(2);await expect(page.getByRole('button',{name:'I’ve checked delivery',exact:true})).toBeVisible();await composer.press('Enter');expect(posts).toHaveLength(2);await expect(composer).toHaveValue('Blocked draft');await page.close();
 }
});

test('inline activity for all providers stays collapsed, updates in place, and fits mobile',async({browser})=>{
 const host=(await(await fetch(base+'/api/v1/hosts')).json())[0];
 for(const provider of ['claude','codex','pi']) for(const width of [1440,393]){
  const page=await browser.newPage({viewport:{width,height:844}});let completed=false,unchanged=false;let requests=0;
  const messages=[{id:'10',role:'user',text:'Check this project',timestamp:''},{id:'40',role:'assistant',text:'I am checking the files.',timestamp:''}];
  const activity=()=>[
   {id:'activity:20:0',position:20,order:0,kind:'thinking',title:'Thinking',text:'Provider-visible summary',status:'recorded',timestamp:''},
   {id:'activity:30:0',position:30,order:0,kind:'tool',title:'Read src/main.rs',text:'',arguments:'<script>alert("input")</script>\n'+('long_path/'.repeat(50)),output:completed?'<img src=x onerror=alert(1)>\nFile contents':undefined,status:completed?'completed':'pending',timestamp:''}
  ];
  await page.route('**/api/v1/queue',r=>r.fulfill({json:{checked_at:Date.now()/1000,hosts:[{...host,items:[{id:'activity-fixture',session:'$0',session_name:'activity',window:'@0',window_name:'Activity fixture',pane:'%0',project:'/fixture',agent:provider,prompt:'Live agent',context:'',status:'live',activity:{state:'working',source:'fixture',reason:'Fixture',observed_at:Date.now()/1000}}]}]}}));
  await page.route('**/agents/conversation?*',r=>{requests++;const before=new URL(r.request().url()).searchParams.has('before');return r.fulfill({json:{instance:'activity-process',context:'',project:'/fixture',provider,selected:'fixture-conversation',association:'process',conversations:[{id:'fixture-conversation',session:'fixture-session',timestamp:'',linked:true}],messages:unchanged?[]:before?[{id:'1',role:'assistant',text:'Earlier message',timestamp:''}]:messages,activities:unchanged?undefined:before?[{id:'activity:2:0',position:2,order:0,kind:'tool',title:'Earlier tool',text:'',status:'completed',output:'earlier result',timestamp:''}]:activity(),older_cursor:before?undefined:5,history_unchanged:unchanged,send_available:true,message_token:'fixture-token',attention:false}});});
  await page.goto(base+'/#/queue');if(width<900)await page.locator('.queue-card').click();
  const history=page.getByLabel('Conversation messages',{exact:true});
  await expect(history.locator('.agent-activity')).toHaveCount(2);
  await expect(history.locator('.agent-activity[open]')).toHaveCount(0);
  expect(await history.locator(':scope > article,:scope > details').evaluateAll(nodes=>nodes.map(n=>n.tagName))).toEqual(['ARTICLE','DETAILS','DETAILS','ARTICLE']);
  const tool=history.locator('.agent-activity').nth(1);await expect(tool.locator('summary')).toContainText('Awaiting result');
  await tool.locator('summary').click();await expect(tool).toHaveAttribute('open','');await expect(tool.locator('pre')).toContainText('<script>');
  const composer=page.getByRole('textbox',{name:'Message to agent',exact:true});await composer.fill('Keep this draft');
  await tool.locator('summary').focus();completed=true;
  const refresh=async()=>{const prior=requests;await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((button:HTMLButtonElement)=>button.click());await expect.poll(()=>requests).toBeGreaterThan(prior);};
  await refresh();await expect(history.locator('.agent-activity').nth(1).locator('summary')).toContainText('Completed');
  await expect(history.locator('.agent-activity').nth(1)).toHaveAttribute('open','');
  await expect(history.locator('.agent-activity').nth(1).locator('summary')).toBeFocused();
  await expect(composer).toHaveValue('Keep this draft');await expect(history.locator('img,script')).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  unchanged=true;await refresh();await expect(history.locator('.agent-activity')).toHaveCount(2);await expect(history.locator('.agent-activity').nth(1)).toHaveAttribute('open','');
  unchanged=false;await page.getByRole('button',{name:'Load older messages',exact:true}).click();
  await expect(history).toContainText('Earlier message');await expect(history.locator('.agent-activity')).toHaveCount(3);
  await expect(history.locator('.agent-activity').nth(2)).toHaveAttribute('open','');
  if(provider==='claude'&&width===393)await page.screenshot({path:'../test-results/inline-agent-activity-phone.png'});
  await page.close();
 }
});

test('assistant Markdown is readable, sanitized, and contained on phones while user input stays literal',async({page})=>{
 const hosts=await(await fetch(`${base}/api/v1/hosts`)).json();const host=hosts[0];let leaked=0;page.on('request',r=>{if(r.url().includes('markdown-spy.invalid'))leaked++;});
 await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text:string)=>{(window as any).copiedChatCode=text;}}});});
 const code='const literal = "<script>not executable</script>"; '+ 'x'.repeat(240)+'\n';
 const markdown='## A useful heading\n\nThis is **important** and `inline_code`.\n\n- First item\n- Second item\n\n> A useful quotation\n\n[Documentation](https://example.com/docs) [Unsafe](javascript:alert(1)) [Local](/api/v1/hosts) [Route](#/terminal)\n\n```js\n'+code+'```\n\n| Column | Another column | Third column | Fourth column |\n| --- | --- | --- | --- |\n| Value | More content | More content | More content |\n\n<img src="https://markdown-spy.invalid/image" onerror="window.chatInjected=true"><script>window.chatInjected=true</script><iframe src="https://markdown-spy.invalid/frame"></iframe><form><input autofocus></form>';
 await page.route('**/api/v1/agents/outbox',r=>r.fulfill({json:{entries:[]}}));
 await page.route('**/api/v1/queue',r=>r.fulfill({json:{checked_at:1,hosts:[{...host,items:[{id:'markdown-fixture',session:'$0',window:'@0',pane:'%0',session_name:'fixture',window_name:'Markdown fixture',project:'/fixture',agent:'pi',prompt:'Live agent',status:'live',context:''}]}]}}));
 await page.route('**/agents/conversation?*',r=>r.fulfill({json:{instance:'markdown-fixture',provider:'pi',project:'/fixture',context:'',selected:'fixture-chat',association:'process',conversations:[{id:'fixture-chat',session:'fixture-chat',timestamp:'',linked:true}],messages:[{id:'1',role:'user',text:'**Keep my literal input** <img src=x>',timestamp:''},{id:'2',role:'assistant',text:markdown,timestamp:''}],send_available:false,attention:false}}));
 await page.setViewportSize({width:393,height:852});await page.goto(base+'/#/queue');await page.locator('.queue-card').click();const body=page.locator('.agent-message.assistant .agent-markdown');
 await expect(body.getByRole('heading',{name:'A useful heading'})).toBeVisible();await expect(body.locator('strong')).toHaveText('important');expect(await body.locator(':scope > p').first().evaluate(el=>getComputedStyle(el).fontSize)).toBe('15px');await expect(body.locator('li')).toHaveCount(2);await expect(body.locator('blockquote')).toContainText('quotation');
 const user=page.locator('.agent-message.user[data-message-id]');await expect(user).toContainText('**Keep my literal input** <img src=x>');await expect(user.locator('strong,img')).toHaveCount(0);
 await expect(body.locator('img,script,iframe,form,input,style,svg')).toHaveCount(0);expect(await page.evaluate(()=>(window as any).chatInjected)).toBeUndefined();expect(leaked).toBe(0);
 const link=body.getByRole('link',{name:'Documentation'});await expect(link).toHaveAttribute('target','_blank');await expect(link).toHaveAttribute('rel','noopener noreferrer');expect(await body.locator('a[href]').count()).toBe(1);
 await body.getByRole('button',{name:'Copy code',exact:true}).click();expect(await page.evaluate(()=>(window as any).copiedChatCode)).toBe(code);
 expect(await body.locator('pre').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);expect(await body.locator('.chat-table-scroll').evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:'../test-results/chat-markdown-phone.png'});
});


async function closeAgentFixture(name:string){
 const targetPane=tmux('new-window','-d','-P','-F','#{pane_id}','-t','agents','-n',name,'-c',dir,agentCommand());const targetWindow=tmux('display-message','-p','-t',targetPane,'#{window_id}');
 await expect.poll(()=>tmux('display-message','-p','-t',targetPane,'#{pane_current_command}')).toBe('codex');
 const hosts=await(await fetch(base+'/api/v1/hosts')).json();const revision=hosts.find((h:any)=>h.id==='local').connection_revision;
 const d=await(await fetch(base+'/api/v1/hosts/local/agents/conversation?'+new URLSearchParams({session,window:targetWindow,pane:targetPane,connection_revision:revision}))).json();
 return{connection_revision:revision,session,window:targetWindow,agent_pane:targetPane,agent_instance:d.instance};
}

test('Close agent on a phone confirms all panes, supports cancel and removes the closed cards without terminal attachment',async({page})=>{
 const target=await closeAgentFixture('phone-close-agent');tmux('split-window','-d','-t',target.window,'/bin/sleep','86400');const original=tmux('display-message','-p','-t',pane,'#{pane_pid}/#{window_width}x#{window_height}');
 await page.setViewportSize({width:393,height:852});let sockets=0;page.on('websocket',w=>{if(w.url().includes('/terminal?'))sockets++;});await page.goto(base+'/#/queue');const card=page.locator('.queue-card').filter({hasText:'phone-close-agent'}).first();await card.click();await page.getByRole('button',{name:'Details',exact:true}).click();await page.getByRole('button',{name:'Close agent…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Close agent',exact:true});await expect(dialog.getByRole('button',{name:'Close agent and window',exact:true})).toBeEnabled();await expect(dialog).toContainText('2 panes');await expect(dialog).toContainText('ALL other processes');await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.screenshot({path:'../test-results/close-agent-phone.png'});
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(tmux('list-windows','-a','-F','#{window_id}')).toContain(target.window);
 await page.getByRole('button',{name:'Close agent…',exact:true}).click();await expect(dialog.getByRole('button',{name:'Close agent and window',exact:true})).toBeEnabled();await dialog.getByRole('button',{name:'Close agent and window',exact:true}).click();await expect(dialog).toBeHidden();await expect(card).toHaveCount(0,{timeout:15000});expect(tmux('list-windows','-a','-F','#{window_id}').split('\n')).not.toContain(target.window);expect(tmux('display-message','-p','-t',pane,'#{pane_pid}/#{window_width}x#{window_height}')).toBe(original);expect(sockets).toBe(0);
});

test('Close agent rejects replacement processes, changed topology and removal of its agent binding',async()=>{
 const target=await closeAgentFixture('stale-close-agent');const url=base+'/api/v1/hosts/local/windows/close';
 let response=await fetch(url+'?'+new URLSearchParams(target));expect(response.status).toBe(200);let preview=await response.json();
 const post=(body:object)=>fetch(url,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 expect((await post({connection_revision:target.connection_revision,session,window:target.window,expected:preview.expected})).status).toBe(409);
 tmux('split-window','-d','-t',target.window,'/bin/sleep','86400');expect((await post({...target,expected:preview.expected})).status).toBe(409);
 response=await fetch(url+'?'+new URLSearchParams(target));expect(response.status).toBe(200);preview=await response.json();tmux('respawn-pane','-k','-t',target.agent_pane,'-c',dir,agentCommand());
 expect((await post({...target,expected:preview.expected})).status).toBe(409);expect(tmux('list-windows','-a','-F','#{window_id}')).toContain(target.window);
});

test('desktop Close agent menu shows linked last-session consequences and never retries a lost response',async({page})=>{
 const target=await closeAgentFixture('menu-close-agent');tmux('new-session','-d','-s','agent-close-link','/bin/sleep','86400');tmux('link-window','-k','-s',target.window,'-t','agent-close-link:0');
 await page.goto(base+'/#/queue');const card=page.locator('.queue-card').filter({hasText:'menu-close-agent'}).first();await card.focus();await card.press('Shift+F10');await page.getByRole('menuitem',{name:'Close agent…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Close agent',exact:true});await expect(dialog).toContainText('Linked sessions');await expect(dialog).toContainText('last window in agent-close-link');await expect(dialog.getByRole('button',{name:'Close agent and window',exact:true})).toBeEnabled();
 let posts=0;await page.route('**/windows/close',async route=>{if(route.request().method()==='POST'){posts++;await route.fetch();await route.abort('connectionfailed');}else await route.continue();});await dialog.getByRole('button',{name:'Close agent and window',exact:true}).click();await expect(dialog).toContainText('will not be retried');await expect(dialog.getByRole('button',{name:'Close agent and window',exact:true})).toBeDisabled();expect(posts).toBe(1);expect(tmux('list-windows','-a','-F','#{window_id}').split('\n')).not.toContain(target.window);expect(tmux('list-sessions','-F','#{session_name}').split('\n')).not.toContain('agent-close-link');
});

test('SSH Close agent verifies the remote process and closes only its fixture window',async()=>{
 test.skip(!sshd,'fixture SSH daemon unavailable');const target=await closeAgentFixture('ssh-close-agent');const hosts=await(await fetch(base+'/api/v1/hosts')).json();target.connection_revision=hosts.find((h:any)=>h.id==='remote').connection_revision;
 const original=tmux('display-message','-p','-t',pane,'#{pane_pid}/#{window_width}x#{window_height}');const url=base+'/api/v1/hosts/remote/windows/close';const response=await fetch(url+'?'+new URLSearchParams(target));expect(response.status).toBe(200);const preview=await response.json();const closed=await fetch(url,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({...target,expected:preview.expected})});expect(closed.status).toBe(200);expect(tmux('list-windows','-a','-F','#{window_id}').split('\n')).not.toContain(target.window);expect(tmux('display-message','-p','-t',pane,'#{pane_pid}/#{window_width}x#{window_height}')).toBe(original);
});

test('laptop cards use compact rows without losing context, attention, drafts or mobile touch layout',async({page})=>{
 const hosts=await(await fetch(base+'/api/v1/hosts')).json();const host=hosts.find((h:any)=>h.id==='local');
 const items=Array.from({length:18},(_,i)=>({id:`compact-${i}`,session:'$0',session_name:'fixture',window:`@${i}`,window_name:`fixture-window-${i}`,pane:`%${100+i}`,project:`/a/very/long/machine/qualified/project/path/project-${i}`,agent:'codex',prompt:i===2?'Allow the fixture operation?':'Live agent',status:'live',activity:{state:i===2?'approval':i===0?'working':'ready',source:i===2?'terminal_prompt':'codex_events',reason:'Fixture status',observed_at:Math.floor(Date.now()/1000)},card:{revision:1,name:i===4?'An extremely long agent title that must stay on one row without overlapping the status':'Fixture agent '+i,notes:i===1||i===2?'A longer explanatory note that should occupy only one optional preview line.':''},attention:{key:'a'.repeat(64),instance:String(i).padStart(64,'0'),revision:1,finished:i===3,new_approval:i===2,unread_reply:i===3,needs_attention:i===2||i===3}}));
 await page.route('**/api/v1/queue',r=>r.fulfill({json:{checked_at:Math.floor(Date.now()/1000),hosts:[{...host,items}]}}));
 await page.route('**/agents/conversation?*',r=>{const i=Number(new URL(r.request().url()).searchParams.get('pane')!.slice(1))-100;return r.fulfill({json:{instance:String(i).padStart(64,'0'),project:items[i].project,provider:'codex',context:'',selected:'fixture-chat',association:'process',conversations:[],messages:[{id:'1',role:'assistant',text:'Fixture reply',timestamp:''}],send_available:true,message_token:'fixture',attention:false}});});
 await page.setViewportSize({width:1366,height:768});await page.goto(base+'/#/queue');await expect(page.locator('.queue-card')).toHaveCount(18);
 const ordinary=page.locator('.queue-card').filter({hasText:'Fixture agent 0'});const height=(await ordinary.boundingBox())!.height;expect(height).toBeGreaterThanOrEqual(64);expect(height).toBeLessThanOrEqual(72);
 await expect(ordinary.locator('.queue-card-context')).toHaveText('Local agents · codex · project-0');await expect(ordinary.locator('.queue-card-context')).toHaveAttribute('title',/\/a\/very\/long\/machine\/qualified\/project\/path\/project-0/);await expect(ordinary.locator('.queue-card-path')).toBeHidden();await expect(ordinary.locator('.attention-flags')).toBeHidden();
 const approval=page.locator('.queue-card').filter({hasText:'Fixture agent 2'});await expect(approval.locator('.queue-card-prompt')).toBeVisible();await expect(approval.locator('.queue-card-note')).toBeHidden();expect((await approval.boundingBox())!.height).toBeLessThanOrEqual(84);
 const unread=page.locator('.queue-card').filter({hasText:'Fixture agent 3'});await expect(unread.getByRole('img',{name:'Finished · Unread reply'})).toBeVisible();
 const named=page.locator('.queue-card-name').filter({hasText:'An extremely long agent title'});await expect(named).toHaveAttribute('title',/An extremely long agent title/);expect((await named.boundingBox())!.height).toBeLessThanOrEqual(22);
 for(const card of await page.locator('.queue-card').all()){const name=await card.locator('.queue-card-name').boundingBox(),state=await card.locator('.agent-state').boundingBox();expect(name!.x+name!.width).toBeLessThanOrEqual(state!.x);}
 await ordinary.click();const composer=page.getByRole('textbox',{name:'Message to agent',exact:true});await composer.fill('Keep the compact layout draft');await page.locator('.queue-list').evaluate(el=>el.scrollTop=220);const before=await page.locator('.queue-list').evaluate(el=>el.scrollTop);
 await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((b:HTMLButtonElement)=>b.click());await expect(composer).toHaveValue('Keep the compact layout draft');await expect(ordinary).toHaveAttribute('aria-pressed','true');expect(await page.locator('.queue-list').evaluate(el=>el.scrollTop)).toBe(before);
 await ordinary.focus();await ordinary.press('Shift+F10');await expect(page.getByRole('menuitem',{name:'Edit card',exact:true})).toBeVisible();await expect(page.getByRole('menuitem',{name:'Close agent…',exact:true})).toBeVisible();await page.keyboard.press('Escape');await page.locator('.queue-list').evaluate(el=>el.scrollTop=0);await page.screenshot({path:'../test-results/compact-agent-cards-laptop.png'});
 await page.setViewportSize({width:393,height:852});await page.goto(base+'/#/queue');const back=page.getByRole('button',{name:'← Agents',exact:true});if(await back.isVisible())await back.click();const phone=page.locator('.queue-card').filter({hasText:'Fixture agent 0'});await expect(phone.locator('.queue-card-machine')).toBeVisible();await expect(phone.locator('.queue-card-context')).toBeHidden();expect((await phone.boundingBox())!.height).toBeGreaterThan(height);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'../test-results/compact-agent-cards-phone.png'});
});
