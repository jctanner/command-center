"""Reviewed Goose container runtime boundary. Runs only on the configured agent host.
No Goose executable is resolved on the host. Secrets never leave this module.
"""
import hashlib,json,os,re,shutil,stat,subprocess,time,fcntl
from pathlib import Path
IMAGE='ghcr.io/aaif-goose/goose@sha256:d1f8264826e35ad064cb3f97eb6fb6498fe3b424ac8d0f61ee4eef030ef10860'
MAX_PROFILE=65536
WORKSPACE_LOCKS={}

def private_file(path,limit=MAX_PROFILE,with_revision=False):
 p=Path(path);s=p.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077 or s.st_nlink!=1 or str(p.resolve())!=str(p):raise ValueError('Container configuration must be a private owned regular file without symlinks')
 with p.open('rb')as f:data=f.read(limit+1)
 if len(data)>limit:raise ValueError('Container configuration exceeds size limit')
 return (json.loads(data),hashlib.sha256(data).hexdigest())if with_revision else json.loads(data)

def directory(path):
 p=Path(path);s=p.lstat()
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o022 or str(p.resolve())!=str(p):raise ValueError('Container workspace must be owned, non-writable by others and free of symlinks')
 return [s.st_dev,s.st_ino]

PROFILE_FIELDS={'id','label','image','engine','model','base_url','secret_file','entrypoint','args','workdir','state_target','workspace_policy','selinux','mounts','volumes','environment','secret_refs','user','user_namespace','network','cpus','memory_mb','pids_limit'}

def literal(value,label,limit=4096,empty=False):
 if not isinstance(value,str)or len(value)>limit or (not value and not empty)or any(ord(c)<32 or ord(c)==127 for c in value):raise ValueError('Invalid '+label)
 return value

def container_path(value,label):
 literal(value,label)
 if not value.startswith('/')or any(x in value for x in (',',':','\\'))or any(x in ('.','..')for x in value.split('/')):raise ValueError(label+' must be a literal absolute path without dot segments, colon or comma')
 return value.rstrip('/')or '/'

