import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

let dir: string, socket: string, backend: ChildProcess, sshd: ChildProcess | undefined, base: string;
let projectA: string, projectB: string, outside: string, config: string;
const remote = existsSync('/usr/sbin/sshd');
function command(program: string, args: string[]) {
  const result = spawnSync(program, args, { encoding: 'utf8', env: { ...process.env, TMUX: '' } });
  if (result.status !== 0) throw new Error(`${program}: ${result.stderr}`); return result.stdout.trim();
}
function tmux(...args: string[]) { return command('tmux', ['-S', socket, ...args]); }
async function port() { return new Promise<number>(resolvePort => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const p = (server.address() as { port: number }).port; server.close(() => resolvePort(p)); }); }); }
async function showFiles(page: Page) { await page.goto(base); await expect(page.locator('#connection')).toHaveText('Attached'); await page.getByRole('button', { name: 'Files', exact: true }).click(); await expect(page.getByLabel('File browser machine', { exact: true })).toBeVisible(); }
async function browse(page: Page, path: string) { await page.locator('#browse-path').fill(path); await page.locator('#browse-path-form').getByRole('button', { name: 'Go', exact: true }).click(); await expect(page.locator('#browse-location')).toContainText(path); }
async function edit(page: Page, text: string) { const editor = page.locator('#code-editor .cm-content'); await editor.click(); await editor.press('Control+a'); await page.keyboard.insertText(text); await expect(page.locator('#editor-status')).toContainText('Unsaved'); }

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'cc-files-')); socket = join(dir, 'tmux.sock');
  projectA = join(dir, "project ' café"); projectB = join(dir, 'other-project'); outside = join(dir, 'outside');
  for (const path of [projectA, projectB, outside]) mkdirSync(path);
  writeFileSync(join(projectA, 'main.py'), 'def hello():\n    return "original"\n');
  writeFileSync(join(projectA, 'crlf.py'), '\ufeff# café\r\nprint("hello")\r\n');
  writeFileSync(join(projectA, 'mixed.txt'), 'one\r\ntwo\n');
  writeFileSync(join(projectA, '.hidden.txt'), 'hidden\n');
  writeFileSync(join(projectA, 'binary.dat'), Buffer.from([0,1,2]));
  writeFileSync(join(outside, 'README.md'), '# Outside projects\n');
  writeFileSync(join(outside, 'large-save.txt'), 'initial\n');
  tmux('-f', '/dev/null', 'new-session', '-d', '-s', 'projects', '-n', 'first', '-c', projectA, '-x', '120', '-y', '35');
  tmux('split-window', '-h', '-t', 'projects:0', '-c', projectA);
  tmux('new-window', '-d', '-t', 'projects', '-n', 'other', '-c', projectB);
  let sshConfig = '';
  if (remote) {
    command('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'hostkey')]);
    command('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'identity')]);
    writeFileSync(join(dir, 'authorized_keys'), readFileSync(join(dir, 'identity.pub')), { mode: 0o600 });
    const sshPort = await port();
    writeFileSync(join(dir, 'sshd_config'), `Port ${sshPort}\nListenAddress 127.0.0.1\nHostKey ${dir}/hostkey\nAuthorizedKeysFile ${dir}/authorized_keys\nStrictModes no\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nUsePAM no\nPidFile ${dir}/sshd.pid\nAllowUsers ${userInfo().username}\nLogLevel ERROR\n`);
    sshd = spawn('/usr/sbin/sshd', ['-D', '-e', '-f', join(dir, 'sshd_config')], { stdio: 'pipe' });
    writeFileSync(join(dir, 'known_hosts'), `[127.0.0.1]:${sshPort} ${readFileSync(join(dir, 'hostkey.pub'), 'utf8')}`);
    sshConfig = join(dir, 'ssh_config');
    writeFileSync(sshConfig, `Host cc-files\n  HostName 127.0.0.1\n  Port ${sshPort}\n  User ${userInfo().username}\n  IdentityFile ${dir}/identity\n  IdentitiesOnly yes\n  UserKnownHostsFile ${dir}/known_hosts\n`);
  }
  const backendPort = await port(); base = `http://127.0.0.1:${backendPort}`; config = join(dir, 'config.toml');
  writeFileSync(config, `[[hosts]]\nid="local"\nname="Local files"\nsocket=${JSON.stringify(socket)}\n\n[[hosts]]\nid="remote"\nname="Remote files"\nsocket=${JSON.stringify(socket)}\n${remote ? `ssh="cc-files"\nssh_config=${JSON.stringify(sshConfig)}\n` : ''}`);
  backend = spawn(resolve(process.env.CC_BINARY || '../target/debug/command-center'), ['--listen', `127.0.0.1:${backendPort}`, '--config', config, '--web-dir', resolve(process.env.CC_WEB_DIR || 'dist')], { stdio: 'pipe' });
  backend.stderr?.on('data', data => process.stderr.write(data));
  await expect.poll(async () => { try { return (await fetch(`${base}/api/v1/health`)).status; } catch { return 0; } }).toBe(200);
});
test.afterAll(async () => { backend?.kill('SIGTERM'); sshd?.kill('SIGTERM'); if (socket) spawnSync('tmux', ['-S', socket, 'kill-server']); if (dir) rmSync(dir, { recursive: true, force: true }); });

