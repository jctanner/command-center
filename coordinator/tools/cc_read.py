#!/usr/bin/env python3
"""Bounded GET-only client for the existing CC API; Python 3.10+."""
import argparse
import ipaddress
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

MAX_RESPONSE = 8 * 1024 * 1024


class ReadError(Exception):
    pass


def pick(value, keys):
    return {k: value[k] for k in keys.split() if k in value}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        fp.close()
        raise ReadError('Redirect rejected; configure the final trusted endpoint')


class Client:
    def __init__(self, url):
        parsed = urllib.parse.urlsplit(url)
        try:
            loopback = ipaddress.ip_address(parsed.hostname or '').is_loopback
        except ValueError:
            loopback = parsed.hostname == 'localhost'
        if (parsed.scheme not in ('http', 'https') or not parsed.hostname
                or parsed.username is not None or parsed.password is not None
                or parsed.query or parsed.fragment or parsed.path not in ('', '/')
                or (parsed.scheme == 'http' and not loopback)):
            raise ReadError('Use loopback HTTP or HTTPS without credentials, path, query or fragment')
        try:
            parsed.port
        except ValueError:
            raise ReadError('Invalid endpoint port') from None
        self.url = url.rstrip('/')
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def get(self, route, **query):
        query = {k: v for k, v in query.items() if v is not None}
        url = self.url + '/api/v1/' + route
        if query:
            url += '?' + urllib.parse.urlencode(query)
        try:
            request = urllib.request.Request(url, headers={'Accept': 'application/json'}, method='GET')
            with self.opener.open(request, timeout=30) as response:
                data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                raise ReadError('Response exceeded 8 MiB; narrow the request')
            return json.loads(data)
        except urllib.error.HTTPError as error:
            error.close()
            raise ReadError(f'CC returned HTTP {error.code}; refresh discovery before retrying') from None
        except (urllib.error.URLError, TimeoutError, OSError):
            raise ReadError('CC connection unavailable; no automatic retry was made') from None
        except (ValueError, UnicodeError):
            raise ReadError('CC returned invalid JSON') from None

    def host(self, machine):
        hosts = [h for h in self.get('hosts') if h['id'] == machine]
        if len(hosts) != 1:
            raise ReadError('Machine ID not found; run hosts')
        return hosts[0]

    @staticmethod
    def route(machine, suffix):
        return 'hosts/' + urllib.parse.quote(machine, safe='') + '/' + suffix

    def agents(self, machine=None):
        data = self.get('queue')
        hosts = []
        for host in data.get('hosts', []):
            if machine is not None and host['id'] != machine:
                continue
            out = pick(host, 'id name connection_revision error limited')
            out['items'] = []
            for item in host.get('items', []):
                row = pick(item, 'id session session_name window window_name pane project agent status activity last_seen')
                row['instance'] = item.get('attention', {}).get('instance')
                row['card'] = pick(item.get('card', {}), 'name color pinned')
                out['items'].append(row)
            hosts.append(out)
        return {'checked_at': data.get('checked_at'), 'hosts': hosts}

    def history(self, args):
        snapshot = self.agents(args.machine)
        matches = [(h, i) for h in snapshot['hosts'] for i in h['items'] if i['id'] == args.agent]
        if len(matches) != 1:
            raise ReadError('Agent target missing or ambiguous; refresh agents')
        host, item = matches[0]
        if host.get('error') or item.get('status') == 'disconnected' or not item.get('instance'):
            raise ReadError('Agent process unavailable or unverified; refresh agents')
        query = pick(item, 'session window pane')
        query.update(connection_revision=host['connection_revision'], conversation=args.conversation,
                     before=args.before, known_version=args.known_version, known_branch=args.known_branch)
        value = self.get(self.route(host['id'], 'agents/conversation'), **query)
        if value.get('instance') != item['instance']:
            raise ReadError('Agent process changed; discard history and refresh agents')
        out = pick(value, 'provider project instance selected association history_version history_branch history_reset history_notice history_unchanged older_cursor')
        out.update(machine=host['id'], connection_revision=host['connection_revision'],
                   target=pick(item, 'id session window pane'), checked_at=snapshot['checked_at'])
        out['conversations'] = [pick(c, 'id session timestamp linked') for c in value.get('conversations', [])]
        out['messages'] = [pick(m, 'id role text timestamp order truncated') for m in value.get('messages', []) if m.get('role') in ('user', 'assistant')]
        # Never slice a page and silently skip messages behind its older cursor.
        if sum(len(m.get('text', '')) for m in out['messages']) > 192000:
            raise ReadError('History page exceeds output budget; inspect the conversation in CC')
        return out

    def read(self, args):
        if args.command == 'hosts':
            return [pick(h, 'id name remote connection_revision') for h in self.get('hosts')]
        if args.command == 'agents':
            return self.agents(args.machine)
        if args.command == 'history':
            return self.history(args)
        host = self.host(args.machine)
        route = self.route(args.machine, {'list': 'fs'}.get(args.command, args.command))
        query = {'connection_revision': host['connection_revision']}
        if args.command in ('list', 'file'):
            if not args.path.startswith(('/', '~/')) and args.path != '~':
                raise ReadError('Use an absolute machine-qualified path or ~')
            query['path'] = args.path
        value = self.get(route, **query)
        if args.command in ('list', 'file', 'projects'):
            if value.get('connection_revision') != host['connection_revision'] or value.get('host') != host['id']:
                raise ReadError('Machine changed; discard result and refresh hosts')
        if args.command == 'inventory':
            # This older route has no response revision; guard around the read.
            if self.host(args.machine)['connection_revision'] != host['connection_revision']:
                raise ReadError('Machine changed; discard inventory and refresh hosts')
            value = {'host': host['id'], 'connection_revision': host['connection_revision'], **value}
        if args.command == 'file':
            value = pick(value, 'host connection_revision path version read_only text')
            text = value.get('text', '')
            value.update(text=text[:args.limit], truncated=len(text) > args.limit, total_characters=len(text))
        return value


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', default=os.environ.get('CC_URL', 'http://127.0.0.1:8080'))
    sub = p.add_subparsers(dest='command', required=True)
    sub.add_parser('hosts')
    sub.add_parser('agents').add_argument('--machine')
    for command in ('inventory', 'projects', 'list', 'file', 'history'):
        child = sub.add_parser(command)
        child.add_argument('--machine', required=True)
        if command in ('list', 'file'):
            child.add_argument('--path', required=True)
        if command == 'file':
            child.add_argument('--limit', type=int, default=24000)
        if command == 'history':
            child.add_argument('--agent', required=True)
            child.add_argument('--conversation')
            child.add_argument('--before', type=int)
            child.add_argument('--known-version')
            child.add_argument('--known-branch')
    return p


def main():
    args = parser().parse_args()
    try:
        if not 1 <= getattr(args, 'limit', 1) <= 1048576 or (getattr(args, 'before', None) is not None and args.before < 0):
            raise ReadError('Invalid output limit or history cursor')
        print(json.dumps(Client(args.url).read(args), ensure_ascii=False, indent=2))
    except (ReadError, KeyError, TypeError, ValueError) as error:
        print('cc-read: ' + (str(error) if isinstance(error, ReadError) else 'Unexpected API shape or invalid endpoint; check CC compatibility'), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
