#!/usr/bin/env python3
"""CC ticket CRUD client. Writes require user intent; no launches or automatic retries."""
import argparse
import json
import os
from pathlib import Path
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

from cc_read import Client, MAX_RESPONSE, ReadError


class BoardClient(Client):
    def mutate(self, method, route, body):
        payload = json.dumps(body, ensure_ascii=False).encode('utf-8')
        if len(payload) > 131072:
            raise ReadError('Ticket body exceeds 128 KiB; nothing was sent')
        request = urllib.request.Request(self.url + '/api/v1/' + route, data=payload, method=method,
                                         headers={'Content-Type': 'application/json', 'Accept': 'application/json', 'Origin': self.url})
        try:
            with self.opener.open(request, timeout=30) as response:
                data = response.read(MAX_RESPONSE + 1)
                if response.status == 204:
                    return {'deleted': True, 'id': route.rsplit('/', 1)[-1]}
            if len(data) > MAX_RESPONSE:
                raise ReadError('Oversized response; delivery uncertain. Read this ticket before proceeding')
            return json.loads(data)
        except urllib.error.HTTPError as error:
            code = error.code
            error.close()
            if code == 409:
                raise ReadError('HTTP 409 conflict. Keep your draft; GET ticket detail and reconcile. Do not just substitute a fresh revision') from None
            if code >= 500:
                raise ReadError(f'HTTP {code}; delivery uncertain. Read the same ticket UUID before proceeding; no retry made') from None
            raise ReadError(f'HTTP {code}; ticket request rejected. Inspect the contract and current ticket; no retry made') from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            raise ReadError('Delivery uncertain. Read the same ticket UUID before proceeding; no retry made') from None

    def execute(self, args):
        if args.command == 'schema':
            return self.get('openapi.json')
        if args.command == 'list':
            return self.get('board/tickets')
        if args.command in ('create', 'update'):
            with args.input.open('rb') as stream:
                raw = stream.read(131073)
            if len(raw) > 131072:
                raise ReadError('Input exceeds 128 KiB; nothing was sent')
            body = json.loads(raw)
            if not isinstance(body, dict):
                raise ReadError('Input must be a JSON object')
            ticket = body.get('id', '')
            if not isinstance(ticket, str):
                raise ReadError('Ticket id must be a UUID string')
            uuid.UUID(ticket)
            if args.command == 'create' and body.get('revision') is not None:
                raise ReadError('Create must omit revision or use null')
            if args.command == 'update' and not body.get('revision'):
                raise ReadError('Update requires the exact revision from ticket detail')
            print('Ticket UUID for recovery: ' + ticket, file=sys.stderr)
            return self.mutate('POST', 'board/tickets', body)
        uuid.UUID(args.ticket)
        route = 'board/tickets/' + urllib.parse.quote(args.ticket, safe='')
        if args.command == 'get':
            return self.get(route)
        body = {'revision': args.revision}
        if args.command == 'move':
            body['status'] = args.status
            return self.mutate('POST', route + '/move', body)
        return self.mutate('DELETE', route, body)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', default=os.environ.get('CC_URL', 'http://127.0.0.1:8080'))
    sub = p.add_subparsers(dest='command', required=True)
    sub.add_parser('schema')
    sub.add_parser('list')
    for name in ('create', 'update'):
        sub.add_parser(name).add_argument('--input', type=Path, required=True, help='JSON file with complete editable fields; see OpenAPI TicketChange')
    for name in ('get', 'move', 'delete'):
        child = sub.add_parser(name)
        child.add_argument('--ticket', required=True, help='Ticket UUID, not CC-number')
        if name != 'get':
            child.add_argument('--revision', required=True)
        if name == 'move':
            child.add_argument('--status', choices=['backlog', 'ready', 'in_progress', 'review', 'blocked', 'done'], required=True)
    return p


def main():
    args = parser().parse_args()
    try:
        value = BoardClient(args.url).execute(args)
        print(json.dumps(value, ensure_ascii=False, indent=2))
    except (ReadError, ValueError, OSError, TypeError) as error:
        print('cc-board: ' + (str(error) if isinstance(error, ReadError) else 'Invalid input or unavailable input file; check UUID, JSON and endpoint'), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