def normalize_profile(raw):
 if not isinstance(raw,dict)or set(raw)-PROFILE_FIELDS:raise ValueError('Unsupported container profile fields')
 p=json.loads(json.dumps(raw));ident=literal(p.get('id'),'profile ID',48)
 if not re.fullmatch(r'[a-z][a-z0-9-]{0,47}',ident):raise ValueError('Invalid profile ID')
 p['label']=literal(p.get('label',ident),'profile label',80)
 p['image']=literal(p.get('image',IMAGE),'image name',300)
 if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/@-]{0,299}',p['image'])or ('@'in p['image']and not re.fullmatch(r'[^@]+@sha256:[0-9a-f]{64}',p['image'])):raise ValueError('Invalid image reference')
 legacy='secret_file'in p
 defaults=dict(engine='podman',entrypoint='/usr/local/bin/goose',args=['acp'],workdir='/workspace',state_target='/home/goose',workspace_policy='managed',selinux='host',mounts=[dict(source='{workspace}',target='/workspace',read_only=False,selinux='private'if legacy else'none')],volumes=[],environment={},secret_refs=[],user='1000:1000',user_namespace='default'if p.get('engine')=='docker'else'keep-id',network='default',cpus=None,memory_mb=None,pids_limit=None,model='',base_url='')
 for k,v in defaults.items():p.setdefault(k,v)
 for k,allowed in [('engine',('docker','podman')),('workspace_policy',('managed','project')),('selinux',('host','disabled')),('user_namespace',('default','keep-id')),('network',('default','none','host'))]:
  if p[k]not in allowed:raise ValueError('Invalid '+k)
 if p['engine']=='docker'and p['user_namespace']!='default':raise ValueError('Docker requires the engine-default user namespace')
 literal(p['user'],'container user',80,True)
 if p['user']and not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]*(?::[A-Za-z0-9_][A-Za-z0-9_.-]*)?',p['user']):raise ValueError('Invalid container user')
 if p['user_namespace']=='keep-id'and not re.fullmatch(r'[0-9]+:[0-9]+',p['user']):raise ValueError('Podman keep-id requires numeric uid:gid')
 p['entrypoint']=container_path(p['entrypoint'],'Entrypoint');p['workdir']=container_path(p['workdir'],'Working directory');p['state_target']=container_path(p['state_target'],'State volume target')
 if p['state_target']=='/':raise ValueError('State volume cannot replace the container root')
 if not isinstance(p['args'],list)or len(p['args'])>32:raise ValueError('Too many entrypoint arguments')
 for arg in p['args']:literal(arg,'entrypoint argument',2048,True)
 literal(p['model'],'model',200,True)
 if p['model']and not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./:+-]{0,199}',p['model']):raise ValueError('Invalid container model')
 literal(p['base_url'],'provider base URL',300,True)
 if p['base_url']and not re.fullmatch(r'https://[a-zA-Z0-9.-]+(?::[0-9]{1,5})?/[a-zA-Z0-9/_-]*',p['base_url']):raise ValueError('Provider base URL must use HTTPS without credentials or query parameters')
 if not isinstance(p['mounts'],list)or len(p['mounts'])>16 or not isinstance(p['volumes'],list)or len(p['volumes'])>8:raise ValueError('Too many container mounts')
 targets={p['state_target']}
 for mount in p['mounts']:
  if not isinstance(mount,dict)or set(mount)!={'source','target','read_only','selinux'}:raise ValueError('Invalid bind mount fields')
  if mount['source']!='{workspace}':mount['source']=container_path(mount['source'],'Mount source')
  mount['target']=container_path(mount['target'],'Mount target')
  if type(mount['read_only'])is not bool or mount['selinux']not in ('none','private','shared'):raise ValueError('Invalid bind mount access/SELinux mode')
  if mount['target']=='/'or mount['target']in targets:raise ValueError('Overlapping container mount targets')
  targets.add(mount['target'])
 for volume in p['volumes']:
  if not isinstance(volume,dict)or set(volume)!={'name','target','read_only'}:raise ValueError('Invalid named volume fields')
  if not isinstance(volume['name'],str)or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}',volume['name'])or volume['name'].startswith('cc-goose-state-'):raise ValueError('Invalid or reserved volume name')
  volume['target']=container_path(volume['target'],'Volume target')
  if type(volume['read_only'])is not bool or volume['target']=='/'or volume['target']in targets:raise ValueError('Invalid or overlapping volume target')
  targets.add(volume['target'])
 if not isinstance(p['environment'],dict)or len(p['environment'])>32:raise ValueError('Invalid non-secret environment')
 for k,v in p['environment'].items():
  if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,79}',k)or re.search(r'(?:TOKEN|PASSWORD|SECRET|CREDENTIAL|(?:^|_)KEY(?:_|$))',k,re.I):raise ValueError('Sensitive environment names must use machine-local secret references')
  literal(v,'environment value',4096,True)
 for k,v in {'GOOSE_MODE':'approve','GOOSE_TELEMETRY_ENABLED':'false','GOOSE_DISABLE_SESSION_NAMING':'true'}.items():
  if k in p['environment']and p['environment'][k]!=v:raise ValueError('Goose approval/telemetry policy cannot be bypassed')
 if legacy:
  if p['secret_refs']:raise ValueError('Choose secret_file or secret_refs, not both')
  p['secret_refs']=[dict(name='OPENAI_API_KEY',path=p.pop('secret_file'),json_pointer='/enmaas/key')]
 if not isinstance(p['secret_refs'],list)or len(p['secret_refs'])>8:raise ValueError('Too many secret references')
 names=set(p['environment'])
 for ref in p['secret_refs']:
  if not isinstance(ref,dict)or set(ref)!={'name','path','json_pointer'}:raise ValueError('Invalid secret reference')
  if not isinstance(ref['name'],str)or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,79}',ref['name'])or ref['name']in names:raise ValueError('Duplicate or invalid secret environment name')
  if ref['name']in ('GOOSE_MODE','GOOSE_TELEMETRY_ENABLED','GOOSE_DISABLE_SESSION_NAMING','GOOSE_MODEL','GOOSE_PROVIDER','OPENAI_BASE_URL'):raise ValueError('Provider policy/model settings cannot be secret overrides')
  names.add(ref['name']);ref['path']=container_path(ref['path'],'Secret source')
  if not Path(ref['path']).is_relative_to(Path.home()):raise ValueError('Secret sources must remain on the agent host under its home')
  literal(ref['json_pointer'],'JSON pointer',512,True)
  if ref['json_pointer']and not ref['json_pointer'].startswith('/'):raise ValueError('Use a JSON pointer beginning with /')
 for key,lo,hi in [('cpus',.1,64),('memory_mb',64,262144),('pids_limit',16,4096)]:
  value=p[key]
  if value is not None and (type(value)not in (int,float)or not lo<=value<=hi or key!='cpus'and type(value)is not int):raise ValueError('Invalid '+key+' limit')
 return p

