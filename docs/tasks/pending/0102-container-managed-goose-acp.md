# Task0102 / CC-100: Container-managed ACP agents, Goose on rhlaptop

State: pending; unclaimed. Requested by human through coordinator2026-11-17. Human explicitly deferred this until current CC-73/75 native-command work is finished; no urgency. Do not switch scope or start implementation/testing while task0101 remains active.

## Goal / hard boundary

CC→existing SSH bus→rhlaptop→containerized Goose ACP→normal agent card. **Never install Goose directly on rhlaptop. Goose runs only inside a container.** Real end-to-end validation must use a Goose container on rhlaptop; rhlaptop-specific settings are acceptable for the first slice, generalized later.

## References to read when resumed

Remote personal-assistant notes/goose-cli-eval/: REPORT.md ACP addendum and final Decisions/questions section; goose-acp-container.sh; acp_client.py; evidence/acp-*. Read via guarded CC file API (or request relay), not an invented host install. Initial read-only retrieval of the three text files was already in flight when deferred and completed into ignored .local/reviews/goose-container-eval/. No Goose install/container launch/runtime change occurred; evidence directory has not been inventoried. Verify current source revisions before relying on cached text.

Reported baseline from CC-85 (not independently tested by CC-dev): digest-pinned ghcr.io/aaif-goose/goose image; podman -i --rm --init --stop-timeout10, per-instance name/cc.acp.* labels and persistent sessions volume; ENMAAS+GLM host-side configuration. Read the full digest from the reference launcher—never use the brief's abbreviated digest. Key comes from host pi auth.json through an ephemeral env-file mechanism: never key bytes in CC state/logs/receipts, CLI argv, durable disk file or image.

Reported ACP behavior: clean stdio JSON-RPC; initialize advertises loadSession and list/close; approve mode yields explicit allow/reject once/always permissions; new-container session/load preserves Goose DB session ID/history; cancel works; stdin EOF/client death stops/removes container in about10s. These are supplied evaluation results, not CC implementation evidence.

## Design questions / proposed scope

Send the human a short design note before the big implementation, with blockers. Prefer reviewed per-machine profiles (pinned image, fixed runtime/mount/workdir policy, state volume, host-side secret reference, provider/model/mode and owned naming/labels), not arbitrary image/mount/env/shell fields at launch. Launch selects machine+folder+profile. Verify immutable runtime container identity/ownership as well as names/labels; preserve broker/process/endpoint/session targeting. Define lifecycle close via guarded podman stop and restart/resume via a reviewed relaunch+session/load without a new-conversation fallback. Preserve native launch as default and explicit tool approvals; consider a bounded CC-side turn guard for auto mode because ACP has no standard max-turns setting.

SELinux enforces: **never :Z a real project directory**; use scratch/per-agent copy and review synchronization/ownership rules. Account for rootless subuid ownership on created files. Goose cost_usd is a list-price estimate, not real ENMAAS spend; do not label it as actual spend.

## Acceptance / validation

- Launch real container on rhlaptop and expose normal ACP card.
- Prompt, streamed response and guarded explicit permission choice work from CC.
- Close/restart/resume preserve exact intended session and verify container cleanup/EOF behavior.
- Credentials remain only on source host; inspect CC logs/state/receipts for absence of values without printing them.
- Reviewed profile/lifecycle API, tests, OpenAPI/docs and deployment note; report unavailable coverage/blockers honestly.
- No unsupported host install, real-project relabel, arbitrary runtime command passthrough, implicit approvals, agent migration or uncertain action replay. Deployment/live-agent disruptions still require applicable human approval; this backlog does not change live Board tickets or authorize unrelated messages.
