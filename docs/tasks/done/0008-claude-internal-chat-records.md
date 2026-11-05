# Task 0008: Hide Claude internal records from chat

Owner: CC dev
Claimed: 2026-11-04
State: done
Completed: 2026-11-04

## Goal

Filter provider-marked task notifications and compaction summaries from human chat and receipt evidence. Preserve genuine XML messages and foreground activity. Verify with fixtures and the reported agent; deploy.

## Findings and implementation

The reported XML is a provider task notification with promptSource=system, turnOrigin=task_notification and origin.kind=task-notification. A second internal record has isCompactSummary=true. Neither has isMeta set. Filter explicit internal user-record metadata in Claude history and launch-title discovery. Do not infer internal origin from XML text. Retain genuine human XML, assistant replies, foreground activity state and the previous paste-wrapper receipt fix.

Version the Claude visible-history cache separately so old clients request filtered history; attention/reply cursor versions remain unchanged. Excluded internal user records no longer enter receipt evidence.

## Validation and deployment

The history regression failed before the fix and passed after it. 39 agent Python tests and eight continuation tests passed, followed by six outbox Python tests including a new internal-notification/old-cache regression. Release build and diff check passed. Restarted backend with existing listener/origin arguments. Live read verifies the reported notification and compaction summary absent, real pasted message present, its existing Seen receipt preserved, and HTTPS healthy. No messages sent or native logs modified.

## Handoff

Chat polling receives filtered history; reload if stale older pages remain open. Next task: 0009; next bug: 0005.
