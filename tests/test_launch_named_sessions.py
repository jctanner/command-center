import importlib.util,unittest,tempfile,subprocess
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('named_remote',Path(__file__).parents[1]/'src/agent_remote.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class NamedSessions(unittest.TestCase):
 def test_empty_server_then_exact_named_session(self):
  with tempfile.TemporaryDirectory(prefix='cc-named-') as folder:
   request={'socket':str(Path(folder)/'tmux.sock'),'target_session_name':'work'}
   try:
    self.assertEqual(a.launch_destination(request),(None,'absent:work'))
    a.tmux(request,'-f','/dev/null','new-session','-d','-s','work','sleep','300')
    session,identity=a.launch_destination(request);self.assertTrue(session.startswith('$'));self.assertNotEqual(identity,'absent:work')
   finally:subprocess.run(['tmux','-S',request['socket'],'kill-server'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 def test_invalid_names_rejected_without_transport(self):
  for name in ['',123,'../work','work:1','-work','work.name','work name','work;id','$(pwd)','a'*65,'cc-view-private','w\n']:
   with patch.object(a,'tmux') as tmux:
    with self.assertRaises(a.Failure):a.launch_destination({'target_session_name':name})
    tmux.assert_not_called()
 def test_exclusive_destinations(self):
  with self.assertRaises(a.Failure):a.launch_destination({'target_session_name':'work','target_session':'$1'})
 def test_exact_names_and_identity_changes(self):
  with patch.object(a,'tmux',return_value='$1\tworkflow\n'):
   self.assertEqual(a.launch_destination({'target_session_name':'work'}),(None,'absent:work'))
  def read(request,*args,**kwargs):
   if args[0]=='list-sessions':return '$4\twork\n'
   return '$4\t123\t999999999\t456\twork\n'
  with patch.object(a,'tmux',side_effect=read):
   session,identity=a.launch_destination({'target_session_name':'work'});self.assertEqual(session,'$4');self.assertNotEqual(identity,'absent:work')
  with patch.object(a,'launch_status',return_value={'found':False}),patch.object(a,'launch_destination',return_value=('$4',identity)),patch.object(a,'project_directory') as directory:
   with self.assertRaises(a.Failure):a.launch_agent({'launch_id':'test','target_session_name':'work','destination_identity':'absent:work'})
   directory.assert_not_called()
 def test_disappeared_existing_destination_rejects_start(self):
  with patch.object(a,'launch_status',return_value={'found':False}),patch.object(a,'launch_destination',return_value=(None,'absent:work')),patch.object(a,'project_directory') as directory:
   with self.assertRaises(a.Failure):a.launch_agent({'launch_id':'test','target_session_name':'work','target_session':'$4','destination_identity':'old-existing-identity'})
   directory.assert_not_called()
if __name__=='__main__':unittest.main()
