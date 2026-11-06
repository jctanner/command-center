# Task 0019: Apache License 2.0

Owner: CC dev
Claimed: 2026-11-06
State: done

User selected Apache after the public-release review. Add the Apache License 2.0 text, matching Rust/web metadata and a short README link. Preserve dependency licenses, private package status and unrelated review work. No publishing, history changes or ownership/provenance certification.

## Outcome and validation

Added root LICENSE with the complete standard Apache 2.0 text, identical to the installed libblkio distribution's canonical LICENSE-APACHE (including the standard placeholder appendix). Set Apache-2.0 SPDX metadata in Cargo.toml, web/package.json and the root web lockfile package; linked LICENSE in README. No project-specific copyright ownership was invented and dependency licenses were not changed.

`cargo metadata --locked --offline --no-deps --format-version 1` reports Apache-2.0. Verified matching web/lock metadata, existing private=true, byte-identical license text and unchanged lock dependency data. `git diff --check` passes. No runtime tests/build/deploy required for license and metadata only. Public-release report updated to record the user's choice; privacy/history, deployment docs, setup bug 0013 and provenance confirmation remain open. No commit, push or repository visibility change.
