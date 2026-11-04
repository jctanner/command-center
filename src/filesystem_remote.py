"""One-request SSH helper. No installation, daemon, shell input, or logging."""
import hashlib
import json
import os
import stat
import sys
import tempfile

LIMIT = 1024 * 1024

class Failure(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message

def fail(status, message):
    raise Failure(status, message)

def resolve(value):
    if not isinstance(value, str) or not value or '\0' in value or len(value.encode('utf-8')) > 4096:
        fail(400, 'Invalid path')
    if value == '~' or value.startswith('~/'):
        value = os.path.expanduser(value)
    if not os.path.isabs(value):
        fail(400, 'Use an absolute path or ~/path')
    path = os.path.realpath(value, strict=True)
    path.encode('utf-8')
    return path

def readonly(info):
    if info.st_nlink > 1:
        return 'Hard-linked files are read-only in this editor'
    if info.st_uid != os.geteuid():
        return 'Saving would change file ownership'
    if not info.st_mode & 0o222:
        return 'File is read-only'
    return None

def read(path):
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as source:
        before = os.fstat(source.fileno())
        if not stat.S_ISREG(before.st_mode):
            fail(415, 'Only regular UTF-8 text files can be edited')
        data = source.read(LIMIT + 1)
        info = os.fstat(source.fileno())
    if len(data) > LIMIT:
        fail(413, 'File exceeds the 1 MiB editor limit')
    if (before.st_mtime_ns, before.st_size) != (info.st_mtime_ns, info.st_size) or len(data) != info.st_size:
        fail(409, 'File changed while being read; retry')
    if b'\0' in data:
        fail(415, 'Binary files cannot be edited')
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError:
        fail(415, 'File is not UTF-8 text')
    csec, cnsec = divmod(info.st_ctime_ns, 1000000000)
    version = f'{info.st_dev}:{info.st_ino}:{info.st_mode}:{info.st_nlink}:{csec}:{cnsec}:{hashlib.sha256(data).hexdigest()}'
    return {'path': path, 'text': text, 'version': version, 'read_only': readonly(info)}, info

def execute(request):
    path = resolve(request['path'])
    operation = request['op']
    if operation == 'list':
        if not os.path.isdir(path):
            fail(400, 'Path is not a directory')
        entries, skipped, truncated = [], 0, False
        with os.scandir(path) as items:
            for item in items:
                if not request.get('hidden') and item.name.startswith('.'):
                    continue
                try:
                    item.name.encode('utf-8')
                except UnicodeEncodeError:
                    skipped += 1
                    continue
                if len(entries) >= 2000:
                    truncated = True
                    break
                try:
                    info = item.stat()
                    kind = 'directory' if stat.S_ISDIR(info.st_mode) else 'file' if stat.S_ISREG(info.st_mode) else 'other'
                    entries.append({'name': item.name, 'path': os.path.join(path, item.name), 'kind': kind, 'symlink': item.is_symlink(), 'size': info.st_size})
                except OSError:
                    entries.append({'name': item.name, 'path': os.path.join(path, item.name), 'kind': 'unavailable', 'symlink': item.is_symlink(), 'size': 0})
        entries.sort(key=lambda e: (e['kind'] != 'directory', e['name']))
        return {'path': path, 'entries': entries, 'truncated': truncated, 'unsupported_names': skipped}
    current, info = read(path)
    if operation == 'read':
        if request.get('known_version') == current['version']:
            return {'path': path, 'version': current['version'], 'unchanged': True}
        return current
    if operation != 'write':
        fail(400, 'Unknown file operation')
    if path != request['path']:
        fail(409, 'File location changed; reopen it before saving')
    if current['version'] != request['version']:
        fail(409, 'File changed on disk. Your edits have been kept')
    if current['read_only']:
        fail(403, current['read_only'])
    data = request['text'].encode('utf-8')
    if len(data) > LIMIT:
        fail(413, 'File exceeds the 1 MiB editor limit')
    if b'\0' in data:
        fail(415, 'Binary content cannot be saved')
    # Respect file permissions as well as the parent directory permissions.
    os.close(os.open(path, os.O_RDWR | os.O_NONBLOCK | os.O_NOFOLLOW))
    fd, temporary = tempfile.mkstemp(prefix='.command-center-', dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            if os.fstat(output.fileno()).st_gid != info.st_gid:
                os.fchown(output.fileno(), -1, info.st_gid)
            os.fchmod(output.fileno(), stat.S_IMODE(info.st_mode))
            if hasattr(os, 'listxattr'):
                for name in os.listxattr(path):
                    value = os.getxattr(path, name)
                    try:
                        existing = os.getxattr(temporary, name)
                    except OSError:
                        existing = None
                    if existing != value:
                        os.setxattr(temporary, name, value)
            output.flush()
            os.fsync(output.fileno())
        latest, _ = read(path)
        if latest['version'] != current['version'] or os.path.realpath(request['path']) != path:
            fail(409, 'File changed during save. Your edits have been kept')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return read(path)[0]

try:
    request = json.loads(sys.stdin.buffer.read(8 * LIMIT + 1))
    response = {'ok': execute(request)}
except Failure as error:
    response = {'status': error.status, 'error': error.message}
except FileNotFoundError:
    response = {'status': 404, 'error': 'File or directory no longer exists'}
except PermissionError:
    response = {'status': 403, 'error': 'Permission denied'}
except (OSError, ValueError, KeyError, UnicodeError) as error:
    response = {'status': 400, 'error': str(error)}
json.dump(response, sys.stdout, ensure_ascii=True)
