"""Read-only Jira adapter inside the existing personal-assistant environment.
Credentials, raw API responses and debug logs remain on the source machine.
"""
import contextlib
import io
import json
import logging
import re
import sys
import time
from urllib.parse import urlsplit

KEY=re.compile(r'^[A-Z][A-Z0-9_]{0,63}-[0-9]{1,16}$')
FIELDS=['summary','status','priority','issuetype','assignee','reporter','project','created','updated','labels','components','duedate']
DETAIL_FIELDS=FIELDS+['description','comment','attachment','issuelinks','resolution']
class Failure(Exception):
    def __init__(self,status,code):self.status,self.code=status,code

def validate(r):
    operation=r.get('operation')
    if operation not in ('search','issue','comments'):raise Failure(400,'invalid_operation')
    if operation in ('issue','comments') and (not isinstance(r.get('key'),str) or not KEY.fullmatch(r['key'])):raise Failure(400,'invalid_issue_key')
    query=r.get('query')
    if operation=='search' and (not isinstance(query,str) or not query.strip()):raise Failure(400,'jira_invalid_query')
    if query is not None and (not isinstance(query,str) or len(query.encode())>4000 or any(ord(c)<32 and c not in '\n\t' or ord(c)==127 for c in query)):raise Failure(400,'jira_invalid_query')
    cursor=r.get('cursor') or ''
    if not isinstance(cursor,str) or len(cursor)>2048 or any(ord(c)<32 or ord(c)==127 for c in cursor):raise Failure(400,'invalid_cursor')
    return operation

def clean(value,limit=1000):return str(value or '')[:limit]
def plain(value,limit=40000):
    if isinstance(value,str):return value[:limit]
    if not isinstance(value,(dict,list)):return ''
    out=[];remaining=limit;nodes=0
    def walk(v,depth=0):
        nonlocal remaining,nodes
        if remaining<=0 or nodes>=4000 or depth>30:return
        nodes+=1
        if isinstance(v,list):
            for child in v[:1000]:walk(child,depth+1)
        elif isinstance(v,dict):
            if v.get('type')=='text' and isinstance(v.get('text'),str):text=v['text'][:remaining];out.append(text);remaining-=len(text)
            elif v.get('type')=='hardBreak':out.append('\n');remaining-=1
            else:
                walk(v.get('content'),depth+1)
                if v.get('type') in ('paragraph','heading','listItem','codeBlock','blockquote') and remaining>0:out.append('\n');remaining-=1
    walk(value);return ''.join(out).strip()[:limit]

def comment(value):
    if not isinstance(value,dict):return None
    author=value.get('author') or {};body=plain(value.get('body'),6001)
    return dict(id=clean(value.get('id'),80),author=clean(author.get('displayName') if isinstance(author,dict) else '',200),body=body[:6000],truncated=len(body)>6000,created=clean(value.get('created'),80),updated=clean(value.get('updated'),80))

def issue(value,url,detail=False):
    if not isinstance(value,dict) or not KEY.fullmatch(str(value.get('key',''))):raise Failure(502,'invalid_jira_response')
    f=value.get('fields') or {}
    if not isinstance(f,dict):raise Failure(502,'invalid_jira_response')
    def name(field,key='name',fallback=''):
        v=f.get(field);return clean(v.get(key) if isinstance(v,dict) else fallback,300)
    project=f.get('project') or {};status=f.get('status') or {};category=status.get('statusCategory') or {} if isinstance(status,dict) else {}
    result=dict(key=value['key'],summary=clean(f.get('summary'),1000),status=name('status'),status_category=clean(category.get('key') if isinstance(category,dict) else '',80),priority=name('priority'),issue_type=name('issuetype'),assignee=name('assignee','displayName','Unassigned'),reporter=name('reporter','displayName'),project_key=clean(project.get('key') if isinstance(project,dict) else '',80),project_name=clean(project.get('name') if isinstance(project,dict) else '',300),created=clean(f.get('created'),80),updated=clean(f.get('updated'),80),due_date=clean(f.get('duedate'),80),labels=[clean(v,100) for v in (f.get('labels') or [])[:30]],url=url.rstrip('/')+'/browse/'+value['key'])
    if detail:
        description=plain(f.get('description'),40001);result['description']=description[:40000];result['description_truncated']=len(description)>40000
        block=f.get('comment') or {};block=block if isinstance(block,dict) else {};values=block.get('comments') or [];values=values if isinstance(values,list) else []
        result['comments']=[c for v in values[:30] if (c:=comment(v))]
        start=max(0,int(block.get('startAt') or 0));total=max(0,int(block.get('total') or len(values)))
        result['comment_total']=total;result['comment_cursor']=str(start+len(values[:30])) if start+len(values[:30])<total else ''
        result['attachments']=[dict(filename=clean(v.get('filename'),300),size=max(0,int(v.get('size') or 0))) for v in (f.get('attachment') or [])[:30] if isinstance(v,dict)]
    return result

