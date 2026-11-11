"""CC-managed export downloads only. No remote writes, arbitrary URLs or overwrites."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import urllib.request
import uuid
from cc_read import ReadError
MAX_ARTIFACT=8*1024*1024
FORMATS={'png':('image/png','png'),'svg':('image/svg+xml','svg'),'json':('application/json','json'),'text':('text/plain; charset=utf-8','txt')}

def private_root(path):
    path=Path(os.path.abspath(path))
    flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW
    current=os.open('/',flags)
    try:
        for part in path.parts[1:]:
            try:next_fd=os.open(part,flags,dir_fd=current)
            except FileNotFoundError:os.mkdir(part,0o700,dir_fd=current);next_fd=os.open(part,flags,dir_fd=current)
            os.close(current);current=next_fd
        info=os.fstat(current)
        if info.st_uid!=os.getuid()or info.st_mode&0o077:raise ReadError('Output directory must be owned by you with permissions 0700; existing permissions were not changed')
        return path,current
    except BaseException:os.close(current);raise

def read_file(directory,name,limit):
    fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW,dir_fd=directory)
    with os.fdopen(fd,'rb')as stream:
        info=os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode)or info.st_uid!=os.getuid()or info.st_nlink!=1 or info.st_mode&0o077:raise ReadError('Existing export file is not a private owned regular file')
        value=stream.read(limit+1)
        if len(value)>limit:raise ReadError('Existing export file exceeds its limit')
        return value

def write_file(directory,name,value):
    fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory)
    with os.fdopen(fd,'wb')as stream:stream.write(value);stream.flush();os.fsync(stream.fileno())

def download(client,export_id,directory,formats):
    uuid.UUID(export_id);manifest=client.get('whiteboard-exports/'+export_id)
    if manifest.get('id')!=export_id or manifest.get('state')!='ready':raise ReadError('Export is not ready: '+str(manifest.get('state'))+'. No rendering or delivery was retried')
    board=manifest['board'];uuid.UUID(board);paths={}
    for format in formats:
        mime,extension=FORMATS[format];record=manifest['artifacts'][format]
        expected=f'/api/v1/whiteboard-exports/{export_id}/{format}'
        if record['url']!=expected or record['content_type']!=mime or not isinstance(record['bytes'],int)or not 0<record['bytes']<=MAX_ARTIFACT:raise ReadError('Unexpected artifact metadata')
        filename=f'whiteboard-{board}.{extension}'
        try:value=read_file(directory,filename,MAX_ARTIFACT)
        except FileNotFoundError:
            request=urllib.request.Request(client.url+expected,headers={'Accept':mime})
            with client.opener.open(request,timeout=30)as response:
                if response.headers.get('Content-Type')!=mime:raise ReadError('Artifact content type changed')
                value=response.read(MAX_ARTIFACT+1)
            if len(value)!=record['bytes']or hashlib.sha256(value).hexdigest()!=record['sha256']:raise ReadError('Artifact checksum/size mismatch; nothing was written')
            if format=='png'and not value.startswith(b'\x89PNG\r\n\x1a\n'):raise ReadError('Artifact is not a PNG')
            write_file(directory,filename,value)
        if len(value)!=record['bytes']or hashlib.sha256(value).hexdigest()!=record['sha256']:raise ReadError('Existing file differs; it was not overwritten')
        paths[format]=filename
    serialized=json.dumps(manifest,ensure_ascii=False,indent=2).encode()
    try:old=read_file(directory,'manifest.json',128*1024)
    except FileNotFoundError:write_file(directory,'manifest.json',serialized)
    else:
        if json.loads(old)!=manifest:raise ReadError('Existing manifest differs; it was not overwritten')
    os.fsync(directory)
    return manifest,paths

def run_export(client,args):
    export_id=args.export_id or str(uuid.uuid4());uuid.UUID(export_id)
    if not args.output_dir:raise ReadError('Supply --output-dir for private export files')
    root,root_fd=private_root(args.output_dir)
    try:
        if args.command=='export':
            try:os.mkdir(export_id,0o700,dir_fd=root_fd)
            except FileExistsError:raise ReadError('Export directory exists; use download --export-id to inspect/download the saved export. Nothing was rendered again')from None
        else:
            try:os.mkdir(export_id,0o700,dir_fd=root_fd)
            except FileExistsError:pass
        directory=os.open(export_id,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=root_fd)
    finally:os.close(root_fd)
    try:
        info=os.fstat(directory)
        if info.st_uid!=os.getuid()or info.st_mode&0o077:raise ReadError('Export directory must be private and owned by you')
        if args.command=='export':
            scene=client.get('whiteboards/'+args.board)
            scope={'kind':args.scope}
            if args.scope=='selection':
                if not args.elements:raise ReadError('Selection scope needs --elements UUID...')
                for element in args.elements:uuid.UUID(element)
                scope['elements']=args.elements
            elif args.scope in ('frame','group'):
                if not args.region:raise ReadError('Frame/group scope needs --region UUID')
                uuid.UUID(args.region);regions=client.get('whiteboards/'+args.board+'/regions')['regions'];region=next((r for r in regions if r['id']==args.region and r['kind']==args.scope),None)
                if not region:raise ReadError('Named frame/group not found')
                scope.update(id=region['id'],revision=args.region_revision or region['revision'])
            elif args.elements or args.region:raise ReadError('Elements/region do not belong to whole-board scope')
            body={'id':export_id,'revision':args.revision if args.revision is not None else scene['revision'],'scope':scope,'scale':args.scale,'theme':args.theme}
            write_file(directory,'intent.json',json.dumps({'board':args.board,'request':body},indent=2).encode());os.fsync(directory)
            print('Export UUID for recovery: '+export_id,file=sys.stderr)
            result=client.write('POST','whiteboards/'+args.board+'/export',body)
            if result.get('id')!=export_id or result.get('state')!='ready':raise ReadError('Export did not complete: '+str(result.get('state'))+'. Check the retained UUID; no automatic retry')
        manifest,files=download(client,export_id,directory,list(FORMATS)if args.format=='all'else[args.format])
        return {'export':manifest,'directory':str(root/export_id),'files':{key:str(root/export_id/name)for key,name in files.items()}}
    finally:os.close(directory)
