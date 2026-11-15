"""Numeric-only native usage extraction. Source paths come from verified history discovery."""
import hashlib,json,os
from datetime import datetime,timezone
MAX_NUMBER=9007199254740991
SCAN=512*1024
LINE=1024*1024

def number(value,positive=False):
    return value if isinstance(value,int) and not isinstance(value,bool) and (1 if positive else 0)<=value<=MAX_NUMBER else None

def stamp(value):
    try:
        date=datetime.fromtimestamp(value/1000,timezone.utc) if isinstance(value,(int,float)) else datetime.fromisoformat(value.replace('Z','+00:00'))
        if date.tzinfo is None or date.timestamp()<0 or date.timestamp()>datetime.now(timezone.utc).timestamp()+30:return None
        return date.isoformat()
    except (ValueError,TypeError,AttributeError,OverflowError,OSError):return None

def counts(usage,kind):
    if not isinstance(usage,dict):return None
    fields={'input':'input_tokens','output':'output_tokens','cached_input':'cached_input_tokens','cache_write':'cache_creation_input_tokens','reasoning_output':'reasoning_output_tokens','total':'total_tokens'} if kind=='codex' else {'input':'input_tokens','output':'output_tokens','cached_input':'cache_read_input_tokens','cache_write':'cache_creation_input_tokens','reasoning_output':'reasoning_output_tokens','total':'total_tokens'} if kind=='claude' else {'input':'input','output':'output','cached_input':'cacheRead','cache_write':'cacheWrite','reasoning_output':'reasoning','total':'totalTokens'}
    result={key:number(usage.get(native)) for key,native in fields.items()}
    if not any(v is not None for v in result.values()):return None
    if kind=='claude' and result['total'] is None:
        values=[result[k] for k in ('input','output','cached_input','cache_write')]
        if all(v is not None for v in values):result['total']=number(sum(values))
    return result

def normalized(record,kind,offset,last_id):
    """No content, tool data, thinking or system text ever leaves this function."""
    if not isinstance(record,dict):return None,True,last_id
    if kind=='claude':
        if record.get('isSidechain'):return None,False,last_id
        message=record.get('message',{})
        if record.get('type')=='system' and record.get('subtype')=='compact_boundary':return {'id':'boundary:'+str(offset),'invalidate':True},False,last_id
        if record.get('type')!='assistant' or not isinstance(message,dict):return None,False,last_id
        usage=counts(message.get('usage'),kind)
        identifier=message.get('id')
        if not isinstance(identifier,str) or not 0<len(identifier)<=200:return None,True,last_id
        return dict(id=identifier,billable=True,usage=usage,context=True,model=message.get('model') if isinstance(message.get('model'),str) else None,window=number(message['usage'].get('context_window'),True) if isinstance(message.get('usage'),dict) else None,recorded_at=stamp(record.get('timestamp'))),False,last_id
    identifier=record.get('id')
    # Native v1 is linear and lacks entry IDs. Byte positions are stable within a file generation.
    if identifier is None:identifier='v1:'+str(offset);parent=last_id
    else:parent=record.get('parentId')
    if not isinstance(identifier,str) or not 0<len(identifier)<=200 or parent is not None and not isinstance(parent,str):return None,True,last_id
    node=dict(id=identifier,parent=parent,context=False,invalidate=record.get('type') in ('compaction','context_edit','model_change','branch_summary'))
    message=record.get('message',{})
    if record.get('type')=='message' and isinstance(message,dict) and message.get('role')=='assistant':
        node.update(billable=True,usage=counts(message.get('usage'),kind),context=True,model=message.get('model') if isinstance(message.get('model'),str) else None,window=number(message.get('contextWindow'),True),recorded_at=stamp(record.get('timestamp') or message.get('timestamp')))
    elif record.get('type') in ('usage','compaction','branch_summary'):
        node['billable']=True;node['usage']=counts(record.get('usage'),kind)
    return node,False,identifier

