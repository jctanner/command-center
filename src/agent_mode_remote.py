"""Trusted fixed-source native/ACP handoff helper; no user commands or log paths."""
import hashlib,json,os,re,signal,subprocess,sys,time,uuid
from pathlib import Path


def load_helpers(request):
    a={'__name__':'cc_agent'};b={'__name__':'cc_acp'}
    exec(request['_agent_code'],a);exec(request['_acp_code'],b)
    return a,b


def idle_native(a,observed):
    if observed['kind']not in ('codex','claude') or not observed.get('identity'):
        raise ValueError('Mode switching supports verified Codex and Claude agents only')
    if observed['in_mode'] or a['provider_activity'](observed)['state']!='ready' or a['native_input_dialog'](observed):
        raise ValueError('Wait for verified Ready with no active prompt before switching')
    if observed['kind']=='claude':
        linked=[c for c in a['conversations'](observed)if c.get('linked')]
        tasks=a['observed_background_tasks'](observed,linked[0]if len(linked)==1 else None)
        if tasks and (tasks.get('unavailable')or any(t.get('state')in ('running','waiting','unverified')for t in tasks.get('tasks',[]))):
            raise ValueError('Resolve Claude background tasks before switching')


def broker_observation(request,a,b):
    path=b['target_root'](request);live=b['verified_live'](path);b['verify_target'](request,path,live)
    if live['instance']!=request['broker_instance']:
        raise ValueError('ACP process changed')
    target=b['read_json'](os.path.join(path,'target.json'))
    if any(target[k]!=request[k] for k in ('session','window','pane')):
        raise ValueError('ACP tmux target changed')
    value=b['call'](dict(request,action='call',command={'action':'snapshot'}))
    if value.get('provider')not in ('codex','claude') or not value.get('handoff_supported'):
        raise ValueError('This broker does not support this provider handoff; existing brokers are not modified automatically')
    if value.get('command_running'):raise ValueError('Wait for the local command to finish before switching')
    if value.get('queued_prompts') or value.get('queue_blocked'):raise ValueError('Resolve queued or blocked ACP messages before restarting or switching')
    if value.get('state')!='ready' or any(not p.get('expired') for p in value.get('permissions',[])):
        raise ValueError('Wait for ACP Ready with no pending permission')
    if any(t.get('status')in ('pending','in_progress')for t in value.get('tools',[])):
        raise ValueError('Wait for ACP tools to finish before switching')
    if any(r.get('state')in ('claimed','uncertain') or r.get('kind')in ('prompt','harness_command') and r.get('state')not in ('completed','cancelled','expired') or r.get('kind')=='local_command' and r.get('state')not in ('completed','cancelled','expired','failed') for r in value.get('receipts',[])):
        raise ValueError('Check unresolved ACP receipts before switching')
    session=value.get('session_id');b['canonical_uuid'](session)
    env={}
    for entry in Path('/proc',str(live['pid']),'environ').read_bytes().decode().split('\0'):
        key,_,val=entry.partition('=')
        if key in ('CODEX_HOME','CLAUDE_CONFIG_DIR','VIRTUAL_ENV'):env[key]=val
    provider=value['provider']
    observed=dict(kind=provider,identity=request['identity'],cwd=value['path'],env=env,base=None,args=['codex','resume',session]if provider=='codex'else['claude','--resume',session])
    native_session=a['claude_current_session'](a['provider_home'](observed),observed['cwd'],session)if provider=='claude'else session
    if not native_session:raise ValueError('Native continuation chain cannot be verified')
    # Native metadata must independently confirm this exact thread and directory.
    candidates=[c for c in a['conversations'](observed)if c.get('linked') and c['session']==native_session]
    if len(candidates)!=1:raise ValueError('No unique persisted native conversation matches this ACP thread')
    plan=a['restart_plan'](request,observed)
    plan['acp_session']=session
    plan['broker_identity']={k:live[k]for k in ('instance','pid','start','boot','agent_pid')}
    return plan


