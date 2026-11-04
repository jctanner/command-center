"""Bounded Slack adapter to the existing personal-assistant Slack client.
Executed in that project's venv. Credentials and raw responses stay on its host.
"""
import contextlib
import io
import json
import logging
import os
import re
import sys
import time

CHANNEL = re.compile(r'^[CGD][A-Z0-9]{5,31}$')
STAMP = re.compile(r'^\d{8,16}\.\d{6}$')
READS = {'auth.test', 'users.info', 'users.conversations', 'client.counts', 'client.userBoot', 'conversations.list', 'conversations.history', 'conversations.replies', 'search.messages'}

class Failure(Exception):
    def __init__(self, status, code, retry_after=0, delivery='not_sent'): self.status, self.code, self.retry_after, self.delivery = status, code, retry_after, delivery

def validate(request):
    op = request.get('operation')
    if op not in ('status', 'channels', 'history', 'thread', 'search', 'send', 'dms'): raise Failure(400, 'unsupported_operation')
    if op in ('history','thread','send') and not CHANNEL.fullmatch(request.get('channel') or ''): raise Failure(400, 'invalid_channel')
    if op == 'thread' and not STAMP.fullmatch(request.get('ts') or ''): raise Failure(400, 'invalid_timestamp')
    if op == 'search' and (not isinstance(request.get('query'),str) or not request['query'].strip() or len(request['query'])>1000): raise Failure(400,'invalid_search')
    if op=='send':
        if request.get('channel','').startswith('D'): raise Failure(403,'dm_posting_disabled')
        if request.get('thread_ts') is not None and not STAMP.fullmatch(request.get('thread_ts') or ''): raise Failure(400,'invalid_timestamp')
        if not isinstance(request.get('text'),str) or not request['text'].strip() or len(request['text'])>4000 or '\x00' in request['text']: raise Failure(400,'invalid_message')
        import uuid
        try:
            if str(uuid.UUID(request.get('id',''))) != request['id']: raise ValueError()
        except (ValueError,TypeError,AttributeError): raise Failure(400,'invalid_message_id')
    cursor=request.get('cursor') or ''
    if not isinstance(cursor,str) or len(cursor)>2048 or any(ord(c)<32 for c in cursor): raise Failure(400,'invalid_cursor')
    page=request.get('page') or 1
    if not isinstance(page,int) or isinstance(page,bool) or not 1<=page<=100: raise Failure(400,'invalid_page')
    return op

def channel(value):
    if not isinstance(value,dict) or not CHANNEL.fullmatch(str(value.get('id',''))): return None
    topic=value.get('topic') or {}
    return dict(id=value['id'],name=str(value.get('name') or value['id'])[:200],private=value.get('is_private') is True,archived=value.get('is_archived') is True,topic=str(topic.get('value',''))[:1000] if isinstance(topic,dict) else '')

def normalize_message(value, channel_id, names, budget):
    if not isinstance(value,dict) or not STAMP.fullmatch(str(value.get('ts',''))): return None
    ch=value.get('channel')
    if isinstance(ch,dict): channel_id=ch.get('id') or channel_id
    elif isinstance(ch,str): channel_id=ch or channel_id
    if not CHANNEL.fullmatch(str(channel_id or '')): return None
    user=str(value.get('user') or '')[:80]
    text=value.get('text') or ''
    if not isinstance(text,str): text=''
    text=re.sub(r'<@([A-Z0-9]{6,32})>',lambda match:'@'+(names.get(match[1]) if isinstance(names.get(match[1]),str) else match[1]),text)
    length=min(8000,budget[0]);budget[0]-=min(length,len(text))
    bot=value.get('bot_profile') or {}
    author=names.get(user) or value.get('username') or (bot.get('name') if isinstance(bot,dict) else None) or user or 'Slack'
    thread=value.get('thread_ts')
    if not thread and isinstance(value.get('permalink'),str):
        from urllib.parse import urlsplit,parse_qs
        try: thread=(parse_qs(urlsplit(value['permalink']).query).get('thread_ts') or [None])[0]
        except ValueError: pass
    thread=str(thread or value['ts'])
    if not STAMP.fullmatch(thread): thread=value['ts']
    # No private file download URLs, raw blocks, tokens, emails, or profiles.
    normalized=dict(id=channel_id+'/'+value['ts'],channel=channel_id,channel_name=str(ch.get('name',''))[:200] if isinstance(ch,dict) else '',ts=value['ts'],thread_ts=thread,user=user,author=str(author)[:200],text=text[:length],truncated=len(text)>length,replies=min(100000,max(0,int(value.get('reply_count') or 0))),attachments=min(100,len(value.get('files') or [])+len(value.get('attachments') or [])))
    latest=value.get('latest_reply')
    if isinstance(latest,str) and STAMP.fullmatch(latest): normalized['latest_reply']=latest
    return normalized