def scoped_client(request):
    import requests
    from assistant_mcp.config import load_config,load_env_config
    from assistant_mcp.clients.jira_client import JiraClientWrapper
    config=load_config()
    if not config.services.jira.enabled:raise Failure(403,'jira_disabled_in_source')
    permissions=getattr(getattr(config,'permissions',None),'jira',None)
    if getattr(permissions,'allow_read',True) is False:raise Failure(403,'jira_access_denied')
    env=load_env_config()
    if not env.jira_url or not env.jira_api_token:raise Failure(503,'jira_credentials_missing')
    base=env.jira_url.rstrip('/');origin=urlsplit(base)
    if origin.scheme not in ('https','http') or not origin.netloc or origin.username or origin.password or origin.query or origin.fragment:raise Failure(503,'jira_credentials_missing')
    original=requests.Session.request
    prefix=origin.path.rstrip('/')+'/rest/api/'
    def read_only(session,method,url,*args,**kwargs):
        parsed=urlsplit(url);path=parsed.path[len(prefix):] if parsed.path.startswith(prefix) else ''
        safe_origin=(parsed.scheme,parsed.netloc)==(origin.scheme,origin.netloc) and not parsed.username and not parsed.password
        read=re.fullmatch(r'[23]/(?:myself|serverInfo|field|search(?:/jql)?|issue/[A-Z][A-Z0-9_]{0,63}-[0-9]{1,16}(?:/comment)?)',path)
        search_post=request.get('operation')=='search' and method.upper()=='POST' and path in ('2/search','3/search','2/search/jql','3/search/jql')
        if not safe_origin or not read or method.upper()!='GET' and not search_post:raise Failure(403,'jira_write_blocked')
        kwargs['timeout']=5;kwargs['allow_redirects']=False
        response=original(session,method,url,*args,**kwargs)
        if response.status_code in (400,401,403,404,429):raise Failure(response.status_code,{400:'jira_invalid_query',401:'jira_authentication_required',403:'jira_access_denied',404:'jira_not_found',429:'jira_rate_limited'}[response.status_code])
        return response
    requests.Session.request=read_only
    return JiraClientWrapper(url=base,email=env.jira_email or '',api_token=env.jira_api_token),base

def run(request,wrapper,url):
    operation=validate(request);client=wrapper._client
    if operation=='search':
        params=dict(jql=request['query'],fields=FIELDS,maxResults=30)
        if wrapper.is_cloud:
            if request.get('cursor'):params['nextPageToken']=request['cursor']
            raw=client._get_json('search/jql',params=params,use_post=True)
        else:
            cursor=request.get('cursor') or '0'
            if not cursor.isdecimal() or len(cursor)>6 or int(cursor)>100000:raise Failure(400,'invalid_cursor')
            params['startAt']=int(cursor);raw=client._get_json('search',params=params,use_post=True)
        values=raw.get('issues') or []
        if not isinstance(values,list):raise Failure(502,'invalid_jira_response')
        shortened=len(values)>30;values=values[:30];result=dict(issues=[issue(v,url) for v in values],next_cursor='',limited=shortened)
        if wrapper.is_cloud:result['next_cursor']=clean(raw.get('nextPageToken'),2048) if raw.get('isLast') is not True else ''
        else:
            total=max(0,int(raw.get('total') or 0));next_offset=params['startAt']+len(values);result['total']=total
            if values and next_offset<total:result['next_cursor']=str(next_offset)
        return result
    if operation=='issue':
        raw=client._get_json('issue/'+request['key'],params=dict(fields=','.join(DETAIL_FIELDS)))
        return dict(issue=issue(raw,url,True))
    cursor=request.get('cursor') or '0'
    if not cursor.isdecimal() or len(cursor)>6 or int(cursor)>100000:raise Failure(400,'invalid_cursor')
    raw=client._get_json('issue/'+request['key']+'/comment',params=dict(startAt=int(cursor),maxResults=30))
    values=(raw.get('comments') or [])[:30];start=max(0,int(raw.get('startAt') or int(cursor)));total=max(0,int(raw.get('total') or len(values)))
    return dict(comments=[c for v in values if (c:=comment(v))],comment_total=total,next_cursor=str(start+len(values)) if values and start+len(values)<total else '')

def main():
    logging.disable(logging.CRITICAL)
    try:
        request=json.loads(sys.stdin.buffer.read(16385));validate(request)
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()):
            wrapper,url=scoped_client(request);result=run(request,wrapper,url)
        result['checked_at']=int(time.time()*1000);response={'ok':result}
    except Failure as e:response={'status':e.status,'error':e.code}
    except Exception as e:
        code={401:'jira_authentication_required',403:'jira_access_denied',404:'jira_not_found',400:'jira_invalid_query',429:'jira_rate_limited'}
        status=getattr(e,'status_code',None) or getattr(getattr(e,'response',None),'status_code',None)
        name=type(e).__name__
        if 'Authentication' in name:status=401
        elif 'Permission' in name:status=403
        elif 'NotFound' in name:status=404
        elif 'Validation' in name:status=400
        response={'status':status if status in code else 502,'error':code.get(status,'jira_source_unavailable')}
    encoded=json.dumps(response,ensure_ascii=False)
    if len(encoded.encode())>900000 and 'ok' in response:
        result=response['ok'];result['limited']=True
        detail=result.get('issue',{});detail['description']=detail.get('description','')[:10000];detail['description_truncated']=True
        for c in detail.get('comments',[])+result.get('comments',[]):c['body']=c['body'][:2000];c['truncated']=True
        encoded=json.dumps(response,ensure_ascii=False)
    if len(encoded.encode())>1000000:encoded=json.dumps({'status':502,'error':'jira_display_limit'})
    sys.stdout.write(encoded)
if __name__=='__main__':main()
