"""Provider-specific mode-switch guards; no live providers or transport."""
import importlib.util
import unittest
import os
import tempfile
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
    def run_observation(self, candidates=None, continuation='continued-thread', tools=None, receipts=None, command_running=False):
        request = dict(identity='source', broker_instance='instance', session='$1', window='@1', pane='%1')
        snapshot = dict(provider='claude', handoff_supported=True, state='ready',
                        command_running=command_running, permissions=[], tools=tools or [], receipts=receipts or [], session_id='original-thread', path='/project')
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

    def test_withdrawn_prompts_do_not_block_handoff_but_queued_or_uncertain_do(self):
        for state in ('completed','cancelled','expired'):
            self.run_observation([{'linked':True,'session':'continued-thread'}],receipts=[dict(kind='prompt',state=state)])
        for kind in ('prompt','harness_command'):
            for state in ('queued','claimed','uncertain','blocked'):
                with self.subTest(kind=kind,state=state),self.assertRaisesRegex(ValueError,'receipts'):
                    self.run_observation(receipts=[dict(kind=kind,state=state)])

    def test_local_command_and_queued_shell_receipts_block_handoff(self):
        with self.assertRaisesRegex(ValueError,'local command'):
            self.run_observation(command_running=True)
        for state in ('queued','submitted','blocked','uncertain'):
            with self.subTest(state=state), self.assertRaisesRegex(ValueError,'receipts'):
                self.run_observation(receipts=[dict(kind='local_command',state=state)])

    def test_in_progress_tools_block_before_mapping_or_handoff(self):
        with self.assertRaisesRegex(ValueError, 'tools to finish'):
            self.run_observation(tools=[{'status': 'in_progress'}])


class RecoveryGuards(unittest.TestCase):
    def check(self, live_pid=2147483647, child_pid=2147483646, linked_session='thread', identity='new', changed=False):
        expected=dict(identity='old',provider='claude',project='/project',session='thread')
        request=dict(mode='acp',broker=None,id='original',identity='new',session='$1',window='@1',pane='%1',plan=expected)
        observation=dict(identity=identity,kind='claude',cwd='/project')
        observations=iter([observation,dict(observation,identity='changed')if changed else observation])
        a={'observe':lambda _:next(observations),'provider_home':lambda _:Path('/home'),
           'claude_current_session':lambda *_:'thread',
           'conversations':lambda _:[dict(linked=True,session=linked_session,id='conversation')]}
        def read(path):
            if path.endswith('target.json'):return request
            if path.endswith('intent.json'):return dict(resume_session='thread')
            return dict(boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),pid=live_pid,agent_pid=child_pid)
        b={'target_root':lambda _:'/private/original','read_json':read}
        return mode.recover(request,a,b)

    def test_resolve_only_proven_native_recovery_without_mutation(self):
        self.assertEqual(self.check()['state'],'recovered')

    def test_running_original_broker_or_adapter_blocks_resolution(self):
        for kwargs in ({'live_pid':os.getpid()},{'child_pid':os.getpid()}):
            with self.subTest(kwargs=kwargs),self.assertRaisesRegex(ValueError,'still running'):
                self.check(**kwargs)

    def test_wrong_or_replaced_native_process_and_conversation_rejected(self):
        for kwargs in ({'identity':'old'},{'identity':'stale'},{'linked_session':'unrelated'},{'changed':True}):
            with self.subTest(kwargs=kwargs),self.assertRaises(ValueError):self.check(**kwargs)


if __name__ == '__main__': unittest.main()


class BrokerRestartPlan(unittest.TestCase):
    def plan(self, code='reviewed source', prepared=None, probe=False):
        request=dict(mode='acp_restart',broker='old',pane='%1',_broker_code=code)
        a={'tmux':lambda *args:'123','proc':lambda pid:(None,'start')}
        b={'target_root':lambda req:'/broker','read_json':lambda path:{'prepared':prepared or {}},
           'options':lambda req:dict(executable='/adapter',provider='claude',path='/project')}
        with patch.object(mode,'broker_observation',return_value={'project':'/project','provider':'claude','session':'same'}):
            return mode.plan(request,a,b,probe)

    def test_restart_binds_exact_broker_source_and_session(self):
        first=self.plan();second=self.plan('changed source')
        self.assertEqual('same',first['session']);self.assertEqual('acp_restart',first['mode'])
        self.assertNotEqual(first['broker_digest'],second['broker_digest'])
        self.assertEqual('/adapter',first['adapter']['executable'])

    def test_container_profile_restart_cannot_escape_to_host(self):
        for key in ('profile','container','container_profile'):
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'no host fallback'):
                self.plan(prepared={key:'managed'})

    def test_changed_plan_rejects_before_any_terminal_mutation(self):
        request={'plan':{'broker_digest':'old'},'mode':'acp_restart'}
        with patch.object(mode,'plan',return_value={'broker_digest':'new'}),self.assertRaisesRegex(ValueError,'changed'):
            mode.perform_start(request,{}, {},{'mutating':False})
