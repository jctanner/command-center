# Task 0074: Maximize the tmux workspace

Owner: CC dev
Claimed: 2026-11-16
State: done (staged; not deployed)

Add a browser-local maximize/restore button hiding global navigation and machine tabs. Keep session/window controls and restore accessible. Preserve the terminal viewer, selection, pane zoom, processes and native Escape behavior. Clear the mode on workspace exit or compact viewport. No browser Fullscreen API. Validate with isolated tmux/Playwright and staged frontend build; no live deployment authorized.

## Implementation and verification

The session/window toolbar now contains Maximize tmux / Restore tmux. CSS hides only the global header and machine tabs; existing ResizeObserver refits the same viewer. The mode is browser-local, clears on workspace exit or compact layout, and does not intercept Escape or invoke browser fullscreen. No backend changes.

- `TMPDIR=/var/tmp npm --prefix web run build -- --outDir dist-next`: passed TypeScript and Vite; existing bundle warnings remain.
- `TMPDIR=/var/tmp CC_BINARY=../target/release/command-center CC_WEB_DIR=dist-next npm --prefix web run test -- tmux.spec.ts -g 'maximize tmux|compact clients never|tabbed terminal input'`: all 3 passed using an isolated backend and disposable tmux socket.
- New regression verifies >100px reclaimed height, restore geometry, visible session/window controls, no extra viewer socket, stable real session/window/pane/PID identities and pane zoom, native Escape, route exit and mobile reset. Existing test verifies a simultaneous compact client cannot constrain the desktop terminal.
- Initial test incorrectly included the private viewer session in its process snapshot; compact detachment correctly removes it. Scoped the snapshot to the real project session and reran successfully.

No live deployment, commit or push performed. Staged assets are in ignored web/dist-next.
