import {enableFeatures} from './feature-fixture';
import {test,expect} from '@playwright/test';
import {mkdtempSync,cpSync,mkdirSync,symlinkSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawn,spawnSync} from 'node:child_process';import {createServer} from 'node:net';
let dir:string,project:string,other:string,socket:string,base:string,backend:ReturnType<typeof spawn>,fixture:any;
const myOpen='assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
function issue(key='WORK-1',summary='Jira fixture issue',extra:Record<string,unknown>={}){return{key,id:'1',self:'PRIVATE_JIRA_TOKEN',fields:{summary,status:{name:'Open',statusCategory:{key:'new'}},priority:{name:'High'},issuetype:{name:'Task'},assignee:{displayName:'Fixture user',emailAddress:'PRIVATE_EMAIL'},reporter:{displayName:'Reporter'},project:{key:'WORK',name:'Work project'},labels:['fixture'],updated:'2026-11-03T10:00:00Z',...extra}};}
function update(patch:Record<string,unknown>={}){fixture={...fixture,...patch};writeFileSync(join(project,'fixture.json'),JSON.stringify(fixture));}
function tm(...args:string[]){const r=spawnSync('tmux',['-S',socket,...args],{encoding:'utf8',env:{...process.env,TMUX:''}});if(r.status)throw Error(r.stderr);return r.stdout.trim();}
async function port(){return new Promise<number>(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(()=>r(p));});});}
async function api(path:string,body?:unknown,method=body?'POST':'GET'){return fetch(base+'/api/v1/jira/'+path,{method,headers:{Origin:base,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});}
async function settings(){return(await api('settings')).json();}
async function configure(path=project){const s=await settings(),hosts=await(await fetch(base+'/api/v1/hosts')).json();const r=await api('settings',{revision:s.revision,host:'local',connection_revision:hosts[0].connection_revision,project:path},'PUT');expect(r.status).toBe(200);return r.json();}
async function read(operation:string,args:Record<string,unknown>={},s?:any){s??=await settings();return api('read',{revision:s.revision,connection_revision:s.connection_revision,operation,...args});}
function calls(){return existsSync(join(project,'calls.jsonl'))?readFileSync(join(project,'calls.jsonl'),'utf8').split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];}