def collect(path,kind,conversation,instance,association,cursor=None,leaf=False):
    if kind not in ('codex','claude','pi'):return None
    with open(path,'rb') as f:
        stat=os.fstat(f.fileno());size=stat.st_size
        source=hashlib.sha256(json.dumps([stat.st_dev,stat.st_ino,conversation,instance,kind]).encode()).hexdigest()
        base=dict(source=source,provider=kind,conversation=conversation,instance=instance,association=association,size=size,records=[],complete=False,gap=False,leaf=leaf)
        cursor=cursor if isinstance(cursor,dict) and cursor.get('source')==source else {}
        offset=cursor.get('offset',0)
        if not isinstance(offset,int) or isinstance(offset,bool) or not 0<=offset<=size:cursor={};offset=0
        if cursor:
            length=cursor.get('anchor_length',0);length=length if isinstance(length,int) and 0<=length<=512 else 0
            f.seek(offset-length);anchor=hashlib.sha256(f.read(length)).hexdigest()
            prefix_length=cursor.get('prefix_length',0);prefix_length=prefix_length if isinstance(prefix_length,int) and 0<=prefix_length<=512 else 0
            f.seek(0);prefix=hashlib.sha256(f.read(prefix_length)).hexdigest()
            if anchor!=cursor.get('anchor') or prefix!=cursor.get('prefix') or size==cursor.get('size') and stat.st_mtime_ns!=cursor.get('mtime_ns'):
                cursor={};offset=0
        base['reset']=not bool(cursor)
        if cursor.get('idle') and size==cursor.get('size') and stat.st_mtime_ns==cursor.get('mtime_ns'):
            base.update(cursor=cursor,complete=True,bytes_read=0);return base
        if kind=='codex':
            start=max(0,size-LINE)
            if cursor and offset<start:base['reset']=True
            f.seek(start)
            if start:f.readline(LINE)
            snapshot=None;context=None;invalidated=False;model=None;reported_model=None;at=None
            for line in f.read(LINE).splitlines(keepends=True):
                if not line.endswith(b'\n'):continue
                try:r=json.loads(line)
                except (ValueError,UnicodeError):continue
                if not isinstance(r,dict):continue
                payload=r.get('payload',{})
                if not isinstance(payload,dict):continue
                if r.get('type')=='turn_context' and isinstance(payload.get('model'),str):model=payload['model']
                if r.get('type')=='event_msg' and payload.get('type')=='context_compacted':context=None;invalidated=True
                if r.get('type')!='event_msg' or payload.get('type')!='token_count' or not isinstance(payload.get('info'),dict):continue
                info=payload['info'];total=counts(info.get('total_token_usage'),kind)
                if total is not None:snapshot=total
                used=counts(info.get('last_token_usage'),kind)
                context=dict(used=used.get('total') if used else None,window=number(info.get('model_context_window'),True));at=stamp(r.get('timestamp'));reported_model=model;invalidated=False
            base.update(snapshot=snapshot,context=context,context_invalidated=invalidated,model=reported_model,recorded_at=at,complete=True,bytes_read=min(size,LINE));offset=size
        else:
            f.seek(offset);start=offset;last_id=cursor.get('last_id');idle=False;skipping=bool(cursor.get('skipping'))
            while f.tell()<size and f.tell()-start<SCAN and len(base['records'])<256:
                position=f.tell();raw=f.readline(LINE+1)
                if skipping:
                    base['gap']=True;skipping=not raw.endswith(b'\n');continue
                if len(raw)>LINE:
                    base['gap']=True;skipping=not raw.endswith(b'\n');continue
                if not raw.endswith(b'\n'):f.seek(position);idle=True;break
                try:r=json.loads(raw)
                except (ValueError,UnicodeError):base['gap']=True;continue
                node,gap,last_id=normalized(r,kind,position,last_id)
                base['gap']=base['gap'] or gap
                if node:base['records'].append(node)
            offset=f.tell();base.update(complete=offset>=size or idle,bytes_read=offset-start)
            base['last_id']=last_id;base['skipping']=skipping
        f.seek(max(0,offset-512));anchor_data=f.read(min(offset,512));prefix_length=min(offset,512);f.seek(0);prefix_data=f.read(prefix_length)
        base['cursor']=dict(source=source,offset=offset,anchor=hashlib.sha256(anchor_data).hexdigest(),anchor_length=len(anchor_data),prefix=hashlib.sha256(prefix_data).hexdigest(),prefix_length=prefix_length,size=size,mtime_ns=stat.st_mtime_ns,idle=base['complete'],last_id=base.get('last_id'),skipping=base.get('skipping',False))
        return base
