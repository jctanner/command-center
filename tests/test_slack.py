"""Read-only bridge contracts with a fake source. No Slack/network access."""
import importlib.util,json,os,shutil,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).parents[1]
BOOTSTRAP=(ROOT/'src/slack_bootstrap.py').read_text();CODE=(ROOT/'src/slack_remote.py').read_text()
class SlackBridge(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='cc-slack-');self.addCleanup(self.tmp.cleanup);self.project=Path(self.tmp.name)/"source ' literal";shutil.copytree(ROOT/'tests/fixtures/slack-source',self.project);(self.project/'.venv/bin').mkdir(parents=True);(self.project/'.venv/bin/python').symlink_to(sys.executable)
  self.fixture={'channels':[{'id':'C000001','name':'engineering'}],'messages':[{'ts':'1700000000.000001','user':'U000001','text':'Hello <@U000002>','reply_count':2,'token':'FAKE_AUTH_SECRET','files':[{'url_private':'FAKE_COOKIE_SECRET'}]}],'matches':[{'ts':'1700000001.000001','text':'Match','user':'U000001','channel':{'id':'C000001','name':'engineering'},'permalink':'https://fixture.slack.com/?thread_ts=1700000000.000001'}]};self.write()
 def write(self): (self.project/'fixture.json').write_text(json.dumps(self.fixture))
 def run_bridge(self,**request):
  r=subprocess.run([sys.executable,'-B','-c',BOOTSTRAP],input=json.dumps({'project':str(self.project),'code':CODE,'request':request}),text=True,capture_output=True,timeout=20)
  self.assertEqual(r.returncode,0);self.assertNotIn('FAKE_AUTH_SECRET',r.stdout+r.stderr);self.assertNotIn('FAKE_COOKIE_SECRET',r.stdout+r.stderr);return json.loads(r.stdout)
 def calls(self):
  path=self.project/'calls.jsonl';return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
 def test_history_whitelists_fields_resolves_cached_names_and_does_not_fetch_attachments(self):
  data=self.run_bridge(operation='history',channel='C000001')['ok'];message=data['messages'][0];self.assertEqual(message['author'],'alice');self.assertEqual(message['text'],'Hello @bob');self.assertEqual(message['attachments'],1);self.assertNotIn('files',message);self.assertNotIn('token',message)
  self.assertEqual([c['endpoint'] for c in self.calls()],['auth.test','conversations.history']);self.assertTrue(all(c['method']=='GET' for c in self.calls()))
 def test_unknown_operations_and_invalid_targets_are_rejected_before_auth(self):
  for request in [dict(operation='chat.postMessage'),dict(operation='history',channel='../../secret'),dict(operation='thread',channel='C000001',ts='bad'),dict(operation='search',query='x'*1001)]:self.assertEqual(self.run_bridge(**request)['status'],400)
  self.assertEqual(self.calls(),[])
 def test_enterprise_membership_uses_counts_not_all_boot_channels(self):
  self.fixture.update(enterprise=True,unjoined_channels=[{'id':'C000099','name':'not-joined'}]);self.write();data=self.run_bridge(operation='channels')['ok'];self.assertEqual(data['discovery'],'joined');self.assertFalse(data['limited']);self.assertEqual([c['id'] for c in data['channels']],['C000001']);self.assertEqual([c['endpoint'] for c in self.calls()],['auth.test','users.conversations','client.counts','client.userBoot']);self.assertNotIn('prefs',data)
 def test_missing_joined_metadata_is_labelled_and_never_search_discovered(self):
  self.fixture.update(enterprise=True,joined_channels=[{'id':'C000001'},{'id':'C000099'}]);self.write();data=self.run_bridge(operation='channels')['ok'];self.assertTrue(data['limited']);self.assertEqual(data['unresolved'],1);self.assertEqual(len(data['channels']),1);self.assertNotIn('search.messages',[c['endpoint'] for c in self.calls()])
 def test_channel_latest_metadata_is_validated_without_leaking_read_state(self):
  self.fixture.update(enterprise=True,latest={'C000001':{'ts':'1700000100.000002'}});self.write();data=self.run_bridge(operation='channels')['ok'];self.assertEqual(data['channels'][0]['latest'],'1700000100.000002');self.assertNotIn('last_read',data['channels'][0])
  self.fixture['latest']={'C000001':'invalid'};self.write();self.assertNotIn('latest',self.run_bridge(operation='channels')['ok']['channels'][0])
 def test_auth_rate_limits_survive_source_constructor_wrapping(self):
  self.fixture['rate_auth']=True;self.write();data=self.run_bridge(operation='status');self.assertEqual(data['status'],429);self.assertEqual(data['retry_after'],1)
 def test_search_preserves_native_thread_timestamp(self):
  data=self.run_bridge(operation='search',query='test')['ok'];self.assertEqual(data['messages'][0]['thread_ts'],'1700000000.000001')
 def test_disabled_source_and_message_budgets(self):
  self.fixture['enabled']=False;self.write();self.assertEqual(self.run_bridge(operation='status')['status'],403);self.assertEqual(self.calls(),[])
  self.fixture['enabled']=True;self.fixture['messages']=[{'ts':f'1700000000.{n:06d}','text':'x'*9000,'user':'U000001'} for n in range(50)];self.write();data=self.run_bridge(operation='history',channel='C000001')['ok'];self.assertLessEqual(sum(len(m['text']) for m in data['messages']),100000);self.assertTrue(data['messages'][0]['truncated'])

 def test_explicit_send_is_single_post_bound_to_thread_without_joining(self):
  request=dict(operation='send',channel='C000001',thread_ts='1700000000.000001',text='Fixture reply',id='12345678-1234-4234-8234-123456789abc')
  result=self.run_bridge(**request)['ok'];self.assertEqual(result['delivery'],'sent');self.assertEqual(result['thread_ts'],request['thread_ts']);calls=self.calls();self.assertEqual([c['endpoint'] for c in calls],['auth.test','chat.postMessage']);self.assertEqual(calls[-1]['payload']['client_msg_id'],request['id']);self.assertFalse(calls[-1]['payload']['unfurl_media']);self.assertNotIn('message',result)
 def test_send_permissions_and_uncertainty_fail_closed(self):
  request=dict(operation='send',channel='C000001',text='Fixture',id='12345678-1234-4234-8234-123456789abc')
  self.fixture['allow_write']=False;self.write();self.assertEqual(self.run_bridge(**request)['delivery'],'not_sent');self.assertEqual(self.calls(),[])
  self.fixture.update(allow_write=True,post_uncertain=True);self.write();self.assertEqual(self.run_bridge(**request)['delivery'],'uncertain');self.assertEqual(sum(c['endpoint']=='chat.postMessage' for c in self.calls()),1)
 def test_invalid_send_is_rejected_before_auth(self):
  for patch in [dict(text=''),dict(text='x'*4001),dict(id='bad'),dict(thread_ts='bad')]:
   request=dict(operation='send',channel='C000001',text='Fixture',id='12345678-1234-4234-8234-123456789abc');request.update(patch);self.assertEqual(self.run_bridge(**request)['status'],400)
  self.assertEqual(self.calls(),[])

 def test_thread_latest_reply_is_validated_and_read_only(self):
  self.fixture['replies']=[{'ts':'1700000000.000001','text':'Root','latest_reply':'1700000500.000001'}];self.write();data=self.run_bridge(operation='thread',channel='C000001',ts='1700000000.000001')['ok'];self.assertEqual(data['messages'][0]['latest_reply'],'1700000500.000001');self.assertTrue(all(c['method']=='GET' for c in self.calls()))
  self.fixture['replies'][0]['latest_reply']='invalid';self.write();self.assertNotIn('latest_reply',self.run_bridge(operation='thread',channel='C000001',ts='1700000000.000001')['ok']['messages'][0])

 def test_dm_directory_uses_membership_and_bounded_name_resolution(self):
  self.fixture.update(enterprise=True,dms=[{'id':'D000001','user':'U000003','is_im':True}],dm_latest={'D000001':'1700000400.000001'},user_names={'U000003':'Charlie'},unlisted_dms=[{'id':'D000099','user':'U000002','is_im':True}]);self.write();data=self.run_bridge(operation='dms')['ok'];self.assertEqual(len(data['channels']),1);dm=data['channels'][0];self.assertEqual(dm['name'],'Charlie');self.assertEqual(dm['kind'],'dm');self.assertEqual(dm['latest'],'1700000400.000001');self.assertNotIn('email',dm);self.assertTrue(all(c['method']=='GET' for c in self.calls()));self.assertEqual(sum(c['endpoint']=='users.info' for c in self.calls()),1)
 def test_dm_names_are_bounded_and_permission_failures_use_user_ids(self):
  self.fixture.update(dms=[{'id':f'D{n:06d}','user':f'U{n+100:06d}','is_im':True} for n in range(20)],name_error='missing_scope');self.write();data=self.run_bridge(operation='dms')['ok'];self.assertEqual(data['names_limited'],20);self.assertEqual(sum(c['endpoint']=='users.info' for c in self.calls()),8)
 def test_dm_posting_is_rejected_before_auth(self):
  data=self.run_bridge(operation='send',channel='D000001',text='Never send',id='12345678-1234-4234-8234-123456789abc');self.assertEqual(data['status'],403);self.assertEqual(self.calls(),[])
