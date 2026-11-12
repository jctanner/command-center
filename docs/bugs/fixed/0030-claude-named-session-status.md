# Bug 0030: Claude named tmux session rejects live status

Observed: 2026-11-12
State: fixed (tested/deployed 2026-11-12)
Related: task 0061

A Claude process has a valid native registry with matching PID/start and session, but records tmux as a session name followed by stable window/pane IDs. CC observes the numeric session ID. Existing matcher accepts numeric identities and private viewer-session spelling only, so process_sessions rejects the native record and provider_activity reports Unknown. Process-linked conversation can still come from explicit resume evidence; outbox remains queued waiting for verified native input. Terminal appearance is not sufficient to authorize dispatch. Add exact named-session resolution on the observed socket, not a suffix-only relaxation. Keep private live evidence under ignored .local/.

Fix implemented and targeted tests pass in task0061; source-only read of unchanged live target now verifies Ready. Deployed after human approval. Both original queued intents progressed through the normal worker: one Seen, one Submitted while Working. No forced sends or replacement intents.
