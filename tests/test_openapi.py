"""Validate the served contract and synthetic ticket lifecycle on an isolated backend."""
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
import uuid

from jsonschema import Draft202012Validator, FormatChecker, ValidationError
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).resolve().parents[1]
SPEC = json.loads((ROOT / 'docs/openapi.json').read_text())
REGISTRY = Registry().with_resource('urn:cc:openapi', Resource.from_contents(SPEC, default_specification=DRAFT202012))


def validate(value, schema):
    # Resolve local component refs relative to the full OpenAPI document.
    resource = Resource.from_contents({'$id': 'urn:cc:schema', **schema}, default_specification=DRAFT202012)
    # Rewrite only local refs; no network resolution or schema downloads.
    text = json.dumps(resource.contents).replace('"#/components/', '"urn:cc:openapi#/components/')
    Draft202012Validator(json.loads(text), registry=REGISTRY, format_checker=FormatChecker()).validate(value)


class Contract(unittest.TestCase):
    def test_refs_operations_and_examples(self):
        ids = set()
        def walk(value):
            if isinstance(value, dict):
                if '$ref' in value:
                    parts = value['$ref'].removeprefix('#/').split('/')
                    target = SPEC
                    for part in parts:
                        target = target[part]
                for child in value.values():
                    walk(child)
            elif isinstance(value, list):
                for child in value:
                    walk(child)
        walk(SPEC)
        for path, methods in SPEC['paths'].items():
            for method, op in methods.items():
                self.assertNotIn(op['operationId'], ids)
                ids.add(op['operationId'])
                params = op.get('parameters', [])
                self.assertEqual(set(re.findall(r'{(.*?)}', path)), {p['name'] for p in params if p['in'] == 'path' and p['required']})
                if method != 'get':
                    self.assertTrue(any(p['name'] == 'Origin' and p['required'] for p in params))
                for media in op.get('requestBody', {}).get('content', {}).values():
                    if 'example' in media:
                        validate(media['example'], media['schema'])
        board = set(re.findall(r'\.route\("(/api/v1/board[^" ]*)"', (ROOT / 'src/board.rs').read_text()))
        # rustfmt may split route strings onto the next line.
        board |= set(re.findall(r'"(/api/v1/board[^" ]*)"', (ROOT / 'src/board.rs').read_text()))
        self.assertEqual({p.removeprefix('/api/v1') for p in board}, {p for p in SPEC['paths'] if p.startswith('/board')})
        whiteboard=set(re.findall(r'"(/api/v1/whiteboards[^" ]*)"',(ROOT/'src/whiteboard.rs').read_text()))
        self.assertEqual({p.removeprefix('/api/v1') for p in whiteboard},{p for p in SPEC['paths'] if p.startswith('/whiteboards')})
        for schema in SPEC['components']['schemas'].values():
            Draft202012Validator.check_schema(schema)


