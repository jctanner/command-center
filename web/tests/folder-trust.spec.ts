// Simulated native menus only: these executables do not load Claude/Codex or contact providers.
import {test,expect} from '@playwright/test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn,spawnSync,type ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
let dir:string,socket:string,base:string,backend:ChildProcess,project:string;
function run(cmd:string,args:string[]){const r=spawnSync(cmd,args,{encoding:'utf8',env:{...process.env,TMUX:''}});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
function tmux(...args:string[]){return run('tmux',['-S',socket,...args]);}
async function api(path:string,body?:unknown,method='POST'){return fetch(base+'/api/v1/'+path,body===undefined?{}:{method,headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});}
async function json(path:string){const r=await api(path);expect(r.status,await r.clone().text()).toBe(200);return r.json();}
test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-folder-trust-'));socket=join(dir,'tmux.sock');mkdirSync(join(dir,'bin'));mkdirSync(join(dir,'home'));const code=join(dir,'fixture.c');writeFileSync(code,String.raw`
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <unistd.h>
#include <termios.h>
int main(int argc,char**argv){
 if(argc>1&&!strcmp(argv[1],"--help")){puts("--approve-for-me --no-daemon");return 0;}
 char cwd[4096];getcwd(cwd,sizeof(cwd));struct termios t;tcgetattr(0,&t);t.c_lflag&=~(ICANON|ECHO);tcsetattr(0,TCSANOW,&t);
 if(strstr(argv[0],"claude"))printf("Accessing workspace:\n\n %s\n\nQuick safety check: Is this a project you created or one you trust?\n❯ 1. Yes, I trust this folder\n  2. No, exit\n\nEnter to confirm · Esc to cancel\n",cwd);
 else printf("You are in %s\n\nDo you trust the contents of this directory? Working with untrusted contents comes with higher risk of prompt injection.\n❯ 1. Yes, continue\n  2. No, quit\n\nPress enter to continue\n",cwd);
 fflush(stdout);int ch;while((ch=getchar())!=EOF){FILE*f=fopen("keys.log","a");fprintf(f,"%d\n",ch);fclose(f);if(ch=='\n'||ch=='\r'){printf("\033[2J\033[HFixture accepted trust\n");fflush(stdout);}}
 return 0;
}`);
 for(const kind of ['claude','codex'])run('cc',[code,'-o',join(dir,'bin',kind)]);
 tmux('-f','/dev/null','new-session','-d','-s','original','sleep','86400');const server=createServer();const port=await new Promise<number>(r=>server.listen(0,'127.0.0.1',()=>r((server.address() as {port:number}).port)));await new Promise<void>(r=>server.close(()=>r()));base=`http://127.0.0.1:${port}`;const config=join(dir,'config.toml');writeFileSync(config,`[[hosts]]\nid="fixture"\nname="Fixture"\nsocket=${JSON.stringify(socket)}\n`);
 backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',base.slice(7),'--config',config,'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{env:{...process.env,PATH:join(dir,'bin')+':'+process.env.PATH,CLAUDE_CONFIG_DIR:join(dir,'home'),CODEX_HOME:join(dir,'home')},stdio:'ignore'});await expect.poll(async()=>{try{return(await api('health')).status}catch{return 0}}).toBe(200);
});
test.afterAll(async()=>{if(backend?.exitCode===null){const exit=new Promise<void>(r=>backend.once('exit',()=>r()));backend.kill('SIGTERM');await exit;}if(socket)spawnSync('tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});
async function launch(kind='claude'){
 project=join(dir,'project-'+crypto.randomUUID().slice(0,8));mkdirSync(project);const host=(await json('hosts'))[0];const r=await api('hosts/fixture/agents/launch-options?'+new URLSearchParams({connection_revision:host.connection_revision,path:project,provider:kind,window_name:'Trust fixture'}));expect(r.status,await r.clone().text()).toBe(200);const p=await r.json();const start=await api('hosts/fixture/agents/launch',{token:p.token,conversation:null});expect(start.status).toBe(200);const started=await start.json();const query=new URLSearchParams({connection_revision:host.connection_revision,session:started.session,window:started.window,pane:started.pane});let detail:any;await expect.poll(async()=>{detail=await json('hosts/fixture/agents/conversation?'+query);return detail.activity.state;}).toBe('awaiting_trust');return{p,started,query,detail,path:project};
}
async function decide(d:any,choice='trust',extra={}){return api('hosts/fixture/agents/folder-trust',{id:crypto.randomUUID(),token:d.folder_trust.token,choice,launch_id:d.folder_trust.launch_id,trust_id:d.folder_trust.id,...extra});}
for(const kind of ['claude','codex'])test(`${kind} folder trust is visible without history and requires one guarded confirmation`,async()=>{
 const f=await launch(kind);expect(f.detail.association).toBe('none');expect(f.detail.send_available).toBe(false);expect(f.detail.message_token).toBeUndefined();const queue=await json('queue');const item=queue.hosts[0].items.find((v:any)=>v.pane===f.started.pane);expect(item.activity.state).toBe('awaiting_trust');expect(item.attention.needs_attention).toBe(true);expect(item.folder_trust.token).toBeUndefined();
 const body={id:crypto.randomUUID(),token:f.detail.folder_trust.token,choice:'trust',launch_id:f.p.launch_id,trust_id:f.detail.folder_trust.id};const before=tmux('display-message','-p','-t','original','#{pane_pid}/#{window_width}x#{window_height}');const response=await api('hosts/fixture/agents/folder-trust',body);expect(response.status,await response.clone().text()).toBe(200);const receipt=(await response.json()).receipt;expect(receipt.status).toBe('submitted');await expect.poll(()=>existsSync(join(f.path,'keys.log'))?readFileSync(join(f.path,'keys.log'),'utf8'):'').toBe('10\n');expect((await api('hosts/fixture/agents/folder-trust',body)).status).toBe(200);expect(readFileSync(join(f.path,'keys.log'),'utf8')).toBe('10\n');expect(tmux('display-message','-p','-t','original','#{pane_pid}/#{window_width}x#{window_height}')).toBe(before);
});
test('decline persists audit without input and fresh explicit trust remains possible',async()=>{
 const f=await launch();const response=await decide(f.detail,'decline');expect(response.status).toBe(200);const receipt=(await response.json()).receipt;expect(receipt.status).toBe('declined');expect(existsSync(join(f.path,'keys.log'))).toBe(false);expect((await json('agents/folder-trust/'+receipt.id)).receipt.choice).toBe('decline');const current=await json('hosts/fixture/agents/conversation?'+f.query);expect(current.activity.state).toBe('awaiting_trust');expect(current.folder_trust.token).toBeTruthy();expect((await decide(current)).status).toBe(200);
});
test('wrong launch and replaced prompt fail closed before any native input',async()=>{
 const f=await launch();expect((await decide(f.detail,'trust',{launch_id:crypto.randomUUID()})).status).toBe(409);tmux('set-option','-w','-t',f.started.window,'@cc_launch','{}');const response=await decide(f.detail);expect(response.status).toBe(200);expect((await response.json()).receipt.status).toBe('rejected');expect(existsSync(join(f.path,'keys.log'))).toBe(false);
});
for(const width of [1440,393])test(`human trust controls work at ${width}px without terminal sockets`,async({page})=>{
 const f=await launch();let sockets=0;page.on('websocket',()=>sockets++);await page.setViewportSize({width,height:900});await page.goto(base+'/#/queue');const card=page.locator('.queue-card').filter({hasText:f.path.split('/').at(-1)!});await card.click();const panel=page.getByRole('region',{name:'Folder trust',exact:true});await expect(panel).toContainText(f.path);await expect(page.locator('.agent-live-activity')).toContainText('folder trust');await expect(page.locator('.queue-chat-notice')).toContainText('Folder trust');await expect(page.locator('.queue-chat-notice')).not.toContainText('Respond in the terminal');await expect(panel.getByRole('button',{name:/Trust this folder/})).toBeEnabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`../test-results/folder-trust-${width}.png`});await panel.getByRole('button',{name:/Decline/}).click();await expect(panel).toContainText('No keys sent');expect(existsSync(join(f.path,'keys.log'))).toBe(false);expect(sockets).toBe(0);
});


test('lost trust acknowledgement keeps one UUID and recovery never repeats native input',async({page})=>{
 const f=await launch();let posts=0;await page.route('**/agents/conversation?*',r=>r.fulfill({json:f.detail}));await page.route('**/agents/folder-trust',async r=>{posts++;await r.fetch();await r.abort('failed');});await page.goto(base+'/#/queue');await page.locator('.queue-card').filter({hasText:f.path.split('/').at(-1)!}).click();const panel=page.getByRole('region',{name:'Folder trust',exact:true});await panel.getByRole('button',{name:/Trust this folder/}).click();await expect(panel).toContainText('will not be resent');await expect.poll(()=>existsSync(join(f.path,'keys.log'))?readFileSync(join(f.path,'keys.log'),'utf8'):'').toBe('10\n');await page.reload();await page.locator('.queue-card').filter({hasText:f.path.split('/').at(-1)!}).click();await expect(panel.getByRole('button',{name:/Trust this folder/})).toBeDisabled();await panel.getByRole('button',{name:'Check response',exact:true}).click();await expect(panel).toContainText('Trust confirmation submitted once');expect(posts).toBe(1);expect(readFileSync(join(f.path,'keys.log'),'utf8')).toBe('10\n');
});


test('a replacement foreground process cannot consume the original trust capability',async()=>{
 const f=await launch();const before=tmux('display-message','-p','-t',f.started.pane,'#{pane_pid}');tmux('respawn-pane','-k','-t',f.started.pane,'-c',f.path,join(dir,'bin','claude'));await expect.poll(()=>tmux('display-message','-p','-t',f.started.pane,'#{pane_pid}')).not.toBe(before);const response=await decide(f.detail);expect(response.status).toBe(200);expect(['rejected','uncertain']).toContain((await response.json()).receipt.status);expect(existsSync(join(f.path,'keys.log'))).toBe(false);
});

test('ticket launch observations and live run detail expose the trust wait',async({page})=>{
 const path=join(dir,'ticket-project');mkdirSync(path);const host=(await json('hosts'))[0];const create=await api('board/tickets',{id:crypto.randomUUID(),revision:null,title:'Trust ticket',description:'Synthetic planning task',status:'backlog',priority:'normal',context:{host:'fixture',path},host_revision:host.connection_revision,checklist:[]});expect(create.status).toBe(200);let ticket=await create.json();const prep=await api(`board/tickets/${ticket.id}/prepare`,{revision:ticket.revision,host:'fixture',connection_revision:host.connection_revision,path,provider:'claude',model:null,prompt:'Synthetic task',card_name:'Trust ticket agent'});expect(prep.status).toBe(200);const grant=await prep.json();expect((await api(`board/tickets/${ticket.id}/launch`,{token:grant.token})).status).toBe(200);await expect.poll(async()=>{ticket=await json(`board/tickets/${ticket.id}`);expect((await api(`board/tickets/${ticket.id}/check`,{revision:ticket.revision})).status).toBe(200);ticket=await json(`board/tickets/${ticket.id}`);return ticket.runs[0].result.launch_state;}).toBe('awaiting_trust');expect(ticket.runs[0].result.folder_trust.folder).toBe(path);const activity=await json('board/activity');expect(activity.items[ticket.id].state).toBe('awaiting_trust');await page.goto(base+'/#/board');await page.getByRole('button',{name:'Trust ticket',exact:true}).click();await expect(page.locator('[data-ticket-trust]')).toContainText('Needs folder trust: '+path);expect(existsSync(join(path,'keys.log'))).toBe(false);
});


test('detail transport failure disables a cached trust action',async({page})=>{
 const f=await launch();await page.goto(base+'/#/queue');await page.locator('.queue-card').filter({hasText:f.path.split('/').at(-1)!}).click();const panel=page.getByRole('region',{name:'Folder trust',exact:true});const trust=panel.getByRole('button',{name:/Trust this folder/});await expect(trust).toBeEnabled();await page.route('**/agents/conversation?*',r=>r.abort('failed'));await expect(trust).toBeDisabled({timeout:15000});expect(existsSync(join(f.path,'keys.log'))).toBe(false);
});
