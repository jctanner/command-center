// Browser-local preferences and opaque event receipts; no conversation copies.
export type Notice = { scope: string; tokens: string[]; title: string; body: string; open: () => void; reading: boolean };
const preference = 'cc.notifications.enabled';
const receipts = 'cc.notifications.receipts';
const muted = 'cc.notifications.muted';
function read(key: string): string[] { try { const v: unknown = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(-512) : []; } catch { return []; } }
export class AgentNotifications {
  private previous = new Map<string, string[]>();
  private initialized = false;
  private problem = '';
  enabled() { try { return localStorage.getItem(preference) === 'true'; } catch { return false; } }
  available() { return isSecureContext && 'Notification' in window && !!navigator.locks; }
  status() {
    if (!this.available()) return 'Desktop notifications need a supported browser on localhost or HTTPS.';
    if (Notification.permission === 'denied') return 'Notifications are blocked. Change this site’s browser permissions to enable them.';
    if (this.problem) return this.problem;
    return this.enabled() && Notification.permission === 'granted' ? 'On while a Command Center tab is open. Background delivery may be delayed by the browser.' : 'Off. Enable notifications to receive new replies, completion updates and approval requests. Existing attention is not announced.';
  }
  async enable() {
    if (!this.available()) return;
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        try { localStorage.setItem(preference, 'true'); this.problem = ''; } catch { this.problem = 'Browser storage is unavailable; notifications could not be enabled.'; }
      }
    } catch { this.problem = 'Browser notification permission could not be requested.'; }
  }
  disable() { try { localStorage.removeItem(preference); } catch { /* preferences unavailable */ } }
  isMuted(scope: string) { return read(muted).includes(scope); }
  toggleMute(scope: string) {
    const values = read(muted); const next = values.includes(scope) ? values.filter(v => v !== scope) : [...values, scope];
    try { localStorage.setItem(muted, JSON.stringify(next.slice(-256))); } catch { this.problem = 'Browser storage is unavailable; mute could not be saved.'; }
  }
  async observe(notices: Notice[]) {
    const fresh = new Map<string, string[]>();
    for (const notice of notices) {
      const previous = this.previous.get(notice.scope);
      fresh.set(notice.scope, notice.tokens);
      // Baseline initial inventory and newly discovered processes, even if unread.
      const changed = previous ? notice.tokens.filter(token => !previous.includes(token)) : [];
      if (!this.initialized || !changed.length || !this.available() || !this.enabled() || Notification.permission !== 'granted') continue;
      try {
        await navigator.locks.request('cc-agent-notifications', () => {
          const seen = read(receipts);
          const unseen = changed.filter(token => !seen.includes(token));
          if (!unseen.length) return;
          // Claim before showing, shared across tabs and reloads. Never replay an
          // uncertain notification; silenced/read events are consumed as well.
          localStorage.setItem(receipts, JSON.stringify([...seen, ...unseen].slice(-512)));
          if (!this.enabled() || this.isMuted(notice.scope) || notice.reading) return;
          const notification = new Notification(notice.title, { body: notice.body, tag: notice.scope });
          notification.onclick = () => { notification.close(); window.focus(); notice.open(); };
        });
      } catch { this.problem = 'Notifications could not be delivered. Check browser permissions and storage.'; }
    }
    this.previous = fresh; this.initialized = true;
  }
}
