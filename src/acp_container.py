"""Fixed-policy Goose/Podman boundary. Runs only on the configured agent host.
No Goose executable is resolved on the host. Secrets never leave this module.
"""
import hashlib,json,os,re,shutil,stat,subprocess,time,fcntl
from pathlib import Path
IMAGE='ghcr.io/aaif-goose/goose@sha256:d1f8264826e35ad064cb3f97eb6fb6498fe3b424ac8d0f61ee4eef030ef10860'
MAX_PROFILE=65536
WORKSPACE_LOCKS={}

def private_file(path,limit=MAX_PROFILE):
 p=Path(path);s=p.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077 or s.st_nlink!=1 or str(p.resolve())!=str(p):raise ValueError('Container configuration must be a private owned regular file without symlinks')
 with p.open('rb')as f:data=f.read(limit+1)
 if len(data)>limit:raise ValueError('Container configuration exceeds size limit')
 return json.loads(data)

def directory(path):
 p=Path(path);s=p.lstat()
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o022 or str(p.resolve())!=str(p):raise ValueError('Container workspace must be owned, non-writable by others and free of symlinks')
 return [s.st_dev,s.st_ino]

def profiles():
 path=Path.home()/'.config/command-center/container-profiles.json'
 if not path.exists():return []
 data=private_file(path)
 if not isinstance(data,list) or len(data)>16:raise ValueError('Invalid container profile registry')
 ids=set();out=[]
 for p in data:
  if not isinstance(p,dict) or set(p)!={'id','label','image','model','base_url','secret_file'}:raise ValueError('Unsupported container profile fields')
  if not re.fullmatch(r'[a-z][a-z0-9-]{0,47}',p['id']) or p['id'] in ids:raise ValueError('Invalid or duplicate container profile ID')
  ids.add(p['id'])
  if p['image']!=IMAGE:raise ValueError('Container image must use the reviewed Goose digest')
  if not isinstance(p['label'],str) or not p['label'] or len(p['label'])>80 or any(ord(c)<32 for c in p['label']):raise ValueError('Invalid container profile label')
  if not isinstance(p['model'],str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_./:+-]{0,199}',p['model']):raise ValueError('Invalid container profile model')
  if not isinstance(p['base_url'],str) or not re.fullmatch(r'https://[a-zA-Z0-9.-]+(?::[0-9]{1,5})?/[a-zA-Z0-9/_-]*',p['base_url']):raise ValueError('Container provider requires a reviewed HTTPS base URL')
  secret=Path(p['secret_file'])
  if not secret.is_absolute() or not secret.is_relative_to(Path.home()) or str(secret.resolve())!=str(secret):raise ValueError('Secret reference must remain on the agent host under its home')
  out.append(p)
 return out

def summary(p):
 return {k:p[k] for k in ('id','label','image','model')}|{'provider':'goose','mode':'approve','workspace_root':str(Path.home()/'.cache/command-center/goose-workspaces'),'notice':'Container-only; managed scratch directory, no project relabel or automatic file sync. Persistent per-agent state volume.'}

def command(executable,args,timeout=12):
 r=subprocess.run([executable,*args],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout)
 if r.returncode:raise ValueError('Container runtime operation failed; inspect the owned container on the agent host. No automatic retry.')
 if len(r.stdout)>1024*1024:raise ValueError('Container runtime response too large')
 return r.stdout.decode()

def workspace_available(runtime,path,existing=None):
 ids=command(runtime,['ps','--no-trunc','--filter','label=cc.acp.agent=goose','--format','{{.ID}}']).splitlines()
 if len(ids)>16 or any(not re.fullmatch(r'[0-9a-f]{64}',i)for i in ids):raise ValueError('Container workspace inventory exceeded its limit')
 if not ids:return
 for value in json.loads(command(runtime,['container','inspect',*ids])):
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

def options(request):
 ident=request.get('container_profile')
 p=next((p for p in profiles() if p['id']==ident),None)
 if not p:raise ValueError('Choose an installed reviewed Goose container profile')
 path=request.get('path');root=Path.home()/'.cache/command-center/goose-workspaces'
 if not isinstance(path,str) or len(path)>4096 or not path.startswith(('/','~/')) or any(ord(c)<32 for c in path):raise ValueError('Use a managed scratch workspace directory')
 path=Path(os.path.expanduser(path));canonical=path.resolve()
 if path!=canonical or canonical==root or not canonical.is_relative_to(root):raise ValueError('Goose v1 requires a dedicated directory under '+str(root)+'; real projects are never relabeled')
 directory(root);di=directory(canonical)
 runtime=shutil.which('podman')
 if not runtime:raise ValueError('Podman is unavailable; no host Goose fallback')
 runtime=os.path.realpath(runtime);st=os.stat(runtime)
 info=json.loads(command(runtime,['info','--format','json']))
 if not info.get('host',{}).get('security',{}).get('rootless'):raise ValueError('Container profiles require rootless Podman')
 image=json.loads(command(runtime,['image','inspect',IMAGE]))[0]
 if not re.fullmatch(r'(?:sha256:)?[0-9a-f]{64}',image.get('Id','')):raise ValueError('Pinned container image identity unavailable')
 workspace_available(runtime,str(canonical),request.get('_existing_container'))
 secret=Path(p['secret_file']);ss=secret.lstat()
 if not stat.S_ISREG(ss.st_mode)or ss.st_uid!=os.getuid()or ss.st_mode&0o077 or ss.st_nlink!=1:raise ValueError('Container secret source must be private and owned')
 return dict(path=str(canonical),directory_identity=di,executable=runtime,executable_identity=[st.st_dev,st.st_ino,st.st_mtime_ns,st.st_size],protocol='acp',provider='goose',container_profile=p['id'],container_profile_hash=hashlib.sha256(json.dumps(p,sort_keys=True).encode()).hexdigest(),container_image_id=image['Id'],container_image=IMAGE,model=p['model'],mode='approve')

