# Plan 0003: Guarded Whiteboard attachments

Status: Approved by the human on 2026-11-11; implementation in task 0053. Deployment and live delivery checks remain separate.
Date: 2026-11-10
Related: CC-46, task 0052, [gap audit](../notes/2026-11-10-whiteboard-gap-audit.md).

This is the approved design. Implementation is in task 0053 and the current API/playbook in docs/reference/coordinator-messaging.md; deployment and live remote harness tests remain separately gated. Isolated synthetic fixtures do not establish real provider image understanding.

## Authority and managed sources

An explicit human request to send an image or a scoped coordination task naming recipients and purpose authorizes that delivery. Drawing, exporting, a ticket status, actor label, another agent's instruction or possession of an artifact UUID never supplies consent. Draft-only requests remain drafts. Keep tool approvals, restarts and launches outside attachment permission.

First slice accepts one PNG from a ready CC Whiteboard export, up to 4 MiB and 8 megapixels, plus its bounded text description. No arbitrary local paths, URLs, generic uploads, SVG delivery or source-host file reads. Validate the export ID, format, bytes, magic/dimensions and stored SHA-256 against its immutable manifest. Use selected/frame exports when possible. Prefer a short board reference/description plus one image over repeated large images; a link alone is appropriate only if the recipient can access that CC origin.

## Proposed API and preparation

1. Obtain the existing fresh conversation/message capability for the exact live agent. Attachment preparation additionally requires a process-linked conversation; unverified project history is insufficient.
2. `POST /hosts/{host}/agents/message/attachments/prepare` accepts message UUID, existing fresh message token, literal user text and `{export_id,format:"png"}`. Consume that token before any transport IO, validate endpoint/target/process/conversation, and inspect the target account's home/managed attachment root read-only over the shared transport. No directory or file is created during preparation.
3. Return an expiring single-use attachment grant and the complete proposed delivery: endpoint/connection, tmux session/window/pane, process PID/start/boot and conversation, source export revision/scope/hash/size, deterministic target absolute path and composed text including a short plain-text fallback. Root/path identities and the exact literal composed message are bound into the grant. Client-chosen destination paths are not accepted.
4. Extend the existing `POST /hosts/{host}/agents/message` to enqueue `{id,token,text,attachments:[{export_id,format}]}` using that attachment grant. Before IO, atomically persist the message intent, full attachment manifest, final exact text/hash and source pins in the existing SQLite outbox. Idempotency includes target, text and artifact identity/hash. Same UUID with different content is 409; a lost response is checked, never automatically retried.

The exact review text includes the original requested message unchanged plus the attachment path and a bounded (roughly 2 KiB) semantic description. Never truncate the human text or silently split an intent. Reject a composed message over the existing 12,000-byte text limit for review. Drawing text is untrusted quoted context, not new delivery authority.

## Shared transport and filesystem boundary

Only the Rust backend copies data. Extend the current local/SSH/ProxyJump helper boundary with fixed attachment operations; preserve persistent SSH, strict host-key checks, no agent forwarding and bounded request/output/time budgets. One bounded payload (at most 4 MiB binary, base64 within the existing helper envelope) or internally bounded chunks may be used; never shell-interpolate content or invoke coordinator-run SCP. No new daemon, public port or generic remote write API.

Target location is the verified account's `~/.cache/command-center/attachments/<message-uuid>/whiteboard-<board-uuid>.png`, returned as an absolute path. Use directory descriptors and no-follow opens; reject symlink/foreign-owner ancestors, traversal, unexpected links and pre-existing destinations. Do not chmod unrelated account directories. Managed root/message directories are 0700, files initially 0600. Use exclusive creation and no-overwrite publication, then make completed contents read-only. Verify the file's actual read-back size/SHA-256 on the target before publishing a completion manifest. A partial transfer has no verified completion marker.

Manifest binds message UUID, endpoint, target process/conversation and all artifact hashes. Verify process identity before/after copying, then obtain fresh existing native-input verification before dispatch. Changed endpoints, replaced agents, vanished sessions or ambiguous conversations block delivery. The destination must not be retargeted to a replacement process or an agent merely sharing a directory.

