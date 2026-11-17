"""Isolated fake-package tests: no registry access or agent input."""
import importlib.util,json,os,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
import uuid
spec=importlib.util.spec_from_file_location('install',Path(__file__).parents[1]/'src/acp_install.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
CODEX=m.PROVIDERS['codex']
FAKE_AGENT=(Path(__file__).parent/'fixtures/fake-acp-agent.py').read_text()

def npm_source(fail=False,bad_integrity=False,provider='codex'):
    profile=m.PROVIDERS[provider]
    return '''#!/usr/bin/env python3
import json,pathlib,sys
args=sys.argv[1:];stage=pathlib.Path(args[args.index('--prefix')+1]);(stage/'arguments.json').write_text(json.dumps(args))
'''+('raise SystemExit(3)\n'if fail else '')+'''
package=stage/'node_modules'/''' +repr(profile['package'])+''';package.mkdir(parents=True)
(package/'package.json').write_text(json.dumps({'name':''' +repr(profile['package'])+''','version':''' +repr(profile['version'])+'''}))
(stage/'package-lock.json').write_text(json.dumps({'packages':{'node_modules/'''+profile['package']+'''':{'version':''' +repr(profile['version'])+''','integrity':''' +repr('bad' if bad_integrity else profile['integrity'])+'''}}}))
(stage/'node_modules/.bin').mkdir();binary=stage/'node_modules/.bin'/'''+repr(profile['executable'])+''';binary.write_text('''+repr(FAKE_AGENT)+''');binary.chmod(0o700)
'''

class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.home=Path(self.tmp.name);self.bin=self.home/'bin';self.bin.mkdir()
        self.npm=self.bin/'npm';self.npm.write_text(npm_source());self.npm.chmod(0o700)
        self.env=patch.dict(os.environ,HOME=str(self.home),PATH=str(self.bin)+':'+os.environ.get('PATH',''));self.env.start();self.addCleanup(self.env.stop)
    def job(self,proposal=None):
        ident=str(uuid.uuid4());base=m.root(True);job=base/ident;job.mkdir(mode=0o700);m.write(job/'intent.json',{'id':ident,'proposal':proposal or m.propose(),'at':time.time()});m.write(base/((proposal or m.propose())['provider']+'.lock'),{'id':ident});(job/'installer.py').write_text('# fixture');(job/'installer.py').chmod(0o600);return ident,job
    def test_proposal_is_read_only_and_rejects_symlinks_and_existing_prefix(self):
        p=m.propose();self.assertEqual(CODEX['version'],p['version']);self.assertFalse((self.home/'.local').exists());self.assertFalse((self.home/'.cache').exists())
        (self.home/'.local').symlink_to(self.bin,target_is_directory=True)
        with self.assertRaises(ValueError):m.propose()
        (self.home/'.local').unlink();prefix=Path(p['prefix']);prefix.mkdir(parents=True)
        with self.assertRaisesRegex(ValueError,'already exists'):m.propose()
    def test_worker_publishes_pinned_private_package_without_scripts_or_global_changes(self):
        p=m.propose();ident,job=self.job(p);m.work(job);result=m.status(ident);self.assertEqual('installed',result['state']);prefix=Path(p['prefix']);self.assertTrue((prefix/'node_modules/.bin/codex-acp').is_file())
        args=json.loads((prefix/'arguments.json').read_text());self.assertIn('--ignore-scripts',args);self.assertIn('--save-exact',args);self.assertIn(CODEX['package']+'@'+CODEX['version'],args);self.assertNotIn('-g',args);self.assertNotIn('--global',args);self.assertFalse((job/'cache').exists());self.assertFalse((m.root()/'codex.lock').exists())
        with self.assertRaisesRegex(ValueError,'already exists'):m.propose()
    def test_failed_or_wrong_integrity_install_retains_receipt_and_publishes_nothing(self):
        for fail,bad in [(True,False),(False,True)]:
            self.npm.write_text(npm_source(fail,bad));p=m.propose();ident,job=self.job(p);m.work(job);self.assertEqual('install_failed',m.status(ident)['state']);self.assertFalse(Path(p['prefix']).exists());self.assertFalse((job/'stage').exists());self.assertFalse((job/'cache').exists())
    def test_atomic_publish_never_replaces_an_existing_directory(self):
        source=self.home/'stage';dest=self.home/'dest';source.mkdir();dest.mkdir();(dest/'keep').write_text('existing')
        with self.assertRaises(OSError):m.publish(source,dest)
        self.assertEqual('existing',(dest/'keep').read_text());self.assertTrue(source.exists())
    def test_unfinished_receipt_becomes_uncertain_without_starting_a_retry(self):
        ident,job=self.job();intent=m.read(job/'intent.json');intent['at']=time.time()-m.TIMEOUT-31;(job/'intent.json').unlink();m.write(job/'intent.json',intent)
        self.assertEqual('install_uncertain',m.status(ident)['state']);self.assertFalse((job/'stage').exists())

    def test_changed_install_proposal_never_runs_a_package_manager(self):
        proposal=m.propose()
        for changed in [dict(proposal,version='latest'),dict(proposal,prefix='/tmp/arbitrary'),dict(proposal,package='other-package')]:
            with patch.object(m.subprocess,'Popen')as spawn:
                self.assertEqual('install_failed',m.start(str(uuid.uuid4()),changed,'# unused')['state']);spawn.assert_not_called()
        self.assertFalse((self.home/'.cache').exists())
    def test_existing_install_lock_is_not_replaced_or_released_by_another_job(self):
        base=m.root(True);owner=str(uuid.uuid4());m.write(base/'codex.lock',{'id':owner})
        with patch.object(m.subprocess,'Popen')as spawn:
            result=m.start(str(uuid.uuid4()),m.propose(),'# unused');self.assertEqual('install_failed',result['state']);spawn.assert_not_called()
        self.assertEqual(owner,m.read(base/'codex.lock')['id'])

    def test_claude_profile_publishes_only_its_own_pinned_executable_and_prefix(self):
        self.npm.write_text(npm_source(provider='claude'));p=m.propose('claude');ident,job=self.job(p);m.work(job)
        self.assertEqual('installed',m.status(ident)['state']);self.assertEqual('0.107.3',p['version']);self.assertTrue((Path(p['prefix'])/'node_modules/.bin/claude-agent-acp').is_file());self.assertFalse((self.home/'.local/share/command-center/acp-adapters/codex').exists());self.assertFalse((m.root()/'claude.lock').exists())
    def test_unknown_provider_and_old_node_do_not_start_claude_installation(self):
        with self.assertRaisesRegex(ValueError,'Unsupported'):m.propose('../claude')
        node=self.bin/'node';node.write_text('#!/bin/sh\necho v20.0.0\n');node.chmod(0o700)
        with self.assertRaisesRegex(ValueError,'22'):m.propose('claude')
        self.assertFalse((self.home/'.cache').exists())
