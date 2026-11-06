# Task 0020: Privacy and history cleanup

Owner: CC dev
Claimed: 2026-11-06
State: done
Completed: 2026-11-06

Generalize personal network/machine/operator details in the current tree and every historical tree; retain public project attribution and the SSH remote. Remove machine-name-biased integration defaults. Move live operational and pending receipt context into ignored private notes. Preserve runtime configuration, private state and agent processes. Back up original history and working files privately; prepare and validate an isolated sanitized Git repository with GitHub noreply author metadata. Original branch/remote history stays unchanged until the final publication decision. GitHub caches make force-push alone insufficient to guarantee deletion; no repository visibility change is authorized.

## Completed preparation

- Private Git bundle, uncommitted source archive, original Git config and revision/identity map backed up outside the repository. Real operations and pending receipt context retained in ignored .local/operations.md; explicit consent for receipt actions remains mandatory.
- Generalized tracked deployment URLs/addresses, example paths, SSH usernames, personal machine/agent/pane names and receipt IDs. Removed deployment-specific network infrastructure notes and personal host-name preference in integration settings. Public project ownership/links and reference attribution retained.
- Prepared all five historical commits with sanitized blobs and GitHub noreply author/committer identities, plus one follow-up snapshot containing Apache selection, review records and cleanup. Local future commits now use the same verified GitHub noreply address. Original branch, remote and running service remain unchanged.
- Validation: frontend build, cargo fmt --check, full locked/offline Rust suite (42 library, 2 binary, 2 integration tests), Clippy with warnings denied and 45 Slack/Email/Jira browser tests pass. Known-identifier/credential pattern scan covers every prepared historical tree and commit; no matches. Original remote tip and live source/feature settings checked unchanged. Private local notes excluded.
- Recorded fixed bug 0014 for the personal source-selection default. No publication, force-push, production restart, agent input or receipt action performed.

## Final decision and completion

The owner explicitly accepted the cache limitation and chose the existing repository. Adopted the verified sanitized snapshot locally, preserving every working-file hash, then replaced origin/main using an exact force-with-lease against the reviewed original tip. Push succeeded; both local and remote-tracking main now point to the sanitized history. No repository rename, creation or visibility change was made.

The prepared six-commit repository/bundle was verified by a fresh clone: 208 tracked file hashes matched, fsck found no unreachable objects, all commit emails matched the verified GitHub noreply identity, and scans of 260 historical blobs/commit metadata found no known private identifiers or credential patterns. Clean npm ci/frontend build and offline Cargo check passed. The original Git bundle, source archive and index remain outside Git. Root runtime/source/feature configuration hashes were unchanged during adoption. Completion documentation is a normal follow-up commit on the cleaned history.

Cache limitations are accepted, not claimed eliminated. Other clones should fetch/reclone or carefully align with the cleaned main instead of merging old history. Task 0009 receipt consent and setup bug 0013 remain pending. Next task 0021, bug 0015. See [privacy/history guide](../../reference/privacy-and-history.md).
