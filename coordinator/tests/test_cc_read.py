import importlib.util
import json
from pathlib import Path
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cc_read', Path(__file__).parents[1] / 'tools/cc_read.py')
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)

HOST = {'id': 'fixture', 'name': 'Fixture', 'connection_revision': 'rev1'}
ITEM = {'id': 'agent1', 'session': '$1', 'window': '@2', 'pane': '%3', 'status': 'live',
        'attention': {'instance': 'proc1'}, 'context': 'PRIVATE SCREEN', 'prompt': 'PRIVATE PROMPT',
        'activity': {'state': 'unknown', 'source': 'unavailable'}, 'card': {'name': 'Fixture agent'}}


class Tests(unittest.TestCase):
    def client(self):
        return cc.Client('http://127.0.0.1:8080')

    def args(self, *args):
        return cc.parser().parse_args(args)

    def test_url_boundaries(self):
        for url in ('http://192.0.2.1:8080', 'http://user:pass@localhost', 'https://example.org/path',
                    'https://example.org?secret=1', 'file:///tmp/data', 'http://localhost:bad'):
            with self.subTest(url=url), self.assertRaises(cc.ReadError):
                cc.Client(url)
        for url in ('http://127.0.0.1:8080', 'http://[::1]:8080', 'https://example.org'):
            cc.Client(url)

    def test_agents_omit_screen_and_keep_evidence(self):
        client = self.client()
        with patch.object(client, 'get', return_value={'checked_at': 100, 'hosts': [{**HOST, 'limited': True, 'items': [ITEM]}]}):
            data = client.agents()
        row = data['hosts'][0]['items'][0]
        self.assertEqual(row['instance'], 'proc1')
        self.assertEqual(row['activity']['state'], 'unknown')
        self.assertTrue(data['hosts'][0]['limited'])
        self.assertNotIn('PRIVATE', json.dumps(data))

    def history(self, changes=None):
        client = self.client()
        snapshot = {'checked_at': 100, 'hosts': [{**HOST, 'items': [{**ITEM, 'instance': 'proc1'}]}]}
        value = {'instance': 'proc1', 'association': 'project', 'selected': 'conversation1',
                 'history_branch': 'branch1', 'older_cursor': 5, 'message_token': 'SECRET',
                 'approval': {'token': 'SECRET'}, 'context': 'SECRET',
                 'messages': [{'id': 'm1', 'role': 'user', 'text': 'Goal'},
                              {'id': 'm2', 'role': 'assistant', 'text': 'Plan'},
                              {'id': 'm3', 'role': 'system', 'text': 'SECRET'}]}
        value.update(changes or {})
        with patch.object(client, 'agents', return_value=snapshot), patch.object(client, 'get', return_value=value) as get:
            result = client.history(self.args('history', '--machine', 'fixture', '--agent', 'agent1', '--before', '8', '--known-branch', 'branch1'))
            self.assertNotIn('instance', get.call_args.kwargs)
            self.assertEqual(get.call_args.kwargs['connection_revision'], 'rev1')
            self.assertEqual(get.call_args.kwargs['known_branch'], 'branch1')
            return result

    def test_history_preserves_association_and_omits_capabilities(self):
        data = self.history()
        self.assertEqual(data['association'], 'project')
        self.assertEqual(data['older_cursor'], 5)
        self.assertEqual(len(data['messages']), 2)
        self.assertNotIn('SECRET', json.dumps(data))

    def test_replaced_process_rejected(self):
        with self.assertRaisesRegex(cc.ReadError, 'process changed'):
            self.history({'instance': 'proc2'})

    def test_large_history_not_silently_sliced(self):
        with self.assertRaisesRegex(cc.ReadError, 'budget'):
            self.history({'messages': [{'role': 'assistant', 'text': 'x' * 192001}]})

    def test_file_truncation_and_endpoint_guard(self):
        client = self.client()
        args = self.args('file', '--machine', 'fixture', '--path', '/project/file', '--limit', '4')
        response = {**HOST, 'host': 'fixture', 'path': '/project/file', 'version': 'v1', 'text': 'abcdef'}
        with patch.object(client, 'host', return_value=HOST), patch.object(client, 'get', return_value=response):
            data = client.read(args)
            self.assertEqual(data['text'], 'abcd')
            self.assertTrue(data['truncated'])
            self.assertEqual(data['version'], 'v1')
            response['connection_revision'] = 'rev2'
            with self.assertRaisesRegex(cc.ReadError, 'Machine changed'):
                client.read(args)

    def test_inventory_machine_scope_and_revision_change(self):
        client = self.client()
        args = self.args('inventory', '--machine', 'fixture')
        with patch.object(client, 'host', side_effect=[HOST, HOST]), patch.object(client, 'get', return_value={'sessions': []}):
            self.assertEqual(client.read(args), {'host': 'fixture', 'connection_revision': 'rev1', 'sessions': []})
        with patch.object(client, 'host', side_effect=[HOST, {**HOST, 'connection_revision': 'rev2'}]), patch.object(client, 'get', return_value={'sessions': []}):
            with self.assertRaisesRegex(cc.ReadError, 'Machine changed'):
                client.read(args)

    def test_unchanged_history_is_explicit(self):
        data = self.history({'messages': [], 'history_unchanged': True})
        self.assertTrue(data['history_unchanged'])
        self.assertEqual(data['messages'], [])

    def test_http_get_encoding_redirects_errors_and_size(self):
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append((self.command, self.path))
                if self.path.endswith('/redirect'):
                    self.send_response(302)
                    self.send_header('Location', '/secret')
                    self.end_headers()
                elif self.path.endswith('/failure'):
                    self.send_response(409)
                    self.end_headers()
                    self.wfile.write(b'SECRET RAW ERROR')
                else:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'{"ok":true}')
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            client = cc.Client(f'http://127.0.0.1:{server.server_port}')
            self.assertTrue(client.get('hosts/fixture/file', path='/a b?x&y')['ok'])
            self.assertEqual(requests[0], ('GET', '/api/v1/hosts/fixture/file?path=%2Fa+b%3Fx%26y'))
            with self.assertRaisesRegex(cc.ReadError, 'Redirect rejected'):
                client.get('redirect')
            self.assertNotIn(('GET', '/secret'), requests)
            with self.assertRaisesRegex(cc.ReadError, 'HTTP 409') as error:
                client.get('failure')
            self.assertNotIn('SECRET', str(error.exception))
            with patch.object(cc, 'MAX_RESPONSE', 2), self.assertRaisesRegex(cc.ReadError, 'exceeded'):
                client.get('hosts')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
