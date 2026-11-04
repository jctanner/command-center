export type LaunchedAgent = { host: string; connection_revision: string; launch_id: string; session: string; window: string; pane: string; project: string; provider: string; session_name: string; running: boolean; exited: boolean; context: string; found: boolean };
type Host = { id: string; name: string; connection_revision: string };
type Project = { path: string; name: string; pinned: boolean };
type Projects = { revision: string; connection_revision: string; projects: Project[]; discovery_error?: string };
type Prepared = { model: string | null; endpoint: string; token: string; launch_id: string; project: string; provider: string; executable: string; conversations: { id: string; session: string; title: string; timestamp: string; active: boolean }[] };
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, text = '') => { const n = document.createElement(tag); n.textContent = text; return n; };
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(25000) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || `Request failed (${response.status})`); return value;
}
export class AgentLauncher {
  private dialog = element('dialog');
  private machine = element('select');
  private project = element('select');
  private path = element('input');
  private provider = element('select');
  private model = element('input');
  private conversation = element('select');
  private destination = element('select');
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
  constructor(private opened: (agent: LaunchedAgent) => Promise<void>) {
    try {
      const saved = JSON.parse(localStorage.getItem('cc.pending-agent-launch.v1') || 'null');
      if (saved && typeof saved.host === 'string' && typeof saved.revision === 'string' && /^[a-f0-9]{64}$/.test(saved.endpoint) && /^[a-f0-9-]{36}$/.test(saved.id)) this.receipt = saved;
    } catch { /* Storage is optional; in-page recovery remains available. */ }
    this.dialog.className = 'agent-launch-dialog'; this.dialog.setAttribute('aria-label', 'Start an agent');
    const heading = element('h2', 'Start an agent');
    const intro = element('p', 'Choose where to work. Projects are shared with Files.');
    const fields = element('div'); fields.className = 'agent-launch-fields';
    const label = (text: string, control: HTMLElement) => { const l = element('label', text); l.append(control); fields.append(l); };
    this.machine.setAttribute('aria-label', 'Agent machine'); this.project.setAttribute('aria-label', 'Agent project');
    this.path.setAttribute('aria-label', 'Project directory'); this.path.placeholder = '/absolute/directory or ~/project';
    this.model.setAttribute('aria-label', 'Agent model'); this.model.placeholder = 'Harness default'; this.model.maxLength = 200; this.model.autocomplete = 'off';
    this.provider.setAttribute('aria-label', 'Agent provider'); this.conversation.setAttribute('aria-label', 'Start or resume');this.destination.setAttribute('aria-label','Agent tmux destination');
    for (const value of ['codex', 'claude', 'pi']) { const o = element('option', value === 'codex' ? 'Codex' : value === 'pi' ? 'pi' : 'Claude'); o.value = value; this.provider.append(o); }
    this.pin.type = 'checkbox'; this.name.placeholder = 'Optional project name'; this.name.setAttribute('aria-label', 'Pinned project name');
    label('Machine', this.machine); label('Project', this.project); label('Directory', this.path); label('Agent', this.provider); label('Model (optional)', this.model);
    fields.append(element('small', 'Enter a model name or alias, or leave blank for no override.'));
    label('Tmux destination',this.destination);
    label('Conversation', this.conversation);
    const pinLabel = element('label', 'Keep this project in Files and the launcher'); pinLabel.className = 'agent-launch-pin'; pinLabel.prepend(this.pin); fields.append(pinLabel, this.name);
    this.feedback.setAttribute('role', 'status'); this.context.hidden = true;
    const actions = element('div'); actions.className = 'agent-launch-actions'; this.start.className = 'primary';
    for (const b of [this.check, this.start, this.recover, this.another, this.close]) b.type = 'button';
    actions.append(this.check, this.start, this.recover, this.another, this.close); this.dialog.append(heading, intro, fields, this.feedback, this.context, actions); document.body.append(this.dialog);
    this.machine.onchange = () => { void this.loadProjects(); };
    this.project.onchange = () => { this.invalidate(); const manual = this.project.value === ''; this.path.value = this.project.value; this.path.readOnly = !manual; this.pin.checked = false; this.name.value = this.projects?.projects.find(p => p.path === this.project.value)?.name || ''; this.update(); if (!manual) void this.prepare(); };
    this.path.oninput = () => { this.invalidate(); this.update(); };
    this.model.oninput = () => { this.invalidate(); this.feedback.textContent = 'Model changed. Check project to continue.'; this.update(); };
    this.model.onchange = () => { if (this.path.value.trim()) void this.prepare(); };
    this.provider.onchange = () => { this.model.value = ''; this.invalidate(); if (this.path.value.trim()) void this.prepare(); };
    this.destination.onchange=()=>{this.invalidate();this.update();if(this.path.value.trim())void this.prepare();};
    this.conversation.onchange = () => this.update(); this.pin.onchange = () => this.update();
    this.check.onclick = () => { void this.prepare(); }; this.start.onclick = () => { void this.launch(); };
    this.recover.onclick = () => { void this.checkLaunch(); };
    this.close.onclick = () => this.dialog.close();
    this.another.onclick = () => { if (!this.busy && this.checkedReceipt) { const host = this.receipt?.host; this.clearReceipt(); this.checkedReceipt = false; this.invalidate(); this.dialog.close(); void this.open(host); } };
    this.dialog.addEventListener('cancel', e => { if (this.busy) e.preventDefault(); });
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
    this.dialog.showModal();
    if (this.receipt) { this.update(); return; }
    this.invalidate(); this.feedback.textContent = 'Loading machines…';
    try {
      this.hosts = await request<Host[]>('/api/v1/hosts');
      this.machine.replaceChildren(...this.hosts.map(h => { const o = element('option', h.name); o.value = h.id; return o; }));
      if (preferredHost && this.hosts.some(h => h.id === preferredHost)) this.machine.value = preferredHost;
      if (!this.hosts.length) throw new Error('Add a machine in Settings first.');
      await this.loadProjects();
    } catch (e) { this.feedback.textContent = String(e); this.update(); }
  }
  private invalidate() { this.generation++; this.prepared = undefined; this.checking = false; this.conversation.replaceChildren(); this.context.hidden = true; }
  private host() { return this.hosts.find(h => h.id === this.machine.value); }
  private url(host: string, action: string) { return `/api/v1/hosts/${encodeURIComponent(host)}/agents/${action}`; }
  private update() {
    const locked = this.busy || !!this.receipt;
    for (const field of [this.machine, this.project, this.path, this.provider, this.model, this.destination, this.conversation, this.pin, this.name]) field.disabled = locked || (field !== this.machine && !this.projects);
    this.check.disabled = locked || this.checking || !this.path.value.trim() || !this.projects;
    this.start.disabled = locked || !this.prepared || this.checking;
    this.close.disabled = this.busy; this.close.textContent = this.receipt ? 'Close' : 'Cancel';
    this.another.hidden = !this.receipt || !this.checkedReceipt; this.another.disabled = this.busy;
    this.recover.hidden = !this.receipt; this.recover.disabled = this.busy;
    this.start.hidden = !!this.receipt; this.check.hidden = !!this.receipt;
    this.pin.parentElement!.hidden = !!this.projects?.projects.find(p => p.path === this.project.value && p.pinned);
    this.name.hidden = !this.pin.checked;
    this.start.textContent = `${this.conversation.value ? 'Resume' : 'Start'} ${this.provider.value === 'pi' ? 'pi' : this.provider.value === 'claude' ? 'Claude' : 'Codex'}`;
  }
  private async loadProjects() {
    this.invalidate(); this.projects = undefined; this.path.value = ''; this.model.value = ''; this.pin.checked = false; this.project.replaceChildren();this.destination.replaceChildren(new Option('New dedicated session','')); this.feedback.textContent = 'Loading projects…'; this.update();
    const host = this.host(), generation = this.generation; if (!host) return;
    try {
      const [data,inventory]=await Promise.all([request<Projects>(`/api/v1/hosts/${encodeURIComponent(host.id)}/projects`),request<{sessions:{id:string;name:string}[]}>(`/api/v1/hosts/${encodeURIComponent(host.id)}/inventory`).catch(()=>({sessions:[]}))]);
      if (generation !== this.generation) return;
      if (data.connection_revision !== host.connection_revision) throw new Error('Machine changed. Close and reopen the launcher.');
      this.destination.replaceChildren(new Option('New dedicated session',''),...inventory.sessions.filter(s=>!s.name.startsWith('cc-view-')).map(s=>new Option(`New window in ${s.name} (${s.id})`,s.id)));
      this.projects = data;
      const projects = [...data.projects].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
      this.project.replaceChildren(...projects.map(p => { const o = element('option', `${p.pinned ? '★ ' : ''}${p.name} · ${p.path}`); o.value = p.path; return o; }));
      const manual = element('option', 'Another directory…'); manual.value = ''; this.project.append(manual);
      this.path.value = this.project.value; this.path.readOnly = !!this.project.value; this.name.value = projects.find(p => p.path === this.project.value)?.name || '';
      this.feedback.textContent = data.discovery_error ? 'Live directory discovery is unavailable. Pinned projects and manual directories can still be used.' : '';
      this.update(); if (this.path.value) await this.prepare();
    } catch (e) { if (generation === this.generation) { this.feedback.textContent = String(e); this.update(); } }
  }
  private async prepare() {
    const host = this.host(); if (!host || !this.projects || this.busy || this.receipt) return;
    this.invalidate(); const generation = this.generation; this.checking = true; this.feedback.textContent = 'Checking directory, agent and project history…'; this.update();
    try {
      const query = new URLSearchParams({ connection_revision: host.connection_revision, path: this.path.value, provider: this.provider.value });
      if (this.model.value.trim()) query.set('model', this.model.value.trim());
      if(this.destination.value)query.set('target_session',this.destination.value);
      const data = await request<Prepared>(this.url(host.id, `launch-options?${query}`));
      if (generation !== this.generation) return;
      this.prepared = data; this.path.value = data.project;
      const fresh = element('option', 'New conversation'); fresh.value = ''; this.conversation.replaceChildren(fresh);
      for (const c of data.conversations) { const o = element('option', `${c.active ? 'Already running' : 'Resume'}: ${c.title} · ${c.timestamp ? new Date(c.timestamp).toLocaleString() : c.session.slice(0, 8)}`); o.value = c.id; o.disabled = c.active; this.conversation.append(o); }
      this.feedback.textContent = `${data.provider === 'pi' ? 'pi' : data.provider === 'claude' ? 'Claude' : 'Codex'} available · ${data.conversations.length} project conversation${data.conversations.length === 1 ? '' : 's'}. ${this.destination.selectedOptions[0]?.textContent||'New dedicated session'}.`;
    } catch (e) { if (generation === this.generation) this.feedback.textContent = String(e); }
    finally { if (generation === this.generation) { this.checking = false; this.update(); } }
  }
  private async launch() {
    const prepared = this.prepared, host = this.host(), projects = this.projects;
    if (!prepared || !host || !projects || this.busy || this.receipt) return;
    this.busy = true; this.update(); this.feedback.textContent = 'Starting agent…';
    try {
      if (this.pin.checked) {
        const response = await fetch(`/api/v1/hosts/${encodeURIComponent(host.id)}/projects`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: projects.revision, path: prepared.project, name: this.name.value.trim() || undefined, pinned: true }), signal: AbortSignal.timeout(25000) });
        const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Project could not be pinned');
        projects.revision = value.revision;
      }
      // Retain the receipt before IO. Recovery only observes; it never resends.
      this.receipt = { host: host.id, revision: host.connection_revision, endpoint: prepared.endpoint, id: prepared.launch_id };
      this.saveReceipt(); this.checkedReceipt = false;
      let result = await request<LaunchedAgent>(this.url(host.id, 'launch'), { token: prepared.token, conversation: this.conversation.value || null });
      for (let i = 0; result.found && !result.running && !result.exited && i < 6; i++) {
        await new Promise(resolve => window.setTimeout(resolve, 500));
        result = await request<LaunchedAgent>(this.url(host.id, `launch-status?${new URLSearchParams({ connection_revision: host.connection_revision, endpoint: prepared.endpoint, launch_id: prepared.launch_id })}`));
      }
      this.checkedReceipt = true;
      await this.finish(result);
    } catch (e) { this.feedback.textContent = `${String(e)}${this.receipt ? ' Use Check launch before starting another agent.' : ''}`; }
    finally { this.busy = false; this.update(); }
  }
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
      await this.opened(result); this.clearReceipt(); this.prepared = undefined; this.dialog.close(); return;
    }
    this.feedback.textContent = result.exited ? 'The agent exited during startup. Review its output below; the tmux pane is preserved.' : result.found ? 'Tmux target created. The agent is still starting or needs CLI setup. Use Check launch to continue.' : 'No launch target found yet. Check again before starting another agent.';
    this.context.textContent = result.context || ''; this.context.hidden = !result.context;
  }
}
