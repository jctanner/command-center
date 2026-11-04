// Command Center's passive native pi bridge. No prompts, tools or message text.
import { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

type Context = { cwd: string; isIdle(): boolean; hasPendingMessages(): boolean; sessionManager: { getSessionId(): string; getSessionFile(): string | undefined; getLeafId(): string | null } };
type Pi = { on(name: string, handler: (event: unknown, ctx: Context) => void): unknown };
export default function commandCenter(pi: Pi) {
  let context: Context | undefined, timer: ReturnType<typeof setInterval> | undefined;
  let state = 'unknown', transition = randomUUID(), running = false, prompts = 0;
  const directory = resolve(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent'), 'command-center-status');
  const file = join(directory, `${process.pid}.json`), temporary = `${file}.${randomUUID()}.tmp`;
  const processStart = () => readFileSync('/proc/self/stat', 'utf8').split(') ').slice(1).join(') ').split(' ')[19];
  const publish = () => {
    if (!context) return;
    try {
      const record = { schema: 1, pid: process.pid, proc_start: processStart(), boot_id: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
        cwd: resolve(context.cwd), tmux_pane: process.env.TMUX_PANE || '', session_id: context.sessionManager.getSessionId(),
        session_file: context.sessionManager.getSessionFile() || null, leaf_id: context.sessionManager.getLeafId(),
        state, transition, updated_at: Date.now() / 1000 };
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      writeFileSync(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
      renameSync(temporary, file);
    } catch { try { unlinkSync(temporary); } catch { /* stale/unsupported process: CC fails closed */ } }
  };
  const update = (next: string, ctx: Context) => { context = ctx; if (next !== state) { state = next; transition = randomUUID(); } publish(); };
  pi.on('session_start', (_event, ctx) => {
    context = ctx; running = false; prompts = 0;
    update(ctx.isIdle() && !ctx.hasPendingMessages() ? 'ready' : 'unknown', ctx);
    if (timer) clearInterval(timer);
    timer = setInterval(publish, 5000); timer.unref();
  });
  pi.on('before_agent_start', (_event, ctx) => { running = true; update(prompts ? 'waiting' : 'working', ctx); });
  pi.on('agent_start', (_event, ctx) => { running = true; update(prompts ? 'waiting' : 'working', ctx); });
  // agent_end is deliberately ignored: retries and queued continuations follow it.
  pi.on('agent_settled', (_event, ctx) => { running = false; update(prompts ? 'waiting' : 'ready', ctx); });
  pi.on('ui_prompt_start', (_event, ctx) => { prompts++; update('waiting', ctx); });
  pi.on('ui_prompt_end', (_event, ctx) => { prompts = Math.max(0, prompts - 1); update(prompts ? 'waiting' : running ? 'working' : ctx.isIdle() && !ctx.hasPendingMessages() ? 'ready' : 'unknown', ctx); });
  pi.on('session_shutdown', () => {
    if (timer) clearInterval(timer); timer = undefined; context = undefined;
    try { unlinkSync(file); } catch { /* already removed */ }
  });
}
