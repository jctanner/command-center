#!/usr/bin/env python3
"""Opt-in remote ACP v1 broker. Its tmux pane owns the agent, never CC/SSH."""
import collections
import hashlib
import json
import os
import signal
import socket
import sqlite3
import stat
import struct
import subprocess
import sys
import threading
import time
import uuid

MAX_WIRE = 1024 * 1024
MAX_EVENTS = 256
MAX_HISTORY = 128

def start_identity(pid):
    with open('/proc/%d/stat' % pid) as f:
        return f.read().rsplit(')', 1)[1].split()[19]

def private(path, directory=False):
    st = os.lstat(path)
    if st.st_uid != os.getuid() or st.st_mode & 0o077 or not (stat.S_ISDIR(st.st_mode) if directory else stat.S_ISREG(st.st_mode)):
        raise ValueError('Unsafe broker file permissions')
    return st

def display(*args, **kwargs):
    # Agent text must not inject terminal controls (OSC clipboard writes, etc.).
    def safe(text):
        return ''.join(c if c in '\n\t' or ord(c) >= 32 and not 127 <= ord(c) <= 159 else '\ufffd' for c in str(text))
    print(*(safe(arg) for arg in args), **kwargs)

def send_line(stream, data):
    raw = json.dumps(data, ensure_ascii=False).encode() + b'\n'
    if len(raw) > MAX_WIRE:
        raise ValueError('Broker response too large')
    stream.write(raw)
    stream.flush()

