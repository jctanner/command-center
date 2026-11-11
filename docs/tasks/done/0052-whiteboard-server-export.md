# Task 0052: Whiteboard server export and remaining-feature audit

Owner: CC dev
Claimed: 2026-11-10
State: done (implemented/tested and staged; deployment and attachments await approval)
Related: CC-46. Human requests server PNG/SVG export first, plus an attachment design for approval before transfer implementation. No deployment/outward actions or commits authorized.

Implement bounded same-renderer exports for board/selection/named frame or group, theme/scale, immutable artifacts with JSON/text, checksums and private coordinator downloads. Add minimal API-level regions needed for scope; GUI group/frame tools come later. Audit remaining tools; write proposed transfer/receipt/cleanup design and wait before implementing it. Rust, REST/schema, helper and browser parity checks; preserve existing native messages and scenes.

## Implemented

POST export freezes the exact scene revision, selection or checked named frame/group revision, scale and light/dark theme. Returns an immutable manifest with ready/failed/expired states and PNG/SVG/native JSON/text URLs, sizes, SHA-256 and scope. External bindings are frozen/detached; omitted element labels/IDs and crop ticket references do not leak into scoped artifacts. API-level named regions supply export membership/bounds; GUI frame/group tools remain later scope. Legacy GET JSON export remains available.

Rust uses embedded QuickJS for fixed pinned roughjs plus shared browser geometry/wrapping; resvg renders PNG. One bounded subprocess of CC, no Node/Chromium service, no JS host IO or external resources. Shared Liberation Sans is bundled with its OFL notice. Strict scene/pixel/input/output/time/memory/concurrency/storage limits; 24-hour artifact cleanup retains UUID/digest evidence. Committed jobs continue after HTTP disconnect; restart failure is honest and not retried.

Coordinator export/download commands save a private intent before POST, fetch only managed same-origin URLs, verify type/size/hash, and preserve existing files. 0700 directories/0600 files, no-follow descriptor operations, no arbitrary remote write source. Named region helper commands and current/proposed capability docs/skills updated. Attachment proposal Plan 0003 is not implemented, and no native harness image capability is claimed verified.

## Actual validation

- cargo fmt --check, cargo clippy --all-targets -- -D warnings and release build pass. All 58 library tests pass, including six new rendering/export unit tests: deterministic seeded/clean output and embedded font, PNG decode/dimensions/scaling, invalid geometry/pixel budgets, scoped external binding sanitization, invalid selections and stale region revisions.
- tests/test_whiteboard_exports.py: 11 passed (six export cases plus five inherited baseline API cases). Covers actual subprocess render, PNG/SVG/JSON/text hashes, scale/themes/restart/idempotency, label/ID privacy, frame/group revisions, limits/failed artifacts/expiry, disconnect during rendering, and coordinator private downloads/no-overwrite/symlink rejection plus region scope commands.
- Existing tests/test_openapi.py: six passed, including all new route/schema coverage and ticket CRUD. Manifest payload validation is included in export tests.
- Final Playwright run: eight passed in 22.2s, including exact browser/server path/text parity in both themes, PNG raster tolerance, existing shared edit/undo/conflict/lost-save recovery, local downloads and native Chromium touch/pinch. Synthetic dark PNG visually inspected. Real iPhone/Windows and remote harness delivery remain untested.
- Frontend type/build passes with existing chunk advisories. All three updated skills quick_validate pass. git diff --check passes.
- Synthetic standalone render observed 0.03 seconds / 26,060 KiB peak RSS on this Linux host, excluding DB/HTTP. Generator 30,719 bytes; font 410,712 raw / 211,540 independently gzipped; total release binary 20,978,024 bytes. No unmeasured previous-binary comparison or worst-case performance claim.

## Design and handoff

Audit note records multi-select/duplicate/sticky/ticket/touch already present; missing GUI frame/group, align/lock, author style, images and imports are ordered after attachment design. Plan 0003 specifies source-only PNGs, process/conversation grants, durable outbox intent, target read-back SHA-256, explicit transfer vs native receipt states, no overwrite, pins/expiry/cleanup and harness verification gate. It is proposed and awaits human approval before code.

No live service restart/deploy, live drawing or ticket writes, agent messages/launches, remote copies, commits or push. Source, release binary and web/dist-next are prepared. Deployment must copy new fonts/ and license assets as well as JS/CSS/HTML, preserve listeners/config/native processes and get the requested approval for interruption. Attachment implementation and outward harness test delivery require their own authorization. Next task 0053, plan 0004, decision 0004, bug 0028.
