import {initializeThemes} from './themes';
import {SettingsWorkspace,type FeatureFlags} from './settings';
import {startHeaderClock} from './header-clock';
import {JiraWorkspace} from './jira';
import {readWorkspace,writeWorkspace,type Workspace} from './workspace-router';
import {TicketBoard, type TicketContext} from './board';
import {EmailWorkspace} from './email';
import { SlackWorkspace } from './slack';
import { ClipboardSettings } from './clipboard';
import './style.css';
import { compactClient, compactViewport } from './layout';
import { AttentionQueue, type QueueTarget } from './queue';
import { createTerminal, type TerminalView } from './terminal';
import { initMachines, type Host } from './machines';
import type { FileWorkspace, FileContext } from './files';

initializeThemes();

type Pane = { id: string; index: number; left: number; top: number; width: number; height: number; active: boolean; command: string; cwd: string };
type Window = { id: string; index: number; name: string; width: number; height: number; zoomed: boolean; active: boolean; panes: Pane[] };
type Session = { attached: boolean; id: string; name: string; windows: Window[] };
type Selection = { session?: string; windows: Record<string, string> };
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const machineNav = el('machines'), windowNav = el('windows'), sessionSelect = el<HTMLSelectElement>('sessions');
startHeaderClock(el<HTMLTimeElement>('header-clock'));
const reloadDialog = el<HTMLDialogElement>('reload-app-dialog');
el('reload-app').onclick = () => { reloadDialog.showModal(); el('cancel-app-reload').focus(); };
el('cancel-app-reload').onclick = () => reloadDialog.close();
el('confirm-app-reload').onclick = () => window.location.reload();

const clipboardSettings = new ClipboardSettings(() => { if (terminalAvailable()) terminal?.focus(); });
const terminalElement = el('terminal'), empty = el('empty'), paneControls = el('panes'), menu = el('context-menu');
let hostsReady=false;
let hosts: Host[] = [], hostId = '', sessions: Session[] = [], viewer: Session | undefined;
let terminal: TerminalView | undefined, socket: WebSocket | undefined;
let inputTargetEpoch = 0;
let generation = 0, reconnectTimer = 0, retry = 0, stopped = false;
let hostEvents: EventSource | undefined;
let files: FileWorkspace | undefined, filesLoading: Promise<void> | undefined, drawerVisible = false;
let settingsVisible=false;let settingsReturn:Workspace='queue';let featureFlags:FeatureFlags={slack:false,email:false,jira:false};
let queueVisible = false, slackVisible = false, emailVisible=false, jiraVisible=false, boardVisible=false, fileWorkspaceVisible=false;let fileNavigation=0;
const slack = new SlackWorkspace();
const email = new EmailWorkspace();
const jira = new JiraWorkspace();
let queueTarget: QueueTarget | undefined;
async function openTicketTerminal(target:QueueTarget) {
  if (compactClient()) return;
  const host = hosts.find(h => h.id === target.host && h.connection_revision === target.connection);
  if (!host) { notice('Machine changed. Refresh the queue before opening this request.'); return; }
  selections[target.host] ??= { windows: {} };
  selections[target.host].session = target.session;
  selections[target.host].windows[target.session] = target.window;
  queueTarget = target;
  fileWorkspaceVisible=false;drawerVisible=false;slackVisible=false;slack.setVisible(false);emailVisible=false;email.setVisible(false);jiraVisible=false;jira.setVisible(false);boardVisible=false;board.setVisible(false);showQueue(false);writeWorkspace('terminal');
  if (hostId !== target.host) chooseHost(target.host);
  else { closeTerminal(); await refresh(); }
}
const attention = new AttentionQueue(openTicketTerminal);
const board = new TicketBoard(openTicketTerminal,async(host,path)=>{el('toggle-files').click();await ensureFiles('workspace');files?.openLocation(host,path);},async target=>{el('show-queue').click();await attention.openTarget(target);});
el('ticket-from-terminal').onclick=()=>{const w=currentWindow(),pane=w?.panes.find(p=>p.active),session=sessions.find(s=>s.id===selection().session);void board.create({host:hostId,session:session?.id||'',session_name:session?.name||'',window:w?.id||'',window_number:w?.index,window_name:w?.name||'',pane:pane?.id||'',path:pane?.cwd||''});};
document.addEventListener('cc-create-ticket',((event:CustomEvent<Partial<TicketContext>>)=>{void board.create(event.detail);}) as EventListener);
let activeConnection = '', requestedWindow = '', lastRender = ''; 
let selections: Record<string, Selection> = {};
try { selections = JSON.parse(localStorage.getItem('cc.selections') || '{}'); } catch { /* private storage is optional */ }
function selection(): Selection { return selections[hostId] ??= { windows: {} }; }
function remember() { try { localStorage.setItem('cc.selections', JSON.stringify(selections)); localStorage.setItem('cc.host', hostId); } catch { /* optional */ } }
let terminalStatus={text:'Connecting',state:''};
let activeNotice={text:'',connection:false};
function renderConnection(){const tmux=currentWorkspace()==='terminal'&&!compactClient();el('connection').textContent=tmux||terminalStatus.text==='Backend unavailable'?terminalStatus.text:'Connected';el('connection').dataset.state=tmux||terminalStatus.text==='Backend unavailable'?terminalStatus.state:'online';const box=el('notice');box.textContent=activeNotice.text;box.hidden=!activeNotice.text||activeNotice.connection&&!tmux;}
function status(text: string, state = '') { terminalStatus={text,state};renderConnection(); }
function notice(text: string, connection=false) { if(connection&&activeNotice.text&&!activeNotice.connection)return;activeNotice={text,connection};renderConnection(); }
function clearConnectionNotice(){if(activeNotice.connection)notice('');}

