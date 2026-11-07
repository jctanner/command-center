# Task 0023: Desktop header theme selector

Owner: CC dev
Claimed: 2026-11-06
State: done
Completed: 2026-11-06

Add a native color-scheme selector in the wide desktop header, synchronized with Settings Appearance and existing browser-local persistence/cross-tab events. Keep compact/narrow headers unchanged, validate full navigation plus clock/control bounds, and ensure in-place terminal colors produce no input, resize or reconnect. Preserve the existing Appearance selector on every viewport.

## Change and validation

Wide desktop header (1440+ CSS pixels, fine pointer) now offers a compact native scheme dropdown. Header and Appearance selectors share catalog population, current value, persistence and cross-tab events; no duplicate preference/state. Compact/narrow/touch-first headers keep the selector in Settings. Full desktop actions use a bounded select and spacing that preserves all seven navigation items, status and clock in one row.

Frontend type/build and all six theme tests passed (6.9s). Additional focused keyboard variant passed (2.1s): native ArrowDown/Enter selection produces no terminal input, resize or reconnect and preserves pane PIDs/dimensions. Verified selector synchronization both directions and across tabs, catalog count, 1440/1920 header bounds/full navigation, and hidden header control with visible Appearance at 1280/900/393. Reviewed both synthetic desktop screenshots. git diff --check passes. No backend source changes or additional Rust checks needed.

Frontend deployed atomically with old index privately backed up and existing hashed assets retained. Loopback/HTTPS assets/health verified; backend PID, private config and tmux pane dimensions/processes unchanged. Reload to use the header dropdown. The owner subsequently authorized commit/push. Task 0009 remains pending. Next task 0024, bug 0015.
