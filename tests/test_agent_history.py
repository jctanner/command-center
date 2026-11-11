"""Provider log contracts: fixtures only, no user's messages or tmux input."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import os
import fcntl
import subprocess
import sys
import time

spec = importlib.util.spec_from_file_location('agent_remote', Path(__file__).parents[1] / 'src/agent_remote.py')
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

class AgentHistory(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='cc-history-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.log = self.root / 'conversation.jsonl'

    def write(self, records):
        self.log.write_text(''.join(json.dumps(r) + '\n' for r in records))

    def test_claude_excludes_tool_results_meta_sidechains_and_reasoning(self):
        self.write([
            {'type':'user','message':{'role':'user','content':'Hello'}},
            {'type':'user','isMeta':True,'message':{'role':'user','content':'SYSTEM_CONTEXT'}},
            {'type':'user','message':{'role':'user','content':[{'type':'tool_result','content':'TOOL_SECRET'}]}},
            {'type':'assistant','message':{'role':'assistant','content':[{'type':'thinking','thinking':'PRIVATE_REASONING'},{'type':'text','text':'Visible reply'}]}},
            {'type':'assistant','isSidechain':True,'message':{'role':'assistant','content':'OTHER_AGENT'}},
        ])
        messages = agent.history(self.log, 'claude')['messages']
        self.assertEqual([(m['role'],m['text']) for m in messages], [('user','Hello'),('assistant','Visible reply')])

    def test_claude_provider_notifications_and_summaries_are_not_human_messages(self):
        xml='<task-notification>\n<task-id>fixture</task-id>\n</task-notification>'
        flags=[{'promptSource':'system'}, {'turnOrigin':'task_notification'},
               {'origin':{'kind':'task-notification','producer':'session-task'}},
               {'isCompactSummary':True}]
        self.write([{'type':'user',**flag,'message':{'role':'user','content':xml}} for flag in flags]+[
            {'type':'user','origin':'unexpected-shape','message':{'role':'user','content':xml}},
            {'type':'assistant','message':{'role':'assistant','content':'A real reply'}}])
        page=agent.history(self.log,'claude')
        self.assertEqual([(m['role'],m['text']) for m in page['messages']], [('user',xml),('assistant','A real reply')])
        self.assertEqual(agent.launch_title({'path':str(self.log)},'claude'),' '.join(xml.split()))
        self.assertEqual(page['messages'][0]['input_hash'],agent.input_hash(xml))

    def test_large_launch_argv_handoff_is_private_literal_and_removed_on_start_or_failure(self):
        from unittest.mock import patch
        prompt='"' * 24000
        output=self.root/'received.json'
        command=[sys.executable,'-c','import json,sys; open(sys.argv[1],"w").write(json.dumps(sys.argv[2:]))',str(output),'--',prompt]
        def spawn(_request,*args,**kwargs):
            marker=args.index('-c',args.index('-c')+1)
            filename=Path(args[-1]);self.assertEqual(filename.stat().st_mode & 0o777,0o600)
            self.assertEqual(json.loads(filename.read_text()),command)
            subprocess.run([sys.executable,'-c',args[marker+1],str(filename)],check=True)
            self.assertFalse(filename.exists())
            return ''
        with patch.object(agent,'tmux',side_effect=spawn): agent.respawn_launch({},'%0',str(self.root),[],command)
        self.assertEqual(json.loads(output.read_text()),['--',prompt])
        filenames=[]
        def failed(_request,*args,**kwargs):
            filenames.append(Path(args[-1]));raise agent.Failure(409,'fixture failure')
        with patch.object(agent,'tmux',side_effect=failed):
            with self.assertRaises(agent.Failure):agent.respawn_launch({},'%0',str(self.root),[],command)
        self.assertFalse(filenames[0].exists())

    def test_codex_excludes_tools_and_developer_messages(self):
        self.write([
            {'type':'response_item','payload':{'type':'message','role':'developer','content':[{'type':'input_text','text':'INTERNAL'}]}},
            {'type':'response_item','payload':{'type':'message','role':'user','content':[{'type':'input_text','text':'Hello'}]}},
            {'type':'event_msg','payload':{'type':'user_message','message':'Hello'}},
            {'type':'response_item','payload':{'type':'message','role':'assistant','content':[{'type':'output_text','text':'Reply'}]}},
            {'type':'response_item','payload':{'type':'function_call_output','output':'TOOL_SECRET'}},
        ])
        self.assertEqual([m['text'] for m in agent.history(self.log,'codex')['messages']],['Hello','Reply'])

    def test_codex_harness_context_is_not_human_chat_or_launch_title(self):
        def message(text, kind, origin='harness'):
            return dict(type='response_item',payload=dict(type='message',role='user',
                content=[dict(type='input_text',text=text)],
                internal_chat_message_metadata_passthrough=dict(content_item_kinds=[kind],
                    content_item_metadata=[dict(provenance=dict(type=origin))])))
        internal='<turn_aborted>Injected interruption notice</turn_aborted>'
        environment='<environment_context>Injected environment</environment_context>'
        literal='Please explain <turn_aborted> without hiding my message.'
        self.write([message(internal,'generic.turn_aborted'),
                    message(environment,'environments.environment_context'),
                    message(literal,'user.text','user'),
                    message(internal,'generic.turn_aborted','user')])
        result=agent.history(self.log,'codex')
        self.assertEqual([m['text'] for m in result['messages']],[literal,internal])
        self.assertEqual([m['input_hash'] for m in result['messages']], [agent.input_hash(literal),agent.input_hash(internal)])
        self.assertEqual(agent.launch_title({'path':str(self.log)},'codex'),literal)

    def test_codex_preserves_ambiguous_metadata_and_human_xml(self):
        text='<turn_aborted>A human may type this exact wrapper</turn_aborted>'
        valid=dict(content_item_kinds=['generic.turn_aborted'],content_item_metadata=[dict(provenance=dict(type='harness'))])
        variants=[None,[],{},dict(valid,content_item_kinds='generic.turn_aborted'),
                  dict(valid,content_item_metadata=[]),dict(valid,content_item_metadata=[None]),
                  dict(valid,content_item_kinds=['unknown.future_kind']),
                  dict(content_item_kinds=['generic.turn_aborted','user.text'],content_item_metadata=[dict(provenance=dict(type='harness')),dict(provenance=dict(type='user'))])]
        records=[dict(type='response_item',payload=dict(type='message',role='user',content=[dict(type='input_text',text=text)],internal_chat_message_metadata_passthrough=metadata)) for metadata in variants]
        self.write(records)
        self.assertEqual(len(agent.history(self.log,'codex')['messages']),len(records))
        self.write([dict(type='event_msg',payload=dict(type='user_message',message=text))])
        self.assertEqual(agent.history(self.log,'codex')['messages'][0]['text'],text)

    def test_event_only_codex_logs_and_partial_appends(self):
        self.write([{'type':'event_msg','payload':{'type':'user_message','message':'Question'}}, {'type':'event_msg','payload':{'type':'agent_message','message':'Answer'}}])
        with self.log.open('a') as f: f.write('{"type":"response_item"')
        self.assertEqual([m['text'] for m in agent.history(self.log,'codex')['messages']],['Question','Answer'])

    def test_bounded_pages_do_not_drop_records_at_byte_boundaries(self):
        self.write([{'type':'response_item','payload':{'type':'message','role':'user','content':f'{i}: '+('x'*24000)}} for i in range(300)])
        cursor=None; messages=[]; cursors=set()
        for _ in range(10):
            page=agent.history(self.log,'codex',cursor)
            messages=page['messages']+messages
            cursor=page['older_cursor']
            if cursor is None: break
            self.assertNotIn(cursor,cursors);cursors.add(cursor)
        self.assertIsNone(cursor)
        self.assertEqual([int(m['text'].split(':')[0]) for m in messages],list(range(300)))

    def test_claude_registry_requires_live_process_start_and_tmux_target(self):
        pid = os.getpid()
        base, start, _ = agent.proc(pid)
        home = self.root / 'claude'
        (home / 'sessions').mkdir(parents=True)
        ident = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        record = {'pid':pid, 'procStart':start, 'sessionId':ident, 'cwd':str(self.root), 'tmux':'1:@2.%3', 'pidDomain':f'linux:{Path("/etc/machine-id").read_text().strip()}:{os.readlink(base / "ns/pid")}'}
        path = home / 'sessions' / f'{pid}.json'
        observation = {'kind':'claude','base':base,'target':'$1:@2.%3','cwd':str(self.root)}
        path.write_text(json.dumps(record))
        self.assertEqual(agent.process_sessions(observation,home),{ident})
        for field, value in [('procStart','0'),('pid',pid+1),('tmux','1:@2.%4'),('pidDomain','wrong namespace')]:
            path.write_text(json.dumps(dict(record,**{field:value})))
            self.assertEqual(agent.process_sessions(observation,home),set())

    def test_codex_thread_lock_requires_kernel_write_lock_ownership(self):
        base, _, _ = agent.proc(os.getpid())
        home = self.root/'codex'
        (home/'thread-writer-locks').mkdir(parents=True)
        ident = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        lock = home/'thread-writer-locks'/f'{ident}.lock'
        observation = {'kind':'codex','base':base}
        with lock.open('w') as stream:
            self.assertEqual(agent.process_sessions(observation,home),set())
            fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.assertEqual(agent.process_sessions(observation,home),{ident})
            fcntl.flock(stream,fcntl.LOCK_UN)
            self.assertEqual(agent.process_sessions(observation,home),set())

    def test_codex_only_same_active_turn_progress_refreshes_working(self):
        now = int(time.time())
        started=dict(type='event_msg',timestamp=now-1000,payload=dict(type='task_started',turn_id='root'))
        progress=dict(type='event_msg',timestamp=now,payload=dict(type='item_completed',turn_id='root'))
        self.write([started, progress])
        self.assertEqual(agent.codex_activity(self.log,now)['state'],'working')
        for ident in ['child', None]:
            self.write([started,dict(progress,payload=dict(type='item_completed',turn_id=ident))])
            self.assertEqual(agent.codex_activity(self.log,now)['state'],'unknown')
        self.write([progress])
        self.assertEqual(agent.codex_activity(self.log,now)['state'],'unknown')
        self.write([started,dict(type='event_msg',timestamp=now,payload=dict(type='task_complete',turn_id='root')),progress])
        self.assertEqual(agent.codex_activity(self.log,now)['state'],'ready')
        self.write([started,dict(progress,timestamp=now+100)])
        self.assertEqual(agent.codex_activity(self.log,now)['state'],'unknown')

    def test_codex_registration_requires_exact_private_process_binding(self):
        base, start, _ = agent.proc(os.getpid())
        home = self.root / 'codex'
        directory = home / 'command-center-sessions'
        directory.mkdir(parents=True)
        path = directory / f'{os.getpid()}.json'
        session = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
        observation = dict(kind='codex', base=base, target='$1:@2.%3', cwd=str(self.root))
        record = dict(schema=1, pid=os.getpid(), proc_start=start,
                      boot_id=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                      tmux_pane='%3', cwd=str(self.root), session_id=session)
        def write(value):
            path.write_text(json.dumps(value)); path.chmod(0o600)
        write(record)
        self.assertEqual(agent.process_sessions(observation, home), {session})
        for field, value in [('schema', 2), ('pid', os.getpid()+1), ('proc_start', '0'),
                             ('boot_id', 'old-boot'), ('tmux_pane', '%4'), ('cwd', '/other'),
                             ('session_id', '../not-a-session')]:
            write(dict(record, **{field:value}))
            self.assertEqual(agent.process_sessions(observation, home), set(), field)
        write(record); path.chmod(0o644)
        self.assertEqual(agent.process_sessions(observation, home), set())
        path.unlink(); target=directory/'target'; target.write_text(json.dumps(record)); target.chmod(0o600)
        path.symlink_to(target)
        self.assertEqual(agent.process_sessions(observation, home), set())
        path.unlink()
        for invalid in [[], None, 'bad', {'schema':1, 'cwd':None}]:
            write(invalid)
            self.assertEqual(agent.process_sessions(observation, home), set())

    def test_codex_registration_links_correct_history_among_shared_project_sessions(self):
        import sqlite3
        base, start, _ = agent.proc(os.getpid())
        home = self.root / 'codex'; home.mkdir()
        ids = ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']
        with sqlite3.connect(home/'state_5.sqlite') as db:
            db.execute('CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, archived INTEGER, updated_at INTEGER)')
            for i, session in enumerate(ids):
                path=home/f'{session}.jsonl'
                path.write_text(json.dumps(dict(type='session_meta',payload=dict(id=session,cwd=str(self.root))))+'\n'+json.dumps(dict(type='event_msg',timestamp=time.time(),payload=dict(type='task_started',turn_id=session)))+'\n')
                db.execute('INSERT INTO threads VALUES (?,?,?,0,?)',(session,str(path),str(self.root),i))
        observation=dict(kind='codex',base=base,target='$1:@2.%3',cwd=str(self.root),env={'CODEX_HOME':str(home)},args=[],identity='fixture',visible='')
        self.assertEqual(agent.provider_activity(observation)['state'],'unknown')
        directory=home/'command-center-sessions'; directory.mkdir()
        path=directory/f'{os.getpid()}.json'
        path.write_text(json.dumps(dict(schema=1,pid=os.getpid(),proc_start=start,boot_id=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),tmux_pane='%3',cwd=str(self.root),session_id=ids[0])))
        path.chmod(0o600)
        candidates=agent.conversations(observation)
        self.assertEqual([c['session'] for c in candidates if c['linked']],[ids[0]])
        self.assertEqual(agent.provider_activity(observation,candidates)['state'],'working')

    def test_codex_runtime_registration_overrides_incidental_lock_open_log_and_resume_arg(self):
        import sqlite3
        base,start,_=agent.proc(os.getpid())
        home=self.root/'codex';home.mkdir()
        ids=['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']
        paths=[]
        with sqlite3.connect(home/'state_5.sqlite') as db:
            db.execute('CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, archived INTEGER, updated_at INTEGER)')
            for i,session in enumerate(ids):
                path=home/f'{session}.jsonl';paths.append(path)
                path.write_text(json.dumps(dict(type='session_meta',payload=dict(id=session,cwd=str(self.root))))+'\n'+json.dumps(dict(type='event_msg',timestamp=time.time(),payload=dict(type='task_started',turn_id=session)))+'\n')
                db.execute('INSERT INTO threads VALUES (?,?,?,0,?)',(session,str(path),str(self.root),i))
        directory=home/'command-center-sessions';directory.mkdir()
        registration=directory/f'{os.getpid()}.json'
        record=dict(schema=1,pid=os.getpid(),proc_start=start,boot_id=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),tmux_pane='%3',cwd=str(self.root),session_id=ids[0])
        registration.write_text(json.dumps(record));registration.chmod(0o600)
        observation=dict(kind='codex',base=base,target='$1:@2.%3',cwd=str(self.root),env={'CODEX_HOME':str(home)},args=['codex','resume',ids[1]],identity='fixture',visible='')
        locks=home/'thread-writer-locks';locks.mkdir()
        with (locks/f'{ids[1]}.lock').open('w') as lock, paths[1].open() as opened:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            self.assertEqual(agent.process_sessions(observation,home),{ids[0]})
            candidates=agent.conversations(observation)
            self.assertEqual([c['session'] for c in candidates if c['linked']],[ids[0]])
            self.assertEqual(len(candidates),2)
            self.assertEqual(agent.provider_activity(observation,candidates)['state'],'working')
            registration.write_text(json.dumps(dict(record,boot_id='invalid')))
            self.assertEqual(agent.process_sessions(observation,home),{ids[1]})
            self.assertEqual([c['session'] for c in agent.conversations(observation) if c['linked']],[ids[1]])

    def test_shared_project_logs_require_explicit_session_association(self):
        home=self.root/'home'; logs=home/'sessions/2026/10/31';logs.mkdir(parents=True)
        ids=['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb']
        for ident in ids:
            (logs/f'rollout-{ident}.jsonl').write_text(json.dumps({'type':'session_meta','payload':{'cwd':str(self.root),'id':ident}})+'\n')
        observation={'kind':'codex','cwd':str(self.root),'env':{'CODEX_HOME':str(home)},'base':None,'args':[]}
        candidates=agent.conversations(observation)
        self.assertEqual(len(candidates),2)
        self.assertTrue(all(not c['linked'] for c in candidates))
        observation['args']=['codex','resume',ids[0]]
        linked=[c for c in agent.conversations(observation) if c['linked']]
        self.assertEqual([c['session'] for c in linked],[ids[0]])

    def test_codex_status_requires_root_turn_events_and_valid_fresh_evidence(self):
        now = int(time.time())
        def event(kind, turn='main', timestamp=None, root=None):
            return {'type':'event_msg', 'timestamp':now if timestamp is None else timestamp,
                    'payload':{'type':kind,'turn_id':turn,'root_turn_id':root}}
        self.write([event('task_started')])
        self.assertEqual(agent.codex_activity(self.log,now)['state'],'working')
        self.write([event('task_started'),event('task_started','child',root='main'),event('task_complete','child',root='main')])
        self.assertEqual(agent.codex_activity(self.log,now)['state'],'working')
        self.write([event('task_started'),event('task_complete','other')])
        self.assertEqual(agent.codex_activity(self.log,now)['state'],'working')
        self.write([event('task_started'),event('task_complete')])
        self.assertEqual(agent.codex_activity(self.log,now)['state'],'ready')
        self.write([event('turn_aborted')])
        self.assertEqual(agent.codex_activity(self.log,now)['state'],'ready')
        for timestamp in [now-901, now+60, 'invalid']:
            self.write([event('task_started',timestamp=timestamp)])
            self.assertEqual(agent.codex_activity(self.log,now)['state'],'unknown')
        self.write([event('task_complete')])
        with self.log.open('a') as stream: stream.write('{"type":')
        self.assertEqual(agent.codex_activity(self.log,now)['state'],'unknown')

    def test_project_history_cannot_determine_live_codex_status(self):
        self.write([{'type':'event_msg','timestamp':int(time.time()),'payload':{'type':'task_complete','turn_id':'main'}}])
        observation={'identity':'verified-process','base':Path('/proc')/str(os.getpid()),'env':{},'kind':'codex'}
        state=agent.provider_activity(observation,[{'linked':False,'path':str(self.log)}])
        self.assertEqual(state['state'],'unknown')
        state=agent.provider_activity(observation,[{'linked':True,'path':str(self.log)}])
        self.assertEqual(state['state'],'ready')

    def test_claude_status_is_bound_to_process_and_checks_transition_timestamps(self):
        pid=os.getpid();base,start,_=agent.proc(pid)
        home=self.root/'claude';(home/'sessions').mkdir(parents=True)
        ident='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        now=int(time.time()*1000)
        record={'pid':pid,'procStart':start,'sessionId':ident,'cwd':str(self.root),'tmux':'1:@2.%3',
                'startedAt':now-10000000,'status':'idle','statusUpdatedAt':now-5000000,'updatedAt':now-5000000}
        path=home/'sessions'/f'{pid}.json'
        observation={'kind':'claude','base':base,'identity':'verified','target':'$1:@2.%3','cwd':str(self.root),'env':{'CLAUDE_CONFIG_DIR':str(home)}}
        def check(changes, expected):
            path.write_text(json.dumps(dict(record,**changes)))
            self.assertEqual(agent.provider_activity(observation)['state'],expected)
        check({},'ready')  # Idle is a persistent transition, not a heartbeat.
        check({'status':'working','statusUpdatedAt':now,'updatedAt':now},'working')
        check({'status':'waiting_for_approval','statusUpdatedAt':now,'updatedAt':now},'approval')
        check({'status':'waiting','statusUpdatedAt':now,'updatedAt':now},'approval')
        self.assertEqual(agent.provider_activity(observation)['source'],'claude_input')
        self.assertIsNone(agent.approval_menu(observation))
        check({'status':'working'},'unknown')
        check({'statusUpdatedAt':now+60000,'updatedAt':now+60000},'unknown')
        check({'procStart':'0'},'unknown')
        check({'status':'new-unrecognized-state'},'unknown')

    def test_reply_cursor_ignores_user_and_tool_appends_but_tracks_new_assistant(self):
        def message(role,text):
            return {'type':'response_item','payload':{'type':'message','role':role,'content':[{'type':'output_text','text':text}]}}
        self.write([message('assistant','Original reply')])
        chosen={'id':'thread','path':str(self.log)}
        first=agent.reply_observation(chosen,'codex')
        with self.log.open('a') as f:
            f.write(json.dumps(message('user','A new question'))+'\n')
            f.write(json.dumps({'type':'response_item','payload':{'type':'function_call_output','output':'tool data'}})+'\n')
        same=agent.reply_observation(chosen,'codex')
        self.assertEqual(first['cursor'],same['cursor'])
        self.assertNotEqual(first['version'],same['version'])
        unchanged=agent.reply_observation(chosen,'codex',same['version'])
        self.assertTrue(unchanged['unchanged'])
        with self.log.open('a') as f: f.write(json.dumps(message('assistant','Original reply'))+'\n')
        self.assertNotEqual(agent.reply_observation(chosen,'codex')['cursor'],first['cursor'])

class PiHistory(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory(prefix='cc-pi-history-');self.addCleanup(self.directory.cleanup)
        self.root=Path(self.directory.name);self.path=self.root/'session.jsonl'
    def write(self, entries):
        records=[dict(type='session',version=3,id='pi-session',cwd=str(self.root),timestamp='2026-11-01T00:00:00Z'),*entries]
        self.path.write_text(''.join(json.dumps(record)+'\n' for record in records))
    def message(self, identity,parent,role,text):
        return dict(type='message',id=identity,parentId=parent,message=dict(role=role,content=[dict(type='text',text=text)]))
    def test_selected_branch_excludes_abandoned_reasoning_tools_and_custom_messages(self):
        self.write([self.message('u',None,'user','Question'),self.message('old','u','assistant','ABANDONED'),
                    self.message('s','u','system','SYSTEM_SECRET'),self.message('t','s','toolResult','TOOL_SECRET'),
                    dict(type='custom_message',id='c',parentId='t',display=False,content='HIDDEN_CUSTOM'),
                    dict(type='message',id='a',parentId='c',message=dict(role='assistant',content=[dict(type='thinking',thinking='THINKING_SECRET'),dict(type='toolCall',name='private_tool'),dict(type='text',text='Visible answer')]))])
        history=agent.history(self.path,'pi');self.assertEqual([m['text'] for m in history['messages']],['Question','Visible answer'])
        self.assertEqual(history['history_branch'],'a')
        with self.path.open('a') as f:f.write(json.dumps(self.message('new','u','assistant','Other branch'))+'\n')
        changed=agent.history(self.path,'pi',known_branch='a');self.assertTrue(changed['history_reset']);self.assertEqual([m['text'] for m in changed['messages']],['Question','Other branch'])
        with self.assertRaises(agent.Failure):agent.history(self.path,'pi',before=100000,known_branch='a')
    def test_pagination_and_partial_appends_preserve_a_single_branch(self):
        entries=[];parent=None
        for i in range(230):
            identity=f'm{i}';entries.append(self.message(identity,parent,'assistant' if i%2 else 'user',str(i)));parent=identity
        self.write(entries)
        with self.path.open('a') as f:f.write('{"type":"message"')
        messages=[];cursor=None
        for _ in range(3):
            page=agent.history(self.path,'pi',cursor);messages=page['messages']+messages;cursor=page['older_cursor']
        self.assertIsNone(cursor);self.assertEqual([int(m['text']) for m in messages],list(range(230)))
    def test_invalid_cycles_duplicate_ids_and_future_versions_fail_closed(self):
        for entries in [[self.message('a','b','user','x'),self.message('b','a','assistant','y')],
                        [self.message('a',None,'user','x'),self.message('a',None,'user','y')]]:
            self.write(entries)
            with self.assertRaises(agent.Failure):agent.history(self.path,'pi')
        self.path.write_text(json.dumps(dict(type='session',version=99,id='x',cwd=str(self.root)))+'\n')
        with self.assertRaises(agent.Failure):agent.history(self.path,'pi')
    def test_pi_sessions_use_native_paths_and_only_explicit_evidence_links_them(self):
        home=self.root/'pi-home';folder=home/'sessions'/('--'+str(self.root).lstrip('/').replace('/','-')+'--');folder.mkdir(parents=True)
        self.write([self.message('u',None,'user','hello')]);dest=folder/'log.jsonl';dest.write_bytes(self.path.read_bytes())
        observation=dict(kind='pi',cwd=str(self.root),env={'PI_CODING_AGENT_DIR':str(home)},args=['pi'],base=None)
        candidates=agent.conversations(observation);self.assertEqual(len(candidates),1);self.assertFalse(candidates[0]['linked'])
        observation['args']=['pi','--session',str(dest)];self.assertTrue(agent.conversations(observation)[0]['linked'])
        outside=self.root/'outside.jsonl';outside.write_bytes(self.path.read_bytes());(folder/'outside-link.jsonl').symlink_to(outside)
        self.assertEqual(len(agent.conversations(observation)),1)
        observation['identity']='verified';observation['base']=Path('/proc')/str(os.getpid())
        self.assertEqual(agent.provider_activity(observation)['state'],'unknown')
    def test_large_session_stops_at_bounded_ancestry_without_showing_other_branches(self):
        self.write([self.message('u',None,'user','Old question'),self.message('tool','u','toolResult','x'*(9*1024*1024)),self.message('a','tool','assistant','Latest visible')])
        page=agent.history(self.path,'pi')
        self.assertEqual([m['text'] for m in page['messages']],['Latest visible'])
        self.assertTrue(page['history_notice']);self.assertIsNone(page['older_cursor'])

    def test_pi_dialogs_do_not_authorize_approval_or_plain_message_input(self):
        observation=dict(kind='pi',identity='verified',in_mode=False,visible='Choose an action\n→ Yes\n  No\nEnter to select · Esc to cancel')
        self.assertTrue(agent.pi_dialog(observation));self.assertIsNone(agent.approval_menu(observation))
        observation['visible']='Working… esc to interrupt';self.assertFalse(agent.pi_dialog(observation))

class LaunchModel(unittest.TestCase):
    def test_model_is_an_optional_literal_identifier(self):
        self.assertIsNone(agent.launch_model(None))
        self.assertIsNone(agent.launch_model(''))
        for model in ['fixture-model-v1','provider/fixture-model','alias[1m]']:
            self.assertEqual(agent.launch_model(model),model)
        for model in ['--flag','model --flag','$(touch /tmp/file)','x;command','x\ncommand','x'*201,42]:
            with self.subTest(model=model), self.assertRaises(agent.Failure): agent.launch_model(model)

class LaunchedProcesses(unittest.TestCase):
    def test_owned_child_writer_lock_links_only_when_launch_marker_is_present(self):
        with tempfile.TemporaryDirectory(prefix='cc-child-writer-') as directory:
            home=Path(directory); locks=home/'thread-writer-locks';locks.mkdir()
            session='eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'
            script="import fcntl,sys; f=open(sys.argv[1],'w'); fcntl.lockf(f,fcntl.LOCK_EX); print('ready',flush=True); sys.stdin.read()"
            child=subprocess.Popen([sys.executable,'-c',script,str(locks/(session+'.lock'))],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(),'ready')
                observation=dict(kind='codex',base=Path('/proc')/str(os.getpid()),env={})
                self.assertNotIn(session,agent.process_sessions(observation,home))
                observation['env']['CC_LAUNCH_ID']='explicit-launch'
                self.assertIn(session,agent.process_sessions(observation,home))
            finally:
                child.stdin.close();child.wait(timeout=3);child.stdout.close()

class Approvals(unittest.TestCase):
    def observation(self, kind='codex', text=None):
        return dict(identity='process-1', in_mode=False, kind=kind, visible=text or
            "Would you like to run this command?\n  $ cargo test\n› 1. Yes, proceed (y)\n  2. No, and tell Codex what to do differently (esc)\nPress enter to confirm or esc to cancel\n")

    def test_codex_shortcuts_and_exact_context(self):
        menu = agent.approval_menu(self.observation())
        self.assertEqual([c['key'] for c in menu['choices']], ['y', 'esc'])
        self.assertIn('cargo test', menu['context'])
        changed = self.observation(); changed['visible'] = changed['visible'].replace('cargo test', 'cargo build')
        self.assertNotEqual(menu['id'], agent.approval_menu(changed)['id'])

    def test_claude_numbered_choices_and_wrapped_labels(self):
        text = "Do you want to proceed?\n❯ 1. Yes\n  2. Yes, and don't ask again for commands starting with\n     cargo test\n  3. No\nEsc to cancel · Tab to amend\n"
        menu = agent.approval_menu(self.observation('claude', text))
        self.assertEqual([c['key'] for c in menu['choices']], ['1', '2', '3'])
        self.assertIn('cargo test', menu['choices'][1]['label'])

    def test_fail_closed_for_old_generic_unselected_or_unverified_prompts(self):
        original = self.observation()
        for update in [dict(identity=None), dict(in_mode=True), dict(visible=original['visible']+'Agent is working\n'),
                       dict(visible=original['visible'].replace('› ', '  ')),
                       dict(visible=original['visible'].replace('(y)', '')),
                       dict(visible=original['visible'].replace('Would you like to run this command?', 'Choose your favorite color?'))]:
            with self.subTest(update=update):
                self.assertIsNone(agent.approval_menu(dict(original, **update)))

if __name__=='__main__': unittest.main()

class PiBridge(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='cc-pi-bridge-');self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.home=self.root/'home';self.directory=self.home/'command-center-status';self.directory.mkdir(parents=True)
        self.pid=os.getpid();self.base,self.start,_=agent.proc(self.pid);self.file=self.directory/f'{self.pid}.json'
        self.log=self.root/'session.jsonl';self.session='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
        self.log.write_text(json.dumps(dict(type='session',version=3,id=self.session,cwd=str(self.root)))+'\n'+json.dumps(dict(type='message',id='one',parentId=None,message=dict(role='assistant',content='Current branch')))+'\n'+json.dumps(dict(type='message',id='two',parentId=None,message=dict(role='assistant',content='Other branch')))+'\n')
        self.record=dict(schema=1,pid=self.pid,proc_start=self.start,boot_id=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),cwd=str(self.root),tmux_pane='%3',session_id=self.session,session_file=str(self.log),leaf_id='one',state='working',transition='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',updated_at=time.time())
    def observation(self):return dict(kind='pi',identity='verified',base=self.base,cwd=str(self.root),env={'PI_CODING_AGENT_DIR':str(self.home)},args=['pi'],target='$1:@2.%3',visible='')
    def write(self,**changes):
        self.file.write_text(json.dumps(dict(self.record,**changes)));self.file.chmod(0o600)
    def test_empty_pi_session_has_pre_send_identity_without_guessing_a_log(self):
        self.log.unlink();self.write(state='ready',leaf_id=None)
        observation=self.observation();observation.update(screen='screen',context='',in_mode=False)
        from unittest.mock import patch
        with patch.object(agent,'observe',return_value=observation):
            result=agent.execute(dict(action='outbox_status',identity='verified'))
        self.assertIsNone(result['log'])
        self.assertEqual(result['pending_pi_session'],self.session)
        self.assertEqual(result['users'],[])
        # A known leaf, stale bridge, or existing unvalidated file is not proof
        # of a never-persisted session. Never adopt project history as baseline.
        for update in [dict(leaf_id='existing'),dict(updated_at=time.time()-60)]:
            self.write(state='ready',**update)
            fresh=self.observation();fresh.update(screen='screen',context='',in_mode=False)
            with patch.object(agent,'observe',return_value=fresh):
                self.assertIsNone(agent.execute(dict(action='outbox_status',identity='verified')).get('pending_pi_session'))
        self.log.write_text('not a session header');self.write(state='ready',leaf_id=None)
        fresh=self.observation();fresh.update(screen='screen',context='',in_mode=False)
        with patch.object(agent,'observe',return_value=fresh):
            self.assertIsNone(agent.execute(dict(action='outbox_status',identity='verified')).get('pending_pi_session'))

    def test_live_bridge_links_exact_session_and_preserves_live_branch(self):
        self.write();observation=self.observation();candidates=agent.conversations(observation)
        self.assertEqual(len(candidates),1);self.assertTrue(candidates[0]['linked'])
        self.assertEqual(agent.provider_activity(observation)['state'],'working')
        page=agent.history(self.log,'pi',active_leaf=candidates[0]['leaf_id']);self.assertEqual([m['text'] for m in page['messages']],['Current branch'])
        version=agent.transcript_version(candidates[0])[1]
        self.write(leaf_id='two',state='ready');candidate=agent.conversations(self.observation())[0]
        self.assertNotEqual(agent.transcript_version(candidate)[1],version)
        self.assertEqual(agent.provider_activity(self.observation())['state'],'ready')
        self.write(state='waiting');self.assertEqual(agent.provider_activity(self.observation())['state'],'approval');self.assertIsNone(agent.approval_menu(self.observation()))
    def test_stale_wrong_process_scope_and_invalid_records_fail_closed(self):
        for change in [dict(updated_at=time.time()-40),dict(updated_at=time.time()+60),dict(pid=self.pid+1),dict(proc_start='0'),dict(boot_id='wrong'),dict(tmux_pane='%4'),dict(cwd='/elsewhere'),dict(state='invented'),dict(schema=2),dict(session_id='wrong')]:
            self.write(**change);self.assertIsNone(agent.pi_bridge(self.observation()),change)
            self.assertEqual(agent.provider_activity(self.observation())['state'],'unknown')
        self.write();self.file.chmod(0o644);self.assertIsNone(agent.pi_bridge(self.observation()))
        self.file.unlink();self.file.symlink_to(self.log);self.assertIsNone(agent.pi_bridge(self.observation()))
    def test_empty_or_out_of_window_live_branch_never_falls_back_to_other_branch(self):
        self.assertEqual(agent.history(self.log,'pi',active_leaf=None)['messages'],[])
        page=agent.history(self.log,'pi',active_leaf='missing');self.assertEqual(page['messages'],[]);self.assertTrue(page['history_notice'])
