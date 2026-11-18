# Task0123: Download agent-machine file links

Claimed2026-11-18 by CC-dev. Human requests right-click download of file paths on the originating agent machine, including p15 videos accessed from rhlaptop. CC-89 HTML preview already shipped in task0117/0118; retain its isolated Source/Preview behavior. Add bounded-memory binary download streaming over existing local/SSH/ProxyJump transport, machine-revision guards, attachment disposition/no-store and regular-file validation. Expose chat file context actions and Files download; recognize video/artifact paths. Cover local/SSH binary transfer, stale endpoints, file errors, arbitrary literal paths, browser downloads and existing HTML/link behavior. No deploy/commit/push or agent input requested.

## Result

Added GET /hosts/{host}/file/download with required observed connection revision and optional stat fingerprint. Local/SSH/ProxyJump uses the existing transport invocation and strict verification; bounded stdin JSON carries literal paths. A small trusted Python producer opens regular files and emits a metadata line followed by raw bytes. Rust streams to native browser downloads with separate two-download capacity,64 KiB chunks,8 GiB cap, connection/idle/total deadlines and endpoint checks per chunk. No SCP, daemon, temporary artifact copy or browser Blob is used. Nonregular files, inaccessible/missing paths, oversize files and stale revisions/versions fail before content; final data is held until file/transport completion checks pass. Cancellation kills the owned producer/channel, not shared agents or SSH masters. Attachments use UTF-8 filenames, nosniff/sandbox/no-store.

Chat file links now offer right-click, Shift+F10 and explicit touch-friendly ⋯ actions. The target captures the originating machine/revision/path; switching machines never retargets it. Video/audio/archive links, literal absolute code paths containing spaces/#/% and conservative plain absolute artifact paths are recognized. Files entries offer the same actions for binaries; open documents can download their saved on-disk version without changing drafts. Existing CC-89 static HTML Source/Preview remains unchanged. OpenAPI and enduring file-download reference/API docs updated.

## Validation2026-11-18

- cargo fmt/build passed; cargo test --lib98 passed; Clippy --all-targets -- -D warnings passed.
- TypeScript/Vite build passed (existing chunk-size advisory).
- Python download helper5 tests passed: binary beyond editor limit with literal/Unicode filename, empty/stale files, missing/relative/directory/FIFO/oversize rejection, mutation under backpressure and consumer cancellation.
- OpenAPI suite6 passed against isolated backend.
- Final Playwright19 passed:8 chat/link/download and11 Files cases. Real browser downloads on desktop/phone retain agent machine, draft and workspace, support keyboard/touch menus and literal paths, and preserve compact terminal isolation. Local plus actual fixture SSH transfers return exact >2 MiB binary bytes and UTF-8 filenames; stale endpoint/version/origin rejected. Two simultaneous128 MiB sparse-file streams enforce429 and both abort when endpoint revision changes; capacity is released afterward. Existing editor save/conflict/Markdown, HTML hostile-content isolation and desktop/phone layout tests passed.
- Synthetic screenshots inspected at1280/393px. Test download interception was removed because browser-managed downloads bypass ordinary page request interception; actual fixture HTTP streams and download URLs now verify routing and content directly. No production files were downloaded during tests. Logs .local/file-download-{build,web,rust,clippy,contract,browser-final,chat-browser}.log.

No commit/push/deploy or real-agent input/restart performed. Limits intentionally exclude video playback, directories/archives, Range/resume and >8 GiB files. iPhone hardware/Safari was not exercised; compact Chromium layout/download coverage is recorded without claiming device validation.
