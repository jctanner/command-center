"""Foreground wrapper detection, terminal/group proof and identity stability."""
import importlib.util,hashlib,os,stat,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py')
a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class Detection(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name);self.processes={};self.kinds={}
  for pid,parent,group,kind in [(100,1,100,None),(200,100,200,None),(201,200,200,'claude')]:self.add(pid,parent,group,kind)
  (self.root/'200/task/200/children').write_text('201')
 def add(self,pid,parent,group,kind):
  base=self.root/str(pid);(base/'task'/str(pid)).mkdir(parents=True);(base/'task'/str(pid)/'children').write_text('')
  self.processes[pid]=dict(pid=pid,parent=parent,group=group,tty=99,foreground=200,start=str(pid)+'-start',base=base);self.kinds[str(base)]=kind
 def resolve(self,info=None,device=None):
  with patch.object(a,'process_info',side_effect=info or (lambda pid:dict(self.processes[pid]))),patch.object(a,'process_kind',side_effect=lambda base:self.kinds[str(base)]),patch.object(a.os,'stat',side_effect=device or (lambda path:SimpleNamespace(st_mode=stat.S_IFCHR|0o600,st_rdev=99))):
   return a.foreground_agent(100)
 def test_unique_same_terminal_foreground_child_is_detected(self):
  result=self.resolve();self.assertEqual(result[2]['pid'],201);self.assertEqual(result[3],'claude')
 def test_background_groups_other_terminals_and_redirected_stdin_are_rejected(self):
  self.processes[201]['group']=300;self.assertIsNone(self.resolve());self.processes[201]['group']=200
  self.processes[201]['tty']=88;self.assertIsNone(self.resolve());self.processes[201]['tty']=99
  self.assertIsNone(self.resolve(device=lambda path:SimpleNamespace(st_mode=stat.S_IFCHR|0o600,st_rdev=88 if '/201/' in str(path) else 99)))
 def test_ambiguous_clis_and_pid_reuse_are_rejected(self):
  self.add(202,200,200,'codex');(self.root/'200/task/200/children').write_text('201 202');self.assertIsNone(self.resolve())
  (self.root/'200/task/200/children').write_text('201');counts={}
  def info(pid):
   counts[pid]=counts.get(pid,0)+1;result=dict(self.processes[pid])
   if pid==201 and counts[pid]>1:result['start']='reused'
   return result
  self.assertIsNone(self.resolve(info=info))
 def test_known_group_leader_remains_primary_and_bounds_fail_closed(self):
  self.kinds[str(self.root/'200')]='codex';self.assertEqual(self.resolve()[2]['pid'],200)
  self.kinds[str(self.root/'200')]=None
  for pid in range(210,244):self.add(pid,200,200,None)
  (self.root/'200/task/200/children').write_text(' '.join(map(str,range(210,244))))
  with self.assertRaises(a.Failure) as error:self.resolve()
  self.assertEqual(error.exception.status,413)
 def test_direct_identity_hash_is_unchanged_and_wrappers_include_child_identity(self):
  base=self.root/'200';(base/'cmdline').write_bytes(b'claude\0');(base/'environ').write_bytes(b'');(base/'cwd').symlink_to(self.root)
  pane=dict(self.processes[100]);leader=dict(self.processes[200]);candidate=dict(leader)
  def tmux(request,*args,**kw):
   if args[0]=='list-panes':return '@1\t%1'
   if args[0]=='display-message':return '100\tclaude\t0\t0'
   return ''
  request=dict(session='$1',window='@1',pane='%1')
  with patch.object(a,'tmux',side_effect=tmux),patch.object(a,'foreground_agent',return_value=(pane,leader,candidate,'claude')):
   direct=a.observe(request)
  boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip();expected=hashlib.sha256(f'{boot}:100:100-start:200:200-start:claude'.encode()).hexdigest();self.assertEqual(direct['identity'],expected)
  child=dict(candidate,pid=201,start='201-start')
  with patch.object(a,'tmux',side_effect=tmux),patch.object(a,'foreground_agent',return_value=(pane,leader,child,'claude')):
   wrapped=a.observe(request)
  self.assertNotEqual(wrapped['identity'],expected);self.assertEqual(wrapped['kind'],'claude')
