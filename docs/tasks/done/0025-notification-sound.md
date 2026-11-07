# Task 0025: Opt-in agent notification sound

Owner: CC dev
Claimed: 2026-11-06
State: done
Completed: 2026-11-06

Add browser-local opt-in chimes for existing fresh completion/reply/approval notifications, with preview, volume and mute controls. Reuse process/event baselines, per-agent mute/read suppression and cross-tab Web Locks deduplication; bound bursts and never replay missed sounds. Handle Web Audio user-gesture restrictions and reload/re-arm state honestly. No provider input, state inference, background push or external audio download. Preserve previous uncommitted desktop reload sizing work.

## Implementation

Notifications dialog now offers an off-by-default Play notification sound checkbox, volume and Test sound. A small Web Audio helper synthesizes a two-note sine chime locally, with a bounded envelope, user-gesture unlock/re-arm, blocked/paused status and preview. Browser-local preferences sync across tabs; mute remains effective in the current tab even if its storage write fails. No sound or AudioContext is created before opt-in/preview or in compact clients.

Audio follows existing process-scoped reply/completion/approval attention tokens, not arbitrary Working/Unknown state changes. Existing mute/read/baseline and permission guards remain. Separate bounded sound receipts under the same Web Lock let an armed tab play after an unarmed tab wins visual delivery. Claims persist before scheduling; bursts across scopes/tabs coalesce to one chime per two seconds and missed/uncertain playback is never retried. System notifications request silent=true when CC chime is selected, with OS audio otherwise separately controlled. No provider input, new polling, backend storage or external audio assets.

## Validation

- Frontend type/build and git diff --check pass. No Rust/backend logic changes, so no Rust tests rerun.
- Seven final sound browser tests pass (11.2s): opt-in/default quiet, preview/volume/persistence, no automatic unlock on reload, cross-tab/agent burst deduplication, repeated-poll silence, per-agent mute/read suppression, armed-peer delivery, autoplay failure/recovery, real native AudioContext scheduling, compact isolation, and current-tab mute under storage-write failure.
- Existing notification opt-in/dedup/click-target and denied-permission regressions plus compact-card regression pass in the preceding nine-test batch (13.7s). A duplicate implicit status role from the volume output was replaced with a decorative readout beside the accessible slider, preserving the original notification-status contract.
- Reviewed the synthetic desktop dialog screenshot. Native Web Audio test verifies running context and scheduled notes in headless Chromium, not physical speaker audibility or actual Safari/mobile hardware.
- Frontend deployed atomically with index backup and old asset hashes retained. Loopback/HTTPS health, current index and entry JS verified. Live backend PID, tmux pane PIDs/dimensions and private source/feature configuration unchanged. No live preferences toggled or live agent messages/approvals sent.

## Handoff

Reload CC, open Notifications on HTTPS/localhost desktop, enable desktop notifications if necessary, check Play notification sound, set Volume and use Test sound. Browser/system mute, tab suspension and sleep can silence alerts; a trusted interaction may be required after reload. The feature does not promise phone/background push. Audio controls report availability and storage/autoplay failures without changing agent permissions.

Previous uncommitted Task 0024 reload sizing work preserved. The owner subsequently authorized committing and pushing all pending CC changes. Task 0009 receipt choice remains pending. Next task 0026, bug 0016.
