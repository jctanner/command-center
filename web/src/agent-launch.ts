import {ContainerConfigEditor,defaultContainerConfig,describeContainerReview,type ContainerProfile} from './container-config';
export type LaunchedAgent = { acp?:{broker:string;instance:string;endpoint:string}; host: string; connection_revision: string; launch_id: string; session: string; window: string; pane: string; project: string; provider: string; session_name: string; running: boolean; exited: boolean; context: string; found: boolean };
type Host = { id: string; name: string; connection_revision: string };
type Project = { python_venv?: string | null; path: string; name: string; pinned: boolean };
type Projects = { revision: string; connection_revision: string; projects: Project[]; discovery_error?: string };
type Prepared = { pre_trust?:boolean; python_venv?: string | null; approval_policy?: string | null; model: string | null; endpoint: string; token: string; launch_id: string; project: string; provider: string; executable: string; conversations: { id: string; session: string; title: string; timestamp: string; active: boolean }[] };
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const n = document.createElement(tag); n.textContent = text; return n; };
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`); return value;
}
export class AgentLauncher {
  private dialog = element('dialog');private protocol=element('select');private nativeProvider='codex';private acpReceipt?:{host:string;connection_revision:string;broker:string;endpoint:string;provider?:string;container?:boolean};
  private containerPrepared?:{token:string;broker:string;endpoint:string;path:string;provider:string;container_review:unknown};private containerProfiles:ContainerProfile[]=[];private containerAdvanced=element('details');private containerEditor=new ContainerConfigEditor(()=>{this.invalidate();this.update();});
  private createProfile=element('button','New container profile…');private profileReturn?:Host;private containerProfile=element('select');private containerHelp=element('small');private profileGeneration=0;
  private dismiss=element('button','×');private locationSummary=element('p');private sessionOptions=element('details');private environmentOptions=element('details');private permissionOptions=element('details');private sessionSummary=element('summary');private environmentSummary=element('summary');private permissionSummary=element('summary');
  private machine = element('select');
  private project = element('select');
  private path = element('input');
  private provider = element('select');
  private model = element('input');
  private venv = element('input');
  private rememberVenv = element('input');
  private preTrust = element('input');
  private approvalPolicy = element('select');
  private initialPrompt = element('textarea');
  private promptHelp = element('small');
  private conversation = element('select');
  private destination = element('select');
  private sessionName = element('input');
  private pin = element('input');
  private name = element('input');
  private check = element('button', 'Check project');
  private start = element('button', 'Start agent');
  private recover = element('button', 'Check launch');
  private close = element('button', 'Cancel');
  private another = element('button', 'Prepare another launch');
  private checkedReceipt = false;
  private feedback = element('p');
  private context = element('pre');
  private hosts: Host[] = [];
  private projects?: Projects;
  private prepared?: Prepared;
  private generation = 0;
  private busy = false;
  private checking = false;
  private receipt?: { host: string; revision: string; endpoint: string; id: string };
  constructor(private opened: (agent: LaunchedAgent) => Promise<void>,private openProfiles:(host:string)=>boolean) {
    try {
      const saved = JSON.parse(localStorage.getItem('cc.pending-agent-launch.v1') || 'null');
      if (saved && typeof saved.host === 'string' && typeof saved.revision === 'string' && /^[a-f0-9]{64}$/.test(saved.endpoint) && /^[a-f0-9-]{36}$/.test(saved.id)) this.receipt = saved;
    } catch { /* Storage is optional; in-page recovery remains available. */ }
    this.dialog.className = 'agent-launch-dialog launcher-compact'; this.dialog.setAttribute('aria-label', 'Start an agent');
    const header=element('div');header.className='launcher-header';const titles=element('div');titles.append(element('h2','Start an agent'),element('p','Choose where to work and what to run.'));this.dismiss.type='button';this.dismiss.className='launcher-dismiss';this.dismiss.setAttribute('aria-label','Close launch dialog');this.dismiss.onclick=()=>this.close.click();
    const body=element('div');body.className='launcher-body';const fields=element('div');fields.className='agent-launch-fields launcher-fields';body.append(fields);
    const label=(text:string,control:HTMLElement,parent:HTMLElement=fields)=>{const l=element('label',text);l.append(control);parent.append(l);return l;};
    const help=(control:HTMLElement,text:string,id:string)=>{const note=element('small',text);note.id=id;note.className='launcher-help';control.setAttribute('aria-describedby',id);control.closest('label')!.append(note);return note;};
    this.machine.setAttribute('aria-label','Agent machine');this.project.setAttribute('aria-label','Agent project');this.path.setAttribute('aria-label','Project directory');this.path.placeholder='/absolute/directory or ~/project';
    this.model.setAttribute('aria-label','Agent model');this.model.placeholder='Harness default';this.model.maxLength=200;this.model.autocomplete='off';this.provider.setAttribute('aria-label','Agent provider');this.conversation.setAttribute('aria-label','Start or resume');this.destination.setAttribute('aria-label','Agent tmux destination');
    for(const [value,title]of [['codex','Codex'],['claude','Claude'],['pi','pi'],['goose','Goose']])this.provider.append(new Option(title,value));
    this.pin.type='checkbox';this.name.placeholder='Optional project name';this.name.setAttribute('aria-label','Pinned project name');
    const protocol=this.protocol;protocol.setAttribute('aria-label','Agent connection protocol');protocol.append(new Option('Native tmux (default)','native'),new Option('ACP broker · Claude','acp'),new Option('ACP broker · Codex','acp-codex'),new Option('ACP broker · Goose','acp-goose-host'),new Option('ACP container · Goose','acp-goose'));const connection=label('Connection',protocol,header);connection.className='launcher-connection';header.prepend(titles);header.append(this.dismiss);
    protocol.onchange=()=>{this.invalidate();if(protocol.value.startsWith('acp')){if(!this.provider.closest('label')!.hidden)this.nativeProvider=this.provider.value;this.provider.value=protocol.value.startsWith('acp-goose')?'goose':protocol.value==='acp-codex'?'codex':'claude';this.conversation.replaceChildren(new Option('New conversation',''));this.model.value='';this.preTrust.checked=false;this.approvalPolicy.value='';}else this.provider.value=this.nativeProvider;this.feedback.textContent=protocol.value==='acp-goose'?'Choose a profile, then review its container settings.':protocol.value==='native'?'Check the project before starting.':`${this.provider.value==='goose'?'Goose':this.provider.value==='codex'?'Codex':'Claude'} ACP · configuration is checked when you start.`;this.update();if(protocol.value==='acp-goose')void this.loadContainerProfiles();if(!this.projects&&this.host())void this.loadProjects();else if(protocol.value==='native'&&this.path.value)void this.prepare();};
    label('Machine',this.machine).className='launcher-machine';label('Agent',this.provider).className='launcher-provider';label('Model (optional)',this.model).className='launcher-model';help(this.model,'Blank uses the harness default.','agent-launch-model-help');
    label('Project',this.project).className='launcher-project';label('Conversation',this.conversation).className='launcher-conversation';label('Directory',this.path).className='launcher-directory';this.locationSummary.className='launcher-location';fields.append(this.locationSummary);
    this.containerProfile.setAttribute('aria-label','Goose container profile');label('Reviewed container profile',this.containerProfile).className='launcher-container-profile';this.containerProfile.parentElement!.append(this.containerHelp);this.createProfile.type='button';this.createProfile.className='launcher-create-profile';this.containerProfile.after(this.createProfile);this.createProfile.onclick=()=>{const host=this.host();if(!host||this.busy||this.receipt||this.acpReceipt)return;if(this.openProfiles(host.id)){this.profileReturn=host;this.invalidate();this.dialog.close();}};this.containerProfile.onchange=()=>{this.invalidate();this.resetContainerEditor();this.update();};
    this.initialPrompt.setAttribute('aria-label','Initial prompt');this.initialPrompt.rows=4;this.initialPrompt.maxLength=24000;this.initialPrompt.placeholder='What should the agent work on?';label('Initial prompt (optional)',this.initialPrompt).className='launcher-prompt';this.promptHelp.id='agent-launch-prompt-help';this.promptHelp.className='launcher-help';this.initialPrompt.setAttribute('aria-describedby',this.promptHelp.id);this.initialPrompt.closest('label')!.append(this.promptHelp);this.initialPrompt.oninput=()=>this.update();
    const options=element('div');options.className='launcher-option-groups';fields.append(options);for(const [group,summary,cls]of [[this.sessionOptions,this.sessionSummary,'launcher-session'],[this.environmentOptions,this.environmentSummary,'launcher-environment'],[this.permissionOptions,this.permissionSummary,'launcher-permissions']]as const){group.className='launcher-options '+cls;group.append(summary);options.append(group);}
    label('Tmux destination',this.destination,this.sessionOptions);this.sessionName.setAttribute('aria-label','Named tmux session');this.sessionName.placeholder='work';this.sessionName.maxLength=64;label('Session name (create or reuse)',this.sessionName,this.sessionOptions);
    this.venv.setAttribute('aria-label','Python venv');this.venv.placeholder='None, .venv or /absolute/venv';this.venv.maxLength=4096;label('Python venv (optional)',this.venv,this.environmentOptions);help(this.venv,'Used for commands the agent runs; activation scripts are not sourced.','agent-launch-venv-help');
    this.rememberVenv.type='checkbox';const remember=label('Remember venv for this project',this.rememberVenv,this.environmentOptions);remember.className='agent-launch-pin launcher-checkbox';remember.prepend(this.rememberVenv);help(this.rememberVenv,'Remembering also pins the project.','agent-launch-remember-help');
    const pinLabel=label('Keep this project in Files and the launcher',this.pin,this.environmentOptions);pinLabel.className='agent-launch-pin launcher-checkbox';pinLabel.prepend(this.pin);this.environmentOptions.append(this.name);
    this.approvalPolicy.setAttribute('aria-label','Codex approval policy');this.approvalPolicy.append(new Option('Harness default',''),new Option('Automatic review (workspace-write)','approve-for-me'));label('Codex approval policy',this.approvalPolicy,this.permissionOptions);help(this.approvalPolicy,'Automatic review keeps the workspace-write sandbox and requires CLI support.','agent-launch-policy-help');
    this.preTrust.type='checkbox';this.preTrust.setAttribute('aria-label','Trust exact directory for this launch');const trust=label('Trust exact directory for this launch',this.preTrust,this.permissionOptions);trust.className='agent-launch-pin launcher-checkbox';trust.prepend(this.preTrust);help(this.preTrust,'Default off. Applies only to this launch; wider scopes and other permissions still need review.','agent-launch-trust-help');this.preTrust.onchange=()=>{this.invalidate();this.update();};
    const summary=element('summary','Advanced container options (this launch only)');this.containerAdvanced.className='container-launch-options';this.containerAdvanced.append(summary,this.containerEditor.element);fields.append(this.containerAdvanced);
    this.feedback.setAttribute('role','status');this.context.hidden=true;body.append(this.context);const footer=element('div');footer.className='launcher-footer';const actions=element('div');actions.className='agent-launch-actions';this.start.className='primary';for(const button of [this.check,this.start,this.recover,this.another,this.close])button.type='button';actions.append(this.check,this.recover,this.another,this.close,this.start);footer.append(this.feedback,actions);this.dialog.append(header,body,footer);document.body.append(this.dialog);
    this.machine.onchange = () => { this.preTrust.checked=false;void this.loadProjects(); };
    this.project.onchange = () => { this.preTrust.checked=false;this.invalidate(); const manual = this.project.value === ''; this.path.value = this.project.value; this.venv.value=this.projects?.projects.find(p=>p.path===this.project.value)?.python_venv||'';this.rememberVenv.checked=false; this.path.readOnly = !manual; this.pin.checked = false; this.name.value = this.projects?.projects.find(p => p.path === this.project.value)?.name || ''; this.update(); if (!manual) void this.prepare(); };
    this.path.oninput = () => { this.preTrust.checked=false;this.invalidate(); this.update(); };
    this.venv.oninput=()=>{this.invalidate();this.update();};this.venv.onchange=()=>{if(this.path.value.trim())void this.prepare();};
    this.model.oninput = () => { this.invalidate(); this.feedback.textContent = 'Model changed. Check project to continue.'; this.update(); };
    this.model.onchange = () => { if (this.path.value.trim()) void this.prepare(); };
    this.approvalPolicy.onchange = () => { this.invalidate(); this.update(); if (this.path.value.trim()) void this.prepare(); };
    this.provider.onchange = () => { this.preTrust.checked=false;this.approvalPolicy.value = ''; this.model.value = ''; this.invalidate();this.update(); if (this.path.value.trim()) void this.prepare(); };
    this.destination.onchange=()=>{this.invalidate();this.update();if(this.path.value.trim()&&this.destination.value!=='named')void this.prepare();};this.sessionName.oninput=()=>{this.invalidate();this.update();};
    this.conversation.onchange = () => this.update(); this.pin.onchange = () => this.update();
    this.check.onclick = () => { if(this.protocol.value==='acp-goose')void this.prepareContainer();else void this.prepare(); }; this.start.onclick = () => { void this.launch(); };
    this.recover.onclick = () => { if(this.acpReceipt)void this.checkAcp();else void this.checkLaunch(); };
    this.close.onclick = () => this.dialog.close();
    this.another.onclick = () => { if (!this.busy && this.checkedReceipt) { const host = this.receipt?.host; this.clearReceipt();this.acpReceipt=undefined;localStorage.removeItem('cc.acp.launch.v1'); this.checkedReceipt = false; this.invalidate(); this.dialog.close(); void this.open(host); } };
    this.dialog.addEventListener('cancel', e => { if (this.busy) e.preventDefault(); });
    try{const saved=JSON.parse(localStorage.getItem('cc.acp.launch.v1')||'null');if(saved&&typeof saved.host==='string'&&typeof saved.connection_revision==='string'&&typeof saved.broker==='string'&&typeof saved.endpoint==='string')this.acpReceipt=saved;}catch{}
    if(this.acpReceipt&&!this.receipt){this.protocol.value=this.acpReceipt.provider==='goose'?(this.acpReceipt.container===false?'acp-goose-host':'acp-goose'):this.acpReceipt.provider==='codex'?'acp-codex':'acp';this.provider.value=this.acpReceipt.provider||'claude';}
    this.update();
  }
  private saveReceipt() {
    try { localStorage.setItem('cc.pending-agent-launch.v1', JSON.stringify(this.receipt)); } catch { /* Keep the in-page receipt. */ }
  }
  private clearReceipt() {
    try { if (JSON.parse(localStorage.getItem('cc.pending-agent-launch.v1') || 'null')?.id === this.receipt?.id) localStorage.removeItem('cc.pending-agent-launch.v1'); } catch { /* No persistent receipt. */ }
    this.receipt = undefined;
  }
  async open(preferredHost?: string) {
    if (this.dialog.open) return;
    this.preTrust.checked=false;this.dialog.showModal();this.machine.focus({preventScroll:true});
    if (this.receipt||this.acpReceipt) { this.update(); return; }
    const returning=this.profileReturn;this.profileReturn=undefined;preferredHost=returning?.id||preferredHost;
    this.invalidate(); this.feedback.textContent = 'Loading machines…';
    try {
      this.hosts = await request<Host[]>('/api/v1/hosts');
      this.machine.replaceChildren(...this.hosts.map(h => { const o = element('option', h.name); o.value = h.id; return o; }));
      if (preferredHost && this.hosts.some(h => h.id === preferredHost)) this.machine.value = preferredHost;
      if (!this.hosts.length) throw new Error('Add a machine in Settings first.');
      if(returning&&this.projects&&this.host()?.id===returning.id&&this.host()?.connection_revision===returning.connection_revision){this.feedback.textContent='Choose a profile, then review its container settings.';this.update();await this.loadContainerProfiles();return;}
      await this.loadProjects();
    } catch (e) { this.feedback.textContent = String(e); this.update(); }
  }
  private invalidate() { this.containerPrepared=undefined;this.context.classList.remove('container-launch-review');this.generation++; this.prepared = undefined; this.checking = false; this.conversation.replaceChildren(); this.context.hidden = true;this.feedback.textContent=this.busy?'':this.protocol.value==='native'?'Settings changed. Check project to continue.':this.protocol.value==='acp-goose'?'Container settings changed. Review before starting.':'Configuration is checked when you start ACP.'; }
  private host() { return this.hosts.find(h => h.id === this.machine.value); }
  private url(host: string, action: string) { return `/api/v1/hosts/${encodeURIComponent(host)}/agents/${action}`; }
  private update() {
    const acp=this.protocol.value.startsWith('acp'),locked = this.busy || !!this.receipt||!!this.acpReceipt;this.protocol.disabled=locked;
    for (const field of [this.machine, this.project, this.path, this.provider, this.model, this.venv, this.rememberVenv, this.approvalPolicy, this.preTrust, this.destination, this.sessionName, this.conversation, this.initialPrompt, this.pin, this.name]) field.disabled = locked || (field !== this.machine && !this.projects);
    this.sessionName.closest('label')!.hidden=acp||this.destination.value!=='named';
    this.containerProfile.closest('label')!.hidden=this.protocol.value!=='acp-goose';this.containerProfile.disabled=locked;this.createProfile.disabled=locked||!this.host();this.containerAdvanced.hidden=this.protocol.value!=='acp-goose';this.containerEditor.disabled(locked||!this.containerProfile.value);
    this.preTrust.disabled=locked||!this.projects||!['codex','claude'].includes(this.provider.value);
    this.approvalPolicy.disabled = locked || !this.projects || this.provider.value !== 'codex';
    this.check.disabled = locked || this.checking || !this.path.value.trim() || !this.projects;
    const resumed=!!this.conversation.value, tooLong=new TextEncoder().encode(this.initialPrompt.value).length>(acp?12000:24000);
    this.initialPrompt.disabled=locked||!this.projects||resumed;
    this.promptHelp.textContent=resumed?'Resume keeps the existing conversation. Send follow-up instructions from its chat.':tooLong?'Prompt is too long. Shorten it to continue.':'Sent once when starting a new conversation. Leave blank to open the agent without a prompt.';
    this.start.disabled = locked || !this.prepared || this.checking || (!resumed&&tooLong);
    this.dismiss.disabled=this.busy;this.close.disabled = this.busy; this.close.textContent = this.receipt||this.acpReceipt ? 'Close' : 'Cancel';
    this.another.hidden = (!this.receipt&&!this.acpReceipt) || !this.checkedReceipt; this.another.disabled = this.busy;
    this.recover.hidden = !this.receipt&&!this.acpReceipt; this.recover.disabled = this.busy;
    this.start.hidden = !!this.receipt; this.check.hidden = !!this.receipt;
    this.pin.parentElement!.hidden = !!this.projects?.projects.find(p => p.path === this.project.value && p.pinned);
    this.name.hidden = !this.pin.checked;
    for(const field of [this.provider,this.model,this.venv,this.rememberVenv,this.preTrust,this.approvalPolicy,this.destination,this.conversation]){field.closest('label')!.hidden=acp;if(acp)field.disabled=true;}
    this.sessionOptions.hidden=this.environmentOptions.hidden=acp;this.sessionOptions.parentElement!.hidden=acp;this.permissionOptions.hidden=acp||!['codex','claude'].includes(this.provider.value);
    this.path.closest('label')!.hidden=!!this.project.value;this.locationSummary.hidden=!this.path.value;this.locationSummary.textContent=`${this.machine.selectedOptions[0]?.textContent||'Machine'} › ${this.path.value}`;this.locationSummary.title=this.path.value;this.locationSummary.setAttribute('aria-label',this.prepared?'Resolved directory':'Working directory');
    this.sessionSummary.textContent='Tmux · '+(this.destination.value==='named'?`Named session: ${this.sessionName.value||'choose a name'}`:this.destination.selectedOptions[0]?.textContent||'New dedicated session');
    this.environmentSummary.textContent='Environment · '+(this.venv.value.trim()?`Python venv: ${this.venv.value.trim()}`:'No venv')+(this.rememberVenv.checked?' · remember (pins project)':this.pin.checked?' · pin project':'');
    this.permissionSummary.textContent=`Permissions · ${this.approvalPolicy.value?'Automatic review':'Harness default'} · trust ${this.preTrust.checked?'ON (this launch)':'off'}`;this.permissionSummary.dataset.changed=String(!!this.approvalPolicy.value||this.preTrust.checked);
    if(this.preTrust.checked)this.permissionOptions.open=true;
    this.pin.closest('label')!.hidden=acp||!!this.projects?.projects.find(p=>p.path===this.project.value&&p.pinned);this.name.hidden=acp||!this.pin.checked;
    if(acp){this.check.hidden=true;this.start.hidden=!!this.acpReceipt;this.start.disabled=locked||!this.projects||!this.path.value.trim()||tooLong||this.protocol.value==='acp-goose'&&!this.containerProfile.value;this.initialPrompt.disabled=locked||!this.projects;this.promptHelp.textContent=tooLong?'ACP initial prompt is limited to12,000 UTF-8 bytes.':'New '+(this.provider.value==='goose'?'Goose':this.provider.value==='codex'?'Codex':'Claude')+' ACP conversation. Model, resume, venv and pre-trust overrides are unavailable.';}

    if(this.protocol.value==='acp-goose')this.promptHelp.textContent='Goose runs only in the reviewed container, with human tool approvals. Choose a host directory permitted by the profile; review its container mounts and runtime settings before Start. No project copying or synchronization.';
    this.check.textContent=this.protocol.value==='acp-goose'?'Review container launch':'Check project';if(this.protocol.value==='acp-goose'){this.check.hidden=!!this.acpReceipt;this.check.disabled=locked||this.checking||!this.projects||!this.path.value.trim()||!this.containerProfile.value;this.start.disabled=locked||this.checking||!this.containerPrepared||tooLong;}
    this.start.textContent = acp?`Start ${this.provider.value==='goose'?'Goose':this.provider.value==='codex'?'Codex':'Claude'} (ACP)`:`${this.conversation.value ? 'Resume' : 'Start'} ${this.provider.value === 'goose' ? 'Goose' : this.provider.value === 'pi' ? 'pi' : this.provider.value === 'claude' ? 'Claude' : 'Codex'}`;
  }
  private async loadProjects() {
    this.invalidate(); this.projects = undefined; this.path.value = '';this.venv.value='';this.rememberVenv.checked=false; this.model.value = ''; this.approvalPolicy.value = ''; this.pin.checked = false; this.project.replaceChildren();this.destination.replaceChildren(new Option('New dedicated session','')); this.feedback.textContent = 'Loading projects…'; this.update();
    const host = this.host(), generation = this.generation; if (!host) return;
    try {
      const [data,inventory]=await Promise.all([request<Projects>(`/api/v1/hosts/${encodeURIComponent(host.id)}/projects`),request<{sessions:{id:string;name:string}[]}>(`/api/v1/hosts/${encodeURIComponent(host.id)}/inventory`).catch(()=>({sessions:[]}))]);
      if (generation !== this.generation) return;
      if (data.connection_revision !== host.connection_revision) throw new Error('Machine changed. Close and reopen the launcher.');
      this.destination.replaceChildren(new Option('New dedicated session',''),new Option('Named session (create or reuse)','named'),...inventory.sessions.filter(s=>!s.name.startsWith('cc-view-')).map(s=>new Option(`New window in ${s.name} (${s.id})`,s.id)));
      this.projects = data;
      const projects = [...data.projects].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
      this.project.replaceChildren(...projects.map(p => { const o = element('option', `${p.pinned ? '★ ' : ''}${p.name} · ${p.path}`); o.value = p.path; return o; }));
      const manual = element('option', 'Another directory…'); manual.value = ''; this.project.append(manual);
      this.path.value = this.project.value; this.venv.value=this.projects?.projects.find(p=>p.path===this.project.value)?.python_venv||'';this.rememberVenv.checked=false; this.path.readOnly = !!this.project.value; this.name.value = projects.find(p => p.path === this.project.value)?.name || '';
      this.feedback.textContent = data.discovery_error ? 'Live directory discovery is unavailable. Pinned projects and manual directories can still be used.' : '';
      this.update();if(this.protocol.value==='acp-goose')void this.loadContainerProfiles(); if (this.path.value&&this.protocol.value==='native') await this.prepare();
    } catch (e) { if (generation === this.generation) { this.feedback.textContent = String(e); this.update(); } }
  }
  private async prepare() {
    const host = this.host(); if (this.protocol.value!=='native'||!host || !this.projects || this.busy || this.receipt) return;
    this.invalidate(); const generation = this.generation; this.checking = true; this.feedback.textContent = 'Checking directory, agent and project history…'; this.update();
    try {
      const query = new URLSearchParams({ connection_revision: host.connection_revision, path: this.path.value, provider: this.provider.value });
      query.set('python_venv',this.venv.value.trim());query.set('pre_trust',String(this.preTrust.checked));
      if (this.model.value.trim()) query.set('model', this.model.value.trim());
      if(this.provider.value==='codex'&&this.approvalPolicy.value)query.set('approval_policy',this.approvalPolicy.value);
      if(this.destination.value==='named')query.set('target_session_name',this.sessionName.value);else if(this.destination.value)query.set('target_session',this.destination.value);
      const data = await request<Prepared>(this.url(host.id, `launch-options?${query}`));
      if (generation !== this.generation) return;
      this.prepared = data; this.path.value = data.project;
      const fresh = element('option', 'New conversation'); fresh.value = ''; this.conversation.replaceChildren(fresh);
      for (const c of data.conversations) { const o = element('option', `${c.active ? 'Already running' : 'Resume'}: ${c.title} · ${c.timestamp ? new Date(c.timestamp).toLocaleString() : c.session.slice(0, 8)}`); o.value = c.id; o.disabled = c.active; this.conversation.append(o); }
      this.feedback.textContent = `Ready · ${data.provider==='goose'?'Goose':data.provider==='pi'?'pi':data.provider==='claude'?'Claude':'Codex'} · ${data.conversations.length} saved conversation${data.conversations.length===1?'':'s'}${data.approval_policy==='approve-for-me'?' · Automatic review (workspace-write)':''}${data.pre_trust?' · PRE-TRUST: '+data.project:''}`;
    } catch (e) { if (generation === this.generation) this.feedback.textContent = String(e); }
    finally { if (generation === this.generation) { this.checking = false; this.update(); } }
  }
  private async launch() {
    if(this.protocol.value.startsWith('acp')){await this.launchAcp();return;}
    const prepared = this.prepared, host = this.host(), projects = this.projects;
    if (!prepared || !host || !projects || this.busy || this.receipt) return;
    this.busy = true; this.update(); this.feedback.textContent = 'Starting agent…';
    try {
      if (this.pin.checked || this.rememberVenv.checked) {
        const response = await fetch(`/api/v1/hosts/${encodeURIComponent(host.id)}/projects`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: projects.revision, path: prepared.project, name: this.name.value.trim() || projects.projects.find(p=>p.path===prepared.project)?.name || undefined, pinned: true, ...(this.rememberVenv.checked?{python_venv:this.venv.value.trim()}:{}) }), signal: AbortSignal.timeout(25000) });
        const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Project could not be pinned');
        projects.revision = value.revision;
      }
      // Retain the receipt before IO. Recovery only observes; it never resends.
      this.receipt = { host: host.id, revision: host.connection_revision, endpoint: prepared.endpoint, id: prepared.launch_id };
      this.saveReceipt(); this.checkedReceipt = false;
      let result = await request<LaunchedAgent>(this.url(host.id, 'launch'), { token: prepared.token, conversation: this.conversation.value || null, initial_prompt: !this.conversation.value&&this.initialPrompt.value.trim()?this.initialPrompt.value:null });
      for (let i = 0; result.found && !result.running && !result.exited && i < 6; i++) {
        await new Promise(resolve => window.setTimeout(resolve, 500));
        result = await request<LaunchedAgent>(this.url(host.id, `launch-status?${new URLSearchParams({ connection_revision: host.connection_revision, endpoint: prepared.endpoint, launch_id: prepared.launch_id })}`));
      }
      this.checkedReceipt = true;
      await this.finish(result);
    } catch (e) { this.feedback.textContent = `${String(e)}${this.receipt ? ' Use Check launch before starting another agent.' : ''}`; }
    finally { this.busy = false; this.update(); }
  }
  private async loadContainerProfiles(){
    const host=this.host(),generation=++this.profileGeneration;this.containerProfile.replaceChildren();this.containerHelp.textContent='Loading reviewed profiles…';this.update();if(!host)return;
    try{const profiles=await request<ContainerProfile[]>(`/api/v1/hosts/${host.id}/acp/profiles?`+new URLSearchParams({connection_revision:host.connection_revision}));if(generation!==this.profileGeneration||this.host()?.id!==host.id||this.protocol.value!=='acp-goose')return;
      this.containerProfiles=profiles;this.containerProfile.replaceChildren(...profiles.map(p=>new Option(`${p.label} · ${p.model}`,p.id)));this.containerHelp.textContent=profiles.length?'Scratch root: '+profiles[0].workspace_root:'No reviewed container profiles installed on this machine.';this.resetContainerEditor();
    }catch(error){if(generation===this.profileGeneration)this.containerHelp.textContent=String(error);}this.update();
  }
  private resetContainerEditor(){const profile=this.containerProfiles.find(p=>p.id===this.containerProfile.value);if(profile)this.containerEditor.set(profile.config||{...defaultContainerConfig(profile.id),label:profile.label,image:profile.image,model:profile.model},true);this.containerAdvanced.open=false;}
  private async prepareContainer(){
    const host=this.host();if(!host||this.busy||this.checking||this.receipt||this.acpReceipt)return;this.invalidate();const version=this.generation;this.checking=true;this.update();this.feedback.textContent='Resolving container configuration and cached image…';
    try{const overrides=this.containerEditor.overrides();const data=await request<{token:string;broker:string;endpoint:string;path:string;provider:string;container_review:unknown}>(`/api/v1/hosts/${host.id}/acp/prepare`,{connection_revision:host.connection_revision,path:this.path.value,provider:'goose',container_profile:this.containerProfile.value,...(Object.keys(overrides).length?{container_overrides:overrides}:{})});if(version!==this.generation)return;this.containerPrepared=data;this.context.textContent=describeContainerReview(data.container_review);this.context.classList.add('container-launch-review');this.context.hidden=false;this.feedback.textContent='Review these exact settings, then Start Goose. Images are not pulled and nothing has launched.';}
    catch(error){if(version===this.generation)this.feedback.textContent=String(error);}finally{if(version===this.generation){this.checking=false;this.update();}}
  }
  private async launchAcp(){
    const host=this.host();if(!host||this.busy||this.acpReceipt||this.receipt||this.start.disabled)return;const reviewed=this.protocol.value==='acp-goose'?this.containerPrepared:undefined;if(this.protocol.value==='acp-goose'&&!reviewed)return;this.busy=true;this.invalidate();this.update();this.feedback.textContent='Preparing and starting ACP…';
    try{
      const prepared=reviewed||await request<{token:string;broker:string;endpoint:string;path:string;provider:string}>(`/api/v1/hosts/${host.id}/acp/prepare`,{connection_revision:host.connection_revision,path:this.path.value,provider:this.provider.value,...(this.protocol.value==='acp-goose'?{container_profile:this.containerProfile.value}:{})});
      this.acpReceipt={host:host.id,connection_revision:host.connection_revision,broker:prepared.broker,endpoint:prepared.endpoint,provider:prepared.provider,container:this.protocol.value==='acp-goose'};
      try{localStorage.setItem('cc.acp.launch.v1',JSON.stringify(this.acpReceipt));}catch{this.acpReceipt=undefined;throw Error('Cannot persist recovery identity; nothing launched.');}
      await request(`/api/v1/hosts/${host.id}/acp/start`,{token:prepared.token,initial_prompt:this.initialPrompt.value.trim()?this.initialPrompt.value:null});
      for(let i=0;i<6;i++){try{await this.openAcpReceipt();return;}catch{await new Promise(resolve=>setTimeout(resolve,400));}}
      this.feedback.textContent='ACP broker is starting. Use Check launch; no launch or prompt will be repeated.';
    }catch(e){this.feedback.textContent=`${e}${this.acpReceipt?' Use Check launch before trying another launch.':''}`;}
    finally{this.busy=false;this.update();}
  }
  private async openAcpReceipt(){
    const receipt=this.acpReceipt;if(!receipt)return;const hosts=await request<Host[]>('/api/v1/hosts');const host=hosts.find(h=>h.id===receipt.host);if(!host)throw Error('Machine unavailable');
    const scope=new URLSearchParams({connection_revision:host.connection_revision});const inventory=await request<{endpoint:string}>(`/api/v1/hosts/${host.id}/acp?${scope}`);if(inventory.endpoint!==receipt.endpoint)throw Error('Machine endpoint changed; inspect the original broker before any new launch');
    const result=await request<{instance:string;provider?:string;state:string;path:string;target:{session:string;window:string;pane:string;session_name:string}}>(`/api/v1/hosts/${host.id}/acp/${receipt.broker}?${scope}`);
    if(['failed','exited'].includes(result.state)){this.checkedReceipt=true;throw Error('ACP agent failed/exited; inspect its tmux broker before another launch');}
    await this.opened({host:host.id,connection_revision:host.connection_revision,launch_id:receipt.broker,session:result.target.session,window:result.target.window,pane:result.target.pane,session_name:result.target.session_name,provider:result.provider||'claude',project:result.path,running:true,found:true,exited:false,context:'',acp:{broker:receipt.broker,instance:result.instance,endpoint:receipt.endpoint}});
    this.acpReceipt=undefined;localStorage.removeItem('cc.acp.launch.v1');this.initialPrompt.value='';this.dialog.close();
  }
  private async checkAcp(){if(!this.acpReceipt||this.busy)return;this.busy=true;this.update();try{await this.openAcpReceipt();}catch(e){this.feedback.textContent=`${e} No additional agent was started.`;}finally{this.busy=false;this.update();}}
  private async checkLaunch() {
    if (!this.receipt || this.busy) return;
    this.busy = true; this.update(); this.feedback.textContent = 'Checking the original launch…';
    try {
      const { host, revision, endpoint, id } = this.receipt;
      const result = await request<LaunchedAgent>(this.url(host, `launch-status?${new URLSearchParams({ connection_revision: revision, endpoint, launch_id: id })}`));
      this.checkedReceipt = true;
      await this.finish(result);
    } catch (e) { this.feedback.textContent = `${String(e)} No additional agent was started.`; }
    finally { this.busy = false; this.update(); }
  }
  private async finish(result: LaunchedAgent) {
    if (result.found && result.running) {
      await this.opened(result); this.initialPrompt.value='';this.clearReceipt(); this.prepared = undefined; this.dialog.close(); return;
    }
    this.feedback.textContent = result.exited ? 'The agent exited during startup. Review its output below; the tmux pane is preserved.' : result.found ? 'Tmux target created. The agent is still starting or needs CLI setup. Use Check launch to continue.' : 'No launch target found yet. Check again before starting another agent.';
    this.context.textContent = result.context || ''; this.context.hidden = !result.context;
  }
}
