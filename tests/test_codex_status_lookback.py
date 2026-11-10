"""Root lifecycle anchors can be older than the recent progress tail."""
import importlib.util,json,tempfile,time,unittest,builtins
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('a',Path(__file__).parents[1]/'src/agent_remote.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class StatusLookback(unittest.TestCase):
 def setUp(self):
  t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);self.path=Path(t.name)/'session.jsonl';self.now=int(time.time())
 def event(self,kind,turn='root',stamp=None,root=None):
  p=dict(type=kind,turn_id=turn)
  if root is not None:p['root_turn_id']=root
  return dict(type='event_msg',timestamp=self.now if stamp is None else stamp,payload=p)
 def write(self,*records):self.path.write_text(''.join(json.dumps(r)+'\n' for r in records))
 def noise(self,size):return dict(type='response_item',payload=dict(type='function_call_output',output='x'*size))
 def read_status(self):
  reads=[];original=builtins.open
  class Reader:
   def __init__(self,file):self.file=file
   def __enter__(self):return self
   def __exit__(self,*args):self.file.close()
   def __getattr__(self,key):return getattr(self.file,key)
   def read(self,size=-1):reads.append(size);return self.file.read(size)
  with patch('builtins.open',side_effect=lambda *args,**kw:Reader(original(*args,**kw))):result=a.codex_activity(self.path,self.now)
  return result,reads
 def test_recent_root_progress_recovers_anchor_outside_512k_and_2m(self):
  self.write(self.event('task_started',stamp=self.now-1200),self.noise(2500*1024),self.event('item_completed'))
  with self.path.open('rb') as f:f.seek(-512*1024,2);tail=f.read().partition(b'\n')[2]
  self.assertIsNone(a.codex_tail_activity(tail,self.now))
  result,reads=self.read_status();self.assertEqual(result['state'],'working');self.assertEqual(result['evidence_at'],self.now);self.assertEqual(len(reads),3);self.assertLessEqual(max(reads),8*1024*1024);self.assertLessEqual(sum(reads),int(10.5*1024*1024))
 def test_latest_completion_stays_a_single_small_tail_read(self):
  self.write(self.noise(2*1024*1024),self.event('task_complete',root='root'))
  result,reads=self.read_status();self.assertEqual(result['state'],'ready');self.assertEqual(reads,[512*1024])
 def test_child_completion_and_progress_do_not_finish_or_refresh_parent(self):
  self.write(self.event('task_started',stamp=self.now-1200),self.noise(600*1024),self.event('task_complete',turn='child',root='root'),self.event('item_completed',turn='child'))
  self.assertEqual(a.codex_activity(self.path,self.now)['state'],'unknown')
  with self.path.open('a') as f:f.write(json.dumps(self.event('item_completed'))+'\n')
  self.assertEqual(a.codex_activity(self.path,self.now)['state'],'working')
 def test_incomplete_and_invalid_future_evidence_fail_closed(self):
  self.write(self.event('task_started'),self.noise(600*1024),self.event('item_completed'))
  with self.path.open('a') as f:f.write('{"type":"event_msg"')
  self.assertEqual(a.codex_activity(self.path,self.now)['reason'],'Provider update is incomplete')
  self.write(self.event('task_started',stamp=self.now+100),self.noise(600*1024),self.event('item_completed'))
  self.assertEqual(a.codex_activity(self.path,self.now)['reason'],'Provider event has an invalid timestamp')
 def test_missing_anchor_beyond_hard_cap_remains_unknown(self):
  self.write(self.event('task_started'),self.noise(9*1024*1024),self.event('item_completed'))
  result,reads=self.read_status();self.assertEqual(result['state'],'unknown');self.assertIn('8 MiB',result['reason']);self.assertEqual(reads,[512*1024,2*1024*1024,8*1024*1024])
if __name__=='__main__':unittest.main()
