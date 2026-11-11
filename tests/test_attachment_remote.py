"""Isolated managed-copy tests; no tmux agents, network or account files touched."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('attachments', ROOT / 'src/attachment_remote.py')
fs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fs)


class AttachmentFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.mock_home = patch.object(fs.pwd, 'getpwuid', return_value=types.SimpleNamespace(pw_dir=str(self.home)))
        self.mock_home.start()
        self.addCleanup(self.mock_home.stop)
        self.data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR' + struct.pack('>II', 20, 10) + b'\x08\x06\x00\x00\x00' + b'fixture'
        self.m = dict(message_id=str(uuid.uuid4()),board=str(uuid.uuid4()),export_id=str(uuid.uuid4()),
                      bytes=len(self.data),sha256=hashlib.sha256(self.data).hexdigest(),endpoint='endpoint',identity='process-start-boot',conversation='exact-log',home=fs.inspect_root())
        self.m['name'] = 'whiteboard-' + self.m['board'] + '.png'
        self.encoded = base64.b64encode(self.data).decode()

    def copy(self):
        return fs.copy(self.m, self.encoded)

    def path(self):
        return Path(fs.target_path(self.m))

    def test_prepare_does_not_create_anything(self):
        self.assertEqual(list(self.home.iterdir()), [])
        self.assertEqual(fs.inspect_root(), self.m['home'])
        self.assertEqual(list(self.home.iterdir()), [])

    def test_copy_verify_private_no_overwrite_and_cleanup(self):
        result = self.copy()
        self.assertEqual(result['state'], 'copied')
        self.assertEqual(self.path().read_bytes(), self.data)
        for directory in [self.path().parent, self.path().parent.parent, self.path().parent.parent.parent]:
            self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.path().stat().st_mode & 0o777, 0o400)
        self.assertEqual(fs.verify(self.m)['state'], 'verified')
        with self.assertRaises(FileExistsError): self.copy()
        self.assertEqual(self.path().read_bytes(), self.data)
        self.assertEqual(fs.cleanup(self.m)['state'], 'expired')
        self.assertFalse(self.path().parent.exists())

    def test_rejects_symlink_ancestor_without_writing(self):
        outside = self.home / 'outside'
        outside.mkdir()
        (self.home / '.cache').symlink_to(outside, target_is_directory=True)
        with self.assertRaises(OSError): fs.inspect_root()
        with self.assertRaises(OSError): self.copy()
        self.assertEqual(list(outside.iterdir()), [])

    def test_unsafe_existing_directory_permissions_are_not_changed(self):
        cache = self.home / '.cache'
        cache.mkdir(mode=0o777)
        cache.chmod(0o777)
        with self.assertRaises(fs.AttachmentError): fs.inspect_root()
        with self.assertRaises(fs.AttachmentError): self.copy()
        self.assertEqual(cache.stat().st_mode & 0o777, 0o777)

    def test_home_replacement_fails_closed(self):
        self.m['home']['inode'] += 1
        with self.assertRaises(fs.AttachmentError): self.copy()
        self.assertEqual(list(self.home.iterdir()), [])

    def test_checksums_type_dimensions_size_and_manifest_ids(self):
        for mutate in [lambda m:m.update(sha256='0'*64), lambda m:m.update(bytes=len(self.data)+1),
                       lambda m:m.update(name='../outside'), lambda m:m.update(message_id='../outside'),
                       lambda m:m.update(conversation=''), lambda m:m.update(bytes=fs.MAX_BYTES+1)]:
            with self.subTest(mutate=mutate):
                old=self.m.copy()
                mutate(self.m)
                with self.assertRaises((fs.AttachmentError,ValueError)): self.copy()
                self.m=old
        oversized = self.data[:16]+struct.pack('>II',8192,8192)+self.data[24:]
        for data in [b'x'*40, oversized]:
            m={**self.m,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
            with self.assertRaises(fs.AttachmentError): fs.copy(m,base64.b64encode(data).decode())
        self.assertEqual(list(self.home.iterdir()), [])

    def test_corruption_and_manifest_target_mismatch_fail_verification(self):
        self.copy()
        with self.assertRaises(fs.AttachmentError): fs.verify({**self.m,'identity':'replacement'})
        self.path().chmod(0o600)
        self.path().write_bytes(b'x'*len(self.data))
        with self.assertRaises(fs.AttachmentError): fs.verify(self.m)
        # Resolved/expired cleanup can remove corrupted managed content only
        # when the separately frozen intent marker still proves ownership.
        self.assertEqual(fs.cleanup(self.m)['state'], 'expired')
        self.assertFalse(self.path().exists())

    def test_hardlink_symlink_and_unknown_file_are_never_deleted(self):
        self.copy()
        other=self.path().parent/'unexpected'
        other.write_text('keep')
        with self.assertRaises(fs.AttachmentError): fs.cleanup(self.m)
        self.assertTrue(other.exists())
        other.unlink()
        outside=self.home/'outside'
        os.link(self.path(),outside)
        with self.assertRaises(fs.AttachmentError): fs.verify(self.m)
        with self.assertRaises(fs.AttachmentError): fs.cleanup(self.m)
        outside.unlink()
        self.path().unlink()
        self.path().symlink_to(outside)
        with self.assertRaises(OSError): fs.verify(self.m)
        self.assertTrue(self.path().is_symlink())

    def test_partial_copy_has_no_completion_and_cannot_be_retried(self):
        with patch.object(fs,'publish',side_effect=OSError('interrupted')):
            with self.assertRaises(OSError):self.copy()
        self.assertTrue(self.path().parent.exists())
        self.assertFalse((self.path().parent/'manifest.json').exists())
        with self.assertRaises(fs.AttachmentError):fs.verify(self.m)
        with self.assertRaises(FileExistsError):self.copy()

    def test_partial_file_cleanup_requires_the_frozen_intent_marker(self):
        original=fs.publish
        def interrupted(directory,name,data):
            if name==self.m['name']:
                original(directory,name,data[:10])
                raise OSError('interrupted after partial file')
            return original(directory,name,data)
        with patch.object(fs,'publish',side_effect=interrupted):
            with self.assertRaises(OSError):self.copy()
        with self.assertRaises(fs.AttachmentError):fs.verify(self.m)
        self.assertEqual(fs.cleanup(self.m)['state'],'expired')
        self.assertFalse(self.path().parent.exists())

    def bootstrap(self,operation,after_copy_change=False):
        agent_code="""