def profile_digest(value):return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def registry_path():return Path.home()/'.config/command-center/container-profiles.json'

def read_registry():
 path=registry_path()
 if path.is_symlink():raise ValueError('Invalid container profile registry')
 if not path.exists():return [],'absent'
 data,revision=private_file(path,with_revision=True)
 if not isinstance(data,list)or len(data)>16:raise ValueError('Invalid container profile registry')
 ids=set()
 for raw in data:
  p=normalize_profile(raw)
  if p['id']in ids:raise ValueError('Duplicate container profile ID')
  ids.add(p['id'])
 return data,revision

def raw_profiles():return read_registry()[0]

def profile_settings():
 data,revision=read_registry()
 return dict(revision=revision,profiles=[normalize_profile(p)for p in data])

def legacy_profiles_in_use():
 root=Path.home()/'.cache/command-center/acp';ids=set()
 if not root.exists():return ids
 for path in list(root.iterdir())[:64]:
  if not re.fullmatch(r'[0-9a-f-]{36}',path.name):continue
  try:
   intent=private_file(path/'intent.json',1024*1024);prepared=intent['prepared']
   if prepared.get('provider')!='goose'or prepared.get('container_config'):continue
   live=private_file(path/'live.json');pid=live['pid']
   if not isinstance(pid,int)or pid<1:continue
   statpath=Path('/proc',str(pid),'stat');start=statpath.read_text().rsplit(')',1)[1].split()[19]
   if start==live['start']and os.stat(statpath).st_uid==os.getuid():ids.add(prepared['container_profile'])
  except (OSError,ValueError,KeyError,TypeError):continue
 return ids

def save_profiles(request):
 raw=request.get('profiles')
 if not isinstance(raw,list)or len(raw)>16:raise ValueError('Invalid container profiles')
 try:
  normalized=[normalize_profile(p)for p in raw]
  if len({p['id']for p in normalized})!=len(normalized):raise ValueError('Duplicate profile ID')
 except (ValueError,TypeError,KeyError)as error:
  value=ValueError(str(error));value.status=400;raise value
 root=registry_path().parent;root.mkdir(mode=0o700,parents=True,exist_ok=True);directory(root)
 fd=os.open(root/'profiles.lock',os.O_CREAT|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode)or st.st_uid!=os.getuid()or st.st_mode&0o077 or st.st_nlink!=1:raise ValueError('Unsafe profile lock')
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise ValueError('Container profiles are being edited; reload before saving')
  current=profile_settings()
  if request.get('revision')!=current['revision']:raise ValueError('Container profiles changed; your draft is kept. Reload before saving')
  old={p['id']:p for p in raw_profiles()}
  # Preserve unchanged legacy definitions so existing legacy brokers can verify them.
  stored=[old[p['id']]if p['id']in old and normalize_profile(old[p['id']])==p else p for p in normalized]
  proposed={p['id']:p for p in stored}
  if any(proposed.get(ident)!=old.get(ident)for ident in legacy_profiles_in_use()):raise ValueError('Upgrade the legacy Goose agent before changing or deleting its profile; duplicate the profile for new launches instead')
  data=(json.dumps(stored,indent=2)+'\n').encode()
  if len(data)>MAX_PROFILE:raise ValueError('Container profiles exceed size limit')
  import tempfile
  name=None
  try:
   with tempfile.NamedTemporaryFile(dir=root,prefix='.profiles-',delete=False)as out:name=out.name;os.fchmod(out.fileno(),0o600);out.write(data);out.flush();os.fsync(out.fileno())
   os.replace(name,registry_path());name=None
   parent=os.open(root,os.O_RDONLY|os.O_DIRECTORY)
   try:os.fsync(parent)
   finally:os.close(parent)
  finally:
   if name:os.unlink(name)
  return profile_settings()
 finally:os.close(fd)

