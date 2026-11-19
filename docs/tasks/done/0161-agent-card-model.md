# Task0161: Reported model on agent cards

Claimed2026-11-18 by CC-dev. Add model after harness in existing single-line card metadata; omit unknown or project-history model and retain full text in tooltip. Preserve card dimensions. Validate build and existing responsive browser fixtures.

## Completed2026-11-18

Card second row shows machine · harness / model · project. Only process-associated metrics matching provider and available instance are used; unknown models and project-history associations are omitted. Full model/path stay in existing tooltip; CSS single-line ellipsis and card dimensions unchanged. No new requests or backend change.

Validation: frontend TypeScript/Vite build and two focused Playwright cases1440/393 passed. Long reported model appears with full tooltip, card width/height unchanged, project-history model excluded, unknown omitted, zero terminal WebSockets. git diff --check passed. Logs .local/agent-card-model-{build,tests}.log. No live agent input, commit or deployment.
