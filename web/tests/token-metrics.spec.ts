import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
let dir: string, socket: string, backend: ChildProcess, sshd: ChildProcess | undefined, base: string, pane: string, window: string, session: string, home: string;
function command(program: string, args: string[]) { const r = spawnSync(program, args, { encoding:'utf8', env:{...process.env, TMUX:''} }); if(r.status!==0) throw Error(r.stderr); return r.stdout.trim(); }
function tmux(...args:string[]) { return command('tmux',['-S',socket,...args]); }
async function port() { return new Promise<number>(r=>{ const s=createServer(); s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>r(p));});}); }
function agentCommand() { return `printf '› \\n'; exec env CODEX_HOME=${home} ${join(dir,'codex')} resume aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`; }
test.beforeAll(async()=>{
  dir=mkdtempSync(join(tmpdir(),'cc-token-metrics-')); socket=join(dir,'tmux.sock');home=join(dir,'codex-home');
  writeFileSync(join(dir,'fixture.c'),'#include <unistd.h>\nint main(){while(1)pause();}');command('cc',[join(dir,'fixture.c'),'-o',join(dir,'codex')]);
  const sessions=join(home,'sessions','2026','10','31');mkdirSync(sessions,{recursive:true});
  const records: object[]=[{type:'session_meta',payload:{id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',cwd:dir,timestamp:'2026-10-31T12:00:00Z'}}];
  for(let i=0;i<125;i++) records.push({type:'response_item',timestamp:'2026-10-31T12:00:00Z',payload:{type:'message',role:i%2?'assistant':'user',content:[{type:'output_text',text:`Conversation message ${i}${i===124?' <img src=x onerror=alert(1)>':''}`}]}});
  records.push({type:'response_item',payload:{type:'reasoning',content:[{type:'text',text:'HIDDEN_REASONING'}]}});
  records.push({type:'event_msg',timestamp:'2026-01-01T00:00:00Z',payload:{type:'token_count',info:{total_token_usage:{input_tokens:1400000,cached_input_tokens:1200000,output_tokens:20000,reasoning_output_tokens:10000,total_tokens:1420000},last_token_usage:{total_tokens:142000},model_context_window:400000}}});
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
  backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',`127.0.0.1:${backendPort}`,'--config',join(dir,'config'),'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{stdio:'pipe'});
  await expect.poll(async()=>{try{return(await fetch(`${base}/api/v1/health`)).status;}catch{return 0;}}).toBe(200);
  await expect.poll(()=>tmux('display-message','-p','-t',pane,'#{pane_current_command}')).toBe('codex');
});
test.afterAll(()=>{backend?.kill('SIGTERM');sshd?.kill('SIGTERM');if(socket)spawnSync('tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});
async function detail(host='local', extra: Record<string,string>={}) {
  const hosts=await(await fetch(`${base}/api/v1/hosts`)).json();
  const query=new URLSearchParams({session,window,pane,connection_revision:hosts.find((h:{id:string})=>h.id===host).connection_revision,...extra});
  const r=await fetch(`${base}/api/v1/hosts/${host}/agents/conversation?${query}`);expect(r.status).toBe(200);return r.json();
}
// These local/SSH fixture executables only pause; no provider agents are launched.
test('native token metrics cross local/SSH transport without changing activity',async()=>{
 const hosts=await(await fetch(base+'/api/v1/hosts')).json();
 for(const host of hosts){
  const first=await detail(host.id);expect(first.association).toBe('process');expect(first.token_metrics.session.total).toBe(1420000);expect(first.token_metrics.session.cached_input).toBe(1200000);expect(first.token_metrics.context).toMatchObject({used:142000,window:400000});
  const second=await detail(host.id);expect(second.token_metrics.session).toEqual(first.token_metrics.session);
 }
 const queue=await(await fetch(base+'/api/v1/queue')).json();for(const host of queue.hosts){expect(host.items[0].token_metrics.session.total).toBe(1420000);expect(host.items[0].token_metrics.association).toBe('process');expect(host.items[0].activity.state).toBe('unknown');}
});
for(const width of [1440,393])test(`token summaries and details fit ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:850});let sockets=0;page.on('websocket',()=>sockets++);
 await page.goto(base+'/#/queue');const card=page.locator('.queue-card').first();await expect(card).toContainText('Context 142k / 400k (36%)');await expect(card).toContainText('Tokens 1.42M');await expect(card.locator('meter')).toBeVisible();await card.click();
 const metrics=page.locator('.agent-token-detail');await metrics.getByText('Token details',{exact:true}).click();await expect(metrics).toContainText('1,420,000');await expect(metrics).toContainText('includes cache read');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`../test-results/token-metrics-${width}.png`});expect(sockets).toBe(0);
});
test('Claude and pi native numeric usage reaches details over local and SSH transport',async()=>{
 for(const provider of ['claude','pi']){
  const id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';const root=join(dir,provider+'-home');mkdirSync(root,{recursive:true});const file=provider==='claude'?join(root,'projects',dir.replace(/[^a-zA-Z0-9]/g,'-'),id+'.jsonl'):join(root,'session.jsonl');mkdirSync(resolve(file,'..'),{recursive:true});
  const usage=provider==='claude'?{input_tokens:5,output_tokens:10,cache_read_input_tokens:100,cache_creation_input_tokens:20}:{input:5,output:10,cacheRead:100,cacheWrite:20,totalTokens:135};
  const records=provider==='claude'?[{type:'assistant',sessionId:id,cwd:dir,timestamp:'2026-01-01T00:00:00Z',message:{id:'native-id',role:'assistant',model:'native-model',content:[{type:'text',text:'Fixture reply'}],usage}}]:[{type:'session',version:3,id,cwd:dir,timestamp:'2026-01-01T00:00:00Z'},{type:'message',id:'native-id',parentId:null,timestamp:'2026-01-01T00:00:00Z',message:{role:'assistant',model:'native-model',content:[{type:'text',text:'Fixture reply'}],usage}}];writeFileSync(file,records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const bin=join(dir,provider);copyFileSync(join(dir,'codex'),bin);const flag=provider==='claude'?`CLAUDE_CONFIG_DIR=${root} ${bin} --session-id ${id}`:`PI_CODING_AGENT_DIR=${root} ${bin} --session ${file}`;const target=tmux('new-window','-d','-P','-F','#{session_id}|#{window_id}|#{pane_id}','-t',session,'-c',dir,`exec env ${flag}`).split('|');
  const hosts=await(await fetch(base+'/api/v1/hosts')).json();for(const host of hosts){const query=new URLSearchParams({connection_revision:host.connection_revision,session:target[0],window:target[1],pane:target[2]});const response=await fetch(base+'/api/v1/hosts/'+host.id+'/agents/conversation?'+query);expect(response.status,await response.clone().text()).toBe(200);const data=await response.json();expect(data.association).toBe('process');expect(data.token_metrics.session.total).toBe(135);expect(data.token_metrics.context.used).toBe(135);expect(data.token_metrics.context.window).toBeNull();expect(data.token_metrics.input_includes_cache).toBe(false);
   // Update Claude's same native message ID, but append a distinct pi request.
  }
  const next=structuredClone(records[records.length-1]) as any;if(provider==='claude'){next.message.usage.output_tokens=20;}else{next.id='next-id';next.parentId='native-id';}
  writeFileSync(file,JSON.stringify(next)+'\n',{flag:'a'});for(const host of hosts){const query=new URLSearchParams({connection_revision:host.connection_revision,session:target[0],window:target[1],pane:target[2]});const data=await(await fetch(base+'/api/v1/hosts/'+host.id+'/agents/conversation?'+query)).json();expect(data.token_metrics.session.total).toBe(provider==='claude'?145:270);}

 }
});
test('unknown, selected-history and stale counters are labeled honestly',async({page})=>{
 const queue=await(await fetch(base+'/api/v1/queue')).json();const item=queue.hosts[0].items[0];const metrics={...item.token_metrics,association:'project',context:{used:100,window:null,reported_at:null},session:{input:null,output:null,total:null,cached_input:null,cache_write:null,reasoning_output:null}};
 item.token_metrics=null;queue.hosts=queue.hosts.slice(0,1);queue.hosts[0].items=[item];
 await page.route('**/api/v1/queue',r=>r.fulfill({json:queue}));const data=await detail();data.token_metrics=metrics;await page.route('**/agents/conversation?*',r=>r.fulfill({json:data}));
 await page.goto(base+'/#/queue');const card=page.locator('.queue-card').first();await expect(card).toContainText('Context unknown / unknown');await expect(card.locator('meter')).toBeHidden();await card.click();const panel=page.locator('.agent-token-detail');await expect(panel).toContainText('Selected history');await expect(panel.locator('meter')).toBeHidden();await panel.getByText('Token details',{exact:true}).click();await expect(panel).toContainText('not a verified live conversation');await expect(panel).toContainText('unknown');
 // Background refresh must preserve the open breakdown and the terminal-specific summary.
 await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((b:HTMLButtonElement)=>b.click());await expect(panel.locator('details')).toHaveAttribute('open','');await page.getByRole('button',{name:'Details',exact:true}).click();await expect(page.locator('.agent-screen > summary')).toHaveText('Live terminal context');
 metrics.association='process';item.token_metrics={...metrics,stale:true};item.status='disconnected';item.activity={state:'disconnected',source:'transport',reason:'Fixture offline',observed_at:Date.now()/1000};queue.hosts[0].error='Fixture unavailable';await page.getByRole('button',{name:'Refresh queue',exact:true,includeHidden:true}).evaluate((b:HTMLButtonElement)=>b.click());await expect(card).toContainText('Last observed');
});
