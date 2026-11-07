# 2026-11-06: Omarchy theme selector

Completed [Task 0022](../tasks/done/0022-omarchy-theme-selector.md). Settings > Appearance switches CC's default or 23 pinned Omarchy palettes live across workspaces, Markdown, CodeMirror and xterm, with browser-local persistence and early-paint/cross-tab handling. Five light variants. MIT provenance retained in source and served assets. Semantic tokens adapt UI text contrast; custom card accents and explicit terminal RGB output keep their values. No upstream executable configs or runtime external assets.

Frontend build, five final theme checks, 15 Settings/navigation checks and 18 Files/tmux regressions passed. Draft/undo/language preservation and no theme-driven terminal input/resize/reconnect verified; reviewed synthetic desktop/phone screenshots. Found and aligned the old editor background override with the base token. Generator/notice consistency and diff checks passed. Deployed frontend atomically; old asset hashes retained, old index backed up privately, backend process and tmux PID/dimensions unchanged, source settings untouched, loopback/HTTPS notice/assets verified.

Reload and use Settings > Appearance. Actual Safari hardware not retested; manifest/icons retain default branding. The owner subsequently authorized committing and pushing this feature. Task 0009 remains pending. Next task 0023, bug 0015.