def probe_load(executable):
    """Negotiate initialize only: no session creation/auth/tool/input side effects."""
    p=subprocess.Popen([executable],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
        import selectors
        p.stdin.write((json.dumps({'jsonrpc':'2.0','id':'cc-load-probe','method':'initialize','params':{'protocolVersion':1,'clientInfo':{'name':'command-center-probe','version':'1'},'clientCapabilities':{}}})+'\n').encode());p.stdin.flush()
        selector=selectors.DefaultSelector();selector.register(p.stdout,selectors.EVENT_READ)
        end=time.monotonic()+5;data=b''
        while time.monotonic()<end and len(data)<1024*1024:
            if not selector.select(max(0,end-time.monotonic())):break
            part=os.read(p.stdout.fileno(),65536)
            if not part:break
            data+=part
            while b'\n'in data:
                line,data=data.split(b'\n',1);v=json.loads(line)
                if v.get('id')=='cc-load-probe':
                    r=v.get('result',{})
                    if r.get('protocolVersion')==1 and r.get('agentCapabilities',{}).get('loadSession') is True:return
                    raise ValueError('Installed adapter does not advertise ACP session/load')
        raise ValueError('ACP session/load capability check timed out or exceeded bounds')
    finally:
        if p.poll()is None:os.killpg(p.pid,signal.SIGTERM)
        try:p.wait(timeout=2)
        except subprocess.TimeoutExpired:
            if p.poll()is None:os.killpg(p.pid,signal.SIGKILL)
            p.wait(timeout=2)
        p.stdin.close();p.stdout.close()


def plan(request,a,b,probe=False):
    mode=request.get('mode')
    if mode not in ('native','acp','acp_restart'):raise ValueError('Unsupported destination mode')
    if mode=='acp':
        if request.get('broker'):raise ValueError('Already an ACP agent')
        observed=a['observe'](request);idle_native(a,observed)
        native=a['restart_plan'](request,observed)
        native['screen']=observed['screen']
        try:
            adapter=b['options']({'path':native['project'],'provider':native['provider']})
            if probe:probe_load(adapter['executable'])
            native['adapter']=adapter
        except b['MissingAdapter']:
            if not probe:raise
            installer={'__name__':'cc_install'};exec(request['_install_code'],installer)
            native['installation']=installer['propose'](native['provider'])
    else:
        if not request.get('broker'):raise ValueError('Already a native agent')
        native=broker_observation(request,a,b)
    if mode=='acp_restart':
        original=b['read_json'](os.path.join(b['target_root'](request),'intent.json'))
        if any(k in original.get('prepared',{}) for k in ('profile','container','container_profile')):
            raise ValueError('Container broker restart is not supported; no host fallback')
        adapter=b['options']({'path':native['project'],'provider':native['provider']})
        if probe:probe_load(adapter['executable'])
        native['adapter']=adapter
        native['broker_digest']=hashlib.sha256(request['_broker_code'].encode()).hexdigest()
    pane_pid=int(a['tmux'](request,'display-message','-p','-t',request['pane'],'#{pane_pid}').strip())
    native['pane_process']={'pid':pane_pid,'start':a['proc'](pane_pid)[1]}
    native['mode']=mode
    return native


def marker(request,a):
    return a['tmux'](request,'show-options','-p','-v','-t',request['pane'],'@cc_mode_switch').strip()


def claim(request,a,b):
    # A remote durable no-overwrite claim supplements the backend receipt.
    base=os.path.join(b['root'](True),'mode-switches');b['safe_directory'](base,True,True)
    if len(os.listdir(base))>=4096:raise ValueError('Mode-switch claim capacity reached; retain receipts for review')
    path=os.path.join(base,b['canonical_uuid'](request['id']))
    b['exclusive_json'](path,{'id':request['id'],'identity':request['identity'],'mode':request['mode'],'phase':'validating'})
    return path


def perform_start(request,a,b,progress):
    expected=request['plan'];fresh=plan(request,a,b)
    if fresh!=expected:raise ValueError('Agent, transcript, directory or installation changed; no switch attempted')
    target=f"{request['session']}:{request['window']}.{request['pane']}"
    stamp=json.dumps({'id':request['id'],'old':request['identity']},sort_keys=True)
    env={**fresh['environment'],'CC_MODE_SWITCH_ID':request['id']}
    if request['mode']in ('acp','acp_restart'):
        ident=b['canonical_uuid'](request['id']);path=os.path.join(b['root'](True),ident);os.mkdir(path,0o700)
        b['exclusive_json'](os.path.join(path,'intent.json'),{'id':ident,'prepared':fresh['adapter'],'resume_session':fresh['session'],'initial_prompt':None,'at':time.time()})
        b['exclusive_json'](os.path.join(path,'target.json'),{k:request[k]for k in ('session','window','pane')})
        with os.fdopen(os.open(os.path.join(path,'broker.py'),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'w')as out:out.write(request['_broker_code'])
        command=[sys.executable,os.path.join(path,'broker.py'),path,fresh['adapter']['executable'],fresh['project']]
    else:command=fresh['command']
    a['tmux'](request,'set-option','-p','-t',target,'@cc_mode_switch',stamp)
    a['tmux'](request,'set-option','-p','-t',target,'remain-on-exit','on')
    if plan(request,a,b)!=expected:raise ValueError('Agent changed immediately before handoff; inspect the pane')
    if request.get('broker'):
        # Freeze broker dispatch atomically and stop its own child group before replacing its terminal.
        progress['mutating']=True
        b['call'](dict(request,action='call',command={'action':'handoff','instance':request['broker_instance'],'id':request['id']}))
        live=expected['broker_identity'];path=b['target_root'](request)
        current=b['verified_live'](path)
        if any(current[k]!=live[k]for k in live):raise ValueError('Broker replaced during handoff')
        fd=os.pidfd_open(live['pid'])
        try:
            current=b['verified_live'](path)
            if any(current[k]!=live[k]for k in live):raise ValueError('Broker replaced before exit')
            signal.pidfd_send_signal(fd,signal.SIGTERM)
        finally:os.close(fd)
        # Wait for the exact old broker to exit; never respawn over an unknown occupant.
        for _ in range(40):
            try:
                if Path('/proc',str(live['pid']),'stat').read_text().rsplit(')',1)[1].split()[0]=='Z':break
                if b['verified_live'](path)['start']!=live['start']:raise ValueError('Broker PID replaced')
            except FileNotFoundError:break
            time.sleep(.05)
        else:raise ValueError('Broker did not exit; inspect the pane')
        # A shell may take foreground after EOF; only respawn if the original pane leader remains/dead.
    pane_value=a['tmux'](request,'display-message','-p','-t',target,'#{pane_pid}').strip()
    dead=a['tmux'](request,'display-message','-p','-t',target,'#{pane_dead}').strip()=='1'
    if pane_value:
        pane_pid=int(pane_value)
        if pane_pid!=expected['pane_process']['pid']:raise ValueError('Pane process replaced during handoff')
        try:
            if a['proc'](pane_pid)[1]!=expected['pane_process']['start']:raise ValueError('Pane process reused')
        except FileNotFoundError:
            if not dead:raise ValueError('Pane leader vanished unexpectedly')
    elif not dead:raise ValueError('No verified pane process or empty dead pane')
    if json.loads(marker(request,a))!={'id':request['id'],'old':request['identity']}:raise ValueError('Handoff marker changed')
    environment=[v for key,value in env.items()for v in ('-e',key+'='+value)]
    progress['mutating']=True
    a['respawn_launch'](request,target,fresh['project'],environment,command)
    return {'state':'checking'}


def start(request,a,b):
    path=claim(request,a,b);progress={'mutating':False}
    try:return perform_start(request,a,b,progress)
    except Exception as error:
        if progress['mutating']:raise
        # Durable proof that no source stop/respawn was attempted. This permits
        # a separately reviewed fresh action, never a replay of this receipt.
        record=b['read_json'](path);record['phase']='not_sent'
        temporary=path+'.not-sent';b['exclusive_json'](temporary,record);os.replace(temporary,path)
        return {'state':'not_sent','note':'No process was stopped or replaced. '+getattr(error,'message',str(error))[:250]}


def status(request,a,b):
    expected=request['plan']
    receipt=os.path.join(b['root'](),'mode-switches',b['canonical_uuid'](request['id']))
    if os.path.isfile(receipt) and b['read_json'](receipt).get('phase')=='not_sent':
        if not request.get('broker'):
            if a['observe'](request).get('identity')!=request['identity']:raise ValueError('Original process changed after rejected handoff')
        else:broker_observation(request,a,b)
        return {'state':'not_sent','note':'Verified not sent; original process retained. A fresh reviewed switch is required.'}
    if json.loads(marker(request,a))!={'id':request['id'],'old':request['identity']}:raise ValueError('Handoff marker changed; inspect the pane')
    if request['mode']in ('acp','acp_restart'):
        value=b['call'](dict(request,action='call',broker=request['id']))
        if value.get('state')=='failed':return {'state':'checking','note':value.get('failure','ACP resume failed; inspect the pane')}
        if value.get('session_id')!=expected['session'] or value.get('state')!='ready':return {'state':'checking','note':'Waiting for exact ACP session/load completion'}
        live=b['verified_live'](b['target_root'](dict(request,broker=request['id'])))
        if expected.get('broker_digest') and hashlib.sha256(Path(b['target_root'](dict(request,broker=request['id'])),'broker.py').read_bytes()).hexdigest()!=expected['broker_digest']:
            raise ValueError('Replacement broker source does not match the reviewed version')
        env=Path('/proc',str(live['pid']),'environ').read_bytes().split(b'\0')
        if ('CC_MODE_SWITCH_ID='+request['id']).encode()not in env:raise ValueError('Replacement broker is not this handoff')
        return {'state':'complete','instance':hashlib.sha256(('acp/'+request['id']+'/'+value['instance']).encode()).hexdigest()}
    observed=a['observe'](request)
    if observed['identity']==request['identity']:return {'state':'checking','note':'Original process is still present; no retry'}
    if observed['env'].get('CC_MODE_SWITCH_ID')!=request['id'] or observed['kind']!=expected['provider'] or observed['cwd']!=expected['project']:
        raise ValueError('A different process occupies the pane; metadata not transferred')
    linked=[c for c in a['conversations'](observed)if c.get('linked')]
    if len(linked)!=1 or linked[0]['session']!=expected['session'] or linked[0]['id']!=expected['conversation']:return {'state':'checking','note':'Waiting for native resume conversation verification'}
    return {'state':'complete','instance':observed['identity']}


def recover(request,a,b):
    expected=request['plan']
    if request.get('mode')!='acp' or request.get('broker'):
        raise ValueError('Only a failed native-to-ACP attempt recovered to native can be resolved')
    observed=a['observe'](request)
    if observed['identity']!=request['identity'] or observed['identity']==expected['identity'] or observed['kind']!=expected['provider'] or observed['cwd']!=expected['project']:
        raise ValueError('Recovered native process or directory changed')
    session=expected['session']
    if observed['kind']=='claude':session=a['claude_current_session'](a['provider_home'](observed),observed['cwd'],session)
    linked=[c for c in a['conversations'](observed)if c.get('linked')]
    if not session or len(linked)!=1 or linked[0]['session']!=session:
        raise ValueError('Recovered native conversation is not the original session')
    path=b['target_root'](dict(request,broker=request['id']))
    target=b['read_json'](os.path.join(path,'target.json'))
    if any(target[k]!=request[k]for k in ('session','window','pane')):
        raise ValueError('Original broker target changed')
    intent=b['read_json'](os.path.join(path,'intent.json'))
    if intent.get('resume_session')!=expected['session']:
        raise ValueError('Original broker resume identity cannot be verified')
    live=b['read_json'](os.path.join(path,'live.json'))
    boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    if live['boot']==boot:
        for key in ('pid','agent_pid'):
            try:state=Path('/proc',str(live[key]),'stat').read_text().rsplit(')',1)[1].split()[0]
            except FileNotFoundError:continue
            if state!='Z':raise ValueError('Original broker or adapter is still running; inspect it before resolving')
    fresh=a['observe'](request)
    if fresh['identity']!=observed['identity'] or fresh['cwd']!=observed['cwd']:
        raise ValueError('Recovered process changed during verification')
    return dict(state='recovered',instance=observed['identity'],session=session,conversation=linked[0]['id'])


def main(request):
    a,b=load_helpers(request)
    if request['action']=='prepare':return plan(request,a,b,True)
    if request['action']in ('install_start','install_status'):
        installer={'__name__':'cc_install'};exec(request['_install_code'],installer)
        if request['action']=='install_status':return installer['status'](request['id'])
        try:
            if request.get('mode')!='acp' or request.get('broker') or plan(request,a,b,True)!=request['plan']:
                raise ValueError('Agent or installation target changed; prepare a fresh review')
        except Exception:
            return {'state':'install_failed','note':'Installation preflight changed. No package installation or agent switch was attempted; prepare again.'}
        return installer['start'](request['id'],request['plan']['installation'],request['_install_code'])
    if request['action']=='start':return start(request,a,b)
    if request['action']=='status':return status(request,a,b)
    if request['action']=='recover':return recover(request,a,b)
    raise ValueError('Unsupported switch action')

if __name__=='__main__':
    os.umask(0o077)
    try:print(json.dumps({'ok':main(json.load(sys.stdin))}))
    except Exception as error:
        # Suppress provider stderr, raw process environments and transcript bodies.
        print(json.dumps({'status':409,'error':getattr(error,'message',str(error))[:300]}))