class Broker:
    def __init__(self, root, executable, cwd):
        os.umask(0o077)
        private(root, True)
        self.root, self.cwd = root, cwd
        self.lock = threading.RLock()
        self.changed = threading.Condition(self.lock)
        self.writer = threading.Lock()
        self.pending = {}
        self.calls = {}
        self.events = collections.deque(maxlen=MAX_EVENTS)
        self.sequence = 0
        self.instance = str(uuid.uuid4())
        self.messages = []
        self.tools = {}
        self.permissions = {}
        self.state, self.session = 'starting', None
        self.turn = None
        self.failure = None
        self.provider = 'claude'
        self.initial_prompt = None
        self.initial_message_id = None
        intent_path = os.path.join(root, 'intent.json')
        if os.path.exists(intent_path):
            private(intent_path)
            with open(intent_path) as initial_file:
                intent = json.load(initial_file)
            self.provider = intent.get('prepared', {}).get('provider', 'claude')
            if self.provider not in ('claude', 'codex'):
                raise ValueError('Unsupported ACP provider')
            prompt = intent.pop('initial_prompt', None)
            if prompt:
                if not isinstance(prompt, str) or len(prompt.encode()) > 12000:
                    raise ValueError('Invalid initial prompt')
                self.initial_prompt, self.initial_message_id = prompt, intent['id']
                intent['initial_prompt_sha256'] = hashlib.sha256(prompt.encode()).hexdigest()
                intent['initial_prompt_bytes'] = len(prompt.encode())
            temporary = intent_path + '.redacted-' + str(uuid.uuid4())
            fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as out:
                json.dump(intent, out);out.flush();os.fsync(out.fileno())
            os.replace(temporary, intent_path)
        self.closed = False
        self.db = sqlite3.connect(os.path.join(root, 'receipts.sqlite3'), check_same_thread=False)
        self.db.execute('pragma synchronous=FULL')
        self.db.execute('create table if not exists receipts(id text primary key, digest text, data text)')
        self.db.commit()
        self.server = socket.socket(socket.AF_UNIX)
        self.server.bind(os.path.join(root, 'broker.sock'))
        os.chmod(os.path.join(root, 'broker.sock'), 0o600)
        self.server.listen(8)
        self.connections = threading.BoundedSemaphore(8)
        # Claim metadata before starting a child, so a failed/reused broker cannot orphan it.
        fd = os.open(os.path.join(root, 'live.json'), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        try:
            # stdout belongs exclusively to ACP. Own a separate process group for cleanup.
            self.agent = subprocess.Popen([executable], cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            with open('/proc/sys/kernel/random/boot_id') as boot_file:
                boot = boot_file.read().strip()
            meta = dict(instance=self.instance, pid=os.getpid(), start=start_identity(os.getpid()), boot=boot, agent_pid=self.agent.pid, path=cwd, protocol='acp', provider=self.provider)
            with os.fdopen(fd, 'w') as f:
                json.dump(meta, f)
        except Exception:
            self.server.close()
            if hasattr(self, 'agent'):
                os.killpg(self.agent.pid, signal.SIGTERM)
            raise
        threading.Thread(target=self.read_agent, daemon=True).start()
        threading.Thread(target=self.drain_stderr, daemon=True).start()
        threading.Thread(target=self.accept, daemon=True).start()
        threading.Thread(target=self.initialize, daemon=True).start()
        threading.Thread(target=self.initialization_deadline, daemon=True).start()

    def initialization_deadline(self):
        time.sleep(60)
        if self.state == 'starting':
            self.fail('ACP initialization timed out; no session or prompt was retried')

    def emit(self):
        with self.changed:
            self.sequence += 1
            # Keep only an invalidation cursor, never duplicate full histories in a ring.
            self.events.append(self.sequence)
            self.changed.notify_all()

    def snapshot(self):
        with self.lock:
            return dict(instance=self.instance, sequence=self.sequence, protocol='acp', provider=self.provider, path=self.cwd, state=self.state, failure=self.failure, session_id=self.session,
                        messages=list(self.messages), tools=list(self.tools.values()), permissions=list(self.permissions.values()), receipts=[json.loads(r[0]) for r in self.db.execute('select data from receipts order by rowid desc limit 40')])

    def rpc(self, method, params, callback):
        ident = str(uuid.uuid4())
        with self.lock:
            self.pending[ident] = callback
        self.write(dict(jsonrpc='2.0', id=ident, method=method, params=params))
        return ident

    def write(self, message):
        with self.writer:
            if self.agent.poll() is not None:
                raise ValueError('ACP agent exited; no retry')
            send_line(self.agent.stdin, message)

    def initialize(self):
        def initialized(reply):
            if 'error' in reply or reply.get('result', {}).get('protocolVersion') != 1:
                self.fail('ACP v1 initialization failed')
                return
            self.rpc('session/new', dict(cwd=self.cwd, mcpServers=[]), created)
        def created(reply):
            session = reply.get('result', {}).get('sessionId')
            if not isinstance(session, str) or not session or len(session) > 512:
                self.fail('Session creation/authentication failed; inspect adapter login outside CC')
                return
            with self.lock:
                self.session, self.state = session, 'ready'
            self.emit()
            if self.initial_prompt:
                prompt,self.initial_prompt=self.initial_prompt,None
                try:
                    self.dispatch(dict(action='prompt',instance=self.instance,id=self.initial_message_id,text=prompt))
                except Exception:
                    self.fail('Initial prompt delivery could be uncertain; inspect its receipt, never retry automatically')
            display('\nACP ready. Type a prompt. /status, /cancel, /approve REQUEST OPTION, /quit', flush=True)
        self.rpc('initialize', dict(protocolVersion=1, clientInfo=dict(name='command-center-broker', version='0.1'), clientCapabilities={}), initialized)

    def fail(self, reason):
        with self.lock:
            self.state = 'failed'
            self.failure = reason
        display('\n' + reason, flush=True)
        self.emit()

    def drain_stderr(self):
        # SDK logs may contain sensitive material; do not persist or publish raw stderr.
        while self.agent.stderr.read(4096):
            pass

    def read_agent(self):
        try:
            while True:
                raw = self.agent.stdout.readline(MAX_WIRE + 1)
                if not raw:
                    break
                if len(raw) > MAX_WIRE:
                    raise ValueError('Oversized ACP frame')
                message = json.loads(raw)
                with self.lock:
                    if 'method' not in message:
                        callback = self.pending.pop(message.get('id'), None)
                        if callback:
                            callback(message)
                    elif message['method'] == 'session/update' and message.get('params', {}).get('sessionId') == self.session:
                        self.update(message['params']['update'])
                    elif message['method'] == 'session/request_permission' and 'id' in message:
                        self.permission(message)
                    elif 'id' in message:
                        self.write(dict(jsonrpc='2.0', id=message['id'], error=dict(code=-32601, message='Client capability not supported')))
        except (OSError, ValueError, KeyError, TypeError):
            self.fail('ACP stream failed; outstanding deliveries are uncertain and will not be replayed')
        finally:
            with self.lock:
                self.state = 'exited' if self.agent.poll() is not None else 'failed'
                for permission in self.permissions.values():
                    permission['expired'] = True
            self.emit()

    def update(self, update):
        kind = update.get('sessionUpdate')
        if kind == 'agent_message_chunk':
            content = update.get('content', {})
            if content.get('type') == 'text' and isinstance(content.get('text'), str):
                text = content['text'][:24000]
                if not self.messages or self.messages[-1]['role'] != 'assistant' or self.messages[-1].get('turn') != self.turn:
                    self.messages.append(dict(id=str(uuid.uuid4()), role='assistant', text='', turn=self.turn))
                self.messages[-1]['text'] = (self.messages[-1]['text'] + text)[-64000:]
                self.messages = self.messages[-MAX_HISTORY:]
                display(text, end='', flush=True)
        elif kind in ('tool_call', 'tool_call_update'):
            ident = update.get('toolCallId')
            if isinstance(ident, str):
                old = self.tools.get(ident, dict(id=ident))
                old.update({k: str(update[k])[:1000] for k in ('title', 'kind', 'status') if k in update})
                self.tools[ident] = old
                if len(self.tools) > 100:
                    del self.tools[next(iter(self.tools))]
                display('\n[tool] ' + old.get('title', ident) + ' ' + old.get('status', ''), flush=True)
        # Never expose/persist hidden thought chunks or arbitrary tool-result payloads.
        else:
            return
        while len(json.dumps(self.messages).encode()) > 256000 and len(self.messages) > 1:
            del self.messages[0]
        self.emit()

    def permission(self, message):
        params = message.get('params', {})
        if params.get('sessionId') != self.session or len(self.permissions) >= 8:
            self.write(dict(jsonrpc='2.0', id=message['id'], result=dict(outcome=dict(outcome='cancelled'))))
            return
        ident = str(uuid.uuid4())
        options = params.get('options', [])
        if not isinstance(options, list) or not options or len(options) > 10:
            raise ValueError('Unsupported permission request')
        options = [{k: str(o.get(k, ''))[:500] for k in ('optionId', 'name', 'kind')} for o in options]
        tool = params.get('toolCall', {})
        if len(json.dumps(tool).encode()) > 16384:
            self.write(dict(jsonrpc='2.0', id=message['id'], result=dict(outcome=dict(outcome='cancelled'))))
            self.fail('Permission request exceeds supported display size; no approval sent')
            return
        self.calls[ident] = message['id']
        self.permissions[ident] = dict(id=ident, revision=str(uuid.uuid4()), title=str(tool.get('title', 'Tool permission'))[:2000], tool=tool, options=options)
        display('\nPERMISSION ' + ident + ': ' + self.permissions[ident]['title'], flush=True)
        for option in options:
            display('  %s [%s]: %s' % (option['optionId'], option['kind'], option['name']), flush=True)
        self.state = 'approval'
        self.emit()

    def receipt(self, ident, payload):
        uuid.UUID(ident)
        digest = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        row = self.db.execute('select digest,data from receipts where id=?', (ident,)).fetchone()
        if row:
            if row[0] != digest:
                raise ValueError('Receipt UUID reused for a different action')
            return json.loads(row[1]), False
        if self.db.execute('select count(*) from receipts').fetchone()[0] >= 512:
            raise ValueError('Receipt capacity reached')
        value = dict(id=ident, state='claimed', kind=payload['action'], at=time.time())
        self.db.execute('insert into receipts values(?,?,?)', (ident, digest, json.dumps(value)))
        self.db.commit() # Intent before ACP IO; never replay claimed/uncertain receipts.
        return value, True

    def finish_receipt(self, value, state):
        value['state'] = state
        self.db.execute('update receipts set data=? where id=?', (json.dumps(value), value['id']))
        self.db.commit()
        self.emit()

    def dispatch(self, request):
        with self.lock:
            action = request.get('action')
            if action == 'snapshot':
                return self.snapshot()
            if request.get('instance') != self.instance:
                raise ValueError('Stale broker process instance')
            ident = request.get('id', '')
            if action == 'prompt':
                text = request.get('text')
                if not isinstance(text, str) or not text.strip() or len(text.encode()) > 12000 or any(ord(c) < 32 and c not in '\n\t' for c in text):
                    raise ValueError('Prompt must be 1–12000 UTF-8 bytes without control characters')
                # Duplicate checking precedes state validation, but never repeats IO.
                row = self.db.execute('select id from receipts where id=?', (ident,)).fetchone()
                if not row and self.state != 'ready':
                    raise ValueError('Agent not ready; prompt was not queued or sent')
                value, fresh = self.receipt(ident, request)
                if not fresh:
                    return value
                self.state = 'working'
                self.turn = ident
                self.messages.append(dict(id=ident, role='user', text=text))
                self.messages = self.messages[-MAX_HISTORY:]
                def completed(reply):
                    with self.lock:
                        self.state = 'ready' if 'error' not in reply else 'failed'
                        self.permissions.clear();self.calls.clear()
                        self.finish_receipt(value, 'completed' if 'error' not in reply else 'failed')
                    display('\n[turn %s]\n> ' % self.state, end='', flush=True)
                try:
                    self.rpc('session/prompt', dict(sessionId=self.session, prompt=[dict(type='text', text=text)]), completed)
                    self.finish_receipt(value, 'submitted')
                except Exception:
                    self.finish_receipt(value, 'uncertain')
                    self.state = 'failed'
                    raise
                return value
            if action == 'permission':
                old = self.db.execute('select id from receipts where id=?', (ident,)).fetchone()
                if old:
                    return self.receipt(ident, request)[0]
                prompt = self.permissions.get(request.get('permission'))
                if not prompt or prompt.get('expired') or prompt['revision'] != request.get('revision') or self.state != 'approval':
                    raise ValueError('Permission no longer pending')
                option = request.get('option')
                if not any(o['optionId'] == option for o in prompt['options']):
                    raise ValueError('Unsupported permission option')
                value, _ = self.receipt(ident, request)
                call = self.calls.pop(prompt['id'])
                del self.permissions[prompt['id']]
                self.state = 'approval' if self.permissions else 'working'
                try:
                    self.write(dict(jsonrpc='2.0', id=call, result=dict(outcome=dict(outcome='selected', optionId=option))))
                    self.finish_receipt(value, 'submitted')
                except Exception:
                    self.finish_receipt(value, 'uncertain')
                    raise
                return value
            if action == 'cancel':
                value, fresh = self.receipt(ident, request)
                if fresh:
                    try:
                        self.write(dict(jsonrpc='2.0', method='session/cancel', params=dict(sessionId=self.session)))
                        for call in self.calls.values():
                            self.write(dict(jsonrpc='2.0', id=call, result=dict(outcome=dict(outcome='cancelled'))))
                        self.permissions.clear();self.calls.clear()
                        self.finish_receipt(value, 'submitted')
                    except Exception:
                        self.finish_receipt(value, 'uncertain')
                        raise
                return value
            raise ValueError('Unknown broker action')

    def accept(self):
        while not self.closed:
            connection, _ = self.server.accept()
            if not self.connections.acquire(False):
                connection.close()
                continue
            threading.Thread(target=self.serve_client, args=(connection,), daemon=True).start()

    def serve_client(self, connection):
        stream = None
        try:
            # A private socket alone is insufficient if its ancestors were replaced.
            _, uid, _ = struct.unpack('3i', connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != os.getuid():
                return
            connection.settimeout(10)
            stream = connection.makefile('rwb')
            raw = stream.readline(20000)
            if not raw.endswith(b'\n'):
                raise ValueError('Request too large')
            request = json.loads(raw)
            if request.get('action') == 'watch':
                if request.get('instance') != self.instance:
                    raise ValueError('Stale broker instance')
                cursor = -1
                last_sent = 0
                while not self.closed:
                    with self.changed:
                        if cursor == self.sequence:
                            self.changed.wait(10)
                    # Coalesce token bursts, at most ten snapshots/sec per viewer.
                    time.sleep(max(0, .1 - (time.monotonic() - last_sent)))
                    with self.changed:
                        cursor = self.sequence
                        snapshot = self.snapshot()
                    send_line(stream, dict(ok=snapshot))
                    last_sent = time.monotonic()
            else:
                send_line(stream, dict(ok=self.dispatch(request)))
        except (OSError, ValueError, KeyError, TypeError) as error:
            try:
                if stream is not None:
                    send_line(stream, dict(error=str(error)[:300]))
            except OSError:
                pass
        finally:
            if stream is not None:
                try:stream.close()
                except OSError:pass
            connection.close()
            self.connections.release()

    def run(self):
        def stop(*_):
            self.closed = True
            if self.agent.poll() is None:
                try:os.killpg(self.agent.pid, signal.SIGTERM)
                except ProcessLookupError:pass
                try:
                    self.agent.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    if self.agent.poll() is None:
                        try:os.killpg(self.agent.pid, signal.SIGKILL)
                        except ProcessLookupError:pass
            raise SystemExit(0)
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, lambda *_: self.cancel_terminal())
        display('CC ACP broker (experimental). CC may disconnect; this pane remains usable.', flush=True)
        while not self.closed and self.agent.poll() is None:
            try:
                text = input('> ')
            except EOFError:
                # Remain alive even if terminal stdin closes; socket clients still work.
                self.agent.wait()
                break
            if text == '/quit':
                stop()
            elif text == '/status':
                display(self.state, self.session or '', flush=True)
            elif text == '/cancel':
                self.cancel_terminal()
            elif text.startswith('/approve '):
                parts = text.split()
                if len(parts) == 3:
                    prompt = self.permissions.get(parts[1])
                    if prompt:
                        self.terminal_action(dict(action='permission', permission=parts[1], revision=prompt['revision'], option=parts[2]))
            elif text.strip():
                self.terminal_action(dict(action='prompt', text=text))

    def terminal_action(self, request):
        try:
            display(self.dispatch(dict(request, instance=self.instance, id=str(uuid.uuid4()))), flush=True)
        except Exception as error:
            display(str(error), flush=True)

    def cancel_terminal(self):
        self.terminal_action(dict(action='cancel'))

if __name__ == '__main__':
    Broker(sys.argv[1], sys.argv[2], sys.argv[3]).run()
