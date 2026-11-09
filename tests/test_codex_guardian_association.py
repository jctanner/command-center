"""Owned guardian writers must not compete with the user conversation."""
import importlib.util
import os
import json
import time
import fcntl
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('agent', Path(__file__).parents[1] / 'src/agent_remote.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

class GuardianAssociation(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        (self.home / 'thread-writer-locks').mkdir()
        self.directory = self.home / 'sessions/2026/11/08'
        self.directory.mkdir(parents=True)
        self.root = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        self.guardian = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        self.observation = dict(kind='codex', base=Path('/proc')/str(os.getpid()), cwd=str(self.home), env={'CODEX_HOME':str(self.home),'CC_LAUNCH_ID':'launch'}, args=['codex','--approve-for-me'], identity='original', screen='screen', visible='', context='', in_mode=False, target='$0:@1.%2')

    def writer(self, session, **metadata):
        lock = (self.home/'thread-writer-locks'/(session+'.lock')).open('w')
        self.addCleanup(lock.close)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        path = self.directory / ('rollout-'+session+'.jsonl')
        header = dict(id=session, cwd=str(self.home), source='cli', **metadata)
        events = [dict(type='session_meta', payload=header), dict(type='event_msg',timestamp=int(time.time()),payload=dict(type='task_complete',turn_id='root',root_turn_id='root'))]
        path.write_text(''.join(json.dumps(x)+'\n' for x in events))
        # Real Codex owns both an open log and its writer lock.
        stream = path.open('rb'); self.addCleanup(stream.close)
        return path

    def test_guardian_owned_lock_does_not_block_ready_or_outbox_association(self):
        root = self.writer(self.root)
        child = self.writer(self.guardian, session_id=self.root, parent_thread_id=self.root, thread_source='guardian_review')
        records = child.read_text().splitlines(); header=json.loads(records[0]);header['payload']['source']={'subagent':{'other':'guardian'}};records[0]=json.dumps(header);child.write_text('\n'.join(records)+'\n')
        self.assertEqual(a.process_sessions(self.observation,self.home),{self.root,self.guardian})
        candidates=a.conversations(self.observation)
        self.assertEqual([(c['session'],c['linked']) for c in candidates],[(self.root,True)])
        with patch.object(a,'observe',return_value=self.observation):
            result=a.execute(dict(action='outbox_status',identity='original'))
        self.assertEqual(result['log']['conversation'],hashlib.sha256(str(root).encode()).hexdigest())
        self.assertEqual(result['activity']['state'],'ready')
        self.assertTrue(result['send_available'])
        # A child completion cannot turn a genuinely working parent Ready.
        with root.open('a') as out:out.write(json.dumps(dict(type='event_msg',timestamp=int(time.time()),payload=dict(type='task_started',turn_id='next',root_turn_id='next')))+'\n')
        self.assertEqual(a.provider_activity(self.observation)['state'],'working')

    def test_two_genuine_root_writers_stay_ambiguous(self):
        self.writer(self.root);self.writer(self.guardian)
        self.assertEqual(len([c for c in a.conversations(self.observation) if c['linked']]),2)
        with patch.object(a,'observe',return_value=self.observation):
            result=a.execute(dict(action='outbox_status',identity='original'))
        self.assertIsNone(result['log'])
        self.assertEqual(result['activity']['state'],'unknown')

    def test_explicit_child_markers_excluded_but_human_forks_and_legacy_kept(self):
        path=self.directory/'metadata.jsonl'
        for extra,excluded in [({'source':{'subagent':{'thread_spawn':{'parent_thread_id':self.root}}}},True),({'source':'subagent'},True),({'thread_source':'guardian_review'},True),({'parent_thread_id':self.root,'source':'cli','thread_source':'user'},False),({'source':'future_source'},False),({},False)]:
            payload=dict(id=self.root,cwd=str(self.home));payload.update(extra)
            path.write_text(json.dumps(dict(type='session_meta',payload=payload))+'\n')
            self.assertEqual(a.metadata(path,'codex')[0] is None,excluded)

if __name__ == '__main__':unittest.main()
