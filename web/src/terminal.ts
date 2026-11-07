import {onThemeChange,terminalTheme} from './themes';
import { applicationCopyAllowed, copyText, CLIPBOARD_LIMIT } from './clipboard';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

// The backend only speaks terminal bytes and dimensions. Keep renderer-specific
// APIs here so a libghostty-based renderer can be evaluated independently.
export interface TerminalView {
  readonly cols: number;
  readonly rows: number;
  write(data: Uint8Array, done: () => void): void;
  focus(): void;
  fit(): void;
  hasSelection(): boolean;
  copySelection(): Promise<void>;
  pasteClipboard(): Promise<void>;
  cellAt(event: MouseEvent): { col: number; row: number } | undefined;
  dispose(): void;
}
export function createTerminal(
  container: HTMLElement,
  onInput: (data: Uint8Array) => void,
  onResize: (cols: number, rows: number) => void,
  clipboardTarget: () => string | undefined,
  report: (message: string) => void,
): TerminalView {
  const terminal = new Terminal({
    cursorBlink: true, fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
    fontSize: 14, lineHeight: 1.18, scrollback: 5000, allowProposedApi: false,
    theme: terminalTheme(),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(container);
  const stopTheme=onThemeChange(()=>{terminal.options.theme=terminalTheme();});
  const encoder = new TextEncoder();
  const data = terminal.onData(text => onInput(encoder.encode(text)));
  const binary = terminal.onBinary(text => onInput(Uint8Array.from(text, c => c.charCodeAt(0))));
  const resize = terminal.onResize(({ cols, rows }) => onResize(cols, rows));
  let disposed = false;
  const copySelection = async () => { const text = terminal.getSelection(); if (!text) throw new Error('Select terminal text first: hold Shift while dragging.'); await copyText(text); };
  const pasteClipboard = async () => {
    const target = clipboardTarget();
    if (!target || disposed) throw new Error('Terminal is not ready for paste.');
    if (!navigator.clipboard?.readText) throw new Error('Clipboard access needs localhost or HTTPS. Use Ctrl+Shift+V or Shift+Insert to paste.');
    const text = await navigator.clipboard.readText();
    if (disposed || clipboardTarget() !== target) throw new Error('Terminal target changed; paste was not sent.');
    if (text.length > CLIPBOARD_LIMIT || encoder.encode(text).length > CLIPBOARD_LIMIT) throw new Error('Paste exceeds the 128 KiB clipboard limit; nothing was sent.');
    terminal.paste(text); // Preserve bracketed paste; never append Enter.
    terminal.focus();
  };
  const attempt = (action: () => Promise<void>) => { void action().catch(error => report(String(error))); };
  terminal.attachCustomKeyEventHandler(event => {
    const key = event.key.toLowerCase();
    const copy = key === 'c' && !event.altKey && ((event.ctrlKey && event.shiftKey) || event.metaKey || (event.ctrlKey && terminal.hasSelection()));
    const paste = key === 'v' && !event.altKey && ((event.ctrlKey && event.shiftKey) || event.metaKey);
    if (!copy && !paste) return true;
    // Let the browser generate its native paste event. This works on plain HTTP
    // and does not require programmatic clipboard-read permission.
    if (paste) return false;
    // Reserve both down/up so extended keyboard protocols cannot leak shortcuts.
    event.preventDefault();
    if (event.type === 'keydown' && !event.repeat) attempt(copySelection);
    return false;
  });
  // SGR hover reports count as input in xterm and otherwise erase a local
  // selection before the pointer can reach Copy. A deliberate click/key still
  // returns control to the application; dragging keeps normal selection logic.
  const preserveSelection = (event: MouseEvent) => { if (terminal.hasSelection() && event.buttons === 0) event.stopImmediatePropagation(); };
  container.addEventListener('mousemove', preserveSelection, true);
  const appCopy = terminal.parser.registerOscHandler(52, value => {
    const separator = value.indexOf(';'); if (separator < 0) return true;
    const selection = value.slice(0, separator), payload = value.slice(separator + 1);
    // OSC 52 queries never read or expose the host clipboard.
    if (!['', 'c'].includes(selection) || !payload || payload === '?' || payload.length > Math.ceil(CLIPBOARD_LIMIT / 3) * 4) return true;
    if (disposed || !applicationCopyAllowed() || !clipboardTarget() || !document.hasFocus() || !container.contains(document.activeElement)) return true;
    try {
      const bytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
      if (bytes.length > CLIPBOARD_LIMIT) return true;
      const text = new TextDecoder('utf-8', {fatal:true}).decode(bytes);
      if (!navigator.clipboard?.writeText) { report('Application copy needs localhost or HTTPS. Manual selection and copy remain available.'); return true; }
      void navigator.clipboard.writeText(text).catch(() => report('Application copy was blocked by the browser. Check clipboard permissions.'));
    } catch { /* Ignore malformed/unsupported application clipboard data. */ }
    return true;
  });
  const fitTerminal = () => {
    if (!container.getClientRects().length || container.clientWidth <= 0 || container.clientHeight <= 0) return;
    const proposed = fit.proposeDimensions();
    if (proposed && proposed.cols > 0 && proposed.rows > 0) terminal.resize(Math.min(500, Math.max(10, proposed.cols)), Math.min(300, Math.max(2, proposed.rows)));
  };
  let frame = 0;
  const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fitTerminal); });
  observer.observe(container);
  fitTerminal();
  return {
    get cols() { return terminal.cols; }, get rows() { return terminal.rows; },
    write: (bytes, done) => terminal.write(bytes, done), focus: () => terminal.focus(), fit: fitTerminal,
    hasSelection: () => terminal.hasSelection(), copySelection, pasteClipboard,
    cellAt(event) {
      const rect = container.querySelector('.xterm-screen')?.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;
      const col = Math.floor((event.clientX - rect.left) / (rect.width / terminal.cols));
      const row = Math.floor((event.clientY - rect.top) / (rect.height / terminal.rows));
      if (col < 0 || col >= terminal.cols || row < 0 || row >= terminal.rows) return;
      return { col, row };
    },
    dispose() { disposed = true; stopTheme(); container.removeEventListener('mousemove', preserveSelection, true); appCopy.dispose(); observer.disconnect(); cancelAnimationFrame(frame); data.dispose(); binary.dispose(); resize.dispose(); terminal.dispose(); },
  };
}
