# Task 0022: Omarchy-inspired theme selector

Owner: CC dev
Claimed: 2026-11-06
State: done
Completed: 2026-11-06

Add a browser-local live theme selector using the built-in Omarchy color palettes, keeping CC's default available. Check upstream license/provenance and vendor only bounded palette data. Theme UI surfaces, Markdown, CodeMirror and xterm without reconnect/input/resize traffic or losing drafts/history. Persist validated selection with safe fallback before first paint; work on compact clients without attaching terminals. Add Appearance in Settings, preserve feature/machine guards and custom card colors. Validate light/dark contrast, keyboard/mobile layout, persistence and unchanged live terminal dimensions/processes. No desktop theme installation, remote scripts or credentials.

## Implementation

- Settings > Appearance provides the CC default plus all 23 built-in Omarchy palettes at upstream commit 14abc0762ce38547d1912061969df58962f6f10a, including five light variants. Pinned hex/mode data only; root MIT attribution retained and the notice is served with built assets. No desktop configs, fonts, wallpapers or executable theme code copied.
- Semantic CSS tokens replace fixed application colors across workspaces, dialogs, Markdown and custom-card base surfaces. Reproducible generator validates IDs/modes/colors and adjusts normal UI text/status colors for contrast. User-selected card accents retain their exact value.
- Validated browser-local cc.theme preference, pre-style restoration, cross-tab storage updates, meta theme-color and graceful unknown/blocked-storage fallback. No backend setting/API needed. Appearance is independent of feature/machine edit guards.
- xterm updates its default/indexed palette in place with a disposable theme subscription, without fitting, reconnecting or input. CodeMirror uses CSS-based syntax roles and a theme compartment across active/inactive document states; drafts, language and undo survive. Removed the obsolete fixed One Dark dependency; made existing Lezer highlighting an explicit dependency.

## Validation

- Frontend type/build passed. Generated CSS is deterministic; distributed/retained MIT notice bytes match. git diff --check passes. Backend source unchanged, so no Rust checks repeated for this slice.
- Five final theme tests passed (6.1s): all 24 options and representative 4.5:1 text contrast, native first-paint restore while main JS is held, invalid/denied storage, reload/cross-tab state, active/inactive file drafts/highlighting/undo, desktop/phone input/resize/reconnect absence with unchanged pane PID/dimensions, and synthetic agent Markdown/custom colors in light/dark modes.
- Existing Settings/navigation suite: 15 passed. Existing Files and tmux checks: 7 and 11 passed in the combined batch; the new editor theme test exposed a higher-specificity old background declaration, aligned with the base token before the final five-theme-test pass. No input/mutations against live agents; all behavior checks use isolated fixtures.
- Reviewed synthetic Tokyo Night/Flexoki Light Settings and agent-chat screenshots, light terminal ANSI output and compact Catppuccin Latte. Portrait/landscape bounds validated; actual Safari/phone hardware not retested.
- Frontend-only atomic deployment retained previous hashed assets and backed up the old index privately. Loopback/HTTPS assets and served license verified. Live backend PID, tmux pane PIDs/dimensions and private source/feature settings unchanged. No restart, host configuration or remote provider changes.

## Limits and handoff

Reload the browser/app, then Settings > Appearance > Color scheme. Preferences are per browser profile/origin; other devices and HTTP/HTTPS origins are independent. With blocked storage the choice lasts only for the page. UI colors are adapted for contrast; indexed/default terminal colors follow the source palette. Explicit true-color application output, manifest/icon branding and remote tmux/provider settings are unchanged. No runtime upstream downloads or auto-updates.

The owner subsequently authorized committing and pushing this feature. Task 0009 receipt choice remains pending. Next task 0023, bug 0015.
