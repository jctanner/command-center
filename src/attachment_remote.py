"""Fixed managed-artifact filesystem operations. Called only by CC transport.

All names and manifests are supplied by CC, never by the browser. Directory FDs
and exclusive publication prevent symlink traversal and overwriting user files.
Native process/conversation checks are performed by agent_remote before and after
these operations, not inferred from the filesystem.
"""
import base64
import hashlib
import json
import os
import pwd
import re
import stat
import struct
import time
import uuid

MAX_BYTES = 4 * 1024 * 1024
QUOTA = 128 * 1024 * 1024
FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC


class AttachmentError(Exception):
    pass


def require(value, message):
    if not value:
        raise AttachmentError(message)


def checked_uuid(value):
    require(isinstance(value, str) and str(uuid.UUID(value)) == value, 'Invalid managed UUID')
    return value


def private_dir(fd, managed=False):
    s = os.fstat(fd)
    require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid()
            and not s.st_mode & 0o022, 'Unsafe attachment directory')
    if managed:
        require(not s.st_mode & 0o077, 'Managed directory must be private')
    return s


def home():
    path = os.path.realpath(pwd.getpwuid(os.geteuid()).pw_dir)
    fd = os.open(path, FLAGS)
    try:
        s = private_dir(fd)
        return dict(path=path, device=s.st_dev, inode=s.st_ino, owner=s.st_uid)
    finally:
        os.close(fd)


def root(expected, create=False):
    actual = home()
    require(actual == expected, 'Account home changed')
    fd = os.open(actual['path'], FLAGS)
    try:
        s = private_dir(fd)
        require((s.st_dev, s.st_ino) == (expected['device'], expected['inode']), 'Account home changed')
        for name in ('.cache', 'command-center', 'attachments'):
            if create:
                try:
                    os.mkdir(name, 0o700, dir_fd=fd)
                    os.fsync(fd)
                except FileExistsError:
                    pass
            next_fd = os.open(name, FLAGS, dir_fd=fd)
            try:
                private_dir(next_fd, managed=name != '.cache')
            except BaseException:
                os.close(next_fd)
                raise
            os.close(fd)
            fd = next_fd
        return fd
    except BaseException:
        os.close(fd)
        raise


def inspect_root():
    h = home()
    # Read-only preparation validates every existing ancestor, even when later
    # ancestors do not exist yet. Nothing is created or chmod'ed here.
    fd = os.open(h['path'], FLAGS)
    try:
        for name in ('.cache', 'command-center', 'attachments'):
            try:
                child = os.open(name, FLAGS, dir_fd=fd)
            except FileNotFoundError:
                break
            try:
                private_dir(child, managed=name != '.cache')
            except BaseException:
                os.close(child)
                raise
            os.close(fd)
            fd = child
        return h
    finally:
        os.close(fd)


def validate_manifest(m):
    require(isinstance(m, dict), 'Invalid attachment manifest')
    checked_uuid(m['message_id'])
    checked_uuid(m['board'])
    checked_uuid(m['export_id'])
    require(m['name'] == 'whiteboard-' + m['board'] + '.png', 'Invalid artifact name')
    require(isinstance(m['bytes'], int) and 0 < m['bytes'] <= MAX_BYTES, 'Attachment size exceeded')
    require(isinstance(m['sha256'], str) and re.fullmatch('[0-9a-f]{64}', m['sha256']), 'Invalid checksum')
    require(all(isinstance(m[k], str) and 0 < len(m[k]) <= 1024
                for k in ('endpoint', 'identity', 'conversation')), 'Missing target binding')
    require(isinstance(m['home'], dict), 'Missing account home')
    require(len(json.dumps(m).encode()) < 16384, 'Manifest exceeded bound')


def target_path(m):
    validate_manifest(m)
    return os.path.join(m['home']['path'], '.cache', 'command-center', 'attachments', m['message_id'], m['name'])


def png_check(data, m):
    require(len(data) == m['bytes'] and hashlib.sha256(data).hexdigest() == m['sha256'], 'Attachment checksum mismatch')
    require(len(data) >= 33 and data[:8] == b'\x89PNG\r\n\x1a\n'
            and data[8:16] == b'\x00\x00\x00\rIHDR', 'Attachment is not a PNG')
    width, height = struct.unpack('>II', data[16:24])
    require(0 < width <= 8192 and 0 < height <= 8192 and width * height <= 8_000_000, 'PNG pixel limit exceeded')


def regular(fd, max_bytes):
    s = os.fstat(fd)
    require(stat.S_ISREG(s.st_mode) and s.st_uid == os.geteuid() and s.st_nlink == 1
            and not s.st_mode & 0o077 and s.st_size <= max_bytes, 'Unsafe managed file')
    return s


