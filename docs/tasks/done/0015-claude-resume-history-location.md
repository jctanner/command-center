# Task 0015: Auto-link resumed Claude history across project locations

Owner: CC dev
Claimed: 2026-11-05
State: done
Completed: 2026-11-05

## Goal

Automatically select reported agent's exact process-proven native session when its log remains in an old project folder. Use only validated runtime session IDs/explicit CLI resume IDs; never newest/cwd guesses. Bound exact-filename lookup, verify header UUID and path containment, reject ambiguity and preserve continuation guards. No agent input/restart or registry rewrites.

## Findings and resolution

The active process registry and startup resume argument agree, but the exact file remains in a former repository's project folder. Add a bounded exact-UUID file resolver: validate a current-project file first or accept one safe regular fallback file under the projects root, matching native UUID metadata. Duplicate fallback matches fail closed; no newest-log/cwd guessing. Follow continuation edges only within the actual resolved log folder. Verified live registry identity wins over stale startup resume arguments.

Preserve native registry evidence when no file has been persisted yet. Log-derived events use only the validated resolved path, never an unsafe fallback path. No registry, logs, input receipts or agent processes are rewritten. Candidate ordering keeps the process-linked file available before unrelated current-project histories, enabling existing default auto-selection.

## Validation and deployment

All 58 agent Python checks and 12 Claude continuation checks passed, including cross-project auto-selection, exact continued session, duplicate fallback rejection, mismatched UUID/symlink rejection, stale startup arguments, no-log idle status and existing process/domain/target guards. Release build/diff check passed. Two real-tmux/browser checks passed (3.0s): wrapped Claude safe resume and old-repository history automatically selected/displayed without manual selection. Read-only validation against the actual reported agent process found one exact native candidate.

Deployed by restarting only CC with existing arguments. Live conversation API without a requested conversation now returns association=process and selects its single verified native session. Agent instance hash and card preferences unchanged; HTTPS healthy. No agent restart, terminal input, registry edits or log migration performed. This resolves Task 0014's previously recorded unlinked-history limitation.

## Handoff

Normal queue refresh/reopening reported agent should show its native history selected automatically. Explicit human project-history selections remain explicit; ambiguous/unproven logs still require review. Next task 0016; next bug 0011. Task 0009's unrelated legacy receipt choice remains pending.
