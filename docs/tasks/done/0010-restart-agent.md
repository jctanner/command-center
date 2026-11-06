# Task 0010: Restart an agent in its tmux pane

Owner: CC dev
Claimed: 2026-11-05
State: done
Completed: 2026-11-05

## Goal and acceptance

Explicit card-menu/mobile Details Restart resumes the unique process-linked Codex/Claude/Pi conversation in the same pane/cwd. Preview/confirmation binds process, session, installation and endpoint. Replace the selected pane process tree using structured tmux respawn arguments; disclose this scope and leave sibling panes/windows alone. Persist a one-use restart receipt before transport IO; uncertain results are checked, never retried. Copy name/notes/color/pin only after verified restart and never overwrite subsequent edits. Keep all old outbox receipts/drafts for review with no replay. Test synthetic harnesses and isolated tmux, not live agents. Deploy after required checks.

## Implementation

Added Restart agent to desktop card actions and phone Details. The Cancel-focused confirmation shows the native session, cwd and literal resume argv and discloses interruption of this pane's shell/agent/children. Other panes/windows and target IDs remain. Requires unique process-linked history; no latest-session guess. Codex uses resume UUID, Claude --resume UUID and Pi --session its verified log path. Provider homes are retained; no prompt replay or arbitrary shell commands.

Preparation binds original process, exact session/log inode, directory and installation. A bounded private agent_restarts table stores one-use receipts, claimed before IO under the machine write lock. The helper rechecks immediately before structured respawn-pane and leaves remain-on-exit enabled on that pane. Subsequent status calls require the new process's restart ID, pane marker, cwd and exact linked conversation. Only then copy card name/notes/color/pin, retaining newer edits and the existing metadata limit. Pending outbox/drafts stay with the old instance for review, never automatically retargeted.

An opaque browser operation ID supports recovery after lost responses and reloads; read-only status never reruns respawn. Bug 0006 exposed ephemeral revision misuse; recovery now checks a durable endpoint fingerprint while starting still checks the fresh connection revision. The additive receipt table remains compatible with version-2 readers.

## Validation and deployment

45 agent Python checks passed, including exact provider argv, missing/ambiguous links, stale process/final race, marker and session guards. All 38 Rust library checks, formatting and Clippy -D warnings passed. Frontend TypeScript/Vite and release builds passed. Five isolated browser/real-tmux integration checks passed (13.3s): all three harnesses preserve pane and sibling PID/card settings; Cancel is inert; duplicate starts are rejected across backend restart; stale preview never kills replacement; old queued input becomes blocked without replay; phone lost-response recovery survives backend/page restart with exactly one POST and zero terminal attachments. Phone screenshot inspected. Fake CLIs were used; no live agents restarted.

Deployed frontend/backend, HTTPS index verified, private pre-deploy SQLite backup saved outside Git with mode 0600. Live restart-operation count zero. Task 0009's unrelated legacy receipt decision remains pending.

## Handoff

Reload app, then right-click a card > Restart agent, or phone Details > Restart agent. Inspect the confirmation and explicitly restart the intended agent. If result is uncertain, Check restart status or inspect the pane; never blindly repeat. The original browser can recover its opaque receipt on reload. Unsupported/unlinked sessions fail before mutation. Next task 0011; next bug 0007.
