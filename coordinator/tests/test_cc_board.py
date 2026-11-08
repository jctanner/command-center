import io
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock
import urllib.error

sys.path.insert(0, str(Path(__file__).parents[1] / 'tools'))
from cc_board import BoardClient
from cc_read import ReadError


class BoardWrites(unittest.TestCase):
    def test_uncertain_delivery_is_never_retried(self):
        client = BoardClient('http://127.0.0.1:8080')
        client.opener = Mock()
        client.opener.open.side_effect = urllib.error.URLError('private transport detail')
        with self.assertRaisesRegex(ReadError, 'Delivery uncertain') as error:
            client.mutate('POST', 'board/tickets', {'id': 'fixture'})
        self.assertNotIn('private transport detail', str(error.exception))
        client.opener.open.assert_called_once()
        request = client.opener.open.call_args.args[0]
        self.assertEqual(request.headers['Origin'], 'http://127.0.0.1:8080')
        self.assertEqual(request.method, 'POST')

    def test_conflict_preserves_draft_and_does_not_retry(self):
        client = BoardClient('https://cc.example')
        client.opener = Mock()
        client.opener.open.side_effect = urllib.error.HTTPError(client.url, 409, 'Conflict', {}, io.BytesIO(b'private raw error'))
        body = {'revision': 'observed', 'status': 'ready'}
        with self.assertRaisesRegex(ReadError, 'Keep your draft'):
            client.mutate('POST', 'board/tickets/fixture/move', body)
        self.assertEqual(body, {'revision': 'observed', 'status': 'ready'})
        client.opener.open.assert_called_once()

    def test_server_failure_is_uncertain_not_safe_to_resend(self):
        client = BoardClient('https://cc.example')
        client.opener = Mock()
        client.opener.open.side_effect = urllib.error.HTTPError(client.url, 503, 'Failure', {}, io.BytesIO())
        with self.assertRaisesRegex(ReadError, 'delivery uncertain'):
            client.mutate('DELETE', 'board/tickets/fixture', {'revision': 'observed'})
        client.opener.open.assert_called_once()

    def test_oversize_input_never_reaches_transport(self):
        client = BoardClient('https://cc.example')
        client.opener = Mock()
        with self.assertRaisesRegex(ReadError, 'nothing was sent'):
            client.mutate('POST', 'board/tickets', {'description': 'x' * 131072})
        client.opener.open.assert_not_called()


if __name__ == '__main__':
    unittest.main()
