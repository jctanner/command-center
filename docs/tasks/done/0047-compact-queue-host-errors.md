# Task 0047: Compact queue host errors

Owner: CC dev
Claimed: 2026-11-10
State: done

Replace repeated raw SSH warnings in Agents status with compact machine issue summary and expandable per-machine details. Explain dual-boot host key changes without weakening verification. Preserve availability/read/send guards, literal error rendering and recovery. Validate desktop/mobile failure and recovery with synthetic fixtures.

## Findings, change and validation

Observed alternate-OS SSH host-key mismatch through the read-only queue API. Strict checking correctly refused the connection. Agents render concatenated multiline raw errors into the checked-at paragraph on every refresh.

Moved per-machine failures/scan limits into a collapsed disclosure with a compact count, literal bounded-height scrollable diagnostics, and explanation for unverified SSH identity/dual boot. Disclosure remains open across polling if explicitly opened and clears on recovery. Other machines remain usable. No backend transport, host-key settings, send guards or retry policy changed.

- npm run build -- --outDir dist-next (web/) passes, existing bundle warnings. Initial invocation from repository root failed because package.json is in web; rerun in correct directory passed.
- Six Playwright cases passed: two new desktop/mobile host-error disclosure/escaping/open-preservation/recovery tests, plus four existing agent file link regressions. Synthetic fixtures only, zero writes/terminal sockets.
- git diff --check passes. Published staged frontend with prior hashed assets retained; live index matches new build. No Rust changes or backend restart required.
- No known_hosts edits, trust bypass, live agent actions or ticket mutations. Alternate OS remains unavailable until independently trusted or the original OS returns.

Next task 0048; next bug 0028.
