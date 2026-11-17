"""Pinned, private, one-shot ACP adapter installer. Never controls an agent."""
import ctypes,errno,json,os,re,shutil,signal,stat,subprocess,sys,time,uuid
from pathlib import Path
PROVIDERS={
    'codex':dict(package='@agentclientprotocol/codex-acp',version='2.7.0',executable='codex-acp',integrity='sha512-fFFU/tV5DltBzN4cZIh5tJEWGTZFXbwHU7I5RxPkmrGraw3jhAIuvTeudYwK3wAbV311WgIi7qONl2I8uRV2jw=='),
    'claude':dict(package='@agentclientprotocol/claude-agent-acp',version='0.107.3',executable='claude-agent-acp',node_min_major=22,integrity='sha512-GrDLX0wOcvTGsQwJgUpEp8PLERByV6/e25VioqRTg41JUkvATE1VOImg5L62mF8e78p+ODrvr5CfMU8ySVzbMA=='),
}
TIMEOUT=180
MAX_BYTES=768*1024*1024


def directory(path,create=False,private=False):
    path=Path(path)
    if create and not path.exists():
        directory(path.parent,True);path.mkdir(mode=0o700)
    st=path.lstat()
    if not stat.S_ISDIR(st.st_mode)or st.st_uid!=os.getuid()or st.st_mode&(0o077 if private else 0o022)or path.resolve()!=path:
        raise ValueError('Unsafe adapter installation directory')
    return path


def regular(path):
    st=Path(path).lstat()
    if not stat.S_ISREG(st.st_mode)or st.st_uid!=os.getuid()or st.st_mode&0o077 or st.st_nlink!=1:raise ValueError('Unsafe installation receipt')
    return st


def read(path):
    regular(path)
    with Path(path).open('rb')as stream:data=stream.read(65537)
    if len(data)>65536:raise ValueError('Installation receipt too large')
    return json.loads(data)


def write(path,value):
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w')as stream:json.dump(value,stream);stream.flush();os.fsync(stream.fileno())


def identity(path):
    st=Path(path).stat();return [st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns]


def root(create=False):
    home=directory(Path.home());path=home/'.cache/command-center/acp-installs'
    for part in [home/'.cache',home/'.cache/command-center',path]:
        if part.exists()or create:directory(part,create,part==path)
    return path


