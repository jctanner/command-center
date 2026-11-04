import json
from pathlib import Path
from types import SimpleNamespace as N
def fixture():return json.loads(Path('fixture.json').read_text())
def load_config():
 f=fixture();return N(services=N(jira=N(enabled=f.get('enabled',True))),permissions=N(jira=N(allow_read=f.get('allow_read',True))))
def load_env_config():
 f=fixture();return N(jira_url='https://fixture.atlassian.net' if f.get('cloud',True) else 'https://jira.example.test',jira_email='fixture@example.test',jira_api_token='PRIVATE_JIRA_TOKEN' if f.get('credentials',True) else None)
