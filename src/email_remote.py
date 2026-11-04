"""Read-only Gmail adapter, executed only in the existing MCP project's venv.
No MCP server startup, activity logging, interactive OAuth, or mailbox mutations.
"""
import contextlib
from html import unescape
from html.parser import HTMLParser
import io
import json
import logging
import re
import sys
import time
from pathlib import Path

class Failure(Exception):
    def __init__(self, status, code): self.status, self.code = status, code

ID = re.compile(r'^[a-fA-F0-9]{1,64}$')
LABEL = re.compile(r'^[a-zA-Z0-9_\-]{1,128}$')
def validate(r):
    op = r.get('operation')
    if op not in ('labels', 'messages', 'thread'): raise Failure(400, 'invalid_operation')
    if op == 'thread' and not ID.fullmatch(r.get('id') or ''): raise Failure(400, 'invalid_thread')
    for field, limit in [('query',1000),('cursor',2048)]:
        value = r.get(field) or ''
        if not isinstance(value,str) or len(value)>limit or any(ord(c)<32 for c in value): raise Failure(400,'invalid_request')
    if r.get('label') and not LABEL.fullmatch(r['label']): raise Failure(400,'invalid_label')
    return op

def client():
    from assistant_mcp.config import load_config, load_env_config
    from assistant_mcp.clients.gmail_client import GmailClientWrapper
    from assistant_mcp.authenticate_gdocs import DEFAULT_TOKEN_FILE
    from google.oauth2.credentials import Credentials
    from google.auth.transport.requests import Request
    config = load_config()
    if not config.services.gmail.enabled: raise Failure(403,'email_disabled_in_source')
    env = load_env_config()
    token = Path(env.gdocs_token_file) if env.gdocs_token_file else DEFAULT_TOKEN_FILE
    if not token.is_file(): raise Failure(401,'email_authentication_required')
    # Load existing grants only. Refresh in memory; never invoke interactive OAuth
    # or replace a token file shared with the user's MCP process.
    credentials = Credentials.from_authorized_user_file(str(token))
    if credentials.expired and credentials.refresh_token: credentials.refresh(Request())
    if not credentials.valid: raise Failure(401,'email_authentication_required')
    return GmailClientWrapper(credentials)

def clean(v, limit=1000): return str(v or '')[:limit]
def message(m, full=False):
    result={k:clean(m.get(k),4000 if k=='snippet' else 1000) for k in ('id','thread_id','from','to','cc','subject','date','snippet')}
    if not ID.fullmatch(result['id']) or not ID.fullmatch(result['thread_id']): raise Failure(502,'invalid_email_response')
    result['snippet']=unescape(result['snippet'])
    result['unread']='UNREAD' in m.get('label_ids',[])
    if full:
        body=clean(m.get('body'),60000)
        result['body']=body
        result['truncated']=len(str(m.get('body') or ''))>60000
        result['attachments']=[{'filename':clean(a.get('filename'),300),'size':clean(a.get('size'),30)} for a in m.get('attachments',[])[:30]]
    return result

class PlainHTML(HTMLParser):
    def __init__(self): super().__init__(convert_charrefs=True);self.text=[];self.skip=0
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'):self.skip+=1
        elif tag in ('br','p','div','tr','li','h1','h2','h3'):self.text.append('\n')
    def handle_endtag(self,tag):
        if tag in ('script','style'):self.skip=max(0,self.skip-1)
        elif tag in ('p','div','tr','li'):self.text.append('\n')
    def handle_data(self,data):
        if not self.skip:self.text.append(data)

def parse(c,raw):
    parsed=c._parse_message(raw)
    if (raw.get('payload') or {}).get('mimeType')=='text/html':
        parser=PlainHTML();parser.feed(str(parsed.get('body') or '')[:1000000]);parsed['body']=''.join(parser.text).strip()
    return parsed

def run(r, c):
    op=validate(r)
    if op=='labels':
        labels=c.list_labels()
        return {'labels':[{'id':v['id'],'name':clean(v.get('name'),200)} for v in labels if LABEL.fullmatch(str(v.get('id','')))][:300], 'limited':len(labels)>300}
    if op=='messages':
        args={'userId':'me','maxResults':20}
        if r.get('query'): args['q']=r['query']
        if r.get('label'): args['labelIds']=[r['label']]
        if r.get('cursor'): args['pageToken']=r['cursor']
        # The existing list_messages discards page tokens. Use its underlying
        # read-only service and metadata parser so paging remains bounded.
        page=c.gmail.users().messages().list(**args).execute()
        messages=[];failed=0
        for stub in page.get('messages',[])[:20]:
            m=c._get_message_metadata(stub['id'])
            if m: messages.append(message(m))
            else: failed+=1
        return {'messages':messages,'next_cursor':clean(page.get('nextPageToken'),2048),'unavailable':failed}
    raw=c.gmail.users().threads().get(userId='me',id=r['id'],format='full').execute()
    values=raw.get('messages',[])
    messages=[message(parse(c,m),True) for m in values[-30:]]
    # Share a bounded total body budget across the displayed thread.
    budget=180000
    for m in messages:
        if len(m['body'])>budget: m['body']=m['body'][:budget];m['truncated']=True
        budget-=len(m['body'])
    return {'id':r['id'],'messages':messages,'limited':len(values)>30}

def main():
    logging.disable(logging.CRITICAL)
    try:
        request=json.loads(sys.stdin.buffer.read(16385));validate(request)
        with contextlib.redirect_stdout(io.StringIO()),contextlib.redirect_stderr(io.StringIO()): result=run(request,client())
        result['checked_at']=int(time.time()*1000)
        response={'ok':result}
    except Failure as e: response={'status':e.status,'error':e.code}
    except Exception as e:
        for _ in range(5):
            if getattr(e,'resp',None) is not None:break
            nested=e.__cause__ or e.__context__
            if nested is None:break
            e=nested
        status=401 if type(e).__name__ in ('RefreshError','DefaultCredentialsError') else getattr(getattr(e,'resp',None),'status',0)
        code={401:'email_authentication_required',403:'email_access_denied',404:'email_not_found',429:'email_rate_limited'}.get(status,'email_source_unavailable')
        response={'status':status if status in (401,403,404,429) else 502,'error':code}
    # Bound UTF-8 output as well as character counts for Unicode-heavy mail.
    encoded=json.dumps(response,ensure_ascii=False)
    if len(encoded.encode('utf-8'))>900000 and 'ok' in response:
        result=response['ok'];result['limited']=True
        for m in result.get('messages',[]):
            for field in ('body','snippet'):
                if field in m:m[field]=m[field][:4000]
            m['attachments']=m.get('attachments',[])[:5];m['truncated']=True
        encoded=json.dumps(response,ensure_ascii=False)
    if len(encoded.encode('utf-8'))>1000000: encoded=json.dumps({'status':502,'error':'email_display_limit'})
    sys.stdout.write(encoded)
if __name__=='__main__': main()
