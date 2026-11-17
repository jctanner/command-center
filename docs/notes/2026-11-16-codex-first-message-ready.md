# Codex first-message fix ready

Task0086 fixes fresh native Codex chat bootstrap without a terminal first message. Exact owned native UUID/process/screen evidence authorizes only explicit input at the supported empty editor; activity remains Unknown/New session until actual provider events exist. Source changes block, older project histories cannot supply identity/receipt evidence, and the proved live transcript is followed once created. No auto-prompt, update/trust answer, hook or provider restart.

Validation: frontend/release builds,92 Rust tests,35 history+7 busy+7 outbox Python tests,6 OpenAPI checks, Clippy all-targets,11 focused release Playwright regressions passed. Read-only isolated backend confirmed the existing switchme2's already-persisted process link; no live first-message test/send/restart. Human killed original switchme during inspection; it was not recreated.

Also resolved the human-reported missing Codex ACP adapter on corsair by installing pinned2.7.0 in CC's isolated prefix, scripts disabled, native Codex hash unchanged, zero agents launched/restarted. Native mode needs no ACP adapter. Disposable real ACP round-trip testing remains unperformed.

Changes uncommitted and undeployed. Last published release remains f3d774b. Bug0043 is fixed pending deployment; updater-menu surfacing remains open bug0042. A later deployment needs human approval for the backend restart and normal listener/configuration/process/in-flight-operation checks. Do not send another message merely to initialize a provider transcript.
