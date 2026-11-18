"""Read one regular file, streaming bytes after a bounded JSON metadata line."""
import hashlib,json,os,stat,sys
MAX_SIZE=8*1024*1024*1024
CHUNK=64*1024
started=False
class Failure(Exception):
 def __init__(self,status,message):self.status,self.message=status,message

def fingerprint(s):return hashlib.sha256(repr((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode)).encode()).hexdigest()
def run(request):
 global started
 path=request.get('path')
 if not isinstance(path,str)or not path or len(path.encode())>4096 or '\0'in path:raise Failure(400,'Invalid download path')
 path=os.path.expanduser(path)
 if not os.path.isabs(path):raise Failure(400,'Use an absolute path or ~/path')
 path=os.path.realpath(path,strict=True)
 fd=os.open(path,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
 try:
  before=os.fstat(fd)
  if not stat.S_ISREG(before.st_mode):raise Failure(415,'Only regular files can be downloaded')
 except Exception:
  os.close(fd);raise
 with os.fdopen(fd,'rb')as source:
  if before.st_size>MAX_SIZE:raise Failure(413,'Download exceeds the 8 GiB limit')
  version=fingerprint(before)
  if request.get('version')is not None and request['version']!=version:raise Failure(409,'File changed; download it again from its current location')
  header=dict(path=path,name=os.path.basename(path),size=before.st_size,version=version)
  sys.stdout.buffer.write((json.dumps(dict(ok=header),ensure_ascii=True)+'\n').encode());sys.stdout.buffer.flush();started=True
  remaining=before.st_size
  # Retain the last chunk until end checks pass, so changes truncate the HTTP
  # download instead of completing an apparently successful mixed file.
  while remaining>CHUNK:
   data=source.read(min(CHUNK,remaining-CHUNK))
   if not data:raise Failure(409,'File became shorter during download')
   sys.stdout.buffer.write(data);remaining-=len(data)
  final=source.read(remaining)
  if len(final)!=remaining or fingerprint(os.fstat(source.fileno()))!=version or fingerprint(os.stat(path))!=version:raise Failure(409,'File changed during download')
  sys.stdout.buffer.write(final);sys.stdout.buffer.flush()
if __name__=='__main__':
 try:
  raw=sys.stdin.buffer.readline(32769)
  if len(raw)>32768:raise Failure(413,'Download request too large')
  run(json.loads(raw))
 except BrokenPipeError:sys.exit(1)
 except Exception as e:
  status=e.status if isinstance(e,Failure)else 404 if isinstance(e,FileNotFoundError)else 403 if isinstance(e,PermissionError)else 400
  message=e.message if isinstance(e,Failure)else 'File is unavailable for download'
  if not started:sys.stdout.write(json.dumps(dict(status=status,error=message))+'\n');sys.stdout.flush()
  sys.exit(1)
