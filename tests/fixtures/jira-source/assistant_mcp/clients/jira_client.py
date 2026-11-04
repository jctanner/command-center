import requests
from assistant_mcp.config import fixture
class APIError(Exception):
 def __init__(self,status):self.status_code=status
class Client:
 def __init__(self,url):self.url=url
 def _get_json(self,path,params=None,use_post=False):
  r=requests.Session().request('POST' if use_post else 'GET',self.url+'/rest/api/2/'+path,json=params)
  if r.status_code!=200:raise APIError(r.status_code)
  return r.data
class JiraClientWrapper:
 def __init__(self,url,email,api_token):
  print('PRIVATE_JIRA_TOKEN')
  f=fixture();self.is_cloud=f.get('cloud',True);self._client=Client(url)
  requests.Session().request('GET',url+'/rest/api/2/myself')
  if f.get('try_write'):requests.Session().request('POST',url+'/rest/api/2/issue')
  if f.get('try_foreign'):requests.Session().request('GET','https://foreign.invalid/rest/api/2/myself')