def state_id(intent):
 import uuid
 ident=intent.get('container_state',intent['id'])
 if str(uuid.UUID(ident))!=ident:raise ValueError('Invalid container state identity')
 return ident

def inspect(runtime,ident):
 if not re.fullmatch(r'[0-9a-f]{64}',ident):raise ValueError('Invalid immutable container ID')
 result=subprocess.run([runtime,'container','inspect',ident],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=8)
 if result.returncode:
  if result.returncode==125 and b'no such container'in result.stderr.lower():return None
  if b'no such container'in result.stderr.lower():return None
  raise ValueError('Cannot verify owned container')
 if len(result.stdout)>1024*1024:raise ValueError('Container inspect response too large')
 return json.loads(result.stdout)[0]

def verify(prepared,record):
 value=inspect(prepared['executable'],record['id'])
 if value is None:return None
 labels=value.get('Config',{}).get('Labels',{})
 if value.get('Id')!=record['id']or value.get('Name','').lstrip('/')!=record['name'] or any(labels.get(k)!=v for k,v in record['labels'].items()) or value.get('Image')!=prepared['container_image_id']:raise ValueError('Container identity or labels changed; no stop/restart attempted')
 return value

def start(prepared,intent,broker_root,instance):
 fd=workspace_lock(prepared['path'])
 try:
  result=start_locked(prepared,intent,broker_root,instance);WORKSPACE_LOCKS[prepared['path']]=fd;return result
 except BaseException:os.close(fd);raise

def start_locked(prepared,intent,broker_root,instance):
 if options(prepared)!=prepared:raise ValueError('Container profile, runtime, image or workspace changed; prepare again')
 profile=next(p for p in profiles() if p['id']==prepared['container_profile'])
 if hashlib.sha256(json.dumps(profile,sort_keys=True).encode()).hexdigest()!=prepared['container_profile_hash']:raise ValueError('Container profile changed immediately before launch')
 ident=intent['id'];persistent=state_id(intent);name='cc-goose-'+ident
 labels={'cc.acp.agent':'goose','cc.acp.broker':ident,'cc.acp.instance':instance,'cc.acp.profile':prepared['container_profile'],'cc.acp.state':persistent,'cc.acp.image-digest':IMAGE.split('@')[1]}
 volume='cc-goose-state-'+persistent
 # Never source a shell, write a key file, or put the key in argv or CC state.
 auth=private_file(profile['secret_file'],1024*1024);key=auth.get('enmaas',{}).get('key')
 if not isinstance(key,str)or not key or len(key)>2048 or any(ord(c)<33 or ord(c)>126 for c in key):raise ValueError('ENMAAS credential unavailable in the host secret source')
 process=None
 try:
  args=[prepared['executable'],'run','-i','--rm','--init','--pull=never','--userns=keep-id:uid=1000,gid=1000','--name',name,'--stop-timeout','10']
  for k,v in labels.items():args+=['--label',k+'='+v]
  for value in ('GOOSE_PROVIDER=openai','GOOSE_MODEL='+profile['model'],'OPENAI_BASE_URL='+profile['base_url'],'GOOSE_MODE=approve','GOOSE_TELEMETRY_ENABLED=false','GOOSE_DISABLE_SESSION_NAMING=true'):args+=['-e',value]
  # Podman persists --env/--env-file values in its OCI metadata. Consume one
  # credential line inside the container instead, before handing stdio to ACP.
  bootstrap='IFS= read -r OPENAI_API_KEY || exit 70; export OPENAI_API_KEY; exec /usr/local/bin/goose acp'
  args+=['-v',prepared['path']+':/workspace:Z','-v',volume+':/home/goose','-w','/workspace','--entrypoint','/bin/sh',IMAGE,'-c',bootstrap]
  process=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
  process.stdin.write((key+'\n').encode());process.stdin.flush()
 except BaseException:
  if process is not None:
   try:process.stdin.close()
   except OSError:pass
   try:process.wait(timeout=12)
   except subprocess.TimeoutExpired:pass
  raise ValueError('Container credential bootstrap failed; inspect this broker before another launch')
 finally:
  key=None;auth=None

 try:
  end=time.monotonic()+15
  while time.monotonic()<end:
   r=subprocess.run([prepared['executable'],'container','inspect',name],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=3)
   if not r.returncode:
    value=json.loads(r.stdout)[0];record=dict(id=value['Id'],name=name,labels=labels,volume=volume,workspace=prepared['path'],profile=prepared['container_profile'],image=IMAGE)
    if verify(prepared,record) is None:raise ValueError('Container disappeared during launch')
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
 if verify(prepared,record)is not None:command(prepared['executable'],['stop','--time','10',record['id']],timeout=18)
 # --rm is part of the reviewed invocation; confirm removal, never remove by name.
 end=time.monotonic()+3
 while time.monotonic()<end:
  if inspect(prepared['executable'],record['id'])is None:
   fd=WORKSPACE_LOCKS.pop(prepared['path'],None)
   if fd is not None:os.close(fd)
   return
  time.sleep(.1)
 raise ValueError('Owned container removal not verified; inspect before retrying')
