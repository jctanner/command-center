# Task 0030: Agent chat code highlighting

Owner: CC dev
Claimed: 2026-11-08
State: done

## Goal

Theme-aware syntax highlighting for fenced code in assistant chat, including pi histories. Reuse existing CodeMirror/Lezer grammars, preserve sanitized Markdown/copy fidelity and plain-text fallback. No changes to provider logs, user/tool text, terminal streams or message identity.

## Acceptance criteria

- [x] Lazy local grammars for recognized fenced languages; bounded work, unknown/missing/oversized code stays plain.
- [x] Syntax colors follow existing theme variables without rerendering messages or attaching terminals.
- [x] Browser coverage for colors, literal code/copy, unsafe HTML, fallbacks, theme changes and compact layout; build and deployment verified.

## Validation

- `npm --prefix web run build -- --outDir dist-next`: TypeScript/build pass, using existing dependencies. Existing Vite mixed-import/large-chunk warnings remain. Grammar modules are local lazy chunks; no new provider/network integration.
- Focused Playwright batch (`tests/agents.spec.ts -g 'agent code highlighting|assistant Markdown is readable'`) passes two tests (2.6s): JavaScript/Rust/Python/JSON/bash highlighting, literal text and Unicode preserved, unknown/unlabeled/oversized plain fallback, exact copy, sanitized HTML, theme recolor without node replacement, compact viewport containment and no terminal WebSockets/external image requests. Synthetic Flexoki Light desktop/phone screenshots inspected; highlighted code is visible in both.
- Work bounded per assistant message: eight recognized blocks, 16,000 characters per block, 64,000 total, deferred first render. No language guessing or CodeMirror editor creation. Inline/user/tool text unchanged; theme CSS reuses editor palette semantics.
- Frontend deployed by merge-copying assets and atomically replacing index, retaining old hashes and a private prior-index backup. Live health, served index and entry JS/CSS hashes verified. No backend or native agent restart, messages, approvals, ticket edits or terminal input.
- No Rust/backend changes; Rust suites not rerun. Physical iPhone/browser clipboard permissions remain device checks; copy fidelity verified with browser clipboard fixture.

## Handoff

Reload CC to load the frontend. Fenced assistant code is colored for all harnesses, including pi, when its language label is recognized. This is native-history Markdown styling, not arbitrary ANSI replay from the CLI. Existing pending work and uncommitted changes preserved. Task 0009/Board sync remain untouched. Next task 0031, bug 0018.
