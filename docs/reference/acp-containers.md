# Container-managed ACP profiles

Container Goose is an opt-in ACP launch path; native launch remains the default. Goose is never installed or executed directly on the host. Settings → Containers manages reusable profiles on each selected machine through CC's shared transport. Docker and rootless Podman are supported on Linux; engines and images must already be installed/cached. CC never pulls images implicitly.

## Profile configuration

`GET /api/v1/hosts/{host}/acp/profiles?connection_revision=...` lists profiles with normalized `config` and reference metadata, never credential values. `GET /hosts/{host}/acp/profile-settings` with the same query returns `{revision,profiles}`. An explicit configuration edit uses PUT to that route with `{connection_revision,revision,profiles}`. It replaces the registry atomically, checks both endpoint and registry revision, and starts nothing. Preserve drafts on409; inspect saved settings after uncertain writes before retrying.

The private host registry is `~/.config/command-center/container-profiles.json` (0600, account-owned, no symlinks), at most16 profiles/64KiB. Settings exposes these literal fields:

| Field | Meaning |
| --- | --- |
| `id`, `label` | Stable machine-local ID and display name; duplicate IDs rejected. |
| `engine`, `image` | `podman` or `docker`; cached image tag/name or digest. Preparation binds its immutable ID. |
| `entrypoint`, `args` | Absolute executable **inside** the image, plus literal argument array; default Goose ACP. No host shell evaluation. |
| `workdir`, `state_target` | Container paths, default `/workspace` and `/home/goose`. |
| `workspace_policy` | `managed` requires an existing dedicated child of `~/.cache/command-center/goose-workspaces`; `project` permits the existing canonical project directory. No copying or automatic directory creation. |
| `mounts` | Up to16 `{source,target,read_only,selinux}` binds. Source is an absolute **host** path or `{workspace}`; target is a **container** path. Labels: `none`, `private`, `shared`. |
| `selinux` | `host` preserves host policy; `disabled` explicitly disables container labeling. Relabeling is allowed only under managed scratch, never real projects. |
| `volumes` | Up to8 additional literal named volumes with target/read_only. CC's per-agent persistent state volume is separate and always retained. |
| `user`, `user_namespace` | Container account and `default`/`keep-id`. Podman keep-id requires numeric uid:gid; Docker rejects keep-id. |
| `environment` | Non-secret literal NAME=value settings. Secret-like names require references instead. Goose approve mode and telemetry policy cannot be overridden. |
| `secret_refs` | Up to8 `{name,path,json_pointer}` references to private owned host JSON files under the account home. No value belongs in the profile or API request. |
| `model`, `base_url` | Optional model and HTTPS OpenAI-compatible endpoint; omitted values preserve configured environment defaults. |
| `network` | `default`, `none`, or explicitly reviewed `host`. |
| `cpus`, `memory_mb`, `pids_limit` | Optional limits:0.1–64 CPUs,64–262144 MiB,16–4096 PIDs. |

Podman runs explicitly local/rootless. Docker accepts only a local Unix daemon endpoint, then pins that endpoint and daemon identity. Remote contexts are rejected. Real project binds are possible only when explicitly configured/reviewed, without relabeling. Mounts expose account-accessible data to the agent: do not add home, engine sockets, SSH agents or credentials as a workaround. Engine flags are structured, not a free-form runtime command.

Existing six-field Goose profiles remain readable, including `secret_file` (legacy `/enmaas/key` reference). Saving unchanged legacy definitions preserves their original representation/hash. Profiles used by active legacy brokers without retained configuration cannot be changed/deleted: duplicate the profile or perform a separately authorized broker upgrade first.

## Prepare, review, Start

```json
{
  "connection_revision": "observed-revision",
  "provider": "goose",
  "container_profile": "goose-example",
  "path": "/home/USER/.cache/command-center/goose-workspaces/my-agent",
  "container_overrides": {"cpus": 2, "memory_mb": 4096}
}
```

POST this to `/hosts/{host}/acp/prepare`. Overrides are optional partial profile fields, excluding id/label/legacy secret_file, and affect only this launch. Arrays/maps replace their field; they are not incrementally appended. Native adapters reject container fields. This is the standalone ACP workflow; native ticket launching is unchanged.

Review the returned `container_review`: engine/daemon scope, immutable `image_id`, image reference, host binds and container targets, command, user, network, limits, nonsecret environment and secret references. No secrets are returned. In the launcher, **Advanced container options** edits only this launch; **Review container launch** prepares it. Changing configuration or path invalidates review.

Before one POST `/acp/start` with the prepared token and optional initial_prompt, privately retain its broker UUID and attempted phase. Preparation binds profile/override hashes, executable, directory/mount identities, runtime scope and image. Start rechecks and consumes the grant before execution. Never automatically repeat uncertain Start: observe the original broker UUID instead. Initial prompt is provided at Start, separately from container configuration review.

## Lifecycle and secrets

Each broker owns an immutable container with `cc.acp.*` labels and a persistent `cc-goose-state-<original broker UUID>` volume. The detached tmux broker owns ACP stdio independently of CC/browser lifetime. Its pane is a broker CLI, not Goose's native TUI. Goose remains in approve mode; tool choices require explicit human permission. Native conversion and broker host-shell commands are unavailable.

Restart & update broker, while verified idle with no unresolved tools/messages/permissions, retains the **saved resolved configuration, image ID, engine endpoint, mount identities, state volume and exact Goose conversation**. Editing/deleting a newer profile or moving an image tag does not change an already prepared v2 agent. Missing saved image/mount, changed runtime scope or replaced container fails closed. Legacy brokers still require their original profile until upgraded. A failed session/load never falls back to a new conversation; old drafts/outbox are never resent. Close stops only the verified container, preserving state volumes and project/scratch files. No automatic volume GC or closed-session browser picker is provided.

Secret files are validated on the host. At actual start, bounded printable JSON-pointer values enter the container through stdin and a fixed in-container bootstrap before ACP begins. They never appear in runtime arguments, engine environment flags, env files, CC state or receipts. They remain in the authorized process environment while running; this is not a vault against the agent inspecting its own environment. Source failures return bounded errors without secret contents.

The original rootless Podman Goose ACP path was verified end to end on rhlaptop (chat, approval, restart/resume, cancellation, close and host-owned output); see task0102. Configurable profile validation evidence and runtime coverage are recorded separately in task0119. Engine flag references: [Docker run](https://docs.docker.com/reference/cli/docker/container/run/), [Podman run](https://docs.podman.io/en/stable/markdown/podman-run.1.html).