def run(request):
    op=validate(request)
    import httpx
    from assistant_mcp.config import load_config, load_env_config
    from assistant_mcp.clients import slack_client as existing
    config=load_config()
    if not config.services.slack.enabled: raise Failure(403,'slack_disabled_in_source_project')
    can_send=bool(getattr(getattr(getattr(config,'permissions',None),'slack',None),'allow_write',False))
    if op=='send' and not can_send: raise Failure(403,'slack_writes_disabled_in_source_project')
    env=load_env_config()
    if not env.slack_xoxc_token or not env.slack_xoxd_token: raise Failure(503,'slack_credentials_not_configured_on_source')
    class ScopedClient(existing.SlackClientWrapper):
        def _make_request(self, endpoint, method='POST', payload=None, use_api_token=False):
            posting=op=='send' and can_send and endpoint=='chat.postMessage' and method=='POST'
            if not posting and (endpoint not in READS or method!='GET') or use_api_token: raise Failure(403,'write_operation_blocked')
            self._client.timeout=httpx.Timeout(4.0)
            try:
                result=super()._make_request(endpoint,method=method,payload=payload,use_api_token=False)
            except Exception as exc:
                cause=exc
                for _ in range(5):
                    if isinstance(cause,httpx.HTTPStatusError) and cause.response.status_code==429:
                        try: retry=int(cause.response.headers.get('retry-after','30'))
                        except ValueError: retry=30
                        raise Failure(429,'slack_rate_limited',min(3600,max(1,retry)))
                    cause=getattr(cause,'__cause__',None) or getattr(cause,'__context__',None)
                    if cause is None: break
                raise Failure(502,'slack_request_unavailable',delivery='uncertain' if posting else 'not_sent') from None
            if not isinstance(result,dict) or not result.get('ok'):
                code=result.get('error','request_failed') if isinstance(result,dict) else 'request_failed'
                if not isinstance(code,str) or not re.fullmatch(r'[a-z0-9_]{1,80}',code): code='request_failed'
                raise Failure(401 if code in ('invalid_auth','token_revoked','not_authed','account_inactive') else 403 if code in ('missing_scope','not_in_channel','channel_not_found') else 502,code,delivery='uncertain' if posting and code not in ('invalid_auth','token_revoked','not_authed','account_inactive','missing_scope','not_in_channel','channel_not_found','is_archived','restricted_action','msg_too_long','no_text','invalid_arguments','thread_not_found') else 'not_sent')
            if endpoint=='auth.test': self.identity=result
            return result
    try:
        client=ScopedClient(env.slack_xoxc_token,env.slack_xoxd_token,logs_channel_id=None)
    except Failure: raise
    except Exception as exc:
        cause=exc
        for _ in range(6):
            if isinstance(cause,Failure): raise cause
            cause=getattr(cause,'__cause__',None) or getattr(cause,'__context__',None)
            if cause is None: break
        raise Failure(401,'slack_authentication_failed') from None
    try:
        identity=getattr(client,'identity',{})
        result=dict(workspace=str(identity.get('team') or 'Slack')[:200],checked_at=int(time.time()),operation=op,can_send=can_send)
        if op=='status': return result
        if op=='send':
            payload=dict(channel=request['channel'],text=request['text'],client_msg_id=request['id'],unfurl_links=False,unfurl_media=False,reply_broadcast=False,parse='none',link_names=False)
            if request.get('thread_ts'): payload['thread_ts']=request['thread_ts']
            data=client._make_request('chat.postMessage',method='POST',payload=payload)
            if data.get('channel')!=request['channel'] or not isinstance(data.get('ts'),str) or not STAMP.fullmatch(data['ts']): raise Failure(502,'invalid_send_receipt',delivery='uncertain')
            return dict(delivery='sent',channel=request['channel'],thread_ts=request.get('thread_ts'),ts=data['ts'])
        cursor=request.get('cursor') or ''
        if op=='dms':
            scope={'team_id':identity['team_id']} if identity.get('team_id') else {}
            try:
                payload=dict(scope,types='im',exclude_archived=True,limit=50)
                if cursor: payload['cursor']=cursor
                data=client._make_request('users.conversations',method='GET',payload=payload)
                values=data.get('channels') or []
                counts=client._make_request('client.counts',method='GET',payload=scope)
                next_cursor=str((data.get('response_metadata') or {}).get('next_cursor') or '')[:2048]
                values=values[:50];limited=False;discovery='membership'
            except Failure as exc:
                if exc.code!='enterprise_is_restricted': raise
                if cursor: raise Failure(400,'invalid_cursor')
                counts=client._make_request('client.counts',method='GET',payload=scope)
                boot=client._make_request('client.userBoot',method='GET',payload=scope)
                ids={v.get('id') for v in (counts.get('ims') or []) if isinstance(v,dict) and re.fullmatch(r'D[A-Z0-9]{5,31}',str(v.get('id','')))}
                metadata={v.get('id'):v for v in (boot.get('ims') or []) if isinstance(v,dict)}
                values=[metadata[id] for id in sorted(ids) if id in metadata][:500]
                limited=bool(ids-metadata.keys() or len(ids)>500);next_cursor='';discovery='sidebar'
            values=[v for v in values if isinstance(v,dict) and re.fullmatch(r'D[A-Z0-9]{5,31}',str(v.get('id',''))) and re.fullmatch(r'[UW][A-Z0-9]{5,31}',str(v.get('user',''))) and not v.get('is_archived')]
            cached=getattr(existing,'_user_cache',{});names=dict(cached) if isinstance(cached,dict) else {}
            # At most eight missing identities, four at a time; no cache writes or user-directory scan.
            missing=sorted({v['user'] for v in values if not isinstance(names.get(v['user']),str) or not names[v['user']]})[:8]
            def resolve(user):
                try:
                    data=client._make_request('users.info',method='GET',payload=dict(scope,user=user));value=data.get('user') or {}
                    if not isinstance(value,dict) or value.get('id')!=user: return user,None,None
                    profile=value.get('profile') or {}
                    name=(profile.get('display_name') or profile.get('real_name') or value.get('name')) if isinstance(profile,dict) else value.get('name')
                    return user,name[:200] if isinstance(name,str) and name else None,None
                except Failure as exc: return user,None,exc
            if missing:
                from concurrent.futures import ThreadPoolExecutor
                with ThreadPoolExecutor(max_workers=4) as pool:
                    for start in range(0,len(missing),4):
                        for user,name,error in pool.map(resolve,missing[start:start+4]):
                            if error and error.status in (401,429): raise error
                            if name: names[user]=name
            activity={v.get('id'):v.get('latest') for v in (counts.get('ims') or []) if isinstance(v,dict)}
            conversations=[]
            for value in values:
                known=names.get(value['user']);known=known if isinstance(known,str) and known else value['user']
                dm=dict(id=value['id'],name=known[:200],user=value['user'],kind='dm',private=True,archived=False)
                latest=activity.get(value['id']);latest=latest.get('ts') if isinstance(latest,dict) else latest
                if isinstance(latest,str) and STAMP.fullmatch(latest): dm['latest']=latest
                conversations.append(dm)
            result.update(channels=sorted(conversations,key=lambda v:v['name'].lower()),next_cursor=next_cursor,discovery=discovery,limited=limited,names_limited=sum(v['name']==v['user'] for v in conversations))
            return result
        if op=='channels':
            payload=dict(types='public_channel,private_channel',exclude_archived=True,limit=50)
            if identity.get('team_id'): payload['team_id']=identity['team_id']
            if cursor: payload['cursor']=cursor
            try:
                data=client._make_request('users.conversations',method='GET',payload=payload)
                values=data.get('channels') or []
                counts=client._make_request('client.counts',method='GET',payload={'team_id':identity['team_id']} if identity.get('team_id') else {})
                result.update(channels=sorted(filter(None,(channel(c) for c in values[:50])),key=lambda c:c['name']),next_cursor=str((data.get('response_metadata') or {}).get('next_cursor') or '')[:2048],discovery='joined',limited=False)
            except Failure as exc:
                if exc.code!='enterprise_is_restricted': raise
                # Enterprise session tokens can reject the public membership API.
                # Counts supplies membership IDs; boot supplies names, not membership.
                # Never expose boot's other channels or private preferences/profile data.
                if cursor: raise Failure(400,'invalid_cursor')
                scope={'team_id':identity['team_id']} if identity.get('team_id') else {}
                counts=client._make_request('client.counts',method='GET',payload=scope)
                boot=client._make_request('client.userBoot',method='GET',payload=scope)
                ids={v['id'] for v in (counts.get('channels') or []) if isinstance(v,dict) and CHANNEL.fullmatch(str(v.get('id','')))}
                metadata={c['id']:c for c in (channel(v) for v in (boot.get('channels') or [])) if c}
                joined=sorted((metadata[id] for id in ids if id in metadata and not metadata[id]['archived']),key=lambda c:c['name'])
                missing=len(ids-metadata.keys())
                result.update(channels=joined[:500],next_cursor='',discovery='joined',limited=bool(missing or len(joined)>500),unresolved=missing)
            activity={v.get('id'):v.get('latest') for v in (counts.get('channels') or []) if isinstance(v,dict)}
            for c in result['channels']:
                latest=activity.get(c['id'])
                if isinstance(latest,dict): latest=latest.get('ts')
                if isinstance(latest,str) and STAMP.fullmatch(latest): c['latest']=latest
            return result
        if op=='search':
            page=request.get('page') or 1
            data=client._make_request('search.messages',method='GET',payload=dict(query=request['query'],count=50,page=page,sort='timestamp',sort_dir='desc'))
            body=data.get('messages') or {};values=body.get('matches') or [];paging=body.get('paging') or {}
            result.update(next_page=page+1 if page<min(100,int(paging.get('pages') or 1)) else None,total=min(10000000,int(body.get('total') or 0)))
        else:
            payload=dict(channel=request['channel'],limit=50)
            if cursor: payload['cursor']=cursor
            if op=='thread': payload['ts']=request['ts']
            data=client._make_request('conversations.replies' if op=='thread' else 'conversations.history',method='GET',payload=payload)
            values=data.get('messages') or []
            result.update(next_cursor=str((data.get('response_metadata') or {}).get('next_cursor') or '')[:2048],has_more=bool(data.get('has_more')))
        names=getattr(existing,'_user_cache',{})
        names=names if isinstance(names,dict) else {}
        budget=[100000];messages=[]
        for value in values[:50]:
            message=normalize_message(value,request.get('channel'),names,budget)
            if message: messages.append(message)
        result['messages']=messages
        return result
    finally:
        client._client.close()
        if client._api_client: client._api_client.close()

if __name__=='__main__':
    logging.disable(logging.CRITICAL)
    output=sys.stdout
    try:
        request=json.loads(sys.stdin.buffer.read(65537))
        with open(os.devnull,'w') as quiet, contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
            result={'ok':run(request)}
    except Failure as exc: result={'status':exc.status,'error':exc.code,'retry_after':exc.retry_after,'delivery':exc.delivery}
    except Exception: result={'status':502,'error':'slack_bridge_unavailable'}
    json.dump(result,output,ensure_ascii=True)
