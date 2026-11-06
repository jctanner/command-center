# Task 0012: Initial prompt in New agent

Owner: CC dev
Claimed: 2026-11-05
State: done
Completed: 2026-11-05

## Goal

Optional multiline prompt for new-conversation launches, passed once as a literal CLI argument through the existing one-use launcher. Resume disables this field while preserving its draft. Retain ticket-owned prompt bindings and existing launch recovery. Validate size/controls before claiming a launch; no prompt in URLs or browser receipts. Verify all three harnesses and phone UI with fixtures; deploy.

## Implementation and initial checks

Added a multiline optional field with new/resume draft preservation and a frontend UTF-8 size guard. Preserve literal nonblank content and use the existing structured CLI positional argument following --. The optional POST field is validated before grant consumption; resume+prompt and overrides of ticket-owned prompts are rejected without consuming the grant. Missing/blank fields retain interactive launch. Recovery receipts contain only launch identity; successful launch clears the staged text.

39 Rust library tests, Clippy -D warnings, formatting, release build and TypeScript/Vite build passed. Full launch fixture suite is running, including literal prompt/one-use checks for all three harnesses and phone draft/limit checks. No live agent launches performed.

## Envelope-size correction

The first launch-suite run passed 29 checks and found that an oversized prompt received HTTP 413 from the pre-existing 16 KiB default before field validation. A valid 24,000-byte quote-heavy prompt also needs more than the helper's old 32 KiB JSON reader after escaping. The launch route now has a bounded 160 KiB JSON envelope; other HTTP route limits remain unchanged. The helper reads/checks that same bounded envelope, while field validation still caps prompts at 24,000 UTF-8 bytes. Added a maximum-size quote-heavy literal prompt regression and an SSH prompt handoff check. See bug 0008.

Phone screenshot inspected: the multiline field fits the bounded scrolling launch dialog without horizontal overflow. Full updated fixture suite is running.

## Final resolution, validation and deployment

The full-size regression also proved tmux rejects the large argv frame with command too long. Large argument lists now use a private mode-0600 one-shot JSON argv handoff file. A fixed pane-side Python launcher checks regular-file ownership/permissions/size without following symlinks, reads the literal argv, deletes the file, then execs the CLI directly. Short launches stay direct. Failure cleanup removes an unconsumed handoff when tmux rejects startup; no shell interpolation or simulated input. This also supports long reviewed ticket prompts through the shared path.

Final evidence: 39 Rust library checks, Clippy -D warnings, formatting, release and frontend TypeScript/Vite builds passed. 46 agent Python checks passed, including private handoff permissions, literal argv and removal on startup/failure. A broad launch run passed 29 checks and exposed the full-size boundary; after fixing it all eight affected launch/ticket/recovery checks passed (8.7s), including the formerly failing maximum-size quote-heavy prompt, all three harnesses, literal SSH input, grant validation/ticket protection and phone draft/limit behavior with zero terminal attachments. No unnecessary repeat of unaffected checks. Phone screenshot inspected. Diff check passed.

Deployed backend/frontend with existing listener/origin arguments and verified health plus the live HTTPS index. No live agent launches performed. Bug 0008 is fixed.

## Handoff

Reload app, Start agent, enter optional Initial prompt for a new conversation. Leave blank for interactive startup; Resume keeps the draft disabled and uses chat for follow-ups. Source-only changes remain uncommitted until requested. Next task 0013; next bug 0009. Task 0009's unrelated legacy receipt review remains pending.
