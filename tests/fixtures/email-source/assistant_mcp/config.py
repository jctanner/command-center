from types import SimpleNamespace
from pathlib import Path
import json
def load_config():
 f=json.loads(Path('fixture.json').read_text());return SimpleNamespace(services=SimpleNamespace(gmail=SimpleNamespace(enabled=f.get('enabled',True))))
def load_env_config():return SimpleNamespace(gdocs_token_file='token.json')