def profiles():return raw_profiles()

def summary(raw):
 p=normalize_profile(raw)
 return {k:p[k]for k in ('id','label','image','model','engine')}|dict(provider='goose',mode='approve',workspace_root=str(Path.home()/'.cache/command-center/goose-workspaces'),config=p,notice='Reviewed container configuration. Start requires a resolved review; no image pull or host agent installation.')

def command(executable,args,timeout=12):
 r=subprocess.run([executable,*args],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,env=engine_environment())
 if r.returncode:raise ValueError('Container runtime operation failed; inspect the owned container on the agent host. No automatic retry.')
 if len(r.stdout)>1024*1024:raise ValueError('Container runtime response too large')
 return r.stdout.decode()

def workspace_available(runtime,path,existing=None,prefix=()):
 ids=command(runtime,list(prefix)+['ps','--no-trunc','--filter','label=cc.acp.agent=goose','--format','{{.ID}}']).splitlines()
 if len(ids)>16 or any(not re.fullmatch(r'[0-9a-f]{64}',i)for i in ids):raise ValueError('Container workspace inventory exceeded its limit')
 if not ids:return
 for value in json.loads(command(runtime,list(prefix)+['container','inspect',*ids])):
  if value.get('State',{}).get('Running') and value.get('Id')!=existing and any(m.get('Source')==path for m in value.get('Mounts',[])):raise ValueError('This managed workspace is already used by another Goose container; choose a dedicated directory')

def workspace_lock(path):
 root=Path.home()/'.cache/command-center/goose-workspace-locks';root.mkdir(mode=0o700,parents=True,exist_ok=True);directory(root)
 if root.stat().st_mode&0o077:raise ValueError('Unsafe workspace lock directory')
 file=root/hashlib.sha256(path.encode()).hexdigest();fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
 try:
  st=os.fstat(fd)
  if not stat.S_ISREG(st.st_mode)or st.st_uid!=os.getuid()or st.st_mode&0o077 or st.st_nlink!=1:raise ValueError('Unsafe workspace lock file')
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise ValueError('Workspace is claimed by another container launch; no relabel or retry')
  return fd
 except BaseException:os.close(fd);raise

def engine_environment():
 env=dict(os.environ)
 for key in ('DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','CONTAINER_HOST','CONTAINER_CONNECTION'):env.pop(key,None)
 return env

def runtime_prefix(prepared):
 if prepared.get('container_engine')=='docker':return ['--host',prepared['container_engine_endpoint']]
 return ['--remote=false']if prepared.get('container_config')else []

