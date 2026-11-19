import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch, mock_open

ROOT=Path(__file__).parents[1]

class RuntimeTests(unittest.TestCase):
    def test_elapsed_time_and_unavailable_are_consistent_for_native_and_acp(self):
        for name in ('agent_remote','acp_remote'):
            spec=importlib.util.spec_from_file_location(name,ROOT/'src'/f'{name}.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            with self.subTest(helper=name),patch.object(module.os,'sysconf',return_value=100):
                with patch('builtins.open',mock_open(read_data='1000.5 400.0')):
                    self.assertEqual(module.process_runtime_seconds('10000'),900)
                    self.assertIsNone(module.process_runtime_seconds('100100'))
                    self.assertIsNone(module.process_runtime_seconds('-10'))
                    self.assertIsNone(module.process_runtime_seconds('invalid'))
                with patch('builtins.open',side_effect=OSError('unavailable')):
                    self.assertIsNone(module.process_runtime_seconds('10000'))

if __name__=='__main__':unittest.main()
