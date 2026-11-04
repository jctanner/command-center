"""Bounded local/SSH agent observation and explicit human-directed tmux input.
No installation, daemon, contents in logs, or arbitrary log path from clients.
"""
import hashlib
import shutil
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import sys
import uuid
import time
from datetime import datetime

class Failure(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

def fail(status, message):
    raise Failure(status, message)

def tmux(request, *args, input=None):
    command = ['tmux', '-u']
    if request.get('socket'):
        command += ['-S', request['socket']]
    env = dict(os.environ)
    env.pop('TMUX', None)
    env.pop('TMUX_PANE', None)
    result = subprocess.run(command + list(args), input=input, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, env=env, timeout=8)
    if result.returncode:
        fail(409, 'Tmux target is unavailable; refresh the agent')
    return result.stdout.decode('utf-8', errors='replace')

def proc(pid):
    base = Path('/proc') / str(pid)
    raw = (base / 'stat').read_text()
    fields = raw[raw.rindex(')') + 2:].split()
    return base, fields[19], int(fields[5])  # starttime and terminal foreground group

def observe(request):
    for name, prefix in [('session', '$'), ('window', '@'), ('pane', '%')]:
        if not re.fullmatch(re.escape(prefix) + r'\d+', request.get(name, '')):
            fail(400, 'Invalid agent target')
    session, window, pane = (request[k] for k in ['session', 'window', 'pane'])
    members = tmux(request, 'list-panes', '-s', '-t', session, '-F', '#{window_id}\t#{pane_id}').splitlines()
    if window + '\t' + pane not in members:
        fail(409, 'Agent pane is no longer in this session/window')
    target = f'{session}:{window}.{pane}'
    info = tmux(request, 'display-message', '-p', '-t', target,
                '#{pane_pid}\t#{pane_current_command}\t#{pane_dead}\t#{pane_in_mode}').strip().split('\t')
    if len(info) != 4 or info[2] != '0':
        fail(409, 'Agent pane has exited')
    command = info[1].lower()
    kind = 'codex' if 'codex' in command else 'claude' if 'claude' in command else 'pi' if command in ('pi', 'pi-coding-agent') else None
    if not kind:
        fail(409, 'This pane is no longer running a supported agent')
    captured = tmux(request, 'capture-pane', '-p', '-t', target, '-S', '-40')
    text = captured[-48000:]
    identity, agent_base, args, env = None, None, [], {}
    try:
        base, start, foreground = proc(int(info[0]))
        # Only the foreground process may be messaged; background agents and
        # similarly named files in a project are never treated as running agents.
        agent_base, agent_start, _ = proc(foreground)
        argv = (agent_base / 'cmdline').read_bytes().decode(errors='replace').split('\0')
        comm = (agent_base / 'comm').read_text().strip().lower()
        verified = (comm in ('pi', 'pi-coding-agent') or os.path.basename(argv[0]).lower() in ('pi', 'pi-coding-agent')) if kind == 'pi' else (kind in comm or any(kind in os.path.basename(a).lower() for a in argv[:2]))
        if not verified:
            fail(409, 'Agent is not the foreground process')
        args = argv
        # Read only the two provider-home variables. Never return environments.
        for value in (agent_base / 'environ').read_bytes().decode(errors='replace').split('\0'):
            key, _, val = value.partition('=')
            if key in ('CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'CC_LAUNCH_ID', 'PI_CODING_AGENT_DIR', 'PI_CODING_AGENT_SESSION_DIR'):
                env[key] = val
        boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
        identity = hashlib.sha256(f'{boot}:{info[0]}:{start}:{foreground}:{agent_start}:{kind}'.encode()).hexdigest()
        cwd = os.path.realpath(agent_base / 'cwd')
    except (OSError, ValueError, IndexError):
        cwd = tmux(request, 'display-message', '-p', '-t', target, '#{pane_current_path}').rstrip('\n')
    return dict(target=target, kind=kind, identity=identity, base=agent_base, args=args,
                env=env, cwd=cwd, context=text, visible=tmux(request, 'capture-pane', '-p', '-t', target, '-S', '0'), in_mode=info[3] != '0',
                screen=hashlib.sha256(captured.encode()).hexdigest())

def approval_menu(observation):
    """Recognize live provider approval menus, never scrollback or arbitrary questions.
    Only single advertised shortcuts (Codex) or numbered Claude choices are sent.
    There is deliberately no trailing Enter or navigation sequence.
    """
    if not observation.get('identity') or observation.get('in_mode'):
        return None
    visible = observation.get('visible', '').rstrip()
    if len(visible) > 48000:
        return None
    lines = visible.splitlines()
    footer = next((i for i in range(len(lines)-1, -1, -1)
                   if re.search(r'(?i)esc(?:ape)? to (?:cancel|decline|interrupt)|enter to confirm', lines[i])), None)
    if footer is None or any(line.strip() for line in lines[footer+1:]):
        return None
    rows = []
    for i, line in enumerate(lines[:footer]):
        match = re.fullmatch(r'\s*([›❯>])?\s*([1-9])[.)]\s+(.+?)\s*', line)
        if match:
            rows.append([i, match.group(1), match.group(2), match.group(3)])
    if not 2 <= len(rows) <= 6 or [r[2] for r in rows] != [str(i+1) for i in range(len(rows))]:
        return None
    if sum(bool(r[1]) for r in rows) != 1:
        return None
    # Require an approval-specific question, not an ask-user selection menu.
    prefix = '\n'.join(lines[:rows[0][0]])
    questions = re.findall(r'(?im)^.*(?:would you like|do you want|allow|approve|permission)[^\n]*\?.*$', prefix)
    if not questions or not re.search(r'(?i)run|command|change|edit|write|read|access|permission|proceed|allow|apply|execute', questions[-1]):
        return None
    choices = []
    for index, (line_index, _, number, label) in enumerate(rows):
        end = rows[index+1][0] if index+1 < len(rows) else footer
        continuation = [line.strip() for line in lines[line_index+1:end] if line.strip()]
        label = ' '.join([label, *continuation])
        if not re.match(r'(?i)^(yes|no|allow|deny|approve|reject|cancel)\b', label):
            return None
        shortcut = re.search(r'\(([a-z]|esc)\)$', label)
        if observation['kind'] == 'codex':
            if not shortcut:
                return None  # customized/unsupported bindings must not be guessed
            key = shortcut.group(1)
        elif observation['kind'] == 'claude':
            key = number
        else:
            return None
        choices.append(dict(id=number, label=label, key=key))
    if not any(re.match(r'(?i)^(no|deny|reject|cancel)\b', c['label']) for c in choices):
        return None
    return dict(id=hashlib.sha256(visible.encode()).hexdigest(), title=questions[-1].strip(),
                context=visible, choices=choices)

def head_records(path):
    try:
        with open(path, 'rb') as f:
            data = f.read(256 * 1024)
        for line in data.splitlines():
            try:
                value = json.loads(line)
                if isinstance(value, dict):
                    yield value
            except (ValueError, UnicodeError):
                continue
    except OSError:
        return

def metadata(path, kind):
    for record in head_records(path):
        if kind == 'pi' and record.get('type') == 'session':
            version = record.get('version', 1)
            if isinstance(version, int) and not isinstance(version, bool) and 1 <= version <= 3:
                return record.get('cwd'), record.get('id'), record.get('timestamp', '')
            return None, None, ''
        if kind == 'codex' and record.get('type') == 'session_meta':
            payload = record.get('payload', {})
            return payload.get('cwd'), payload.get('id'), payload.get('timestamp', record.get('timestamp', ''))
        if kind == 'claude' and record.get('cwd') and record.get('sessionId') and not record.get('isSidechain'):
            return record['cwd'], record['sessionId'], record.get('timestamp', '')
    if kind=='claude':
        # Continued sessions can begin with a huge api-request record. Their
        # first message metadata may be outside the bounded header read.
        try:
            for record in bounded_events(path) or []:
                if (record.get('cwd') and record.get('sessionId')==Path(path).stem
                        and not record.get('isSidechain')):
                    return record['cwd'],record['sessionId'],record.get('timestamp','')
        except OSError: pass
    return None, None, ''

def codex_registered_session(observation, home):
    """Explicit registration by a tool of this live CLI; never infer from cwd."""
    import stat
    base = observation.get('base')
    if base is None: return None
    try:
        pid = int(base.name)
        _, start, _ = proc(pid)
        path = home / 'command-center-sessions' / f'{pid}.json'
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as source:
            info = os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077 or info.st_size > 4096: return None
            record = json.loads(source.read(4097))
        if not isinstance(record, dict): return None
        session = record.get('session_id')
        if (record.get('schema') != 1 or record.get('pid') != pid or record.get('proc_start') != start
                or record.get('boot_id') != Path('/proc/sys/kernel/random/boot_id').read_text().strip()
                or record.get('tmux_pane') != observation.get('target', '').rsplit('.', 1)[-1]
                or not isinstance(record.get('cwd'), str)
                or os.path.realpath(record['cwd']) != os.path.realpath(observation.get('cwd', ''))
                or not isinstance(session, str) or not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', session)
                or proc(pid)[1] != start): return None
        return session
    except (OSError, ValueError, TypeError, IndexError): return None

def claude_project(home, cwd):
    return home / 'projects' / re.sub(r'[^a-zA-Z0-9]', '-', cwd)


def bounded_events(path, limit=512*1024):
    with open(path,'rb') as source:
        size=os.fstat(source.fileno()).st_size;source.seek(max(0,size-limit))
        if size>limit: source.readline(limit)
        data=source.read(limit)
    if data and not data.endswith(b'\n'): return None
    records=[]
    for line in data.splitlines():
        try:
            record=json.loads(line)
            if isinstance(record,dict): records.append(record)
        except (ValueError,UnicodeError): pass
    return records


def claude_current_session(home, cwd, session):
    """Follow only explicit provider continuation edges from a verified PID registry."""
    directory=claude_project(home,cwd).resolve();visited=set()
    if not directory.is_relative_to(home.resolve()): return None
    for hop in range(9):
        if session in visited: return None
        visited.add(session);path=directory/(session+'.jsonl')
        if not path.exists(): return session if hop==0 else None
        if path.resolve().parent!=directory: return None
        try: records=bounded_events(path)
        except OSError: return None
        if records is None: return None
        edges=[]
        for record in records:
            if record.get('type')!='continued-in' or record.get('isSidechain') or record.get('sessionId')!=session: continue
            target=record.get('continuedInSessionId');stamp=event_time(record.get('timestamp'))
            if (not isinstance(target,str) or not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',target)
                    or stamp is None or stamp<0 or stamp>int(time.time())+30): return None
            edges.append(target)
        if not edges: return session
        if len(set(edges))!=1: return None
        child=directory/(edges[0]+'.jsonl')
        if not child.exists() or child.resolve().parent!=directory: return None
        child_cwd,child_session,_=metadata(child,'claude')
        if child_session!=edges[0] or not isinstance(child_cwd,str) or not os.path.isabs(child_cwd): return None
        session=edges[0]
    return None


def claude_tmux_matches(recorded, target):
    if not isinstance(recorded,str) or not isinstance(target,str):return False
    if recorded in (target, target.lstrip('$')):return True
    # CC viewers link the original window: the physical window/pane IDs remain
    # unchanged even after a temporary viewer session is removed/recreated.
    # This is used only alongside the verified foreground PID/start/domain/cwd.
    original=re.fullmatch(r'\$[0-9]+:(@[0-9]+\.%[0-9]+)',target)
    viewer=re.fullmatch(r'cc-view-[0-9a-f]{32}:(@[0-9]+\.%[0-9]+)',recorded)
    return bool(original and viewer and original[1]==viewer[1])

def process_sessions(observation, home, follow_continuations=True):
    """Provider state must match live PID/start identity, never cwd alone."""
    base = observation.get('base')
    if base is None:
        return set()
    try:
        pid = int(base.name)
        _, start, _ = proc(pid)
    except (OSError, ValueError, IndexError):
        return set()
    sessions = set()
    if observation['kind'] == 'codex':
        registered = codex_registered_session(observation, home)
        if registered: sessions.add(registered)
    if observation['kind'] == 'claude':
        try:
            path = home / 'sessions' / f'{pid}.json'
            with path.open('rb') as source:
                record = json.loads(source.read(65537))
            if not isinstance(record, dict):
                return set()
            # PID reuse, namespace collisions, stale session files and another
            # tmux target must not make an old transcript appear current.
            domain = record.get('pidDomain', '')
            if domain:
                machine_id = Path('/etc/machine-id').read_text().strip()
                expected = f'linux:{machine_id}:{os.readlink(base / "ns/pid")}'
                if domain != expected:
                    return set()
            session = record.get('sessionId', '')
            if (record.get('pid') == pid and str(record.get('procStart')) == start
                    and claude_tmux_matches(record.get('tmux'), observation['target'])
                    and os.path.realpath(record.get('cwd', '')) == os.path.realpath(observation['cwd'])
                    and re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', session)):
                if follow_continuations:
                    session=claude_current_session(home,observation['cwd'],session)
                if session: sessions.add(session)
        except (OSError, ValueError, TypeError):
            pass
    else:
        try:
            for fd in list((base / 'fd').iterdir())[:256]:
                try:
                    path = Path(os.readlink(fd))
                    if path.parent.resolve() != (home / 'thread-writer-locks').resolve():
                        continue
                    session = path.stem
                    if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', session):
                        continue
                    # Opening a lock file isn't enough: require a write lock
                    # owned by this process in the kernel's fdinfo record.
                    locks = (base / 'fdinfo' / fd.name).read_text().splitlines()
                    if any(re.search(r'\bWRITE\s+' + str(pid) + r'\s', line) for line in locks if line.startswith('lock:')):
                        sessions.add(session)
                except OSError:
                    pass
        except OSError:
            pass
        if observation.get('env', {}).get('CC_LAUNCH_ID'):
            pending=[(base,start,0)]; visited=0
            while pending and visited<32:
                parent,parent_start,depth=pending.pop()
                if depth>=3: continue
                try:
                    if proc(int(parent.name))[1]!=parent_start: continue
                    children=(parent/'task'/parent.name/'children').read_text().split()[:32]
                except OSError: continue
                for child in children:
                    if visited>=32: break
                    visited+=1
                    try:
                        child_base,child_start,_=proc(int(child))
                        fields=(child_base/'stat').read_text().rsplit(')',1)[1].split()
                        if fields[1]!=parent.name: continue
                        for fd in list((child_base/'fd').iterdir())[:256]:
                            try:
                                path=Path(os.readlink(fd))
                                if path.parent.resolve()!=(home/'thread-writer-locks').resolve(): continue
                                session=path.stem
                                if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',session): continue
                                locks=(child_base/'fdinfo'/fd.name).read_text().splitlines()
                                if any(re.search(r'\bWRITE\s+'+child+r'\s',line) for line in locks if line.startswith('lock:')):
                                    if proc(int(child))[1]==child_start and proc(int(parent.name))[1]==parent_start:
                                        sessions.add(session)
                            except OSError: continue
                        pending.append((child_base,child_start,depth+1))
                    except (OSError,ValueError,IndexError): continue
    try:
        if proc(pid)[1] != start:
            return set()
    except (OSError, ValueError, IndexError):
        return set()
    return sessions

def pi_home(observation):
    path = Path(observation.get('env', {}).get('PI_CODING_AGENT_DIR', Path.home()/'.pi/agent')).expanduser()
    return path if path.is_absolute() else Path(observation['cwd'])/path

def pi_bridge(observation):
    if '_pi_bridge' in observation: return observation['_pi_bridge']
    observation['_pi_bridge'] = None
    base = observation.get('base')
    if not observation.get('identity') or base is None: return None
    try:
        import stat
        pid=int(base.name); _,start,_=proc(pid)
        path=pi_home(observation)/'command-center-status'/f'{pid}.json'
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(fd,'rb') as source:
            info=os.fstat(source.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=os.geteuid() or info.st_mode&0o077 or info.st_size>16384: return None
            record=json.loads(source.read(16385))
        now=time.time();stamp=record.get('updated_at')
        if (record.get('schema')!=1 or record.get('pid')!=pid or record.get('proc_start')!=start
            or record.get('boot_id')!=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
            or not isinstance(stamp,(float,int)) or isinstance(stamp,bool) or not now-30<=stamp<=now+5
            or os.path.realpath(record.get('cwd',''))!=os.path.realpath(observation['cwd'])
            or record.get('tmux_pane')!=observation['target'].rsplit('.',1)[-1]
            or record.get('state') not in ('unknown','working','ready','waiting')
            or not isinstance(record.get('transition'),str) or not re.fullmatch(r'[0-9a-f-]{36}',record['transition'])
            or not isinstance(record.get('session_id'),str) or not re.fullmatch(r'[0-9a-fA-F-]{36}',record['session_id'])
            or (record.get('session_file') is not None and (not isinstance(record['session_file'],str) or not os.path.isabs(record['session_file']) or len(record['session_file'])>4096))
            or (record.get('leaf_id') is not None and (not isinstance(record['leaf_id'],str) or len(record['leaf_id'])>200))
            or proc(pid)[1]!=start): return None
        observation['_pi_bridge']=record
        return record
    except (OSError,ValueError,TypeError,AttributeError,IndexError): return None

def pi_conversations(observation):
    import itertools
    home = pi_home(observation)
    cwd = observation['cwd']
    custom = observation.get('env', {}).get('PI_CODING_AGENT_SESSION_DIR')
    explicit_files = set()
    explicit_ids = set()
    bridge = pi_bridge(observation)
    if bridge and bridge.get('session_file'): explicit_files.add(str(Path(bridge['session_file']).resolve()))
    args = observation.get('args', [])
    session_dir = None
    for index, arg in enumerate(args):
        flag, separator, inline = arg.partition('=')
        value = inline if separator else args[index+1] if index+1 < len(args) else ''
        if flag == '--session-dir' and value: session_dir = value
        if not bridge and flag in ('--session', '--session-id') and value:
            if flag == '--session' and (value.endswith('.jsonl') or '/' in value):
                path = Path(value).expanduser()
                explicit_files.add(str((path if path.is_absolute() else Path(cwd)/path).resolve()))
            else: explicit_ids.add(value)
    custom = session_dir or custom
    roots = []
    if custom:
        directory = Path(custom).expanduser()
        if not directory.is_absolute(): directory = Path(cwd)/directory
        roots.append(directory)
    else:
        encoded = '--' + re.sub(r'[/\\:]', '-', cwd.lstrip('/\\')) + '--'
        roots.append(home/'sessions'/encoded)
    paths = [Path(path) for path in explicit_files]
    for directory in roots:
        if directory.is_dir():
            paths += sorted(itertools.islice(directory.glob('*.jsonl'),2000),key=lambda p:p.stat().st_mtime,reverse=True)[:100]
    candidates=[];seen=set()
    for path in paths:
        try:
            path = path.resolve(strict=True)
            if str(path) in seen or not path.is_file(): continue
            if str(path) not in explicit_files and not any(path.is_relative_to(root.resolve()) for root in roots): continue
            seen.add(str(path))
            log_cwd,session,timestamp=metadata(path,'pi')
            if not isinstance(session,str) or not session or len(session)>200 or not log_cwd or os.path.realpath(log_cwd)!=os.path.realpath(cwd): continue
            linked=(str(path) in explicit_files and (not bridge or session==bridge['session_id'])) or session in explicit_ids
            candidate=dict(id=hashlib.sha256(str(path).encode()).hexdigest(),path=str(path),session=session,timestamp=timestamp,linked=linked)
            if bridge and linked: candidate['leaf_id']=bridge.get('leaf_id')
            candidates.append(candidate)
        except OSError: continue
    return candidates[:20]

def pi_dialog(observation):
    return bool(re.search(r'(?i)enter\s+to\s+(?:confirm|select|accept)|(?:↑|↓|arrow keys).*?(?:select|navigate)',observation.get('visible','')[-12000:]))

def input_hash(text):
    return hashlib.sha256(text.replace('\r\n','\n').strip().encode()).hexdigest()


def message_order(content):
    if not isinstance(content,list): return -1
    return next((index for index,block in enumerate(content) if isinstance(block,dict) and block.get('type') in ('text','input_text','output_text') and isinstance(block.get('text'),str) and block['text'].strip()),-1)


def activity_text(value, limit=12000):
    if isinstance(value, str): return value[:limit]
    if isinstance(value, list):
        return '\n'.join(block.get('text', '')[:limit] for block in value[:32]
                         if isinstance(block, dict) and block.get('type') in ('text', 'output_text', 'summary_text') and isinstance(block.get('text'), str))[:limit]
    return ''


def history_activities(records, kind, floor=0):
    """Read only provider-visible blocks; never signatures, encrypted reasoning or hidden context."""
    entries, calls = [], {}
    def add(offset, order, timestamp, category, title, text='', call_id=None):
        entry = dict(id=f'activity:{offset}:{order}', position=offset, order=order, timestamp=timestamp,
                     kind=category, title=title[:160], text=text[:12000], truncated=len(text)>12000, status='recorded' if category=='thinking' else 'pending')
        entries.append(entry)
        if isinstance(call_id, str) and call_id and len(call_id)<=256: calls[call_id]=entry
        return entry
    def finish(call_id, output, error=False):
        if not isinstance(call_id, str) or call_id not in calls: return
        entry=calls[call_id]; entry['status']='error' if error else 'completed'; entry['output']=activity_text(output,12001); entry['truncated']=entry.get('truncated',False) or len(entry['output'])>12000; entry['output']=entry['output'][:12000]
    for offset, record in records:
        if record.get('isMeta') or record.get('isSidechain'): continue
        timestamp=record.get('timestamp','')
        if kind=='codex':
            payload=record.get('payload',{})
            if not isinstance(payload,dict) or record.get('type')!='response_item': continue
            category=payload.get('type')
            if category=='reasoning':
                # Only the exported summary, never content/encrypted_content.
                summary=activity_text(payload.get('summary'))
                add(offset,0,timestamp,'thinking','Thinking',summary or 'No readable summary was recorded.')
            elif category in ('function_call','custom_tool_call'):
                arguments=payload.get('arguments') if category=='function_call' else payload.get('input')
                entry=add(offset,0,timestamp,'tool',str(payload.get('name') or 'Tool call'),call_id=payload.get('call_id'))
                entry['arguments']=(arguments[:4000] if isinstance(arguments,str) else '')
                entry['truncated']=isinstance(arguments,str) and len(arguments)>4000
            elif category in ('function_call_output','custom_tool_call_output'):
                finish(payload.get('call_id'),payload.get('output'))
            continue
        if kind=='pi':
            if record.get('type')!='message': continue
            message=record.get('message',{})
        else:
            if record.get('type') not in ('assistant','user'): continue
            message=record.get('message',{})
        if not isinstance(message,dict): continue
        role=message.get('role')
        if kind=='pi' and role=='toolResult':
            finish(message.get('toolCallId'),message.get('content'),message.get('isError') is True)
            continue
        content=message.get('content')
        if not isinstance(content,list): continue
        for order,block in enumerate(content[:64]):
            if not isinstance(block,dict): continue
            category=block.get('type')
            if role=='assistant' and category=='thinking':
                text=block.get('thinking')
                if isinstance(text,str) and text.strip(): add(offset,order,timestamp,'thinking','Thinking',text)
            elif role=='assistant' and category in ('tool_use','toolCall'):
                entry=add(offset,order,timestamp,'tool',str(block.get('name') or 'Tool call'),call_id=block.get('id'))
                arguments=block.get('input') if category=='tool_use' else block.get('arguments')
                if isinstance(arguments,(dict,list,str)):
                    rendered=json.dumps(arguments,ensure_ascii=True,indent=2) if not isinstance(arguments,str) else arguments
                    entry['arguments']=rendered[:4000]; entry['truncated']=len(rendered)>4000
            elif role=='user' and category=='tool_result':
                finish(block.get('tool_use_id'),block.get('content'),block.get('is_error') is True)
    # Keep existing message pagination and reply/read cursors unchanged. Activity
    # is supplementary, bounded, and explicitly reports omissions on busy pages.
    entries=[entry for entry in entries if entry['position']>=floor]
    limited=len(entries)>100
    entries=entries[-100:]
    budget=256000
    for index,entry in enumerate(entries):
        allowance=budget//max(1,len(entries)-index)
        shortened=entry.get('truncated',False)
        for key in ('text','arguments','output'):
            text=entry.get(key,''); take=min(len(text),allowance)
            entry[key]=text[:take]; allowance-=take; budget-=take; shortened=shortened or take<len(text)
        entry['truncated']=shortened
    return entries, limited


def pi_history(path, before=None, known_branch=None, active_leaf=False, include_activity=True):
    # Reconstruct only the latest persisted branch. Never concatenate abandoned
    # branches, custom/hidden records or system prompts. Activity uses this same branch.
    limit=8*1024*1024
    header=next((r for r in head_records(path) if r.get('type')=='session'),{})
    version=header.get('version',1)
    if not isinstance(version,int) or isinstance(version,bool) or version not in (1,2,3): fail(415,'Unsupported pi session version')
    with open(path,'rb') as source:
        end=os.fstat(source.fileno()).st_size;start=max(0,end-limit);source.seek(start)
        if start: source.readline(limit)
        entries=[]
        while source.tell()<end and len(entries)<50000:
            offset=source.tell();line=source.readline(min(limit,end-offset))
            if not line.endswith(b'\n'): continue
            try: record=json.loads(line)
            except (ValueError,UnicodeError): continue
            if not isinstance(record,dict) or record.get('type')=='session': continue
            if version==1:
                record=dict(record,id=str(offset),parentId=entries[-1][1]['id'] if entries else None)
            if not isinstance(record.get('id'),str) or len(record['id'])>200: continue
            if record.get('parentId') is not None and not isinstance(record.get('parentId'),str): continue
            entries.append((offset,record))
    by_id={record['id']:(offset,record) for offset,record in entries}
    if len(by_id)!=len(entries): fail(409,'Pi history has duplicate entry identities')
    branch=(entries[-1][1]['id'] if entries else None) if active_leaf is False else active_leaf
    selected=[];visited=set();cursor=branch
    while cursor is not None and cursor in by_id:
        if cursor in visited: fail(409,'Pi history has a cyclic branch')
        visited.add(cursor);entry=by_id[cursor];selected.append(entry);cursor=entry[1].get('parentId')
    selected.reverse()
    reset=bool(known_branch and known_branch not in visited)
    if before is not None and reset: fail(409,'Pi branch changed; reload latest history before loading older messages')
    messages=[]
    for offset,record in selected:
        if before is not None and offset>=int(before): continue
        if record.get('type')!='message': continue
        message=record.get('message',{})
        if not isinstance(message,dict) or message.get('role') not in ('user','assistant'): continue
        text=message_text(message.get('content'))
        if not text.strip(): continue
        messages.append(dict(id=str(offset),cursor=hashlib.sha256(f'{offset}:{text}'.encode()).hexdigest(),role=message['role'],input_hash=input_hash(text) if message['role']=='user' else None,
                             text=text[:16000],truncated=len(text)>16000,order=message_order(message.get('content')),timestamp=record.get('timestamp','')))
    page=messages[-100:];budget=512000
    for index,message in enumerate(page):
        original=len(message['text']);allowance=budget//(len(page)-index);message['text']=message['text'][:allowance]
        message['truncated']=message['truncated'] or original>allowance;budget-=len(message['text'])
    notice='Showing the latest persisted pi branch; older ancestry is outside the bounded history window.' if cursor is not None or start or len(entries)>=50000 else None
    activity_records=[(offset,record) for offset,record in selected if before is None or offset<int(before)]
    activities, activity_limited = history_activities(activity_records, 'pi', int(page[0]['id']) if len(messages)>100 else 0) if include_activity else ([],False)
    return dict(messages=page,activities=activities,activity_limited=activity_limited,older_cursor=int(page[0]['id']) if len(messages)>100 else (activities[0]['position'] if activity_limited and not page else None),history_branch=branch,
                history_reset=reset,history_notice=notice,limited=bool(notice or len(messages)>100))

def conversations(observation):
    if observation['kind'] == 'pi': return pi_conversations(observation)
    kind, cwd, env = observation['kind'], observation['cwd'], observation['env']
    home = Path(env.get('CODEX_HOME', Path.home() / '.codex') if kind == 'codex' else env.get('CLAUDE_CONFIG_DIR', Path.home() / '.claude'))
    paths, linked = [], set()
    # An open rollout or explicit resume/session argument is a strong association.
    base = observation['base']
    if base is not None:
        try:
            for fd in list((base / 'fd').iterdir())[:256]:
                try:
                    p = Path(os.readlink(fd))
                    if p.suffix == '.jsonl' and p.is_relative_to(home):
                        paths.append(p); linked.add(str(p))
                except OSError:
                    pass
        except OSError:
            pass
    explicit = process_sessions(observation, home)
    args = observation['args']
    for i, arg in enumerate(args[:-1]):
        if arg in ('resume', '--resume', '--session-id', '-r') and re.fullmatch(r'[0-9a-fA-F-]{36}', args[i+1]):
            explicit.add(args[i+1])
    if kind == 'codex':
        for db in sorted(home.glob('state*.sqlite'), reverse=True)[:2]:
            try:
                with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True, timeout=.2) as conn:
                    for session in explicit:
                        paths += [Path(r[0]) for r in conn.execute('SELECT rollout_path FROM threads WHERE id = ? AND cwd = ?', (session, cwd))]
                    paths += [Path(r[0]) for r in conn.execute('SELECT rollout_path FROM threads WHERE cwd = ? AND archived = 0 ORDER BY updated_at DESC LIMIT 20', (cwd,))]
                break
            except sqlite3.Error:
                pass
        if not paths:
            # Bounded fallback for older CLI versions without a thread database.
            import itertools
            paths = sorted(itertools.islice((home / 'sessions').glob('*/*/*/*.jsonl'), 4000), key=lambda p: p.stat().st_mtime, reverse=True)[:100]
    else:
        project = re.sub(r'[^a-zA-Z0-9]', '-', cwd)
        directory = home / 'projects' / project
        if directory.is_dir():
            paths += [directory / f'{session}.jsonl' for session in explicit if (directory / f'{session}.jsonl').is_file()]
            import itertools
            paths += sorted(itertools.islice(directory.glob('*.jsonl'), 2000), key=lambda p: p.stat().st_mtime, reverse=True)[:100]
    candidates, seen = [], set()
    for path in paths:
        try:
            path = path.resolve(strict=True)
            if not path.is_relative_to(home.resolve()) or str(path) in seen or not path.is_file():
                continue
            seen.add(str(path))
            log_cwd, session, timestamp = metadata(path, kind)
            if not log_cwd or (os.path.realpath(log_cwd) != os.path.realpath(cwd) and not (kind=='claude' and session in explicit)):
                continue
            candidates.append(dict(id=hashlib.sha256(str(path).encode()).hexdigest(), path=str(path),
                                   session=session, timestamp=timestamp, linked=str(path) in linked or session in explicit))
        except OSError:
            continue
    return candidates[:20]

def provider_home(observation):
    if observation['kind'] == 'pi': return pi_home(observation)
    env = observation['env']
    return Path(env.get('CODEX_HOME', Path.home() / '.codex') if observation['kind'] == 'codex'
                else env.get('CLAUDE_CONFIG_DIR', Path.home() / '.claude'))

def state_result(state, source, reason, evidence_at=None, transition=None):
    return dict(state=state, source=source, reason=reason, evidence_at=evidence_at,
                observed_at=int(time.time()), transition=transition)

def event_time(value):
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return int(value / 1000 if value > 100000000000 else value)
        if isinstance(value, str):
            stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if stamp.tzinfo is not None:
                return int(stamp.timestamp())
    except (ValueError, OverflowError):
        pass
    return None

def codex_activity(path, now):
    """Root turn transitions only; arbitrary output is never evidence of readiness."""
    try:
        with open(path, 'rb') as source:
            size = os.fstat(source.fileno()).st_size
            start = max(0, size - 512 * 1024)
            source.seek(start)
            if start: source.readline(512 * 1024)
            data = source.read(512 * 1024)
        if data and not data.endswith(b'\n'):
            return state_result('unknown', 'codex_events', 'Provider update is incomplete')
        turn, current, stamp, event = None, None, None, None
        for line in data.splitlines():
            try:
                record = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if not isinstance(record, dict) or record.get('type') != 'event_msg': continue
            payload = record.get('payload')
            if not isinstance(payload, dict): continue
            kind, ident = payload.get('type'), payload.get('turn_id')
            # Long-running turns can produce tools for hours. Only progress
            # explicitly scoped to the already verified root turn refreshes it;
            # child items, token counts and arbitrary log writes cannot.
            if kind == 'item_completed' and current == 'working' and ident == turn:
                progress = event_time(record.get('timestamp'))
                if progress is not None and stamp is not None and stamp <= progress <= now + 30:
                    stamp, event = progress, 'item_completed'
                continue
            if kind not in ('task_started', 'task_complete', 'turn_aborted') or not isinstance(ident, str) or not ident: continue
            if payload.get('root_turn_id') and payload['root_turn_id'] != ident: continue
            if kind != 'task_started' and turn is not None and turn != ident: continue
            turn = ident
            stamp = event_time(record.get('timestamp'))
            current = 'working' if kind == 'task_started' else 'ready'
            event = kind
        if not current:
            return state_result('unknown', 'codex_events', 'No root turn transition in the bounded log tail')
        if stamp is None or stamp > now + 30 or stamp < 0:
            return state_result('unknown', 'codex_events', 'Provider event has an invalid timestamp')
        if current == 'working' and now - stamp > 900:
            return state_result('unknown', 'codex_events', 'Working evidence is older than 15 minutes', stamp)
        return state_result(current, 'codex_events', f'Codex reported {event}', stamp, hashlib.sha256(f'{turn}:{event}:{stamp}'.encode()).hexdigest())
    except (OSError, ValueError):
        return state_result('unknown', 'codex_events', 'Process-linked event log is unavailable')

def claude_log_activity(path, session, now):
    try: records=bounded_events(path)
    except OSError: return state_result('unknown','claude_events','Process-linked Claude event log is unavailable')
    if records is None: return state_result('unknown','claude_events','Claude event update is incomplete')
    state,stamp,event=None,None,None
    background={r.get('id') for r in records if r.get('type')=='api-request' and r.get('querySource') not in (None,'repl_main_thread') and isinstance(r.get('id'),str)}
    for record in records:
        if record.get('sessionId')!=session or record.get('isSidechain') or record.get('isMeta'): continue
        if record.get('serverClassifierRequest') is True or (isinstance(record.get('requestRef'),str) and record['requestRef'] in background): continue
        kind=record.get('type');message=record.get('message',{})
        transition=None
        if kind=='api-request' and record.get('querySource')=='repl_main_thread': transition='working'
        elif kind=='user' and isinstance(message,dict) and message.get('role')=='user': transition='working'
        elif kind=='assistant' and isinstance(message,dict) and message.get('role')=='assistant':
            stop=message.get('stop_reason')
            if stop in ('end_turn','stop_sequence'): transition='ready'
            elif stop=='tool_use': transition='working'
        if transition is None: continue
        timestamp=event_time(record.get('timestamp'))
        if timestamp is None or timestamp<0 or timestamp>now+30: return state_result('unknown','claude_events','Claude event timestamp is invalid')
        if stamp is not None and timestamp<stamp: continue
        state,stamp,event=transition,timestamp,str(record.get('uuid') or record.get('id') or kind)
    if state is None: return state_result('unknown','claude_events','No foreground Claude turn evidence in the bounded log tail')
    if state=='working' and now-stamp>900: return state_result('unknown','claude_events','Claude turn evidence is older than 15 minutes',stamp)
    return state_result(state,'claude_events','Claude reported '+('turn completion' if state=='ready' else 'foreground turn activity'),stamp,hashlib.sha256(f'{session}:{event}:{stamp}:{state}'.encode()).hexdigest())


def provider_activity(observation, candidates=None):
    menu = approval_menu(observation)
    if menu:
        return state_result('approval', 'terminal_prompt', 'Recognized live approval menu; explicit human decision required', int(time.time()), menu['id'])
    if not observation.get('identity') or observation.get('base') is None:
        return state_result('unknown', 'none', 'Live agent process could not be verified')
    if observation['kind'] == 'pi':
        bridge=pi_bridge(observation)
        if bridge:
            state={'working':'working','ready':'ready','waiting':'approval','unknown':'unknown'}[bridge['state']]
            reason='Pi is waiting for input in an extension dialog. Respond in the terminal.' if bridge['state']=='waiting' else 'Native pi bridge reports '+bridge['state']
            return state_result(state,'pi_bridge',reason,int(bridge['updated_at']),bridge['transition'])
        return state_result('unknown', 'pi_session', 'Pi status bridge is absent or stale; live activity is unverified. Install the bridge and run /reload when idle.')
    home = provider_home(observation)
    if observation['kind'] == 'claude':
        linked = process_sessions(observation, home, follow_continuations=False)
        try:
            base = observation['base']
            with (home / 'sessions' / f'{base.name}.json').open('rb') as source:
                record = json.loads(source.read(65537))
            if (not isinstance(record, dict) or record.get('sessionId') not in linked
                    or record.get('pid') != int(base.name) or str(record.get('procStart')) != proc(int(base.name))[1]):
                return state_result('unknown', 'none', 'No valid process-linked status record')
            stamp = event_time(record.get('statusUpdatedAt'))
            started = event_time(record.get('startedAt'))
            updated = event_time(record.get('updatedAt'))
            now = int(time.time())
            if (stamp is None or stamp < 0 or stamp > now + 30 or
                    (started is not None and stamp < started) or
                    (updated is not None and (updated < stamp or updated > now + 30))):
                return state_result('unknown', 'claude_registry', 'Provider status timestamp is invalid')
            current=process_sessions(observation,home)
            if len(current)!=1:
                return state_result('unknown','claude_events','Claude session continuation cannot be verified')
            active=next(iter(current))
            path=claude_project(home,observation['cwd'])/(active+'.jsonl')
            events=claude_log_activity(path,active,now)
            if events['reason'] in ('Claude event timestamp is invalid','Claude event update is incomplete'): return events
            # Root turn events supersede an older registry transition. Registry
            # updatedAt is only freshness, never a new phase transition.
            if events['state']!='unknown' and (active!=record['sessionId'] or events['evidence_at']>=stamp): return events
            if active!=record['sessionId']:
                return events
            value = record.get('status')
            state = {'idle':'ready', 'working':'working', 'busy':'working', 'running':'working',
                     'waiting_for_approval':'approval', 'waiting_for_permission':'approval'}.get(value)
            if state is None:
                return state_result('unknown', 'claude_registry', 'Provider status is not recognized', stamp)
            if state == 'working' and now - max(stamp, updated or stamp) > 900:
                return state_result('unknown', 'claude_registry', 'Working evidence is older than 15 minutes', stamp)
            evidence=max(stamp,updated or stamp) if state=='working' else stamp
            return state_result(state, 'claude_registry', f'Claude reports {value}', evidence, hashlib.sha256(f"{record['sessionId']}:{record['statusUpdatedAt']}:{value}".encode()).hexdigest())
        except (OSError, ValueError, TypeError, IndexError):
            return state_result('unknown', 'none', 'No valid process-linked status record')
    candidates = conversations(observation) if candidates is None else candidates
    linked = [c for c in candidates if c['linked']]
    if len(linked) != 1:
        return state_result('unknown', 'none', 'No unique process-linked conversation for turn status')
    return codex_activity(linked[0]['path'], int(time.time()))

def message_text(content):
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return ''
    return '\n'.join(c.get('text', '') for c in content if isinstance(c, dict) and c.get('type') in ('text', 'input_text', 'output_text') and isinstance(c.get('text'), str))

def history(path, kind, before=None, known_branch=None, active_leaf=False, include_activity=True):
    if kind == 'pi': return pi_history(path,before,known_branch,active_leaf,include_activity)
    # Read only a tail/page, never a growing multi-GB transcript into memory.
    with open(path, 'rb') as source:
        end = os.fstat(source.fileno()).st_size
        if before is not None:
            end = min(end, max(0, int(before)))
        start = max(0, end - 4 * 1024 * 1024)
        source.seek(start)
        if start:
            source.readline(4 * 1024 * 1024)
        records = []
        while source.tell() < end:
            offset = source.tell()
            line = source.readline(min(end - offset, 4 * 1024 * 1024))
            if not line.endswith(b'\n'):
                continue  # unfinished append; retry on next refresh
            try:
                record = json.loads(line)
                if isinstance(record, dict): records.append((offset, record))
            except (ValueError, UnicodeError):
                pass
    messages, events = [], []
    for offset, record in records:
        if kind == 'codex':
            payload = record.get('payload', {})
            if not isinstance(payload, dict): continue
            if record.get('type') == 'response_item' and payload.get('type') == 'message':
                role, text = payload.get('role'), message_text(payload.get('content'))
            elif record.get('type') == 'event_msg' and payload.get('type') in ('user_message', 'agent_message'):
                role = 'user' if payload['type'] == 'user_message' else 'assistant'
                text = payload.get('message', '')
                if isinstance(text, str) and text:
                    events.append((offset, dict(id=str(offset), cursor=hashlib.sha256(f'{offset}:{text}'.encode()).hexdigest(), role=role, input_hash=input_hash(text) if role=='user' else None, text=text[:16000], truncated=len(text)>16000, timestamp=record.get('timestamp', ''))))
                continue
            else: continue
        else:
            if record.get('type') not in ('user', 'assistant') or record.get('isMeta') or record.get('isSidechain'): continue
            payload = record.get('message', {})
            if not isinstance(payload, dict): continue
            role, text = payload.get('role'), message_text(payload.get('content'))
        if role not in ('user', 'assistant') or not text.strip(): continue
        messages.append((offset, dict(id=str(offset), cursor=hashlib.sha256(f'{offset}:{text}'.encode()).hexdigest(), role=role, input_hash=input_hash(text) if role=='user' else None, text=text[:16000], truncated=len(text)>16000, order=message_order(payload.get('content')), timestamp=record.get('timestamp', ''))))
    if not messages: messages = events
    page = messages[-100:]
    budget = 512000
    for index, (_, message) in enumerate(page):
        original = len(message['text'])
        allowance = budget // (len(page) - index)
        message['text'] = message['text'][:allowance]
        message['truncated'] = message['truncated'] or original > allowance
        budget -= len(message['text'])
    cursor = page[0][0] if len(messages) > 100 else records[0][0] if start and records else start
    activities, activity_limited = history_activities(records, kind, page[0][0] if len(messages)>100 else 0) if include_activity else ([],False)
    if activity_limited and not page: cursor=activities[0]['position']
    return dict(messages=[m for _, m in page], activities=activities, activity_limited=activity_limited, older_cursor=cursor if cursor > 0 else None,
                limited=start > 0 or len(messages) > 100 or activity_limited)

def transcript_version(chosen):
    info = os.stat(chosen['path'])
    version = hashlib.sha256(f"{chosen['id']}:{info.st_dev}:{info.st_ino}:{info.st_size}:{info.st_mtime_ns}".encode()).hexdigest()
    if 'leaf_id' in chosen: version=hashlib.sha256((version+':'+json.dumps(chosen['leaf_id'])).encode()).hexdigest()
    return info, version

def reply_observation(chosen, kind, known_version=None, page=None):
    if not chosen: return None
    info, version = transcript_version(chosen)
    result = dict(conversation=chosen['id'], version=version, cursor=None, unchanged=False, mtime_ns=info.st_mtime_ns, position=0)
    if version == known_version:
        result['unchanged'] = True
        return result
    page = history(chosen['path'], kind, active_leaf=chosen.get('leaf_id',False), include_activity=False) if page is None else page
    latest = next((m for m in reversed(page['messages']) if m['role'] == 'assistant'), None)
    if latest:
        result['position'] = int(latest['id'])
        result['cursor'] = hashlib.sha256(f"{info.st_dev}:{info.st_ino}:{latest['cursor']}".encode()).hexdigest()
    return result

def project_directory(value):
    if not isinstance(value, str) or not value or len(value) > 4096 or any(ord(c) < 32 for c in value):
        fail(400, 'Invalid project directory')
    path = Path(os.path.expanduser(value))
    if not path.is_absolute(): fail(400, 'Use an absolute directory or ~/path')
    try: path = path.resolve(strict=True)
    except OSError: fail(404, 'Project directory not found')
    if not path.is_dir() or not os.access(path, os.R_OK | os.X_OK): fail(400, 'Project directory is unavailable')
    info=path.stat()
    return str(path), f'{info.st_dev}:{info.st_ino}'

def launch_executable(kind):
    if kind not in ('codex', 'claude', 'pi'): fail(400, 'Choose Codex, Claude or pi')
    search = os.environ.get('PATH', '') + os.pathsep + str(Path.home()/'.local/bin') + os.pathsep + str(Path.home()/'.cargo/bin') + ':/usr/local/bin'
    executable=shutil.which(kind, path=search)
    if not executable: fail(404, f'{kind} is not installed on this machine or is not executable')
    executable=os.path.abspath(executable)
    info=os.stat(executable)
    return executable, f'{info.st_dev}:{info.st_ino}:{info.st_size}:{info.st_mtime_ns}', search

def launch_candidates(path, kind):
    observation=dict(kind=kind,cwd=path,env={k:os.environ[k] for k in ('CODEX_HOME','CLAUDE_CONFIG_DIR','PI_CODING_AGENT_DIR','PI_CODING_AGENT_SESSION_DIR') if k in os.environ},base=None,args=[])
    return conversations(observation)

def active_launch_sessions(request, kind):
    # Process evidence only. An unrelated project transcript is never "active".
    active=set()
    try:
        rows=tmux(request,'list-panes','-a','-F','#{session_id}\t#{window_id}\t#{pane_id}\t#{pane_current_command}\t#{pane_dead}\t#{@cc_launch}').splitlines()
    except Failure: return active
    seen=set()
    for row in rows[:256]:
        fields=row.split('\t')
        if len(fields)!=6 or fields[2] in seen: continue
        try:
            metadata=json.loads(fields[5])
            if fields[4]=='0' and metadata.get('provider')==kind and metadata.get('pane')==fields[2] and metadata.get('conversation'):
                active.add(metadata['conversation'])
        except (ValueError,AttributeError): pass
        if kind not in fields[3].lower(): continue
        seen.add(fields[2])
        if len(seen)>64: break
        try:
            observed=observe(dict(request,session=fields[0],window=fields[1],pane=fields[2]))
            active.update(process_sessions(observed,provider_home(observed)))
            args=observed['args']
            for i, arg in enumerate(args[:-1]):
                if arg in ('resume','--resume','--session-id','-r') and re.fullmatch(r'[0-9a-fA-F-]{36}',args[i+1]): active.add(args[i+1])
        except (Failure,OSError): continue
    return active

def launch_title(candidate, kind):
    for record in head_records(candidate['path']):
        if record.get('isMeta') or record.get('isSidechain'): continue
        if kind=='codex':
            if record.get('type')!='response_item': continue
            message=record.get('payload',{})
        elif kind=='pi':
            if record.get('type')!='message': continue
            message=record.get('message',{})
        else:
            if record.get('type')!='user': continue
            message=record.get('message',{})
        if message.get('role')!='user': continue
        content=message.get('content',[])
        if isinstance(content,str): text=content
        elif isinstance(content,list): text=' '.join(c.get('text','') for c in content if isinstance(c,dict) and c.get('type') in ('text','input_text'))
        else: continue
        if text.strip(): return ' '.join(text.split())[:160]
    return 'Conversation'

def launch_model(value):
    if value is None or value == '': return None
    if not isinstance(value,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/@+\[\]-]{0,199}',value):
        fail(400,'Model must be a name or alias of at most 200 characters, without spaces or CLI flags')
    return value

def launch_destination(request):
    session=request.get('target_session')
    if session is None or session=='':return None,None
    if not isinstance(session,str) or not re.fullmatch(r'\$[0-9]+',session):fail(400,'Choose an existing tmux session by its stable ID')
    fields=tmux(request,'display-message','-p','-t',session+':','#{session_id}\t#{session_created}\t#{pid}\t#{start_time}\t#{session_name}').rstrip('\n').split('\t',4)
    if len(fields)!=5 or fields[0]!=session or fields[4].startswith('cc-view-'):fail(409,'The selected tmux session is unavailable; choose a session again')
    try:
        base,start,_=proc(int(fields[2]));server=Path('/proc/sys/kernel/random/boot_id').read_text().strip()+':'+start
    except (OSError,ValueError):server=fields[3]
    identity=hashlib.sha256(json.dumps([fields[:4],server]).encode()).hexdigest()
    return session,identity

def launch_label(value, limit, label):
    if value is None or value == '':return None
    if not isinstance(value,str):fail(400,'Invalid '+label)
    value=value.strip()
    if len(value.encode('utf-8'))>limit or any(ord(c)<32 or 127<=ord(c)<160 for c in value):fail(400,label+' is too long or contains control characters')
    return value or None

def launch_options(request):
    target_session,destination_identity=launch_destination(request)
    model=launch_model(request.get('model'))
    window_name=launch_label(request.get('window_name'),120,'Window name')
    card_name=launch_label(request.get('card_name'),240,'Agent card name')
    path,identity=project_directory(request.get('path'))
    kind=request.get('provider')
    executable,executable_identity,_=launch_executable(kind)
    active=active_launch_sessions(request,kind)
    candidates=[]
    for candidate in launch_candidates(path,kind):
        session=candidate.get('session','')
        if not isinstance(session,str) or not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',session): continue
        candidates.append(dict(id=candidate['id'],session=session,timestamp=candidate['timestamp'],title=launch_title(candidate,kind),active=session in active))
    return dict(project=path,directory_identity=identity,provider=kind,model=model,executable=executable,executable_identity=executable_identity,conversations=candidates,target_session=target_session,destination_identity=destination_identity,window_name=window_name,card_name=card_name)

def launch_status(request):
    identifier=request.get('launch_id','')
    if not isinstance(identifier,str) or not re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',identifier): fail(400,'Invalid launch identity')
    name='cc-agent-'+identifier
    try:
        rows=tmux(request,'list-panes','-a','-F','#{session_id}\t#{window_id}\t#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{s/[\x01-\x1f\x7f]/?/:session_name}\t#{s/[\x01-\x1f\x7f]/?/:window_name}\t#{@cc_launch}').splitlines()
    except Failure:return dict(found=False,launch_id=identifier)
    matches=[];incomplete=False;moved=False
    for raw in rows[:4096]:
        fields=raw.split('\t',7)
        if len(fields)!=8 or fields[5].startswith('cc-view-'):continue
        try:meta=json.loads(fields[7])
        except (ValueError,TypeError):meta={}
        if meta.get('launch_id')==identifier:
            if fields[0]==meta.get('session') and fields[1]==meta.get('window') and fields[2]==meta.get('pane'):matches.append((fields,meta))
            else:moved=True
        elif fields[5]==name or fields[6]==name:incomplete=True
    if not matches:
        if moved or len(rows)>4096:fail(409,'Original launch target moved or discovery exceeded its limit; inspect it before launching again')
        if incomplete:fail(409,'Launch setup is incomplete; inspect the new session/window before launching again')
        return dict(found=False,launch_id=identifier)
    if len(matches)!=1:fail(409,'Launch identity is ambiguous; inspect its session/window')
    fields,metadata=matches[0];row=fields[:5];session_id=row[0]
    kind=metadata['provider']
    association={}
    if metadata.get('ticket') and row[3]=='0' and kind in row[4].lower():
        try:
            observed=observe(dict(request,session=row[0],window=row[1],pane=row[2]))
            if observed.get('identity') and observed['env'].get('CC_LAUNCH_ID')==identifier:
                association['identity']=observed['identity']
                linked=[c for c in conversations(observed) if c.get('linked')]
                if len(linked)==1:association['conversation']=linked[0].get('session')
            else:association['replacement']=True
        except (Failure,OSError): pass
    if metadata.get('conversation'):association.setdefault('conversation',metadata['conversation'])
    return dict(found=True,launch_id=identifier,session=row[0],window=row[1],pane=row[2],
                session_name=fields[5],destination=metadata.get('destination','session'),project=metadata['project'],provider=kind,model=metadata.get('model'),
                running=row[3]=='0' and kind in row[4].lower(),exited=row[3]=='1',
                context=tmux(request,'capture-pane','-p','-t',row[2],'-S','0')[-12000:],**association)

def launch_agent(request):
    # Validate everything before creating a new, uniquely named session.
    identifier=request.get('launch_id','')
    existing=launch_status(request)
    if existing['found']: fail(409,'This launch already exists; check its status instead of retrying')
    target_session,destination_identity=launch_destination(request)
    if destination_identity!=request.get('destination_identity'):fail(409,'The selected tmux session changed; prepare the launch again')
    path,identity=project_directory(request.get('project'))
    kind=request.get('provider')
    executable,executable_identity,search=launch_executable(kind)
    if identity!=request.get('directory_identity') or path!=request.get('project'): fail(409,'Project directory changed; prepare it again')
    if executable!=request.get('executable') or executable_identity!=request.get('executable_identity'): fail(409,'Agent installation changed; prepare again')
    model=launch_model(request.get('model'))
    command=[executable]
    if kind=='codex':
        try:
            help_result=subprocess.run([executable,'--help'],cwd=str(Path.home()),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=2)
            if help_result.returncode==0 and b'--no-daemon' in help_result.stdout[:256*1024]: command += ['--no-daemon']
        except (OSError,subprocess.SubprocessError): pass
    selected=request.get('conversation')
    if selected:
        allowed=next((c for c in request.get('conversations',[]) if c['id']==selected and not c['active']),None)
        chosen=next((c for c in launch_candidates(path,kind) if c['id']==selected),None)
        if not allowed or not chosen or chosen['session']!=allowed['session']: fail(409,'Conversation changed or is unavailable for this project')
        if chosen['session'] in active_launch_sessions(request,kind): fail(409,'This conversation already has a running agent; open it in AI Queue')
        command += ['resume',chosen['session']] if kind=='codex' else ['--session',chosen['path']] if kind=='pi' else ['--resume',chosen['session']]
    elif kind=='claude': command += ['--session-id',identifier]
    if model is not None: command += ['--model',model]
    initial=request.get('initial_prompt')
    if initial is not None:
        if selected or not isinstance(initial,str) or not initial.strip() or len(initial.encode('utf-8'))>24000 or '\0' in initial: fail(400,'Invalid initial ticket prompt')
        # Positional literal input; never shell code or simulated terminal typing.
        command += ['--',initial]
    name='cc-agent-'+identifier
    window_name=launch_label(request.get('window_name'),120,'Window name')
    launch_label(request.get('card_name'),240,'Agent card name')
    # A harmless placeholder lets us enable remain-on-exit before executing the
    # CLI. Never respawn or resize an existing user pane.
    if target_session:
        row=tmux(request,'new-window','-d','-P','-F','#{session_id}\t#{window_id}\t#{pane_id}','-t',target_session+':','-n',name,'-c',path,'/bin/sleep','86400').strip().split('\t')
    else:
        row=tmux(request,'new-session','-d','-P','-F','#{session_id}\t#{window_id}\t#{pane_id}','-s',name,'-n',kind,'-c',path,'-x','120','-y','36','/bin/sleep','86400').strip().split('\t')
    if len(row)!=3: fail(502,'Launch state uncertain; check the launch before trying again')
    try:
        metadata=json.dumps(dict(launch_id=identifier,project=path,provider=kind,model=model,session=row[0],window=row[1],pane=row[2],conversation=chosen['session'] if selected else identifier if kind=='claude' else None,ticket=initial is not None,destination='window' if target_session else 'session'))
        tmux(request,'set-option','-w','-t',row[1],'@cc_launch',metadata)
        if not target_session:tmux(request,'set-option','-t',row[0],'@cc_launch',metadata)
        else:tmux(request,'rename-window','-t',row[1],kind+'-'+identifier[:8])
        if window_name:
            tmux(request,'rename-window','-t',row[1],window_name)
            tmux(request,'set-option','-w','-t',row[1],'automatic-rename','off')
        tmux(request,'set-option','-w','-t',row[1],'remain-on-exit','on')
        environment=['-e','PATH='+search,'-e','CC_LAUNCH_ID='+identifier]
        for key,default in (('CODEX_HOME','.codex'),('CLAUDE_CONFIG_DIR','.claude')):
            environment += ['-e',key+'='+os.environ.get(key,str(Path.home()/default))]
        for key in ('PI_CODING_AGENT_DIR','PI_CODING_AGENT_SESSION_DIR'):
            if key in os.environ: environment += ['-e',key+'='+os.environ[key]]
        tmux(request,'respawn-pane','-k','-t',row[2],'-c',path,*environment,*command)
    except (Failure,subprocess.SubprocessError): fail(502,'Launch setup or delivery uncertain; check the new session before trying again')
    return launch_status(request)

def execute(request):
    if request.get('action') == 'launch_options': return launch_options(request)
    if request.get('action') == 'launch_status': return launch_status(request)
    if request.get('action') == 'launch': return launch_agent(request)
    observation = observe(request)
    if request.get('action') == 'close_agent':
        if not observation.get('identity') or observation['identity'] != request.get('identity'):
            fail(409,'Agent process changed; no window was closed')
        try:
            tmux(request,'kill-window','-t',request['session']+':'+request['window'])
        except (Failure,subprocess.SubprocessError):
            fail(502,'Close outcome is uncertain. Check agents before taking another action; this close will not be retried')
        return dict(closed=True)
    if request.get('action') == 'approval':
        menu = approval_menu(observation)
        if (not menu or observation['identity'] != request.get('identity')
                or observation['screen'] != request.get('screen') or menu['id'] != request.get('approval_id')):
            fail(409, 'Approval or agent changed; no decision was sent. Refresh and review.')
        choice = next((c for c in menu['choices'] if c['id'] == request.get('choice')), None)
        if not choice:
            fail(400, 'Unsupported approval choice')
        fresh = observe(request)
        if (fresh['identity'] != observation['identity'] or fresh['screen'] != observation['screen']
                or approval_menu(fresh) != menu):
            fail(409, 'Approval or agent changed; no decision was sent. Refresh and review.')
        try:
            if choice['key'] == 'esc':
                tmux(request, 'send-keys', '-t', fresh['target'], 'Escape')
            else:
                tmux(request, 'send-keys', '-t', fresh['target'], '-l', choice['key'])
        except (Failure, subprocess.SubprocessError):
            fail(502, 'Decision delivery uncertain. Check the agent before responding again.')
        return dict(submitted=True)
    if request.get('action') == 'status':
        candidates = conversations(observation)
        linked = [c for c in candidates if c['linked']]
        chosen = linked[0] if len(linked) == 1 else next((c for c in candidates if c['id'] == request.get('conversation')), None)
        if not chosen and len(candidates) == 1 and not observation['env'].get('CC_LAUNCH_ID'): chosen = candidates[0]
        return dict(instance=observation['identity'], context=observation['context'],
                    reply=reply_observation(chosen, observation['kind'], request.get('known_reply_version')),
                    activity=provider_activity(observation, candidates))
    if request.get('action') == 'outbox_status':
        if request.get('identity') and observation['identity'] != request['identity']:
            fail(409, 'Agent process changed; queued messages were not sent')
        candidates=conversations(observation)
        linked=[candidate for candidate in candidates if candidate.get('linked')]
        chosen=linked[0] if len(linked)==1 else None
        result=dict(instance=observation['identity'], screen=observation['screen'], context=observation['context'],
                    activity=provider_activity(observation,candidates), log=None, users=[],
                    send_available=bool(observation['identity']) and not observation['in_mode'] and not approval_menu(observation)
                        and not (observation['kind']=='pi' and pi_dialog(observation)))
        if chosen:
            info=os.stat(chosen['path'])
            result['log']=dict(conversation=chosen['id'],device=info.st_dev,inode=info.st_ino,size=info.st_size)
            page=history(chosen['path'],observation['kind'],active_leaf=chosen.get('leaf_id',False),include_activity=False)
            result['users']=[dict(position=int(message['id']),digest=message.get('input_hash')) for message in page['messages'] if message['role']=='user' and message.get('input_hash')]
        return result
    if request.get('action') == 'send':
        if observation['kind']=='pi' and pi_dialog(observation): fail(409,'Pi is waiting for input in a dialog. Answer it in the terminal before sending a message.')
        if not observation['identity'] or observation['identity'] != request.get('identity'):
            fail(409, 'Agent process changed; refresh before sending')
        if observation['in_mode'] or observation['screen'] != request.get('screen'):
            fail(409, 'Terminal changed; review the latest context before sending')
        text = request.get('text', '')
        if not isinstance(text, str) or not text.strip() or len(text.encode()) > 12000 or any(ord(c) < 32 and c not in '\n\t' or ord(c) == 127 for c in text):
            fail(400, 'Message must be 1–12000 UTF-8 bytes without control characters')
        if request.get('require_ready') and provider_activity(observation)['state'] != 'ready':
            fail(409, 'Agent is no longer Ready; no message was pasted')
        if provider_activity(observation)['state'] == 'approval':
            fail(409, 'Pi is waiting for input. Respond in the terminal.' if observation['kind']=='pi' else 'Agent is awaiting approval. Respond in the terminal.')
        buffer = 'cc-message-' + uuid.uuid4().hex
        try:
            tmux(request, 'load-buffer', '-b', buffer, '-', input=text.encode())
            fresh = observe(request)
            if fresh['identity'] != observation['identity'] or fresh['screen'] != observation['screen'] or fresh['in_mode'] or provider_activity(fresh)['state'] == 'approval' or (fresh['kind']=='pi' and pi_dialog(fresh)):
                fail(409, 'Agent or terminal changed; message was not pasted')
            if request.get('require_ready') and provider_activity(fresh)['state'] != 'ready':
                fail(409, 'Agent is no longer Ready; no message was pasted')
            # -p honors bracketed paste; contents never become shell syntax.
            try:
                tmux(request, 'paste-buffer', '-p', '-d', '-b', buffer, '-t', observation['target'])
                tmux(request, 'send-keys', '-t', observation['target'], 'Enter')
            except (Failure, subprocess.SubprocessError):
                fail(502, 'Delivery uncertain; check the terminal before sending again')
            return dict(sent=True)
        finally:
            try: tmux(request, 'delete-buffer', '-b', buffer)
            except Failure: pass
    candidates = conversations(observation)
    selected = request.get('conversation')
    if not selected:
        linked = [c for c in candidates if c['linked']]
        if len(linked) == 1: selected = linked[0]['id']
        elif len(candidates) == 1 and not observation['env'].get('CC_LAUNCH_ID'): selected = candidates[0]['id']
    chosen = next((c for c in candidates if c['id'] == selected), None)
    if selected and not chosen:
        fail(409, 'Conversation is no longer available for this project')
    result = dict(instance=observation['identity'], screen=observation['screen'], context=observation['context'],
                  project=observation['cwd'], provider=observation['kind'], selected=selected,
                  approval=approval_menu(observation),
                  association='process' if chosen and chosen['linked'] else 'project' if chosen else 'none',
                  conversations=[{k:v for k,v in c.items() if k != 'path'} for c in candidates],
                  activity=provider_activity(observation, candidates),
                  messages=[], older_cursor=None,
                  send_available=bool(observation['identity']) and not observation['in_mode'])
    if observation['kind']=='pi' and (pi_dialog(observation) or result['activity']['state']=='approval'):
        result['send_available']=False
        result['send_reason']='Pi is waiting for input in a dialog. Answer it in the terminal before sending a message.'
    if chosen:
        info, version = transcript_version(chosen)
        result['history_version'] = version
        if request.get('before') is None and request.get('known_version') == version:
            result['history_unchanged'] = True
        else:
            result.update(history(chosen['path'], observation['kind'], request.get('before'), request.get('known_branch'), chosen.get('leaf_id',False)))
        if request.get('before') is None and chosen.get('linked') and not result.get('history_unchanged'):
            result['_outbox_observation']=dict(log=dict(conversation=chosen['id'],device=info.st_dev,inode=info.st_ino,size=info.st_size),users=[dict(position=int(message['id']),digest=message.get('input_hash')) for message in result.get('messages',[]) if message['role']=='user' and message.get('input_hash')])
        if request.get('before') is None:
            result['reply'] = reply_observation(chosen, observation['kind'], request.get('known_reply_version'), None if result.get('history_unchanged') else result)
    return result

if __name__ == '__main__':
    try:
        request = json.loads(sys.stdin.buffer.read(32 * 1024 + 1))
        response = {'ok': execute(request)}
    except Failure as e:
        response = {'status': e.status, 'error': e.message}
    except (OSError, ValueError, KeyError, subprocess.SubprocessError, sqlite3.Error):
        response = {'status': 502, 'error': 'Agent observation failed; refresh or open the terminal'}
    json.dump(response, sys.stdout, ensure_ascii=True)
