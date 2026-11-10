import {test,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,appendFileSync,rmSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,spawnSync,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
test.setTimeout(60000);
let dir:string,socket:string,base:string,home:string,log:string,pane:string,window:string,session:string,config:string,backend:ChildProcess,currentTurn:string,header:string;
const nativeSession='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
function run(program:string,args:string[]){const r=spawnSync(program,args,{encoding:'utf8',env:{...process.env,TMUX:''}});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
function tmux(...args:string[]){return run('/usr/bin/tmux',['-S',socket,...args]);}
function append(record:object){appendFileSync(log,JSON.stringify(record)+'\n');}
function phase(state:'working'|'ready'|'unknown'){
 if(state==='unknown'){writeFileSync(log,header);return;}
 if(state==='working')currentTurn=crypto.randomUUID();
 append({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:state==='working'?'task_started':'task_complete',turn_id:currentTurn,root_turn_id:currentTurn}});
}
function user(text:string){append({type:'response_item',timestamp:new Date().toISOString(),payload:{type:'message',role:'user',content:[{type:'input_text',text}]}});}
function register(){
 const pid=Number(tmux('display-message','-p','-t',pane,'#{pane_pid}'));
 const stat=readFileSync(`/proc/${pid}/stat`,'utf8').split(') ').at(-1)!.split(' ');
 const folder=join(home,'command-center-sessions');mkdirSync(folder,{recursive:true,mode:0o700});
 writeFileSync(join(folder,`${pid}.json`),JSON.stringify({schema:1,pid,proc_start:stat[19],boot_id:readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),tmux_pane:pane,cwd:dir,session_id:nativeSession}),{mode:0o600});
}
async function start(){
 backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',base.replace('http://',''),'--config',config,'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,CC_TEST_FAIL_ENTER:join(dir,'fail-enter')},stdio:'pipe'});
 await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status;}catch{return 0;}}).toBe(200);
}
async function stop(){if(backend&&backend.exitCode===null){backend.kill('SIGTERM');await new Promise<void>(resolve=>backend.once('exit',()=>resolve()));}}
async function post(path:string,body:unknown){return fetch(base+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});}
async function detail(){const hosts=await(await fetch(base+'/api/v1/hosts')).json();const query=new URLSearchParams({session,window,pane,connection_revision:hosts[0].connection_revision});const response=await fetch(base+'/api/v1/hosts/local/agents/conversation?'+query);expect(response.status).toBe(200);return response.json();}
async function entries(){return(await(await fetch(base+'/api/v1/agents/outbox')).json()).entries as any[];}
async function entry(id:string){return(await entries()).find(r=>r.id===id);}
async function enqueue(text:string,id=crypto.randomUUID()){const d=await detail();const response=await post('/api/v1/hosts/local/agents/message',{id,token:d.message_token,text});expect(response.status).toBe(200);return{...(await response.json()).outbox,originalToken:d.message_token};}
async function action(id:string,kind:string){const d=kind==='submit'?await detail():undefined;const r=await entry(id);return post('/api/v1/agents/outbox/'+id,{action:kind,revision:r.revision,token:d?.message_token});}

