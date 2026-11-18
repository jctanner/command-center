# ADR-0006: Reviewed host-local container profiles for ACP

Status: accepted for the CC-100 Goose slice,2026-11-17.

Container launch needs machine-specific mounts, credentials and provider configuration. Free-form runtime/env/mount arguments in the launch API would create another arbitrary command interface and carry secrets through CC. Keep profile definitions private on the agent host; the versioned API selects an opaque reviewed ID and binds its hash, runtime, image and workspace identities into existing one-use grants. No generic plugin or remote daemon is introduced.

V1 is rootless Podman and one fixed digest-pinned Goose image, private managed scratch directories only, per-agent persistent state, fixed explicit approval mode and host-local in-container stdin credential bootstrap. A mapped container UID preserves host file ownership without relabeling real projects. State volumes survive normal close. Immutable container IDs and exact labels complement broker process/endpoint targeting. Restart uses existing ACP session/load with the same state volume and no host/native fallback; native launch stays default.

This deliberately defers real-project copy/synchronization, additional runtimes/images/secret formats, autonomous mode/turn caps, closed-session discovery and garbage collection UI. Host-local configuration is an operator-reviewed exception to CC's normal centralized settings, useful for the requested first machine. See [container reference](../reference/acp-containers.md) and [task0102](../tasks/done/0102-container-managed-goose-acp.md).
