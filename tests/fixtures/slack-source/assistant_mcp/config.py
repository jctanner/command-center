from types import SimpleNamespace as N
import json
from pathlib import Path
def load_config():
    data=json.loads(Path('fixture.json').read_text())
    return N(services=N(slack=N(enabled=data.get('enabled',True))),permissions=N(slack=N(allow_write=data.get('allow_write',True))))
def load_env_config():
    return N(slack_xoxc_token='FAKE_AUTH_SECRET',slack_xoxd_token='FAKE_COOKIE_SECRET')