def runtime_scope(engine,runtime,saved_endpoint=None):
 if engine=='podman':
  prefix=['--remote=false'];info=json.loads(command(runtime,prefix+['info','--format','json']))
  if not info.get('host',{}).get('security',{}).get('rootless'):raise ValueError('Podman profiles require rootless Podman')
  scope=dict(rootless=True,graph_root=info.get('store',{}).get('graphRoot',''),hostname=info.get('host',{}).get('hostname',''))
  return prefix,'local',scope
 endpoint=saved_endpoint or os.environ.get('DOCKER_HOST')
 if not endpoint:
  context=json.loads(command(runtime,['context','inspect']))
  endpoint=context[0].get('Endpoints',{}).get('docker',{}).get('Host','')
 if not isinstance(endpoint,str)or not endpoint.startswith('unix:///')or any(ord(c)<32 for c in endpoint):raise ValueError('Docker requires a local Unix-socket context on this machine')
 prefix=['--host',endpoint];info=json.loads(command(runtime,prefix+['info','--format','{{json .}}']))
 if not isinstance(info.get('ID'),str)or not info['ID']:raise ValueError('Docker daemon identity unavailable')
 scope=dict(id=info['ID'],rootless=any('rootless'in str(v)for v in info.get('SecurityOptions',[])))
 return prefix,endpoint,scope

def resolve_mounts(config,workspace):
 out=[];managed=Path.home()/'.cache/command-center/goose-workspaces'
 for raw in config['mounts']:
  source=workspace if raw['source']=='{workspace}'else raw['source'];p=Path(source)
  if not p.is_absolute()or str(p.resolve())!=str(p):raise ValueError('Bind sources must be canonical paths without symlinks')
  st=p.stat()
  if not(stat.S_ISREG(st.st_mode)or stat.S_ISDIR(st.st_mode))or not os.access(p,os.R_OK|(os.X_OK if p.is_dir()else 0)):raise ValueError('Bind source unavailable to this account')
  if raw['selinux']!='none'and (config['selinux']=='disabled'or p==managed or not p.is_relative_to(managed)):raise ValueError('SELinux relabeling is limited to managed scratch; real projects require no relabel or explicit container label disable')
  out.append(dict(source=str(p),target=raw['target'],read_only=raw['read_only'],selinux=raw['selinux'],identity=[st.st_dev,st.st_ino]))
 return out

def effective_profile(request):
 if request.get('container_retained'):
  p=normalize_profile(request['container_config']);return p,request.get('container_base_hash','retained'),request.get('container_overrides',{})
 raw=next((p for p in profiles()if p['id']==request.get('container_profile')),None)
 if not raw:raise ValueError('Choose an installed reviewed Goose container profile')
 overrides=request.get('container_overrides')
 if overrides is None:overrides={}
 if not isinstance(overrides,dict)or set(overrides)-(PROFILE_FIELDS-{'id','label','secret_file'}):raise ValueError('Unsupported launch override fields')
 # Merge normalized fields so replacing legacy secret refs does not retain secret_file.
 p=normalize_profile(raw);p.update(overrides);p=normalize_profile(p)
 return p,profile_digest(raw),overrides

