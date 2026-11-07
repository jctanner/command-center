import {BackgroundTasks,backgroundLabel,type BackgroundSnapshot} from './agent-background';
import {AgentRestarter} from './agent-restart';
import {AgentCloser} from './agent-close';
import {chatMarkdown} from './chat-markdown';
import {AgentOutbox,OutboxSendError,type OutboxEntry} from './agent-outbox';
import { activityElement, type AgentActivityEntry } from './agent-activity';
import {AgentCardEditor,type AgentCard,type CardTarget} from './agent-card-editor';
import { AgentNotifications } from './notifications';
import { AgentLauncher, type LaunchedAgent } from './agent-launch';
import { compactClient, compactViewport } from './layout';
type ReadState = { key: string; instance: string; revision: number; finished: boolean; new_approval: boolean; unread_reply: boolean; needs_attention: boolean; conversation?: string; reply_cursor?: string; history_id?: string };
type AgentState = 'working' | 'ready' | 'approval' | 'unknown' | 'disconnected';
type Activity = { state: AgentState; source: string; reason: string; evidence_at?: number; observed_at: number; transition?: string };
export type QueueTarget = { instance?:string|null;host: string; connection: string; session: string; window: string; pane: string };
type Item = { background_tasks?:BackgroundSnapshot|null;card?:AgentCard;attention?: ReadState; id: string; session: string; session_name: string; window: string; window_name: string; pane: string; project: string; agent: string; prompt: string; context: string; status?: 'attention' | 'live' | 'disconnected'; activity?: Activity; last_seen?: number };
type Host = { id: string; name: string; connection_revision: string; error?: string; limited: boolean; items: Item[] };
type Snapshot = { checked_at: number; hosts: Host[] };
type Message = { id: string; role: 'user' | 'assistant'; text: string; timestamp: string; order?: number; truncated?: boolean };
type Conversation = { id: string; session: string; timestamp: string; linked: boolean };
type Approval = { id: string; title: string; context: string; choices: { id: string; label: string }[]; token?: string; submitted?: boolean };
type Detail = { background_tasks?:BackgroundSnapshot|null;outbox_entries?:OutboxEntry[]; card?:AgentCard;approval?: Approval; read_state?: ReadState; activity?: Activity; instance?: string; context: string; project: string; provider: string; selected?: string; association: string; conversations: Conversation[]; messages: Message[]; activities?: AgentActivityEntry[]; activity_limited?: boolean; older_cursor?: number; send_available: boolean; send_reason?: string; message_token?: string; attention: boolean; history_version?: string; history_unchanged?: boolean; history_branch?: string; history_reset?: boolean; history_notice?: string };
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, text = ''): HTMLElementTagNameMap[K] => { const n = document.createElement(tag); n.textContent = text; return n; };
const stateOf = (item: Item): AgentState => item.activity?.state || (item.status === 'disconnected' ? 'disconnected' : item.status === 'attention' || (!item.status && item.prompt !== 'Live agent') ? 'approval' : 'unknown');
const projectName = (path: string) => path.split('/').filter(Boolean).at(-1) || '/';
const agentTitle = (item: Item) => item.card?.name || (compactClient() && ['claude','codex','pi','pi-coding-agent'].includes(item.window_name.toLowerCase()) ? projectName(item.project) : item.window_name);
const waiting = (item: Item) => stateOf(item) === 'approval';
const unread = (state?: ReadState) => !!state && (state.finished || state.new_approval || state.unread_reply);
const needsAttention = (item: Item) => waiting(item) || unread(item.attention);
const stateLabel = (state: AgentState, source?: string) => ({ working: 'Working', ready: 'Ready', approval: source === 'pi_bridge' ? 'Awaiting input' : source === 'terminal_prompt' ? 'Approval (detected)' : 'Awaiting approval', unknown: 'Unknown', disconnected: 'Disconnected' })[state];
const rank: Record<AgentState, number> = { approval: 0, ready: 1, working: 2, unknown: 3, disconnected: 4 };
function stateBadge(activity?: Activity, fallback: AgentState = 'unknown') {
  const badge = node('span', stateLabel(activity?.state || fallback, activity?.source));
  badge.className = 'agent-state'; badge.dataset.state = activity?.state || fallback;
  badge.title = activity ? `${activity.reason} · Source: ${activity.source}${activity.evidence_at != null ? ` · Reported ${new Date(activity.evidence_at * 1000).toLocaleString()}` : ''}` : 'No verified provider status available';
  badge.setAttribute('aria-label', `Agent state: ${stateLabel(activity?.state || fallback, activity?.source)}`);
  return badge;
}
export class AttentionQueue {
  private notifications = new AgentNotifications();
  private mute = node('button', 'Mute notifications');
  private restartAgent=node('button','Restart agent…');private agentRestarter:AgentRestarter;
  private closeAgent=node('button','Close agent…');private agentCloser:AgentCloser;private cardMenu=node('div');private editCard=node('button','Edit card');private cardNotes=node('p');private cardVersions=new Map<string,AgentCard>();private cardEditor:AgentCardEditor;
  private visible = false;
  private refreshing?: Promise<void>;
  private snapshot?: Snapshot;
  private selected = '';
  private host = '';
  private project = '';
  private root = document.getElementById('queue-pane')!;
  private list = node('div');
  private detail = node('section');
  private body = node('div');
  private feedback = node('p');
  private hostSelect = node('select');
  private projectSelect = node('select');
  private statusSelect = node('select');
  private title = node('h2');
  private location = node('p');
  private detailFeedback = node('p');
  private activityBadge = stateBadge();
  private liveActivity = node('div');
  private backgroundTasks=new BackgroundTasks();
  private detailUnavailable = false;
  private lastDetailPoll = 0;
  private pendingReplies = new Map<string, { at: number; reply: string; activity: string }>();
  private history = node('div');
  private outbox!: AgentOutbox;
  private outboxDrafts=new Map<string,{key:string;text:string}>();
  private outboxMessages = node('div');
  private context = node('pre');
  private conversationSelect = node('select');
  private association = node('p');
  private older = node('button', 'Load older messages');
  private composer = node('textarea');
  private sendButton = node('button', 'Send message');
  private sendFeedback = node('p');
  private deliveryReview = node('button', 'I’ve checked delivery');
  private detailData?: Detail;
  private detailKey = '';
  private detailRequest = 0;
  private loadingDetail = false;
  private drafts = new Map<string, string>();
  private conversations = new Map<string, string>();
  private uncertain = new Set<string>();
  private submitting = false;
  private openedForRead = '';
  private reading = false;
  private readAvailable = false;
  private lastReadAttempt = '';
  private markRead = node('button', 'Mark read');
  private metadata = node('div');
  private detailsButton = node('button', 'Details');
  private subtitle = node('p');
  private chatNotice = node('p');
  private approvalCard = node('section');
  private approvalFeedback = new Map<string, string>();
  private approvalPending = new Set<string>();
  private filterPanel = node('details');
  private inboxControls = node('div');
  constructor(private open: (target: QueueTarget) => Promise<void>) {
    this.agentRestarter=new AgentRestarter(async()=>{await this.refresh();if(this.selected)await this.loadDetail(true);});
    this.restartAgent.type='button';this.restartAgent.onclick=()=>{const c=this.chosen();if(c)this.openAgentRestart(c.h,c.item);};
    this.agentCloser=new AgentCloser(async()=>{this.body.dataset.detail='false';await this.refresh();});
    this.closeAgent.type='button';this.closeAgent.className='danger';this.closeAgent.onclick=()=>{const c=this.chosen();if(c)this.openAgentClose(c.h,c.item);};
    this.cardMenu.className='agent-card-menu';this.cardMenu.setAttribute('role','menu');this.cardMenu.setAttribute('aria-label','Agent actions');this.cardMenu.hidden=true;document.body.append(this.cardMenu);
    document.addEventListener('pointerdown',e=>{if(!this.cardMenu.contains(e.target as Node))this.cardMenu.hidden=true;});
    this.cardMenu.onkeydown=e=>{const buttons=[...this.cardMenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];let index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(e.key==='Escape'){this.cardMenu.hidden=true;e.preventDefault();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length]?.focus();}};
    this.outbox=new AgentOutbox(()=>this.renderOutbox(),entry=>this.reconcileOutboxDraft(entry));
    this.outboxMessages.className='agent-outbox-messages';
    this.outboxMessages.setAttribute('aria-label','Pending and submitted messages');
    this.cardEditor=new AgentCardEditor((target,card)=>{const id=`${target.host}/${target.connection_revision}/${target.session}/${target.window}/${target.pane}`;this.cardVersions.set(`${id}/${target.instance}`,card);for(const h of this.snapshot?.hosts||[])for(const item of h.items)if(item.id===id&&item.attention?.instance===target.instance)item.card=card;this.render();});
    this.editCard.onclick=()=>{const c=this.chosen();if(c)this.openCardEditor(c.h,c.item);};
    const notificationButton = node('button', 'Notifications'); notificationButton.id = 'agent-notifications'; notificationButton.setAttribute('aria-label', 'Notifications'); notificationButton.title = 'Notifications';
    document.querySelector('.header-actions')!.prepend(notificationButton);
    const notificationDialog = node('dialog'); notificationDialog.className = 'notification-dialog'; notificationDialog.setAttribute('aria-label', 'Agent notifications');
    const status = node('p'); status.setAttribute('role', 'status');
    const enable = node('button', 'Enable notifications'), disable = node('button', 'Disable notifications'), close = node('button', 'Close');
    const soundControls=node('section');soundControls.className='notification-sound-controls';
    const soundLabel=node('label'),sound=document.createElement('input');sound.type='checkbox';sound.setAttribute('aria-label','Play notification sound');soundLabel.append(sound,document.createTextNode('Play notification sound'));
    const volumeLabel=node('label','Volume'),volume=document.createElement('input'),level=node('span');volume.type='range';volume.min='0';volume.max='100';volume.step='5';volume.setAttribute('aria-label','Notification volume');level.className='notification-volume-value';level.setAttribute('aria-hidden','true');volumeLabel.append(volume,level);
    const preview=node('button','Test sound'),soundStatus=node('p');soundStatus.id='notification-sound-status';soundStatus.setAttribute('aria-live','polite');sound.setAttribute('aria-describedby',soundStatus.id);let soundBusy=false;
    const update=()=>{
      status.textContent=this.notifications.status();enable.disabled=compactClient()||!this.notifications.available();disable.disabled=!this.notifications.enabled();
      const available=!compactClient()&&this.notifications.available()&&this.notifications.enabled()&&Notification.permission==='granted'&&this.notifications.sound.available();
      if(!soundBusy)sound.checked=this.notifications.sound.enabled();sound.disabled=!available||soundBusy;volume.disabled=!available||soundBusy;preview.disabled=!available||soundBusy;
      volume.value=String(Math.round(this.notifications.sound.volume()*100));level.textContent=volume.value+'%';soundStatus.textContent=compactClient()?'Sound alerts are available in desktop layouts.':this.notifications.sound.status();
    };
    enable.onclick=()=>{void this.notifications.enable().then(update);};disable.onclick=()=>{this.notifications.disable();update();};
    const soundAction=async(action:()=>Promise<void>)=>{if(soundBusy)return;soundBusy=true;update();try{await action();}catch{/* Audio status explains a failed user-gesture unlock. */}finally{soundBusy=false;update();}};
    sound.onchange=()=>{const value=sound.checked;void soundAction(()=>this.notifications.sound.setEnabled(value));};volume.oninput=()=>{this.notifications.sound.setVolume(Number(volume.value)/100);update();};preview.onclick=()=>void soundAction(()=>this.notifications.sound.preview());
    soundControls.append(node('h3','Sound'),soundLabel,volumeLabel,preview,soundStatus,node('p','CC plays one short chime for new notification events, including completion and approval/input requests. Per-agent mute and read suppression also silence it. OS notification sound is separate when CC sound is off.'));
    close.onclick=()=>notificationDialog.close();
    notificationDialog.append(node('h2','Agent notifications'),status,node('p','Preferences apply to this browser. Phone push notifications are not available yet. Alerts contain the machine and window names, without message or tool contents.'),enable,disable,soundControls,close);document.body.append(notificationDialog);
    notificationButton.onclick=()=>{update();notificationDialog.showModal();};
    window.addEventListener('cc-notification-sound',()=>{if(notificationDialog.open)update();});window.addEventListener('storage',()=>{if(notificationDialog.open)update();});
    this.mute.onclick = () => { const state = this.chosen()?.item.attention; if (state) { this.notifications.toggleMute(JSON.stringify([state.key, state.instance])); this.render(); } };
    const heading = node('div'); heading.className = 'queue-heading';
    const title = node('div'); title.append(node('h1', 'AI Queue'), node('p', 'Live agents and requests across your machines.'));
    const launcher = new AgentLauncher(agent => this.openLaunched(agent));
    const startAgent = node('button', 'Start agent'); startAgent.className = 'queue-start-agent primary'; startAgent.onclick = () => { void launcher.open(this.host || this.chosen()?.h.id); };
    const filters = node('div'); filters.className = 'queue-filters';
    this.hostSelect.setAttribute('aria-label', 'Queue machine'); this.projectSelect.setAttribute('aria-label', 'Queue project');
    this.statusSelect.setAttribute('aria-label', 'Agent status');
    this.options(this.statusSelect, 'All agents', [['needs_attention', 'Needs attention'], ['attention', 'Awaiting input / approval'], ['ready', 'Ready for a message'], ['working', 'Working'], ['unknown', 'Unknown'], ['disconnected', 'Disconnected']], '');
    this.hostSelect.onchange = () => { this.openedForRead = ''; this.host = this.hostSelect.value; this.project = ''; this.render(); };
    this.projectSelect.onchange = () => { this.openedForRead = ''; this.project = this.projectSelect.value; this.render(); };
    this.statusSelect.onchange = () => { this.openedForRead = ''; this.render(); };
    const refresh = node('button', 'Refresh queue'); refresh.onclick = () => { void this.refresh(); if (this.selected) void this.loadDetail(); };
    const done = node('button', 'Done'); done.className = 'queue-filters-done'; done.onclick = () => { this.filterPanel.open = false; };
    filters.append(this.statusSelect, this.hostSelect, this.projectSelect, refresh, done);
    this.filterPanel.className = 'queue-filter-panel'; this.filterPanel.open = !compactClient();
    document.addEventListener('pointerdown', event => { if (compactClient() && this.filterPanel.open && !this.filterPanel.contains(event.target as Node)) this.filterPanel.open = false; });
    this.filterPanel.append(node('summary', 'Filters'), filters); heading.append(title, this.outbox.button(), startAgent, this.filterPanel);
    this.inboxControls.className = 'queue-inbox-controls';
    for (const [value, label] of [['', 'All agents'], ['needs_attention', 'Needs attention']]) {
      const b = node('button', label); b.dataset.filter = value; b.onclick = () => { this.statusSelect.value = value; this.openedForRead = ''; this.render(); }; this.inboxControls.append(b);
    }
    this.list.className = 'queue-list'; this.list.setAttribute('aria-label', 'Live agents');
    this.detail.className = 'queue-detail'; this.detail.setAttribute('aria-label', 'Request details');
    this.feedback.setAttribute('role', 'status');
    this.body.className = 'queue-body'; this.body.append(this.list, this.detail);
    this.root.append(heading, this.inboxControls, this.feedback, this.body);
    const back = node('button', '← Agents'); back.className = 'queue-back'; back.setAttribute('aria-label', '← Agents'); back.onclick = () => { delete this.body.dataset.detail; this.syncPresentation(); };
    const openButton = node('button', 'Open terminal'); openButton.className = 'primary queue-terminal-link';
    const updateTerminalLink = () => { openButton.hidden = compactClient(); };
    updateTerminalLink(); compactViewport.addEventListener('change', updateTerminalLink);
    openButton.onclick = () => { if (compactClient()) return; const entry = this.chosen(); if (entry) void this.open({ host: entry.h.id, connection: entry.h.connection_revision, session: entry.item.session, window: entry.item.window, pane: entry.item.pane }); };
    const createTicket=node('button','Create ticket');createTicket.onclick=()=>{const c=this.chosen();if(c)document.dispatchEvent(new CustomEvent('cc-create-ticket',{detail:{host:c.h.id,session:c.item.session,session_name:c.item.session_name,window:c.item.window,window_name:c.item.window_name,pane:c.item.pane,path:c.item.project,provider:c.item.agent,conversation:this.detailData?.conversations.find(v=>v.id===this.detailData?.selected)?.session||''}}));};
    const actions = node('div'); actions.className = 'queue-detail-actions'; actions.append(back, this.activityBadge, this.outbox.button(), this.detailsButton, openButton);
    this.detailsButton.className = 'queue-details-button'; this.detailsButton.setAttribute('aria-controls', 'queue-agent-metadata');
    this.detailsButton.onclick = () => { this.metadata.hidden = !this.metadata.hidden; this.detailsButton.setAttribute('aria-expanded', String(!this.metadata.hidden)); };
    this.metadata.id = 'queue-agent-metadata'; this.metadata.className = 'queue-agent-metadata'; this.metadata.hidden = true;
    this.detailsButton.setAttribute('aria-expanded', String(!this.metadata.hidden));
    this.subtitle.className = 'queue-chat-subtitle'; this.chatNotice.className = 'queue-chat-notice'; this.chatNotice.hidden = true;
    compactViewport.addEventListener('change', () => { this.metadata.hidden = true; this.detailsButton.setAttribute('aria-expanded', String(!this.metadata.hidden)); this.filterPanel.open = !compactClient(); this.syncPresentation(); });
    this.detailFeedback.setAttribute('role', 'status'); this.sendFeedback.setAttribute('role', 'status');
    this.conversationSelect.setAttribute('aria-label', 'Conversation history');
    this.conversationSelect.onchange = () => { this.openedForRead = this.selected; this.conversations.set(this.selected, this.conversationSelect.value); void this.loadDetail(true); };
    this.history.className = 'agent-history'; this.history.setAttribute('aria-label', 'Conversation messages'); this.history.tabIndex = 0;
    this.history.onscroll = () => { void this.acknowledge(); };
    this.markRead.onclick = () => { void this.acknowledge(true); }; this.markRead.hidden = true;
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void this.acknowledge(); });
    this.older.onclick = () => { if (this.detailData?.older_cursor != null) void this.loadDetail(false, this.detailData.older_cursor); };
    const screen = node('details'); screen.className = 'agent-screen'; screen.append(node('summary', 'Live terminal context'), this.context); this.context.tabIndex = 0;
    this.composer.setAttribute('aria-label', 'Message to agent'); this.composer.placeholder = 'Message this agent…'; this.composer.rows = 3; this.composer.maxLength = 12000;
    this.composer.oninput = () => { this.drafts.set(this.draftKey(), this.composer.value); this.fitComposer(); this.updateSend(); };
    const form = node('form'); form.className = 'agent-composer';
    form.onsubmit = event => { event.preventDefault(); void this.send(); };
    let composing=false;
    this.composer.enterKeyHint='send';this.composer.setAttribute('aria-describedby','agent-composer-help');
    this.composer.addEventListener('compositionstart',()=>{composing=true;});
    this.composer.addEventListener('compositionend',()=>{composing=false;});
    this.composer.addEventListener('blur',()=>{composing=false;});
    this.composer.addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.shiftKey||event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.keyCode===229||composing)return;
      event.preventDefault();if(!event.repeat)form.requestSubmit();
    });
    this.sendButton.type = 'submit'; this.sendButton.setAttribute('aria-label', 'Send message'); this.sendButton.className = 'primary';
    const inputRow = node('div'); inputRow.className = 'composer-input'; inputRow.append(this.composer, this.sendButton);
    const composerHelp=node('small','Enter to send or queue · Shift+Enter for a new line. Queued messages wait for verified Ready status. Uncertain terminal input is never retried automatically.');composerHelp.id='agent-composer-help';
    form.append(inputRow, composerHelp, this.sendFeedback);
    this.deliveryReview.type = 'button'; this.deliveryReview.hidden = true;
    this.deliveryReview.onclick = () => { this.uncertain.delete(this.draftKey()); this.deliveryReview.hidden = true; this.sendFeedback.textContent = ''; void this.loadDetail(); };
    form.append(this.deliveryReview);
    const chatHeader = node('div'); chatHeader.className = 'queue-chat-header'; chatHeader.append(actions, this.title, this.subtitle);
    this.cardNotes.className='agent-card-notes';this.metadata.append(this.outbox.button(),this.editCard,this.restartAgent,this.closeAgent,this.cardNotes,createTicket, this.location, this.detailFeedback, this.conversationSelect, this.association, this.markRead, this.mute, screen);
    this.history.append(this.older);
    this.approvalCard.className = 'agent-approval'; this.approvalCard.setAttribute('aria-label', 'Tool approval'); this.approvalCard.hidden = true;
    this.liveActivity.className = 'agent-live-activity'; this.liveActivity.setAttribute('role', 'status'); this.liveActivity.setAttribute('aria-live', 'polite');
    this.detail.append(chatHeader, this.chatNotice, this.metadata, this.backgroundTasks.element, this.history, this.liveActivity, this.approvalCard, form);
    this.render(); void this.refresh();
    window.setInterval(() => { if (!document.hidden || this.notifications.enabled()) void this.refresh(); if(!document.hidden&&this.visible)void this.outbox.refresh(); }, 6000);
    window.setInterval(() => {
      if (document.hidden || !this.visible || !this.selected || this.submitting) return;
      const active = this.currentActivity()?.state === 'working' || this.pendingReplies.has(this.draftKey());
      if (Date.now() - this.lastDetailPoll >= (active ? 1800 : 5800)) void this.loadDetail();
    }, 2000);
  }
  setVisible(value: boolean) { this.visible = value; if(value)void this.outbox.refresh(); this.syncPresentation(); if (value) { this.render(); void this.refresh(); if (this.selected) void this.loadDetail(); } }
  async openTarget(target:QueueTarget){
    await this.refresh();let host=this.snapshot?.hosts.find(h=>h.id===target.host&&h.connection_revision===target.connection);
    let item=host?.items.find(i=>i.session===target.session&&i.window===target.window&&i.pane===target.pane);
    if(!item||target.instance&&item.attention?.instance!==target.instance){
      // A bounded inventory may omit a newly launched target. Verify that exact
      // process directly rather than inventing an association from pane identity.
      const query=new URLSearchParams({session:target.session,window:target.window,pane:target.pane,connection_revision:target.connection});
      const response=await fetch(`/api/v1/hosts/${encodeURIComponent(target.host)}/agents/conversation?${query}`,{signal:AbortSignal.timeout(25000)});
      const data:Detail&{error?:string}=await response.json();
      if(!response.ok||!data.instance||target.instance&&data.instance!==target.instance)throw Error(data.error||'The original agent is unavailable or changed. Saved ticket context is retained.');
      this.snapshot??={checked_at:Date.now()/1000,hosts:[]};
      if(!host){host={id:target.host,name:target.host,connection_revision:target.connection,limited:true,items:[]};this.snapshot.hosts=this.snapshot.hosts.filter(h=>h.id!==target.host);this.snapshot.hosts.push(host);}
      const id=`${target.host}/${target.connection}/${target.session}/${target.window}/${target.pane}`;
      item={id,session:target.session,session_name:target.session,window:target.window,window_name:data.provider,pane:target.pane,project:data.project,agent:data.provider,prompt:'Live agent',context:data.context,status:'live',activity:data.activity,attention:data.read_state};
      host.items=host.items.filter(i=>i.id!==id);host.items.push(item);
    }
    this.host='';this.project='';this.statusSelect.value='';this.selected=item.id;this.openedForRead=item.id;this.body.dataset.detail='true';this.render();
  }

  async openLaunched(agent: LaunchedAgent) {
    await this.refresh();
    const host = this.snapshot?.hosts.find(h => h.id === agent.host);
    if (!host || host.connection_revision !== agent.connection_revision) throw new Error('Machine changed or queue unavailable. Check launch to reopen the agent.');
    const id = `${agent.host}/${agent.connection_revision}/${agent.session}/${agent.window}/${agent.pane}`;
    if (!host.items.some(item => item.id === id)) {
      host.items.push({ id, session: agent.session, session_name: agent.session_name, window: agent.window, window_name: agent.provider, pane: agent.pane, project: agent.project, agent: agent.provider, prompt: 'Live agent', context: agent.context, status: 'live', activity: { state: 'unknown', source: 'launch', reason: 'Agent started; checking provider status', observed_at: Math.floor(Date.now() / 1000) } });
    }
    this.host = ''; this.project = ''; this.statusSelect.value = '';
    this.selected = id; this.openedForRead = id; this.body.dataset.detail = 'true'; this.render();
  }
  private mergeCard(item:Item,instance:string,card:AgentCard){const key=`${item.id}/${instance}`,old=this.cardVersions.get(key);if(old&&old.revision>card.revision)item.card=old;else{item.card=card;this.cardVersions.set(key,card);}if(this.cardVersions.size>512)this.cardVersions.delete(this.cardVersions.keys().next().value!);}
  private openAgentRestart(host:Host,item:Item){const instance=item.attention?.instance;if(!instance||stateOf(item)==='disconnected')return;void this.agentRestarter.open({host:host.id,connection_revision:host.connection_revision,session:item.session,window:item.window,pane:item.pane,instance,label:`${host.name} · ${agentTitle(item)}`});}
  private openAgentClose(host:Host,item:Item){const instance=item.attention?.instance;if(!instance||stateOf(item)==='disconnected')return;void this.agentCloser.open({host:host.id,connection_revision:host.connection_revision,session:item.session,window:item.window,pane:item.pane,instance,label:`${host.name} · ${agentTitle(item)}`});}
  private openCardActions(host:Host,item:Item,x:number,y:number){
    const action=(text:string,run:()=>void)=>{const button=node('button',text);button.type='button';button.setAttribute('role','menuitem');button.onclick=()=>{this.cardMenu.hidden=true;run();};button.disabled=!item.attention?.instance||stateOf(item)==='disconnected';return button;};
    const edit=action('Edit card',()=>this.openCardEditor(host,item));const pin=action(item.card?.pinned?'Unpin card':'Pin card',()=>{void this.setCardPinned(host,item);});const close=action('Close agent…',()=>this.openAgentClose(host,item));close.className='danger';const restart=action('Restart agent…',()=>this.openAgentRestart(host,item));this.cardMenu.replaceChildren(edit,pin,restart,close);this.cardMenu.hidden=false;this.cardMenu.style.left=`${Math.max(8,Math.min(x,innerWidth-220))}px`;this.cardMenu.style.top=`${Math.max(8,Math.min(y,innerHeight-this.cardMenu.offsetHeight-8))}px`;edit.focus();
  }
  private async setCardPinned(host:Host,item:Item){const instance=item.attention?.instance;if(!instance)return;try{await this.cardEditor.setPinned({host:host.id,connection_revision:host.connection_revision,session:item.session,window:item.window,pane:item.pane,instance,label:agentTitle(item)},!item.card?.pinned);}catch(error){this.feedback.dataset.error='true';this.feedback.textContent=`${String(error)} Refresh this card before trying again.`;}}
  private openCardEditor(host:Host,item:Item){const instance=item.attention?.instance;if(!instance||stateOf(item)==='disconnected'){this.feedback.textContent='Refresh this agent before editing its card.';return;}void this.cardEditor.open({host:host.id,connection_revision:host.connection_revision,session:item.session,window:item.window,pane:item.pane,instance,label:agentTitle({...item,card:undefined})});}
  private fitComposer() {
    this.composer.rows = 1;
    this.composer.style.height = '';
    if (this.composer.value) this.composer.style.height = `${Math.min(132, Math.max(40, this.composer.scrollHeight))}px`;
  }
  private syncPresentation() {
    const conversation = this.visible && compactClient() && this.body.dataset.detail === 'true';
    document.documentElement.classList.toggle('queue-chat-active', conversation);
    this.fitComposer();
  }
  private options(select: HTMLSelectElement, all: string, entries: [string, string][], selected: string) {
    select.replaceChildren(...[['', all], ...entries].map(([value, label]) => { const o = node('option', label); o.value = value; return o; })); select.value = selected;
  }
  private entries() { return (this.snapshot?.hosts || []).flatMap(h => h.items.map(item => ({ h, item }))).filter(({ h, item }) => (!this.host || h.id === this.host) && (!this.project || JSON.stringify([h.id, item.project]) === this.project) && (!this.statusSelect.value || (this.statusSelect.value === 'needs_attention' ? needsAttention(item) : this.statusSelect.value === 'attention' ? waiting(item) : stateOf(item) === this.statusSelect.value))); }
  private chosen() { return (this.snapshot?.hosts || []).flatMap(h => h.items.map(item => ({ h, item }))).find(e => e.item.id === this.selected); }
  private draftKey() { return `${this.selected}/${this.detailData?.instance || 'unverified'}`; }
  private render() {
    if (!this.visible) return;
    const hosts = this.snapshot?.hosts || [];
    for(const host of hosts)for(const item of host.items)if(item.card&&item.attention?.instance)this.mergeCard(item,item.attention.instance,item.card);
    this.options(this.hostSelect, 'All machines', hosts.map(h => [h.id, h.name]), this.host);
    const projects = new Map<string, string>();
    for (const h of hosts.filter(h => !this.host || h.id === this.host)) for (const item of h.items) projects.set(JSON.stringify([h.id, item.project]), `${h.name} · ${item.project}`);
    this.options(this.projectSelect, 'All projects', [...projects], this.project);
    const entries = this.entries().sort((a, b) => Number(!!b.item.card?.pinned)-Number(!!a.item.card?.pinned) || Number(needsAttention(b.item)) - Number(needsAttention(a.item)) || rank[stateOf(a.item)] - rank[stateOf(b.item)] || a.h.name.localeCompare(b.h.name) || a.item.id.localeCompare(b.item.id));
    if (!entries.some(e => e.item.id === this.selected) && !(this.openedForRead === this.selected && this.chosen())) this.selected = entries[0]?.item.id || '';
    const scroll = this.list.scrollTop;
    this.list.replaceChildren(...entries.map(({ h, item }) => {
      const b = node('button'); b.className = item.id === this.selected ? 'queue-card selected' : 'queue-card'; b.setAttribute('aria-pressed', String(item.id === this.selected)); b.classList.toggle('needs-attention', needsAttention(item));
      b.oncontextmenu=event=>{event.preventDefault();this.openCardActions(h,item,event.clientX,event.clientY);};b.onkeydown=event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();const rect=b.getBoundingClientRect();this.openCardActions(h,item,rect.left,rect.bottom);}};b.title='Right-click or Shift+F10 for agent actions';
      const folder = node('span', compactClient() ? projectName(item.project) : item.project); folder.title = item.project; folder.hidden = compactClient() && agentTitle(item) === projectName(item.project);
      b.classList.toggle('pinned',!!item.card?.pinned);
      if(item.card?.color&&/^#[0-9a-f]{6}$/i.test(item.card.color)){b.classList.add('has-custom-color');b.style.setProperty('--agent-card-color',item.card.color);}
      folder.className='queue-card-path';
      const machine=node('small',`${h.name} / ${item.agent}`);machine.className='queue-card-machine';
      const name=node('strong',item.card?.name||(waiting(item)?item.prompt:agentTitle(item)));name.className='queue-card-name';name.title=name.textContent||'';
      const context=node('small');context.className='queue-card-context';context.title=`${h.name} · ${item.agent} · ${item.project} · ${item.session_name} / ${item.window_name} / ${item.pane}`;
      const attention=[item.attention?.finished?'Finished':'',item.attention?.new_approval?(item.activity?.source==='pi_bridge'?'New input request':'New approval'):'',item.attention?.unread_reply?'Unread reply':''].filter(Boolean);
      if(attention.length){const dot=node('span');dot.className='queue-card-unread';dot.setAttribute('role','img');dot.setAttribute('aria-label',attention.join(' · '));dot.title=attention.join(' · ');context.append(dot);}
      context.append(document.createTextNode(`${h.name} · ${item.agent} · ${projectName(item.project)}`));
      const background=backgroundLabel(item.background_tasks,stateOf(item)==='disconnected');if(background){for(const parent of [machine,context]){const badge=node('span',background);badge.className='queue-background-count';if(parent===context)parent.prepend(badge,document.createTextNode(' · '));else parent.append(badge);}}
      b.title=`${name.textContent}\n${context.title}\nRight-click or Shift+F10 for agent actions`;
      b.append(machine,stateBadge(item.activity,stateOf(item)),name,folder,context,node('small',`${item.session_name} / ${item.window_name} / ${item.pane}`));
      b.dataset.hasPrompt=String(!!item.card?.name&&waiting(item));
      if(item.card?.notes){const note=node('span',item.card.notes);note.className='agent-card-note-preview queue-card-note';note.title=item.card.notes;b.append(note);}if(item.card?.name&&waiting(item)){const prompt=node('span',item.prompt);prompt.className='agent-card-note-preview queue-card-prompt';prompt.title=item.prompt;b.append(prompt);}
      const flags = node('span'); flags.className = 'attention-flags';
      if (item.attention?.finished) flags.append(node('span', 'Finished'));
      if (item.attention?.new_approval) flags.append(node('span', item.activity?.source === 'pi_bridge' ? 'New input request' : 'New approval'));
      if (item.attention?.unread_reply) flags.append(node('span', 'Unread reply'));
      b.append(flags);
      if(item.card?.pinned){const label=node('span','Pinned');label.className='queue-card-pin-label';b.append(label);}
      b.onclick = () => {
        const firstOpen = this.openedForRead !== item.id;
        this.selected = item.id; this.openedForRead = item.id; this.body.dataset.detail = 'true'; this.render();
        requestAnimationFrame(() => {
          if (this.selected !== item.id) return;
          if (firstOpen) this.history.scrollTop = this.history.scrollHeight;
          void this.acknowledge();
        });
      }; return b;
    }));
    this.list.scrollTop = scroll;
    if (!entries.length) this.list.append(node('p', this.snapshot ? 'No agents match these filters.' : 'Checking machines…'));
    this.syncPresentation();
    this.root.querySelector('h1')!.textContent = compactClient() ? 'Agents' : 'AI Queue';
    for (const b of this.inboxControls.querySelectorAll('button')) b.setAttribute('aria-pressed', String(this.statusSelect.value === b.dataset.filter));
    const chosen = this.chosen();
    this.restartAgent.disabled=this.closeAgent.disabled=this.editCard.disabled=!chosen?.item.attention?.instance||stateOf(chosen.item)==='disconnected';this.cardNotes.textContent=chosen?.item.card?.notes||'';this.cardNotes.hidden=!this.cardNotes.textContent;
    this.mute.hidden = !chosen?.item.attention;
    if (chosen?.item.attention) { this.mute.textContent = this.notifications.isMuted(JSON.stringify([chosen.item.attention.key, chosen.item.attention.instance])) ? 'Unmute notifications' : 'Mute notifications'; }
    this.subtitle.textContent = chosen ? `${chosen.h.name} · ${projectName(chosen.item.project)}${this.detailData?.association === 'project' && this.detailKey === this.selected ? ' · Project history' : ''}` : '';
    this.title.textContent = chosen ? (chosen.item.card?.name || (waiting(chosen.item) ? chosen.item.prompt : agentTitle(chosen.item))) : 'Nothing to review';
    this.location.textContent = chosen ? `${chosen.h.name} · ${chosen.item.project}` : 'Codex, Claude and pi panes appear here while running, including when they are not waiting for input.';
    const badge = stateBadge(this.currentActivity(), chosen ? stateOf(chosen.item) : 'unknown');
    this.activityBadge.replaceWith(badge); this.activityBadge = badge;
    if (chosen && stateOf(chosen.item) === 'disconnected') {
      this.detailRequest++; this.loadingDetail = false;
      if (this.detailData) { this.detailData.message_token = undefined; if (this.detailData.approval) this.detailData.approval.token = undefined; }
      this.detailFeedback.textContent = chosen.item.activity?.reason || 'Agent disconnected';
      this.chatNotice.hidden = false; this.chatNotice.textContent = this.detailFeedback.textContent;
    }
    if (this.detailKey !== this.selected) {
      this.detailRequest++; this.loadingDetail = false; this.readAvailable = false; this.detailKey = this.selected; this.detailData = undefined; this.detailUnavailable = false;
      this.composer.value = ''; this.history.replaceChildren(); this.conversationSelect.replaceChildren(); this.association.textContent = ''; this.context.textContent = chosen?.item.context || '';
      this.sendFeedback.textContent = ''; this.chatNotice.hidden = true; this.older.hidden = true; this.updateSend();
      if (chosen) void this.loadDetail(true);
    }
    this.detail.querySelector<HTMLFormElement>('form')!.hidden = !chosen;
    this.detail.querySelector('summary')!.textContent = chosen && stateOf(chosen.item) === 'disconnected' ? 'Last observed terminal context' : 'Live terminal context';
    this.conversationSelect.hidden = !chosen;
    this.updateSend();
    this.markRead.hidden = !unread(this.detailData?.read_state || chosen?.item.attention);
    const issues = hosts.filter(h => h.error || h.limited).map(h => `${h.name}: ${h.error || 'scan limited to 32 agent panes'}`);
    this.feedback.dataset.error = String(issues.length > 0);
    this.feedback.textContent = `${this.snapshot ? `Checked ${new Date(this.snapshot.checked_at * 1000).toLocaleTimeString()}` : 'Checking machines…'}${issues.length ? ` · ${issues.join(' · ')}` : ''}`;
  }
  private updateSend() {
    const data = this.detailData;
    this.sendButton.disabled = this.submitting || (this.chosen() ? stateOf(this.chosen()!.item) === 'disconnected' : true) || !data?.send_available || !data.message_token || !this.composer.value.trim() || new TextEncoder().encode(this.composer.value).length > 12000 || this.uncertain.has(this.draftKey());
    this.sendButton.textContent=this.currentActivity()?.state==='working'?'Queue message':'Send message';
    this.composer.readOnly = this.submitting || !data?.instance || !!data?.approval || !!data?.attention;
    this.renderApproval();
    this.renderActivity();
    this.deliveryReview.hidden = !this.uncertain.has(this.draftKey());
  }
  private currentActivity() {
    const chosen = this.chosen();
    if (!chosen) return undefined;
    const queued = chosen.item.activity;
    if (queued?.state === 'disconnected') return queued;
    const detailed = this.detailKey === this.selected ? this.detailData?.activity : undefined;
    return detailed && (!queued || detailed.observed_at >= queued.observed_at) ? detailed : queued;
  }
  private latestReply(data = this.detailData) {
    const message = [...(data?.messages || [])].reverse().find(m => m.role === 'assistant');
    return message ? `${message.id}/${message.text}` : '';
  }
  private activitySignature(activity = this.currentActivity()) {
    return activity ? `${activity.state}/${activity.source}/${activity.transition || activity.evidence_at || ''}` : '';
  }
  private renderActivity() {
    const selected=this.chosen();const detailed=this.detailKey===this.selected&&this.detailData?.instance===selected?.item.attention?.instance?this.detailData?.background_tasks:undefined;const queued=selected?.item.background_tasks;const background=detailed&&(!queued||detailed.observed_at>=queued.observed_at)?detailed:queued;this.backgroundTasks.update(background,this.detailUnavailable||this.currentActivity()?.state==='disconnected');
    const activity = this.currentActivity(), key = this.draftKey(), pending = this.pendingReplies.get(key);
    if (pending && (Date.now() - pending.at > 15 * 60 * 1000 || this.latestReply() !== pending.reply ||
      (activity?.state === 'ready' && this.activitySignature(activity) !== pending.activity))) this.pendingReplies.delete(key);
    let text = '', busy = false;
    if (!this.chosen()) text = '';
    else if (this.detailUnavailable || activity?.state === 'disconnected') text = 'Live activity unavailable · reconnecting';
    else if (this.detailData?.approval || activity?.state === 'approval') text = activity?.source === 'pi_bridge' ? 'Waiting for input · respond in terminal' : 'Waiting for your approval';
    else if (this.submitting) { text = 'Submitting…'; busy = true; }
    else if (activity?.state === 'working') { text = 'Agent is working…'; busy = true; }
    else if (this.pendingReplies.has(key)) { text = pending && Date.now() - pending.at > 30000 ? 'Waiting for a reply · live status unavailable' : 'Message sent · waiting for agent activity…'; busy = true; }
    else if (activity?.state === 'ready') text = 'Ready';
    else text = 'Live status unverified';
    this.liveActivity.hidden = !text;
    this.liveActivity.dataset.busy = String(busy);
    this.liveActivity.title = activity?.reason || 'No verified live provider status is available';
    if (this.liveActivity.textContent !== text) this.liveActivity.textContent = text;
  }
  private approvalKey() { return `${this.draftKey()}/${this.detailData?.approval?.id || ''}`; }
  private renderApproval() {
    const approval = this.detailData?.approval;
    this.approvalCard.hidden = !approval;
    this.detail.querySelector<HTMLFormElement>('form')!.hidden = !!approval || !this.chosen();
    if (!approval) { this.approvalCard.replaceChildren(); return; }
    if (document.activeElement === this.composer) this.composer.blur();
    const key = this.approvalKey(), review = node('details');
    review.open = this.approvalCard.querySelector('details')?.open ?? true;
    review.append(node('summary', 'Review tool request'), node('pre', approval.context));
    const choices = node('div'); choices.className = 'approval-choices';
    const blocked = this.submitting || !approval.token || approval.submitted || this.approvalPending.has(key) || stateOf(this.chosen()!.item) === 'disconnected';
    for (const choice of approval.choices) {
      const button = node('button', choice.label); button.disabled = !!blocked;
      button.onclick = () => { void this.decide(choice.id); }; choices.append(button);
    }
    const feedback = node('p', this.approvalFeedback.get(key) || (approval.submitted ? 'Decision submitted. Waiting for the agent to continue. Do not submit it again.' : 'Choose exactly what to allow or decline.'));
    feedback.setAttribute('role', 'status');
    this.approvalCard.replaceChildren(node('strong', 'Approval required'), node('p', approval.title), review, choices, feedback);
  }
  private async decide(choice: string) {
    const approval = this.detailData?.approval, chosen = this.chosen();
    if (!approval?.token || !chosen || this.submitting || approval.submitted || this.approvalPending.has(this.approvalKey())) return;
    const key = this.approvalKey(), selected = this.selected;
    this.submitting = true; this.detailRequest++; this.loadingDetail = false;
    this.approvalPending.add(key); this.approvalFeedback.set(key, 'Submitting decision…'); this.updateSend();
    try {
      const response = await fetch(`/api/v1/hosts/${encodeURIComponent(chosen.h.id)}/agents/approval`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: approval.token, choice }), signal: AbortSignal.timeout(25000) });
      const body = await response.json();
      if (!response.ok) {
        if ([400, 409, 429].includes(response.status)) this.approvalPending.delete(key);
        throw new Error(body.error || 'Could not submit decision');
      }
      this.approvalFeedback.set(key, 'Decision submitted. Waiting for the agent to continue.');
    } catch (error) {
      this.approvalFeedback.set(key, `${String(error)}${this.approvalPending.has(key) ? ' Check the agent before responding again; delivery may be uncertain.' : ' Refresh and review the latest request.'}`);
    } finally {
      this.submitting = false; approval.token = undefined;
      this.updateSend(); if (this.selected === selected) void this.loadDetail();
      void this.refresh();
    }
  }
  private async loadDetail(reset = false, before?: number) {
    const chosen = this.chosen(); if (!chosen || this.submitting || (this.loadingDetail && !reset)) return;
    if (stateOf(chosen.item) === 'disconnected') {
      this.detailFeedback.textContent = chosen.item.activity?.reason || 'Agent disconnected';
      this.chatNotice.hidden = false; this.chatNotice.textContent = this.detailFeedback.textContent;
      if (this.detailData) { this.detailData.message_token = undefined; if (this.detailData.approval) this.detailData.approval.token = undefined; }
      this.updateSend(); return;
    }
    this.loadingDetail = true; this.readAvailable = false; this.lastDetailPoll = Date.now();
    const { h, item } = chosen, key = this.selected, request = ++this.detailRequest;
    const query = new URLSearchParams({ session: item.session, window: item.window, pane: item.pane, connection_revision: h.connection_revision });
    const conversation = this.conversations.get(key); if (conversation) query.set('conversation', conversation);
    if (this.detailData?.history_branch) query.set('known_branch', this.detailData.history_branch);
    if (before != null) query.set('before', String(before));
    else if (!reset && this.detailData?.history_version) query.set('known_version', this.detailData.history_version);
    if (reset) this.detailFeedback.textContent = 'Loading conversation…';
    try {
      const response = await fetch(`/api/v1/hosts/${encodeURIComponent(h.id)}/agents/conversation?${query}`, { signal: AbortSignal.timeout(25000) });
      const data: Detail & {error?: string} = await response.json();
      if (!response.ok) throw new Error(data.error || 'Conversation unavailable');
      if (request !== this.detailRequest || key !== this.selected) return;
      const previous = this.detailData;
      if (data.history_unchanged && previous) {
        data.messages = previous.messages; data.activities = previous.activities; data.activity_limited = previous.activity_limited; data.older_cursor = previous.older_cursor; data.history_branch = previous.history_branch; data.history_notice = previous.history_notice;
      } else if (!data.history_reset && before != null && previous && previous.selected === data.selected && previous?.instance === data.instance) {
        const known = new Set(previous.messages.map(m => m.id));
        data.messages = [...data.messages.filter(m => !known.has(m.id)), ...previous.messages];
        const activityIds = new Set((previous.activities || []).map(a => a.id));
        data.activities = [...(data.activities || []).filter(a => !activityIds.has(a.id)), ...(previous.activities || [])];
        data.message_token = previous.message_token; data.read_state = previous.read_state;
      } else if (!data.history_reset && !reset && previous && previous.selected === data.selected && previous?.instance === data.instance && (previous.messages.length || previous.activities?.length)) {
        const known = new Set(data.messages.map(m => m.id));
        const first = Number(data.messages[0]?.id || 0);
        data.messages = [...previous.messages.filter(m => !known.has(m.id) && Number(m.id) < first), ...data.messages];
        const activityIds = new Set((data.activities || []).map(a => a.id));
        const activityFirst = Math.min(first || Infinity, data.activities?.[0]?.position ?? Infinity);
        data.activities = [...(previous.activities || []).filter(a => !activityIds.has(a.id) && a.position < activityFirst), ...(data.activities || [])];
        data.older_cursor = previous.older_cursor;
      }
      if(data.card&&data.instance&&data.instance===item.attention?.instance){this.mergeCard(item,data.instance,data.card);this.title.textContent=item.card?.name||(waiting(item)?item.prompt:agentTitle(item));this.cardNotes.textContent=item.card?.notes||'';this.cardNotes.hidden=!this.cardNotes.textContent;const label=this.list.querySelector('.queue-card.selected strong');if(label)label.textContent=this.title.textContent;}
      this.detailUnavailable = false; this.detailData = data; this.readAvailable = before == null;
      this.composer.value = this.drafts.get(this.draftKey()) || ''; this.fitComposer();
      this.context.textContent = data.context;
      const sendReason = data.provider !== 'pi' && !data.approval && compactClient() && data.send_reason ? (data.attention ? 'Awaiting approval. Respond from a desktop terminal.' : 'Messaging is unavailable here. Use a desktop terminal.') : data.send_reason;
      this.detailFeedback.textContent = sendReason || (previous?.instance && previous.instance !== data.instance ? 'Agent process changed. Drafts for the previous process have been kept separately.' : data.activity?.reason || 'Provider status unknown.');
      this.chatNotice.hidden = !!data.approval || !data.send_reason; this.chatNotice.textContent = sendReason || '';
      this.subtitle.textContent = `${h.name} · ${projectName(item.project)}${data.association === 'project' ? ' · Project history' : ''}`;
      const badge = stateBadge(this.currentActivity()); this.activityBadge.replaceWith(badge); this.activityBadge = badge;
      this.options(this.conversationSelect, 'Choose a project conversation', data.conversations.map(c => [c.id, `${c.timestamp || 'Conversation'} · ${(c.session || c.id).slice(0, 8)}${c.linked ? ' · process linked' : ''}`]), data.selected || '');
      this.association.textContent = data.association === 'process' ? 'Conversation linked to this running process.' : data.association === 'project' ? 'Project conversation. This log is not verified as belonging to the running pane.' : 'Choose a conversation from this project. If the CLI exposes a process-linked log, it is selected automatically.';
      this.older.hidden = data.older_cursor == null;
      const top = this.history.scrollTop, height = this.history.scrollHeight;
      const nearBottom = height - top - this.history.clientHeight < 60;
      if (!data.history_unchanged) {
        const sameConversation = previous?.selected === data.selected && previous?.instance === data.instance && this.detailKey === key && !data.history_reset;
        const expanded = new Set(sameConversation ? [...this.history.querySelectorAll<HTMLDetailsElement>('.agent-activity[open]')].map(n => n.dataset.activityId) : []);
        const focused = document.activeElement instanceof HTMLElement && this.history.contains(document.activeElement)
          ? document.activeElement.closest<HTMLDetailsElement>('.agent-activity')?.dataset.activityId : undefined;
        const entries: {position: number; order: number; element: HTMLElement}[] = data.messages.map(message => {
          const article = node('article'); article.className = `agent-message ${message.role}`; article.dataset.messageId=message.id;
          article.append(node('small', `${message.role === 'user' ? 'You' : 'Agent'}${message.timestamp ? ` · ${new Date(message.timestamp).toLocaleString()}` : ''}`), message.role === 'assistant' ? chatMarkdown(message.text) : node('div', message.text));
          if (message.truncated) article.append(node('small', 'Message shortened for this view. Open the CLI for the full text.'));
          return {position: Number(message.id), order: message.order ?? -1, element: article};
        });
        for (const activity of data.activities || []) entries.push({position: activity.position, order: activity.order, element: activityElement(activity, expanded.has(activity.id))});
        entries.sort((a,b) => a.position - b.position || a.order - b.order);
        this.history.replaceChildren(...entries.map(e => e.element));
        if (sameConversation && focused) {
          const detail = [...this.history.querySelectorAll<HTMLDetailsElement>('.agent-activity')].find(n => n.dataset.activityId === focused);
          detail?.querySelector('summary')?.focus({preventScroll:true});
        }
        if (data.activity_limited) this.history.prepend(node('p', 'Some older activity is omitted from this page. Message history is unchanged.'));
        if (!entries.length) {const empty=node('p', data.selected ? 'No native conversation messages yet.' : data.conversations.length ? 'Select a conversation to read its history.' : 'No conversation log found for this project. Live terminal context is available below.');empty.className='agent-history-empty';this.history.append(empty);}
      }
      if (!data.history_unchanged && !data.selected && data.conversations.length) {
        const choose = node('button', 'Choose conversation'); choose.onclick = () => { this.metadata.hidden = false; this.detailsButton.setAttribute('aria-expanded', 'true'); this.conversationSelect.focus(); }; this.history.append(choose);
      }
      if (!data.history_unchanged) { if (data.history_notice) this.history.prepend(node('p', data.history_notice)); this.history.prepend(this.older); }
      if(data.outbox_entries)this.outbox.ingest(data.outbox_entries);
      this.renderOutbox();
      if (before != null) this.history.scrollTop = top + this.history.scrollHeight - height;
      else if (reset || nearBottom) {
        this.history.scrollTop = this.history.scrollHeight;
        requestAnimationFrame(() => { if (request === this.detailRequest && key === this.selected) { this.history.scrollTop = this.history.scrollHeight; void this.acknowledge(); } });
      }
      else this.history.scrollTop = top;
      this.updateSend(); this.markRead.hidden = !unread(data.read_state);
      if (before == null) void this.acknowledge();
    } catch (error) {
      if (request !== this.detailRequest || key !== this.selected) return;
      this.detailUnavailable = true;
      this.detailFeedback.textContent = String(error);
      this.chatNotice.hidden = false; this.chatNotice.textContent = `Conversation unavailable: ${String(error)}`;
      if (this.detailData) { this.detailData.message_token = undefined; if (this.detailData.approval) this.detailData.approval.token = undefined; }
      this.updateSend();
    } finally {
      if (request === this.detailRequest) this.loadingDetail = false;
    }
  }
  private async acknowledge(explicit = false) {
    const observed = this.detailData?.read_state || (explicit ? this.chosen()?.item.attention : undefined);
    if (this.reading || !observed || !unread(observed) || !this.visible || document.hidden || !this.detail.getClientRects().length) return;
    if (!explicit && (this.openedForRead !== this.selected || !this.readAvailable || this.history.scrollHeight - this.history.scrollTop - this.history.clientHeight > 60)) return;
    const { key, instance, revision, conversation, reply_cursor } = observed;
    const body = { key, instance, revision, conversation: conversation || null, reply_cursor: reply_cursor || null };
    const signature = JSON.stringify(body);
    if (!explicit && signature === this.lastReadAttempt) return;
    this.lastReadAttempt = signature; this.reading = true;
    const selected = this.selected;
    try {
      const response = await fetch('/api/v1/attention/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: signature, signal: AbortSignal.timeout(14000) });
      const result: ReadState & {error?: string} = await response.json();
      if (!response.ok) throw new Error(result.error || 'Read marker could not be saved');
      if (this.selected === selected && this.detailData?.read_state === observed) {
        // Keep the exact cursor that was rendered. A newer server cursor must
        // not become acknowledged until its messages have been displayed.
        this.detailData.read_state = { ...observed, finished: observed.finished && result.finished, new_approval: observed.new_approval && result.new_approval, unread_reply: observed.unread_reply && result.unread_reply };
        this.markRead.hidden = !unread(this.detailData.read_state);
      }
      await this.refresh();
    } catch (error) { this.feedback.dataset.error = 'true'; this.feedback.textContent = `Read state not saved: ${String(error)}`; this.chatNotice.hidden = false; this.chatNotice.textContent = 'Read status could not be saved. Try Mark read in Details.'; }
    finally { this.reading = false; }
  }
  private reconcileOutboxDraft(entry:OutboxEntry) {
    if(entry.local){this.outboxDrafts.set(entry.id,{key:this.draftKey(),text:entry.text});return;}
    const draft=this.outboxDrafts.get(entry.id);if(!draft||draft.text!==entry.text)return;
    if(this.drafts.get(draft.key)===draft.text)this.drafts.delete(draft.key);
    if(this.draftKey()===draft.key&&this.composer.value===draft.text){this.composer.value='';this.fitComposer();}
    this.uncertain.delete(draft.key);this.outboxDrafts.delete(entry.id);this.updateSend();
  }
  private renderOutbox() {
    const chosen=this.chosen(); if(!chosen||!this.detailData)return;
    const target={host:chosen.h.id,session:chosen.item.session,window:chosen.item.window,pane:chosen.item.pane,instance:this.detailData.instance||'',conversation:this.detailData.selected};
    const nearBottom=this.history.scrollHeight-this.history.scrollTop-this.history.clientHeight<60;
    const top=this.history.scrollTop;
    for(const article of this.history.querySelectorAll<HTMLElement>('.agent-message.user[data-message-id]')){
      if(this.outbox.seen(target,article.dataset.messageId||'')&&!article.querySelector('.outbox-confirmation')){
        const note=node('small','Seen in conversation · sent through CC');note.className='outbox-confirmation';article.append(note);
      }
    }
    const pending=this.outbox.inline(target);
    this.outboxMessages.replaceChildren(...pending);
    const empty=this.history.querySelector<HTMLElement>('.agent-history-empty');if(empty)empty.hidden=pending.length>0;
    this.history.append(this.outboxMessages);
    if(nearBottom)this.history.scrollTop=this.history.scrollHeight;else this.history.scrollTop=top;
  }
  private async send() {
    const chosen = this.chosen(), token = this.detailData?.message_token;
    if (this.sendButton.disabled || !chosen || !token) return;
    const key = this.draftKey(), selected = this.selected, text = this.composer.value;
    const baselineReply = this.latestReply(), baselineActivity = this.activitySignature();
    this.submitting = true; this.detailRequest++; this.loadingDetail = false; this.updateSend(); this.sendFeedback.textContent = 'Sending…';
    let uncertain = true;
    try {
      const entry=await this.outbox.send({host:chosen.h.id,session:chosen.item.session,window:chosen.item.window,pane:chosen.item.pane,instance:this.detailData?.instance||''},token,text);
      uncertain = false; this.drafts.delete(key);
      if(entry.status!=='queued')this.pendingReplies.set(key, { at: Date.now(), reply: baselineReply, activity: baselineActivity });
      if (this.selected === selected) { this.composer.value = ''; this.fitComposer(); this.sendFeedback.textContent = entry.status==='queued'?'Queued in CC. Your message remains visible until delivery is resolved.':'Submitted to terminal; acceptance is not yet confirmed.'; }
    } catch (error) {
      if(error instanceof OutboxSendError)uncertain=error.uncertain;
      if (uncertain) this.uncertain.add(key);
      if (this.selected === selected) this.sendFeedback.textContent = `${String(error)}${uncertain ? ' Delivery is uncertain. Check history or the terminal before sending again.' : ' Your draft was kept. Refresh and review before sending again.'}`;
    } finally {
      this.submitting = false; if (this.detailData) { this.detailData.message_token = undefined; if (this.detailData.approval) this.detailData.approval.token = undefined; }
      this.updateSend(); if (!uncertain) void this.loadDetail();
    }
  }
  private async openNotification(host: Host, item: Item) {
    await this.refresh();
    const fresh = this.snapshot?.hosts.find(h => h.id === host.id && h.connection_revision === host.connection_revision);
    const target = fresh?.items.find(i => i.id === item.id && i.attention?.instance === item.attention?.instance);
    if (!target || stateOf(target) === 'disconnected') { this.feedback.textContent = 'The notified agent is no longer available. Refresh the queue.'; return; }
    this.host = ''; this.project = ''; this.statusSelect.value = '';
    if (item.attention?.history_id) this.conversations.set(target.id, item.attention.history_id);
    this.selected = target.id; this.openedForRead = target.id; this.body.dataset.detail = 'true';
    document.getElementById('show-queue')!.click(); this.render(); void this.loadDetail(true);
    requestAnimationFrame(() => this.history.focus());
  }
  private refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshSnapshot().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }
  private async refreshSnapshot() {
    try {
      const response = await fetch('/api/v1/queue', { signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Queue unavailable (${response.status})`);
      this.snapshot = await response.json();
      for(const h of this.snapshot!.hosts)for(const item of h.items)if(item.card&&item.attention?.instance)this.mergeCard(item,item.attention.instance,item.card);
      document.getElementById('queue-count')!.textContent = String(this.snapshot!.hosts.reduce((n, h) => n + h.items.filter(needsAttention).length, 0));
      await this.notifications.observe(this.snapshot!.hosts.flatMap(h => h.items.filter(item => item.attention && stateOf(item) !== 'disconnected' && !h.error).map(item => {
        const state = item.attention!, scope = JSON.stringify([state.key, state.instance]);
        const tokens: string[] = [];
        if (state.new_approval) tokens.push(JSON.stringify([scope, 'approval', state.revision]));
        if (state.finished) tokens.push(JSON.stringify([scope, 'finished', state.revision]));
        if (state.unread_reply && state.reply_cursor) tokens.push(JSON.stringify([scope, 'reply', state.conversation, state.reply_cursor]));
        return { scope, tokens, title: `${h.name} · ${item.card?.name||item.window_name}`, body: state.new_approval ? (item.activity?.source === 'pi_bridge' ? 'Agent needs input' : 'Agent needs approval') : state.finished ? 'Agent finished working' : 'New agent reply', reading: this.visible && document.hasFocus() && this.openedForRead === item.id && this.selected === item.id && this.history.scrollHeight - this.history.scrollTop - this.history.clientHeight < 60,
          open: () => { void this.openNotification(h, item); } };
      })));
      this.render();
    } catch (error) {
      if (this.snapshot) {
        const observed_at = Math.floor(Date.now() / 1000);
        this.snapshot.hosts = this.snapshot.hosts.map(h => ({ ...h, items: h.items.map(item => ({ ...item, status: 'disconnected', activity: { state: 'disconnected', source: 'backend', reason: 'Queue connection unavailable; showing last observed agent', evidence_at: item.last_seen || this.snapshot!.checked_at, observed_at } })) }));
        this.render();
      }
      this.feedback.dataset.error = 'true'; this.feedback.textContent = String(error); document.getElementById('queue-count')!.textContent = '?';
    }
  }
}
