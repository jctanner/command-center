"""Adapter contracts with a fake MCP environment; no Google/network traffic."""
import json,subprocess,sys,shutil,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
class EmailBridge(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.project=Path(self.tmp.name)/"source ' café";shutil.copytree(ROOT/'tests/fixtures/email-source',self.project);(self.project/'.venv/bin').mkdir(parents=True);(self.project/'.venv/bin/python').symlink_to(sys.executable)
  self.msg=dict(id='abc1',thread_id='abc0',subject='Fixture',body='<img src="https://spy.invalid">',label_ids=['UNREAD'],secret='PRIVATE_AUTH_SECRET');self.fixture={'messages':[self.msg],'thread':[self.msg],'cursor':'next'};self.write()
 def write(self):(self.project/'fixture.json').write_text(json.dumps(self.fixture))
 def run_bridge(self,**request):
  p=subprocess.run([sys.executable,'-B','-c',(ROOT/'src/email_bootstrap.py').read_text()],input=json.dumps({'project':str(self.project),'code':(ROOT/'src/email_remote.py').read_text(),'request':request}),text=True,capture_output=True,timeout=20);self.assertEqual(p.returncode,0);self.assertNotIn('PRIVATE_AUTH_SECRET',p.stdout+p.stderr);return json.loads(p.stdout)
 def calls(self):
  p=self.project/'calls.jsonl';return [json.loads(l) for l in p.read_text().splitlines()] if p.exists() else []
 def test_pages_use_read_only_metadata_and_keep_page_tokens(self):
  page=self.run_bridge(operation='messages',label='INBOX')['ok'];self.assertEqual(page['next_cursor'],'next');self.assertTrue(page['messages'][0]['unread']);self.assertNotIn('body',page['messages'][0]);self.assertEqual([c['operation'] for c in self.calls()],['messages.list','messages.metadata']);self.assertEqual(self.calls()[0]['labelIds'],['INBOX'])
 def test_thread_output_whitelists_and_bounds_content(self):
  self.fixture['thread']=[dict(self.msg,id=f'{n:x}',body='x'*70000) for n in range(40)];self.write();p=self.run_bridge(operation='thread',id='abc0')['ok'];self.assertTrue(p['limited']);self.assertEqual(len(p['messages']),30);self.assertLessEqual(sum(len(m['body']) for m in p['messages']),180000);self.assertTrue(p['messages'][0]['truncated']);self.assertEqual(self.calls()[0]['operation'],'threads.get')
 def test_unicode_heavy_threads_stay_within_wire_budget(self):
  self.fixture['thread']=[dict(self.msg,id=f'{n:x}',body='🌍'*60000,subject='🌍'*1000,attachments=[{'filename':'🌍'*300,'size':'12'} for _ in range(30)]) for n in range(30)];self.write();p=self.run_bridge(operation='thread',id='abc0');self.assertIn('ok',p);self.assertLess(len(json.dumps(p,ensure_ascii=False).encode()),1000000);self.assertTrue(p['ok']['limited'])
 def test_single_part_html_becomes_text_without_remote_content(self):
  self.fixture['thread']=[dict(self.msg,payload={'mimeType':'text/html'},body='<style>hidden</style><p>Hello &amp; welcome</p><img src="https://spy.invalid"><script>bad()</script>')];self.write();p=self.run_bridge(operation='thread',id='abc0')['ok'];self.assertEqual(p['messages'][0]['body'],'Hello & welcome')
 def test_invalid_operations_and_injection_fail_before_client(self):
  for q in [dict(operation='send'),dict(operation='thread',id='../../secrets'),dict(operation='messages',query='x'*1001),dict(operation='messages',cursor='bad\n'),dict(operation='messages',label='../bad')]:self.assertEqual(self.run_bridge(**q)['status'],400)
  self.assertEqual(self.calls(),[])
 def test_disabled_auth_and_rate_errors_are_safe(self):
  self.fixture['enabled']=False;self.write();self.assertEqual(self.run_bridge(operation='labels')['status'],403);self.assertEqual(self.calls(),[])
  self.fixture.update(enabled=True,error=429);self.write();self.assertEqual(self.run_bridge(operation='labels')['status'],429)
  (self.project/'token.json').unlink();self.assertEqual(self.run_bridge(operation='labels')['status'],401)
if __name__=='__main__':unittest.main()
