# Task 0061: Claude named-session status

Owner: CC dev
Claimed: 2026-11-12
State: done

Investigate CC-59 queued messages. Native registry PID/start/session matches, but tmux target is named-session:@window.%pane while CC observes $session:@window.%pane. Resolve named-session records against exact current tmux membership on the observed socket; preserve PID/start/domain/cwd guards. No forced sends, receipt changes or agent restart. Tests and read-only source check, then request approval before CC restart; original queued intents may resume via normal worker once verified status is restored.

## Findings and fix

Two queued intents share CC-59's unchanged process/conversation. Native Claude registry contains matching PID/start and session, with tmux recorded by a CC-created session name; existing matcher rejects that spelling. Terminal is idle, but appearance alone never authorizes worker dispatch. Added exact name lookup through structured `tmux list-panes -s -t =NAME:` on the observed socket and require the complete current numeric session/window/pane identity in the bounded result. Added socket to internal observations for this check. Existing numeric/private-viewer matching remains intact. Failed lookup, other sessions/sockets, renamed names, mismatched window/pane or malformed/control-containing records fail closed; PID/start/domain/cwd/session guards remain unchanged.

Read-only source evaluation on the actual target gives one verified root/current session and Ready from Claude turn-completion evidence, with the exact original process identity. It performs no native input or receipt changes. Private metadata/evidence stays under ignored `.local/reviews/cc59-queue/`; no raw messages or host configuration in this record.

Validation: four new named-target tests pass, including a disposable real tmux socket, wrong socket/session, rename, literal arguments and process ownership. Existing history34, response-helper13, question detection4 and busy-input7 tests pass. Format and Clippy pass; release build passed. Private restart script prepared/syntax checked only, with existing outbox/question/export preflight, backups, listener/config and pane-process preservation checks. No frontend/API shape changes. Build embeds the helper; current deployed backend still reports Unknown until approved restart. Original queued intents may resume under normal worker authorization after deployment; no forced send/retry/archive is performed or proposed. Await human approval before backend restart. No commit/push.

## Deployment — 2026-11-12

Human approved the brief restart. Prepared script executed: four configured access paths healthy; config/listeners and canonical local tmux pane/PID inventory unchanged. GET-only inspection confirmed the same CC-59 process identity/conversation, now Working from verified Claude event evidence. Both original UUIDs left queued: older intent Seen in process-linked conversation, newer intent Submitted while Working and awaiting native history. No new intent, force-submit, retry, receipt archive, agent input action or agent restart performed. Normal durable worker delivery resumed from the original human authorization. Private receipts/evidence retained in ignored `.local/reviews/cc59-queue/`. No commit/push.
