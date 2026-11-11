# Task 0053: Guarded managed message attachments

Owner: CC dev
Claimed: 2026-11-11
State: done (implemented/tested and staged; deployment/live harness checks are task 0054)
Related: CC-46, Plan 0003. Human approved the diagram and private remote-copy design.

Implement one managed PNG export per durable message; exact endpoint/process/conversation preparation; private no-overwrite copy and checksum verification through shared transport; independent attachment receipts, source retention and safe expiry; coordinator API/docs/skills and isolated tests. Existing text-only messaging must retain its behavior. No disruptive deployment, live delivery tests, commits or push without the requested authorization.

## Implemented

Process-linked attachment preparation consumes the existing native grant, inspects target home/ancestors read-only and freezes source export scope/hash/size, endpoint/process/conversation, absolute path and exact composed text into a 120-second single-use grant. Enqueue transaction consumes that grant and commits the durable outbox/manifest/source pin before any file IO. Repeated UUIDs cannot change host/text/export reference or become text-only intents.

One managed PNG <=4 MiB/8 megapixels; no arbitrary files, URLs, destinations or uploads. Shared local/SSH/ProxyJump transport has a separate bounded six-MiB envelope; ordinary agent requests keep their 160-KiB bound. Two concurrent copies globally, one per host, 128-MiB target quota. Directory FDs/no-follow/ownership/mode checks, exclusive UUID directory creation, frozen intent and completion markers, 0400 completed files and independent target SHA-256. No chmod of unrelated directories, recursive cleanup or overwrite. Copy failures conservatively become uncertain and never retry automatically.

File pending/copying/copied/verified/uncertain/expired receipts are distinct from native submitted/seen, with their own timestamps and hashes. Only verified files reach existing guarded input; fresh native evidence is obtained after the pre-send checksum check. Unknown agents retain their queued messages without repeatedly hashing the file each poll. Manual Submit now cannot bypass checksum verification. Read-only Check attachment recovers complete copies without retransmission or terminal input in that request. Original durable authorization can subsequently dispatch through the normal worker; stale targets stay blocked.

Unresolved source pins preserve internal bytes beyond public export expiry (public URLs still 410). Resolved copies become cleanup-eligible in seven days; separate background cleanup honors unchanged endpoints and exact intent markers, skips busy/unsafe/unavailable targets, removes only listed owned regular files and releases pins after durable expiry evidence. Marked partial copies can be cleaned; a crash before an intent marker is durable leaves an unproven directory for manual review. A crash between cleanup steps can leave overdue metadata rather than falsely claiming deletion. Repair releases a pin if durable expiry was committed before a crash.

Outbox shows attachment state in the existing single message bubble and detailed path/hash/size/errors/expiry behind Details; phone layout verified. OpenAPI documents preparation, durable messaging, receipts and recovery. cc-whiteboard/message/coordinate skills and references explain authority, exact returned text/token, fallback and honest image-viewing evidence. No new generic upload service or React/canvas dependency.

## Validation

- Twelve Python filesystem/bootstrap tests: private/no-overwrite copy, read-back integrity, PNG bounds/type, home/ancestor changes, symlink/hardlink/traversal/unsafe permissions, quota, corruption, unknown-file cleanup refusal, partial transfer cleanup, target change after copy and read-only verification preserving inode/mtime.
- Eleven isolated attachment API tests (six attachment flows plus five inherited whiteboard regressions): actual local/SSH/ProxyJump copy, process replacement, existing-directory collision, exact grant/UUID/text/artifact intent, manual and automatic native dispatch, exact native Seen receipt, source pins/public expiry, interrupted-copy restart without replay, explicit verification recovery and expired resolved copy cleanup/source release. Synthetic cat-as-Codex process and native JSONL fixture only, not a real model.
- Nineteen Playwright tests pass (one new mobile attachment-receipt test plus eighteen existing outbox regressions). Confirms single bubble, no horizontal overflow/terminal sockets, explicit read-only recovery, disabled force-submit before verification; retains FIFO, busy-agent sends, uncertain no-replay, cross-client/refresh persistence and no disappearance/duplication. Screenshot test-results/attachment-receipt-phone.png visually inspected.
- Eleven existing server-export tests, six contract/ticket tests and seven native outbox parser tests pass. All 61 library tests, Clippy, formatting, release build and frontend type/build pass. Existing Vite chunk advisories remain. Three coordinator skills quick_validate pass; git diff --check passes.

## Release and limitations

Not deployed; no live provider messages, agent launches/restarts, remote harness tests, live board/ticket changes, commit or push. Test SSH/ProxyJump uses disposable loopback sshd/tmux and new managed UUID directories, cleaned by exact intent manifests. It does not contact configured live machines. Real Claude/Codex/pi image understanding remains unverified; native Submitted/Seen cannot establish it. Text fallback is included/receipt-checked, not a claim a model interpreted it.

Prepared /tmp/cc-deploy-whiteboard-attachments.py (not executed) preserves live argv/env/listeners, retains the prior executable, backs up SQLite after stop, publishes fonts/licenses/assets/HTML, checks served contracts/health and verifies local pane/PID inventory. Human requested approval before disruptive deployment and live outward harness tests. After approval deploy, then separately authorized disposable real-harness validation; remaining canvas work follows the existing gap-audit order.
