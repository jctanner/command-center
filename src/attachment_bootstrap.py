"""Separate bounded transport envelope; ordinary agent requests retain 160KiB."""
import json
import sys

try:
    body = sys.stdin.buffer.read(6 * 1024 * 1024 + 1)
    if len(body) > 6 * 1024 * 1024:
        raise ValueError('Request too large')
    request = json.loads(body)
    agent = {'__name__': 'cc_attachment_agent'}
    fs = {'__name__': 'cc_attachment_files'}
    exec(request.pop('_agent_code'), agent)
    exec(request.pop('_attachment_code'), fs)
    operation = request['operation']
    if operation not in ('prepare', 'copy', 'verify', 'cleanup'):
        raise ValueError('Unsupported attachment operation')

    def check_target():
        observation = agent['observe'](request)
        if not observation['identity'] or observation['identity'] != request['identity']:
            raise ValueError('Agent process changed')
        linked = [c for c in agent['conversations'](observation) if c.get('linked')]
        if len(linked) != 1 or linked[0]['id'] != request['conversation']:
            raise ValueError('Process-linked conversation changed')

    if operation == 'cleanup':
        result = fs['cleanup'](request['manifest'])
    else:
        check_target()
        if operation == 'prepare':
            result = {'home': fs['inspect_root']()}
        elif operation == 'copy':
            result = fs['copy'](request['manifest'], request['payload'])
        else:
            result = fs['verify'](request['manifest'])
        check_target()
    response = {'ok': result}
except Exception:
    # Paths, credentials, content and provider exceptions never leave this helper.
    response = {'status': 409, 'error': 'Attachment operation could not be verified; inspect the retained receipt. No automatic retry.'}
json.dump(response, sys.stdout, ensure_ascii=True)