def propose(provider='codex'):
    if provider not in PROVIDERS:raise ValueError('Unsupported ACP adapter provider')
    profile=PROVIDERS[provider]
    node={}
    if profile.get('node_min_major'):
        binary=shutil.which('node')
        if not binary:raise ValueError('Claude ACP requires Node.js 22 or newer')
        binary=str(Path(binary).resolve())
        try:
            result=subprocess.run([binary,'--version'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=2)
            match=re.fullmatch(rb'v([0-9]+)\.[0-9]+\.[0-9]+\s*',result.stdout[:100])
            if result.returncode or not match or int(match[1])<profile['node_min_major']:raise ValueError('Claude ACP requires Node.js 22 or newer')
        except (OSError,subprocess.SubprocessError):raise ValueError('Claude ACP requires Node.js 22 or newer')
        node=dict(node=binary,node_identity=identity(binary))
    home=directory(Path.home());prefix=home/'.local/share/command-center/acp-adapters'/provider
    part=home
    for component in prefix.relative_to(home).parts:
        part=part/component
        if os.path.lexists(part):directory(part)
    if os.path.lexists(prefix):raise ValueError('Managed adapter folder already exists but its executable is missing; inspect it before installation')
    executable=shutil.which('npm')
    if not executable:raise ValueError('Install Node.js/npm on this machine before requesting an ACP adapter')
    executable=str(Path(executable).resolve())
    if not os.access(executable,os.X_OK):raise ValueError('npm is not executable')
    if not hasattr(ctypes.CDLL(None),'renameat2'):raise ValueError('Atomic no-overwrite publication unavailable on this host')
    return dict(provider=provider,**profile,**node,prefix=str(prefix),npm=executable,npm_identity=identity(executable),home_identity=identity(home)[:2],scripts=False,registry='https://registry.npmjs.org',timeout_seconds=TIMEOUT)


def job_path(ident):
    if not isinstance(ident,str)or str(uuid.UUID(ident))!=ident:raise ValueError('Invalid installation UUID')
    return root()/ident


def start(ident,proposal,code):
    try:
        if proposal!=propose(proposal.get('provider','codex')):raise ValueError('Installation target changed')
    except Exception:return {'state':'install_failed','note':'Installation target or npm changed; review again. No agent was stopped.'}
    base=directory(root(True),private=True)
    if len(list(base.iterdir()))>=128:raise ValueError('Installation receipt capacity reached')
    job=job_path(ident);job.mkdir(mode=0o700)
    write(job/'intent.json',dict(id=ident,proposal=proposal,at=time.time()))
    child=None;lock=base/(proposal['provider']+'.lock');claimed=False
    try:
        write(lock,dict(id=ident));claimed=True
        source=job/'installer.py';fd=os.open(source,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w')as stream:stream.write(code);stream.flush();os.fsync(stream.fileno())
        child=subprocess.Popen([sys.executable,str(source),str(job)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,close_fds=True)
        start_id=Path('/proc',str(child.pid),'stat').read_text().rsplit(')',1)[1].split()[19]
        write(job/'process.json',dict(pid=child.pid,start=start_id,boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip()))
        return {'state':'installing'}
    except Exception:
        if child is not None:return {'state':'installing','note':'Check the original installation receipt; the installer may be running.'}
        result={'id':ident,'state':'install_failed','note':'Installer did not start; another installation may be active. No agent was stopped.'}
        finish(job,result)
        if claimed and read(lock).get('id')==ident:lock.unlink()
        return result


def status(ident):
    job=directory(job_path(ident),private=True);intent=read(job/'intent.json')
    if intent.get('id')!=ident:raise ValueError('Installation receipt mismatch')
    if (job/'result.json').exists():
        result=read(job/'result.json')
        if result.get('id')!=ident or result.get('state')not in ('installed','install_failed'):raise ValueError('Invalid installation result')
        return result
    if time.time()-intent['at']>TIMEOUT+30:return {'state':'install_uncertain','note':'No final installation receipt. Inspect this installation; it will not be retried automatically.'}
    return {'state':'installing','note':'Installing pinned ACP adapter in its isolated directory. Closing CC does not cancel installation. The current agent is unchanged.'}


def publish(source,destination):
    # Linux RENAME_NOREPLACE rejects any existing destination atomically.
    libc=ctypes.CDLL(None,use_errno=True);call=libc.renameat2
    call.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];call.restype=ctypes.c_int
    if call(-100,os.fsencode(source),-100,os.fsencode(destination),1):raise OSError(ctypes.get_errno(),'Adapter publication rejected; destination must remain absent')


def finish(job,result):
    temporary=job/'result.next';write(temporary,result);publish(temporary,job/'result.json')
    fd=os.open(job,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)


def cleanup(job):
    for name in ('stage','cache'):
        path=job/name
        if os.path.lexists(path):
            directory(path,private=True);shutil.rmtree(path)


def work(job):
    os.umask(0o077);job=directory(Path(job),private=True);regular(job/'installer.py');intent=read(job/'intent.json');ident=intent['id'];proposal=intent['proposal']
    child=None;result={'id':ident,'state':'install_failed','note':'Adapter installation failed. No agent was stopped; inspect the installation receipt before trying again.'}
    try:
        if job!=job_path(ident)or proposal!=propose(proposal.get('provider','codex')):raise ValueError('Installation intent changed')
        stage=directory(job/'stage',True,True);cache=directory(job/'cache',True,True);write(job/'npmrc',{})
        # Use an empty config file, not the project or user npm configuration.
        (job/'npmrc').write_text('')
        env={k:v for k,v in os.environ.items()if k in ('PATH','HOME','LANG','LC_ALL','HTTP_PROXY','HTTPS_PROXY','NO_PROXY')}
        command=[proposal['npm'],'install','--prefix',str(stage),'--save-exact','--ignore-scripts','--no-audit','--no-fund','--registry',proposal['registry'],'--userconfig',str(job/'npmrc'),'--globalconfig','/dev/null','--cache',str(cache),proposal['package']+'@'+proposal['version']]
        child=subprocess.Popen(command,cwd=stage,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
        end=time.monotonic()+TIMEOUT
        while child.poll()is None:
            if time.monotonic()>end:raise ValueError('Installation exceeded its time limit')
            total=0
            for base,dirs,files in os.walk(job):
                for name in files:
                    try:total+=(Path(base)/name).lstat().st_size
                    except FileNotFoundError:pass
                if total>MAX_BYTES:raise ValueError('Installation exceeded its disk limit')
            time.sleep(.25)
        if child.returncode:raise ValueError('Package manager failed; check Node/npm and registry access')
        package=json.loads((stage/'node_modules'/proposal['package']/'package.json').read_text())
        lock=json.loads((stage/'package-lock.json').read_text())['packages']['node_modules/'+proposal['package']]
        binary=stage/'node_modules/.bin'/proposal['executable']
        if package.get('version')!=proposal['version'] or lock.get('version')!=proposal['version'] or lock.get('integrity')!=proposal['integrity'] or not binary.is_file()or not binary.resolve().is_relative_to(stage)or not os.access(binary,os.X_OK):raise ValueError('Pinned adapter validation failed')
        if propose(proposal['provider'])!=proposal:raise ValueError('Install destination changed before publication')
        prefix=Path(proposal['prefix']);directory(prefix.parent,True);publish(stage,prefix)
        fd=os.open(prefix.parent,os.O_RDONLY)
        try:os.fsync(fd)
        finally:os.close(fd)
        result={'id':ident,'state':'installed','note':'Pinned ACP adapter installed. Prepare a fresh switch; the original agent is unchanged.'}
    except Exception as error:
        # Only fixed operational errors, never npm logs, credentials or environment.
        if isinstance(error,ValueError):result['note']=str(error)[:250]+'. No agent was stopped.'
    finally:
        if child is not None and child.poll()is None:
            try:os.killpg(child.pid,signal.SIGTERM);child.wait(timeout=3)
            except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=3)
            except ProcessLookupError:pass
        finish(job,result)
        try:cleanup(job)
        except (OSError,ValueError):pass
        lock=root()/(proposal['provider']+'.lock')
        try:
            if read(lock).get('id')==ident:lock.unlink()
        except (OSError,ValueError):pass

if __name__=='__main__':
    try:work(sys.argv[1])
    except Exception:pass # Missing final receipt stays uncertain; never self-retry.
