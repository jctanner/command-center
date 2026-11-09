"""Codex policy support is explicit and checked before tmux mutation."""
import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('agent', Path(__file__).parents[1] / 'src/agent_remote.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

class LaunchPolicy(unittest.TestCase):
    def test_policy_values_are_closed_and_provider_specific(self):
        for kind in ('codex', 'claude', 'pi'):
            for value in (None, '', 'default'):
                self.assertIsNone(a.launch_approval_policy(kind, value))
        self.assertEqual(a.launch_approval_policy('codex', 'approve-for-me'), 'approve-for-me')
        for kind, value in [('pi', 'approve-for-me'), ('claude', 'approve-for-me'), ('codex', 'never'), ('codex', ['approve-for-me']), ('codex', '--approve-for-me')]:
            with self.assertRaises(a.Failure):
                a.launch_approval_policy(kind, value)

    def test_exact_flags_and_defaults(self):
        result = subprocess.CompletedProcess([], 0, b'Options:\n --no-daemon\n --approve-for-me\n')
        with patch.object(a.subprocess, 'run', return_value=result) as run:
            self.assertEqual(a.codex_launch_flags('/literal/codex', 'approve-for-me'), ['--no-daemon', '--approve-for-me'])
            self.assertEqual(a.codex_launch_flags('/literal/codex', None), ['--no-daemon'])
            self.assertEqual(run.call_args.args[0], ['/literal/codex', '--help'])
            self.assertEqual(run.call_args.kwargs['timeout'], 2)

    def test_missing_misleading_failed_and_timed_out_help_fail_closed(self):
        for text, rc in [(b'--approve-for-me-extra', 0), (b'--approve-for-me', 1), (b'Old CLI', 0)]:
            with patch.object(a.subprocess, 'run', return_value=subprocess.CompletedProcess([], rc, text)):
                with self.assertRaises(a.Failure):
                    a.codex_launch_flags('/codex', 'approve-for-me')
                self.assertEqual(a.codex_launch_flags('/codex', None), [])
        with patch.object(a.subprocess, 'run', side_effect=subprocess.TimeoutExpired('codex', 2)):
            with self.assertRaises(a.Failure):
                a.codex_launch_flags('/codex', 'approve-for-me')

    def test_start_rechecks_support_before_creating_any_tmux_target(self):
        request = dict(launch_id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',project='/project',provider='codex',directory_identity='dir',executable='/codex',executable_identity='exe',approval_policy='approve-for-me')
        with patch.object(a, 'launch_status', return_value={'found':False}), patch.object(a, 'launch_destination', return_value=(None,None)), patch.object(a, 'project_directory', return_value=('/project','dir')), patch.object(a, 'launch_executable', return_value=('/codex','exe','/bin')), patch.object(a.subprocess, 'run', return_value=subprocess.CompletedProcess([],0,b'Old CLI')), patch.object(a, 'tmux') as tmux:
            with self.assertRaises(a.Failure):
                a.launch_agent(request)
            tmux.assert_not_called()

if __name__ == '__main__':
    unittest.main()
