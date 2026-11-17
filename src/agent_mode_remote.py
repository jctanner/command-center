"""Trusted fixed-source native/ACP handoff helper; no user commands or log paths."""
import hashlib,json,os,re,signal,subprocess,sys,time,uuid
from pathlib import Path


def load_helpers(request):
    a={'__name__':'cc_agent'};b={'__name__':'cc_acp'}
    exec(request['_agent_code'],a);exec(request['_acp_code'],b)
    return a,b


def idle_native(a,observed):
    if observed['kind']!='codex' or not observed.get('identity'):
        raise ValueError('Mode switching supports verified Codex agents only')
    if observed['in_mode'] or a['provider_activity'](observed)['state']!='ready' or a['native_input_dialog'](observed):
        raise ValueError('Wait for verified Ready with no active prompt before switching')


def broker_observation(request,a,b):
    path=b['target_root'](request);live=b['verified_live'](path);b['verify_target'](request,path,live)
    if live['instance']!=request['broker_instance']:
        raise ValueError('ACP process changed')
    target=b['read_json'](os.path.join(path,'target.json'))
    if any(target[k]!=request[k] for k in ('session','window','pane')):
        raise ValueError('ACP tmux target changed')
    value=b['call'](dict(request,action='call',command={'action':'snapshot'}))
    if value.get('provider')!='codex' or not value.get('handoff_supported'):
        raise ValueError('This broker does not support Codex handoff; existing brokers are not modified automatically')
    if value.get('state')!='ready' or any(not p.get('expired') for p in value.get('permissions',[])):
        raise ValueError('Wait for ACP Ready with no pending permission')
    if any(r.get('state')in ('claimed','uncertain') or r.get('kind')=='prompt' and r.get('state')!='completed' for r in value.get('receipts',[])):
        raise ValueError('Check unresolved ACP receipts before switching')
    session=value.get('session_id');b['canonical_uuid'](session)
    env={}
    for entry in Path('/proc',str(live['pid']),'environ').read_bytes().decode().split('\0'):
        key,_,val=entry.partition('=')
        if key in ('CODEX_HOME','VIRTUAL_ENV'):env[key]=val
    observed=dict(kind='codex',identity=request['identity'],cwd=value['path'],env=env,base=None,args=['codex','resume',session])
    # Native metadata must independently confirm this exact thread and directory.
    candidates=[c for c in a['conversations'](observed)if c.get('linked') and c['session']==session]
    if len(candidates)!=1:raise ValueError('No unique persisted native conversation matches this ACP thread')
    plan=a['restart_plan'](request,observed)
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
                    raise ValueError('Installed Codex adapter does not advertise ACP session/load')
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
    if mode not in ('native','acp'):raise ValueError('Unsupported destination mode')
    if mode=='acp':
        if request.get('broker'):raise ValueError('Already an ACP agent')
        observed=a['observe'](request);idle_native(a,observed)
        native=a['restart_plan'](request,observed)
        native['screen']=observed['screen']
        adapter=b['options']({'path':native['project'],'provider':'codex'})
        if probe:probe_load(adapter['executable'])
        native['adapter']=adapter
    else:
        if not request.get('broker'):raise ValueError('Already a native agent')
        native=broker_observation(request,a,b)
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
    if request['mode']=='acp':
        ident=b['canonical_uuid'](request['id']);path=os.path.join(b['root'](True),ident);os.mkdir(path,0o700)
        b['exclusive_json'](os.path.join(path,'intent.json'),{'id':ident,'prepared':fresh['adapter'],'resume_session':fresh['session'],'initial_prompt':None,'at':time.time()})
        b['exclusive_json'](os.path.join(path,'target.json'),{k:request[k]for k in ('session','window','pane')})
        with os.fdopen(os.open(os.path.join(path,'broker.py'),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600),'w')as out:out.write(request['_broker_code'])
        command=[sys.executable,os.path.join(path,'broker.py'),path,fresh['adapter']['executable'],fresh['project']]
    else:command=fresh['command']
    a['tmux'](request,'set-option','-p','-t',target,'@cc_mode_switch',stamp)
    a['tmux'](request,'set-option','-p','-t',target,'remain-on-exit','on')
    if plan(request,a,b)!=expected:raise ValueError('Agent changed immediately before handoff; inspect the pane')
    if request['mode']=='native':
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
        if request['mode']=='acp':
            if a['observe'](request).get('identity')!=request['identity']:raise ValueError('Original process changed after rejected handoff')
        else:broker_observation(request,a,b)
        return {'state':'not_sent','note':'Verified not sent; original process retained. A fresh reviewed switch is required.'}
    if json.loads(marker(request,a))!={'id':request['id'],'old':request['identity']}:raise ValueError('Handoff marker changed; inspect the pane')
    if request['mode']=='acp':
        value=b['call'](dict(request,action='call',broker=request['id']))
        if value.get('state')=='failed':return {'state':'checking','note':value.get('failure','ACP resume failed; inspect the pane')}
        if value.get('session_id')!=expected['session'] or value.get('state')!='ready':return {'state':'checking','note':'Waiting for exact ACP session/load completion'}
        live=b['verified_live'](b['target_root'](dict(request,broker=request['id'])))
        env=Path('/proc',str(live['pid']),'environ').read_bytes().split(b'\0')
        if ('CC_MODE_SWITCH_ID='+request['id']).encode()not in env:raise ValueError('Replacement broker is not this handoff')
        return {'state':'complete','instance':hashlib.sha256(('acp/'+request['id']+'/'+value['instance']).encode()).hexdigest()}
    observed=a['observe'](request)
    if observed['identity']==request['identity']:return {'state':'checking','note':'Original process is still present; no retry'}
    if observed['env'].get('CC_MODE_SWITCH_ID')!=request['id'] or observed['kind']!='codex' or observed['cwd']!=expected['project']:
        raise ValueError('A different process occupies the pane; metadata not transferred')
    linked=[c for c in a['conversations'](observed)if c.get('linked')]
    if len(linked)!=1 or linked[0]['session']!=expected['session'] or linked[0]['id']!=expected['conversation']:return {'state':'checking','note':'Waiting for native resume conversation verification'}
    return {'state':'complete','instance':observed['identity']}


def main(request):
    a,b=load_helpers(request)
    if request['action']=='prepare':return plan(request,a,b,True)
    if request['action']=='start':return start(request,a,b)
    if request['action']=='status':return status(request,a,b)
    raise ValueError('Unsupported switch action')

if __name__=='__main__':
    os.umask(0o077)
    try:print(json.dumps({'ok':main(json.load(sys.stdin))}))
    except Exception as error:
        # Suppress provider stderr, raw process environments and transcript bodies.
        print(json.dumps({'status':409,'error':getattr(error,'message',str(error))[:300]}))