test('projects deduplicate pane folders, retain pins, and allow arbitrary browsing and editing', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await showFiles(page);
  await expect(page.locator('#project-roots > details')).toHaveCount(2);
  const project = page.locator('#project-roots > details').filter({ has: page.locator('.project-label small', { hasText: `Local files › ${projectA}` }) });
  await expect(project).toHaveCount(1); await project.locator(':scope > summary').click();
  await project.getByRole('button', { name: 'main.py', exact: true }).click();
  await expect(page.locator('#editor-location')).toHaveText(`Local files › ${join(projectA, 'main.py')}`);
  await expect.poll(() => page.locator('#code-editor .cm-line span').count()).toBeGreaterThan(0);
  await edit(page, 'def hello():\n    return "edited in Command Center"\n');
  await page.locator('#code-editor .cm-content').press('Control+s');
  await expect(page.locator('#editor-status')).toHaveText('Saved · UTF-8');
  expect(readFileSync(join(projectA, 'main.py'), 'utf8')).toContain('edited in Command Center');
  await project.getByRole('button', { name: `Pin project ${projectA}`, exact: true }).click();
  await expect(project.getByRole('button', { name: `Unpin project ${projectA}`, exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept('My project'));
  await project.getByRole('button', { name: `Rename project ${projectA}`, exact: true }).click();
  await expect(project.locator('.project-label strong')).toHaveText('My project');
  expect(readFileSync(config, 'utf8')).toContain('name = "My project"');
  await browse(page, outside);
  await page.locator('#directory-tree').getByRole('button', { name: 'README.md', exact: true }).click();
  await expect(page.locator('#editor-location')).toHaveText(`Local files › ${join(outside, 'README.md')}`);
  await expect(page.locator('#code-editor .cm-content')).toContainText('Outside projects');
  await expect(page.locator('#terminal-pane')).toBeHidden();await expect(page.locator('#workspace')).toHaveClass(/files-workspace/);
  await page.screenshot({ path: '../test-results/project-editor-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#code-editor')).toBeVisible();
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await expect(page.locator('#file-sidebar')).toBeHidden();
  await page.screenshot({ path: '../test-results/project-editor-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  tmux('kill-window', '-t', 'projects:0');
  await page.getByRole('button', { name: '↻', exact: true }).click();
  await expect(project.locator('.project-label strong')).toHaveText('My project');
  await page.reload(); await page.getByRole('button', { name: 'Files', exact: true }).click();
  await expect(page.locator('#project-roots .project-label strong', { hasText: 'My project' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('machine-qualified SSH tabs preserve drafts and enforce file and connection conflicts', async ({ page }) => {
  test.setTimeout(60000);
  await showFiles(page); await browse(page, projectA);
  await page.locator('#directory-tree').getByRole('button', { name: 'main.py', exact: true }).click();
  await edit(page, 'local unsaved draft\n');
  await page.getByLabel('File browser machine', { exact: true }).selectOption('remote');
  await browse(page, projectA);
  await page.locator('#directory-tree').getByRole('button', { name: 'main.py', exact: true }).click();
  await expect(page.locator('#file-tabs').getByRole('button', { name: 'Local files · main.py ●', exact: true })).toBeVisible();
  await expect(page.locator('#file-tabs').getByRole('button', { name: 'Remote files · main.py', exact: true })).toBeVisible();
  await edit(page, 'print("saved over SSH")\n');
  await page.locator('#save-file').click(); await expect(page.locator('#editor-status')).toHaveText('Saved · UTF-8');
  expect(readFileSync(join(projectA, 'main.py'), 'utf8')).toBe('print("saved over SSH")\n');
  await page.locator('#file-tabs').getByRole('button', { name: 'Local files · main.py ●', exact: true }).click();
  await expect(page.locator('#code-editor .cm-content')).toContainText('local unsaved draft');
  await page.locator('#save-file').click();
  await expect(page.locator('#file-conflict-message')).toContainText('File changed on disk');
  expect(readFileSync(join(projectA, 'main.py'), 'utf8')).toBe('print("saved over SSH")\n');
  await page.locator('#review-disk').click(); await expect(page.getByLabel('Disk version', { exact: true })).toHaveValue('print("saved over SSH")\n');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#overwrite-file').click();
  await expect(page.locator('#editor-status')).toHaveText('Saved · UTF-8');
  expect(readFileSync(join(projectA, 'main.py'), 'utf8')).toBe('local unsaved draft\n');
  await edit(page, 'retained when connection changes\n');
  const settings = await (await page.request.get(`${base}/api/v1/settings/hosts`)).json();
  const host = settings.hosts.find((h: { id: string }) => h.id === 'local');
  const alias = join(dir, 'alias.sock'); symlinkSync(socket, alias);
  const edited = await page.request.put(`${base}/api/v1/hosts/local`, { headers: { Origin: base }, data: { revision: settings.revision, host: { name: 'Renamed local', ssh: null, socket: alias, ssh_config: null } } });
  expect(edited.status()).toBe(200);
  await expect(page.locator('#editor-status')).toContainText('Machine connection unavailable or changed');
  await expect(page.locator('#save-file')).toBeDisabled();
  await expect(page.locator('#code-editor .cm-content')).toContainText('retained when connection changes');
  expect(readFileSync(join(projectA, 'main.py'), 'utf8')).toBe('local unsaved draft\n');
  expect((await edited.json()).hosts.find((h: { id: string }) => h.id === 'local').projects).toEqual(host.projects);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: `Close file Renamed local › ${join(projectA, 'main.py')}`, exact: true }).click();
  // A token from one machine must never authorize a save through another ID.
  const data = await (await page.request.get(`${base}/api/v1/hosts/remote/file?path=${encodeURIComponent(join(projectA, 'main.py'))}`)).json();
  const currentHosts = await (await page.request.get(`${base}/api/v1/hosts`)).json();
  const rejected = await page.request.put(`${base}/api/v1/hosts/remote/file`, { headers: { Origin: base }, data: { path: data.path, version: data.version, text: 'wrong machine', connection_revision: currentHosts.find((h: { id: string }) => h.id === 'local').connection_revision } });
  expect(rejected.status()).toBe(409);
});

test('line endings survive the editor and large saves use the bounded file API', async ({ page }) => {
  await showFiles(page); await browse(page, projectA);
  await page.locator('#directory-tree').getByRole('button', { name: 'crlf.py', exact: true }).click();
  const editor = page.locator('#code-editor .cm-content'); await editor.click(); await editor.press('Control+End'); await page.keyboard.insertText('# added\n');
  await page.locator('#save-file').click(); await expect(page.locator('#editor-status')).toHaveText('Saved · UTF-8');
  const bytes = readFileSync(join(projectA, 'crlf.py')); expect(bytes.subarray(0,3)).toEqual(Buffer.from([0xef,0xbb,0xbf]));
  expect(bytes.toString('utf8').replaceAll('\r\n', '')).not.toContain('\n');
  await page.locator('#directory-tree').getByRole('button', { name: 'mixed.txt', exact: true }).click();
  await expect(page.locator('#editor-status')).toContainText('Mixed line endings');
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  expect(readFileSync(join(projectA, 'mixed.txt'), 'utf8')).toBe('one\r\ntwo\n');
  const path = join(outside, 'large-save.txt');
  const file = await (await page.request.get(`${base}/api/v1/hosts/local/file?path=${encodeURIComponent(path)}`)).json();
  const content = 'content '.repeat(7000);
  const response = await page.request.put(`${base}/api/v1/hosts/local/file`, { headers: { Origin: base }, data: { path, version: file.version, connection_revision: file.connection_revision, text: content } });
  expect(response.status()).toBe(200); expect(readFileSync(path, 'utf8')).toBe(content);
});


test('navigation stays put by default, follows explicitly, and delayed opens cannot steal editor focus', async ({ page }) => {
  await showFiles(page); await browse(page, outside);
  await page.getByRole('button',{name:'Tmux',exact:true}).click();
  tmux('new-window', '-d', '-t', 'projects', '-n', 'follow', '-c', projectA);
  await expect(page.locator('#windows').getByRole('button', { name: /follow$/ })).toBeVisible();await page.locator('#windows').getByRole('button', { name: /follow$/ }).click();await expect(page.locator('#connection')).toHaveText('Attached');
  await page.locator('#terminal-files').click();await expect(page.locator('#browse-location')).toContainText(projectA);await expect(page.getByLabel('Follow active pane',{exact:true})).toBeChecked();
  await page.getByRole('button',{name:'Files',exact:true}).first().click();await expect(page.locator('#browse-location')).toContainText(outside);await expect(page.getByLabel('Follow active pane',{exact:true})).toBeHidden();
  const a = join(outside, 'race-a.txt'), b = join(outside, 'race-b.txt');
  writeFileSync(a, 'slow file\n'); writeFileSync(b, 'latest selection\n');
  await page.getByRole('button', { name: '↻', exact: true }).click();
  await expect(page.locator('#directory-tree').getByRole('button', { name: 'race-a.txt', exact: true })).toBeVisible();
  let delayed = false;
  await page.route('**/api/v1/hosts/*/file?**', async route => {
    const url = new URL(route.request().url());
    if (!delayed && url.searchParams.get('path') === a) { delayed = true; await new Promise(resolve => setTimeout(resolve, 600)); }
    await route.continue();
  });
  await page.locator('#directory-tree').getByRole('button', { name: 'race-a.txt', exact: true }).click();
  await page.locator('#directory-tree').getByRole('button', { name: 'race-b.txt', exact: true }).click();
  await expect(page.locator('#editor-location')).toContainText(b);
  await expect(page.locator('#file-tabs').getByRole('button', { name: / · race-a.txt$/, exact: false })).toBeVisible();
  await expect(page.locator('#editor-location')).toContainText(b);
  writeFileSync(b, 'external clean update\n');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('#code-editor .cm-content')).toContainText('external clean update');
  await expect(page.locator('#editor-status')).toHaveText('Saved · UTF-8');
});

test('Markdown source/preview preserves drafts, undo, safe rendering, TOC and machine-qualified links', async ({ page }) => {
  const path = join(outside, 'preview.MD'), linked = join(outside, 'linked.md');
  const original = '# Preview notes\n\n' + 'A paragraph for scrolling.\n\n'.repeat(25) +
    '## Details\n\n- [x] Finished\n- [ ] Pending\n\n| Name | Value |\n| --- | --- |\n| test | works |\n\n```python\nprint("hello")\n```\n\n' +
    '[Related notes](linked.md) · [Jump to details](#details) · [External](https://example.com/)\n\n' +
    '<script>window.markdownExecuted = true</script>\n<img src="https://markdown-spy.invalid/image" onerror="window.markdownExecuted = true">\n' +
    '<iframe src="https://markdown-spy.invalid/frame"></iframe>\n<div style="background-image:url(https://markdown-spy.invalid/style)">safe text</div>\n';
  writeFileSync(path, original); writeFileSync(linked, '# Related document\n\nLinked on the same machine.\n'); writeFileSync(join(outside, 'plain.txt'), 'plain file\n');
  let resourceRequests = 0;
  await page.route('**/markdown-spy.invalid/**', async route => { resourceRequests++; await route.abort(); });
  await showFiles(page); await browse(page, outside);
  await page.locator('#directory-tree').getByRole('button', { name: 'preview.MD', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Source', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const draft = original.replace('# Preview notes', '# Unsaved preview');
  await edit(page, draft);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.getByRole('region', { name: 'Rendered Markdown', exact: true });
  await expect(preview.getByRole('heading', { name: 'Unsaved preview', exact: true })).toBeVisible();
  await expect(page.locator('#code-editor')).toBeHidden();
  expect(readFileSync(path, 'utf8')).toBe(original);
  await expect(preview.getByRole('table')).toContainText('works');
  await expect(preview.locator('pre code')).toHaveText('print("hello")\n');
  await expect(preview.getByRole('checkbox').first()).toBeDisabled();
  await expect(preview.locator('script,iframe,img,[onerror]')).toHaveCount(0);
  await expect(preview.locator('.markdown-body [style]')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { markdownExecuted?: boolean }).markdownExecuted)).toBeUndefined();
  expect(resourceRequests).toBe(0);
  const outline = preview.locator('.markdown-outline'), article = preview.locator('.markdown-body');
  const outlineBefore = (await outline.boundingBox())!, articleBefore = (await article.boundingBox())!;
  expect(outlineBefore.x + outlineBefore.width).toBeLessThanOrEqual(articleBefore.x + 1);
  await preview.getByRole('navigation', { name: 'Table of contents', exact: true }).getByRole('button', { name: 'Details', exact: true }).click();
  expect(await article.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(Math.abs((await outline.boundingBox())!.y - outlineBefore.y)).toBeLessThan(1);
  await expect(preview.getByRole('navigation', { name: 'Table of contents', exact: true })).toBeVisible();
  await outline.locator('summary').click();
  expect((await outline.boundingBox())!.width).toBeLessThan(40);
  await outline.locator('summary').click();
  await page.getByRole('button', { name: 'Source', exact: true }).click();
  await expect(page.locator('#code-editor .cm-content')).toContainText('Unsaved preview');
  await page.locator('#code-editor .cm-content').press('Control+z');
  await expect(page.locator('#editor-status')).toHaveText('Saved · UTF-8');
  await page.locator('#code-editor .cm-content').press('Control+Shift+z');
  await expect(page.locator('#editor-status')).toContainText('Unsaved');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(preview.getByRole('heading', { name: 'Unsaved preview', exact: true })).toBeVisible();
  await preview.press('Control+s'); await expect(page.locator('#editor-status')).toHaveText('Saved · UTF-8');
  expect(readFileSync(path, 'utf8')).toBe(draft);
  await preview.getByRole('link', { name: 'Related notes', exact: true }).click();
  await expect(page.locator('#editor-location')).toContainText(linked);
  await expect(preview.getByRole('heading', { name: 'Related document', exact: true })).toBeVisible();
  await expect(page.locator('#file-tabs').getByRole('button', { name: / · linked.md$/ })).toBeVisible();
  await page.screenshot({ path: '../test-results/markdown-preview-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await expect(preview).toBeVisible();
  await preview.locator('.markdown-outline summary').click();
  expect((await preview.locator('.markdown-outline').boundingBox())!.width).toBeLessThan(40);
  await page.screenshot({ path: '../test-results/markdown-preview-mobile.png' });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.getByRole('button', { name: 'Browser', exact: true }).click();
  await page.locator('#directory-tree').getByRole('button', { name: 'plain.txt', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Markdown view', exact: true })).toBeHidden();
  await expect(page.locator('#code-editor')).toBeVisible();
  await page.locator('#file-tabs').getByRole('button', { name: / · preview.MD$/ }).click();
  await expect(preview.getByRole('heading', { name: 'Unsaved preview', exact: true })).toBeVisible();
});

test('standalone Files and the window drawer keep independent locations and shared unsaved documents',async({page})=>{
 const workspaceNote=join(outside,'workspace-note.md'),drawerNote=join(projectA,'drawer-note.py');writeFileSync(workspaceNote,'# Workspace note on disk\n');writeFileSync(drawerNote,'# Drawer note on disk\n');tmux('new-window','-d','-t','projects','-n','context-files-a','-c',projectA);tmux('new-window','-d','-t','projects','-n','context-files-b','-c',projectB);
 await showFiles(page);await page.getByLabel('File browser machine',{exact:true}).selectOption('remote');await browse(page,outside);await page.locator('#directory-tree').getByRole('button',{name:'workspace-note.md',exact:true}).click();await edit(page,'# Independent workspace draft\n');await expect(page.locator('.workspace-bar')).toBeHidden();await page.screenshot({path:'../test-results/files-standalone-desktop.png'});
 await page.getByRole('button',{name:'Tmux',exact:true}).click();await expect(page.locator('#connection')).toHaveText('Attached');await page.locator('#windows button').filter({hasText:/context-files-a$/}).click();await expect(page.locator('#connection')).toHaveText('Attached');await page.getByRole('button',{name:'Window files',exact:true}).click();await expect(page.locator('#workspace')).toHaveClass(/with-files/);await expect(page.locator('#terminal-pane')).toBeVisible();await expect(page.getByLabel('File browser machine',{exact:true})).toHaveValue('local');await expect(page.locator('#browse-location')).toContainText(projectA);await expect(page.locator('#project-roots > details')).toHaveCount(1);await expect(page.locator('#editor-location')).toHaveText('Choose a file to begin');await page.locator('#directory-tree').getByRole('button',{name:'drawer-note.py',exact:true}).click();await edit(page,'# Independent drawer draft\n');await page.screenshot({path:'../test-results/files-context-drawer-desktop.png'});
 await page.getByRole('button',{name:'Files',exact:true}).click();await expect(page.locator('#terminal-pane')).toBeHidden();await expect(page.getByLabel('File browser machine',{exact:true})).toHaveValue('remote');await expect(page.locator('#browse-location')).toContainText(outside);await expect(page.locator('#code-editor .cm-content')).toContainText('Independent workspace draft');await expect(page.locator('#workspace')).not.toHaveClass(/with-files/);
 await page.getByRole('button',{name:'Tmux',exact:true}).click();await expect(page.locator('#browse-location')).toContainText(projectA);await expect(page.locator('#code-editor .cm-content')).toContainText('Independent drawer draft');await page.locator('#windows button').filter({hasText:/context-files-b$/}).click();await expect(page.locator('#browse-location')).toContainText(projectB);await expect(page.locator('#editor-location')).toHaveText('Choose a file to begin');await expect(page.locator('#file-tabs')).toContainText('drawer-note.py ●');await page.getByRole('button',{name:'Files',exact:true}).click();await expect(page.locator('#code-editor .cm-content')).toContainText('Independent workspace draft');expect(readFileSync(workspaceNote,'utf8')).toBe('# Workspace note on disk\n');expect(readFileSync(drawerNote,'utf8')).toBe('# Drawer note on disk\n');
});

test('phone standalone Files keeps its location without attaching or resizing a terminal',async({page,browser})=>{
 await page.goto(base);await expect(page.locator('#connection')).toHaveText('Attached');const before=tmux('list-panes','-a','-F','#{pane_id} #{pane_pid} #{pane_width}x#{pane_height}');const phone=await browser.newPage({viewport:{width:393,height:852},isMobile:true,hasTouch:true});let sockets=0;phone.on('websocket',ws=>{if(ws.url().includes('/terminal?'))sockets++;});await phone.goto(base);await phone.getByRole('button',{name:'Files',exact:true}).click();await expect(phone.locator('#files-pane')).toBeVisible();await browse(phone,outside);await phone.locator('#directory-tree').getByRole('button',{name:'README.md',exact:true}).click();await expect(phone.locator('#code-editor')).toBeVisible();await phone.getByRole('button',{name:'Agents',exact:false}).click();await phone.getByRole('button',{name:'Files',exact:true}).click();await expect(phone.locator('#browse-location')).toContainText(outside);await expect(phone.getByLabel('Follow active pane',{exact:true})).toBeHidden();await phone.locator('#terminal-files').evaluate(node=>node.click());await expect(phone.locator('#workspace')).toHaveClass(/files-workspace/);expect(sockets).toBe(0);expect(tmux('list-panes','-a','-F','#{pane_id} #{pane_pid} #{pane_width}x#{pane_height}')).toBe(before);await phone.screenshot({path:'../test-results/files-standalone-phone.png'});await phone.close();
});
