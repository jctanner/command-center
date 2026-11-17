#!/usr/bin/env python3
"""Opt-in remote ACP v1 broker. Its tmux pane owns the agent, never CC/SSH."""
import collections
from datetime import datetime, timezone
import hashlib
import json
import os
import signal
import selectors
import socket
import sqlite3
import stat
import struct
import subprocess
import sys
import threading
import time
import uuid

MAX_WIRE = 8 * 1024 * 1024
MAX_EVENTS = 256
MAX_HISTORY = 128
MAX_QUEUED = 16
QUEUE_TTL = 24 * 60 * 60
COMMAND_TIMEOUT = 120
COMMAND_OUTPUT_BYTES = 32768

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
        self.usage = None
        self.permissions = {}
        self.state, self.session = 'starting', None
        self.turn = None
        self.failure = None
        self.active_command = None
        directory_stat=os.stat(cwd)
        self.directory_identity=(directory_stat.st_dev,directory_stat.st_ino)
        self.host_commands = True
        self.provider = 'claude'
        self.resume_session = None
        self.prompt_session_ready = False
        self.initial_prompt = None
        self.initial_message_id = None
        intent_path = os.path.join(root, 'intent.json')
        if os.path.exists(intent_path):
            private(intent_path)
            with open(intent_path) as initial_file:
                intent = json.load(initial_file)
            prepared=intent.get('prepared',{})
            self.host_commands=not any(key in prepared for key in ('profile','container','container_profile'))
            self.provider = prepared.get('provider', 'claude')
            if self.provider not in ('claude', 'codex'):
                raise ValueError('Unsupported ACP provider')
            self.resume_session = intent.get('resume_session')
            if self.resume_session is not None and (self.provider not in ('codex','claude') or str(uuid.UUID(self.resume_session))!=self.resume_session):
                raise ValueError('Unsupported resume session')
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
        self.db.execute('create table if not exists prompt_queue(id text primary key, instance text not null, session text not null, text text not null, expires real not null)')
        self.db.execute('pragma secure_delete=ON')
        self.db.commit()
        self.server = socket.socket(socket.AF_UNIX)
        self.server.bind(os.path.join(root, 'broker.sock'))
        os.chmod(os.path.join(root, 'broker.sock'), 0o600)
        self.server.listen(8)
        self.connections = threading.BoundedSemaphore(8)
        # Claim metadata before starting a child, so a failed/reused broker cannot orphan it.
        fd = os.open(os.path.join(root, 'live.json'), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        # Queued text belongs to exactly one broker instance; restart never replays it.
        for row in self.db.execute('select id from prompt_queue').fetchall():
            old=self.db.execute('select data from receipts where id=?',row).fetchone()
            if old:
                value=json.loads(old[0]);value['state']='blocked';self.db.execute('update receipts set data=? where id=?',(json.dumps(value),row[0]))
        self.db.execute('delete from prompt_queue')
        self.db.commit()
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
            self.expire_queue()
            queued=self.db.execute('select count(*) from prompt_queue').fetchone()[0]
            blocked=bool(queued and(self.state in ('failed','exited')or self.unresolved_sends()))
            return dict(local_commands=self.host_commands and self.prompt_session_ready,command_running=bool(self.active_command),command_id=self.active_command['id']if self.active_command else None,command_timeout=COMMAND_TIMEOUT,command_output_limit=COMMAND_OUTPUT_BYTES,usage=self.usage,queue_blocked=blocked,prompt_queue=self.prompt_session_ready,queued_prompts=queued,queue_limit=MAX_QUEUED,instance=self.instance, sequence=self.sequence, protocol='acp', provider=self.provider, handoff_supported=self.provider in ('codex','claude'), path=self.cwd, state=self.state, failure=self.failure, session_id=self.session,
                        messages=list(self.messages), tools=list(self.tools.values()), permissions=list(self.permissions.values()), receipts=self.receipt_snapshot())

    def receipt_snapshot(self):
        ids=[m['id']for m in self.messages]
        marks=','.join('?'for _ in ids)or'NULL'
        return [json.loads(row[0])for row in self.db.execute('select data from receipts where id in ('+marks+') or id in (select id from prompt_queue) or id=? or rowid in (select rowid from receipts order by rowid desc limit 40) order by rowid desc',(*ids,self.turn))]

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
            if self.resume_session:
                if reply.get('result',{}).get('agentCapabilities',{}).get('loadSession') is not True:
                    self.fail('Adapter does not support session/load; original session was not replaced with a new one');return
                self.session=self.resume_session
                self.rpc('session/load', dict(cwd=self.cwd,mcpServers=[],sessionId=self.resume_session),created)
            else:self.rpc('session/new', dict(cwd=self.cwd, mcpServers=[]), created)
        def created(reply):
            session = reply.get('result', {}).get('sessionId',self.resume_session)
            if 'error' in reply or self.resume_session and session!=self.resume_session:
                self.fail('Exact session/load failed; no new conversation created');return
            if not isinstance(session, str) or not session or len(session) > 512:
                self.fail('Session creation/authentication failed; inspect adapter login outside CC')
                return
            with self.lock:
                self.session, self.state = session, 'approval' if self.permissions else 'ready'
                self.prompt_session_ready=True
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
                    self.fail('ACP frame exceeds the 8 MiB adapter limit; session replay stopped. No automatic retry.');return
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
        if kind=='usage_update':
            def count(value,positive=False):
                return value if type(value)is int and (value>0 if positive else value>=0)and value<=9007199254740991 else None
            used=count(update.get('used'));size=count(update.get('size'),True)
            if used is None and size is None:return
            model=(update.get('_meta')or{}).get('_claude/model')if self.provider=='claude'and isinstance(update.get('_meta',{}),dict)else None
            if not isinstance(model,str)or not model or len(model)>128 or any(ord(c)<32 for c in model):model=None
            self.usage=dict(used=used,size=size,model=model,observed_at=int(time.time()),reported_at=datetime.now(timezone.utc).isoformat())
            self.emit();return
        if kind == 'agent_message_chunk' or kind=='user_message_chunk' and self.state=='starting' and self.resume_session:
            role='user' if kind=='user_message_chunk' else 'assistant'
            content = update.get('content', {})
            if content.get('type') == 'text' and isinstance(content.get('text'), str):
                text = content['text'][:24000]
                message=(self.messages[-1]if self.messages and self.messages[-1]['role']==role and self.messages[-1].get('turn')is None else None)if self.turn is None else next((m for m in reversed(self.messages)if m['role']==role and m.get('turn')==self.turn),None)
                if message is None:
                    message=dict(id=str(uuid.uuid4()),role=role,text='',turn=self.turn);self.messages.append(message)
                message['text']=(message['text']+text)[-64000:]
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

    def expire_queue(self):
        rows=self.db.execute('select id from prompt_queue where expires<=?',(time.time(),)).fetchall()
        for (ident,) in rows:
            value=json.loads(self.db.execute('select data from receipts where id=?',(ident,)).fetchone()[0])
            self.db.execute('delete from prompt_queue where id=?',(ident,))
            self.finish_receipt(value,'expired')

    def unresolved_sends(self):
        return any(r.get('state')in ('claimed','uncertain')or r.get('kind')in ('prompt','local_command')and r.get('state')in ('submitted','blocked')or r.get('kind')=='prompt'and r.get('state')=='failed'for r in (json.loads(row[0])for row in self.db.execute('select data from receipts')))

    def drain_queue(self,raise_io=False):
        # Always called under the dispatcher lock, never concurrent session/prompt.
        self.expire_queue()
        if self.state!='ready' or self.permissions or self.closed or self.active_command:return
        if self.unresolved_sends():return
        row=self.db.execute('select id,instance,session,text from prompt_queue order by rowid limit 1').fetchone()
        if not row:return
        ident,instance,session,text=row
        value=json.loads(self.db.execute('select data from receipts where id=?',(ident,)).fetchone()[0])
        if instance!=self.instance or session!=self.session:
            self.db.execute('delete from prompt_queue where id=?',(ident,));self.finish_receipt(value,'blocked');return
        # Remove text and persist the claim before any adapter IO. A crash or lost
        # reply is never a reason to replay this intent.
        self.db.execute('delete from prompt_queue where id=?',(ident,))
        self.finish_receipt(value,'claimed')
        if value['kind']=='local_command':
            self.start_local_command(value,text);return
        self.state='working';self.turn=ident
        def completed(reply):
            with self.lock:
                self.state='ready'if 'error'not in reply else'failed'
                self.permissions.clear();self.calls.clear()
                self.finish_receipt(value,'completed'if 'error'not in reply else'failed')
                self.drain_queue()
            display('\n[turn %s]\n> '%self.state,end='',flush=True)
        try:
            self.rpc('session/prompt',dict(sessionId=self.session,prompt=[dict(type='text',text=text)]),completed)
            self.finish_receipt(value,'submitted')
        except Exception:
            self.finish_receipt(value,'uncertain');self.state='failed';self.emit()
            if raise_io:raise

    def trim_messages(self):
        self.messages=self.messages[-MAX_HISTORY:]
        while len(json.dumps(self.messages).encode())>256000 and len(self.messages)>1:del self.messages[0]

    def stop_local_command(self,command):
        process=command.get('process')
        command['cancelled']=True;command['cancel_at']=time.monotonic()
        if process is not None:
            if process.poll() is None and command.get('start') is not None and start_identity(process.pid)!=command['start']:raise ValueError('Local command process changed')
            try:os.killpg(process.pid,signal.SIGTERM)
            except ProcessLookupError:pass

    def start_local_command(self,value,text):
        command=dict(id=value['id'],process=None,cancelled=False);self.active_command=command
        try:
            directory=os.open(self.cwd,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
            try:
                st=os.fstat(directory)
                if (st.st_dev,st.st_ino)!=self.directory_identity:raise ValueError('Project directory changed')
                process=subprocess.Popen(['/bin/sh','-c',text.lstrip()[1:].lstrip()],cwd='/proc/self/fd/'+str(directory),pass_fds=(directory,),env={**os.environ,'PWD':self.cwd},stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
            finally:os.close(directory)
            command['process']=process;command['start']=start_identity(process.pid)
            command['output_id']=str(uuid.uuid4())
            self.messages.append(dict(id=command['output_id'],role='assistant',kind='command_output',turn=value['id'],text='Running command…'));self.trim_messages()
            self.finish_receipt(value,'submitted')
        except Exception:
            if command.get('process') is not None:
                self.stop_local_command(command)
                try:command['process'].wait(timeout=2)
                except subprocess.TimeoutExpired:
                    try:os.killpg(command['process'].pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    command['process'].wait(timeout=3)
                for stream in (command['process'].stdout,command['process'].stderr):stream.close()
                self.finish_receipt(value,'uncertain')
            else:self.finish_receipt(value,'failed')
            self.messages.append(dict(id=str(uuid.uuid4()),role='assistant',kind='command_output',turn=value['id'],text='Local command could not start; project directory or shell unavailable. No retry made.'))
            self.active_command=None;self.trim_messages();self.emit()
            if value['state']!='uncertain':self.drain_queue()
            return
        worker=threading.Thread(target=self.run_local_command,args=(command,value),daemon=True);command['thread']=worker;worker.start()

    def run_local_command(self,command,value):
        process=command['process'];selector=selectors.DefaultSelector();output={'stdout':bytearray(),'stderr':bytearray()};total=0;truncated=False;timed_out=False;uncertain=False
        deadline=time.monotonic()+COMMAND_TIMEOUT;last_emit=0;killed=False;kill_at=None
        try:
            for name in output:selector.register(getattr(process,name),selectors.EVENT_READ,name)
            while selector.get_map() or process.poll() is None:
                now=time.monotonic()
                if not killed and(now>=deadline or command.get('cancelled')and now-command.get('cancel_at',now)>2):
                    killed=True;kill_at=now
                    timed_out=not command.get('cancelled');
                    try:os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    deadline=float('inf')
                if kill_at is not None and now-kill_at>2:
                    truncated=True
                    break
                if not selector.get_map():time.sleep(.05)
                for key,_ in selector.select(.1):
                    data=os.read(key.fileobj.fileno(),4096)
                    if not data:selector.unregister(key.fileobj);continue
                    allowed=min(len(data),max(0,COMMAND_OUTPUT_BYTES-total));output[key.data].extend(data[:allowed]);total+=allowed;truncated|=allowed<len(data)
                    if time.monotonic()-last_emit>=.1:
                        with self.lock:
                            stdout=bytes(output['stdout']).decode('utf-8','replace');stderr=bytes(output['stderr']).decode('utf-8','replace')
                            text=stdout+('\n'if stdout and stderr else'')+('stderr:\n'+stderr if stderr else'')
                            message=next((m for m in self.messages if m['id']==command['output_id']),None)
                            if message is not None:message['text']=text or 'Running command…'
                            self.trim_messages();self.emit()
                        last_emit=time.monotonic()
            process.wait(timeout=3)
        except Exception:
            uncertain=True
            try:os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=3)
            except (ProcessLookupError,subprocess.TimeoutExpired):pass
        finally:
            selector.close();process.stdout.close();process.stderr.close()
            with self.lock:
                stdout=bytes(output['stdout']).decode('utf-8','replace');stderr=bytes(output['stderr']).decode('utf-8','replace')
                text=stdout+('\n'if stdout and stderr else'')+('stderr:\n'+stderr if stderr else'')
                if not text:text='(command produced no output)'
                if truncated:text+='\n[Output truncated]'
                if timed_out:text+='\n[Command timed out]'
                if command.get('cancelled'):text+='\n[Command cancelled]'
                text+='\n[Exit '+str(process.returncode)+']'
                try:display('\n'+text,flush=True)
                except OSError:pass
                message=next((m for m in self.messages if m['id']==command['output_id']),None)
                if message is not None:message['text']=text
                else:self.messages.append(dict(id=command['output_id'],role='assistant',kind='command_output',turn=value['id'],text=text))
                value.update(exit_code=process.returncode,timed_out=timed_out,output_truncated=truncated)
                self.finish_receipt(value,'uncertain'if uncertain else'cancelled'if command.get('cancelled')else'completed')
                self.active_command=None;self.trim_messages();self.emit();self.drain_queue()

    def dispatch(self, request):
        with self.lock:
            action = request.get('action')
            if action == 'snapshot':
                return self.snapshot()
            if request.get('instance') != self.instance:
                raise ValueError('Stale broker process instance')
            ident = request.get('id', '')
            if action == 'handoff':
                if self.db.execute('select id from receipts where id=?',(ident,)).fetchone():return self.receipt(ident,request)[0]
                unresolved=any(r.get('state')in ('claimed','uncertain')or r.get('kind')=='prompt'and r.get('state')not in ('completed','cancelled','expired')or r.get('kind')=='local_command'and r.get('state')not in ('completed','cancelled','expired','failed')for r in (json.loads(row[0])for row in self.db.execute('select data from receipts')))
                if self.provider not in ('codex','claude') or self.state!='ready' or self.permissions or self.active_command or unresolved or any(t.get('status')in ('pending','in_progress')for t in self.tools.values()):
                    raise ValueError('Handoff requires an idle agent with no unresolved receipts')
                value,_=self.receipt(ident,request);self.state='switching';self.emit()
                try:
                    if self.agent.poll() is None:os.killpg(self.agent.pid,signal.SIGTERM)
                    self.agent.wait(timeout=5)
                    self.finish_receipt(value,'completed')
                except Exception:
                    self.finish_receipt(value,'uncertain');raise
                return value
            if action in ('prompt','local_command'):
                text = request.get('text')
                if not isinstance(text, str) or not text.strip() or len(text.encode()) > 12000 or any(ord(c) < 32 and c not in '\n\t' for c in text):
                    raise ValueError('Prompt must be 1–12000 UTF-8 bytes without control characters')
                if action=='local_command'and(not self.host_commands or not text.lstrip().startswith('!')or not text.lstrip()[1:].strip()):raise ValueError('Direct local commands unavailable or empty; nothing executed')
                row=self.db.execute('select id from receipts where id=?',(ident,)).fetchone()
                self.expire_queue()
                if not row:
                    if self.state not in ('ready','working','approval')or not self.prompt_session_ready:raise ValueError('Agent session is not ready for prompt queuing')
                    if self.db.execute('select count(*) from prompt_queue').fetchone()[0]>=MAX_QUEUED:raise ValueError('Prompt queue is full; keep your draft')
                value,fresh=self.receipt(ident,request)
                if not fresh:return value
                value['state']='queued'
                self.db.execute('insert into prompt_queue values(?,?,?,?,?)',(ident,self.instance,self.session,text,time.time()+QUEUE_TTL))
                self.db.execute('update receipts set data=? where id=?',(json.dumps(value),ident));self.db.commit()
                self.messages.append(dict(id=ident,role='user',text=text,**({'kind':'command'}if action=='local_command'else{})));self.messages=self.messages[-MAX_HISTORY:]
                while len(json.dumps(self.messages).encode())>256000 and len(self.messages)>1:del self.messages[0]
                self.emit();self.drain_queue(raise_io=True)
                return json.loads(self.db.execute('select data from receipts where id=?',(ident,)).fetchone()[0])
            if action=='cancel_command':
                if self.db.execute('select id from receipts where id=?',(ident,)).fetchone():return self.receipt(ident,request)[0]
                command=self.active_command
                if not command or command['id']!=request.get('command'):raise ValueError('Local command is no longer running')
                value,_=self.receipt(ident,request)
                try:
                    self.stop_local_command(command);self.finish_receipt(value,'completed')
                except Exception:self.finish_receipt(value,'uncertain');raise
                return value
            if action == 'cancel_queued':
                if self.db.execute('select id from receipts where id=?',(ident,)).fetchone():return self.receipt(ident,request)[0]
                queued=request.get('prompt')
                if not self.db.execute('select id from prompt_queue where id=? and instance=? and session=?',(queued,self.instance,self.session)).fetchone():raise ValueError('Prompt is no longer queued; active turns require Cancel turn')
                value,_=self.receipt(ident,request)
                original=json.loads(self.db.execute('select data from receipts where id=?',(queued,)).fetchone()[0])
                self.db.execute('delete from prompt_queue where id=?',(queued,));self.finish_receipt(original,'cancelled');self.finish_receipt(value,'completed');return value
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
            with self.lock:
                closing_command=self.active_command
                if closing_command:self.stop_local_command(closing_command)
                for (ident,) in self.db.execute('select id from prompt_queue').fetchall():
                    value=json.loads(self.db.execute('select data from receipts where id=?',(ident,)).fetchone()[0]);self.db.execute('delete from prompt_queue where id=?',(ident,));self.finish_receipt(value,'cancelled')
            if closing_command and closing_command.get('process')is not None:
                process=closing_command['process']
                try:process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    try:os.killpg(process.pid,signal.SIGKILL)
                    except ProcessLookupError:pass
                    process.wait(timeout=3)
                if closing_command.get('thread'):closing_command['thread'].join(timeout=3)
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
        signal.signal(signal.SIGHUP, stop)
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
                self.terminal_action(dict(action='local_command'if text.lstrip().startswith('!')else'prompt', text=text))

    def terminal_action(self, request):
        try:
            display(self.dispatch(dict(request, instance=self.instance, id=str(uuid.uuid4()))), flush=True)
        except Exception as error:
            display(str(error), flush=True)

    def cancel_terminal(self):
        self.terminal_action(dict(action='cancel_command',command=self.active_command['id'])if self.active_command else dict(action='cancel'))

if __name__ == '__main__':
    Broker(sys.argv[1], sys.argv[2], sys.argv[3]).run()