test.beforeEach(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-outbox-'));socket=join(dir,'tmux.sock');home=join(dir,'codex-home');config=join(dir,'config');
 const server=createServer();const port=await new Promise<number>(resolve=>server.listen(0,'127.0.0.1',()=>resolve((server.address() as {port:number}).port)));await new Promise<void>(resolve=>server.close(()=>resolve()));base=`http://127.0.0.1:${port}`;
 mkdirSync(join(home,'sessions/2026/11/03'),{recursive:true});log=join(home,'sessions/2026/11/03/rollout.jsonl');
 header=JSON.stringify({type:'session_meta',payload:{id:nativeSession,cwd:dir}})+'\n';writeFileSync(log,header);phase('working');phase('unknown');
 copyFileSync('/bin/cat',join(dir,'codex'));mkdirSync(join(dir,'bin'));
 writeFileSync(join(dir,'bin/tmux'),`#!/usr/bin/python3\nimport os,sys\nfrom pathlib import Path\nif Path(os.environ['CC_TEST_FAIL_ENTER']).exists() and 'send-keys' in sys.argv and sys.argv[-1]=='Enter': sys.exit(1)\nos.execv('/usr/bin/tmux',['tmux',*sys.argv[1:]])\n`);chmodSync(join(dir,'bin/tmux'),0o700);
 tmux('-f','/dev/null','new-session','-d','-s','fixture','-n','codex','-c',dir,`exec env CODEX_HOME='${home}' '${join(dir,'codex')}'`);
 pane=tmux('display-message','-p','-t','fixture','#{pane_id}');window=tmux('display-message','-p','-t',pane,'#{window_id}');session=tmux('display-message','-p','-t',pane,'#{session_id}');
 await expect.poll(()=>tmux('display-message','-p','-t',pane,'#{pane_current_command}')).toBe('codex');register();
 writeFileSync(config,`[[hosts]]\nid="local"\nname="Outbox fixture"\nsocket=${JSON.stringify(socket)}\n`);
 await start();
});
test.afterEach(async()=>{await stop();if(socket)spawnSync('/usr/bin/tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});

test('deferred messages survive restart, deduplicate IDs, cancel safely and submit FIFO when input is verified',async()=>{
 const first=await enqueue('CC_OUTBOX_CANCELLED');
 const repeated=await post('/api/v1/hosts/local/agents/message',{id:first.id,token:first.originalToken,text:first.text});expect(repeated.status).toBe(200);
 expect((await post('/api/v1/hosts/local/agents/message',{id:first.id,token:first.originalToken,text:'different'})).status).toBe(409);
 expect(tmux('capture-pane','-p','-t',pane)).not.toContain(first.text);
 const originalPid=tmux('display-message','-p','-t',pane,'#{pane_pid}');await stop();await start();expect((await entry(first.id)).status).toBe('queued');expect(tmux('display-message','-p','-t',pane,'#{pane_pid}')).toBe(originalPid);
 expect((await action(first.id,'cancel')).status).toBe(200);
 const a=await enqueue('CC_OUTBOX_FIRST');const b=await enqueue('CC_OUTBOX_SECOND');phase('ready');
 await expect.poll(async()=>(await entry(a.id)).status,{timeout:15000}).toBe('submitted');
 await expect.poll(async()=>(await entry(b.id)).status,{timeout:15000}).toBe('submitted');expect(tmux('capture-pane','-p','-t',pane)).toContain(a.text);expect(tmux('capture-pane','-p','-t',pane)).toContain(b.text);expect(tmux('capture-pane','-p','-t',pane)).not.toContain(first.text);
 user(a.text);await expect.poll(async()=>(await entry(a.id)).status,{timeout:15000}).toBe('seen');
 await expect.poll(async()=>(await entry(b.id)).status,{timeout:15000}).toBe('submitted');user(b.text);
 await expect.poll(async()=>(await entry(b.id)).status,{timeout:15000}).toBe('seen');
 expect((await entries()).filter(r=>r.id===a.id)).toHaveLength(1);
});

test('unknown status requires explicit fresh submission and never claims terminal input was accepted',async()=>{
 phase('unknown');const r=await enqueue('CC_OUTBOX_EXPLICIT');
 await expect.poll(async()=>(await entry(r.id)).note,{timeout:10000}).toContain('Submit now');
 expect(tmux('capture-pane','-p','-t',pane)).not.toContain(r.text);
 const explicit=await action(r.id,'submit');expect(explicit.status,await explicit.text()).toBe(200);expect((await entry(r.id)).status).toBe('submitted');
 expect(tmux('capture-pane','-p','-t',pane)).toContain(r.text);
 user(r.text);await expect.poll(async()=>(await entry(r.id)).status,{timeout:15000}).toBe('seen');
});

test('uncertain delivery survives backend restart and is never automatically or manually replayed',async()=>{
 writeFileSync(join(dir,'fail-enter'),'fail');const r=await enqueue('CC_OUTBOX_UNCERTAIN');phase('ready');
 await expect.poll(async()=>(await entry(r.id)).status,{timeout:15000}).toBe('uncertain');
 const before=tmux('capture-pane','-p','-t',pane);
 await stop();rmSync(join(dir,'fail-enter'));await start();
 expect((await entry(r.id)).status).toBe('uncertain');expect((await action(r.id,'submit')).status).toBe(409);
 expect(tmux('capture-pane','-p','-t',pane)).toBe(before);
 const check=await action(r.id,'check');expect(check.status).toBe(200);expect((await entry(r.id)).status).toBe('uncertain');
 expect(tmux('capture-pane','-p','-t',pane)).toBe(before);
});

test('replacement processes and endpoint edits cannot inherit queued input',async()=>{
 const r=await enqueue('CC_OUTBOX_WRONG_PROCESS');
 tmux('respawn-pane','-k','-t',pane,'-c',dir,`exec env CODEX_HOME='${home}' '${join(dir,'codex')}'`);await expect.poll(()=>tmux('display-message','-p','-t',pane,'#{pane_current_command}')).toBe('codex');register();phase('ready');
 await expect.poll(async()=>(await entry(r.id)).status,{timeout:15000}).toBe('blocked');expect(tmux('capture-pane','-p','-t',pane)).not.toContain(r.text);
 phase('unknown');const other=await enqueue('CC_OUTBOX_WRONG_ENDPOINT');const settings=await(await fetch(base+'/api/v1/settings/hosts')).json();const alias=join(dir,'alias.sock');symlinkSync(socket,alias);
 const changed=await fetch(base+'/api/v1/hosts/local',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({revision:settings.revision,host:{name:'Same physical server, new endpoint',socket:alias,ssh:null,ssh_config:null}})});expect(changed.status).toBe(200);phase('ready');
 await expect.poll(async()=>(await entry(other.id)).status,{timeout:15000}).toBe('blocked');expect(tmux('capture-pane','-p','-t',pane)).not.toContain(other.text);
});

test('phone outbox preserves pending text across reload, second clients and native confirmation',async({page,browser})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:393,height:844});await page.goto(base+'/#/queue');await page.locator('.queue-card').click();const composer=page.getByRole('textbox',{name:'Message to agent',exact:true});
 await composer.fill('CC_OUTBOX_PHONE_MESSAGE');await composer.press('Enter');await expect(composer).toHaveValue('');
 const pending=page.locator('.agent-history .agent-outbox-message').filter({hasText:'CC_OUTBOX_PHONE_MESSAGE'});await expect(pending).toContainText('Queued in CC');await expect(pending.locator('.outbox-spinner')).toBeVisible();await expect(pending.locator('.outbox-actions')).toHaveCount(0);expect((await pending.boundingBox())!.height).toBeLessThan(130);await expect(page.locator('.agent-history-empty')).toBeHidden();
 await page.reload();await page.locator('.queue-card').click();await expect(page.locator('.agent-history .agent-outbox-message').filter({hasText:'CC_OUTBOX_PHONE_MESSAGE'})).toContainText('Queued in CC');
 const other=await browser.newPage();await other.goto(base+'/#/queue');await expect(other.locator('.agent-history .agent-outbox-message').filter({hasText:'CC_OUTBOX_PHONE_MESSAGE'})).toContainText('Queued in CC');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'../test-results/agent-outbox-phone.png'});
 phase('ready');await expect(pending).toContainText('Submitted to terminal',{timeout:15000});
 const stale={entries:await entries()};await page.route('**/api/v1/agents/outbox',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(stale)}));
 await page.evaluate(()=>{const count=()=>[...document.querySelectorAll('.agent-history article.agent-message.user')].filter(n=>n.textContent?.includes('CC_OUTBOX_PHONE_MESSAGE')).length;(window as any).outboxMaxCopies=count();new MutationObserver(()=>{(window as any).outboxMaxCopies=Math.max((window as any).outboxMaxCopies,count());}).observe(document.querySelector('.agent-history')!,{childList:true,subtree:true});});
 user('CC_OUTBOX_PHONE_MESSAGE');
 await expect(page.locator('.agent-history .agent-outbox-message').filter({hasText:'CC_OUTBOX_PHONE_MESSAGE'})).toHaveCount(0,{timeout:20000});
 const native=page.locator('.agent-message.user[data-message-id]').filter({hasText:'CC_OUTBOX_PHONE_MESSAGE'});await expect(native).toHaveCount(1);await expect(native).toContainText('Seen in conversation');expect(await page.evaluate(()=>(window as any).outboxMaxCopies)).toBe(1);await expect(native.locator('.outbox-spinner')).toHaveCount(0);await page.unroute('**/api/v1/agents/outbox');expect(errors).toEqual([]);await other.close();
});

