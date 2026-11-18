"""Trusted request helper for the opt-in ACP broker; invoked via shared transport."""
import hashlib
import json
import os
import shlex
import shutil
import socket
import signal
import sqlite3
import stat
import subprocess
import sys
import time
import uuid

class MissingAdapter(ValueError):
    pass

LIMIT = 1024 * 1024

def canonical_uuid(value):
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError('Invalid broker UUID')
    return value

def safe_directory(path, create=False, private=False):
    path = os.path.abspath(path)
    if create:
        parent = os.path.dirname(path)
        if not os.path.exists(parent):
            safe_directory(parent, True)
        try:
            os.mkdir(path, 0o700)
        except FileExistsError:
            pass
    st = os.lstat(path)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & (0o077 if private else 0o022):
        raise ValueError('Unsafe broker directory')
    # Reject symlink ancestors, including the cache root.
    if os.path.realpath(path) != path:
        raise ValueError('Symlinked broker directory')
    return path

def root(create=False):
    home = os.path.expanduser('~')
    if not os.path.isabs(home):
        raise ValueError('Home unavailable')
    path = os.path.join(home, '.cache', 'command-center', 'acp')
    for ancestor in [home, os.path.join(home, '.cache'), os.path.join(home, '.cache', 'command-center')]:
        if os.path.lexists(ancestor):
            safe_directory(ancestor)
    if create:
        safe_directory(path, True, True)
    return path

