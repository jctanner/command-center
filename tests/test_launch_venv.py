"""Literal venv validation and exact launch/restart guards, no live agents."""
import importlib.util,os,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class Venv(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='cc-venv-');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.venv=self.root/'venv ; literal';subprocess.run(['/usr/bin/python3','-m','venv','--without-pip',str(self.venv)],check=True)
 def test_literal_relative_path_supplies_real_python_environment(self):
  path,identity=a.python_venv(str(self.root),self.venv.name);self.assertEqual(path,str(self.venv));self.assertTrue(identity)
  env=dict(os.environ,PATH=str(self.venv/'bin')+':/usr/bin:/bin',VIRTUAL_ENV=path)
  actual=subprocess.check_output(['python','-c','import sys;print(sys.prefix)'],env=env,text=True).strip();self.assertEqual(actual,path)
  self.assertEqual(a.python_venv(str(self.root),''),(None,None))
 def test_invalid_or_missing_environments_fail(self):
  for value in ['missing','\nvenv',123,str(self.root)]:
   with self.assertRaises(a.Failure):a.python_venv(str(self.root),value)
  (self.venv/'pyvenv.cfg').unlink()
  with self.assertRaises(a.Failure):a.python_venv(str(self.root),str(self.venv))
 def test_changed_venv_rejects_start_before_tmux_creation(self):
  path,identity=a.python_venv(str(self.root),str(self.venv));request=dict(launch_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',project=str(self.root),directory_identity='dir',provider='pi',executable='/pi',executable_identity='exe',python_venv=path,venv_identity=identity)
  (self.venv/'pyvenv.cfg').write_text('changed')
  with patch.object(a,'launch_status',return_value={'found':False}),patch.object(a,'launch_destination',return_value=(None,None)),patch.object(a,'project_directory',return_value=(str(self.root),'dir')),patch.object(a,'launch_executable',return_value=('/pi','exe','/bin')),patch.object(a,'tmux') as tmux:
   with self.assertRaises(a.Failure):a.launch_agent(request)
   tmux.assert_not_called()
 def test_restart_preserves_observed_venv_and_rechecks_before_respawn(self):
  log=self.root/'session.jsonl';log.write_text('{}\n');obs=dict(identity='process',kind='pi',cwd=str(self.root),env={'VIRTUAL_ENV':str(self.venv)},args=[],target='$0:@0.%0');request=dict(identity='process',restart_id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');candidate=dict(id='log',session='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',path=str(log),linked=True)
  with patch.object(a,'conversations',return_value=[candidate]),patch.object(a,'launch_executable',return_value=('/pi','exe','/bin')):
   plan=a.restart_plan(request,obs);self.assertEqual(plan['environment']['VIRTUAL_ENV'],str(self.venv));self.assertTrue(plan['environment']['PATH'].startswith(str(self.venv/'bin')+':'))
   (self.venv/'pyvenv.cfg').write_text('replacement')
   with patch.object(a,'tmux') as tmux:
    with self.assertRaises(a.Failure):a.restart_agent(dict(request,plan=plan),obs)
    tmux.assert_not_called()
if __name__=='__main__':unittest.main()