test.beforeAll(async()=>{
 dir=mkdtempSync(join(tmpdir(),'cc-jira-'));socket=join(dir,'tmux.sock');project=join(dir,"source ' café");other=join(dir,'other');
 for(const p of [project,other]){cpSync(resolve('../tests/fixtures/jira-source'),p,{recursive:true});mkdirSync(join(p,'.venv/bin'),{recursive:true});symlinkSync('/usr/bin/python3',join(p,'.venv/bin/python'));}
 fixture={issues:[issue(),issue('WORK-2','Second fixture')],older:[issue('WORK-3','Older issue')],cursor:'next-token',issue:issue('WORK-1','Jira fixture issue',{description:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Description <img src="https://jira-spy.invalid/pixel" onerror="window.jiraScript=1">'}]}]},comment:{comments:[{id:'one',author:{displayName:'Alice'},body:'Initial comment'}],startAt:0,total:2},attachment:[{filename:'note.txt',size:12,content:'PRIVATE_JIRA_TOKEN'}]}),comments:[{id:'two',author:{displayName:'Bob'},body:'Second comment'}],comment_total:2};update();writeFileSync(join(other,'fixture.json'),JSON.stringify({...fixture,issues:[issue('OTHER-1','Other source issue')]}));
 tm('-f','/dev/null','new-session','-d','-s','jira-test','-x','120','-y','35');writeFileSync(join(dir,'config'),`[[hosts]]\nid="local"\nname="Jira fixture host"\nsocket=${JSON.stringify(socket)}\n`);
 const p=await port();base=`http://127.0.0.1:${p}`;backend=spawn(resolve(process.env.CC_BINARY||'../target/release/command-center'),['--listen',`127.0.0.1:${p}`,'--config',join(dir,'config'),'--web-dir',resolve(process.env.CC_WEB_DIR||'dist-next')],{stdio:'pipe'});
 await expect.poll(async()=>{try{return(await fetch(base+'/api/v1/health')).status;}catch{return 0;}}).toBe(200);await enableFeatures(base);
});
test.afterAll(()=>{backend?.kill('SIGTERM');if(socket)spawnSync('tmux',['-S',socket,'kill-server']);if(dir)rmSync(dir,{recursive:true,force:true});});

test('Jira defaults to my open tickets, accepts literal JQL, pages, and renders safe issue details',async({page})=>{
 await configure();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let external=0;page.on('request',r=>{if(r.url().includes('jira-spy'))external++;});
 await page.goto(base+'/#/jira');await expect(page.locator('#show-jira')).toHaveAttribute('aria-pressed','true');await expect(page.getByLabel('JQL query',{exact:true})).toHaveValue(myOpen);await expect(page.locator('.jira-issue')).toHaveCount(2);
 await page.getByRole('button',{name:'More issues',exact:true}).click();await expect(page.locator('.jira-issue')).toHaveCount(3);
 const query='project = WORK AND text ~ "$(touch '+join(dir,'must-not-exist')+')"';await page.getByLabel('JQL query',{exact:true}).fill(query);await page.getByRole('button',{name:'Search Jira',exact:true}).click();await expect(page.locator('.jira-issue')).toHaveCount(2);expect(calls().filter(c=>c.method==='POST').at(-1).params.jql).toBe(query);expect(existsSync(join(dir,'must-not-exist'))).toBe(false);
 await page.locator('.jira-issue').first().click();await expect(page.getByLabel('Jira issue details',{exact:true})).toContainText('Description <img');await expect(page.locator('.jira-reader img,.jira-reader script')).toHaveCount(0);expect(external).toBe(0);
 await expect(page.getByRole('link',{name:'Open in Jira',exact:true})).toHaveAttribute('href','https://fixture.atlassian.net/browse/WORK-1');await page.getByRole('button',{name:'More comments',exact:true}).click();await expect(page.locator('.jira-reader')).toContainText('Second comment');await expect(page.locator('.jira-reader')).toContainText('note.txt');await page.screenshot({path:'../test-results/jira-desktop.png'});
 await page.locator('#show-queue').click();await page.locator('#show-jira').click();await expect(page.getByLabel('JQL query',{exact:true})).toHaveValue(query);await expect(page.locator('.jira-reader')).toContainText('Second comment');
 await page.reload();await expect(page.locator('#show-jira')).toHaveAttribute('aria-pressed','true');await expect(page.locator('.jira-issue')).toHaveCount(2);expect(page.url()).toContain('#/jira');expect(errors).toEqual([]);
 expect(readFileSync(join(dir,'config.jira.json'),'utf8')).not.toContain('PRIVATE_JIRA_TOKEN');expect(readFileSync(join(dir,'config.jira.json'),'utf8')).not.toContain('Jira fixture issue');
});

test('Jira caching, revisions, rate limits, invalid reads and source changes fail safely',async()=>{
 let s=await configure();const first=await read('search',{query:myOpen},s);expect(first.status).toBe(200);const n=calls().length;expect((await read('search',{query:myOpen},s)).status).toBe(200);expect(calls()).toHaveLength(n);
 expect((await read('update',{key:'WORK-1'},s)).status).toBe(400);expect((await read('issue',{key:'../../secret'},s)).status).toBe(400);expect((await read('search',{query:'x'.repeat(4001)},s)).status).toBe(400);
 update({delay:true});const started=join(project,'started');const pending=read('issue',{key:'WORK-1',refresh:true},s);await expect.poll(()=>existsSync(started)).toBe(true);await configure(other);const stale=await pending;expect(stale.status).toBe(409);expect(await stale.text()).not.toContain('Jira fixture issue');
 update({delay:false,error:429});s=await configure();expect((await read('search',{query:myOpen,refresh:true},s)).status).toBe(429);const limited=calls().length;expect((await read('search',{query:myOpen,refresh:true},s)).status).toBe(429);expect(calls()).toHaveLength(limited);
 update({error:400});s=await configure();const bad=await read('search',{query:'invalid JQL',refresh:true},s);expect(bad.status).toBe(400);expect(await bad.text()).not.toContain('PRIVATE_JIRA_TOKEN');update({error:null});await configure();
});

test('phone Jira scrolls lists and issue bodies without attaching or resizing tmux',async({page,browser})=>{
 const previous={...fixture};update({issues:Array.from({length:35},(_,i)=>issue(`WORK-${i+1}`,`Phone issue ${i}`)),cursor:'',issue:issue('WORK-1','Long mobile issue',{description:Array.from({length:150},(_,i)=>`Line ${i}: long issue description`).join('\n')})});await configure();
 await page.goto(base);await expect(page.locator('#connection')).toHaveText('Attached');const before=tm('list-panes','-a','-F','#{pane_id} #{pane_pid} #{pane_width}x#{pane_height}');
 const phone=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});let sockets=0;phone.on('websocket',w=>{if(w.url().includes('/terminal?'))sockets++;});await phone.goto(base+'/#/jira');await expect(phone.locator('.jira-issue')).toHaveCount(30);const tab=(await phone.locator('#show-jira').boundingBox())!,nav=(await phone.locator('#workspace-nav').boundingBox())!;expect(tab.x).toBeGreaterThanOrEqual(nav.x-1);expect(tab.x+tab.width).toBeLessThanOrEqual(nav.x+nav.width+1);
 const swipe=async(selector:string)=>{const area=phone.locator(selector);expect(await area.evaluate(n=>n.scrollHeight-n.clientHeight)).toBeGreaterThan(100);const box=(await area.boundingBox())!;const cdp=await phone.context().newCDPSession(phone);const x=box.x+box.width*.6,start=box.y+box.height-30,end=box.y+30;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y:start,id:0}]});for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:start+(end-start)*i/10,id:0}]});await phone.waitForTimeout(20);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await expect.poll(()=>area.evaluate(n=>n.scrollTop)).toBeGreaterThan(40);};
 await swipe('.jira-list');await phone.locator('.jira-issue').first().click();await expect(phone.locator('.jira-reader')).toContainText('Line 149');await swipe('.jira-reader');await phone.screenshot({path:'../test-results/jira-phone.png'});expect(await phone.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await phone.getByRole('button',{name:'Back to issues',exact:true}).click();await expect(phone.locator('.jira-list-pane')).toBeVisible();expect(sockets).toBe(0);expect(tm('list-panes','-a','-F','#{pane_id} #{pane_pid} #{pane_width}x#{pane_height}')).toBe(before);await phone.close();fixture=previous;update();
});

