# 2026-11-06: Public-release readiness review

Baseline: `pre-cleanup snapshot`, local main and origin/main. Scope: publish existing source/history, not expose the running service publicly. Review only; no product fixes, history edits, visibility changes or production restart.

## Recommendation

Hold the public/open-source release for a small preparation pass. Both the local review and independent Claude CLI review identify the missing project license, personal deployment details and deployment trust documentation as the main release issues. No real credential was identified, and neither review established a concrete new source-level security vulnerability. This is not a security certification.

## Follow-up: license selected

After this baseline review, the owner selected Apache License 2.0. [Task 0019](../tasks/done/0019-apache-license.md) adds LICENSE, Rust/web metadata and the README link. The missing project-license finding is addressed in the working tree. Provenance confirmation and the other findings remain; no history or visibility change was made.

## Follow-up: privacy cleanup prepared

[Task 0020](../tasks/done/0020-privacy-and-history-cleanup.md) generalizes current files and prepares all historical versions and commit identities in an isolated clean repository. Private operational details remain in ignored local notes. The owner accepted the GitHub cache limitation and authorized replacing existing main. The verified sanitized history has been pushed with an exact force-with-lease; no visibility change was made. See [privacy/history guide](../reference/privacy-and-history.md).

## Follow-up: README release guidance

[Task 0021](../tasks/done/0021-public-readme-setup-and-security.md) adds the prominent no-login/account-control warning, deployment boundaries, Linux platform scope, precise toolchain prerequisites and Settings navigation. Bug 0013 is fixed with the minimum-toolchain validation caveat explicit. The owner subsequently authorized committing and pushing these documentation changes. Licensing and privacy/history preparation/application are recorded above; actual publication remains an explicit owner action.

## Findings

### 1. Choose a project license and confirm provenance (release priority)

There is no tracked LICENSE/COPYING/NOTICE, and [Cargo.toml](../../Cargo.toml:1) has no license metadata. Public visibility alone does not communicate the intended reuse permissions. Choose the license explicitly; the review does not choose one for the owner.

[AGENTS.md](../../AGENTS.md:17) identifies reference projects. Available root licenses: whackamux and t3code are MIT; markov.ide and agent-overlord have no root license file. An exact-block spot-check found no substantial matches between 60 CC source files and 24,707 selected reference source files (eight consecutive nonempty whitespace-normalized lines, at least 240 characters; generated/dependency directories excluded). That does not establish ownership or detect translated/reworked borrowing. Confirm permission/attribution for anything actually reused; do not infer that reference code was copied merely because references exist.

### 2. Decide which personal deployment details may be public, including history (release priority)

The current tree names real machines, network addresses, a tailnet hostname, deployment ports and source-project conventions. Concrete examples: [feature reference](../reference/features.md:103), [HTTPS setup](../reference/features.md:213), [agent instructions](../../AGENTS.md:155), [tests embedded in main.rs](../../src/main.rs:186), and [example config](../../config.example.toml:18). Slack/Jira prompts and Slack/Email/Jira source-selection defaults refer to a specific machine, e.g. [Slack](../../web/src/slack.ts:114), [Email](../../web/src/email.ts:37), [Jira](../../web/src/jira.ts:32). Ledger records also contain operational machine/process details and an opaque live receipt UUID. Commit metadata contains one non-GitHub-noreply email identity; confirm that publication is intended.

These are privacy/reconnaissance details, not credentials and not a demonstrated route into the service. Generalize public instructions, examples and product defaults. Use valid synthetic private addresses for LAN validation examples rather than blindly substituting documentation addresses that the private-address validator rejects. Review historical versions too: replacing HEAD leaves old values in history. A history rewrite or separate clean public export requires a separate explicit decision; neither was performed. Accepting some historical identifiers is also an owner decision, not a reason to claim credentials need rotation.

Feature flags control runtime availability, not source visibility. The Slack implementation still exposes browser-session credential field names/private-client endpoint strategy ([adapter](../../src/slack_remote.py:81)); Email/Jira/Slack require an existing compatible personal-assistant environment. Confirm that this implementation itself is intended for publication. No claim about employer policy or service terms was assessed.

### 3. Make the trust boundary prominent in README (release priority)

[README remote access](../../README.md:35) does not prominently explain the absence of application login/authentication. [The API docs](../api.md:3) and [LAN documentation](../reference/features.md:105) do, and [same_host](../../src/lib.rs:250) implements browser Host/Origin protection rather than user identity. A client that can reach a listener can act with the backend account's file, terminal and configured SSH capabilities. Non-browser clients can set Host/Origin themselves; other local users can reach loopback on a shared machine. Plain LAN HTTP is unencrypted. HTTPS encrypts transport; it does not add login.

