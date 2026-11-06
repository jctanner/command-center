"""Explicit foreground Claude continuation provenance and phase contracts."""
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import time
import unittest

spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)

class ClaudeContinuation(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.cwd=self.temp.name;self.home=Path(self.cwd)/'claude';(self.home/'sessions').mkdir(parents=True)
        self.directory=a.claude_project(self.home,self.cwd);self.directory.mkdir(parents=True)
        self.root='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';self.child='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';self.now=int(time.time())
        pid=os.getpid();base,start,_=a.proc(pid)
        self.o=dict(kind='claude',base=base,identity='verified',target='$1:@2.%3',cwd=self.cwd,env={'CLAUDE_CONFIG_DIR':str(self.home)},args=[],visible='')
        self.registry=dict(pid=pid,procStart=start,sessionId=self.root,cwd=self.cwd,tmux='1:@2.%3',startedAt=(self.now-10000)*1000,status='busy',statusUpdatedAt=(self.now-7200)*1000,updatedAt=(self.now-7100)*1000)
        self.registry_path=self.home/'sessions'/f'{pid}.json';self.save_registry()
        self.root_records=[dict(type='user',sessionId=self.root,cwd=self.cwd,timestamp=self.now-7200,message=dict(role='user',content='Initial')),
                           dict(type='continued-in',sessionId=self.root,continuedInSessionId=self.child,timestamp=self.now-600)]
        self.child_records=[dict(type='ai-title',sessionId=self.child),dict(type='api-request',sessionId=self.child,querySource='repl_main_thread',timestamp=self.now-2,params='x'*300000),
                            dict(type='assistant',sessionId=self.child,cwd=self.cwd+'/subproject',timestamp=self.now-1,message=dict(role='assistant',stop_reason='end_turn',content='Done'))]
        self.save()
    def save_registry(self):self.registry_path.write_text(json.dumps(self.registry))
    def write(self,session,records):(self.directory/(session+'.jsonl')).write_text(''.join(json.dumps(r)+'\n' for r in records))
    def save(self):self.write(self.root,self.root_records);self.write(self.child,self.child_records)
    def test_explicit_continuation_with_large_header_and_new_cwd_is_current_ready_session(self):
        self.assertEqual(a.process_sessions(self.o,self.home),{self.child})
        candidates=a.conversations(self.o);self.assertEqual([c['session'] for c in candidates if c['linked']],[self.child])
        result=a.provider_activity(self.o,candidates);self.assertEqual(result['state'],'ready');self.assertEqual(result['source'],'claude_events')
        self.registry['updatedAt']=self.now*1000;self.save_registry()
        self.assertEqual(a.provider_activity(self.o)['state'],'ready')
    def test_cc_viewer_alias_links_the_same_verified_window_and_pane(self):
        self.registry['tmux']='cc-view-'+('a'*32)+':@2.%3';self.save_registry()
        self.assertEqual(a.process_sessions(self.o,self.home),{self.child})
        self.assertEqual([c['session'] for c in a.conversations(self.o) if c['linked']],[self.child])
        self.assertEqual(a.provider_activity(self.o)['state'],'ready')
        # The alias may no longer exist; physical target and process identity,
        # rather than the lifetime/name of a disposable viewer, are the proof.
        for field,value in [('procStart','0'),('cwd',self.cwd+'/unrelated'),('pidDomain','linux:other:pid:[1]')]:
            original=self.registry.get(field);self.registry[field]=value;self.save_registry()
            self.assertEqual(a.process_sessions(self.o,self.home),set())
            if original is None:self.registry.pop(field)
            else:self.registry[field]=original
        self.save_registry()
    def test_cc_viewer_alias_cannot_link_a_different_target_or_arbitrary_session_name(self):
        for target in ['cc-view-'+('a'*32)+':@9.%3','cc-view-'+('a'*32)+':@2.%9',
                       'cc-view-invalid:@2.%3','unrelated:@2.%3','2:@2.%3']:
            self.registry['tmux']=target;self.save_registry()
            self.assertEqual(a.process_sessions(self.o,self.home),set(),target)
            self.assertEqual(a.provider_activity(self.o)['state'],'unknown')
    def test_fresh_foreground_progress_survives_stale_registry_and_sidechains_cannot_complete_it(self):
        self.child_records += [dict(type='api-request',sessionId=self.child,querySource='repl_main_thread',timestamp=self.now),
                               dict(type='assistant',sessionId=self.child,isSidechain=True,timestamp=self.now,message=dict(role='assistant',stop_reason='end_turn')),
                               dict(type='api-request',sessionId=self.child,id='background',querySource='prompt_suggestion',timestamp=self.now),
                               dict(type='assistant',sessionId=self.child,requestRef='background',timestamp=self.now,message=dict(role='assistant',stop_reason='end_turn'))]
        self.save();self.assertEqual(a.provider_activity(self.o)['state'],'working')
    def test_unrelated_projects_and_wrong_processes_do_not_inherit_continuations(self):
        unrelated='cccccccc-cccc-cccc-cccc-cccccccccccc';self.write(unrelated,[dict(type='user',sessionId=unrelated,cwd=self.cwd+'/subproject')])
        self.assertNotIn(unrelated,[c['session'] for c in a.conversations(self.o)])
        self.registry['procStart']='0';self.save_registry();self.assertEqual(a.process_sessions(self.o,self.home),set());self.assertEqual(a.provider_activity(self.o)['state'],'unknown')
    def test_missing_cycles_unsafe_paths_ambiguity_and_partial_updates_fail_closed(self):
        self.root_records[1]['continuedInSessionId']='../outside';self.save();self.assertEqual(a.process_sessions(self.o,self.home),set())
        self.root_records[1]['continuedInSessionId']=self.child;self.save();(self.directory/(self.child+'.jsonl')).unlink();self.assertEqual(a.process_sessions(self.o,self.home),set())
        self.save();self.child_records.append(dict(type='continued-in',sessionId=self.child,continuedInSessionId=self.root,timestamp=self.now));self.save();self.assertEqual(a.process_sessions(self.o,self.home),set())
        self.child_records.pop();self.save()
        with (self.directory/(self.child+'.jsonl')).open('a') as f:f.write('{"type":"assistant"')
        self.assertEqual(a.provider_activity(self.o)['state'],'unknown')
        self.save();outside=Path(self.cwd)/'outside.jsonl';outside.write_text((self.directory/(self.child+'.jsonl')).read_text());(self.directory/(self.child+'.jsonl')).unlink();(self.directory/(self.child+'.jsonl')).symlink_to(outside)
        self.assertEqual(a.process_sessions(self.o,self.home),set())
    def test_fresh_registry_heartbeat_does_not_expire_a_long_running_root_turn(self):
        self.root_records=self.root_records[:1];self.save();self.registry['updatedAt']=self.now*1000;self.save_registry()
        result=a.provider_activity(self.o);self.assertEqual(result['state'],'working');self.assertEqual(result['source'],'claude_registry')
    def test_future_turn_evidence_cannot_establish_ready(self):
        self.child_records[-1]['timestamp']=self.now+120;self.save();self.assertEqual(a.provider_activity(self.o)['state'],'unknown')

    def test_resumed_log_in_old_project_folder_auto_selects_exact_continued_session(self):
        from unittest.mock import patch
        old=self.home/'projects'/'old-repository';self.directory.rename(old);self.directory=old
        self.o['args']=['claude','--resume',self.root]
        current=a.claude_project(self.home,self.cwd);current.mkdir()
        unrelated='cccccccc-cccc-cccc-cccc-cccccccccccc'
        (current/(unrelated+'.jsonl')).write_text(json.dumps(dict(type='user',sessionId=unrelated,cwd=self.cwd,timestamp=self.now,message=dict(role='user',content='Unrelated newer history')))+'\n')
        candidates=a.conversations(self.o);linked=[c for c in candidates if c['linked']]
        self.assertEqual(len(linked),1);self.assertEqual(linked[0]['session'],self.child)
        self.assertEqual(a.provider_activity(self.o)['state'],'ready')
        observed=dict(self.o,screen='screen',context='',in_mode=False)
        with patch.object(a,'observe',return_value=observed):result=a.execute(dict(action='details'))
        self.assertEqual(result['association'],'process');self.assertEqual(result['selected'],linked[0]['id'])
    def test_duplicate_fallback_uuid_paths_are_not_guessed(self):
        self.root_records=self.root_records[:1];self.save()
        old=self.home/'projects'/'old-repository';self.directory.rename(old);self.directory=old
        duplicate=self.home/'projects'/'another-repository';duplicate.mkdir()
        (duplicate/(self.root+'.jsonl')).write_text((old/(self.root+'.jsonl')).read_text())
        self.assertIsNone(a.claude_session_path(self.home,self.cwd,self.root))
        self.assertFalse(any(c['linked'] for c in a.conversations(self.o)))
    def test_verified_runtime_registry_wins_over_old_startup_resume_argument(self):
        self.root_records=self.root_records[:1];self.save();self.registry['sessionId']=self.child;self.save_registry()
        self.o['args']=['claude','--resume',self.root]
        self.assertEqual([c['session'] for c in a.conversations(self.o) if c['linked']],[self.child])
    def test_cross_project_symlinks_or_mismatched_uuid_are_not_followed(self):
        self.root_records=self.root_records[:1];self.save();old=self.home/'projects'/'old-repository';self.directory.rename(old);self.directory=old
        outside=Path(self.cwd)/'outside.jsonl';outside.write_text((old/(self.root+'.jsonl')).read_text());(old/(self.root+'.jsonl')).unlink();(old/(self.root+'.jsonl')).symlink_to(outside)
        self.assertIsNone(a.claude_session_path(self.home,self.cwd,self.root))
        (old/(self.root+'.jsonl')).unlink();(old/(self.root+'.jsonl')).write_text(json.dumps(dict(type='user',sessionId=self.child,cwd=self.cwd))+'\n')
        self.assertIsNone(a.claude_session_path(self.home,self.cwd,self.root))

if __name__=='__main__':unittest.main()
