# Task 0036: Coordinator Codex approval policy

Owner: CC dev
Claimed: 2026-11-08
State: done

Update launch instructions to request Codex --approve-for-me, verify installed CLI semantics, and describe the current launcher limitation without inventing API fields or weakening launch guards.

Validation: installed `codex --help` confirms the exact flag and workspace-write/automatic-review semantics. Inspected src/agent_remote.py launch_agent: it probes --no-daemon but has no approval-policy flag. Updated cc-launch, coordinator CLAUDE entry point and launch reference to record the preference and limitation. `git diff --check` passed. Documentation only; no launches, restarts, configuration edits or runtime policy changes. Implementing the native launcher option remains separate development work.
