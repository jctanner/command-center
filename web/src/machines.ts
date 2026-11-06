export type Host = { id: string; name: string; remote: boolean; connection_revision: string };
type Draft = { name: string; ssh: string | null; socket: string | null; ssh_config: string | null; ssh_jump: string | null };
type ConfiguredHost = Draft & { id: string };
type Settings = { revision: string; hosts: ConfiguredHost[] };
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
class RequestError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch {
    throw new RequestError(text || `Request failed (${response.status})`, response.status);
  }
  if (!response.ok) throw new RequestError(result.error || `Request failed (${response.status})`, response.status);
  return result;
}
export function initMachines(onChange: (hosts: Host[]) => void, onClose:()=>void) {
  const form = el<HTMLFormElement>('machine-form');
  const name = el<HTMLInputElement>('machine-name'), kind = el<HTMLSelectElement>('machine-kind'), ssh = el<HTMLInputElement>('machine-ssh');
  const jump = el<HTMLInputElement>('machine-ssh-jump');
  const socket = el<HTMLInputElement>('machine-socket'), sshConfig = el<HTMLInputElement>('machine-ssh-config');
  const feedback = el('machine-feedback'), reload = el('reload-machines');
  let settings: Settings = { revision: '', hosts: [] }, selected: string | undefined, dirty = false, busy = false, operation = 0, savedDraft = '';
  function say(text = '', state = '') { feedback.textContent = text; feedback.dataset.state = state; }
  function controls() {
    el<HTMLFieldSetElement>('machine-fields').disabled = busy;
    for (const id of ['test-machine', 'save-machine', 'add-machine', 'remove-machine', 'confirm-remove', 'cancel-remove', 'reload-machines', 'close-machines']) el<HTMLButtonElement>(id).disabled = busy;
    for (const button of el('machine-list').querySelectorAll<HTMLButtonElement>('button')) button.disabled = busy;
  }
  function showConnection() {
    const remote = kind.value === 'ssh';
    el('ssh-jump-label').hidden = !remote; el('ssh-destination-label').hidden = !remote; el('ssh-config-label').hidden = !remote; ssh.required = remote;
  }
  function list() {
    el('ssh-jump-options').replaceChildren(...settings.hosts.filter(h => h.ssh && h.id !== selected).map(h => { const option = document.createElement('option'); option.value = h.ssh!; option.label = h.name; return option; }));
    el('machine-list').replaceChildren(...settings.hosts.map(host => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = host.name;
      button.className = host.id === selected ? 'selected' : ''; button.setAttribute('aria-current', String(host.id === selected));
      button.onclick = () => { if (!busy && discard()) fill(host); }; return button;
    }));
    controls();
  }
  function discard() { return !dirty || window.confirm('Discard unsaved machine changes?'); }
  function fill(host?: ConfiguredHost) {
    operation++; selected = host?.id; dirty = false;
    name.value = host?.name ?? ''; kind.value = host?.ssh ? 'ssh' : 'local'; ssh.value = host?.ssh ?? ''; jump.value = host?.ssh_jump ?? '';
    socket.value = host?.socket ?? ''; sshConfig.value = host?.ssh_config ?? ''; showConnection(); savedDraft = JSON.stringify(draft());
    el('remove-machine').hidden = !host; el('remove-confirm').hidden = true; reload.hidden = true; say(); list(); name.focus();
  }
  function draft(): Draft {
    const optional = (value: string) => value.trim() || null;
    return { name: name.value.trim(), ssh: kind.value === 'ssh' ? optional(ssh.value) : null, socket: optional(socket.value), ssh_config: kind.value === 'ssh' ? optional(sshConfig.value) : null, ssh_jump: kind.value === 'ssh' ? optional(jump.value) : null };
  }
  function failed(error: unknown) {
    say(error instanceof Error ? error.message : String(error), 'error');
    if (error instanceof RequestError && error.status === 409) reload.hidden = false;
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    busy = true; controls();
    try { await action(); } catch (error) { failed(error); }
    finally { busy = false; controls(); }
  }
  async function updateTabs() { onChange(await request<Host[]>('/hosts')); }
  function activate() {
    if(dirty||busy)return;
    void run(async () => {
      say('Loading machines…'); settings = await request<Settings>('/settings/hosts');
      fill(settings.hosts[0]);
    });
  };
  function close() { if (canLeave()) { operation++; onClose(); } }
  function canLeave(){if(busy||!discard())return false;dirty=false;return true;}
  el('close-machines').onclick = close;
  form.oninput = () => { dirty = JSON.stringify(draft()) !== savedDraft; operation++; showConnection(); say(); };
  el('add-machine').onclick = () => { if (!busy && discard()) fill(); };
  reload.onclick = () => void run(async () => {
    settings = await request<Settings>('/settings/hosts'); list(); reload.hidden = true;
    say('Machine list reloaded. Your draft has been kept.');
  });
  el('test-machine').onclick = () => {
    if (!form.reportValidity()) return;
    const token = ++operation;
    void run(async () => {
      say('Testing connection…', 'pending');
      const result = await request<{ version: string; sessions: number }>('/settings/hosts/test', 'POST', draft());
      if (token === operation) say(`Connected · ${result.version} · ${result.sessions} session${result.sessions === 1 ? '' : 's'}`, 'success');
    });
  };
  form.onsubmit = event => {
    event.preventDefault();
    void run(async () => {
      say('Saving…', 'pending');
      const host = draft();
      settings = await request<Settings>(selected ? `/hosts/${encodeURIComponent(selected)}` : '/hosts', selected ? 'PUT' : 'POST', { revision: settings.revision, host });
      const saved = selected ? settings.hosts.find(h => h.id === selected) : settings.hosts.at(-1);
      fill(saved); say('Saved. Changes are live.', 'success'); await updateTabs();
    });
  };
  el('remove-machine').onclick = () => { el('remove-machine').hidden = true; el('remove-confirm').hidden = false; };
  el('cancel-remove').onclick = () => { el('remove-machine').hidden = false; el('remove-confirm').hidden = true; };
  el('confirm-remove').onclick = () => {
    if (!selected) return;
    void run(async () => {
      settings = await request<Settings>(`/hosts/${encodeURIComponent(selected!)}`, 'DELETE', { revision: settings.revision });
      fill(settings.hosts[0]); say('Machine removed. Its tmux sessions are still running.', 'success'); await updateTabs();
    });
  };
  return {activate,canLeave};
}
