import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync, existsSync, writeFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

let dir: string, socket: string, backend: ChildProcess, base: string, configFile: string;
function tmux(...args: string[]) {
  const result = spawnSync('tmux', ['-S', socket, ...args], { encoding: 'utf8', env: { ...process.env, TMUX: '' } });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cc-browser-')); socket = join(dir, 'tmux.sock');
  tmux('-f', '/dev/null', 'new-session', '-d', '-s', 'project', '-x', '120', '-y', '35');
  tmux('rename-window', '-t', 'project:0', 'workspace');
  tmux('split-window', '-h', '-t', 'project:0');
  tmux('new-window', '-d', '-t', 'project', '-n', 'logs');
  const port = await new Promise<number>(resolvePort => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const port = (s.address() as { port: number }).port; s.close(() => resolvePort(port)); }); });
  base = `http://127.0.0.1:${port}`;
  const config = join(dir, 'config.toml'); configFile = config;
  writeFileSync(config, `[[hosts]]\nid="test"\nname="Test machine"\nsocket=${JSON.stringify(socket)}\n\n[[hosts]]\nid="offline"\nname="Offline machine"\nsocket=${JSON.stringify(join(dir, 'missing.sock'))}\n`);
  backend = spawn(resolve(process.env.CC_BINARY || '../target/debug/command-center'), ['--listen', `127.0.0.1:${port}`, '--config', config, '--web-dir', resolve(process.env.CC_WEB_DIR || 'dist')], { stdio: 'pipe' });
  backend.stderr?.on('data', data => process.stderr.write(data));
  await expect.poll(async () => { try { return (await fetch(`${base}/api/v1/health`)).status; } catch { return 0; } }).toBe(200);
});
test.afterAll(async () => {
  backend?.kill('SIGTERM');
  if (socket) spawnSync('tmux', ['-S', socket, 'kill-server']);
  if (dir) rmSync(dir, { recursive: true, force: true });
});
test('tabbed terminal input, pane context menu, external zoom, switching, refresh, and compact navigation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await expect(page.getByRole('button', { name: 'Test machine', exact: true })).toBeVisible();
  await expect(page.locator('#connection')).toHaveText('Attached');
  await expect(page.locator('.pane-control')).toHaveCount(2);
  const viewport = page.locator('.xterm-viewport');
  await expect(viewport).toHaveCSS('overflow-x', 'hidden');
  await expect(viewport).toHaveCSS('overflow-y', 'scroll');
  const pane = tmux('display-message', '-p', '-t', 'project:0', '#{pane_id}');
  await page.locator('.xterm-helper-textarea').focus();
  await page.keyboard.type("printf 'CC_BROWSER_%s\\n' WORKS"); await page.keyboard.press('Enter');
  await expect.poll(() => tmux('capture-pane', '-p', '-t', pane)).toContain('CC_BROWSER_WORKS');
  await expect(page.locator('.xterm-rows')).toContainText('CC_BROWSER_WORKS');
  const screen = page.locator('.xterm-screen'); const rect = (await screen.boundingBox())!;
  await page.mouse.click(rect.x + 25, rect.y + 25, { button: 'right' });
  await expect(page.getByRole('button', { name: 'Maximize pane', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Maximize pane', exact: true }).click();
  await expect.poll(() => tmux('display-message', '-p', '-t', 'project:0', '#{window_zoomed_flag}')).toBe('1');
  await expect(page.getByRole('button', { name: /^Restore pane/ })).toBeVisible();
  tmux('resize-pane', '-Z', '-t', 'project:0');
  await expect(page.getByRole('button', { name: /^Restore pane/ })).toHaveCount(0);
  await page.getByRole('button', { name: /^1\s+logs$/ }).click();
  await expect(page.locator('.pane-control')).toHaveCount(1);
  expect(tmux('display-message', '-p', '-t', 'project', '#{window_name}')).toBe('workspace');
  if (spawnSync('vim', ['--version']).status === 0) {
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('vim -Nu NONE -i NONE -n'); await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('VIM - Vi IMproved');
    await page.keyboard.press('i'); await page.keyboard.insertText('Command Center — café 日本語');
    await expect(page.locator('.xterm-rows')).toContainText('Command Center — café 日本語');
    await page.keyboard.press('Escape'); await page.keyboard.type(':q!'); await page.keyboard.press('Enter');
    await page.keyboard.type("printf 'CC_VIM_%s\\n' EXITED"); await page.keyboard.press('Enter');
    await expect(page.locator('.xterm-rows')).toContainText('CC_VIM_EXITED');
  }

  await page.reload();
  await expect(page.locator('#connection')).toHaveText('Attached');
  await expect(page.getByRole('button', { name: /^1\s+logs$/ })).toHaveAttribute('aria-current', 'true');
  await page.getByRole('button', { name: /^0\s+workspace$/ }).click();
  await expect(page.locator('.pane-control')).toHaveCount(2);
  await page.screenshot({ path: '../test-results/command-center-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#show-terminal')).toBeHidden();
  await expect(page.locator('#queue-pane')).toBeVisible();
  await expect(page.locator('#terminal-pane')).toBeHidden();
  await page.screenshot({ path: '../test-results/command-center-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('#show-terminal').click();
  await expect(page.locator('#connection')).toHaveText('Attached');
  await page.getByRole('button', { name: 'Offline machine', exact: true }).click();
  await expect(page.locator('#empty')).toContainText('No tmux sessions');
  await page.getByRole('button', { name: 'Test machine', exact: true }).click();
  await expect(page.locator('#connection')).toHaveText('Attached');
  expect(errors).toEqual([]);
});

// This smoke benchmark includes browser automation overhead. It reports an
// initial local baseline; WAN and direct SSH comparisons are separate work.
test('measure local echo, window switching, and reconnect latency', async ({ page }, testInfo) => {
  await page.goto(base); await expect(page.locator('#connection')).toHaveText('Attached');
  await page.getByRole('button', { name: /^1\s+logs$/ }).click();
  await expect(page.locator('.pane-control')).toHaveCount(1);
  const echoes: number[] = [];
  for (let i = 0; i < 10; i++) {
    const marker = `CC_LATENCY_${i}`;
    await page.evaluate(marker => {
      const target = document.querySelector('.xterm-rows')!;
      (window as unknown as { ccMeasure: Promise<number> }).ccMeasure = new Promise((resolve, reject) => {
        const started = performance.now();
        const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('echo timed out')); }, 5000);
        const observer = new MutationObserver(() => {
          if (target.textContent?.includes(marker)) { clearTimeout(timeout); observer.disconnect(); resolve(performance.now() - started); }
        });
        observer.observe(target, { childList: true, subtree: true, characterData: true });
      });
    }, marker);
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.insertText(`printf 'CC_LATENCY_%s\n' ${i}`); await page.keyboard.press('Enter');
    echoes.push(await page.evaluate(() => (window as unknown as { ccMeasure: Promise<number> }).ccMeasure));
  }
  const switches: number[] = [];
  for (let i = 0; i < 10; i++) {
    switches.push(await page.evaluate(i => new Promise<number>((resolve, reject) => {
      const expected = i % 2 === 0 ? 2 : 1;
      const observer = new MutationObserver(() => {
        if (document.querySelectorAll('.pane-control').length === expected) { clearTimeout(timeout); observer.disconnect(); resolve(performance.now() - started); }
      });
      const started = performance.now();
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('window switch timed out')); }, 5000);
      observer.observe(document.querySelector('#panes')!, { childList: true });
      const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#windows button'));
      buttons.find(b => b.textContent?.includes(i % 2 === 0 ? 'workspace' : 'logs'))!.click();
    }), i));
  }
  const reconnect = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const target = document.querySelector('#connection')!, started = performance.now();
    const observer = new MutationObserver(() => {
      if (target.textContent === 'Attached') { clearTimeout(timeout); observer.disconnect(); resolve(performance.now() - started); }
    });
    const timeout = setTimeout(() => { observer.disconnect(); reject(new Error('reconnect timed out')); }, 10000);
    observer.observe(target, { childList: true, subtree: true });
    (document.querySelector('#reconnect') as HTMLButtonElement).click();
  }));
  const summarize = (values: number[]) => { const sorted = values.toSorted((a,b) => a-b); return { median_ms: Math.round(sorted[Math.floor(sorted.length / 2)]), p95_ms: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]), samples: values.map(v => Math.round(v)) }; };
  const metrics = { binary: process.env.CC_BINARY || 'debug', echo: summarize(echoes), window_switch: summarize(switches), reconnect_ms: Math.round(reconnect), backend_rss_kib: Number(spawnSync('ps', ['-o', 'rss=', '-p', String(backend.pid)], { encoding: 'utf8' }).stdout.trim()) };
  console.log('Local performance baseline:', JSON.stringify(metrics));
  await testInfo.attach('performance.json', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' });
});


