import { basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Host } from './machines';

export type FileContext = { host: string; cwd?: string; folders: { pane: string; path: string }[] };
type Project = { path: string; name: string; pinned: boolean; windows: { session: string; window: string; window_name: string }[] };
type Projects = { host: string; revision: string; connection_revision: string; projects: Project[]; discovery_error?: string };
type Entry = { path: string; name: string; kind: 'file' | 'directory' | 'other' | 'unavailable'; symlink: boolean; size: number };
type Listing = { host: string; path: string; connection_revision: string; entries: Entry[]; truncated: boolean; unsupported_names: number };
type FileData = { host: string; path: string; connection_revision: string; text: string; version: string; read_only: string | null; unchanged?: boolean };
type Document = { key: string; host: string; path: string; state?: EditorState; version: string; connection?: string; saved: string; readonly?: string | null; language: Compartment; disk?: FileData; error?: string; saving: boolean; rendered?: boolean };
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const key = (host: string, path: string) => JSON.stringify([host, path]);
const isMarkdown = (path: string) => /\.(md|markdown|mdown|mkd)$/i.test(path);
const basename = (path: string) => path.split('/').filter(Boolean).at(-1) || '/';
class FileError extends Error { constructor(message: string, readonly status: number) { super(message); } }
async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${url}`, { method, signal: AbortSignal.timeout(22000), headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = await response.text();
  let data; try { data = JSON.parse(raw); } catch { throw new FileError(raw || `Request failed (${response.status})`, response.status); }
  if (!response.ok) throw new FileError(data.error || `Request failed (${response.status})`, response.status);
  return data;
}
function button(text: string, action: () => void, label?: string) {
  const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = action;
  if (label) { b.setAttribute('aria-label', label); b.title = label; } return b;
}
function loadStored<T>(name: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(name) || 'null') ?? fallback; } catch { return fallback; } }
function store(name: string, value: unknown) { try { localStorage.setItem(name, JSON.stringify(value)); } catch { /* browsing persistence is optional */ } }

type BrowserMode='workspace'|'context';
type BrowserSnapshot={host:string;root:string;collapsed:boolean;active?:string;locations:Record<string,string>;history:{host:string;path:string}[];index:number};
export class FileWorkspace {
  private mode:BrowserMode='workspace';private snapshots:Partial<Record<BrowserMode,BrowserSnapshot>>={};private restoreBrowser=true;
  private hosts: Host[];
  private context: FileContext;
  private host = '';
  private visible = false;
  private projects?: Projects;
  private projectSignature = '';
  private projectGeneration = 0;
  private browseGeneration = 0;
  private pathRevision = 0;
  private root = '';
  private hidden = false;
  private follow = false;
  private lastFollow = '';
  private locations = loadStored<Record<string, string>>('cc.files.locations', {});
  private history = loadStored<{ host: string; path: string }[]>('cc.files.history', []);
  private historyIndex = this.history.length - 1;
  private nodes = new Map<string, HTMLDetailsElement>();
  private documents = new Map<string, Document>();
  private active?: string;
  private checking = false;
  private openGeneration = 0;
  private view: EditorView;
  private previewGeneration = 0;
  private previewKey = '';
  private previewText = '';
  private previewPending = false;

  constructor(hosts: Host[], context: FileContext) {
    this.hosts = hosts; this.context = context;
    el('files-pane').innerHTML = `
      <aside id="file-sidebar" aria-label="File browser">
        <div class="files-heading"><strong>FILES</strong><button id="refresh-files" title="Refresh projects and folders">↻</button></div>
        <label class="browser-host-label">Machine<select id="browser-machine" aria-label="File browser machine"></select></label>
        <div class="pane-folders"><select id="pane-folder" aria-label="Pane folders"></select><button id="use-pane-folder" title="Browse the selected pane folder">Open</button></div>
        <label class="check-label"><input id="follow-pane" type="checkbox">Follow active pane</label>
        <div class="section-label">PROJECTS <span>From tmux &amp; pinned</span></div>
        <div id="project-roots"></div>
        <details id="browse-anywhere"><summary>Browse anywhere</summary>
          <form id="browse-path-form"><input id="browse-path" aria-label="Directory path" placeholder="/absolute/path or ~/path" autocomplete="off"><button type="submit" title="Open directory">Go</button></form>
          <div class="browse-tools"><button id="file-back" title="Previous location">←</button><button id="file-forward" title="Next location">→</button><button id="file-parent">Up</button><button id="file-home">Home</button><button id="pin-directory">Pin</button></div>
          <div id="browse-location"></div><div id="directory-tree"></div>
        </details>
        <label class="check-label"><input id="hidden-files" type="checkbox">Show hidden files</label>
        <p id="browser-feedback" role="status"></p>
      </aside>
      <section id="file-editor" aria-label="File editor">
        <nav id="file-tabs" aria-label="Open files"></nav>
        <div class="editor-toolbar"><button id="toggle-browser" aria-pressed="true">Browser</button><span id="editor-location">Choose a file to begin</span><span id="markdown-modes" role="group" aria-label="Markdown view" hidden><button id="markdown-source" aria-pressed="true">Source</button><button id="markdown-rendered" aria-pressed="false">Preview</button></span><button id="reload-file">Reload</button><button id="save-file">Save</button></div>
        <div id="file-conflict" hidden><p id="file-conflict-message"></p><div><button id="review-disk">Review disk version</button><button id="reload-disk">Reload from disk</button><button id="overwrite-file">Save my version</button></div><textarea id="disk-preview" aria-label="Disk version" readonly hidden></textarea></div>
        <div id="editor-placeholder">Open a project directory, or browse anywhere.<br>Each file stays attached to its machine.</div>
        <div id="code-editor" hidden></div><div id="markdown-preview" tabindex="0" role="region" aria-label="Rendered Markdown" hidden></div><div id="editor-status" role="status"></div>
      </section>`;
    this.view = new EditorView({ state: EditorState.create({ extensions: [oneDark] }), parent: el('code-editor') });
    el<HTMLSelectElement>('browser-machine').onchange = () => this.chooseMachine(el<HTMLSelectElement>('browser-machine').value);
    el<HTMLInputElement>('browse-path').oninput = () => { this.pathRevision++; };
    el<HTMLFormElement>('browse-path-form').onsubmit = e => { e.preventDefault(); void this.browse(el<HTMLInputElement>('browse-path').value); };
    el('file-parent').onclick = () => void this.browse(this.root.replace(/\/[^/]+\/?$/, '') || '/');
    el('file-home').onclick = () => void this.browse('~');
    el('file-back').onclick = () => this.historyMove(-1); el('file-forward').onclick = () => this.historyMove(1);
    el('pin-directory').onclick = () => { if (this.root) void this.pin({ path: this.root, name: basename(this.root), pinned: false, windows: [] }, true); };
    el('refresh-files').onclick = () => { this.nodes.clear(); this.projectSignature = ''; void this.loadProjects(); if (this.root) void this.browse(this.root, false); };
    el<HTMLInputElement>('hidden-files').onchange = () => { this.hidden = el<HTMLInputElement>('hidden-files').checked; this.nodes.clear(); this.projectSignature = ''; void this.loadProjects(); if (this.root) void this.browse(this.root, false); };
    el<HTMLInputElement>('follow-pane').checked = this.follow;
    el<HTMLInputElement>('follow-pane').onchange = () => { this.follow = el<HTMLInputElement>('follow-pane').checked; this.lastFollow = ''; store(this.storage('follow'), this.follow); this.setContext(this.context); };
    el('use-pane-folder').onclick = () => { const path = el<HTMLSelectElement>('pane-folder').value; if (path) { if (this.host !== this.context.host) this.chooseMachine(this.context.host, false); void this.browse(path); } };
    el('toggle-browser').onclick = () => { const collapsed = el('files-pane').classList.toggle('browser-collapsed'); el('toggle-browser').setAttribute('aria-pressed', String(!collapsed)); };
    el('markdown-source').onclick = () => { const doc = this.current(); if (doc) { doc.rendered = false; this.renderEditor(); this.view.focus(); } };
    el('markdown-rendered').onclick = () => { const doc = this.current(); if (doc) { doc.rendered = true; this.renderEditor(); el('markdown-preview').focus(); } };
    el('markdown-preview').onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); const doc = this.current(); if (doc) void this.save(doc); } };
    el('save-file').onclick = () => { const doc = this.current(); if (doc) void this.save(doc); };
    el('reload-file').onclick = () => { const doc = this.current(); if (doc) void this.reload(doc); };
    el('reload-disk').onclick = el('reload-file').onclick;
    el('review-disk').onclick = () => { const doc = this.current(); if (doc?.disk) { const preview = el<HTMLTextAreaElement>('disk-preview'); preview.value = doc.disk.text; preview.hidden = !preview.hidden; } };
    el('overwrite-file').onclick = () => { const doc = this.current(); if (doc?.disk && window.confirm(`Replace the reviewed disk version of ${this.machineName(doc.host)} › ${doc.path} with your editor text?`)) { doc.version = doc.disk.version; doc.disk = undefined; void this.save(doc); } };
    window.addEventListener('beforeunload', event => { if ([...this.documents.values()].some(d => this.dirty(d))) { event.preventDefault(); event.returnValue = ''; } });
    window.addEventListener('focus', () => { if (this.visible) void this.checkExternal(); });
    window.setInterval(() => { if (this.visible && !document.hidden) { void this.loadProjects(); void this.checkExternal(); } }, 10000);
    this.renderHosts();
    const saved = loadStored<{ host: string; path: string }[]>('cc.files.tabs', []);
    if (Array.isArray(saved)) for (const location of saved.slice(0, 16)) {
      if (typeof location?.host === 'string' && typeof location?.path === 'string') this.documents.set(key(location.host, location.path), this.document(location.host, location.path));
    }
    this.renderTabs(); this.renderEditor();
  }
  private related(doc:Document|undefined,context=this.context){return !!doc&&doc.host===context.host&&context.folders.some(f=>doc.path===f.path||doc.path.startsWith(f.path.replace(/\/$/,'')+'/'));}
  private storage(name:string){return this.mode==='workspace'?`cc.files.${name}`:`cc.files.context.${name}`;}
  setMode(mode:BrowserMode,context:FileContext,anchor=false){
    this.context=context;
    if(mode!==this.mode){
      this.snapshots[this.mode]={host:this.host,root:this.root,collapsed:el('files-pane').classList.contains('browser-collapsed'),active:this.active,locations:{...this.locations},history:[...this.history],index:this.historyIndex};
      this.mode=mode;this.projectGeneration++;this.browseGeneration++;this.openGeneration++;this.projectSignature='';this.projects=undefined;this.nodes.clear();this.lastFollow='';this.restoreBrowser=true;
      const saved=this.snapshots[mode];this.locations=saved?.locations||loadStored(this.storage('locations'),{});this.history=saved?.history||loadStored(this.storage('history'),[]);this.historyIndex=saved?.index??this.history.length-1;
      this.host=saved?.host||(mode==='context'?context.host:loadStored('cc.files.host',this.hosts[0]?.id||''));if(!this.hosts.some(h=>h.id===this.host))this.host=this.hosts[0]?.id||'';
      el('files-pane').classList.toggle('browser-collapsed',!!saved?.collapsed);el('toggle-browser').setAttribute('aria-pressed',String(!saved?.collapsed));
      this.root=saved?.root||this.locations[this.host]||'~';this.active=saved?.active&&this.documents.has(saved.active)?saved.active:undefined;this.follow=mode==='context';
      el('project-roots').replaceChildren();el('directory-tree').replaceChildren();el('browse-location').textContent='';this.renderHosts();const doc=this.current();if(doc?.state)this.view.setState(doc.state);this.renderTabs();this.renderEditor();
    }
    if(mode==='context'&&anchor){el('files-pane').classList.remove('browser-collapsed');el('toggle-browser').setAttribute('aria-pressed','true');this.follow=true;this.lastFollow='';this.restoreBrowser=true;if(this.host!==context.host){this.host=context.host;this.projectGeneration++;this.browseGeneration++;this.nodes.clear();this.projectSignature='';this.renderHosts();}this.root=context.cwd||this.locations[this.host]||'~';}
    if(mode==='context'&&anchor&&!this.related(this.current())){this.active=undefined;this.renderTabs();this.renderEditor();}
    el('files-pane').dataset.mode=mode;el<HTMLSelectElement>('pane-folder').parentElement!.hidden=mode==='workspace';el<HTMLInputElement>('follow-pane').parentElement!.hidden=mode==='workspace';el<HTMLInputElement>('follow-pane').checked=this.follow;
    const label=el('file-sidebar').querySelector('.section-label span');if(label)label.textContent=mode==='context'?'Current tmux window':'From tmux & pinned';
  }
  setVisible(visible: boolean) {
    this.visible=visible;if(!visible)return;
    if(!this.host){const preferred=this.mode==='context'?this.context.host:loadStored('cc.files.host',this.hosts[0]?.id||'');this.chooseMachine(this.hosts.some(h=>h.id===preferred)?preferred:this.hosts[0]?.id||'',false);}
    void this.loadProjects();
    if(this.restoreBrowser){this.restoreBrowser=false;if(this.mode==='context'&&this.follow&&this.context.cwd)this.setContext(this.context);else void this.browse(this.root||this.locations[this.host]||'~',false);}
    const restore=this.mode==='workspace'&&!this.active&&[...this.documents.values()].at(-1);if(restore)void this.openFile(restore.host,restore.path);void this.checkExternal();
  }
  openLocation(host:string,path:string){if(!this.hosts.some(h=>h.id===host))return;this.openGeneration++;if(this.host!==host)this.chooseMachine(host,false);void this.browse(path);}
  setHosts(hosts: Host[]) {
    const old = this.hosts.find(h => h.id === this.host)?.connection_revision;
    this.hosts = hosts; this.renderHosts(); this.renderTabs(); this.renderEditor();
    const next = hosts.find(h => h.id === this.host);
    if (!next) this.chooseMachine(hosts[0]?.id || '');
    else if (old !== next.connection_revision) { this.nodes.clear(); this.projects = undefined; this.projectSignature = ''; if (this.visible) { void this.loadProjects(); void this.browse(this.root || '~', false); } }
    else if (this.visible) void this.loadProjects();
  }
  setContext(context: FileContext) {
    const changed=JSON.stringify([this.context.host,this.context.folders])!==JSON.stringify([context.host,context.folders]);
    this.context = context;
    if(this.mode==='workspace')return;
    if(this.visible&&this.follow&&changed){if(this.host!==context.host)this.chooseMachine(context.host,false);if(!this.related(this.current())){this.active=undefined;this.renderTabs();this.renderEditor();}}
    if(changed&&this.visible&&this.host===context.host){this.projectSignature='';void this.loadProjects();}
    const select = el<HTMLSelectElement>('pane-folder'), selected = select.value;
    select.replaceChildren(...context.folders.map(folder => { const option = document.createElement('option'); option.value = folder.path; option.textContent = `${this.machineName(context.host)} · ${folder.pane} · ${folder.path}`; return option; }));
    select.value = context.folders.some(f => f.path === selected) ? selected : context.cwd || context.folders[0]?.path || '';
    el<HTMLButtonElement>('use-pane-folder').disabled = !select.value;
    if (this.visible && this.follow && context.cwd && key(context.host, context.cwd) !== this.lastFollow) {
      this.lastFollow = key(context.host, context.cwd); if (this.host !== context.host) this.chooseMachine(context.host, false); void this.browse(context.cwd);
    }
  }
  private machineName(id: string) { return this.hosts.find(h => h.id === id)?.name || `Unavailable machine (${id})`; }
  private current() { return this.active ? this.documents.get(this.active) : undefined; }
  private dirty(doc: Document) { return !!doc.state && doc.state.sliceDoc() !== doc.saved; }
  private report(error: unknown) { el('browser-feedback').textContent = error instanceof Error ? error.message : String(error); }
  private url(host: string, route: string, path?: string, connection?: string, known?: string) {
    const query = new URLSearchParams(); if (path !== undefined) query.set('path', path); if (connection) query.set('connection_revision', connection); if (known) query.set('known_version', known); if (this.hidden) query.set('hidden', 'true');
    return `/hosts/${encodeURIComponent(host)}/${route}${query.size ? `?${query}` : ''}`;
  }
  private renderHosts() {
    const select = el<HTMLSelectElement>('browser-machine'); select.replaceChildren(...this.hosts.map(host => { const option = document.createElement('option'); option.value = host.id; option.textContent = host.name; return option; })); select.value = this.host;
  }
  private chooseMachine(id: string, browse = true) {
    if(this.mode==='workspace')store('cc.files.host',id);
    this.host = id; this.projects = undefined; this.projectSignature = ''; this.projectGeneration++; this.browseGeneration++; this.root = ''; this.nodes.clear();
    this.renderHosts(); el('project-roots').replaceChildren(); el('directory-tree').replaceChildren(); el('browse-location').textContent = ''; el('browser-feedback').textContent = '';
    if (!id) { this.report('Add a machine to browse files.'); return; }
    if (this.visible) { void this.loadProjects(); if (browse) void this.browse(this.locations[id] || (this.mode==='context'&&this.context.host === id ? this.context.cwd : undefined) || '~', false); }
  }
  private async loadProjects() {
    if (!this.host || !this.visible) return;
    const host = this.host, token = ++this.projectGeneration;
    try {
      const data = await request<Projects>(this.url(host, 'projects'));
      if (host !== this.host || token !== this.projectGeneration) return;
      if(this.mode==='context')data.projects=data.projects.filter(p=>host===this.context.host&&this.context.folders.some(f=>f.path===p.path));
      this.projects = data;
      const signature = JSON.stringify([data.projects, this.machineName(host), this.hidden]); if (signature === this.projectSignature) return;
      this.projectSignature = signature;
      const roots = [...data.projects].sort((a,b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name)).map(project => {
        const nodeKey = key(host, project.path);
        let node = this.nodes.get(nodeKey);
        if (!node) { node = this.folder(host, project.path, project.name); this.nodes.set(nodeKey, node); }
        const summary = node.querySelector('summary')!; summary.replaceChildren();
        const label = document.createElement('span'); label.className = 'project-label';
        const title = document.createElement('strong'); title.textContent = project.name;
        const location = document.createElement('small'); location.textContent = `${this.machineName(host)} › ${project.path}`;
        label.append(title, location); summary.append(label);
        const pin = button(project.pinned ? '★' : '☆', () => void this.pin(project, !project.pinned), `${project.pinned ? 'Unpin' : 'Pin'} project ${project.path}`);
        pin.onclick = event => { event.preventDefault(); event.stopPropagation(); void this.pin(project, !project.pinned); }; summary.append(pin);
        if (project.pinned) { const rename = button('✎', () => {}, `Rename project ${project.path}`); rename.onclick = event => { event.preventDefault(); event.stopPropagation(); const name = window.prompt('Project name', project.name); if (name?.trim()) void this.pin({ ...project, name: name.trim() }, true); }; summary.append(rename); }
        return node;
      });
      if (roots.length) el('project-roots').replaceChildren(...roots); else el('project-roots').textContent = 'No tmux project folders yet. Browse anywhere and pin a directory.';
      if (data.discovery_error) this.report(`Project discovery unavailable: ${data.discovery_error}. You can still use pinned folders or browse by path.`);
    } catch (error) { if (host === this.host && token === this.projectGeneration) this.report(error); }
  }
  private folder(host: string, path: string, name: string) {
    const node = document.createElement('details'); node.className = 'file-folder';
    const summary = document.createElement('summary'); summary.textContent = name; summary.title = `${this.machineName(host)} › ${path}`;
    const children = document.createElement('div'); children.className = 'folder-children'; node.append(summary, children);
    let loaded = false;
    node.ontoggle = () => { if (node.open && !loaded) { loaded = true; children.textContent = 'Loading…'; const connection = this.hosts.find(h => h.id === host)?.connection_revision;
      void request<Listing>(this.url(host, 'fs', path, connection)).then(data => this.entries(children, host, data)).catch(error => { loaded = false; children.textContent = error instanceof Error ? error.message : String(error); });
    } };
    return node;
  }
  private entries(container: HTMLElement, host: string, data: Listing) {
    const nodes = data.entries.map(entry => {
      if (entry.kind === 'directory') return this.folder(host, entry.path, entry.name + (entry.symlink ? ' ↗' : ''));
      const b = button(entry.name + (entry.symlink ? ' ↗' : ''), () => void this.openFile(host, entry.path)); b.className = 'file-entry'; b.title = `${this.machineName(host)} › ${entry.path}`; b.disabled = entry.kind !== 'file'; return b;
    });
    container.replaceChildren(...nodes);
    if (!nodes.length) container.textContent = 'Empty directory';
    if (data.truncated || data.unsupported_names) { const note = document.createElement('p'); note.className = 'listing-note'; note.textContent = data.truncated ? 'Showing up to 2,000 entries. Use a direct path for others.' : 'Some non-UTF-8 names are unsupported.'; container.append(note); }
  }
  private async browse(path: string, record = true) {
    if (!this.host) return;
    const host = this.host, token = ++this.browseGeneration, connection = this.hosts.find(h => h.id === host)?.connection_revision;
    const initialPathRevision = this.pathRevision;
    el<HTMLDetailsElement>('browse-anywhere').open = true; el('browser-feedback').textContent = 'Opening directory…';
    try {
      const data = await request<Listing>(this.url(host, 'fs', path, connection)); if (host !== this.host || token !== this.browseGeneration) return;
      this.root = data.path; this.locations[host] = data.path; store(this.storage('locations'), this.locations);
      if (record || this.pathRevision === initialPathRevision) el<HTMLInputElement>('browse-path').value = data.path; el('browse-location').textContent = `${this.machineName(host)} › ${data.path}`;
      this.entries(el('directory-tree'), host, data); el('browser-feedback').textContent = '';
      if (record && key(this.history[this.historyIndex]?.host || '', this.history[this.historyIndex]?.path || '') !== key(host, data.path)) { this.history = this.history.slice(0, this.historyIndex + 1); this.history.push({ host, path: data.path }); this.history = this.history.slice(-40); this.historyIndex = this.history.length - 1; store(this.storage('history'), this.history); }
      el<HTMLButtonElement>('file-back').disabled = this.historyIndex <= 0; el<HTMLButtonElement>('file-forward').disabled = this.historyIndex >= this.history.length - 1;
    } catch (error) { if (host === this.host && token === this.browseGeneration) this.report(error); }
  }
  private historyMove(direction: number) {
    const next = this.historyIndex + direction; if (next < 0 || next >= this.history.length) return; this.historyIndex = next;
    const location = this.history[next]; if (this.host !== location.host) this.chooseMachine(location.host, false); void this.browse(location.path, false);
  }
  private async pin(project: Project, pinned: boolean) {
    const host = this.host, revision = this.projects?.revision; if (!revision) return;
    try { await request(this.url(host, 'projects'), 'PUT', { revision, path: project.path, name: project.name, pinned }); this.projectSignature = ''; await this.loadProjects(); }
    catch (error) { this.report(error); void this.loadProjects(); }
  }
  private document(host: string, path: string): Document { return { key: key(host, path), host, path, version: '', saved: '', language: new Compartment(), saving: false }; }
  private makeState(doc: Document, text: string): EditorState {
    const crlf = text.includes('\r\n'), mixed = crlf && text.replaceAll('\r\n', '').includes('\n');
    if (mixed) doc.readonly = 'Mixed line endings are read-only to preserve the source bytes';
    return EditorState.create({ doc: text, extensions: [basicSetup, oneDark, ...(crlf && !mixed ? [EditorState.lineSeparator.of('\r\n')] : []), doc.language.of([]), EditorState.readOnly.of(!!doc.readonly), EditorView.editable.of(!doc.readonly), keymap.of([{ key: 'Mod-s', run: () => { void this.save(doc); return true; } }, indentWithTab]), EditorView.updateListener.of(update => {
      if (this.active === doc.key) { doc.state = update.state; if (update.docChanged) { doc.error = undefined; this.renderTabs(); this.renderEditor(); } }
    })] });
  }
  private async language(doc: Document) {
    const language = LanguageDescription.matchFilename(languages, doc.path); if (!language || !doc.state) return;
    try { const support = await language.load(); if (!doc.state || !this.documents.has(doc.key)) return;
      const effects = doc.language.reconfigure(support); if (this.active === doc.key) this.view.dispatch({ effects }); else doc.state = doc.state.update({ effects }).state;
    } catch { /* Unknown/unavailable language keeps a fully usable text editor. */ }
  }
  private async openFile(host: string, path: string, rendered = false) {
    const generation = ++this.openGeneration;
    const existing = this.documents.get(key(host, path));
    if (existing?.state) { if (rendered && isMarkdown(path)) existing.rendered = true; this.activate(existing); return; }
    try {
      const machine = this.hosts.find(h => h.id === host); if (!machine) throw new Error('This machine is no longer configured.');
      const data = await request<FileData>(this.url(host, 'file', path, machine.connection_revision));
      const canonical = this.documents.get(key(host, data.path));
      if (canonical?.state) { if (rendered && isMarkdown(data.path)) canonical.rendered = true; if (generation === this.openGeneration) this.activate(canonical); return; }
      const doc = canonical || this.document(host, data.path);
      if (rendered && isMarkdown(data.path)) doc.rendered = true;
      if (existing && existing.key !== doc.key) this.documents.delete(existing.key);
      doc.saved = data.text; doc.version = data.version; doc.connection = data.connection_revision; doc.readonly = data.read_only;
      doc.state = this.makeState(doc, data.text); if (doc.readonly) doc.saved = doc.state.sliceDoc(); this.documents.set(doc.key, doc);
      if (generation === this.openGeneration) this.activate(doc); else { this.renderTabs(); this.persistTabs(); }
      void this.language(doc);
    } catch (error) { if (generation === this.openGeneration) this.report(error); }
  }
  private activate(doc: Document) {
    this.openGeneration++;
    if (!doc.state) { void this.openFile(doc.host, doc.path); return; }
    this.active = doc.key; this.view.setState(doc.state); this.renderTabs(); this.renderEditor(); this.persistTabs(); if (this.visible) { if (doc.rendered && isMarkdown(doc.path)) el('markdown-preview').focus(); else this.view.focus(); } void this.checkExternal();
  }
  private persistTabs() { store('cc.files.tabs', [...this.documents.values()].map(doc => ({ host: doc.host, path: doc.path }))); }
  private renderTabs() {
    el('file-tabs').replaceChildren(...[...this.documents.values()].map(doc => {
      const tab = document.createElement('div'); tab.className = this.active === doc.key ? 'file-tab active' : 'file-tab';
      const b = button(`${this.machineName(doc.host)} · ${basename(doc.path)}${this.dirty(doc) ? ' ●' : ''}`, () => this.activate(doc)); b.title = `${this.machineName(doc.host)} › ${doc.path}`; b.setAttribute('aria-current', String(this.active === doc.key));
      const close = button('×', () => { if (this.dirty(doc) && !window.confirm(`Discard unsaved edits to ${this.machineName(doc.host)} › ${doc.path}?`)) return;
        this.documents.delete(doc.key); if (this.active === doc.key) { this.active = undefined; const next = [...this.documents.values()].at(-1); if (next) this.activate(next); }
        this.renderTabs(); this.renderEditor(); this.persistTabs();
      }, `Close file ${this.machineName(doc.host)} › ${doc.path}`); tab.append(b, close); return tab;
    }));
  }
  private renderEditor() {
    const doc = this.current(), markdown = !!doc?.state && isMarkdown(doc.path), rendered = markdown && !!doc?.rendered;
    el('code-editor').hidden = !doc?.state || rendered; el('editor-placeholder').hidden = !!doc?.state;
    el('markdown-modes').hidden = !markdown; el('markdown-preview').hidden = !rendered;
    el('markdown-source').setAttribute('aria-pressed', String(!rendered)); el('markdown-rendered').setAttribute('aria-pressed', String(rendered));
    if (rendered && doc) void this.renderPreview(doc);
    else this.previewGeneration++;

    const available = doc && this.hosts.find(h => h.id === doc.host)?.connection_revision === doc.connection;
    el('editor-location').textContent = doc ? `${this.machineName(doc.host)} › ${doc.path}` : 'Choose a file to begin';
    el<HTMLButtonElement>('save-file').disabled = !doc || !available || !this.dirty(doc) || !!doc.readonly || doc.saving;
    el<HTMLButtonElement>('reload-file').disabled = !doc || !available || doc.saving;
    el('editor-status').textContent = !doc ? '' : doc.saving ? 'Saving…' : !available ? 'Machine connection unavailable or changed. Your editor text is preserved.' : doc.readonly ? `Read-only · ${doc.readonly}` : this.dirty(doc) ? 'Unsaved changes · Ctrl/Cmd+S to save' : 'Saved · UTF-8';
    el('file-conflict').hidden = !doc?.disk && !doc?.error;
    el('file-conflict-message').textContent = doc?.error || (doc?.disk ? 'File changed on disk. Your edits are preserved. Review before replacing either version.' : '');
    el<HTMLButtonElement>('overwrite-file').disabled = !doc?.disk || !available || !!doc?.readonly || !!doc?.saving;
    el<HTMLButtonElement>('review-disk').disabled = !doc?.disk;
    if (!doc?.disk) el('disk-preview').hidden = true;
  }
  private async renderPreview(doc: Document) {
    if (!doc.state) return;
    const text = doc.state.sliceDoc();
    if (this.previewKey === doc.key && this.previewText === text && !this.previewPending) return;
    const generation = ++this.previewGeneration; this.previewPending = true;
    el('markdown-preview').textContent = 'Rendering Markdown…';
    try {
      const { renderMarkdown } = await import('./markdown');
      if (generation !== this.previewGeneration || this.active !== doc.key || !doc.rendered || doc.state?.sliceDoc() !== text) return;
      el('markdown-preview').replaceChildren(renderMarkdown(text, doc.path, path => void this.openFile(doc.host, path, true)));
      this.previewKey = doc.key; this.previewText = text;
    } catch (error) { if (generation === this.previewGeneration) el('markdown-preview').textContent = error instanceof Error ? error.message : String(error); }
    finally { if (generation === this.previewGeneration) this.previewPending = false; }
  }
  private async save(doc: Document) {
    if (!doc.state || doc.saving || doc.readonly || !this.dirty(doc)) return;
    if (this.hosts.find(h => h.id === doc.host)?.connection_revision !== doc.connection) { doc.error = 'Machine connection changed. Reopen this file before saving; your edits have been kept.'; this.renderEditor(); return; }
    const text = doc.state.sliceDoc(); doc.saving = true; this.renderEditor();
    try {
      const data = await request<FileData>(this.url(doc.host, 'file'), 'PUT', { path: doc.path, text, version: doc.version, connection_revision: doc.connection });
      doc.saved = text; doc.version = data.version; doc.disk = undefined; doc.error = undefined;
    } catch (error) { doc.error = error instanceof Error ? error.message : String(error);
      if (error instanceof FileError && error.status === 409) {
        try { const disk = await request<FileData>(this.url(doc.host, 'file', doc.path, doc.connection)); if (!disk.unchanged) doc.disk = disk; } catch { /* Connection/deletion errors retain the original draft and target. */ }
      }
    } finally { doc.saving = false; this.renderTabs(); this.renderEditor(); }
  }
  private async reload(doc: Document) {
    if (doc.saving || (this.dirty(doc) && !window.confirm(`Discard your edits and reload ${this.machineName(doc.host)} › ${doc.path}?`))) return;
    const before = doc.state;
    try {
      const data = await request<FileData>(this.url(doc.host, 'file', doc.path, doc.connection));
      if (doc.state !== before) { doc.error = 'New edits arrived while reloading. Your text has been kept; retry when ready.'; this.renderEditor(); return; }
      doc.saved = data.text; doc.version = data.version; doc.disk = undefined; doc.error = undefined; doc.readonly = data.read_only; doc.state = this.makeState(doc, data.text); if (doc.readonly) doc.saved = doc.state.sliceDoc();
      if (this.active === doc.key) this.view.setState(doc.state); void this.language(doc); this.renderTabs(); this.renderEditor();
    } catch (error) { doc.error = error instanceof Error ? error.message : String(error); this.renderEditor(); }
  }
  private async checkExternal() {
    const doc = this.current(); if (!this.visible || this.checking || !doc?.state || doc.saving || !doc.connection) return;
    this.checking = true;
    const expected = doc.version;
    try {
      const disk = await request<FileData>(this.url(doc.host, 'file', doc.path, doc.connection, doc.version));
      if (doc.saving || doc.version !== expected || !this.documents.has(doc.key) || disk.unchanged) return;
      if (disk.text === doc.saved) { doc.version = disk.version; doc.readonly = disk.read_only; }
      else if (this.dirty(doc)) { doc.disk = disk; }
      else { doc.saved = disk.text; doc.version = disk.version; doc.readonly = disk.read_only; doc.state = this.makeState(doc, disk.text); if (doc.readonly) doc.saved = doc.state.sliceDoc(); if (this.active === doc.key) this.view.setState(doc.state); void this.language(doc); }
      this.renderTabs(); this.renderEditor();
    } catch (error) { doc.error = error instanceof Error ? error.message : String(error); this.renderEditor(); }
    finally { this.checking = false; }
  }
}
