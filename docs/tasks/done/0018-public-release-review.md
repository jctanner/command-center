# Task 0018: Public release readiness review

Owner: CC dev
Claimed: 2026-11-06
State: done

User requests an independent local review and a Claude CLI review before considering making the repository public. Audit tracked tree/history for secrets and private details; assess clean-clone setup, safety/deployment documentation, licensing/provenance and dependency hygiene. Run Claude on an isolated tracked-source snapshot with read-only tools and no MCP/hooks. Preserve private configs/credentials, do not change repository visibility, send live messages, or apply product fixes. Record findings with source references and actual validation; separate blockers from follow-up improvements and scan limits.

## Outcome and validation

Completed independent local and Claude CLI reviews of pre-cleanup snapshot; see [combined report](../../notes/2026-11-06-public-release-review.md). Recommend a preparation pass for license/provenance, personal deployment/history decisions and prominent no-app-auth deployment documentation. Recorded setup bug 0013. No demonstrated new source security exploit or real credential found.

Checked five reachable commits/241 blobs plus metadata, runtime path exclusions, root reference licenses and substantial exact-source-block matches. Clean tracked archive npm ci/build and cargo check/build passed; isolated loopback health/assets/default-off flags smoke passed. Live npm audit zero reported vulnerabilities; OSV Rust lockfile query no matches for 173 packages. Current Linux toolchains tested, not minimum toolchains. Claude completed 68 read-only turns, restricted/safe modes and no MCP/hooks; limitations and generated-file overlap are explicit in the report. Raw model output remains outside Git.

No product changes, license selection, history rewrite, remote/visibility edits, commit/push or production restart. Task 0009 remains pending. Next task 0019, bug 0014. Owner should choose license/privacy scope before implementation.