class HttpTickets(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary = Path(os.environ.get('CC_BINARY', ROOT / 'target/debug/command-center')).resolve()
        if not cls.binary.is_file():
            raise RuntimeError('Build backend first with cargo build, or set CC_BINARY')
        cls.tmp = tempfile.TemporaryDirectory(prefix='cc-openapi-test-')
        cls.directory = Path(cls.tmp.name)
        cls.config = cls.directory / 'fixture.toml'
        cls.config.write_text('hosts = []\n')
        cls.web = cls.directory / 'web'
        cls.web.mkdir()
        (cls.web / 'index.html').write_text('<!doctype html><title>Synthetic API fixture</title>')
        cls.log = (cls.directory / 'server.log').open('wb')
        cls.start()

    @classmethod
    def start(cls):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        cls.url = f'http://127.0.0.1:{port}'
        cls.process = subprocess.Popen([str(cls.binary), '--config', str(cls.config), '--listen', f'127.0.0.1:{port}', '--web-dir', str(cls.web)], stdout=cls.log, stderr=cls.log)
        cls.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for _ in range(200):
            if cls.process.poll() is not None:
                raise RuntimeError('Isolated backend exited during startup: ' + (cls.directory / 'server.log').read_text())
            try:
                with cls.opener.open(cls.url + '/api/v1/health', timeout=1):
                    return
            except (OSError, urllib.error.URLError):
                time.sleep(.025)
        raise RuntimeError('Isolated backend did not become ready')

    @classmethod
    def stop(cls):
        cls.process.terminate()
        try:
            cls.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.process.kill()
            cls.process.wait()

    @classmethod
    def tearDownClass(cls):
        cls.stop()
        cls.log.close()
        cls.tmp.cleanup()

    def call(self, method, path, body=None, status=200, origin=True, contract_path=None):
        headers = {'Content-Type': 'application/json'}
        if origin:
            headers['Origin'] = self.url
        request = urllib.request.Request(self.url + '/api/v1' + path, data=None if body is None else json.dumps(body).encode(), method=method, headers=headers)
        try:
            response = self.opener.open(request, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            self.assertEqual(response.code, status)
            raw = response.read()
            is_json = 'application/json' in response.headers.get('Content-Type', '')
        value = json.loads(raw) if raw and is_json else None
        op = SPEC['paths'][contract_path or path][method.lower()]
        if status < 300 and status != 204:
            validate(value, op['responses'][str(status)]['content']['application/json']['schema'])
        return value

    def new_body(self):
        return {'id': str(uuid.uuid4()), 'title': 'Synthetic ticket', 'description': 'Preserve this Markdown', 'status': 'backlog', 'priority': 'normal', 'context': {}, 'checklist': [{'id': 'one', 'text': 'Retain this check', 'done': False}]}

    def test_served_contract_and_discovery(self):
        self.assertEqual(self.call('GET', '/openapi.json'), SPEC)
        self.assertEqual(self.call('GET', '/hosts'), [])
        self.assertEqual(self.call('GET', '/queue')['hosts'], [])
        self.assertEqual(self.call('GET', '/board/activity')['items'], {})

    def test_ticket_full_crud_conflicts_delete_and_restart(self):
        body = self.new_body()
        self.call('POST', '/board/tickets', body, status=403, origin=False)
        t = self.call('POST', '/board/tickets', body)
        path = '/board/tickets/' + t['id']
        detail_path = '/board/tickets/{id}'
        self.assertEqual(self.call('GET', path, contract_path=detail_path)['checklist'], t['checklist'])
        self.call('POST', '/board/tickets', body, status=409)
        self.call('POST', '/board/tickets', {**body, 'revision': 'stale'}, status=409)
        edited = {k: t[k] for k in ['id', 'revision', 'title', 'description', 'status', 'priority', 'context', 'checklist']}
        edited['title'] = 'Edited synthetic ticket'
        saved = self.call('POST', '/board/tickets', edited)
        self.assertEqual(saved['description'], body['description'])
        self.assertEqual(saved['number'], t['number'])
        self.assertNotEqual(saved['revision'], t['revision'])
        move_path = path + '/move'
        moved = self.call('POST', move_path, {'revision': saved['revision'], 'status': 'ready'}, contract_path=detail_path + '/move')
        self.assertEqual(moved['status'], 'ready')
        self.call('POST', move_path, {'revision': saved['revision'], 'status': 'done'}, status=409, contract_path=detail_path + '/move')
        self.call('DELETE', path, {'revision': saved['revision']}, status=409, contract_path=detail_path)
        self.call('DELETE', path, {'revision': moved['revision']}, status=204, contract_path=detail_path)
        self.call('GET', path, status=404, contract_path=detail_path)
        self.assertNotIn(t['id'], [v['id'] for v in self.call('GET', '/board/tickets')['tickets']])
        self.call('POST', '/board/tickets', body, status=409)
        self.stop()
        self.start()
        self.call('GET', path, status=404, contract_path=detail_path)
        newer = self.call('POST', '/board/tickets', self.new_body())
        self.assertGreater(newer['number'], t['number'])
        with sqlite3.connect(self.config.with_suffix('.board.sqlite3')) as db:
            retained = json.loads(db.execute('SELECT data FROM tickets WHERE id=?', (t['id'],)).fetchone()[0])
            self.assertEqual(retained['description'], body['description'])

    def test_review_status_create_move_edit_and_restart(self):
        body = {**self.new_body(), 'status': 'review'}
        t = self.call('POST', '/board/tickets', body)
        path = '/board/tickets/' + t['id']
        contract = '/board/tickets/{id}'
        self.assertEqual(t['status'], 'review')
        self.stop()
        self.start()
        t = self.call('GET', path, contract_path=contract)
        self.assertEqual(t['status'], 'review')
        for status in ('in_progress', 'review', 'done'):
            previous = t['revision']
            t = self.call('POST', path + '/move', {'revision': previous, 'status': status}, contract_path=contract + '/move')
            self.assertEqual(t['status'], status)
            self.assertEqual(t['runs'], [])
            self.call('POST', path + '/move', {'revision': previous, 'status': 'review'}, status=409, contract_path=contract + '/move')
        edited = {k: t[k] for k in ['id', 'revision', 'title', 'description', 'status', 'priority', 'context', 'checklist']}
        edited['status'] = 'review'
        self.assertEqual(self.call('POST', '/board/tickets', edited)['status'], 'review')
        self.assertEqual(next(v for v in self.call('GET', '/board/tickets')['tickets'] if v['id'] == t['id'])['status'], 'review')

    def test_schema_rejects_partial_updates_and_server_fields(self):
        body = self.new_body()
        for invalid in ({'id': body['id'], 'title': 'Partial'}, {**body, 'runs': []}, {**body, 'status': 'invented'}):
            with self.assertRaises(ValidationError):
                validate(invalid, {'$ref': '#/components/schemas/TicketChange'})
        self.call('POST', '/board/tickets', {**body, 'runs': []}, status=422)
        self.call('POST', '/board/tickets', {**body, 'title': 'é' * 121}, status=400)
        self.call('POST', '/board/tickets', {**body, 'status': 'invented'}, status=400)

    def test_coordinator_cli_crud_on_fixture_only(self):
        tool = ROOT / 'coordinator/tools/cc_board.py'
        def run(*args, success=True):
            result = subprocess.run([sys.executable, '-B', str(tool), '--url', self.url, *args], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0 if success else 1, result.stderr)
            return json.loads(result.stdout) if success else result.stderr
        body = self.new_body()
        input_path = self.directory / 'input.json'
        input_path.write_text(json.dumps(body))
        saved = run('create', '--input', str(input_path))
        self.assertEqual(run('get', '--ticket', body['id'])['revision'], saved['revision'])
        changed = {**body, 'revision': saved['revision'], 'title': 'CLI edited'}
        input_path.write_text(json.dumps(changed))
        updated = run('update', '--input', str(input_path))
        self.assertIn('409', run('update', '--input', str(input_path), success=False))
        moved = run('move', '--ticket', body['id'], '--revision', updated['revision'], '--status', 'review')
        self.assertEqual(moved['status'], 'review')
        self.assertTrue(run('delete', '--ticket', body['id'], '--revision', moved['revision'])['deleted'])
        self.assertIn('404', run('get', '--ticket', body['id'], success=False))
        self.assertIn('tickets', run('list'))


if __name__ == '__main__':
    unittest.main()
