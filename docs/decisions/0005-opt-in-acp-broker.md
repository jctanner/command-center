# ADR-0005: Opt-in host-owned ACP broker

Status: accepted for experimental implementation
Date: 2026-11-16
Related: [task0077](../tasks/done/0077-optional-acp-broker.md), [reference](../reference/acp-broker.md).

Native tmux launch and native log/process/pane observation remain default. ACP is an explicit separate connection mode, initially Claude ACP v1 only. Do not migrate native agents, send ACP JSON into a native CLI, or automatically fall back between protocols.

ACP stdio needs one owner. A small Python broker, launched in a dedicated tmux pane on the configured machine, owns the adapter's pipes/process group and provides a basic terminal interface. Rust CC is a reconnectable client through the existing local/SSH/ProxyJump transport and a private Unix socket; browser updates use SSE. CC's process lifetime is not the agent lifetime. Direct tmux interaction must work while CC is stopped. A broker failure is not automatically recovered or replayed.

The long-lived remote broker is opt-in installed code, an explicit exception to default native mode's ephemeral helpers. It exposes no network listener and does not replace the Rust backend. Endpoint/process/permission identity guards and durable intent receipts protect explicit input. Browser and terminal serialize through the same dispatcher. No automatic tool permissions, unsupported capabilities, native fallback, arbitrary executable/flags or production migration. New conversations only; independent native resume and full TUI parity remain outside this preview.

The first UI isolates these experimental agents behind ACP agents rather than overloading the native card/outbox semantics. Full unified inventory, tickets and notification integration can follow once the protocol path is proven. Install adapters independently in a pinned isolated prefix; never silently install/update the user's native harness or credentials. Preserve real-provider test authorization and disruptive deployment approval boundaries.

## Integration follow-up (task0082)

The human approved integrating cards and chat and making preparation internal to Start. Shared presentation and metadata now wrap two explicit transports; native remains default. Queue discovery verifies managed brokers without migration, chat streams/replies/permissions remain ACP-only, and existing card/read stores use namespaced broker process identity. The initial separate catalog is retired. Explicit close uses durable UUID metadata plus a start/boot/tty-verified pidfd; native window controls and outbox are never used as fallback. Existing brokers are adopted read-only without restarting. Restart/resume remains unavailable until verified.


## Reviewed installer follow-up (task0087)

The human requested installing missing adapters as part of switching. Codex missing-adapter preparation now exposes a fixed package/prefix review. An explicit one-use POST starts a private bounded one-shot installer over shared transport; a separate switch review follows success. It is not a generic package runner, long-running host daemon or automatic updater. Fixed registry/integrity, disabled npm scripts, isolated configuration/cache and atomic no-overwrite publication preserve existing adapters/native agents. Durable private results survive CC disconnect/restart; unknown outcomes do not replay. Ordinary launch behavior and default native mode remain unchanged.

## Claude handoff follow-up (task0088)

Explicit exact-conversation handoff now supports Claude as well as Codex. Claude uses ACP v1 session/load and native --resume, preserving CLAUDE_CONFIG_DIR and independently validated persisted continuation records. No project-recency, summary or new-session fallback is allowed. Active/unverified native background work, pending ACP tools and unresolved receipts block handoff. The installer adds one fixed Claude profile (0.107.3, Node >=22) alongside Codex; lifecycle scripts remain disabled and existing prefixes are never overwritten. Existing brokers lacking handoff capability remain unsupported without an independently authorized replacement.
