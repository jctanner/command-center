# Configurable container profiles

Task[0119](../tasks/done/0119-configurable-container-profiles.md) adds Settings profiles, reviewed per-launch overrides, saved-config restart and coordinator discovery/use guidance. Native remains default. Validation and limitations are in the task: Rust/Python/API/browser checks passed; real rhlaptop follow-up blocked at inventory502 before any remote test changes. No deployment/commit/push or existing-agent restarts.

Next operational step: when requested, validate configurable options against a disposable real runtime, then deploy preserving live agent identities and listeners. Existing legacy Goose requires a separately authorized broker upgrade before changing its active profile.
