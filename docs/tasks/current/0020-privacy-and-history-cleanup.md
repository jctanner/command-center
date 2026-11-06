# Task 0020: Privacy and history cleanup

Owner: CC dev
Claimed: 2026-11-06
State: current

Generalize personal network/machine/operator details in the current tree and every historical tree; retain public project attribution and the SSH remote. Remove machine-name-biased integration defaults. Move live operational and pending receipt context into ignored private notes. Preserve runtime configuration, private state and agent processes. Back up original history and working files privately; prepare and validate an isolated sanitized Git repository with GitHub noreply author metadata. Original branch/remote history stays unchanged until the final publication decision. GitHub caches make force-push alone insufficient to guarantee deletion; no repository visibility change is authorized.

## Completed preparation

- Private Git bundle, uncommitted source archive, original Git config and revision/identity map backed up outside the repository. Real operations and pending receipt context retained in ignored .local/operations.md; explicit consent for receipt actions remains mandatory.
- Generalized tracked deployment URLs/addresses, example paths, SSH usernames, personal machine/agent/pane names and receipt IDs. Removed deployment-specific network infrastructure notes and personal host-name preference in integration settings. Public project ownership/links and reference attribution retained.
- Prepared all five historical commits with sanitized blobs and GitHub noreply author/committer identities, plus one follow-up snapshot containing Apache selection, review records and cleanup. Local future commits now use the same verified GitHub noreply address. Original branch, remote and running service remain unchanged.
- Validation: frontend build, cargo fmt --check, full locked/offline Rust suite (42 library, 2 binary, 2 integration tests), Clippy with warnings denied and 45 Slack/Email/Jira browser tests pass. Known-identifier/credential pattern scan covers every prepared historical tree and commit; no matches. Original remote tip and live source/feature settings checked unchanged. Private local notes excluded.
- Recorded fixed bug 0014 for the personal source-selection default. No publication, force-push, production restart, agent input or receipt action performed.

## Remaining final decision

See [privacy/history guide](../../reference/privacy-and-history.md). GitHub documents that force-push alone can retain cached old commits. Recommended: retain the old repository privately and use a genuinely new repository for the cleaned history. Alternative: explicitly accept that limitation and force-with-lease the existing private main. Prepare a clean clone/bundle with scan evidence and file hashes before either final action. Do not mark this task done until the owner chooses the destination and that chosen authorized action completes; no visibility change is inferred.