def regular(path):
    st = os.lstat(path)
    if not stat.S_ISREG(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077 or st.st_nlink != 1:
        raise ValueError('Unsafe broker file')
    return st

def read_json(path):
    regular(path)
    with open(path, 'rb') as f:
        data = f.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError('Broker record too large')
    return json.loads(data)

def exclusive_json(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump(value, f)
        f.flush()
        os.fsync(f.fileno())

def identity(path):
    st = os.stat(path)
    return [st.st_dev, st.st_ino, st.st_mtime_ns, st.st_size]

def options(request):
    if not os.path.isdir('/proc/self') or not hasattr(os,'pidfd_open') or not hasattr(signal,'pidfd_send_signal'):
        raise ValueError('ACP broker requires Linux /proc and pidfd support; native mode remains available')
    provider = request.get('provider', 'claude')
    if provider not in ('claude', 'codex'):
        raise ValueError('Unsupported ACP provider')
    name = 'codex-acp' if provider == 'codex' else 'claude-agent-acp'
    path = request.get('path')
    if not isinstance(path, str) or not path.startswith(('/', '~/')) or len(path) > 4096 or any(ord(c) < 32 for c in path):
        raise ValueError('Use an absolute project directory')
    path = os.path.realpath(os.path.expanduser(path))
    if not os.path.isdir(path) or not os.access(path, os.R_OK | os.X_OK):
        raise ValueError('Project directory unavailable')
    executable = shutil.which(name)
    managed = os.path.expanduser('~/.local/share/command-center/acp-adapters/'+provider+'/node_modules/.bin/'+name)
    if not executable and os.path.isfile(managed):
        executable = managed
    if not executable:
        raise MissingAdapter(provider.title()+' ACP adapter not installed on this machine; native mode remains available')
    executable = os.path.realpath(executable)
    if not os.access(executable, os.X_OK):
        raise ValueError('ACP adapter is not executable')
    if not shutil.which('tmux'):
        raise ValueError('tmux unavailable')
    return dict(path=path, directory_identity=identity(path)[:2], executable=executable, executable_identity=identity(executable), protocol='acp', provider=provider)

def tmux(request, *args):
    command = ['tmux']
    if request.get('socket'):
        command += ['-S', request['socket']]
    result = subprocess.run(command + list(args), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8)
    if result.returncode:
        raise ValueError('tmux operation failed; check the same broker UUID before any new launch')
    return result.stdout.decode().strip()

def target_root(request):
    path = os.path.join(root(), canonical_uuid(request['broker']))
    safe_directory(root(), private=True)
    safe_directory(path, private=True)
    return path

def verified_live(path):
    live = read_json(os.path.join(path, 'live.json'))
    with open('/proc/sys/kernel/random/boot_id') as f:
        if live.get('boot') != f.read().strip():
            raise ValueError('Broker belongs to an earlier boot')
    pid = live['pid']
    if not isinstance(pid, int) or pid < 1:
        raise ValueError('Invalid broker process')
    with open('/proc/%d/stat' % pid) as f:
        start = f.read().rsplit(')', 1)[1].split()[19]
    if start != live['start'] or os.stat('/proc/%d' % pid).st_uid != os.getuid():
        raise ValueError('Broker process replaced')
    with open('/proc/%d/cmdline' % pid, 'rb') as f:
        args = f.read(16384).split(b'\0')
    if os.fsencode(os.path.join(path, 'broker.py')) not in args or os.fsencode(path) not in args:
        raise ValueError('Broker process identity mismatch')
    sock = os.lstat(os.path.join(path, 'broker.sock'))
    if not stat.S_ISSOCK(sock.st_mode) or sock.st_uid != os.getuid() or sock.st_mode & 0o077:
        raise ValueError('Unsafe broker socket')
    return live

def verify_target(request,path,live):
    target=read_json(os.path.join(path,'target.json'))
    lines=tmux(request,'list-panes','-s','-t',target['session'],'-F','#{session_id}\t#{window_id}\t#{pane_id}\t#{pane_tty}').splitlines()
    tty=os.readlink('/proc/%d/fd/0'%live['pid'])
    if not any(line.split('\t')==[target['session'],target['window'],target['pane'],tty] for line in lines):
        raise ValueError('Broker is not in the recorded tmux target')

def connect(path, timeout=12):
    live = verified_live(path)
    connection = socket.socket(socket.AF_UNIX)
    connection.settimeout(timeout)
    connection.connect(os.path.join(path, 'broker.sock'))
    return live, connection

def decorate(value, request, path):
    value['broker'] = request['broker']
    value['target'] = read_json(os.path.join(path, 'target.json'))
    completed=request.setdefault('_completed_prompts',{})
    turns={m.get('turn')for m in value.get('messages',[])if m.get('role')=='assistant' and isinstance(m.get('turn'),str)}
    missing=sorted(turns-set(completed))[:128]
    if missing:
        database=os.path.join(path,'receipts.sqlite3');regular(database)
        with sqlite3.connect('file:'+database+'?mode=ro',uri=True,timeout=.2)as db:
            for rowid,data in db.execute('select rowid,data from receipts where id in ('+','.join('?'for _ in missing)+')',missing):
                receipt=json.loads(data)
                if receipt.get('kind')=='prompt' and receipt.get('state')=='completed':completed[receipt['id']]=rowid
    replies=[m for m in value.get('messages',[])if m.get('role')=='assistant' and m.get('turn')in completed]
    value['reply_cursor']=replies[-1]['id']if replies else None
    value['reply_position']=completed[replies[-1]['turn']]if replies else 0
    if len(completed)>128:
        for ident in list(completed):
            if ident not in turns:del completed[ident]
    pending=[(p.get('id'),p.get('revision')) for p in value.get('permissions',[]) if not p.get('expired')]
    value['approval_cursor']=hashlib.sha256(json.dumps(pending,sort_keys=True).encode()).hexdigest() if pending else None
    return value

def close_broker(request, path, action):
    live = read_json(os.path.join(path,"live.json"))
    if action.get('instance') != live['instance']:
        raise ValueError('Stale broker instance')
    ident = canonical_uuid(action['id'])
    dbpath = os.path.join(path, 'receipts.sqlite3')
    regular(dbpath)
    digest = hashlib.sha256(json.dumps(action, sort_keys=True).encode()).hexdigest()
    with sqlite3.connect(dbpath, timeout=2) as db:
        db.execute('pragma synchronous=FULL')
        db.execute('begin immediate')
        previous = db.execute('select digest,data from receipts where id=?',(ident,)).fetchone()
        if previous:
            if previous[0] != digest:
                raise ValueError('Receipt UUID reused')
            return json.loads(previous[1])
        if db.execute('select count(*) from receipts').fetchone()[0] >= 512:
            raise ValueError('Receipt capacity reached')
        value = dict(id=ident,kind='close',state='claimed',at=time.time())
        db.execute('insert into receipts values(?,?,?)',(ident,digest,json.dumps(value)))
        db.commit()
        try:
            # pidfd prevents PID reuse between the final identity check and signal.
            verify_target(request,path,verified_live(path))
            fd = os.pidfd_open(live['pid'])
            try:
                if verified_live(path) != live:
                    raise ValueError('Broker changed')
                signal.pidfd_send_signal(fd, signal.SIGTERM)
            finally:
                os.close(fd)
            value['state'] = 'submitted'
        except Exception:
            value['state'] = 'uncertain'
            raise
        finally:
            db.execute('update receipts set data=? where id=?',(json.dumps(value),ident));db.commit()
        return value

def call(request):
    path = target_root(request)
    action = request.get('command', dict(action='snapshot'))
    if action.get('action') == 'close':
        return close_broker(request, path, action)
    live, connection = connect(path,request.get("_timeout",12))
    verify_target(request,path,live)
    try:
        action = request.get('command', dict(action='snapshot'))
        if action.get('action') != 'snapshot' and action.get('instance') != live['instance']:
            raise ValueError('Stale broker process instance')
        stream = connection.makefile('rwb')
        stream.write(json.dumps(action, ensure_ascii=False).encode() + b'\n');stream.flush()
        if action.get('action') == 'watch':
            for raw in iter(lambda: stream.readline(LIMIT + 1), b''):
                if len(raw) > LIMIT or not raw.endswith(b'\n'):
                    raise ValueError('Oversized broker event')
                # The socket's process instance was checked above, not a name/cwd guess.
                value = json.loads(raw)
                if isinstance(value.get('ok'), dict):
                    value['ok'] = decorate(value['ok'],request,path)
                sys.stdout.buffer.write(json.dumps(value,ensure_ascii=False).encode()+b'\n');sys.stdout.buffer.flush()
            return None
        raw = stream.readline(LIMIT + 1)
        if len(raw) > LIMIT or not raw.endswith(b'\n'):
            raise ValueError('Oversized broker response')
        result = json.loads(raw)
        if 'error' in result:
            raise ValueError(result['error'])
        value = result['ok']
        if action.get('action') == 'snapshot':
            value = decorate(value,request,path)
        return value
    finally:
        connection.close()

def launch(request):
    ident = canonical_uuid(request['broker'])
    prepared = request['prepared']
    fresh = options(prepared)
    if fresh != prepared:
        raise ValueError('Project or ACP executable changed; prepare again')
    base = root(True)
    if len(os.listdir(base)) >= 64:
        raise ValueError('Broker inventory capacity reached')
    path = os.path.join(base, ident)
    # Exclusive directory is the durable no-retry launch claim.
    os.mkdir(path, 0o700)
    exclusive_json(os.path.join(path, 'intent.json'), dict(id=ident, prepared=prepared, initial_prompt=request.get('initial_prompt'), at=time.time()))
    code = request['_broker_code']
    if not isinstance(code, str) or len(code.encode()) > 100000:
        raise ValueError('Invalid broker implementation')
    source = os.path.join(path, 'broker.py')
    fd = os.open(source, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as f:
        f.write(code)
    # Native CLI stdin is never an ACP socket; a separate dedicated pane owns this broker.
    command = shlex.join([sys.executable, source, path, fresh['executable'], fresh['path']])
    command = command.replace('#', '##')
    line = tmux(request, 'new-session', '-d', '-P', '-F', '#{session_id}\t#{window_id}\t#{pane_id}', '-s', 'cc-acp-' + ident, '-n', fresh['provider'].title()+' ACP', '-c', fresh['path'].replace('#', '##'), '-x', '120', '-y', '36', command)
    session, window, pane = line.split('\t')
    target = dict(session=session, window=window, pane=pane, session_name='cc-acp-' + ident)
    exclusive_json(os.path.join(path, 'target.json'), target)
    return dict(broker=ident, state='starting', protocol='acp', provider=fresh['provider'], path=fresh['path'], target=target)

def main(request):
    action = request.get('action')
    if action == 'prepare':
        return options(request)
    if action == 'launch':
        return launch(request)
    if action == 'call':
        return call(request)
    if action == 'receipts':
        path=target_root(request);live=read_json(os.path.join(path,'live.json'))
        if request.get('instance')!=live['instance']:raise ValueError('Stale broker instance')
        file=os.path.join(path,'receipts.sqlite3');regular(file)
        with sqlite3.connect('file:'+file+'?mode=ro',uri=True) as db:
            has_queue=db.execute("select 1 from sqlite_master where type='table'and name='prompt_queue'").fetchone()
            query="select data from receipts where rowid in(select rowid from receipts order by rowid desc limit 40)"
            if has_queue:query+=" or id in(select id from prompt_queue) or (json_extract(data,'$.kind')in('prompt','local_command','harness_command')and json_extract(data,'$.state')in('claimed','submitted','uncertain'))"
            return [json.loads(row[0])for row in db.execute(query+' order by rowid desc limit 512')]
    if action == 'inventory':
        items=main(dict(request,action='list'));out=[];started=time.monotonic();limited=False
        for item in items:
            if item.get('state')!='running':continue
            if len(out)>=32 or time.monotonic()-started>2:limited=True;break
            try:
                value=call(dict(request,action='call',broker=item['broker'],_timeout=.4))
                summary={k:value.get(k) for k in ('broker','instance','provider','path','state','session_id','target','reply_cursor','reply_position','approval_cursor','sequence','usage','command_running')}
                summary['permission_title']=next((p.get('title')for p in value.get('permissions',[])if not p.get('expired')),None)
                out.append(summary)
            except (OSError,ValueError):
                out.append(dict(item,state='unavailable'))
        return dict(agents=out,limited=limited)
    if action == 'list':
        base = root()
        if not os.path.exists(base):
            return []
        safe_directory(base, private=True)
        result = []
        for ident in sorted(os.listdir(base))[:64]:
            try:
                canonical_uuid(ident)
                path = os.path.join(base, ident)
                safe_directory(path, private=True)
                intent = read_json(os.path.join(path, 'intent.json'))
                target = read_json(os.path.join(path, 'target.json')) if os.path.exists(os.path.join(path, 'target.json')) else None
                item = dict(broker=ident, protocol='acp', provider=intent['prepared'].get('provider','claude'), path=intent['prepared']['path'], target=target, state='unavailable')
                try:
                    item.update(verified_live(path));item['state']='running'
                except (OSError, ValueError):
                    pass
                result.append(item)
            except (OSError, ValueError, KeyError):
                continue
        return result
    raise ValueError('Unsupported ACP operation')

if __name__ == '__main__':
    os.umask(0o077)
    try:
        request = json.load(sys.stdin)
        result = main(request)
        if result is not None:
            print(json.dumps(dict(ok=result)))
    except Exception as error:
        # No raw adapter stderr/environment/credentials in backend responses.
        print(json.dumps(dict(error=str(error)[:300], status=409)))
