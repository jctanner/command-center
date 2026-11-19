# Task0163: Runtime inside full-width context meter

Claimed2026-11-18 by CC-dev. Place runtime visually inside context meter, right-aligned with padding. Meter uses full row; reserve text space to prevent overlap, keep sizing and update semantics. Validate frontend and existing desktop/mobile geometry tests.

## Completed2026-11-18

Meter spans full row; runtime is visually inset7px from right and vertically centered. Context text reserves7ch+12px padding to avoid overlap; progress fill spans the whole track. Runtime remains outside meter accessibility semantics so it does not alter context percentage. No provider/update changes. Reference updated.

Validation: frontend build and two existing runtime geometry Playwright cases1440/393 passed. Updated geometry assertion checks runtime inside meter, full track width, same vertical center and unchanged card width/height across unknown/minute/hour/day labels. Screenshot test-results/agent-card-runtime-1440.png inspected: full-width padded track with legible right-aligned2d4h. git diff --check passed. Logs .local/runtime-inside-meter-{build,tests}.log. No commit or deployment.
