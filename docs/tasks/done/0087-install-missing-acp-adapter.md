# Task0087: Install missing ACP adapter during switch

Owner: CC dev; claimed2026-11-16. State: done (implemented and verified; not deployed).

Human requested automatic as-needed adapter installation during switching. Codex-first: missing adapter yields a concrete pinned package/prefix review. Explicit install starts a durable one-shot isolated job over shared transport, does not stop any agent, and requires fresh switch preparation after installation. No installs from GET, global installs, arbitrary package/version/command input, blind overwrites, package scripts or automatic uncertain retries. Keep native default and pending task0086 changes intact. Fixture install runner for tests; no live installation/deploy/agent launch in this task unless requested.


## Delivered

Missing Codex ACP in native→ACP switch preparation returns install_required with a fixed package/version/prefix review. GET does not install. A human Install adapter and review switch click consumes the expiring receipt before shared-transport IO and starts a private one-shot job. Fixed @agentclientprotocol/codex-acp2.7.0, public registry and SHA-512 integrity are server-owned; clients pass only the opaque receipt ID. npm identity/home are bound; no arbitrary package, path, flags or scripts are accepted.

The installer uses private staging/cache/config, disabled lifecycle scripts/audit/fund, a180-second runtime and768 MiB monitored disk budget. Package/version/integrity/executable checks precede atomic no-overwrite publication. An exclusive provider lock and original UUID prevent duplicate jobs; atomic fsynced result receipts survive browser/backend restart. Safe staging/cache cleanup and bounded retained metadata protect resources; unresolved jobs are never automatically retried. Close leaves the job running as disclosed. Existing/incomplete prefixes and PATH adapters are not overwritten. Node/npm and compatible Linux atomic publication are prerequisites.

An installed result triggers a fresh switch preparation using the current runtime revision only after stable-endpoint verification. Source/process/conversation/directory/screen/adapter guards and separate switch confirmation remain. Installation itself does not stop, restart or message agents. Claude/pi installation, generic package management, automatic updates and ordinary launcher installation remain outside this slice.

## Validation

- Frontend TypeScript/Vite and Rust debug/release builds passed.
-92 Rust library tests passed; Clippy all-targets with warnings denied passed.
-25 Python ACP/broker/helper/installer tests passed. Installer tests cover read-only proposal, private publication, package/path overrides, wrong integrity, failed cleanup, atomic no-overwrite, per-provider lock preservation and uncertainty without retry. No real registry access in tests.
- Six served OpenAPI checks passed against the release artifact.
-22 release Playwright regressions passed: existing ACP chat, Codex round trips, installation desktop/mobile, failure, lost response/reload, backend-restart recovery and task0086 first-message behavior. The original source PID stays unchanged until the separate Switch confirmation; duplicate install UUIDs cannot run again.

No live installation, new real-provider session, source-agent action, deploy, commit or push performed for task0087. The earlier manual isolated corsair2.7.0 installation is from task0086 and is reused. Task0086's uncommitted first-message changes are preserved and included in the release regression run. Last published deployment remains f3d774b. Production updater-menu surfacing remains open bug0042.

## Handoff

Ready for a human-requested commit/push/deploy of both pending features. Preserve listeners/configuration/tmux PIDs and in-flight operation preflights. Active installer jobs are durable and independently bounded; restarting CC never repeats them. Do not test real switching against an existing agent without a scoped request. Existing manual adapters may still be incompatible; the installer only handles missing ones and does not replace them.
