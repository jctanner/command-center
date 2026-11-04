"""Register this Codex tool's session with CC; no model calls or terminal input."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile


def process(pid):
    base = Path('/proc') / str(pid)
    fields = (base / 'stat').read_text().rsplit(')', 1)[1].split()
    return base, fields


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--external-tool-runner', action='store_true', help='Explicitly trust the Codex-provided session/pane environment when a delegated tool runner is outside the CLI process tree')
    options = parser.parse_args()
    session = os.environ.get('CODEX_THREAD_ID') or os.environ.get('CODEX_SESSION_ID', '')
    pane = os.environ.get('TMUX_PANE', '')
    if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', session) or not re.fullmatch(r'%[0-9]+', pane):
        raise SystemExit('Run from a Codex tool command inside its tmux pane.')
    shell = int(subprocess.check_output(['tmux', 'display-message', '-p', '-t', pane, '#{pane_pid}'], text=True, timeout=5).strip())
    _, shell_fields = process(shell)
    pid = int(shell_fields[5])
    base, fields = process(pid)
    # Ordinary tools require ancestry. Delegated runners require an explicit
    # registration choice, still bound to the owned foreground process and cwd.
    ancestor = os.getpid()
    for _ in range(64):
        if ancestor == pid: break
        _, parent_fields = process(ancestor)
        ancestor = int(parent_fields[1])
        if ancestor <= 1: break
    if ancestor != pid and not options.external_tool_runner:
        raise SystemExit('Tool runner is outside the Codex process tree; explicit --external-tool-runner is required.')
    if (base / 'comm').read_text().strip() != 'codex' or base.stat().st_uid != os.geteuid():
        raise SystemExit('Pane foreground process is not this user’s Codex.')
    cwd = os.path.realpath(base / 'cwd')
    if cwd != os.path.realpath(Path.cwd()): raise SystemExit('Run from the Codex project directory.')
    home = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))).expanduser()
    directory = home / 'command-center-sessions'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_uid != os.geteuid() or directory.stat().st_mode & 0o077:
        raise SystemExit('Registration directory must be private and owned by this user.')
    record = dict(schema=1, pid=pid, proc_start=fields[19],
                  boot_id=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                  tmux_pane=pane, cwd=cwd, session_id=session)
    if process(pid)[1][19] != fields[19]: raise SystemExit('Codex process changed during registration.')
    fd, temporary = tempfile.mkstemp(prefix='.register-', dir=directory)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(record, output)
        os.replace(temporary, directory / f'{pid}.json')
    finally:
        Path(temporary).unlink(missing_ok=True)
    print('Registered this live Codex session with Command Center.')


if __name__ == '__main__':
    main()
