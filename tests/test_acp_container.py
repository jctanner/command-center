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
   args=[v for v in args if v!='--remote=false']
   if args[0]=='ps':return ''
   return json.dumps({'host':{'security':{'rootless':True}}}if args[0]=='info'else[{'Id':'a'*64}])
  with patch.object(c.shutil,'which',return_value=str(self.runtime)),patch.object(c,'command',side_effect=output):return c.options({'container_profile':'goose-test','path':str(self.workspace)})
 def test_pin_profile_workspace_and_no_host_fallback(self):
  value=self.options();self.assertEqual(value['provider'],'goose');self.assertEqual(value['mode'],'approve');self.assertNotIn('private-test-key',json.dumps(value));self.assertEqual(c.summary(self.profile)['workspace_root'],str(self.root));self.assertNotIn('secret_file',c.summary(self.profile))
  for path in [str(self.home),str(self.root),str(self.workspace/'..'/'..')]:
   with self.assertRaises(ValueError):c.options({'container_profile':'goose-test','path':path})
  self.profile['image']='goose;bad';self.write_profiles([self.profile])
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
   captured['args']=args;self.assertNotIn('private-test-key',repr(args));self.assertNotIn('private-test-key',repr(kwargs.get('env',{})));return proc
  def inspect_result(args,**kwargs):
   labels=dict(x.split('=',1)for i,x in enumerate(captured['args'])if i and captured['args'][i-1]=='--label');return subprocess.CompletedProcess(args,0,json.dumps([{'Id':'c'*64,'Config':{'Labels':labels}}]).encode())
  with patch.object(c,'options',return_value=prepared),patch.object(c.subprocess,'Popen',side_effect=spawn),patch.object(c.subprocess,'run',side_effect=inspect_result),patch.object(c,'verify',return_value={'Id':'c'*64}):
   process,record=c.start(prepared,{'id':ident,'container_state':state},str(self.home),'instance')
  proc.stdin.write.assert_called_once_with(b'private-test-key\n');self.assertNotIn('--env-file',captured['args']);self.assertNotIn('OPENAI_API_KEY=private-test-key',repr(captured['args']));self.assertEqual(record['volume'],'cc-goose-state-'+state);self.assertNotIn('private-test-key',(self.home/'container.json').read_text());self.assertIn('--pull=never',captured['args']);self.assertIn('--userns=keep-id:uid=1000,gid=1000',captured['args']);self.assertIn('GOOSE_MODE=approve',captured['args']);self.assertNotIn('goose',captured['args'][:1])