calls=0
def observe(request):
 global calls
 calls+=1
 return {'identity': 'replacement' if calls>1 and CHANGE else request['identity']}
def conversations(observation):return [{'id':CONVERSATION,'linked':True}]
""".replace('CHANGE',repr(after_copy_change)).replace('CONVERSATION',repr(self.m['conversation']))
        filesystem_code=(ROOT/'src/attachment_remote.py').read_text()+"\nhome=lambda: "+repr(self.m['home'])+"\n"
        request=dict(operation=operation,identity=self.m['identity'],conversation=self.m['conversation'],manifest=self.m,payload=self.encoded,_agent_code=agent_code,_attachment_code=filesystem_code)
        run=subprocess.run([sys.executable,'-B',str(ROOT/'src/attachment_bootstrap.py')],input=json.dumps(request).encode(),capture_output=True,timeout=10,check=True)
        return json.loads(run.stdout)

    def test_target_changes_after_copy_report_uncertainty_and_allow_read_only_verification(self):
        self.assertEqual(self.bootstrap('prepare')['ok']['home'],self.m['home'])
        self.assertEqual(list(self.home.iterdir()),[])
        self.assertEqual(self.bootstrap('copy',after_copy_change=True)['status'],409)
        before=self.path().stat()
        self.assertEqual(self.bootstrap('verify')['ok']['state'],'verified')
        after=self.path().stat()
        self.assertEqual((before.st_ino,before.st_mtime_ns),(after.st_ino,after.st_mtime_ns))
        self.assertNotIn('ok',self.bootstrap('copy')) # Existing file is never retried/overwritten.

    def test_quota_rejects_before_new_message_directory(self):
        with patch.object(fs,'used_bytes',return_value=fs.QUOTA):
            with self.assertRaises(fs.AttachmentError):self.copy()
        self.assertFalse(self.path().parent.exists())

if __name__=='__main__':unittest.main()
