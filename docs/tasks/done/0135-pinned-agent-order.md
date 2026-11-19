# Task0135: Persistent manual pinned agent order

Claimed2026-11-18 by CC-dev. Human requests drag reorder/persistent positions for pinned cards, manual/static by default, with Settings opt-in activity sorting. Store layout metadata centrally with revision guards; preserve unpinned sorting, filtering, selection/drafts and restart transfers. Add keyboard/menu alternatives, API/OpenAPI/docs and Rust/browser tests. No deploy or commit requested.

## Completed2026-11-18 (local date)

Pinned cards default to stable backend-persisted manual order; unpinned activity sorting unchanged. Desktop whole-card dragging, visible touch grip, Alt+Up/Down and context-menu movement supported. Settings → Agents explicitly saves manual/activity mode for all clients, preserving manual positions. Filtering retains hidden keys; new pins append and verified restart/mode handoffs transfer positions. SQLite agent_layout table stores bounded metadata only; opaque card order_key and GET/PUT settings/agents documented in OpenAPI. Exact revision/membership checks reject stale/duplicate/missing/unknown order keys without retries. Queue hydration refreshes layout independently of inventory cache. No agent control or conversation copies.

Validation: TypeScript/Vite and Rust builds passed; cargo fmt check and Clippy all-targets -D warnings passed.101 Rust tests and6 served OpenAPI tests passed. Initial restricted Rust run blocked two socket tests; authorized rerun passed. OpenAPI initially lacked required Origin documentation for the new PUT; corrected and all contract checks passed.

29 distinct browser cases passed:13 agent-polish,5 settings,5 pinned-order and6 native/ACP handoff/restart tests. Pinned tests cover desktop drag, real touch events, keyboard/filter preservation, browser/backend restarts, cross-browser state, activity opt-in/manual restoration, stale API validation and a concurrent drag rejected with no retry. Touch testing first found the existing hidden pin-label style also hiding the new grip; a visible dedicated grip fixes it. Phone screenshot inspected at test-results/pinned-order-mobile.png. All fixtures disposable; no live agents or production preferences changed.

Logs .local/pinned-order-{build,web,clippy,rust-final,openapi,browser-final,final,handoff}.log. git diff --check passed. No commit/push/deploy until the subsequent explicit release request.
