"""Profile API schemas match normalized configuration and reject unstructured overrides."""
import importlib.util
import json
from pathlib import Path
import unittest
from jsonschema import ValidationError
from test_openapi import validate
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('container_profiles',ROOT/'src/acp_container.py')
c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
class ProfilesContract(unittest.TestCase):
 def test_normalized_settings_and_review(self):
  p=c.normalize_profile(dict(id='goose-example',label='Example',image=c.IMAGE))
  snapshot=dict(revision='absent',profiles=[p])
  validate(snapshot,{'$ref':'#/components/schemas/AcpContainerSettings'})
  validate(dict(snapshot,connection_revision='observed'),{'$ref':'#/components/schemas/AcpContainerSettingsSave'})
  validate(c.summary(p),{'$ref':'#/components/schemas/AcpContainerProfile'})
  prepared=dict(container_config=p,container_image_id='a'*64,container_mounts=[],container_engine_scope={'root':'fixture'})
  validate(c.resolved_review(prepared),{'$ref':'#/components/schemas/AcpContainerReview'})
 def test_only_structured_launch_overrides(self):
  schema={'$ref':'#/components/schemas/AcpContainerOverrides'}
  validate(dict(engine='docker',network='none',args=['acp'],memory_mb=512),schema)
  for value in [dict(id='replacement'),dict(runtime_flags=['--privileged']),dict(memory_mb=1),dict(engine='remote')]:
   with self.assertRaises(ValidationError):validate(value,schema)