test('Jira settings switch to another existing source without leaking old results',async({page})=>{
 await configure();await page.goto(base+'/#/jira');await expect(page.locator('.jira-issue')).toHaveCount(2);await page.getByText('Jira tools',{exact:true}).click();await page.getByRole('button',{name:'Jira settings',exact:true}).click();await page.getByLabel('Jira source project',{exact:true}).fill(other);await page.getByRole('button',{name:'Save Jira source',exact:true}).click();await expect(page.getByRole('dialog',{name:'Jira source',exact:true})).toBeHidden();await expect(page.locator('.jira-list')).toContainText('Other source issue');await expect(page.locator('.jira-list')).not.toContainText('Jira fixture issue');
});

test('machine connection changes clear Jira results and require a fresh read',async({page})=>{
 await configure();await page.goto(base+'/#/jira');await expect(page.locator('.jira-issue')).toHaveCount(2);
 const hostSettings=await(await fetch(base+'/api/v1/settings/hosts')).json();const alias=join(dir,'jira-alias.sock');symlinkSync(socket,alias);
 const response=await fetch(base+'/api/v1/hosts/local',{method:'PUT',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({revision:hostSettings.revision,host:{name:'Jira fixture renamed',socket:alias,ssh:null,ssh_config:null}})});expect(response.status).toBe(200);
 await expect(page.locator('.jira-list')).not.toContainText('Jira fixture issue');await expect(page.locator('.jira-feedback')).toContainText('source connection changed');
 await page.getByRole('button',{name:'Refresh Jira',exact:true}).click();await expect(page.locator('.jira-issue')).toHaveCount(2);
});
