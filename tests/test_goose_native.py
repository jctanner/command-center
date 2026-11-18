"""Native Goose uses read-only SQLite and exact process/session identity, never ACP."""
import hashlib,importlib.util,json,os,sqlite3,tempfile,unittest,uuid
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('goose_native',ROOT/'src/agent_remote.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class Goose(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.project=self.root/'project';self.project.mkdir();self.base=self.root/'proc';self.base.mkdir();self.db=self.root/'data/sessions/sessions.db';self.db.parent.mkdir(parents=True)
  self.conn=sqlite3.connect(self.db);self.addCleanup(self.conn.close);self.conn.executescript('CREATE TABLE sessions(id TEXT PRIMARY KEY, name TEXT, working_dir TEXT, updated_at TEXT, session_type TEXT, archived_at TEXT); CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id TEXT,role TEXT,content_json TEXT,created_timestamp INTEGER,metadata_json TEXT); CREATE INDEX message_session ON messages(session_id,id);');self.conn.commit()
  self.obs=dict(kind='goose',cwd=str(self.project),env={'GOOSE_PATH_ROOT':str(self.root)},base=self.base,identity='original',args=['goose','session','--resume','--session-id','20261118_1'],visible='Goose\n> \n',context='Goose\n> \n',cursor=[2,1],in_mode=False,screen='screen')
  self.session('20261118_1','cc-test');self.message('user','hello');self.message('assistant','reply')
 def session(self,id,name,path=None):self.conn.execute('INSERT INTO sessions VALUES(?,?,?,?,?,NULL)',(id,name,str(path or self.project),'2026-11-18T12:00:00Z','user'));self.conn.commit()
 def message(self,role,text,meta=None,content=None,sid='20261118_1'):
  self.conn.execute('INSERT INTO messages(session_id,role,content_json,created_timestamp,metadata_json) VALUES(?,?,?,?,?)',(sid,role,json.dumps(content if content is not None else[dict(type='text',text=text)]),1730000000,json.dumps(meta or {})));self.conn.commit()
 def test_shared_db_open_or_only_candidate_never_proves_live_session(self):
  self.assertTrue(a.conversations(self.obs)[0]['linked'])
  self.obs['args']=['goose','session'];self.assertFalse(a.conversations(self.obs)[0]['linked'])
  self.obs['args']=['goose','session','--name','cc-test'];self.assertTrue(a.conversations(self.obs)[0]['linked'])
  self.session('20261118_2','cc-test');self.assertFalse(any(c['linked']for c in a.conversations(self.obs)))
  self.obs['args']=['goose','session','--resume','--session-id','20261118_1','--fork'];self.assertFalse(any(c['linked']for c in a.conversations(self.obs)))
 def test_project_scope_sql_literals_and_non_uuid_resume_ids(self):
  self.session('20261118_3','Other',self.root/'elsewhere');self.assertEqual(len(a.conversations(self.obs)),1)
  self.obs['args']=['goose','session','--resume','--session-id',"x' OR 1=1 --"];self.assertFalse(any(c['linked']for c in a.conversations(self.obs)))
  self.assertTrue(a.goose_session_id('20261118_1'));self.assertFalse(a.goose_session_id('../sessions.db'));self.assertFalse(a.goose_session_id('-danger'))
 def test_history_filters_metadata_reasoning_tools_and_wal_invalidates(self):
  self.conn.execute('PRAGMA journal_mode=WAL');before=a.conversations(self.obs)[0];version=a.transcript_version(before)[1]
  self.message('user','hidden context',dict(userVisible=False));self.message('assistant','',content=[dict(type='thinking',thinking='private'),dict(type='toolResponse',text='private result')]);self.message('assistant','new visible')
  chosen=a.conversations(self.obs)[0];self.assertNotEqual(a.transcript_version(chosen)[1],version)
  page=a.history(chosen['path'],'goose',active_leaf=chosen['leaf_id']);self.assertEqual([m['text']for m in page['messages']],['hello','reply','new visible']);self.assertEqual(page['messages'][0]['input_hash'],a.input_hash('hello'))
  log=a.goose_log(chosen);self.assertEqual(log['size'],chosen['leaf_id']['latest']+1)
  self.message('user','sent after baseline');new=a.conversations(self.obs)[0];self.assertGreaterEqual(int(a.history(new['path'],'goose',active_leaf=new['leaf_id'])['messages'][-1]['id']),log['size'])
 def test_history_is_bounded_and_pages_by_row_id(self):
  for i in range(120):self.message('assistant',str(i))
  c=a.conversations(self.obs)[0];page=a.history(c['path'],'goose',active_leaf=c['leaf_id']);self.assertEqual(len(page['messages']),100);self.assertTrue(page['limited']);older=a.history(c['path'],'goose',before=page['older_cursor'],active_leaf=c['leaf_id']);self.assertLess(int(older['messages'][-1]['id']),int(page['messages'][0]['id']))
 def test_input_boundary_requires_empty_editor_reading_stdin_not_just_output(self):
  (self.base/'syscall').write_text('0 0x0 0x123 0x1 0 0 0')
  self.assertTrue(a.goose_input_available(self.obs));self.obs['cursor']=[3,1];self.assertFalse(a.goose_input_available(self.obs));self.obs['cursor']=[2,1]
  (self.base/'syscall').write_text('0 0x3 0 0');self.assertFalse(a.goose_input_available(self.obs));(self.base/'syscall').write_text('0 0x0 0 0');self.obs['args']=['goose'];self.assertFalse(a.goose_input_available(self.obs))
 def test_unknown_activity_never_invents_provider_lifecycle_or_usage(self):
  with patch.object(a,'folder_trust',return_value=None),patch.object(a,'approval_menu',return_value=None),patch.object(a,'input_question',return_value=None):state=a.provider_activity(self.obs)
  self.assertEqual(state['state'],'unknown');self.assertIsNone(a.observed_token_metrics({},self.obs,a.conversations(self.obs)[0],'process'))
 def test_resume_plan_uses_native_session_id_and_retains_home_override(self):
  with patch.object(a,'launch_executable',return_value=('/goose','identity','/bin')):
   plan=a.restart_plan(dict(identity='original'),self.obs)
  self.assertEqual(plan['command'],['/goose','session','--resume','--session-id','20261118_1']);self.assertEqual(plan['environment']['GOOSE_PATH_ROOT'],str(self.root))
 def test_launch_literals_initial_prompt_and_new_named_association(self):
  ident=str(uuid.uuid4());request=dict(launch_id=ident,project=str(self.project),directory_identity='dir',provider='goose',executable='/goose',executable_identity='exe',initial_prompt='--literal $(do not execute)',window_name='Test')
  with patch.object(a,'launch_status',side_effect=[dict(found=False),dict(found=True)]),patch.object(a,'launch_destination',return_value=(None,None)),patch.object(a,'project_directory',return_value=(str(self.project),'dir')),patch.object(a,'launch_executable',return_value=('/goose','exe','/bin')),patch.object(a,'tmux',return_value='$1\t@1\t%1'),patch.object(a,'respawn_launch')as respawn:
   a.launch_agent(request)
  cmd=respawn.call_args.args[-1];self.assertEqual(cmd[:3],['/goose','run','--interactive']);self.assertIn('cc-'+ident,cmd);self.assertEqual(cmd[-1],'--text='+request['initial_prompt'])
 def test_missing_database_is_not_created(self):
  self.obs['env']['GOOSE_PATH_ROOT']=str(self.root/'absent');self.assertEqual(a.conversations(self.obs),[]);self.assertFalse((self.root/'absent').exists())

 def test_process_detection_excludes_servers_headless_runs_and_similar_names(self):
  for argv,expected in [(['goose','session'],'goose'),(['goose','run','--interactive','--text','info'],'goose'),(['goose','acp'],None),(['goose','run','--text','work'],None),(['goosed'],None),(['gooseberry'],None)]:
   (self.base/'comm').write_text(argv[0]);(self.base/'cmdline').write_bytes(('\0'.join(argv)+'\0').encode());self.assertEqual(a.process_kind(self.base),expected)
 def test_safe_input_revalidation_rejects_conversation_replacement(self):
  (self.base/'syscall').write_text('0 0x0 0 0');chosen=a.conversations(self.obs)[0]
  with patch.object(a,'active_message_state',return_value=None):
   self.assertEqual(a.verify_active_message(dict(conversation=chosen['id']),self.obs)['source'],'goose_input')
   with self.assertRaises(a.Failure):a.verify_active_message(dict(conversation='other'),self.obs)
   (self.base/'syscall').write_text('202 0 0')
   with self.assertRaises(a.Failure):a.verify_active_message(dict(conversation=chosen['id']),self.obs)

 def test_running_goose_ids_are_scoped_to_the_provider_database(self):
  row='$1\t@1\t%1\tgoose\t0\t{}'
  with patch.dict(os.environ,GOOSE_PATH_ROOT=str(self.root)),patch.object(a,'tmux',return_value=row),patch.object(a,'discover_agents',return_value=dict(agents=[dict(pane='%1',provider='goose')],limited=False)),patch.object(a,'observe',return_value=self.obs):
   self.assertEqual(a.active_launch_sessions({},'goose'),{'20261118_1'})
   other=dict(self.obs,env={'GOOSE_PATH_ROOT':str(self.root/'another-home')})
   with patch.object(a,'observe',return_value=other):self.assertEqual(a.active_launch_sessions({},'goose'),set())
