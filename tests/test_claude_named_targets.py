"""Claude named tmux registry targets: fixture processes/sockets, never live input."""
import importlib.util,json,os,subprocess,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py');agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)
class NamedTargets(unittest.TestCase):
 def test_numeric_and_existing_viewer_spelling_require_no_lookup(self):
  with patch.object(agent,'tmux',side_effect=AssertionError('Unexpected lookup')):
   for recorded in ['$1:@2.%3','1:@2.%3','cc-view-'+'a'*32+':@2.%3']:self.assertTrue(agent.claude_tmux_matches(recorded,'$1:@2.%3'))
   for recorded in ['fixture:@2.%4','fixture:@3.%3','fixture:\n@2.%3','fixture\n:@2.%3','fixture:extra:@2.%3']:self.assertFalse(agent.claude_tmux_matches(recorded,'$1:@2.%3'))
 def test_literal_exact_name_and_observed_socket_and_membership(self):
  with patch.object(agent,'tmux',return_value='$1:@2.%3\n')as tmux:
   self.assertTrue(agent.claude_tmux_matches('fixture $(literal):@2.%3','$1:@2.%3','/fixture/socket'))
   tmux.assert_called_once_with({'socket':'/fixture/socket'},'list-panes','-s','-t','=fixture $(literal):','-F','#{session_id}:#{window_id}.#{pane_id}')
  for members in ['$9:@2.%3\n','$1:@9.%3\n','$1:@2.%9\n','',('x'*262145)+'\n$1:@2.%3']:
   with patch.object(agent,'tmux',return_value=members):self.assertFalse(agent.claude_tmux_matches('fixture:@2.%3','$1:@2.%3'))
  with patch.object(agent,'tmux',side_effect=agent.Failure(409,'gone')):self.assertFalse(agent.claude_tmux_matches('fixture:@2.%3','$1:@2.%3'))
 def test_native_status_still_requires_pid_start_cwd_domain_and_session(self):
  with tempfile.TemporaryDirectory(prefix='cc-named-status-')as directory:
   root=Path(directory);home=root/'claude';(home/'sessions').mkdir(parents=True);pid=os.getpid();base,start,_=agent.proc(pid);now=int(time.time()*1000)
   record=dict(pid=pid,procStart=start,sessionId='11111111-1111-4111-8111-111111111111',cwd=str(root),tmux='fixture:@2.%3',startedAt=now-1000,status='idle',statusUpdatedAt=now,updatedAt=now)
   path=home/'sessions'/f'{pid}.json';observation=dict(kind='claude',base=base,identity='verified',target='$1:@2.%3',socket='/fixture/socket',cwd=str(root),env={'CLAUDE_CONFIG_DIR':str(home)})
   with patch.object(agent,'tmux',return_value='$1:@2.%3\n'):
    path.write_text(json.dumps(record));self.assertEqual(agent.provider_activity(observation)['state'],'ready')
    for changes in [dict(pid=pid+1),dict(procStart='0'),dict(cwd='/another/project'),dict(pidDomain='wrong'),dict(sessionId='invalid')]:
     path.write_text(json.dumps({**record,**changes}));self.assertEqual(agent.provider_activity(observation)['state'],'unknown',changes)
   path.write_text(json.dumps(record))
   with patch.object(agent,'tmux',return_value='$9:@2.%3\n'):self.assertEqual(agent.provider_activity(observation)['state'],'unknown')
 def test_real_named_session_rename_socket_and_link_identity(self):
  with tempfile.TemporaryDirectory(prefix='cc-named-tmux-')as directory:
   socket=str(Path(directory)/'tmux.sock');other=str(Path(directory)/'other.sock')
   def tmux(*args):return subprocess.check_output(['tmux','-S',socket,*args],text=True).strip()
   try:
    tmux('-f','/dev/null','new-session','-d','-s','fixture original','-x','80','-y','24','sleep','300')
    target=tmux('display-message','-p','-t','=fixture original:','#{session_id}:#{window_id}.#{pane_id}');suffix=target.split(':',1)[1]
    self.assertTrue(agent.claude_tmux_matches('fixture original:'+suffix,target,socket));self.assertFalse(agent.claude_tmux_matches('fixture original:'+suffix,target,other))
    tmux('rename-session','-t','=fixture original:','fixture renamed')
    self.assertFalse(agent.claude_tmux_matches('fixture original:'+suffix,target,socket));self.assertTrue(agent.claude_tmux_matches('fixture renamed:'+suffix,target,socket))
    tmux('new-session','-d','-s','fixture other','sleep','300');self.assertFalse(agent.claude_tmux_matches('fixture other:'+suffix,target,socket))
   finally:subprocess.run(['tmux','-S',socket,'kill-server'],capture_output=True)
if __name__=='__main__':unittest.main()
