import json,time
from pathlib import Path
import httpx
_user_cache={'U000001':'alice','U000002':'bob'}
class Session:
    def close(self): pass
class SlackClientWrapper:
    def __init__(self,*args,**kwargs):
        self._client=Session();self._api_client=None
        try:self._make_request('auth.test',method='GET')
        except Exception as exc:raise RuntimeError('FAKE_AUTH_SECRET') from exc
    def _make_request(self,endpoint,method='POST',payload=None,use_api_token=False):
        with Path('calls.jsonl').open('a') as f:f.write(json.dumps({'endpoint':endpoint,'method':method,'payload':payload})+'\n')
        data=json.loads(Path('fixture.json').read_text());payload=payload or {}
        if data.get('rate_auth') or data.get('rate') and endpoint!='auth.test':raise httpx.HTTPStatusError()
        if endpoint=='auth.test':return {'ok':True,'team':'Fixture workspace','token':'FAKE_AUTH_SECRET'}
        if data.get('delay') and endpoint=='conversations.history':Path('started').write_text('ready');time.sleep(1)
        if endpoint in ('conversations.list','users.conversations'):
            if data.get('catalog_delay'):time.sleep(1)
            if data.get('enterprise'):return {'ok':False,'error':'enterprise_is_restricted'}
            if payload.get('types')=='im':return {'ok':True,'channels':data.get('dms',[]) if not payload.get('cursor') else data.get('dms2',[]),'response_metadata':{'next_cursor':'' if payload.get('cursor') else data.get('dm_cursor','')}}
            return {'ok':True,'channels':data['channels'] if not payload.get('cursor') else data.get('channels2',[]),'response_metadata':{'next_cursor':'' if payload.get('cursor') else data.get('channel_cursor','')}}
        if endpoint=='client.counts':return {'ok':True,'ims':[{'id':c['id'],'latest':data.get('dm_latest',{}).get(c['id'])} for c in data.get('dms',[])],'channels':[{'id':c['id'],'latest':data.get('latest',{}).get(c['id'])} for c in data.get('joined_channels',data['channels'])]}
        if endpoint=='client.userBoot':return {'ok':True,'channels':data['channels']+data.get('unjoined_channels',[]),'ims':data.get('dms',[])+data.get('unlisted_dms',[]),'self':{'token':'FAKE_AUTH_SECRET'},'prefs':{'secret':'FAKE_COOKIE_SECRET'}}
        if endpoint=='users.info':
            if data.get('name_error'):return {'ok':False,'error':data['name_error']}
            return {'ok':True,'user':{'id':payload['user'],'profile':{'display_name':data.get('user_names',{}).get(payload['user'],''),'email':'FAKE_COOKIE_SECRET','image_original':'https://fixture/FAKE_AUTH_SECRET'}}}
        if endpoint=='chat.postMessage':
            assert method=='POST' and payload.get('unfurl_links') is False and payload.get('reply_broadcast') is False
            if data.get('post_error'):return {'ok':False,'error':data['post_error']}
            if data.get('post_delay'):Path('post-started').write_text('ready');time.sleep(1)
            message={'ts':'1700000900.000001','user':'U000001','text':payload['text']}
            if payload.get('thread_ts'):
                message['thread_ts']=payload['thread_ts'];data.setdefault('replies',[]).append(message)
            else:data.setdefault('messages',[]).insert(0,message)
            Path('fixture.json').write_text(json.dumps(data))
            if data.get('post_uncertain'):raise RuntimeError('FAKE_AUTH_SECRET response lost')
            return {'ok':True,'channel':payload['channel'],'ts':message['ts'],'message':message,'token':'FAKE_AUTH_SECRET'}
        if endpoint=='conversations.history' and payload.get('channel','').startswith('D'):return {'ok':True,'messages':(data.get('dm_older',{}) if payload.get('cursor') else data.get('dm_messages',{})).get(payload['channel'],[]),'response_metadata':{'next_cursor':'' if payload.get('cursor') else data.get('dm_history_cursor','')}}
        if endpoint=='conversations.history':return {'ok':True,'messages':data.get('older',[]) if payload.get('cursor') else data.get('messages',[]),'response_metadata':{'next_cursor':'' if payload.get('cursor') else data.get('history_cursor','')}}
        if endpoint=='conversations.replies' and data.get('gesture_threads'):return {'ok':True,'messages':[{'ts':payload['ts'],'text':'Gesture thread root','user':'U000001'}],'response_metadata':{'next_cursor':''}}
        if endpoint=='conversations.replies' and data.get('thread_delay'):time.sleep(1)
        if endpoint=='conversations.replies' and data.get('thread_error'):return {'ok':False,'error':data['thread_error']}
        if endpoint=='conversations.replies':return {'ok':True,'messages':data.get('replies2',[]) if payload.get('cursor') else data.get('replies',[]),'response_metadata':{'next_cursor':'' if payload.get('cursor') else data.get('thread_cursor','')}}
        if endpoint=='search.messages':return {'ok':True,'messages':{'matches':data.get('matches',[]),'paging':{'pages':data.get('search_pages',1)},'total':len(data.get('matches',[]))}}
        raise AssertionError('Unexpected endpoint: '+endpoint)
