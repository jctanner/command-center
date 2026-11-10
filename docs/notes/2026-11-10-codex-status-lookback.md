# Codex status look-back

Task [0044](../tasks/done/0044-codex-status-root-lookback.md) fixes bug [0025](../bugs/fixed/0025-codex-root-status-outside-tail.md): long turns can lose their lifecycle anchor from a 512 KiB tail while fresh root progress remains. Adaptive 512 KiB/2 MiB/8 MiB windows recover the anchor; no root within cap remains Unknown. Child completion, stale/future and partial-write checks preserved.

67 Python checks, 46 Rust tests, formatting/Clippy/release build pass. Real remote status scans were about 20 ms excluding SSH. Backend deployed with original listeners, four healthy paths and unchanged config/pane/PID snapshots. Live queue/detail both show Working for original process/conversation. No agent restart/input or native log changes. Next task 0045; bug 0026.
