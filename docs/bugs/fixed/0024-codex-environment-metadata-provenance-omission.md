# Bug 0024: Codex environment envelope omits optional provenance

State: fixed

A native response-item user message carries environments.environment_context and generated message/turn/create-time metadata, but omits content_item_metadata. The strict older filter renders it as human chat. Recognize only this observed envelope, preserve contradictory/malformed/mixed/human data and bump visible history version without changing native receipt/reply cursors. Task 0043.

Fixed in [task 0043](../../tasks/done/0043-codex-kind-only-environment-context.md): narrowly recognize the observed generated native envelope and reset v1 visible-history caches. Three new Python regressions, existing history/receipt suites and live API verification pass. Human/ambiguous metadata and native cursors stay intact. Deployed backend only.
