"""Read-only Jira adapter contracts; no network or real credentials."""
import json,subprocess,sys,shutil,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def issue(key='WORK-1',**fields):return dict(key=key,id='1',self='PRIVATE_JIRA_TOKEN',fields=dict(summary='Fixture issue <img src=x>',status={'name':'Open','statusCategory':{'key':'new'}},assignee={'displayName':'Fixture user','emailAddress':'PRIVATE_PROFILE_EMAIL'},project={'key':'WORK','name':'Work'},**fields))
class JiraBridge(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.project=Path(self.temp.name)/"source ' café";shutil.copytree(ROOT/'tests/fixtures/jira-source',self.project);(self.project/'.venv/bin').mkdir(parents=True);(self.project/'.venv/bin/python').symlink_to(sys.executable)
  self.fixture={'issues':[issue()], 'older':[issue('WORK-2')],'cursor':'next-token'};self.write()
 def write(self):(self.project/'fixture.json').write_text(json.dumps(self.fixture))
 def bridge(self,**request):
  r=subprocess.run([sys.executable,'-B','-c',(ROOT/'src/jira_bootstrap.py').read_text()],input=json.dumps(dict(project=str(self.project),code=(ROOT/'src/jira_remote.py').read_text(),request=request)),text=True,capture_output=True,timeout=20)
  self.assertEqual(r.returncode,0);self.assertNotIn('PRIVATE_JIRA_TOKEN',r.stdout+r.stderr);self.assertNotIn('PRIVATE_PROFILE_EMAIL',r.stdout+r.stderr);return json.loads(r.stdout)
 def calls(self):
  p=self.project/'calls.jsonl';return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []
 def test_cloud_search_preserves_literal_jql_fields_and_page_token(self):
  query='assignee = currentUser() AND text ~ "$(literal)" ORDER BY updated DESC'
  result=self.bridge(operation='search',query=query)['ok'];self.assertEqual(result['issues'][0]['key'],'WORK-1');self.assertEqual(result['next_cursor'],'next-token')
  search=self.calls()[-1];self.assertEqual(search['method'],'POST');self.assertEqual(search['path'],'/rest/api/2/search/jql');self.assertEqual(search['params']['jql'],query);self.assertEqual(search['params']['maxResults'],30);self.assertNotIn('*all',search['params']['fields']);self.assertFalse(search['redirects']);self.assertEqual(search['timeout'],5)
  page=self.bridge(operation='search',query=query,cursor='next-token')['ok'];self.assertEqual(page['issues'][0]['key'],'WORK-2');self.assertEqual(self.calls()[-1]['params']['nextPageToken'],'next-token')
 def test_dc_search_uses_bounded_offsets(self):
  self.fixture['cloud']=False;self.fixture['total']=90;self.write();page=self.bridge(operation='search',query='project = WORK',cursor='30')['ok'];self.assertEqual(self.calls()[-1]['params']['startAt'],30);self.assertEqual(page['next_cursor'],'31');self.assertEqual(page['total'],90)
 def test_issue_adf_comments_attachments_are_safe_bounded_and_read_only(self):
  self.fixture['issue']=issue(description={'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'Plain description <script>unsafe</script>'}]}]},comment={'comments':[{'id':'c1','author':{'displayName':'Alice','emailAddress':'PRIVATE_PROFILE_EMAIL'},'body':{'type':'doc','content':[{'type':'paragraph','content':[{'type':'text','text':'Visible comment'}]}]}}],'total':2,'startAt':0},attachment=[{'filename':'note.txt','size':12,'content':'PRIVATE_JIRA_TOKEN'}]);self.fixture['comments']=[{'id':'c2','body':'Second comment'}];self.fixture['comment_total']=2;self.write()
  result=self.bridge(operation='issue',key='WORK-1')['ok']['issue'];self.assertIn('Plain description',result['description']);self.assertEqual(result['comments'][0]['body'],'Visible comment');self.assertEqual(result['comment_cursor'],'1');self.assertEqual(result['attachments'],[{'filename':'note.txt','size':12}]);self.assertTrue(all(c['method']=='GET' for c in self.calls()))
  more=self.bridge(operation='comments',key='WORK-1',cursor='1')['ok'];self.assertEqual(more['comments'][0]['id'],'c2');self.assertEqual(more['next_cursor'],'')
 def test_mutations_invalid_keys_and_unbounded_input_fail_before_auth(self):
  for request in [dict(operation='update'),dict(operation='issue',key='../secret'),dict(operation='issue',key=42),dict(operation='search',query='x'*4001),dict(operation='search',query='bad\0'),dict(operation='search',query=''),dict(operation='search',query='ok',cursor='bad\n')]:self.assertEqual(self.bridge(**request)['status'],400)
  self.assertEqual(self.calls(),[])
 def test_client_scope_blocks_writes_and_foreign_origins(self):
  for flag in ['try_write','try_foreign']:
   self.fixture[flag]=True;self.write();self.assertEqual(self.bridge(operation='search',query='project = WORK')['status'],403);self.fixture[flag]=False
  self.assertTrue(all(c['method']=='GET' and c['path']=='/rest/api/2/myself' for c in self.calls()))
 def test_disabled_credentials_and_errors_are_sanitized(self):
  self.fixture['enabled']=False;self.write();self.assertEqual(self.bridge(operation='search',query='x')['status'],403);self.assertEqual(self.calls(),[])
  self.fixture.update(enabled=True,allow_read=False);self.write();self.assertEqual(self.bridge(operation='search',query='x')['status'],403);self.assertEqual(self.calls(),[])
  self.fixture['allow_read']=True
  self.fixture.update(enabled=True,credentials=False);self.write();self.assertEqual(self.bridge(operation='search',query='x')['status'],503)
  self.fixture['credentials']=True
  for status in [400,401,403,404,429]:self.fixture['error']=status;self.write();self.assertEqual(self.bridge(operation='search',query='x')['status'],status)
 def test_large_unicode_content_stays_inside_response_budget(self):
  self.fixture['issue']=issue(description='🌍'*50000,comment={'comments':[{'id':str(i),'body':'🌍'*10000} for i in range(30)],'total':30});self.write();response=self.bridge(operation='issue',key='WORK-1');self.assertIn('ok',response);self.assertLess(len(json.dumps(response,ensure_ascii=False).encode()),1000000);self.assertTrue(response['ok']['issue']['description_truncated'])
if __name__=='__main__':unittest.main()
