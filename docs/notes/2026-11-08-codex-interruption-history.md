# Codex interruption history

Fixed harness-generated turn_aborted/environment_context being shown as human chat and included in outbox user evidence. Trust explicit Codex content-item kinds plus harness provenance, never XML-looking text. Preserve real human input, native lifecycle events, logs and reply cursors. Version visible history and reset old pages automatically.

64 Python checks, 44 Rust library tests, formatting/Clippy/release build and one synthetic browser/cache-reset regression pass. Synthetic screenshot reviewed. Backend deployed with current listeners/origin/environment; live process-linked history verifies the fix and preserves the user report. Original pane processes/configuration and four access paths verified. No live input or receipt mutations.

See [Task 0028](../tasks/done/0028-codex-internal-history-records.md) and [Bug 0016](../bugs/fixed/0016-codex-interruption-records-shown-as-human-chat.md). Prior uncommitted changes preserved. Earlier Board sync was interrupted after reads only and remains pending; no agent prompts sent. Task 0009 unchanged. Next task 0029, bug 0017.