Add a short top-level deployment warning and supported single-user/trusted-network model. Explain tailnet ACLs or an authenticating proxy, and that any enabled direct listener must remain behind the intended boundary. Making the repository public does not itself expose the running service, and building a new authentication system is not required to publish source honestly.

### 4. Correct setup requirements and navigation (confirmed documentation bug 0013)

[README prerequisites](../../README.md:17) say only edition 2024 and Node/npm. The locked uuid 1.29.0 declares Rust 1.89; an edition-2024-capable Rust 1.85 compiler therefore does not satisfy the dependency minimum. Locked Vite 7.3.7 requires Node ^20.19.0 or >=22.12.0. Declare and test a supported minimum instead of implying every edition-2024 compiler works. The audit used Rust 1.99.1 and Node 22.23.1; it did not test minimum toolchains.

Document Linux as tested for backend/agent hosts: [agent process evidence](../../src/agent_remote.py:147) and the provider bridge depend on Linux /proc. Do not imply Windows backend support; separate future clients from backend platform support. [README](../../README.md:31) also points to the old Machines entry instead of Settings > Machines. Explain optional integration defaults/private source prerequisites near the workspace list.

### 5. Useful follow-ups, not publication blockers

No CI or SECURITY.md is tracked. Add repeatable clean-install/test jobs and a vulnerability reporting policy. Consider CSP as tested defense in depth, preserving xterm/CodeMirror dynamic styles, streaming and existing renderers; do not paste a generic policy without regression checks. The SSH clone URL works and remains the owner's requested choice; changing it to HTTPS after publication is optional. npm private=true prevents accidental npm publishing and is not an open-source visibility problem.

## Actual validation

- Scanned all five reachable local commits: 241 unique Git blobs and commit metadata. Common provider/GitHub/Slack/AWS/Google token formats, private-key headers and credential assignment patterns produced no candidate matches. No tracked live config, database, environment, SSH identity, dependency/build or checkout directories were found in those historical trees. Privacy-pattern hits were retained by path/category without printing credential values. The test token fixture is an obvious synthetic marker.
- Clean tracked-source archive, excluding ignored private files: npm ci --offline, frontend type/build, cargo check/build --locked --offline all passed. Existing toolchain/dependency caches were reused. Loopback-only startup with a copy of the example config served health/assets and returned all optional flags false. No terminal attached and no external integration requested. This smoke test does not exercise every functional feature on a new machine.
- Live npm audit: zero reported vulnerabilities across 128 entries. OSV batch query of all 173 registry packages in Cargo.lock: no reported advisory matches at review time. cargo-audit was not installed; this is an OSV result, not a cargo-audit pass. Linux dependency metadata inventory: 149 packages, none with GPL-family license expressions; only CC lacked declared license metadata. Dependency metadata is not a full redistribution/notices audit.
- Claude CLI completed successfully using its installed Opus 5.5 model, 68 turns, read-only Read/Grep/Glob tools, restricted/safe modes, no MCP, hooks or session persistence, with no denied tools. It reviewed an isolated source directory and did not access live CC configuration. Original result/readable report is retained in the private audit directory outside Git. It could not inspect Git history or run builds/advisory tools; the local checks above cover those gaps.
- Workflow caveat: local validation installed ignored node_modules and generated frontend assets into the same isolated directory while Claude reviewed it. Claude noticed and excluded those generated files from its findings. No private working configuration was supplied; source baseline stayed pre-cleanup snapshot. The later smoke config was created after Claude finished.

## Reconciliation and limits

Claude's history-unchecked finding applies to its snapshot-only review, not the combined audit. Its broad unlicensed-reuse/contribution phrasing and speculative service/employer policy implications are not adopted as established legal conclusions. Its clone-URL suggestion and generic CSP are follow-ups, not blockers. Personal identifiers are assessed as publication choices; no mandatory history rewrite or credential rotation follows from these checks.

A custom pattern scan can miss secrets. Coverage excludes unreachable objects, remote-only refs, GitHub issues/PRs/releases/artifacts, backups, LFS and submodules outside the tracked trees. No comprehensive penetration test, policy/legal review, oldest-toolchain test or platform certification was performed. Review finds no evidence of live secrets; it does not prove absence.

Next step: decide the desired privacy/history cleanup and address deployment/setup documentation. Apache 2.0 has been selected and added after the baseline review. Repository remains private. No implementation changes or publishing were authorized by this review.
