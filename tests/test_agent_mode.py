"""Provider-specific mode-switch guards; no live providers or transport."""
import importlib.util
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('agent_mode', Path(__file__).parents[1] / 'src/agent_mode_remote.py')
mode = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mode)


class NativeIdleGuards(unittest.TestCase):
    def check(self, tasks=None, state='ready', dialog=False, kind='claude'):
        helpers = {'provider_activity': lambda _: {'state': state},
                   'native_input_dialog': lambda _: dialog,
                   'conversations': lambda _: [{'linked': True}],
                   'observed_background_tasks': lambda *_: tasks}
        mode.idle_native(helpers, {'kind': kind, 'identity': 'verified', 'in_mode': False})

    def test_claude_idle_and_bounded_completed_tasks_allowed(self):
        self.check()
        self.check({'limited': True, 'tasks': [{'state': 'completed'}]})

    def test_claude_active_or_unverified_background_tasks_block(self):
        for state in ('running', 'waiting', 'unverified'):
            with self.subTest(state=state), self.assertRaisesRegex(ValueError, 'background tasks'):
                self.check({'tasks': [{'state': state}]})
        with self.assertRaisesRegex(ValueError, 'background tasks'):
            self.check({'unavailable': True})

    def test_working_dialogs_and_unsupported_provider_block(self):
        with self.assertRaises(ValueError): self.check(state='working')
        with self.assertRaises(ValueError): self.check(dialog=True)
        with self.assertRaises(ValueError): self.check(kind='pi')

    def test_codex_does_not_use_claude_background_evidence(self):
        self.check(kind='codex', tasks={'unavailable': True})


class ClaudeBrokerMapping(unittest.TestCase):
    def run_observation(self, candidates=None, continuation='continued-thread', tools=None):
        request = dict(identity='source', broker_instance='instance', session='$1', window='@1', pane='%1')
        snapshot = dict(provider='claude', handoff_supported=True, state='ready',
                        permissions=[], tools=tools or [], receipts=[], session_id='original-thread', path='/project')
        a = {'provider_home': lambda _: '/private/claude',
             'claude_current_session': lambda *args: continuation,
             'conversations': lambda _: candidates or [],
             'restart_plan': lambda req, observed: {'provider': observed['kind'], 'session': continuation}}
        b = {'target_root': lambda _: '/broker',
             'verified_live': lambda _: dict(instance='instance', pid=123, start='1', boot='boot', agent_pid=124),
             'verify_target': lambda *args: None,
             'read_json': lambda _: request,
             'call': lambda _: snapshot, 'canonical_uuid': lambda _: None}
        with patch.object(Path, 'read_bytes', return_value=b'CLAUDE_CONFIG_DIR=/private/claude\0'):
            return mode.broker_observation(request, a, b)

    def test_only_verified_continuation_is_accepted(self):
        result = self.run_observation([{'linked': True, 'session': 'continued-thread'}])
        self.assertEqual(result['session'], 'continued-thread')
        self.assertEqual(result['acp_session'], 'original-thread')

    def test_missing_unlinked_or_wrong_native_conversation_rejected(self):
        for candidates in ([], [{'linked': False, 'session': 'continued-thread'}],
                           [{'linked': True, 'session': 'different-thread'}]):
            with self.subTest(candidates=candidates), self.assertRaisesRegex(ValueError, 'persisted native conversation'):
                self.run_observation(candidates)
        with self.assertRaisesRegex(ValueError, 'continuation chain'):
            self.run_observation(continuation=None)

    def test_in_progress_tools_block_before_mapping_or_handoff(self):
        with self.assertRaisesRegex(ValueError, 'tools to finish'):
            self.run_observation(tools=[{'status': 'in_progress'}])


if __name__ == '__main__': unittest.main()