def options(request):
 p,base_hash,overrides=effective_profile(request)
 path=request.get('path');root=Path.home()/'.cache/command-center/goose-workspaces'
 if not isinstance(path,str)or len(path)>4096 or not path.startswith(('/','~/'))or any(ord(c)<32 for c in path):raise ValueError('Use an absolute workspace directory')
 path=Path(os.path.expanduser(path));canonical=path.resolve()
 if path!=canonical:raise ValueError('Workspace must be a canonical directory without symlinks')
 if p['workspace_policy']=='managed'and(canonical==root or not canonical.is_relative_to(root)):raise ValueError('This profile requires a dedicated managed scratch directory under '+str(root))
 di=directory(canonical)
 runtime=shutil.which(p['engine'])
 if not runtime:raise ValueError(p['engine'].title()+' is unavailable; no engine or host-agent fallback')
 runtime=os.path.realpath(runtime);st=os.stat(runtime);prefix,endpoint,scope=runtime_scope(p['engine'],runtime,request.get('container_engine_endpoint')if request.get('container_retained')else None)
 image=json.loads(command(runtime,prefix+['image','inspect',request['container_image_id']if request.get('container_retained')else p['image']]))[0]
 if not re.fullmatch(r'(?:sha256:)?[0-9a-f]{64}',image.get('Id','')):raise ValueError('Cached image identity unavailable; CC never pulls implicitly')
 mounts=resolve_mounts(p,str(canonical))
 for mount in mounts:
  if mount['selinux']!='none':workspace_available(runtime,mount['source'],request.get('_existing_container'),prefix)
 for ref in p['secret_refs']:
  source=Path(ref['path']);ss=source.lstat()
  if not stat.S_ISREG(ss.st_mode)or ss.st_uid!=os.getuid()or ss.st_mode&0o077 or ss.st_nlink!=1 or str(source.resolve())!=str(source):raise ValueError('Secret sources must be private owned files without symlinks')
 prepared=dict(path=str(canonical),directory_identity=di,executable=runtime,executable_identity=[st.st_dev,st.st_ino,st.st_mtime_ns,st.st_size],protocol='acp',provider='goose',container_profile=p['id'],container_profile_hash=profile_digest(p),container_base_hash=base_hash,container_overrides=overrides,container_retained=bool(request.get('container_retained')),container_config=p,container_mounts=mounts,container_engine=p['engine'],container_engine_endpoint=endpoint,container_engine_scope=scope,container_image_id=image['Id'],container_image=p['image'],model=p['model'],mode='approve')
 prepared['container_review']=resolved_review(prepared);return prepared

def resume_options(prepared,existing):
 config=prepared.get('container_config')
 if config is None:
  raw=next((p for p in profiles()if p['id']==prepared['container_profile']),None)
  if raw is None:raise ValueError('Legacy broker profile unavailable; no guessed restart configuration')
  legacy_hash=hashlib.sha256(json.dumps(raw,sort_keys=True).encode()).hexdigest()
  if legacy_hash!=prepared.get('container_profile_hash'):raise ValueError('Legacy broker profile changed; upgrade it before editing its profile')
  config=normalize_profile(raw)
 request=dict(prepared,container_config=config,container_retained=True,_existing_container=existing)
 value=options(request)
 if value['directory_identity']!=prepared['directory_identity']or prepared.get('container_mounts',value['container_mounts'])!=value['container_mounts']:raise ValueError('Saved workspace or bind source identity changed; no restart attempted')
 if prepared.get('container_engine_scope',value['container_engine_scope'])!=value['container_engine_scope']:raise ValueError('Saved engine context changed; no restart attempted')
 if value['container_image_id']!=prepared['container_image_id']:raise ValueError('Saved image changed; no restart attempted')
 return value

def resolved_review(prepared):
 p=prepared['container_config'];env=environment(p)
 return dict(engine=p['engine'],image=p['image'],image_id=prepared['container_image_id'],entrypoint=p['entrypoint'],args=p['args'],workdir=p['workdir'],workspace_policy=p['workspace_policy'],selinux=p['selinux'],mounts=[{k:m[k]for k in ('source','target','read_only','selinux')}for m in prepared['container_mounts']],volumes=p['volumes'],state_target=p['state_target'],user=p['user'],user_namespace=p['user_namespace'],network=p['network'],cpus=p['cpus'],memory_mb=p['memory_mb'],pids_limit=p['pids_limit'],environment=env,secret_refs=p['secret_refs'],engine_scope=prepared['container_engine_scope'])

def environment(p):
 env=dict(GOOSE_MODE='approve',GOOSE_TELEMETRY_ENABLED='false',GOOSE_DISABLE_SESSION_NAMING='true')
 if p['model']:env['GOOSE_MODEL']=p['model']
 if p['base_url']:env.update(GOOSE_PROVIDER='openai',OPENAI_BASE_URL=p['base_url'])
 env.update(p['environment']);return env

def state_id(intent):
 import uuid
 ident=intent.get('container_state',intent['id'])
 if str(uuid.UUID(ident))!=ident:raise ValueError('Invalid container state identity')
 return ident

