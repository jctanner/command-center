"""Bounded numeric extraction fixtures only; no provider process/config changes."""
import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('usage',Path(__file__).parents[1]/'src/token_metrics_remote.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Usage(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.path=Path(self.tmp.name)/'native.jsonl'
 def write(self,*records):self.path.write_text(''.join(json.dumps(r)+'\n'for r in records))
 def collect(self,kind='claude',cursor=None,**kw):return m.collect(self.path,kind,'conversation','process','process',cursor,**kw)
 def claude(self,id='msg1',**usage):return dict(type='assistant',timestamp='2026-01-01T00:00:00Z',message=dict(id=id,model='native-model',content=[{'type':'thinking','thinking':'PRIVATE_REASONING'}],usage=usage or dict(input_tokens=5,output_tokens=10,cache_read_input_tokens=100,cache_creation_input_tokens=20)))
 def test_claude_numeric_only_and_idle_reads_do_not_rescan(self):
  self.write(self.claude());first=self.collect();self.assertEqual(first['records'][0]['usage']['total'],135);self.assertNotIn('PRIVATE_REASONING',json.dumps(first));self.assertNotIn('content',first['records'][0]);idle=self.collect(cursor=first['cursor']);self.assertEqual(idle['bytes_read'],0);self.assertEqual(idle['records'],[])
  with self.path.open('a')as f:f.write(json.dumps(self.claude('msg2'))+'\n')
  next=self.collect(cursor=idle['cursor']);self.assertFalse(next['reset']);self.assertEqual([v['id']for v in next['records']],['msg2'])
 def test_same_inode_rewrite_and_truncate_reset_cursor(self):
  self.write(self.claude());old=self.collect();self.write(self.claude('replaced'));new=self.collect(cursor=old['cursor']);self.assertTrue(new['reset']);self.assertEqual(new['records'][0]['id'],'replaced');self.path.write_text('');self.assertTrue(self.collect(cursor=new['cursor'])['reset'])
 def test_partial_record_and_large_scan_make_bounded_progress(self):
  self.write(self.claude());start=self.collect();line=json.dumps(self.claude('partial'));self.path.write_text(self.path.read_text()+line[:30]);partial=self.collect(cursor=start['cursor']);self.assertEqual(partial['records'],[])
  with self.path.open('a')as f:f.write(line[30:]+'\n')
  done=self.collect(cursor=partial['cursor']);self.assertEqual(done['records'][0]['id'],'partial')
  self.write(*[self.claude('msg'+str(i))for i in range(800)]);chunk=self.collect();self.assertFalse(chunk['complete']);seen=len(chunk['records']);last=chunk['cursor']['offset']
  while not chunk['complete']:
   chunk=self.collect(cursor=chunk['cursor']);self.assertGreater(chunk['cursor']['offset'],last);last=chunk['cursor']['offset'];seen+=len(chunk['records']);self.assertLessEqual(len(chunk['records']),256)
  self.assertEqual(seen,800)
 def test_codex_uses_latest_native_cumulative_not_sum_of_snapshots(self):
  def event(total):return dict(type='event_msg',timestamp='2026-01-01T00:00:00Z',payload=dict(type='token_count',info=dict(total_token_usage=dict(input_tokens=total,cached_input_tokens=total-5,output_tokens=10,reasoning_output_tokens=3,total_tokens=total+10),last_token_usage=dict(input_tokens=100,output_tokens=10,total_tokens=110),model_context_window=400000)))
  self.write(event(1000),event(2000));data=self.collect('codex');self.assertEqual(data['snapshot']['input'],2000);self.assertEqual(data['snapshot']['total'],2010);self.assertEqual(data['context'],dict(used=110,window=400000));self.assertEqual(self.collect('codex',data['cursor'])['bytes_read'],0)
  with self.path.open('a')as f:f.write(json.dumps(dict(type='event_msg',payload=dict(type='context_compacted')))+'\n')
  self.assertTrue(self.collect('codex',data['cursor'])['context_invalidated'])
 def test_missing_invalid_numbers_and_sidechains_are_not_guessed(self):
  self.write(dict(self.claude(),isSidechain=True),self.claude(input_tokens=True,output_tokens=-1,cache_read_input_tokens=10),self.claude('unreported',input_tokens=5))
  nodes=self.collect()['records'];self.assertEqual(len(nodes),2);self.assertIsNone(nodes[0]['usage']['input']);self.assertIsNone(nodes[0]['usage']['output']);self.assertIsNone(nodes[0]['usage']['total']);self.assertIsNone(nodes[1]['usage']['total']);self.assertIsNone(m.number(float('nan')));self.assertIsNone(m.stamp('2999-01-01T00:00:00Z'))
 def test_public_metric_contract_accepts_unknown_and_known_counts(self):
  from test_openapi import validate
  value=dict(source='codex_native_usage',provider='codex',conversation='native',instance='process',association='process',stale=False,complete=True,limited=False,session=dict(input=100,output=10,cached_input=90,cache_write=None,reasoning_output=3,total=110),input_includes_cache=True,context=dict(used=110,window=400000,reported_at='2026-01-01T00:00:00Z'),model=None,observed_at=1,note='Native reported usage')
  validate(value,{'$ref':'#/components/schemas/AgentTokenMetrics'})
  value['context']=dict(used=None,window=None,reported_at=None);value['session']={k:None for k in value['session']};validate(value,{'$ref':'#/components/schemas/AgentTokenMetrics'})
 def test_missing_and_malformed_usage_stays_unknown(self):
  for usage in (None,[],{},'bad'):
   record=self.claude();record['message']['usage']=usage;self.write(record);node=self.collect()['records'][0];self.assertIsNone(node['usage']);self.assertTrue(node['billable'])
 def test_pi_branch_metadata_and_auxiliary_usage_without_text(self):
  usage=dict(input=2,output=3,cacheRead=5,cacheWrite=0,totalTokens=10)
  self.write(dict(type='session',version=3,id='session',cwd='/project'),dict(type='message',id='a',parentId=None,message=dict(role='assistant',content='PRIVATE',usage=usage)),dict(type='compaction',id='compact',parentId='a',summary='SECRET SUMMARY',tokensBefore=500,usage=usage),dict(type='message',id='branch',parentId='a',message=dict(role='user',content='OTHER BRANCH')))
  result=self.collect('pi',leaf='branch');self.assertEqual(result['leaf'],'branch');self.assertEqual(result['records'][1]['usage']['total'],10);self.assertTrue(result['records'][2]['invalidate']);self.assertEqual(result['records'][3]['parent'],'a');self.assertNotIn('PRIVATE',json.dumps(result));self.assertNotIn('SECRET SUMMARY',json.dumps(result))
 def test_oversized_records_are_skipped_boundedly_without_losing_next_record(self):
  self.path.write_text(json.dumps({'type':'user','content':'x'*(m.LINE*2)})+'\n'+json.dumps(self.claude('after'))+'\n');chunk=self.collect();gap=chunk['gap'];found=[]
  for _ in range(10):
   found.extend(r['id']for r in chunk['records']);gap|=chunk['gap']
   if chunk['complete']:break
   chunk=self.collect(cursor=chunk['cursor'])
  self.assertTrue(gap);self.assertIn('after',found)
if __name__=='__main__':unittest.main()
