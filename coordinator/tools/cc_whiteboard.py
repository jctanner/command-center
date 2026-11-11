#!/usr/bin/env python3
"""Read and draw on CC whiteboards using the guarded same-origin REST API."""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request
import uuid
from cc_read import Client, ReadError, MAX_RESPONSE

class WhiteboardClient(Client):
    def write(self, method, route, body):
        payload=json.dumps(body,ensure_ascii=False).encode()
        if len(payload)>2*1024*1024:raise ReadError('Drawing exceeds 2 MiB; nothing was sent')
        request=urllib.request.Request(self.url+'/api/v1/'+route,data=payload,method=method,headers={'Content-Type':'application/json','Accept':'application/json','Origin':self.url})
        try:
            with self.opener.open(request,timeout=30)as response:
                if response.status==204:return {'deleted':True}
                raw=response.read(MAX_RESPONSE+1)
            if len(raw)>MAX_RESPONSE:raise ReadError('Oversized response; delivery uncertain. Check this operation; no retry made')
            return json.loads(raw)
        except urllib.error.HTTPError as error:
            code=error.code;error.close()
            if code==409:raise ReadError('HTTP 409 conflict: keep the drawing draft, GET scene, and reconcile affected element revisions; no retry made')from None
            raise ReadError(f'HTTP {code}; inspect the same board/operation before any further write; no retry made')from None
        except(urllib.error.URLError,OSError,ValueError):raise ReadError('Delivery uncertain. Check the same operation UUID; no automatic retry made')from None

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--url',default=os.environ.get('CC_URL','http://127.0.0.1:8080'));sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('list')
    for command in ['get','description','history','export','create','rename','draw','apply','patch','delete-element','check']:
        child=sub.add_parser(command)
        if command!='create':child.add_argument('--board',required=True,help='Whiteboard UUID')
        if command in ['create','rename','draw','apply','patch','delete-element']:child.add_argument('--input',required=True,type=Path,help='Saved JSON intent; see Whiteboard API reference')
        if command in ['patch','delete-element']:child.add_argument('--element',required=True)
        if command=='check':child.add_argument('--operation',required=True)
    args=parser.parse_args()
    try:
        client=WhiteboardClient(args.url)
        if args.command=='list':result=client.get('whiteboards')
        else:
            if args.command!='create':uuid.UUID(args.board)
            route='whiteboards'+('/'+args.board if args.command!='create'else'')
            if args.command in ['get','description','history','export','check']:
                if args.command=='check':uuid.UUID(args.operation);route+='/operations/'+args.operation
                elif args.command!='get':route+='/'+args.command
                result=client.get(route)
            else:
                with args.input.open('rb')as stream:raw=stream.read(2*1024*1024+1)
                if len(raw)>2*1024*1024:raise ReadError('Drawing input exceeds 2 MiB')
                body=json.loads(raw)
                if not isinstance(body,dict):raise ReadError('Expected a JSON object')
                if args.command in ['patch','delete-element']:uuid.UUID(args.element);route+='/elements/'+args.element
                if args.command=='draw':route+='/graph'
                if args.command=='apply':route+='/operations'
                if args.command not in ['rename']:uuid.UUID(body['id']if args.command=='create'else body['operation_id'])
                method='PATCH'if args.command in ['rename','patch']else'DELETE'if args.command=='delete-element'else'POST'
                print('Whiteboard intent: '+str(body.get('operation_id',body.get('id',getattr(args,'board','')))),file=sys.stderr)
                result=client.write(method,route,body)
        print(json.dumps(result,ensure_ascii=False,indent=2))
    except(ReadError,OSError,ValueError,KeyError)as error:print(str(error),file=sys.stderr);return 1
    return 0
if __name__=='__main__':raise SystemExit(main())
