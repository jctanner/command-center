# Bug 0036: Native trust picker variants were unsupported

Found/fixed: 2026-11-15, CC-72 real-harness validation.

Real Claude 2.1.325 renders an unnumbered refusal-first folder picker, with No selected initially. Codex 0.167.0's managed Git-folder picker uses Back to Agent Command Center and an esc back footer. The previous exact profiles rejected these screens, leaving activity Unknown; no keys were sent by that unsupported detection.

Added narrow profiles for the actual complete disclosures, exact paths/labels/order/footer and one selected row. The internal bound trust-choice index permits a single checked Down for Claude before one Enter; Codex retains its bounded native selection. Picker changes retain a stable disclosure ID, while process/launch/path/screen/endpoint guards still apply. Navigation indices are removed from public views.

Validation: Python native-profile/guard tests (8), real Claude/Codex disposable card/ticket/Decline/Trust tests (both passed), initial no-tools prompts consumed after explicit guarded UI acceptance. Decline audited with zero send-keys calls. Existing agents were untouched; temporary sessions/folders were removed. Private native evidence remains ignored under .local/reviews; no real transcript/screens in Git.