test('manage machines live across browsers without reconnecting unaffected terminals', async ({ page, context }) => {
  test.setTimeout(60000);
  page.on('pageerror', error => console.log('Management page error:', error.message));
  const peer = await context.newPage();
  await page.goto(base); await peer.goto(base);
  await expect(page.locator('#connection')).toHaveText('Attached');
  await expect(peer.locator('#connection')).toHaveText('Attached');
  let connections = 0; page.on('websocket', ws => { if (ws.url().includes('/terminal?')) connections++; });
  let peerConnections = 0; peer.on('websocket', ws => { if (ws.url().includes('/terminal?')) peerConnections++; });
  const pids = tmux('list-panes', '-s', '-t', 'project', '-F', '#{pane_pid}');
  await page.getByRole('button', { name: 'Machines', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Machines', exact: true });
  await dialog.getByLabel('Display name', { exact: true }).fill('Renamed machine');
  await dialog.getByRole('button', { name: 'Save machine', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved. Changes are live.');
  await expect(page.locator('#machines').getByRole('button', { name: 'Renamed machine', exact: true })).toBeVisible();
  await expect(peer.locator('#machines').getByRole('button', { name: 'Renamed machine', exact: true })).toBeVisible();
  expect(readFileSync(configFile, 'utf8')).toContain('name = "Renamed machine"');
  expect(connections).toBe(0); expect(peerConnections).toBe(0);

  await dialog.getByRole('button', { name: '+ Add machine', exact: true }).click();
  await dialog.getByLabel('Display name', { exact: true }).fill('Extra local');
  await dialog.getByText('Advanced settings', { exact: true }).click();
  await dialog.getByLabel('tmux socket path', { exact: true }).fill(socket);
  await dialog.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Connected · tmux');
  await dialog.getByRole('button', { name: 'Save machine', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved. Changes are live.');
  await expect(peer.locator('#machines').getByRole('button', { name: 'Extra local', exact: true })).toBeVisible();
  expect(connections).toBe(0); expect(peerConnections).toBe(0);
  // Only clients of an edited endpoint reconnect; a different machine stays live.
  const observer = await context.newPage();
  await observer.goto(base);
  await expect(observer.locator('#connection')).toHaveText('Attached');
  await observer.locator('#machines').getByRole('button', { name: 'Extra local', exact: true }).click();
  await expect(observer.locator('#connection')).toHaveText('Attached');
  let unrelatedConnections = 0; observer.on('websocket', ws => { if (ws.url().includes('/terminal?')) unrelatedConnections++; });
  await dialog.getByRole('navigation', { name: 'Configured machines' }).getByRole('button', { name: 'Renamed machine', exact: true }).click();
  const alternateSocket = join(dir, 'tmux-alias.sock'); symlinkSync(socket, alternateSocket);
  await dialog.getByLabel('tmux socket path', { exact: true }).fill(alternateSocket);
  await dialog.getByRole('button', { name: 'Save machine', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved. Changes are live.');
  await expect(page.locator('#connection')).toHaveText('Attached');
  await expect(peer.locator('#connection')).toHaveText('Attached');
  expect(connections).toBe(1); expect(peerConnections).toBe(1); expect(unrelatedConnections).toBe(0);
  expect(tmux('list-panes', '-s', '-t', 'project', '-F', '#{pane_pid}')).toBe(pids);
  connections = 0; peerConnections = 0;
  await observer.close();
  await dialog.getByRole('navigation', { name: 'Configured machines' }).getByRole('button', { name: 'Extra local', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '../test-results/machine-settings-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: '../test-results/machine-settings-desktop.png' });
  await dialog.locator('#remove-machine').click();
  await dialog.locator('#confirm-remove').click();
  await expect(dialog.locator('#save-machine')).toBeEnabled();
  await expect(peer.locator('#machines').getByRole('button', { name: 'Extra local', exact: true })).toHaveCount(0);
  expect(tmux('list-panes', '-s', '-t', 'project', '-F', '#{pane_pid}')).toBe(pids);

  // Two editors share a revision; stale saves keep their draft and cannot win.
  await peer.getByRole('button', { name: 'Machines', exact: true }).click();
  const peerDialog = peer.getByRole('dialog', { name: 'Machines', exact: true });
  await expect(peerDialog.getByLabel('Display name', { exact: true })).toHaveValue('Renamed machine');
  await peerDialog.getByLabel('Display name', { exact: true }).fill('Stale draft');
  await dialog.getByLabel('Display name', { exact: true }).fill('Newest alias');
  await dialog.getByRole('button', { name: 'Save machine', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('Saved. Changes are live.');
  await peerDialog.getByRole('button', { name: 'Save machine', exact: true }).click();
  await expect(peerDialog.getByRole('status')).toContainText('changed in another browser');
  await expect(peerDialog.getByLabel('Display name', { exact: true })).toHaveValue('Stale draft');
  expect(readFileSync(configFile, 'utf8')).toContain('Newest alias');
  peer.once('dialog', d => d.accept());
  await peerDialog.getByRole('button', { name: 'Close machine settings', exact: true }).click();
  expect(connections).toBe(0); expect(peerConnections).toBe(0);

  // Mutations require Origin, even for nonbrowser clients.
  const settings = await (await page.request.get(`${base}/api/v1/settings/hosts`)).json();
  const denied = await page.request.delete(`${base}/api/v1/hosts/test`, { data: { revision: settings.revision } });
  expect(denied.status()).toBe(403);
  // Removing the active host switches clients away without killing any panes.
  await dialog.locator('#remove-machine').click();
  await dialog.locator('#confirm-remove').click();
  await expect(dialog.locator('#save-machine')).toBeEnabled();
  await expect(peer.locator('#machines').getByRole('button', { name: 'Newest alias', exact: true })).toHaveCount(0);
  expect(tmux('list-panes', '-s', '-t', 'project', '-F', '#{pane_pid}')).toBe(pids);
  await dialog.locator('#remove-machine').click();
  await dialog.locator('#confirm-remove').click();
  await expect(dialog.locator('#save-machine')).toBeEnabled();
  await expect(peer.locator('#empty')).toContainText('Add a machine');
  await expect(dialog.getByRole('status')).toHaveText('Machine removed. Its tmux sessions are still running.');
  expect(readFileSync(configFile, 'utf8')).toContain('hosts = []');
  await dialog.getByRole('button', { name: 'Close machine settings', exact: true }).click();
  await page.getByRole('button', { name: 'Machines', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Display name', { exact: true }).fill('Restored machine');
  if (!(await dialog.getByLabel('tmux socket path').isVisible())) await dialog.getByText('Advanced settings', { exact: true }).click();
  await dialog.getByLabel('tmux socket path').fill(socket);
  await dialog.getByRole('button', { name: 'Save machine', exact: true }).click();
  await expect(peer.locator('#connection')).toHaveText('Attached');
  await dialog.getByRole('button', { name: 'Close machine settings', exact: true }).click();
  await peer.close();
});

test('AI Queue is independent of terminal tabs and opens the exact pane', async ({ page }) => {
  const pane = tmux('display-message', '-p', '-t', 'project:0', '#{pane_id}');
  const window = tmux('display-message', '-p', '-t', 'project:0', '#{window_id}');
  const session = tmux('display-message', '-p', '-t', 'project', '#{session_id}');
  const hosts = await (await fetch(`${base}/api/v1/hosts`)).json();
  const host = hosts.find((h: {remote: boolean}) => !h.remote);
  await page.route('**/api/v1/queue', route => route.fulfill({ json: { checked_at: Math.floor(Date.now()/1000), hosts: [{...host, items: [{id:'request-one', session, session_name:'project', window, window_name:'workspace', pane, project:'/test/project', agent:'codex', prompt:'Would you like to run this command?', context:'Would you like to run this command?\n1. Yes\n2. No\nEsc to cancel'}]}] } }));
  await page.goto(base);
  await expect(page.locator('#connection')).toHaveText('Attached');
  await page.locator('#show-queue').click();
  await expect(page.locator('#machines')).toBeHidden();
  await expect(page.locator('.queue-card')).toHaveCount(1);
  await expect(page.getByRole('region', {name:'Request details'})).toContainText('/test/project');
  await page.getByRole('button', {name:'Open terminal', exact:true}).click();
  await expect(page.locator('#queue-pane')).toBeHidden();
  await expect(page).toHaveURL(/#\/terminal$/);
  await expect.poll(() => tmux('display-message', '-p', '-t', `project:${window}.${pane}`, '#{window_zoomed_flag}')).toBe('1');
  await page.locator('#show-queue').click();
  await expect(page.locator('.queue-card[aria-pressed=true]')).toContainText('Would you like');
  await expect(page).toHaveURL(/#\/queue$/);
  await page.reload();
  await expect(page.locator('#queue-pane')).toBeVisible();
  await expect(page.locator('#terminal-pane')).toBeHidden();
});

test('compact clients never attach a viewer or constrain a desktop terminal', async ({page,browser}) => {
  await page.goto(base);await expect(page.locator('#connection')).toHaveText('Attached');
  const dimensions=()=>tmux('display-message','-p','-t','project:0','#{window_width}x#{window_height}');
  const pids=tmux('list-panes','-s','-t','project','-F','#{pane_pid}');
  const original=dimensions();
  const viewers=()=>tmux('list-sessions','-F','#{session_name}').split('\n').filter(s=>s.startsWith('cc-view-')).length;
  await expect.poll(viewers).toBe(1);
  const phone=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  let sockets=0;phone.on('websocket',ws=>{if(ws.url().includes('/terminal?'))sockets++;});
  await phone.goto(base);
  await expect(phone.locator('#show-queue')).toHaveAttribute('aria-pressed','true');
  await expect(phone.locator('#show-terminal')).toBeHidden();
  await expect(phone.locator('#connection')).toHaveText('Connected');
  expect(sockets).toBe(0);expect(viewers()).toBe(1);expect(dimensions()).toBe(original);
  await phone.getByRole('button',{name:'Files',exact:true}).click();
  await expect(phone.getByLabel('File browser machine',{exact:true})).toBeVisible();
  await expect(phone.locator('#terminal-pane')).toBeHidden();
  await expect(phone.locator('.workspace-bar')).toBeHidden();
  await phone.getByRole('button',{name:'Agents',exact:false}).click();
  await expect(phone.locator('#queue-pane')).toBeVisible();
  await phone.setViewportSize({width:932,height:430});
  await expect(phone.locator('#show-terminal')).toBeHidden();
  await phone.reload();await expect(phone.locator('#connection')).toHaveText('Connected');
  // Even programmatic activation of the hidden action must not attach.
  await phone.locator('#show-terminal').evaluate(element=>element.click());
  expect(sockets).toBe(0);expect(viewers()).toBe(1);expect(dimensions()).toBe(original);
  await phone.close();
  // Shrinking an already attached browser detaches before it can resize tmux.
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#queue-pane')).toBeVisible();
  await expect.poll(viewers).toBe(0);
  expect(tmux('list-panes','-s','-t','project','-F','#{pane_pid}')).toBe(pids);
  await page.setViewportSize({width:1440,height:900});
  await expect(page.locator('#show-terminal')).toBeVisible();
  expect(viewers()).toBe(0);
  await page.locator('#show-terminal').click();await expect(page.locator('#connection')).toHaveText('Attached');
  await expect.poll(viewers).toBe(1);
  expect(tmux('list-panes','-s','-t','project','-F','#{pane_pid}')).toBe(pids);
});


test('an empty machine can create its first session and window tabs can be renamed without replacing panes',async({page})=>{
 test.setTimeout(60000);
 const coldSocket=join(dir,'cold-start.sock');
 const settings=await(await fetch(base+'/api/v1/settings/hosts')).json();
 const added=await fetch(base+'/api/v1/hosts',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({revision:settings.revision,host:{name:'Cold machine',socket:coldSocket,ssh:null,ssh_config:null}})});expect(added.status).toBe(200);
 const coldId=(await added.json()).hosts.find((h:{name:string})=>h.name==='Cold machine').id;
 await page.goto(base);await page.getByRole('button',{name:'Cold machine',exact:true}).click();
 await expect(page.locator('#empty')).toContainText('No tmux sessions');
 await page.locator('#empty').getByRole('button',{name:'New session',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'New tmux session',exact:true});
 await dialog.getByRole('textbox',{name:'Tmux name',exact:true}).fill('boot-work');
 await dialog.getByRole('button',{name:'Create session',exact:true}).click();await expect(dialog).toBeHidden();
 await expect(page.locator('#connection')).toHaveText('Attached',{timeout:15000});
 const cold=(...args:string[])=>{const r=spawnSync('tmux',['-S',coldSocket,...args],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
 try {
  expect(cold('display-message','-p','-t','boot-work','#{pane_current_path}')).toBe(process.env.HOME);
  const target=cold('display-message','-p','-t','boot-work','#{window_id}'), pid=cold('display-message','-p','-t','boot-work','#{pane_pid}');
  const tab=page.locator('#windows button').first();await tab.click({button:'right'});
  await page.getByRole('button',{name:'Rename window…',exact:true}).click();
  const rename=page.getByRole('dialog',{name:'Rename tmux window',exact:true});
  const marker=join(dir,'window-injection-marker');
  const name=`Review ' café #{window_id} #(touch ${marker})`;
  await rename.getByRole('textbox',{name:'Tmux name',exact:true}).fill(name);await rename.getByRole('button',{name:'Rename window',exact:true}).click();await expect(rename).toBeHidden();
  await expect(page.locator('#windows button').first()).toContainText(name);
  expect(cold('display-message','-p','-t',target,'#{window_name}')).toBe(name);
  expect(cold('display-message','-p','-t',target,'#{pane_pid}')).toBe(pid);
  expect(cold('show-options','-w','-v','-t',target,'automatic-rename')).toBe('off');
  expect(existsSync(marker)).toBe(false);
  // Keyboard users get the same menu without changing the selected window.
  await page.locator('#windows button').first().focus();await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('button',{name:'Rename window…',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  const hosts=await(await fetch(base+'/api/v1/hosts')).json(),revision=hosts.find((h:{id:string})=>h.id===coldId).connection_revision;
  const send=(path:string,body:object)=>fetch(base+'/api/v1/hosts/'+coldId+'/'+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
  expect((await send('sessions',{connection_revision:revision,name:'boot-work'})).status).toBe(409);
  expect((await send('windows/rename',{connection_revision:revision,session:cold('display-message','-p','-t','boot-work','#{session_id}'),window:target,expected_name:'stale name',name:'wrong'})).status).toBe(409);
 } finally {spawnSync('tmux',['-S',coldSocket,'kill-server']);}
});


test('renumber inserts windows in either direction, preserves processes and rejects stale numbering',async({page})=>{
 const sid=tmux('new-session','-d','-P','-F','#{session_id}','-s','renumber','-n','one','/bin/sleep','86400');
 tmux('move-window','-s',sid+':0','-t',sid+':1');
 for(const [index,name] of [[2,'two'],[3,'three'],[4,'CC']] as const)tmux('new-window','-d','-t',sid+':'+index,'-n',name,'/bin/sleep','86400');
 const windows=()=>tmux('list-windows','-t',sid,'-F','#{window_id} #{window_index} #{window_name}').split('\n').map(s=>s.split(' '));
 const original=windows(), cc=original.find(w=>w[2]==='CC')![0];
 const pids=()=>tmux('list-panes','-s','-t',sid,'-F','#{pane_id} #{pane_pid}').split('\n').sort();const before=pids();
 tmux('select-window','-t',sid+':'+cc);
 await page.goto(base);await page.locator('#sessions').selectOption(sid);
 await expect(page.locator('#windows button').filter({hasText:'4 CC'})).toBeVisible();
 await page.locator('#windows button').filter({hasText:'4 CC'}).click({button:'right'});
 await page.getByRole('button',{name:'Renumber window…',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Renumber tmux window',exact:true});
 await dialog.getByRole('spinbutton',{name:'Window number',exact:true}).fill('1');
 await page.screenshot({path:'../test-results/window-renumber-dialog.png'});
 await dialog.getByRole('button',{name:'Renumber window',exact:true}).click();await expect(dialog).toBeHidden();
 await expect(page.locator('#windows button').filter({hasText:'1 CC'})).toBeVisible();
 expect(windows().map(w=>w.slice(1))).toEqual([['1','CC'],['2','one'],['3','two'],['4','three']]);expect(pids()).toEqual(before);
 expect(tmux('display-message','-p','-t',sid,'#{window_id}')).toBe(cc);
 const hosts=await(await fetch(base+'/api/v1/hosts')).json();const activeMachine=(await page.locator('#machines button[aria-current=true]').innerText()).trim();const host=hosts.find((h:{name:string})=>h.name===activeMachine);
 const request=(index:number,expected=windows().map(w=>[w[0],Number(w[1])]))=>fetch(base+'/api/v1/hosts/'+host.id+'/windows/renumber',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({connection_revision:host.connection_revision,session:sid,window:cc,index,expected_windows:expected})});
 const stale=windows().map(w=>[w[0],Number(w[1])]);
 expect((await request(4)).status).toBe(200);
 expect(windows().map(w=>w.slice(1))).toEqual(original.map(w=>w.slice(1)));
 expect((await request(2,stale)).status).toBe(409);
 expect((await request(10000)).status).toBe(400);
 expect((await request(0)).status).toBe(200);
 expect(windows().map(w=>w.slice(1))).toEqual([['0','CC'],['2','one'],['3','two'],['4','three']]);
 expect(pids()).toEqual(before);
});

async function closeTarget(session:string,window:string,host='test'){
 const hosts=await(await fetch(base+'/api/v1/hosts')).json();const connection_revision=hosts.find((h:any)=>h.id===host).connection_revision;const query=new URLSearchParams({connection_revision,session,window});const r=await fetch(`${base}/api/v1/hosts/${host}/windows/close?${query}`);expect(r.status,await r.clone().text()).toBe(200);return {connection_revision,session,window,...await r.json()};
}
async function closeRequest(p:any,host='test'){return fetch(`${base}/api/v1/hosts/${host}/windows/close`,{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({connection_revision:p.connection_revision,session:p.session,window:p.window,expected:p.expected})});}
test('close window confirms pane termination, permits cancel, and preserves an inactive window selection',async({page})=>{
 const sid=tmux('new-session','-d','-P','-F','#{session_id}','-s','close-fixture','-n','keep','/bin/sleep','86400');const keep=tmux('display-message','-p','-t',sid,'#{window_id}');const target=tmux('new-window','-d','-P','-F','#{window_id}','-t',sid,'-n','close-me','/bin/sleep','86400');tmux('split-window','-d','-t',target,'/bin/sleep','86400');const original=tmux('list-panes','-t',sid+':'+keep,'-F','#{pane_id}/#{pane_pid}');await page.goto(base);await expect(page.locator('#connection')).toHaveText('Attached');await page.getByLabel('Session',{exact:true}).selectOption(sid);await expect(page.locator('#windows button[aria-current=true]')).toContainText('keep');const tab=page.locator('#windows button').filter({hasText:'close-me'});await tab.click({button:'right'});await page.getByRole('button',{name:'Close window…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Close tmux window',exact:true});await expect(dialog).toContainText('2 panes');await expect(dialog).toContainText('terminates all');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect(tmux('list-windows','-t',sid,'-F','#{window_id}')).toContain(target);await tab.focus();await tab.press('Shift+F10');await page.getByRole('button',{name:'Close window…',exact:true}).click();await expect(dialog.getByRole('button',{name:'Close window',exact:true})).toBeEnabled();await page.screenshot({path:'../test-results/close-window-confirm.png'});await dialog.getByRole('button',{name:'Close window',exact:true}).click();await expect(dialog).toBeHidden();await expect(tab).toHaveCount(0);await expect(page.locator('#windows button[aria-current=true]')).toContainText('keep');expect(tmux('list-panes','-t',sid+':'+keep,'-F','#{pane_id}/#{pane_pid}')).toBe(original);expect(tmux('list-windows','-a','-F','#{window_id}').split('\n')).not.toContain(target);
});
test('close rejects changed pane processes, stale names, new links and replayed requests',async()=>{
 const sid=tmux('new-session','-d','-P','-F','#{session_id}','-s','close-guards','-n','guarded','/bin/sleep','86400'),window=tmux('display-message','-p','-t',sid,'#{window_id}');const pane=tmux('display-message','-p','-t',window,'#{pane_id}');let p=await closeTarget(sid,window);tmux('respawn-pane','-k','-t',pane,'/bin/sleep','86400');expect((await closeRequest(p)).status).toBe(409);p=await closeTarget(sid,window);tmux('rename-window','-t',window,'changed');expect((await closeRequest(p)).status).toBe(409);p=await closeTarget(sid,window);const linked=tmux('new-session','-d','-P','-F','#{session_id}','-s','close-linked','/bin/sleep','86400');tmux('link-window','-s',sid+':'+window,'-t',linked+':');expect((await closeRequest(p)).status).toBe(409);p=await closeTarget(sid,window);expect(p.affected_sessions).toHaveLength(2);expect((await closeRequest(p)).status).toBe(200);expect((await closeRequest(p)).status).toBe(409);expect(tmux('list-sessions','-F','#{session_id}')).not.toContain(sid+'\n');expect(tmux('list-windows','-t',linked,'-F','#{window_id}')).not.toContain(window);
});
test('closing the last window reports session removal and returns to a usable terminal view',async({page})=>{
 const sid=tmux('new-session','-d','-P','-F','#{session_id}','-s','close-last','-n','last-window','/bin/sleep','86400');await page.goto(base);await expect(page.locator('#connection')).toHaveText('Attached');await page.getByLabel('Session',{exact:true}).selectOption(sid);await page.locator('#windows button').filter({hasText:'last-window'}).click({button:'right'});await page.getByRole('button',{name:'Close window…',exact:true}).click();const d=page.getByRole('dialog',{name:'Close tmux window',exact:true});await expect(d).toContainText('last window in close-last');await d.getByRole('button',{name:'Close window',exact:true}).click();await expect(d).toBeHidden();await expect(page.getByLabel('Session',{exact:true})).not.toHaveValue(sid);await expect(page.locator('#connection')).toHaveText('Attached');
});
test('an uncertain close response is never retried automatically',async({page})=>{
 const sid=tmux('new-session','-d','-P','-F','#{session_id}','-s','close-uncertain','-n','uncertain','/bin/sleep','86400');const keep=tmux('new-window','-d','-P','-F','#{window_id}','-t',sid,'-n','keep','/bin/sleep','86400');await page.goto(base);await expect(page.locator('#connection')).toHaveText('Attached');await page.getByLabel('Session',{exact:true}).selectOption(sid);let attempts=0;await page.route('**/windows/close',async route=>{if(route.request().method()==='POST'){attempts++;await route.fetch();await route.abort();}else await route.continue();});await page.locator('#windows button').filter({hasText:/uncertain$/}).click({button:'right'});await page.getByRole('button',{name:'Close window…',exact:true}).click();const d=page.getByRole('dialog',{name:'Close tmux window',exact:true});await expect(d.getByRole('button',{name:'Close window',exact:true})).toBeEnabled();await d.getByRole('button',{name:'Close window',exact:true}).click();await expect(d).toContainText('will not be retried');await expect(d.getByRole('button',{name:'Close window',exact:true})).toBeDisabled();expect(attempts).toBe(1);expect(tmux('list-windows','-t',sid,'-F','#{window_id}')).toBe(keep);
});
