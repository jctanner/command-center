# Task 0014: Discover agents behind foreground wrappers

Owner: CC dev
Claimed: 2026-11-05
State: done
Completed: 2026-11-05

## Goal

Expose local-machine reported agent's wrapped Claude without guessing from terminal text/history. Detect a unique supported CLI under the pane's foreground process-group wrapper, with matching controlling terminal/stdin and verified ancestry/PID-start identities. Batch pane discovery once per host, retain existing resource limits and direct-agent identity hashes/preferences, and re-use the same resolver for status/input/restart guards. Reject background groups, ambiguous candidates and process races. Fixture-only mutation tests; live verification read-only.

## Implementation

A shared kernel-backed resolver verifies pane/group-leader ancestry and start identities, then resolves either a supported group leader or one unique supported descendant with matching process group, controlling tty and character-device stdin. Descendant CLIs beneath an already identified primary are not extra cards. Bounds are 32 ancestry/descendant nodes and 256 distinct live panes per batched discovery. Background groups, other terminals, redirected stdin, ambiguous candidates and PID races fail closed. Existing status/history/message/approval/restart paths all call observe and therefore share this proof.

Queue performs one discovery request per host rather than one per shell pane, retains the tmux-name fallback and its existing scan limits, and labels wrapped cards by detected provider. Direct identity hashing is unchanged; wrapped identity binds child PID/start plus wrapper start. No shell script contents or arbitrary command/prompt arguments are exposed by discovery.

## Validation and deployment

58 agent Python tests passed, including unique wrapper resolution, background/TTY/stdin exclusions, ambiguity, PID reuse, limits, primary-CLI selection and exact legacy direct identity hashing. All 39 Rust library tests, formatting, Clippy -D warnings and release build passed. Ten fixture real-tmux/browser checks passed (19.7s), including wrappers for all three harnesses, safe explicit resume, background/ambiguous exclusions and existing restart/metadata/no-replay/recovery checks. An old browser fixture needed an explicit reload after its backend restart to avoid intentionally stale revisions; corrected the fixture, preserving production guards. Existing local/SSH live-agent history/draft/navigation regression passed (3.0s). No live process mutations in tests.

Read-only verification before deployment resolved the actual reported reported agent wrapper to its Claude child. After deploying/restarting only CC, local-machine reported agent reported pane appears as Claude and reports Ready. Three existing local agent instance hashes and card settings were checked unchanged. HTTPS healthy; no agent input, agent restart or tmux layout change. The reported agent's conversation association remains none at verification: discovery does not invent a native history link.

## Handoff

The card should appear on normal queue refresh under All agents for local-machine. Native history can link separately when its existing evidence is available; do not guess from cwd or script names. Next task 0015; next bug 0010. Task 0009's unrelated legacy receipt review remains pending.
