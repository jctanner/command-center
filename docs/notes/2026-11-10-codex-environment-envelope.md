# Codex environment envelope

Task [0043](../tasks/done/0043-codex-kind-only-environment-context.md) fixes bug [0024](../bugs/fixed/0024-codex-environment-metadata-provenance-omission.md): native environment metadata can omit optional per-item provenance. Recognize only the observed single environment-kind/generated-ID/time envelope, preserving human XML and ambiguous/contradictory records. Visible history v2 resets cached pages; native receipt/reply cursors unchanged.

65 Python checks, 46 Rust tests, formatting/Clippy/release build pass. Backend deployed with original listeners, four healthy paths and unchanged config/pane/PID snapshots. Live old-cache API read confirms record hidden and original process/conversation retained. No agent input or native restart. Next task 0044; bug 0025.
