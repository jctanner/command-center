"""Explicit preparation consent; no bypass flags, config writes or pi support."""
import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('agent',Path(__file__).parents[1]/'src/agent_remote.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class PreTrust(unittest.TestCase):
 def test_default_off(self):
  for kind in ('codex','claude','pi'):
   for value in (None,False):self.assertFalse(a.launch_pre_trust(kind,value))
 def test_supported_native_profiles_only(self):
  for kind in ('codex','claude'):self.assertTrue(a.launch_pre_trust(kind,True))
  with self.assertRaises(a.Failure):a.launch_pre_trust('pi',True)
 def test_closed_boolean_values(self):
  for value in ('true',1,{},[]):
   with self.assertRaises(a.Failure):a.launch_pre_trust('codex',value)
if __name__=='__main__':unittest.main()