def read_file(directory, name, limit):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
    try:
        info = regular(fd, limit)
        data = bytearray()
        while len(data) <= limit:
            chunk = os.read(fd, min(65536, limit + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        after = regular(fd, limit)
        require(len(data) == info.st_size and (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)
                == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns), 'Managed file changed during read')
        return bytes(data)
    finally:
        os.close(fd)


def publish(directory, name, data):
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
    try:
        regular(fd, max(len(data), 1))
        view = memoryview(data)
        while view:
            count = os.write(fd, view)
            require(count > 0, 'Incomplete attachment write')
            view = view[count:]
        os.fsync(fd)
        os.fchmod(fd, 0o400)
    finally:
        os.close(fd)
    os.fsync(directory)


def used_bytes(directory):
    # Bounded inspection; unexpected contents fail closed instead of deleting
    # them or following links. No recursive arbitrary-directory traversal.
    total = 0
    names = os.listdir(directory)
    require(len(names) <= 4096, 'Attachment directory capacity exceeded')
    for name in names:
        checked_uuid(name)
        fd = os.open(name, FLAGS, dir_fd=directory)
        try:
            private_dir(fd, managed=True)
            files = os.listdir(fd)
            require(len(files) <= 3, 'Unexpected managed directory contents')
            for filename in files:
                require(filename in ('intent.json', 'manifest.json') or re.fullmatch(r'whiteboard-[0-9a-f-]{36}\.png', filename), 'Unexpected managed file')
                child = os.open(filename, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
                try:
                    total += regular(child, MAX_BYTES).st_size
                finally:
                    os.close(child)
        finally:
            os.close(fd)
    return total


def copy(m, encoded):
    validate_manifest(m)
    require(isinstance(encoded, str) and len(encoded) <= (MAX_BYTES + 2) // 3 * 4, 'Attachment payload exceeded limit')
    data = base64.b64decode(encoded, validate=True)
    png_check(data, m)
    directory = root(m['home'], create=True)
    try:
        require(used_bytes(directory) + len(data) + 16384 <= QUOTA, 'Managed attachment quota reached')
        os.mkdir(m['message_id'], 0o700, dir_fd=directory)  # No existing intent is overwritten.
        os.fsync(directory)
        child = os.open(m['message_id'], FLAGS, dir_fd=directory)
        try:
            private_dir(child, managed=True)
            publish(child, 'intent.json', json.dumps(m, sort_keys=True).encode())
            publish(child, m['name'], data)
            # Persist completion only after independent disk read-back.
            png_check(read_file(child, m['name'], MAX_BYTES), m)
            publish(child, 'manifest.json', json.dumps(m, sort_keys=True).encode())
        finally:
            os.close(child)
    finally:
        os.close(directory)
    return dict(state='copied', path=target_path(m), sha256=m['sha256'], bytes=m['bytes'])


def verify(m):
    validate_manifest(m)
    directory = root(m['home'])
    try:
        child = os.open(m['message_id'], FLAGS, dir_fd=directory)
        try:
            private_dir(child, managed=True)
            require(set(os.listdir(child)) == {m['name'], 'intent.json', 'manifest.json'}, 'Unexpected attachment files')
            require(json.loads(read_file(child, 'intent.json', 16384)) == m, 'Attachment intent does not match target')
            require(json.loads(read_file(child, 'manifest.json', 16384)) == m, 'Attachment manifest does not match target')
            png_check(read_file(child, m['name'], MAX_BYTES), m)
        finally:
            os.close(child)
    finally:
        os.close(directory)
    return dict(state='verified', path=target_path(m), sha256=m['sha256'], bytes=m['bytes'], verified_at=int(time.time() * 1000))


def cleanup(m):
    # A durable, expired, resolved receipt authorizes removing only files proven
    # to belong to this intent. The pre-copy intent marker also permits safe
    # cleanup after a partial write. Unknown/pre-existing directories remain.
    validate_manifest(m)
    directory = root(m['home'])
    try:
        child = os.open(m['message_id'], FLAGS, dir_fd=directory)
        try:
            private_dir(child, managed=True)
            require(json.loads(read_file(child, 'intent.json', 16384)) == m, 'Attachment intent does not match target')
            names = set(os.listdir(child))
            require(names <= {m['name'], 'intent.json', 'manifest.json'}, 'Unexpected attachment files')
            if 'manifest.json' in names:
                require(json.loads(read_file(child, 'manifest.json', 16384)) == m, 'Completion manifest changed')
            for name in names:
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=child)
                try:
                    regular(fd, MAX_BYTES)
                finally:
                    os.close(fd)
            for name in (m['name'], 'manifest.json', 'intent.json'):
                if name in names:
                    os.unlink(name, dir_fd=child)
            os.fsync(child)
        finally:
            os.close(child)
        os.rmdir(m['message_id'], dir_fd=directory)
        os.fsync(directory)
    finally:
        os.close(directory)
    return dict(state='expired', path=target_path(m))
