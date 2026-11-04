export const CLIPBOARD_LIMIT = 128 * 1024 - 32;
const preference = 'cc.clipboard.application-copy';
export function applicationCopyAllowed() { try { return localStorage.getItem(preference) === 'true'; } catch { return false; } }
export async function copyText(text: string) {
  if (text.length > CLIPBOARD_LIMIT || new TextEncoder().encode(text).length > CLIPBOARD_LIMIT) throw new Error('Selection exceeds the 128 KiB clipboard limit.');
  if (navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(text); return; } catch { /* Explicit gestures can use native copy if the async API is blocked. */ } }
  // Explicit copy gestures also work on plain HTTP, without automatic reads.
  const active = document.activeElement as HTMLElement | null;
  const area = document.createElement('textarea'); area.value = text; area.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(area);
  try { area.select(); if (!document.execCommand('copy')) throw new Error('Copy unavailable. Use Shift-drag and the browser’s Copy command.'); }
  finally { area.remove(); active?.focus(); }
}
type Target = { host: string; connection: string; name: string };
export class ClipboardSettings {
  private dialog = document.createElement('dialog');
  private allowed = document.createElement('input');
  private mode = document.createElement('select');
  private feedback = document.createElement('p');
  private apply = document.createElement('button');
  private refresh = document.createElement('button');
  private request = 0;
  private target?: Target;
  private expected = '';
  constructor(onClose: () => void = () => {}) {
    const dialog = this.dialog; dialog.addEventListener('close', onClose); dialog.className = 'clipboard-settings'; dialog.setAttribute('aria-label', 'Terminal clipboard settings');
    const title = document.createElement('h2'); title.textContent = 'Terminal clipboard';
    const help = document.createElement('p'); help.textContent = 'Shift-drag selects text locally. Ctrl+Shift+C copies; Ctrl+Shift+V pastes. Clipboard reads require an explicit paste action. Application requests can only write, never read.';
    this.allowed.type = 'checkbox'; this.allowed.checked = applicationCopyAllowed();
    const label = document.createElement('label'); label.append(this.allowed, ' Allow application copy requests in this browser');
    const explanation = document.createElement('p'); explanation.textContent = 'When allowed, the focused terminal can copy up to 128 KiB from an application to your clipboard. This needs localhost or HTTPS and browser permission. Only a visible, focused CC terminal accepts these requests.';
    this.allowed.onchange = () => { try { localStorage.setItem(preference, String(this.allowed.checked)); } catch { this.allowed.checked = false; this.feedback.textContent = 'Browser storage unavailable; preference was not saved.'; } };
    const serverHelp = document.createElement('p'); serverHelp.textContent = 'tmux must also allow application clipboard requests. This setting affects every session and client on this machine’s configured tmux server. It is not changed automatically or persisted to .tmux.conf.';
    this.mode.setAttribute('aria-label', 'tmux clipboard mode');
    for (const [value, text] of [['on', 'On — accept application copy requests'], ['external', 'External — tmux copy only'], ['off', 'Off']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; this.mode.append(option); }
    this.apply.textContent = 'Apply tmux setting'; this.refresh.textContent = 'Refresh status';
    this.feedback.setAttribute('role', 'status');
    const close = document.createElement('button'); close.textContent = 'Close'; close.onclick = () => dialog.close();
    this.refresh.onclick = () => { void this.load(); };
    this.apply.onclick = () => { void this.save(); };
    dialog.append(title, help, label, explanation, serverHelp, this.mode, this.apply, this.refresh, this.feedback, close); document.body.append(dialog);
  }
  open(target: Target) { this.target = target; this.allowed.checked = applicationCopyAllowed(); this.dialog.showModal(); void this.load(); }
  private async load() {
    const target = this.target; if (!target) return; const request = ++this.request;
    this.apply.disabled = true; this.feedback.textContent = 'Reading tmux clipboard setting…';
    try {
      const query = new URLSearchParams({connection_revision: target.connection});
      const response = await fetch(`/api/v1/hosts/${encodeURIComponent(target.host)}/clipboard?${query}`, {signal: AbortSignal.timeout(14000)});
      const data = await response.json(); if (request !== this.request) return;
      if (!response.ok) throw new Error(data.error || 'Clipboard setting unavailable');
      this.expected = data.mode; this.mode.value = data.mode; this.apply.disabled = false;
      this.feedback.textContent = `${target.name} · tmux set-clipboard ${data.mode}`;
    } catch (error) { if (request === this.request) this.feedback.textContent = String(error); }
  }
  private async save() {
    const target = this.target; if (!target || this.apply.disabled) return;
    const request = ++this.request; this.apply.disabled = true; this.refresh.disabled = true; this.mode.disabled = true;
    this.feedback.textContent = 'Applying tmux setting…';
    try {
      const response = await fetch(`/api/v1/hosts/${encodeURIComponent(target.host)}/clipboard`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connection_revision:target.connection,expected_mode:this.expected,mode:this.mode.value}),signal:AbortSignal.timeout(14000)});
      const data = await response.json(); if (request !== this.request) return;
      if (!response.ok) throw new Error(data.error || 'Clipboard setting failed');
      this.expected = data.mode; this.apply.disabled = false; this.feedback.textContent = `${target.name} · tmux set-clipboard ${data.mode} · saved`;
    } catch (error) { if (request === this.request) this.feedback.textContent = `${String(error)} Refresh status before applying again; the setting may have changed.`; }
    finally { if (request === this.request) { this.refresh.disabled = false; this.mode.disabled = false; } }
  }
}