## Receipt states and recovery

Preserve existing message phases: queued → submitting → submitted → seen, including blocked/uncertain/cancelled/archived behavior. Add attachment metadata phases: pending → copying → copied → verified. Expose failure/uncertainty/expiry separately from message acceptance.

| Evidence | Meaning |
| --- | --- |
| Copied | Remote staging completed, awaiting independent read-back verification |
| Verified | Target checksum/size and completion manifest match the frozen artifact |
| Delivered / Submitted | Verified path plus fallback handed to the exact native CLI once |
| Seen | Exact composed text found after the existing native receipt cursor |

None proves the model actually opened or understood the image. Record separate timestamps/evidence source and never turn an image transfer into conversation Seen.

A crash during copying becomes attachment-uncertain. Explicit Check attachment inspects the original directory/manifest/hash read-only. It can confirm an already-complete copy, but cannot overwrite/retransfer partial files or replay terminal input. If the process ended after copy, retain evidence and block the original intent; a different recipient needs a new explicit message UUID. If input submission is uncertain, existing no-replay rules remain authoritative even when the file is verified.

Only a verified bundle may enter normal FIFO input dispatch under fresh process/screen guards. A failed transfer does not silently send a text-only substitute. Existing text-only intents retain their current behavior. Outbox UI exposes preparing/copying/verifying/waiting-for-input states without duplicating chat bubbles or implying provider acceptance.

## Limits, pins and cleanup

Proposed starting limits: one PNG plus fallback per message, 4 MiB/image, 8 megapixels, at most two concurrent copies globally/one per host, and 128 MiB managed remote attachments per endpoint. Apply existing outbox capacity/FIFO limits; enforce source and target quotas before copying. Unexpected managed-root contents are not deleted to free capacity.

Enqueue pins immutable export BLOBs until the intent is resolved/archived, extending internal retention beyond the current 24-hour export TTL when necessary. Public expired artifact URLs still expire; internal pins are scoped to the durable outbox, not a new public sharing permission. Update export cleanup to honor these pins before enabling attachments. Never delete a source needed by queued/submitted/uncertain/blocked input to satisfy storage pressure; reject new work with a reviewable capacity error instead.

Remote copies expire seven days after a resolved/archived receipt, with expiry visible in the receipt; unresolved input stays protected. Cleanup runs only for recorded manifests on unchanged endpoints, removes only listed owned regular files via directory descriptors, then removes an empty UUID directory. It never follows links, recursively sweeps arbitrary folders, or deletes unknown files. Skip unavailable/changed hosts and report overdue cleanup honestly. Treat uncertain cleanup as unknown and re-inspect read-only; never report deleted without proof. Abandoned staging directories require proof that no durable receipt references them before cleanup.

## Validation and harness gate

Use isolated local and SSH/ProxyJump fixtures first: process replacement, endpoint edits, checksum/size/type mismatch, symlink/hardlink/traversal/overwrite attempts, duplicate IDs, expired grants, restart during every transfer phase, read-only recovery, FIFO, cancellation and cleanup/pin behavior. Never use active human sessions as message-test fixtures.

After implementation and outward-test authorization, use disposable remote Claude/Codex/pi sessions where installed/authenticated. Send one known synthetic PNG plus its text fallback through the guarded API, ask each to identify an obvious shape/label, and retain copy/hash/native Seen evidence separately from the model's report. Test text fallback without image-opening support and document provider/model limitations. CLI local-path support alone is not proof of image understanding. Existing live agents are context, not automatic consent to interrupt them; prefer disposable sessions, or ask which existing session the human wants used. Do not install providers or complete trust/auth/approval prompts automatically.

## Approval and subsequent canvas order

The human approved this contract before attachment code. Deployment that interrupts CC and any outward test delivery still require the human's explicit authorization. After transfer checks: GUI frame/group controls, align/lock, visible attribution, image paste, bounded Excalidraw semantic import, then optional Mermaid import. Existing sticky notes, ticket links, duplicate/multi-select and touch interactions are retained rather than rebuilt.