test('lost enqueue responses reconcile by ID without resending or losing the message',async({page})=>{
 await page.goto(base+'/#/queue');let posts=0;
 await page.route('**/agents/message',async route=>{posts++;await route.fetch();await route.abort('connectionfailed');});
 const composer=page.getByRole('textbox',{name:'Message to agent',exact:true});await composer.fill('CC_OUTBOX_LOST_RESPONSE');await composer.press('Enter');
 await expect(page.locator('.agent-history .agent-outbox-message').filter({hasText:'CC_OUTBOX_LOST_RESPONSE'})).toContainText('Queued in CC',{timeout:15000});
 await expect(composer).toHaveValue('');expect(posts).toBe(1);expect((await entries()).filter(r=>r.text==='CC_OUTBOX_LOST_RESPONSE')).toHaveLength(1);
 await page.reload();await expect(page.locator('.agent-history .agent-outbox-message').filter({hasText:'CC_OUTBOX_LOST_RESPONSE'})).toContainText('Queued in CC');expect(posts).toBe(1);
 expect(tmux('capture-pane','-p','-t',pane)).not.toContain('CC_OUTBOX_LOST_RESPONSE');
});

test('plain HTTP browsers without crypto.randomUUID can enqueue exactly once',async({page})=>{
 await page.addInitScript(()=>Object.defineProperty(globalThis.crypto,'randomUUID',{value:undefined,configurable:true}));
 await page.goto(base+'/#/queue');const composer=page.getByRole('textbox',{name:'Message to agent',exact:true});
 await composer.fill('CC_OUTBOX_HTTP_FALLBACK');await composer.press('Enter');await expect(composer).toHaveValue('');
 await expect(page.locator('.agent-history .agent-outbox-message').filter({hasText:'CC_OUTBOX_HTTP_FALLBACK'})).toContainText('Queued in CC');
 const stored=(await entries()).filter(r=>r.text==='CC_OUTBOX_HTTP_FALLBACK');expect(stored).toHaveLength(1);
 expect(stored[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 expect(tmux('capture-pane','-p','-t',pane)).not.toContain('CC_OUTBOX_HTTP_FALLBACK');
});

test('message ID generation failures keep drafts and never claim delivery uncertainty',async({page})=>{
 await page.addInitScript(()=>{
  Object.defineProperty(globalThis.crypto,'randomUUID',{value:undefined,configurable:true});
  Object.defineProperty(globalThis.crypto,'getRandomValues',{value:()=>{throw Error('Fixture RNG unavailable');},configurable:true});
 });
 let requests=0;page.on('request',request=>{if(request.url().endsWith('/agents/message'))requests++;});
 await page.goto(base+'/#/queue');const composer=page.getByRole('textbox',{name:'Message to agent',exact:true});
 await composer.fill('CC_OUTBOX_NOT_SENT');await composer.press('Enter');
 await expect(page.locator('.agent-composer')).toContainText('Your draft was kept');await expect(composer).toHaveValue('CC_OUTBOX_NOT_SENT');
 await expect(page.getByRole('button',{name:'I’ve checked delivery',exact:true})).toBeHidden();
 expect(requests).toBe(0);expect(await entries()).toHaveLength(0);
});


test('confirmed old receipts never reappear when native messages leave the loaded history page',async({page})=>{
 phase('ready');const receipt=await enqueue('CC_CONFIRMED_OLD_MESSAGE');
 await expect.poll(async()=>(await entry(receipt.id)).status,{timeout:15000}).toBe('submitted');user('CC_CONFIRMED_OLD_MESSAGE');
 await expect.poll(async()=>(await entry(receipt.id)).status,{timeout:15000}).toBe('seen');
 for(let i=0;i<140;i++)append({type:'response_item',timestamp:new Date().toISOString(),payload:{type:'message',role:'assistant',content:[{type:'output_text',text:`Later fixture reply ${i}`}]}});
 await page.setViewportSize({width:393,height:844});await page.goto(base+'/#/queue');await page.locator('.queue-card').click();
 await expect(page.locator('.agent-history')).toContainText('Later fixture reply 139');
 await expect(page.locator('.agent-history .agent-outbox-message')).toHaveCount(0);await expect(page.locator('.agent-history')).not.toContainText('CC_CONFIRMED_OLD_MESSAGE');
 await page.reload();await page.locator('.queue-card').click();await expect(page.locator('.agent-history')).toContainText('Later fixture reply 139');await expect(page.locator('.agent-history .agent-outbox-message')).toHaveCount(0);
 await page.getByRole('button',{name:'Details',exact:true}).click();await page.locator('.queue-agent-metadata').getByRole('button',{name:'Outbox',exact:true}).click();
 const row=page.getByRole('dialog',{name:'Agent outbox'}).locator('.agent-outbox-message').filter({hasText:'CC_CONFIRMED_OLD_MESSAGE'});await expect(row).toContainText('Seen in conversation');await expect(row.locator('.outbox-spinner')).toHaveCount(0);
});

async function bulkPreview(action:string){const response=await fetch(base+'/api/v1/agents/outbox/bulk?action='+action);expect(response.status).toBe(200);return response.json();}
async function bulkApply(preview:any){return post('/api/v1/agents/outbox/bulk',{action:preview.action,expected:preview.expected});}
function fixtureSql(script:string){return run('python3',['-c',script,config+'.board.sqlite3']);}

test('bulk cancellation rejects a changed set atomically, persists and retains UUID idempotency after archive',async()=>{
 const first=await enqueue('CC_BULK_FIRST'),second=await enqueue('CC_BULK_SECOND');await expect.poll(async()=>(await entry(first.id)).note).toContain('verified');
 const stale=await bulkPreview('cancel');expect(stale.count).toBe(2);const third=await enqueue('CC_BULK_THIRD');expect((await bulkApply(stale)).status).toBe(409);
 for(const receipt of [first,second,third])expect((await entry(receipt.id)).status).toBe('queued');
 const before=tmux('capture-pane','-p','-t',pane);const fresh=await bulkPreview('cancel');const response=await bulkApply(fresh);expect(response.status).toBe(200);expect((await response.json()).count).toBe(3);
 for(const receipt of [first,second,third])expect((await entry(receipt.id)).status).toBe('cancelled');await stop();await start();expect((await entry(first.id)).status).toBe('cancelled');
 const archive=await bulkPreview('archive');expect(archive.count).toBe(3);expect((await bulkApply(archive)).status).toBe(200);expect((await entries()).length).toBe(0);expect((await bulkApply(archive)).status).toBe(409);
 const duplicate=await post('/api/v1/hosts/local/agents/message',{id:first.id,token:first.originalToken,text:first.text});expect(duplicate.status).toBe(200);expect((await duplicate.json()).outbox.status).toBe('archived');expect(tmux('capture-pane','-p','-t',pane)).toBe(before);
});

test('bulk archive includes old receipts across machines beyond the recent page and rolls back storage failures',async()=>{
 const receipt=await enqueue('CC_BULK_OLD');expect((await action(receipt.id,'cancel')).status).toBe(200);
 fixtureSql(`import sqlite3,json,sys,uuid\nc=sqlite3.connect(sys.argv[1]);record=json.loads(c.execute('SELECT data FROM agent_outbox LIMIT 1').fetchone()[0])\nfor i in range(140):\n r=dict(record,id=str(uuid.uuid4()),host='fixture-other-machine',scope='fixture-history',status='seen',text='Old fixture receipt '+str(i),revision=1)\n c.execute('INSERT INTO agent_outbox(id,scope,phase,revision,data) VALUES(?,?,?,?,?)',(r['id'],r['scope'],r['status'],r['revision'],json.dumps(r)))\nc.commit()`);
 expect((await entries()).length).toBe(100);const preview=await bulkPreview('archive');expect(preview.count).toBe(141);
 fixtureSql(`import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute("CREATE TRIGGER fail_bulk BEFORE UPDATE ON agent_outbox WHEN OLD.seq=2 BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END");c.commit()`);
 expect((await bulkApply(preview)).status).toBe(500);expect((await bulkPreview('archive')).count).toBe(141);
 fixtureSql(`import sqlite3,sys\nc=sqlite3.connect(sys.argv[1]);c.execute('DROP TRIGGER fail_bulk');c.commit()`);
 const before=tmux('capture-pane','-p','-t',pane);const applied=await bulkApply(preview);expect(applied.status).toBe(200);expect((await applied.json()).count).toBe(141);expect((await entries()).length).toBe(0);expect(tmux('capture-pane','-p','-t',pane)).toBe(before);
 expect(fixtureSql(`import sqlite3,json,sys\nc=sqlite3.connect(sys.argv[1]);rows=[json.loads(r[0]) for r in c.execute('SELECT data FROM agent_outbox')];assert len(rows)==141;assert all(r['status']=='archived' and r['text']=='' and r['digest'] for r in rows);print('verified')`)).toBe('verified');
});

test('mobile bulk controls require confirmation and preserve browser-only receipts',async({page})=>{
 const first=await enqueue('CC_BULK_PHONE_ONE');await enqueue('CC_BULK_PHONE_TWO');await expect.poll(async()=>(await entry(first.id)).note).toContain('verified');
 await page.addInitScript(()=>localStorage.setItem('cc-agent-outbox-pending-v1',JSON.stringify([{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',host:'local',session:'$0',window:'@0',pane:'%12345',instance:'0'.repeat(64),text:'BROWSER_ONLY_RECEIPT',status:'uncertain',note:'Fixture browser-only uncertainty',revision:0,created_at:Date.now(),updated_at:Date.now()}])));
 await page.setViewportSize({width:393,height:852});await page.goto(base+'/#/queue');await page.locator('.queue-card').click();await page.getByRole('button',{name:'Details',exact:true}).click();await page.locator('.queue-agent-metadata').getByRole('button',{name:'Outbox',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Agent outbox',exact:true});
 let posts=0;page.on('request',r=>{if(r.url().endsWith('/outbox/bulk')&&r.method()==='POST')posts++;});
 page.once('dialog',async d=>{expect(d.message()).toContain('all 2');expect(d.message()).toContain('browser-only');await d.dismiss();});await dialog.getByRole('button',{name:'Cancel all queued',exact:true}).click();await expect(dialog).toContainText('Nothing was changed');expect(posts).toBe(0);
 const before=tmux('capture-pane','-p','-t',pane);page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Cancel all queued',exact:true}).click();await expect(dialog).toContainText('Cancelled 2 messages');
 page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Archive all receipts',exact:true}).click();await expect(dialog).toContainText('Archived 2 receipts');await expect(dialog).toContainText('BROWSER_ONLY_RECEIPT');expect(posts).toBe(2);expect(tmux('capture-pane','-p','-t',pane)).toBe(before);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'../test-results/outbox-bulk-phone.png'});
});

test('bulk archive discloses uncertainty and a lost apply response is never retried',async({page})=>{
 writeFileSync(join(dir,'fail-enter'),'fail');const receipt=await enqueue('CC_BULK_UNCERTAIN');phase('ready');await expect.poll(async()=>(await entry(receipt.id)).status,{timeout:15000}).toBe('uncertain');const preview=await bulkPreview('cancel');expect(preview.count).toBe(0);expect(preview.skipped).toBe(1);
 await page.setViewportSize({width:393,height:852});await page.goto(base+'/#/queue');await page.locator('.queue-card').click();await page.getByRole('button',{name:'Details',exact:true}).click();await page.locator('.queue-agent-metadata').getByRole('button',{name:'Outbox',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Agent outbox'});
 let posts=0;await page.route('**/outbox/bulk',async route=>{posts++;await route.fetch();await route.abort('connectionfailed');});page.once('dialog',async d=>{expect(d.message()).toContain('1 uncertain');expect(d.message()).toContain('may proceed');await d.accept();});
 const before=tmux('capture-pane','-p','-t',pane);await dialog.getByRole('button',{name:'Archive all receipts',exact:true}).click();await expect(dialog).toContainText('will not be retried automatically');expect(posts).toBe(1);await dialog.getByRole('button',{name:'Refresh outbox',exact:true}).click();await expect(dialog.locator('.agent-outbox-message')).toHaveCount(0);expect(posts).toBe(1);expect(tmux('capture-pane','-p','-t',pane)).toBe(before);
});


test('Pi sequential submissions before lazy log creation confirm as distinct native inputs',async({page})=>{
 copyFileSync('/bin/cat',join(dir,'pi'));
 log=join(dir,'pi-session.jsonl');
 tmux('respawn-pane','-k','-t',pane,`exec env PI_CODING_AGENT_DIR='${home}' '${join(dir,'pi')}'`);
 await expect.poll(()=>tmux('display-message','-p','-t',pane,'#{pane_current_command}')).toBe('pi');
 const pid=Number(tmux('display-message','-p','-t',pane,'#{pane_pid}'));
 const start=readFileSync(`/proc/${pid}/stat`,'utf8').split(') ').slice(1).join(') ').split(' ')[19];
 mkdirSync(join(home,'command-center-status'),{recursive:true});
 const publish=(leaf:string|null)=>{const path=join(home,'command-center-status',`${pid}.json`);writeFileSync(path,JSON.stringify({schema:1,pid,proc_start:start,boot_id:readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),cwd:dir,tmux_pane:pane,session_id:nativeSession,session_file:log,leaf_id:leaf,state:'ready',transition:crypto.randomUUID(),updated_at:Date.now()/1000}));chmodSync(path,0o600);};
 publish(null);
 const first=await enqueue('PI_FIRST_INPUT');
 await expect.poll(async()=>(await entry(first.id)).status).toBe('submitted');
 const second=await enqueue('PI_SECOND_INPUT');
 await expect.poll(async()=>(await entry(second.id)).status,{timeout:15000}).toBe('submitted');
 const header=JSON.stringify({type:'session',version:3,id:nativeSession,cwd:dir})+'\n';
 writeFileSync(log,header+JSON.stringify({type:'message',id:'first',parentId:null,message:{role:'user',content:[{type:'text',text:'PI_FIRST_INPUT'}]}})+'\n');publish('first');
 await expect.poll(async()=>(await entry(first.id)).status,{timeout:15000}).toBe('seen');
 await expect.poll(async()=>(await entry(second.id)).status,{timeout:15000}).toBe('submitted');
 append({type:'message',id:'second',parentId:'first',message:{role:'user',content:[{type:'text',text:'PI_SECOND_INPUT'}]}});publish('second');
 await expect.poll(async()=>(await entry(second.id)).status,{timeout:15000}).toBe('seen');
 await page.setViewportSize({width:393,height:852});await page.goto(base+'/#/queue');await page.locator('.queue-card').click();
 await expect(page.locator('.agent-history .agent-outbox-message')).toHaveCount(0);
 await expect(page.locator('.agent-history .agent-message.user')).toHaveCount(2);
});

test('launched Codex guardian writer allows busy input without making a working parent Ready',async()=>{
 phase('working');
 const childId='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',childLog=join(home,'sessions/2026/11/03/guardian.jsonl');
 mkdirSync(join(home,'thread-writer-locks'));
 writeFileSync(childLog,JSON.stringify({type:'session_meta',payload:{id:childId,session_id:nativeSession,parent_thread_id:nativeSession,cwd:dir,source:{subagent:{other:'guardian'}},thread_source:'guardian_review'}})+'\n'+JSON.stringify({type:'event_msg',timestamp:new Date().toISOString(),payload:{type:'task_complete',turn_id:'review',root_turn_id:currentTurn}})+'\n');
 const script=join(dir,'owned-writers.py');writeFileSync(script,`import ctypes,fcntl,sys\nctypes.CDLL(None).prctl(15,b'codex',0,0,0)\nfiles=[]\nfor p in sys.argv[1:3]:\n f=open(p,'w');fcntl.flock(f,fcntl.LOCK_EX);files.append(f)\nfor p in sys.argv[3:]: files.append(open(p))\nprint('fixture ready',flush=True)\nfor line in sys.stdin: print('received:'+line.strip(),flush=True)\n`);
 await stop();tmux('respawn-pane','-k','-t',pane,'-c',dir,`exec env CODEX_HOME='${home}' CC_LAUNCH_ID=fixture-launch /bin/bash -c 'exec -a codex /usr/bin/python3 "$@"' -- '${script}' '${join(home,'thread-writer-locks',nativeSession+'.lock')}' '${join(home,'thread-writer-locks',childId+'.lock')}' '${log}' '${childLog}'`);
 await expect.poll(()=>tmux('capture-pane','-p','-t',pane)).toContain('fixture ready');await start();
 const d=await detail();expect(d.association).toBe('process');expect(d.activity.state).toBe('working');expect(d.conversations).toHaveLength(1);
 const receipt=await enqueue('GUARDIAN_PARENT_MESSAGE');await expect.poll(async()=>(await entry(receipt.id)).status,{timeout:15000}).toBe('submitted');expect((await detail()).activity.state).toBe('working');
 expect(tmux('capture-pane','-p','-t',pane).split('received:'+receipt.text)).toHaveLength(2);
 user(receipt.text);await expect.poll(async()=>(await entry(receipt.id)).status,{timeout:15000}).toBe('seen');
 expect((await entries()).filter(x=>x.id===receipt.id)).toHaveLength(1);
});

test('Seen receipt keeps its visible bubble until the exact native history message is rendered',async({page})=>{
 const text='CC_CONTINUOUS_MESSAGE';await page.setViewportSize({width:393,height:844});await page.goto(base+'/#/queue');await page.locator('.queue-card').click();
 const composer=page.getByRole('textbox',{name:'Message to agent',exact:true});await composer.fill(text);await composer.press('Enter');
 const bubble=page.locator('.agent-history .agent-outbox-message').filter({hasText:text});await expect(bubble).toContainText('Queued in CC');
 const frozen=await detail();let delayed=0;
 await page.route('**/api/v1/hosts/local/agents/conversation?*',route=>{delayed++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(frozen)});});
 await page.evaluate(text=>{
  const count=()=>[...document.querySelectorAll('.agent-history article.agent-message.user')].filter(n=>n.textContent?.includes(text)).length;
  (window as any).handoffCounts={min:count(),max:count()};
  new MutationObserver(()=>{const c=count(),counts=(window as any).handoffCounts;counts.min=Math.min(counts.min,c);counts.max=Math.max(counts.max,c);}).observe(document.querySelector('.agent-history')!,{childList:true,subtree:true});
 },text);
 const receipt=(await entries()).find(r=>r.text===text);phase('ready');await expect.poll(async()=>(await entry(receipt.id)).status,{timeout:15000}).toBe('submitted');user(text);
 await expect.poll(async()=>(await entry(receipt.id)).status,{timeout:15000}).toBe('seen');
 // Outbox polling has confirmation, but every conversation response is still the old page.
 await expect(bubble).toContainText('Seen in conversation',{timeout:15000});await expect(bubble.locator('.outbox-spinner')).toHaveCount(0);await expect.poll(()=>delayed).toBeGreaterThan(0);
 await expect(page.locator('.agent-message.user[data-message-id]').filter({hasText:text})).toHaveCount(0);
 await page.unroute('**/api/v1/hosts/local/agents/conversation?*');
 const native=page.locator('.agent-message.user[data-message-id]').filter({hasText:text});await expect(native).toHaveCount(1,{timeout:20000});await expect(bubble).toHaveCount(0);await expect(native).toContainText('Seen in conversation');
 expect(await page.evaluate(()=>(window as any).handoffCounts)).toEqual({min:1,max:1});
});

test('fast confirmation before enqueue response retains the local bubble until native history arrives',async({page})=>{
 const text='CC_FAST_CONTINUOUS_MESSAGE';await page.goto(base+'/#/queue');await page.locator('.queue-card').click();const composer=page.getByRole('textbox',{name:'Message to agent',exact:true});await expect(composer).toBeEnabled();
 const frozen=await detail();await page.route('**/api/v1/hosts/local/agents/conversation?*',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(frozen)}));
 await page.route('**/api/v1/hosts/local/agents/message',async route=>{
  const response=await route.fetch(),data=await response.json(),id=data.outbox.id;phase('ready');
  await expect.poll(async()=>(await entry(id)).status,{timeout:15000}).toBe('submitted');user(text);
  await expect.poll(async()=>(await entry(id)).status,{timeout:15000}).toBe('seen');await route.fulfill({response,json:{outbox:await entry(id)}});
 });
 await composer.fill(text);await composer.press('Enter');const bubble=page.locator('.agent-history .agent-outbox-message').filter({hasText:text});await expect(bubble).toBeVisible();
 await expect(bubble).toContainText('Seen in conversation',{timeout:20000});await expect(bubble.locator('.outbox-spinner')).toHaveCount(0);await expect(composer).toHaveValue('');
 await expect(page.locator('.agent-message.user[data-message-id]').filter({hasText:text})).toHaveCount(0);await page.unroute('**/api/v1/hosts/local/agents/conversation?*');
 await expect(page.locator('.agent-message.user[data-message-id]').filter({hasText:text})).toHaveCount(1,{timeout:20000});await expect(bubble).toHaveCount(0);
});


test('busy native agents receive sequential input without waiting for a turn or earlier native history',async()=>{
 phase('working');const first=await enqueue('NATIVE_BUSY_MESSAGE');await expect.poll(async()=>(await entry(first.id)).status,{timeout:15000}).toBe('submitted');
 expect((await entry(first.id)).note).toContain('while the agent was working');expect((await detail()).activity.state).toBe('working');
 const second=await enqueue('NATIVE_BUSY_MESSAGE');await expect.poll(async()=>(await entry(second.id)).status,{timeout:15000}).toBe('submitted');
 expect((await entry(first.id)).status).toBe('submitted');expect((await detail()).activity.state).toBe('working');
 // Identical intents each need their own distinct native history position.
 user(first.text);await expect.poll(async()=>(await entry(first.id)).status,{timeout:15000}).toBe('seen');expect((await entry(second.id)).status).toBe('submitted');
 user(second.text);await expect.poll(async()=>(await entry(second.id)).status,{timeout:15000}).toBe('seen');expect((await entry(first.id)).seen_message).not.toBe((await entry(second.id)).seen_message);
});