function message(text: string) { empty.textContent = text; empty.hidden = !text; terminalElement.hidden = !!text; }
function button(text: string, action: () => void, className = '') {
  const b = document.createElement('button'); b.textContent = text; b.className = className; b.onclick = action; return b;
}
async function api<T>(path: string): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { signal: AbortSignal.timeout(14000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
type ManagementTarget = { host: string; connection: string; session?: string; window?: string; name?: string; index?: number; expected_windows?: [string, number][]; creation?: 'window' | 'right' | 'below'; pane?: string; directory?: string };
const managementDialog = document.createElement('dialog'); managementDialog.className = 'tmux-management-dialog';
const managementTitle = document.createElement('h2'), managementContext = document.createElement('p'), managementForm = document.createElement('form');
const managementName = document.createElement('input'), managementDirectory = document.createElement('input'), managementFeedback = document.createElement('p');
const managementSubmit = button('Create session', () => {}), managementCancel = button('Cancel', () => managementDialog.close()), managementCheck = button('Check sessions', () => { void refresh(); managementDialog.close(); });
let managementTarget: ManagementTarget | undefined, managementBusy = false;
managementTitle.id = 'tmux-management-title'; managementDialog.setAttribute('aria-labelledby', managementTitle.id);
const nameLabel = document.createElement('label'); nameLabel.textContent = 'Name'; managementName.required = true; managementName.setAttribute('aria-label', 'Tmux name'); nameLabel.append(managementName);
const directoryLabel = document.createElement('label'); directoryLabel.textContent = 'Directory (optional)'; managementDirectory.placeholder = 'Home directory'; managementDirectory.setAttribute('aria-label', 'Session directory'); directoryLabel.append(managementDirectory);
managementFeedback.setAttribute('role', 'status'); managementSubmit.type = 'submit'; managementSubmit.className = 'primary'; managementCancel.type = 'button'; managementCheck.type = 'button';
const managementActions = document.createElement('div'); managementActions.className = 'tmux-management-actions'; managementActions.append(managementSubmit, managementCheck, managementCancel);
managementForm.append(nameLabel, directoryLabel, managementFeedback, managementActions); managementDialog.append(managementTitle, managementContext, managementForm); document.body.append(managementDialog);
managementDialog.addEventListener('cancel', event => { if (managementBusy) event.preventDefault(); });
function openManagement(target: ManagementTarget) {
  if (compactClient() || managementBusy) return;
  managementTarget = target; menu.hidden = true;
  const creation = target.creation, renumber = target.index !== undefined, rename = !!target.window && !creation;
  managementTitle.textContent = creation ? creation === 'window' ? 'New tmux window' : creation === 'right' ? 'Split pane right' : 'Split pane below' : renumber ? 'Renumber tmux window' : rename ? 'Rename tmux window' : 'New tmux session';
  managementContext.textContent = hosts.find(h => h.id === target.host)?.name || target.host;
  managementName.type = renumber ? 'number' : 'text'; managementName.min = '0'; managementName.max = '9999'; managementName.step = '1';
  managementName.setAttribute('aria-label', renumber ? 'Window number' : 'Tmux name');
  nameLabel.firstChild!.textContent = creation === 'window' ? 'Name (optional)' : renumber ? 'Window number' : 'Name';
  nameLabel.hidden = !!creation && creation !== 'window'; managementName.required = !creation;
  managementName.value = creation ? '' : renumber ? String(target.index) : rename ? target.name || '' : 'work'; managementName.maxLength = rename || creation === 'window' ? 120 : 80;
  if (renumber) managementContext.textContent += ` · ${target.name} · Other windows in the range shift by one.`;
  managementDirectory.value = creation ? target.directory || '' : ''; directoryLabel.hidden = rename;
  managementDirectory.setAttribute('aria-label', creation ? 'Working directory' : 'Session directory');
  managementDirectory.placeholder = creation ? 'Source pane directory' : 'Home directory';
  if (creation) managementContext.textContent += ` · ${target.name} · ${target.pane}`;
  managementSubmit.textContent = creation ? creation === 'window' ? 'Create window' : 'Split pane' : renumber ? 'Renumber window' : rename ? 'Rename window' : 'Create session'; managementSubmit.disabled = false;
  managementCheck.hidden = true; managementFeedback.textContent = ''; managementDialog.showModal(); if (nameLabel.hidden) managementDirectory.focus(); else { managementName.focus(); if (!renumber) managementName.select(); }
}
function newSession() {
  const host = hosts.find(h => h.id === hostId); if (host) openManagement({ host: host.id, connection: host.connection_revision });
}
managementForm.onsubmit = async event => {
  event.preventDefault(); const target = managementTarget; if (!target || managementBusy || managementSubmit.disabled) return;
  const name = managementName.value, creation = target.creation, renumber = target.index !== undefined, rename = !!target.window && !creation;
  managementBusy = true; managementSubmit.disabled = true; managementCancel.disabled = true; managementName.disabled = true; managementDirectory.disabled = true;
  managementFeedback.textContent = creation ? 'Creating…' : renumber ? 'Renumbering…' : rename ? 'Renaming…' : 'Creating session…';
  let uncertain = true;
  try {
    const response = await fetch(`/api/v1/hosts/${encodeURIComponent(target.host)}/${creation ? creation === 'window' ? 'windows' : 'panes' : renumber ? 'windows/renumber' : rename ? 'windows/rename' : 'sessions'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creation ? {connection_revision:target.connection,session:target.session,window:target.window,pane:target.pane,expected_directory:target.directory,directory:managementDirectory.value || null,name:creation === 'window' ? name || null : null,direction:creation === 'window' ? null : creation} : renumber ? {connection_revision:target.connection,session:target.session,window:target.window,index:Number(name),expected_windows:target.expected_windows} : rename ? {connection_revision:target.connection,session:target.session,window:target.window,expected_name:target.name,name} : {connection_revision:target.connection,name,directory:managementDirectory.value || null}), signal: AbortSignal.timeout(16000) });
    const data = await response.json(); uncertain = response.status >= 500;
    if (!response.ok) throw new Error(data.error || 'Tmux operation failed');
    uncertain = false; managementDialog.close();
    if (hostId === target.host && hosts.find(h => h.id === hostId)?.connection_revision === target.connection) {
      if (!creation && !rename) { selection().session = data.session; selection().windows[data.session] = data.window; remember(); closeTerminal(); }
      await refresh();
      if (creation && selection().session === target.session) {
        if (creation === 'window') chooseWindow(data.window);
        else if (currentWindow()?.id === data.window) { send({type:'focus',window:data.window,pane:data.pane}); terminal?.focus(); }
      }
    }
  } catch (error) {
    managementFeedback.textContent = `${String(error)}${uncertain ? ' Check sessions before trying again; the operation may have completed.' : ''}`;
    managementCheck.hidden = false;
  } finally {
    managementBusy = false; managementSubmit.disabled = uncertain; managementCancel.disabled = false; managementName.disabled = false; managementDirectory.disabled = false;
  }
};
el('new-session').onclick = newSession;
function createFromPane(creation: 'window' | 'right' | 'below', window = currentWindow(), pane = window?.panes.find(p => p.active)) {
  const host = hosts.find(h => h.id === hostId), session = selection().session;
  if (host && session && window && pane) openManagement({host:host.id,connection:host.connection_revision,session,window:window.id,pane:pane.id,directory:pane.cwd,name:window.name,creation});
}
el('new-window').onclick = () => createFromPane('window');
type CloseSnapshot={name:string;index:number;panes:number;expected:string;affected_sessions:{id:string;name:string;last_window:boolean}[]};
const closeDialog=document.createElement('dialog');closeDialog.className='tmux-management-dialog';closeDialog.setAttribute('aria-label','Close tmux window');
const closeTitle=document.createElement('h2');closeTitle.textContent='Close tmux window';const closeContext=document.createElement('p'),closeFeedback=document.createElement('p');closeFeedback.setAttribute('role','status');
const closeConfirm=button('Close window',()=>void closeWindow()),closeCancel=button('Cancel',()=>closeDialog.close()),closeCheck=button('Check windows',()=>{closeDialog.close();void refresh();});closeConfirm.className='danger';closeCheck.hidden=true;closeDialog.append(closeTitle,closeContext,closeFeedback,closeConfirm,closeCancel,closeCheck);document.body.append(closeDialog);
let closingTarget:{host:string;connection:string;session:string;window:string}|undefined,closingSnapshot:CloseSnapshot|undefined,closeBusy=false,closeGeneration=0;
closeDialog.addEventListener('cancel',event=>{if(closeBusy)event.preventDefault();else closeGeneration++;});closeCancel.onclick=()=>{closeGeneration++;closeDialog.close();};
async function openCloseWindow(target:{host:string;connection:string;session:string;window:string}){
 if(compactClient()||closeBusy)return;menu.hidden=true;closingTarget={...target};closingSnapshot=undefined;const generation=++closeGeneration;closeFeedback.textContent='Checking window…';closeContext.textContent=hosts.find(h=>h.id===target.host)?.name||target.host;closeConfirm.disabled=true;closeCheck.hidden=true;closeCancel.disabled=false;closeDialog.showModal();
 try{const query=new URLSearchParams({connection_revision:target.connection,session:target.session,window:target.window});const response=await fetch(`/api/v1/hosts/${encodeURIComponent(target.host)}/windows/close?${query}`,{signal:AbortSignal.timeout(16000)});const value=await response.json();if(!response.ok)throw Error(value.error||'Could not inspect this window');if(generation!==closeGeneration||!closeDialog.open)return;closingSnapshot=value;const snapshot=value as CloseSnapshot;const ending=snapshot.affected_sessions.filter(s=>s.last_window).map(s=>s.name);closeContext.textContent=`${hosts.find(h=>h.id===target.host)?.name||target.host} · ${snapshot.index} ${snapshot.name} · ${snapshot.panes} pane${snapshot.panes===1?'':'s'}. Closing this window terminates all of its pane processes.${snapshot.affected_sessions.length>1?' It is linked in these sessions: '+snapshot.affected_sessions.map(s=>s.name).join(', ')+'.':''}${ending.length?' This is the last window in '+ending.join(', ')+', so those sessions will also close.':''}`;closeFeedback.textContent='';closeConfirm.disabled=false;closeCancel.focus();}catch(error){if(generation===closeGeneration)closeFeedback.textContent=String(error);}
}
async function closeWindow(){const target=closingTarget,snapshot=closingSnapshot;if(!target||!snapshot||closeBusy)return;closeBusy=true;closeConfirm.disabled=closeCancel.disabled=true;closeFeedback.textContent='Closing window…';
 try{const response=await fetch(`/api/v1/hosts/${encodeURIComponent(target.host)}/windows/close`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connection_revision:target.connection,session:target.session,window:target.window,expected:snapshot.expected}),signal:AbortSignal.timeout(16000)});const value=await response.json();if(!response.ok)throw Error(value.error||'Close failed; check windows before trying again');closeDialog.close();if(hostId===target.host&&hosts.find(h=>h.id===hostId)?.connection_revision===target.connection){if(selection().session===target.session&&selection().windows[target.session]===target.window){delete selection().windows[target.session];remember();closeTerminal();}await refresh();}}
 catch(error){closeFeedback.textContent=String(error)+' Check the windows before taking another action. This close will not be retried.';closeCheck.hidden=false;}
 finally{closeBusy=false;closeCancel.disabled=false;closingSnapshot=undefined;}
}
function windowMenu(event: MouseEvent | KeyboardEvent, w: Window) {
  const host = hosts.find(h => h.id === hostId), session = selection().session; if (!host || !session) return;
  event.preventDefault(); const target = {host:host.id,connection:host.connection_revision,session,window:w.id,name:w.name};
  const windows = viewer?.windows ?? sessions.find(s => s.id === session)?.windows ?? [];
  const closeAction=button('Close window…',()=>void openCloseWindow(target));closeAction.className='danger';
  menu.replaceChildren(button('Rename window…', () => openManagement(target)), button('Renumber window…', () => openManagement({...target,index:w.index,expected_windows:windows.map(window => [window.id,window.index])})),closeAction);
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const x = event instanceof MouseEvent ? event.clientX : rect.left, y = event instanceof MouseEvent ? event.clientY : rect.bottom;
  menu.hidden = false; menu.style.left = `${Math.max(0,Math.min(x,innerWidth-220))}px`; menu.style.top = `${Math.max(0,Math.min(y,innerHeight-120))}px`; menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
function terminalAvailable() {
  const pane = el('terminal-pane');
  return !compactClient() && !settingsVisible && !queueVisible && !slackVisible && !emailVisible && !jiraVisible && !boardVisible && !fileWorkspaceVisible && pane.getClientRects().length > 0 && pane.clientWidth > 0 && pane.clientHeight > 0;
}
function send(control: object) {
  if (['focus', 'select_window'].includes((control as {type?: string}).type || '')) inputTargetEpoch++;
  if (compactClient() || ((control as {type?: string}).type === 'resize' && !terminalAvailable())) return;
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(control));
}
function currentWindow(): Window | undefined {
  const selected=selection(), id=selected.windows[selected.session ?? ''];
  return viewer?.windows.find(w => w.id === id) ?? sessions.find(s => s.id === selected.session)?.windows.find(w => w.id === id);
}
function renderMachines() {
  machineNav.replaceChildren(...hosts.map(h => {
    const b = button(h.name, () => chooseHost(h.id), h.id === hostId ? 'tab active' : 'tab');
    const dot = document.createElement('span'); dot.className = 'dot'; b.prepend(dot);
    b.setAttribute('aria-current', String(h.id === hostId)); b.title = h.remote ? 'SSH host' : 'Local host'; return b;
  }));
}
function render() {
  const signature = JSON.stringify([hostId, sessions, viewer, selection()]);
  if (signature === lastRender) return;
  lastRender = signature;
  sessionSelect.replaceChildren(...sessions.map(s => { const option = document.createElement('option'); option.value = s.id; option.textContent = s.name; return option; }));
  sessionSelect.value = selection().session ?? '';
  sessionSelect.disabled = sessions.length === 0;
  el<HTMLButtonElement>('new-session').disabled = !hosts.some(h => h.id === hostId);
  const selected = sessions.find(s => s.id === selection().session);
  const windows = viewer?.windows ?? selected?.windows ?? [];
  const selectedWindow = selection().windows[selection().session ?? ''];
  windowNav.replaceChildren(...windows.map(w => {
    const b = button(`${w.index}  ${w.name}`, () => chooseWindow(w.id), w.id === selectedWindow ? 'tab active' : 'tab');
    b.setAttribute('aria-current', String(w.id === selectedWindow)); b.title = `${w.name} (${w.id})`; b.setAttribute('aria-haspopup', 'menu'); b.oncontextmenu = event => windowMenu(event, w); b.onkeydown = event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) windowMenu(event, w); }; return b;
  }));
  const w = currentWindow();
  el<HTMLButtonElement>('new-window').disabled = !w || !selected;
  el<HTMLButtonElement>('ticket-from-terminal').disabled=!w;
  el<HTMLButtonElement>('terminal-files').disabled=!w?.panes.some(p=>p.active&&p.cwd);
  files?.setContext(fileContext());
  paneControls.replaceChildren(...(w?.panes ?? []).map(pane => {
    const group = document.createElement('div'); group.className = pane.active ? 'pane-control active' : 'pane-control';
    const focus = button(`${pane.index} · ${pane.command}`, () => { send({ type: 'focus', window: w!.id, pane: pane.id }); terminal?.focus(); });
    focus.title = `Focus pane ${pane.id} · Right-click or Shift+F10 for pane actions`; focus.setAttribute('aria-haspopup', 'menu');
    focus.oncontextmenu = event => paneMenu(event, w!, pane);
    focus.onkeydown = event => { if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) paneMenu(event, w!, pane); };
    const zoom = button(w!.zoomed && pane.active ? '↙ Restore' : '↗ Zoom', () => zoomPane(w!, pane));
    zoom.setAttribute('aria-label', `${w!.zoomed && pane.active ? 'Restore' : 'Maximize'} pane ${pane.id}`);
    group.append(focus, zoom); return group;
  }));
}
function zoomPane(w: Window, pane: Pane) {
  if (w.zoomed && !pane.active) { notice('Restore the focused pane before maximizing another pane.'); return; }
  send({ type: 'zoom', window: w.id, pane: pane.id, zoom: !w.zoomed }); menu.hidden = true; terminal?.focus();
}
function closeTerminal() {
  generation++; clearTimeout(reconnectTimer); socket?.close(); socket = undefined;
  terminal?.dispose(); terminal = undefined; terminalElement.replaceChildren(); viewer = undefined;
  activeConnection = ''; requestedWindow = ''; menu.hidden = true;
}
function connect() {
  if (!terminalAvailable()) return;
  const selected = selection(), session = selected.session, windowId = selected.windows[session ?? ''];
  if (!session || !windowId) return;
  closeTerminal(); requestedWindow=windowId; const token = generation, connectionHost = hostId;
  activeConnection = `${hostId}/${session}`;
  status('Connecting', 'pending'); message(''); clearConnectionNotice();
  terminal = createTerminal(terminalElement, data => {
    if (!terminalAvailable() || socket?.readyState !== WebSocket.OPEN || requestedWindow || !viewer?.attached) return;
    if (data.byteLength > 128 * 1024 || socket.bufferedAmount + data.byteLength > 128 * 1024) { notice('Input buffer full or paste too large (128 KiB maximum). Input was not sent.'); return; }
    for (let i = 0; i < data.length; i += 16 * 1024) socket.send(data.slice(i, i + 16 * 1024));
  }, (cols, rows) => send({ type: 'resize', cols, rows }), () => {
    if (token !== generation || !terminalAvailable() || requestedWindow || !viewer?.attached || socket?.readyState !== WebSocket.OPEN) return undefined;
    const window = viewer.windows.find(w => w.active), pane = window?.panes.find(p => p.active);
    return window && pane ? `${generation}/${inputTargetEpoch}/${hostId}/${session}/${window.id}/${pane.id}` : undefined;
  }, notice);
  const query = new URLSearchParams({ session, window: windowId, cols: String(terminal.cols), rows: String(terminal.rows) });
  if (!terminalAvailable()) { closeTerminal(); return; }
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/v1/hosts/${encodeURIComponent(hostId)}/terminal?${query}`);
  socket = ws; ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    if (token !== generation) return;
    status('Attaching tmux', 'pending'); terminal?.fit();
  };
  ws.onmessage = event => {
    if (token !== generation) return;
    if (event.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(event.data);
      terminal?.write(bytes, () => { if (ws.readyState === WebSocket.OPEN && token === generation) ws.send(JSON.stringify({ type: 'ack', bytes: bytes.byteLength })); });
      return;
    }
    const eventData = JSON.parse(event.data);
    if (eventData.type === 'error') {
      notice(eventData.message,eventData.scope==='connection'||!viewer?.attached); requestedWindow = '';
      const active = viewer?.windows.find(w => w.active);
      if (active) selection().windows[session] = active.id;
      render(); return;
    }
    if (eventData.type === 'state') {
      const wasAttached = viewer?.attached;
      const previousWindow = viewer?.windows.find(w => w.active);
      const previousTarget = `${previousWindow?.id}/${previousWindow?.panes.find(p => p.active)?.id}`;
      viewer = eventData.session;
      const nextWindow = viewer?.windows.find(w => w.active);
      if (previousTarget !== `${nextWindow?.id}/${nextWindow?.panes.find(p => p.active)?.id}`) inputTargetEpoch++;
      if (viewer?.attached && !wasAttached) { retry = 0; if (!queueVisible && !fileWorkspaceVisible && !slackVisible && !emailVisible && !jiraVisible && !boardVisible && !drawerVisible && !settingsVisible && !managementDialog.open) terminal?.focus(); }
      const active = viewer!.windows.find(w => w.active);
      // Do not let an in-flight old state undo the tab the user just selected.
      if (active && (!requestedWindow || requestedWindow === active.id)) {
        selection().windows[session] = active.id; requestedWindow = ''; if (viewer?.attached) {clearConnectionNotice(); status('Attached', 'online');} remember();
      }
      if (queueTarget && queueTarget.host === connectionHost && queueTarget.session === session && viewer?.attached && active?.id === queueTarget.window) {
        const target = queueTarget; queueTarget = undefined;
        if (active.panes.some(p => p.id === target.pane)) {
          if (active.zoomed && !active.panes.find(p => p.id === target.pane)?.active) send({ type: 'zoom', window: active.id, pane: active.panes.find(p => p.active)!.id, zoom: false });
          send({ type: 'focus', window: active.id, pane: target.pane });
          send({ type: 'zoom', window: active.id, pane: target.pane, zoom: true });
        } else notice('The requested pane is no longer available.');
      }
      render();
    }
  };
  ws.onerror = () => { if (token === generation) status('Connection failed', 'error'); };
  ws.onclose = () => {
    if (token !== generation || stopped || hostId !== connectionHost) return;
    const delay = Math.min(1000 * 2 ** retry++, 10000);
    status(`Reconnecting in ${delay / 1000}s`, 'pending');
    reconnectTimer = window.setTimeout(() => { if (token === generation) connect(); }, delay);
  };
}
function chooseWindow(id: string) {
  selection().windows[selection().session!] = id; remember(); requestedWindow = id;
  if (socket?.readyState === WebSocket.OPEN) { status('Switching window', 'pending'); send({ type: 'select_window', window: id }); } else connect();
  render(); terminal?.focus();
}
async function refresh() {
  const host = hostId, connection = hosts.find(h => h.id === host)?.connection_revision, refreshGeneration = generation;
  if (!host) return;
  if (compactClient() && (queueVisible || slackVisible || emailVisible || jiraVisible || boardVisible || fileWorkspaceVisible || !drawerVisible)) { status('Connected', 'online'); return; }
  try {
    const inventory = await api<{ sessions: Session[] }>(`/hosts/${encodeURIComponent(host)}/inventory`);
    if (host !== hostId || refreshGeneration !== generation || connection !== hosts.find(h => h.id === hostId)?.connection_revision || stopped) return;
    clearConnectionNotice();
    sessions = inventory.sessions;
    const selected = selection();
    let session = sessions.find(s => s.id === selected.session);
    if (!session) { session = sessions[0]; selected.session = session?.id; }
    if (!session || session.windows.length === 0) {
      closeTerminal(); status(compactClient() ? 'Connected' : 'No sessions', compactClient() ? 'online' : ''); message('No tmux sessions on this machine.'); empty.append(button('New session', newSession, 'primary')); render(); return;
    }
    if (!session.windows.some(w => w.id === selected.windows[session.id])) selected.windows[session.id] = session.windows.find(w => w.active)?.id ?? session.windows[0].id;
    remember(); render();
    if (compactClient()) status('Connected', 'online');
    if (terminalAvailable() && (activeConnection !== `${host}/${session.id}` || !socket || socket.readyState >= WebSocket.CLOSING)) connect();
  } catch (error) {
    if (host !== hostId || refreshGeneration !== generation || connection !== hosts.find(h => h.id === hostId)?.connection_revision || stopped) return;
    if (!terminal || socket?.readyState !== WebSocket.OPEN) { status('Machine unavailable · retrying', 'pending'); if(!terminal)message('This machine is unavailable. Retrying automatically…'); }
  }
}
function chooseHost(id: string) {
  if (id === hostId) return;
  closeTerminal(); hostId = id; sessions = []; retry = 0; remember(); renderMachines(); render();
  if (!id) { status('No machines'); message('Add a machine in Settings > Machines.'); notice(''); return; }
  status('Discovering', 'pending'); message('Discovering tmux sessions…'); notice(''); void refresh();
}
sessionSelect.onchange = () => {
  selection().session = sessionSelect.value; remember(); closeTerminal(); retry = 0; render(); void refresh();
};
el('reconnect').onclick = () => { retry = 0; connect(); void refresh(); };
terminalElement.addEventListener('mousedown', event => { if (event.button === 2) { event.preventDefault(); event.stopPropagation(); } }, true);
terminalElement.addEventListener('contextmenu', event => {
  event.preventDefault(); const w = currentWindow(), cell = terminal?.cellAt(event);
  if (!w || !cell) return;
  const pane = w.zoomed ? w.panes.find(p => p.active) : w.panes.find(p => cell.col >= p.left && cell.col < p.left + p.width && cell.row >= p.top && cell.row < p.top + p.height);
  if (!pane) return;
  paneMenu(event, w, pane);
});
function paneMenu(event: MouseEvent | KeyboardEvent, w: Window, pane: Pane) {
  event.preventDefault();
  const view = terminal;
  const sourceHost = hosts.find(h => h.id === hostId), sourceSession = selection().session;
  const source: ManagementTarget | undefined = sourceHost && sourceSession ? {host:sourceHost.id,connection:sourceHost.connection_revision,session:sourceSession,window:w.id,pane:pane.id,directory:pane.cwd,name:w.name} : undefined;
  const splitRight = button('Split right…', () => { if (source) openManagement({...source,creation:'right'}); });
  const splitBelow = button('Split below…', () => { if (source) openManagement({...source,creation:'below'}); });
  splitRight.disabled = splitBelow.disabled = !source;
  const clipboardAction = (action: () => Promise<void>) => {
    menu.hidden = true;
    void action().catch(error => notice(String(error))).finally(() => {
      if (terminal === view && terminalAvailable() && !document.querySelector('dialog[open]')) view?.focus();
    });
  };
  const copy = button('Copy selection', () => clipboardAction(() => view!.copySelection())); copy.disabled = !view?.hasSelection();
  const paste = button('Paste', () => clipboardAction(() => view!.pasteClipboard()));
  paste.disabled = !pane.active; paste.title = pane.active ? 'Paste into the active pane' : 'Focus this pane before pasting';
  const settings = button('Clipboard settings…', () => { menu.hidden = true; const host = hosts.find(h => h.id === hostId); if (host) clipboardSettings.open({host:host.id,connection:host.connection_revision,name:host.name}); });
  menu.replaceChildren(copy, paste, settings, splitRight, splitBelow, button(`Focus pane ${pane.index}`, () => { send({ type: 'focus', window: w.id, pane: pane.id }); menu.hidden = true; terminal?.focus(); }), button(w.zoomed ? 'Restore pane layout' : 'Maximize pane', () => zoomPane(w, pane)));
  menu.hidden = false; const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const x = event instanceof MouseEvent ? event.clientX : rect.left, y = event instanceof MouseEvent ? event.clientY : rect.top;
  menu.style.left = `${Math.max(0, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`; menu.style.top = `${Math.max(0, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
}
document.addEventListener('pointerdown', event => { if (!menu.contains(event.target as Node)) menu.hidden = true; });
document.addEventListener('keydown', event => { if (event.key === 'Escape') menu.hidden = true; });
function applyHosts(next: Host[]) {
  const before = hosts.find(h => h.id === hostId);
  if (JSON.stringify(hosts) === JSON.stringify(next)) { files?.setHosts(next); slack.setHosts(next); email.setHosts(next);jira.setHosts(next);board.setHosts(next); return; }
  hosts = next; slack.setHosts(next); email.setHosts(next);jira.setHosts(next);board.setHosts(next);
  files?.setHosts(hosts);
  const after = hosts.find(h => h.id === hostId);
  if (!after) {
    if (hostId || hosts.length) chooseHost(hosts[0]?.id ?? '');
    else { renderMachines(); status('No machines'); message('Add a machine in Settings > Machines.'); }
  } else if (before && before.connection_revision !== after.connection_revision) {
    closeTerminal(); sessions = []; retry = 0; renderMachines(); render(); void refresh();
  } else { renderMachines(); }
}
function subscribeHosts() {
  hostEvents?.close();
  hostEvents = new EventSource('/api/v1/events/hosts');
  hostEvents.addEventListener('hosts', event => applyHosts(JSON.parse((event as MessageEvent).data).hosts));
}
function fileContext(): FileContext {
  const window = currentWindow();
  return { host: hostId, cwd: window?.panes.find(p => p.active)?.cwd, folders: window?.panes.filter(p => p.cwd).map(p => ({ pane: p.id, path: p.cwd })) || [] };
}
function showQueue(visible: boolean) {
  if(visible){settingsVisible=false;settingsWorkspace.setVisible(false);slackVisible=false;slack.setVisible(false);emailVisible=false;email.setVisible(false);jiraVisible=false;jira.setVisible(false);boardVisible=false;board.setVisible(false);fileWorkspaceVisible=false;}
  queueVisible=visible;const overlay=settingsVisible||visible||slackVisible||emailVisible||jiraVisible||boardVisible||fileWorkspaceVisible;
  settingsWorkspace.setVisible(settingsVisible);el('open-settings').setAttribute('aria-pressed',String(settingsVisible));
  el('board-pane').hidden=!boardVisible;el('show-board').setAttribute('aria-pressed',String(boardVisible));
  el('jira-pane').hidden=!jiraVisible;el('show-jira').setAttribute('aria-pressed',String(jiraVisible));
  el('email-pane').hidden=!emailVisible;el('show-email').setAttribute('aria-pressed',String(emailVisible));
  el('slack-pane').hidden=!slackVisible;el('show-slack').setAttribute('aria-pressed',String(slackVisible));el('queue-pane').hidden=!visible;
  el('terminal-pane').hidden=overlay||compactClient();el('machines').hidden=overlay||compactClient();document.querySelector<HTMLElement>('.workspace-bar')!.hidden=overlay||compactClient();document.querySelector<HTMLElement>('footer')!.hidden=overlay||compactClient();
  el('show-queue').setAttribute('aria-pressed',String(visible));el('toggle-files').setAttribute('aria-pressed',String(fileWorkspaceVisible));el('show-terminal').setAttribute('aria-pressed',String(!compactClient()&&!overlay));el('terminal-files').setAttribute('aria-pressed',String(!overlay&&drawerVisible));
  const showFiles=!settingsVisible&&!visible&&!slackVisible&&!emailVisible&&!jiraVisible&&!boardVisible&&(fileWorkspaceVisible||drawerVisible);el('files-pane').hidden=!showFiles;el('workspace').classList.toggle('with-files',!overlay&&drawerVisible);el('workspace').classList.toggle('files-workspace',fileWorkspaceVisible&&!settingsVisible&&!visible&&!slackVisible&&!emailVisible&&!jiraVisible&&!boardVisible);files?.setVisible(showFiles);attention.setVisible(visible);menu.hidden=true;renderConnection();
}
async function ensureFiles(mode:'workspace'|'context'){
  if(!hostsReady)return;
  const navigation=++fileNavigation;if(files)return;
  if(!files){filesLoading??=import('./files').then(module=>{files=new module.FileWorkspace(hosts,fileContext());}).catch(error=>{el('files-pane').textContent=String(error);}).finally(()=>{filesLoading=undefined;});await filesLoading;}
  const workspace=files as FileWorkspace|undefined;
  if(navigation!==fileNavigation||!workspace||settingsVisible||queueVisible||slackVisible||emailVisible||jiraVisible||boardVisible||mode!==(fileWorkspaceVisible?'workspace':'context')||!fileWorkspaceVisible&&!drawerVisible)return;
  workspace.setMode(mode,fileContext(),mode==='context');workspace.setVisible(true);
}
function currentWorkspace():Workspace{return settingsVisible?'settings':boardVisible?'board':jiraVisible?'jira':emailVisible?'email':slackVisible?'slack':fileWorkspaceVisible?'files':queueVisible?'queue':'terminal';}
function navigateWorkspace(requested:Workspace,replace=false){
  let next=compactClient()&&requested==='terminal'?'queue':requested;
  if((next==='slack'||next==='email'||next==='jira')&&!featureFlags[next]){next='settings';settingsWorkspace.select('features');settingsReturn='queue';}
  if(settingsVisible&&next!=='settings'&&!settingsWorkspace.canLeave()){writeWorkspace('settings',true);return;}
  if(next==='settings'&&!settingsVisible&&requested==='settings'){const previous=currentWorkspace();settingsReturn=(previous==='slack'||previous==='email'||previous==='jira')&&!featureFlags[previous]?'queue':previous;}
  settingsVisible=next==='settings';
  writeWorkspace(next,replace);
  slackVisible=next==='slack';slack.setVisible(slackVisible);
  emailVisible=next==='email';email.setVisible(emailVisible);
  jiraVisible=next==='jira';jira.setVisible(jiraVisible);
  boardVisible=next==='board';board.setVisible(boardVisible);
  fileWorkspaceVisible=next==='files';
  if(next==='files')files?.setMode('workspace',fileContext());
  if(next==='terminal'&&drawerVisible)files?.setMode('context',fileContext(),true);
  showQueue(next==='queue');
  if(compactClient()){
    const nav=el('workspace-nav'),tab=nav.querySelector<HTMLElement>('button[aria-pressed=true]');
    if(tab){const area=nav.getBoundingClientRect(),active=tab.getBoundingClientRect();if(active.right>area.right)nav.scrollLeft+=active.right-area.right+4;else if(active.left<area.left)nav.scrollLeft-=area.left-active.left+4;}
  }
  if(next==='files'){closeTerminal();void ensureFiles('workspace');}
  else if(next==='terminal'){if(drawerVisible)void ensureFiles('context');terminal?.fit();terminal?.focus();void refresh();}
}
for(const [id,workspace] of Object.entries({'show-terminal':'terminal','toggle-files':'files','show-queue':'queue','show-slack':'slack','show-email':'email','show-jira':'jira','show-board':'board','open-settings':'settings'}))el(id).onclick=()=>navigateWorkspace(workspace as Workspace);
function restoreWorkspace(){const requested=readWorkspace()||(compactClient()?'queue':'terminal');const next=compactClient()&&requested==='terminal'?'queue':requested;if(currentWorkspace()!==next||location.hash!==`#/${next}`)navigateWorkspace(next,true);}
window.addEventListener('popstate',restoreWorkspace);
window.addEventListener('hashchange',restoreWorkspace);
el('terminal-files').onclick=()=>{
  if(compactClient())return;drawerVisible=!drawerVisible;if(drawerVisible)files?.setMode('context',fileContext(),true);showQueue(false);if(drawerVisible)void ensureFiles('context');else terminal?.focus();void refresh();
};
function applyViewportPolicy(){
  const compact=compactClient();el('show-terminal').hidden=compact;document.documentElement.classList.toggle('compact-client',compact);
  if(compact){closeTerminal();queueTarget=undefined;if(currentWorkspace()==='terminal')navigateWorkspace('queue',true);else showQueue(queueVisible);if(hosts.length)status('Connected','online');}
  else {showQueue(queueVisible);if(hostId)void refresh();}
}
compactViewport.addEventListener('change',applyViewportPolicy);
// Apply the route before discovering hosts or creating any terminal viewer.
const machineSettings=initMachines(applyHosts,()=>navigateWorkspace(settingsReturn));
const settingsWorkspace=new SettingsWorkspace(machineSettings,flags=>{featureFlags=flags;for(const name of ['slack','email','jira'] as const)el('show-'+name).hidden=!flags[name];const active=currentWorkspace();if((active==='slack'||active==='email'||active==='jira')&&!flags[active]){settingsWorkspace.select('features',true);navigateWorkspace('settings',true);}},workspace=>navigateWorkspace(workspace));
for(const name of ['slack','email','jira'])el('show-'+name).hidden=true;
void settingsWorkspace.refresh().finally(()=>{navigateWorkspace(readWorkspace()||(compactClient()?'queue':'terminal'),true);applyViewportPolicy();void start();});
window.setInterval(()=>{if(!document.hidden)void settingsWorkspace.refresh();},10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)void settingsWorkspace.refresh();});
window.addEventListener('pagehide', () => { stopped = true; hostEvents?.close(); closeTerminal(); });
window.addEventListener('pageshow', event => { if (event.persisted) { stopped = false; restoreWorkspace();subscribeHosts(); void refresh(); } });
async function poll() { if (!document.hidden && !stopped) await refresh(); window.setTimeout(poll, 2000); }
async function start() {
  try {
    hosts = await api<Host[]>('/hosts');hostsReady=true;applyHosts(hosts);
    let saved = ''; try { saved = localStorage.getItem('cc.host') ?? ''; } catch { /* optional */ }
    if (hosts.length) chooseHost(hosts.find(h => h.id === saved)?.id ?? hosts[0].id);
    else { status('No machines'); message('Add a machine in Settings > Machines.'); }
    if(fileWorkspaceVisible)void ensureFiles('workspace');
    subscribeHosts();
    window.setTimeout(poll, 2000);
  } catch (error) { status('Backend unavailable', 'error'); message(String(error)); }
}