def inspect(runtime,ident,prefix=()):
 if not re.fullmatch(r'[0-9a-f]{64}',ident):raise ValueError('Invalid immutable container ID')
 result=subprocess.run([runtime,*prefix,'container','inspect',ident],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8,env=engine_environment())
 if result.returncode:
  if result.returncode==125 and (b'no such container'in result.stderr.lower()or b'no such object'in result.stderr.lower()):return None
  if (b'no such container'in result.stderr.lower()or b'no such object'in result.stderr.lower()):return None
  raise ValueError('Cannot verify owned container')
 if len(result.stdout)>1024*1024:raise ValueError('Container inspect response too large')
 return json.loads(result.stdout)[0]

def verify(prepared,record):
 if prepared.get('container_engine_scope')is not None:
  _,endpoint,scope=runtime_scope(prepared['container_engine'],prepared['executable'],prepared.get('container_engine_endpoint'))
  if endpoint!=prepared['container_engine_endpoint']or scope!=prepared['container_engine_scope']:raise ValueError('Container engine identity changed; no lifecycle action attempted')
 value=inspect(prepared['executable'],record['id'],runtime_prefix(prepared))
 if value is None:return None
 labels=value.get('Config',{}).get('Labels',{})
 if value.get('Id')!=record['id']or value.get('Name','').lstrip('/')!=record['name'] or any(labels.get(k)!=v for k,v in record['labels'].items()) or value.get('Image')!=prepared['container_image_id']:raise ValueError('Container identity or labels changed; no stop/restart attempted')
 return value

def start(prepared,intent,broker_root,instance):
 locks=[]
 try:
  for path in sorted({m['source']for m in prepared.get('container_mounts',[])if m['selinux']=='private'}):locks.append((path,workspace_lock(path)))
  result=start_locked(prepared,intent,broker_root,instance);WORKSPACE_LOCKS.update(dict(locks));return result
 except BaseException:
  for _,fd in locks:os.close(fd)
  raise

def secret_payload(p):
 lines=[];names=[]
 for ref in p['secret_refs']:
  try:
   value=private_file(ref['path'],1024*1024)
   for part in ref['json_pointer'].split('/')[1:]if ref['json_pointer']else[]:
    part=part.replace('~1','/').replace('~0','~');value=value[int(part)]if isinstance(value,list)else value[part]
   if not isinstance(value,str)or not value or len(value)>2048 or any(ord(c)<33 or ord(c)>126 for c in value):raise ValueError()
  except (ValueError,KeyError,TypeError,IndexError):raise ValueError('A machine-local secret reference is unavailable or unsupported')from None
  lines.append(value+'\n');names.append(ref['name'])
 data=''.join(lines).encode()
 if len(data)>4096:raise ValueError('Combined secret bootstrap exceeds 4096 bytes')
 return data,names