class ConfigurableProfiles(unittest.TestCase):
 setUp=Container.setUp;tearDown=Container.tearDown;write_profiles=Container.write_profiles;options=Container.options
 def prepare(self,request=None):
  def output(executable,args,**kw):
   if args[:2]==['context','inspect']:return json.dumps([{'Endpoints':{'docker':{'Host':'unix:///tmp/docker.sock'}}}])
   args=[x for x in args if x!='--remote=false']
   if args and args[0]=='--host':args=args[2:]
   if args[0]=='ps':return ''
   if args[0]=='info':return json.dumps({'ID':'docker-daemon','SecurityOptions':[],'host':{'security':{'rootless':True}},'store':{'graphRoot':'/store'}})
   if args[0]=='image':return json.dumps([{'Id':'a'*64}])
   raise AssertionError(args)
  with patch.object(c.shutil,'which',return_value=str(self.runtime)),patch.object(c,'command',side_effect=output):return c.options(dict(path=str(self.workspace),container_profile='goose-test',**(request or{})))
 def test_revision_checked_settings_preserve_legacy_and_never_execute_runtime(self):
  old=self.registry.read_bytes();snapshot=c.profile_settings();copy=json.loads(json.dumps(snapshot['profiles'][0]));copy['id']='new-profile';copy['label']='Another'
  with patch.object(c,'command')as command:
   result=c.save_profiles({'revision':snapshot['revision'],'profiles':[snapshot['profiles'][0],copy]});command.assert_not_called()
  self.assertEqual(json.loads(self.registry.read_text())[0],self.profile);self.assertNotEqual(snapshot['revision'],result['revision']);self.assertEqual(self.registry.stat().st_mode&0o777,0o600)
  before=self.registry.read_bytes()
  with self.assertRaises(ValueError):c.save_profiles({'revision':snapshot['revision'],'profiles':[]})
  self.assertEqual(before,self.registry.read_bytes());self.assertNotIn('private-test-key',json.dumps(result))
 def test_saved_configuration_survives_profile_edit_or_delete(self):
  prepared=self.prepare({'container_overrides':{'args':['acp','literal $(do-not-run)'],'cpus':1.5}});self.write_profiles([])
  with patch.object(c,'options',wraps=c.options):
   # Invoke the same bound runtime fixture with retained config, independent of registry.
   request=dict(prepared,container_retained=True)
   def output(executable,args,**kw):
    if 'info'in args:return json.dumps({'host':{'security':{'rootless':True}},'store':{'graphRoot':'/store'}})
    if 'ps'in args:return ''
    return json.dumps([{'Id':'a'*64}])
   with patch.object(c.shutil,'which',return_value=str(self.runtime)),patch.object(c,'command',side_effect=output):value=c.resume_options(prepared,'b'*64)
  self.assertEqual(value['container_config'],prepared['container_config']);self.assertTrue(value['container_retained']);self.assertEqual(value['container_image_id'],'a'*64)
 def test_docker_prefix_image_id_and_literal_args(self):
  prepared=self.prepare({'container_overrides':{'engine':'docker','user_namespace':'default','image':'example/goose:latest','args':['acp','--privileged','literal $(nothing)'],'network':'none','cpus':2,'memory_mb':512,'pids_limit':128}})
  args,record=c.run_arguments(prepared,{'id':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},'instance')
  self.assertEqual(args[1:3],['--host','unix:///tmp/docker.sock']);self.assertIn('a'*64,args);self.assertNotIn('example/goose:latest',args);self.assertEqual(args[-3:],['acp','--privileged','literal $(nothing)']);self.assertGreater(args.index('--privileged'),args.index('a'*64));self.assertIn('512m',args);self.assertEqual(record['engine'],'docker')
 def test_real_project_no_relabel_and_mount_identity(self):
  project=self.home/'project';project.mkdir();request={'container_overrides':{'workspace_policy':'project','mounts':[{'source':str(project),'target':'/repo','read_only':True,'selinux':'none'}]}}
  p=self.prepare(request);self.assertEqual(p['container_mounts'][0]['identity'],[project.stat().st_dev,project.stat().st_ino]);args,_=c.run_arguments(p,{'id':'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'},'instance');self.assertIn('type=bind,source='+str(project)+',target=/repo,readonly',args)
  request['container_overrides']['mounts'][0]['selinux']='private'
  with self.assertRaises(ValueError):self.prepare(request)
 def test_reject_runtime_flags_sensitive_plaintext_and_invalid_mounts(self):
  p=c.normalize_profile(self.profile)
  for override in ({'privileged':True},{'environment':{'OPENAI_API_KEY':'not-allowed'}},{'mounts':[{'source':'/tmp/a,b','target':'/repo','read_only':False,'selinux':'none'}]},{'engine':'docker','user_namespace':'keep-id'},{'pids_limit':-1}):
   with self.assertRaises(ValueError):c.normalize_profile(dict(p,**override))
  with self.assertRaises(ValueError):self.prepare({'container_overrides':{'id':'different'}})
 def test_local_engine_only_and_missing_engine_never_falls_back(self):
  with patch.dict(os.environ,DOCKER_HOST='tcp://remote.invalid:2375'),patch.object(c,'command')as command:
   with self.assertRaises(ValueError):c.runtime_scope('docker','/runtime')
   command.assert_not_called()
  p=c.normalize_profile(self.profile);p.update(engine='docker',user_namespace='default');self.write_profiles([p])
  with patch.object(c.shutil,'which',return_value=None):
   with self.assertRaisesRegex(ValueError,'Docker is unavailable'):c.options({'path':str(self.workspace),'container_profile':'goose-test'})
 def test_multisecret_json_pointer_and_bootstrap_preserves_literal_values(self):
  data=self.home/'other.json';data.write_text(json.dumps({'nested':{'a/b':'another-key'}}));data.chmod(0o600);p=c.normalize_profile(self.profile);p['secret_refs'].append({'name':'SECOND_TOKEN','path':str(data),'json_pointer':'/nested/a~1b'});payload,names=c.secret_payload(p);self.assertEqual(payload,b'private-test-key\nanother-key\n');self.assertEqual(names,['OPENAI_API_KEY','SECOND_TOKEN'])
 def test_legacy_profile_edit_requires_upgrade_but_duplicate_is_allowed(self):
  snapshot=c.profile_settings();changed=json.loads(json.dumps(snapshot['profiles']));changed[0]['label']='Changed'
  with patch.object(c,'legacy_profiles_in_use',return_value={'goose-test'}):
   with self.assertRaisesRegex(ValueError,'legacy Goose'):c.save_profiles({'revision':snapshot['revision'],'profiles':changed})
   clone=json.loads(json.dumps(changed[0]));clone['id']='clone';result=c.save_profiles({'revision':snapshot['revision'],'profiles':[snapshot['profiles'][0],clone]});self.assertEqual(len(result['profiles']),2)

if __name__=='__main__':unittest.main()

class RegistrySnapshot(unittest.TestCase):
 setUp=Container.setUp;tearDown=Container.tearDown;write_profiles=Container.write_profiles;options=Container.options
 def test_revision_hashes_the_same_bytes_as_the_returned_profiles(self):
  import hashlib
  original=self.registry.read_bytes();reader=c.private_file
  def race(*args,**kwargs):
   value=reader(*args,**kwargs)
   self.profile['label']='Concurrent edit';self.write_profiles([self.profile])
   return value
  with patch.object(c,'private_file',side_effect=race):snapshot=c.profile_settings()
  self.assertEqual(snapshot['revision'],hashlib.sha256(original).hexdigest())
  self.assertEqual(snapshot['profiles'][0]['label'],'Test')
 def test_dangling_registry_symlink_is_not_an_empty_registry(self):
  self.registry.unlink();self.registry.symlink_to(self.home/'absent')
  with self.assertRaises(ValueError):c.profile_settings()
