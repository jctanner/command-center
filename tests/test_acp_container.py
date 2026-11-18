import importlib.util,json,os,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch,Mock
spec=importlib.util.spec_from_file_location('container',Path(__file__).parents[1]/'src/acp_container.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class Container(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.home=Path(self.tmp.name);self.env=patch.dict(os.environ,HOME=str(self.home));self.env.start();self.addCleanup(self.env.stop)
  config=self.home/'.config/command-center';config.mkdir(parents=True);self.root=self.home/'.cache/command-center/goose-workspaces';self.root.mkdir(parents=True);self.workspace=self.root/'test';self.workspace.mkdir();self.secret=self.home/'auth.json';self.secret.write_text(json.dumps({'enmaas':{'key':'private-test-key'}}));self.secret.chmod(0o600)
  self.profile=dict(id='goose-test',label='Test',image=c.IMAGE,model='rits/model',base_url='https://example.invalid/v1',secret_file=str(self.secret));self.registry=config/'container-profiles.json';self.write_profiles([self.profile]);self.runtime=self.home/'podman';self.runtime.write_text('fixture');self.runtime.chmod(0o700)
 def write_profiles(self,data):self.registry.write_text(json.dumps(data));self.registry.chmod(0o600)
 def options(self):
  def output(executable,args,**kw):
   if args[0]=='ps':return ''
   return json.dumps({'host':{'security':{'rootless':True}}}if args[0]=='info'else[{'Id':'a'*64}])
  with patch.object(c.shutil,'which',return_value=str(self.runtime)),patch.object(c,'command',side_effect=output):return c.options({'container_profile':'goose-test','path':str(self.workspace)})
 def test_pin_profile_workspace_and_no_host_fallback(self):
  value=self.options();self.assertEqual(value['provider'],'goose');self.assertEqual(value['mode'],'approve');self.assertNotIn('private-test-key',json.dumps(value));self.assertEqual(c.summary(self.profile)['workspace_root'],str(self.root));self.assertNotIn('secret_file',c.summary(self.profile))
  for path in [str(self.home),str(self.root),str(self.workspace/'..'/'..')]:
   with self.assertRaises(ValueError):c.options({'container_profile':'goose-test','path':path})
  self.profile['image']='goose:latest';self.write_profiles([self.profile])
  with self.assertRaises(ValueError):c.profiles()
 def test_private_registry_and_literal_model(self):
  self.registry.chmod(0o644)
  with self.assertRaises(ValueError):c.profiles()
  self.profile['model']='model; command';self.write_profiles([self.profile])
  with self.assertRaises(ValueError):c.profiles()
 def test_profile_changed_between_validation_and_secret_read_rejects_before_launch(self):
  prepared=self.options();self.profile['model']='different/model';self.write_profiles([self.profile])
  with patch.object(c,'options',return_value=prepared),patch.object(c.subprocess,'Popen')as process:
   with self.assertRaises(ValueError):c.start(prepared,{'id':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},str(self.home),'instance')
   process.assert_not_called()
 def test_failed_secret_bootstrap_closes_pipe_without_echoing_the_key(self):
  prepared=self.options();process=Mock();process.stdin.write.side_effect=BrokenPipeError('private-test-key')
  with patch.object(c,'options',return_value=prepared),patch.object(c.subprocess,'Popen',return_value=process):
   with self.assertRaisesRegex(ValueError,'credential bootstrap failed')as error:c.start(prepared,{'id':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},str(self.home),'instance')
  self.assertNotIn('private-test-key',str(error.exception));process.stdin.close.assert_called_once();process.wait.assert_called_once_with(timeout=12)
 def tearDown(self):
  for path,fd in list(c.WORKSPACE_LOCKS.items()):os.close(fd);del c.WORKSPACE_LOCKS[path]
 def test_workspace_claim_prevents_concurrent_relabel(self):
  fd=c.workspace_lock(str(self.workspace))
  try:
   with self.assertRaises(ValueError):c.workspace_lock(str(self.workspace))
  finally:os.close(fd)
 def test_existing_workspace_only_allowed_for_exact_restart_container(self):
  ident='d'*64;value={'Id':ident,'State':{'Running':True},'Mounts':[{'Source':str(self.workspace)}]}
  def output(runtime,args):return ident+'\n'if args[0]=='ps'else json.dumps([value])
  with patch.object(c,'command',side_effect=output):
   with self.assertRaises(ValueError):c.workspace_available('/runtime',str(self.workspace))
   c.workspace_available('/runtime',str(self.workspace),ident)
   with self.assertRaises(ValueError):c.workspace_available('/runtime',str(self.workspace),'e'*64)
 def test_identity_mismatch_never_stops_replacement(self):
  record=dict(id='b'*64,name='cc-goose-test',labels={'cc.acp.instance':'instance'});prepared={'executable':str(self.runtime),'container_image_id':'a'*64}
  with patch.object(c,'inspect',return_value={'Id':'b'*64,'Name':'cc-goose-test','Image':'a'*64,'Config':{'Labels':{'cc.acp.instance':'replacement'}}}),patch.object(c,'command')as stop:
   with self.assertRaises(ValueError):c.stop(prepared,record)
   stop.assert_not_called()
 def test_secret_bootstrap_uses_stdin_and_never_argv_or_runtime_env(self):
  prepared=self.options();ident='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';state='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';proc=Mock();proc.poll.return_value=None;captured={}
  def spawn(args,**kwargs):
   captured['args']=args;self.assertNotIn('private-test-key',repr(args));self.assertNotIn('env',kwargs);return proc
  def inspect_result(args,**kwargs):
   labels=dict(x.split('=',1)for i,x in enumerate(captured['args'])if i and captured['args'][i-1]=='--label');return subprocess.CompletedProcess(args,0,json.dumps([{'Id':'c'*64,'Config':{'Labels':labels}}]).encode())
  with patch.object(c,'options',return_value=prepared),patch.object(c.subprocess,'Popen',side_effect=spawn),patch.object(c.subprocess,'run',side_effect=inspect_result),patch.object(c,'verify',return_value={'Id':'c'*64}):
   process,record=c.start(prepared,{'id':ident,'container_state':state},str(self.home),'instance')
  proc.stdin.write.assert_called_once_with(b'private-test-key\n');self.assertNotIn('--env-file',captured['args']);self.assertNotIn('OPENAI_API_KEY=private-test-key',repr(captured['args']));self.assertEqual(record['volume'],'cc-goose-state-'+state);self.assertNotIn('private-test-key',(self.home/'container.json').read_text());self.assertIn('--pull=never',captured['args']);self.assertIn('--userns=keep-id:uid=1000,gid=1000',captured['args']);self.assertIn('GOOSE_MODE=approve',captured['args']);self.assertNotIn('goose',captured['args'][:1])
if __name__=='__main__':unittest.main()