def run_arguments(prepared,intent,instance):
 p=prepared['container_config'];ident=intent['id'];persistent=state_id(intent);name='cc-goose-'+ident;volume='cc-goose-state-'+persistent
 labels={'cc.acp.agent':'goose','cc.acp.broker':ident,'cc.acp.instance':instance,'cc.acp.profile':p['id'],'cc.acp.state':persistent,'cc.acp.image-digest':prepared['container_image_id'],'cc.acp.engine':p['engine']}
 args=[prepared['executable'],*runtime_prefix(prepared),'run','-i','--rm','--init','--pull=never','--name',name,'--stop-timeout','10']
 if p['user_namespace']=='keep-id':
  uid,gid=p['user'].split(':');args+=['--userns=keep-id:uid='+uid+',gid='+gid]
 if p['user']:args+=['--user',p['user']]
 if p['selinux']=='disabled':args+=['--security-opt','label=disable']
 if p['network']!='default':args+=['--network',p['network']]
 for key,flag in [('cpus','--cpus'),('memory_mb','--memory'),('pids_limit','--pids-limit')]:
  if p[key]is not None:args += [flag,str(p[key])+('m'if key=='memory_mb'else'')]
 for k,v in labels.items():args+=['--label',k+'='+v]
 for k,v in environment(p).items():args+=['-e',k+'='+v]
 for m in prepared['container_mounts']:
  if m['selinux']!='none':args+=['-v',m['source']+':'+m['target']+(':ro'if m['read_only']else':rw')+(',Z'if m['selinux']=='private'else',z')]
  else:args+=['--mount','type=bind,source='+m['source']+',target='+m['target']+(',readonly'if m['read_only']else'')]
 args+=['--mount','type=volume,source='+volume+',target='+p['state_target']]
 for v in p['volumes']:args+=['--mount','type=volume,source='+v['name']+',target='+v['target']+(',readonly'if v['read_only']else'')]
 args+=['-w',p['workdir']]
 # Credential names are validated identifiers; values travel only over stdin.
 names=[ref['name']for ref in p['secret_refs']]
 if names:
  bootstrap='; '.join('IFS= read -r '+n+' || exit 70; export '+n for n in names)+'; exec "$@"'
  args+=['--entrypoint','/bin/sh',prepared['container_image_id'],'-c',bootstrap,'cc-container',p['entrypoint'],*p['args']]
 else:args+=['--entrypoint',p['entrypoint'],prepared['container_image_id'],*p['args']]
 record=dict(name=name,labels=labels,volume=volume,workspace=prepared['path'],profile=p['id'],image=p['image'],engine=p['engine'],config=p)
 return args,record

def start_locked(prepared,intent,broker_root,instance):
 if options(prepared)!=prepared:raise ValueError('Container configuration, engine, image or bind source changed; prepare again')
 p,base_hash,_=effective_profile(prepared)
 if profile_digest(p)!=prepared['container_profile_hash']or base_hash!=prepared['container_base_hash']:raise ValueError('Container configuration changed immediately before launch')
 payload,_=secret_payload(p);args,record=run_arguments(prepared,intent,instance);process=None
 try:
  process=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,env=engine_environment())
  if payload:process.stdin.write(payload);process.stdin.flush()
 except BaseException:
  if process is not None:
   try:process.stdin.close()
   except OSError:pass
   try:process.wait(timeout=12)
   except subprocess.TimeoutExpired:pass
  raise ValueError('Container credential bootstrap failed; inspect this broker before another launch')from None
 finally:payload=None
 try:
  end=time.monotonic()+15
  while time.monotonic()<end:
   r=subprocess.run([prepared['executable'],*runtime_prefix(prepared),'container','inspect',record['name']],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=3,env=engine_environment())
   if not r.returncode:
    value=json.loads(r.stdout)[0];record['id']=value['Id']
    if verify(prepared,record)is None:raise ValueError('Container disappeared during launch')
    fd=os.open(os.path.join(broker_root,'container.json'),os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'w')as out:json.dump(record,out);out.flush();os.fsync(out.fileno())
    return process,record
   if process.poll()is not None:break
   time.sleep(.1)
  raise ValueError('Container startup could not be verified; inspect the recorded broker, never retry automatically')
 except BaseException:
  if process.poll()is None:process.stdin.close()
  try:process.wait(timeout=12)
  except subprocess.TimeoutExpired:pass
  raise

def stop(prepared,record):
 if verify(prepared,record)is not None:command(prepared['executable'],runtime_prefix(prepared)+['stop','--time','10',record['id']],timeout=18)
 # --rm is part of the reviewed invocation; confirm removal, never remove by name.
 end=time.monotonic()+3
 while time.monotonic()<end:
  if inspect(prepared['executable'],record['id'],runtime_prefix(prepared))is None:
   paths={m['source']for m in prepared.get('container_mounts',[])if m['selinux']=='private'}or{prepared['path']}
   for path in paths:
    fd=WORKSPACE_LOCKS.pop(path,None)
    if fd is not None:os.close(fd)
   return
  time.sleep(.1)
 raise ValueError('Owned container removal not verified; inspect before retrying')
