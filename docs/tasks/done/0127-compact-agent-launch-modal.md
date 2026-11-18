# Task0127: Compact Start agent modal

Claimed2026-11-18 by CC-dev. Human approves task0126 independent review recommendations: common choices first, Model beside Agent, responsive field grouping, full location summary, expandable environment/session/permission controls and persistent actions/status. Fix bugs0053/0054 without changing backend launch guards/defaults, recovery or explicit consent. Verify desktop/phone/short viewport geometry, keyboard/focus, native/ACP/container behavior and existing launch regressions. Preserve task0125 uncommitted file-link fixes. No commit/push or disruptive deployment requested.

## Completed2026-11-18

Standalone Start agent now has a persistent header and status/action footer around independently scrolling fields. Desktop uses three columns with Agent/Model together; mobile uses paired Agent/Model and stacked location choices. Selected projects show a wrapped machine-qualified resolved path instead of a duplicate directory editor; manual paths remain editable. Tmux destination, environment/pinning and permissions are keyboard-accessible disclosures with current-value summaries. Trust stays default-off and checked consent is visible in summary and preparation feedback. Container review, native/ACP defaults, grants, receipts and recovery remain intact. Model help is associated with Model, checkboxes align inline, and mode changes clear stale native readiness. Bugs0053/0054 fixed.

Validation:
- `npm run build --prefix web -- --outDir dist-next`: TypeScript/Vite passed; existing bundle-size warning remains.
- From web/: `TMPDIR=/var/tmp CC_BINARY=../target/debug/command-center CC_WEB_DIR=dist-next npx playwright test tests/agent-launch-layout.spec.ts tests/launch.spec.ts tests/acp.spec.ts tests/container-profiles.spec.ts --workers=1`:69 passed,1 assertion failure on old wording “pi available”. Updated to assert “Ready · pi”; focused rerun passed.
- Final layout suite:6 passed, including added keyboard/manual-path/draft-on-resize check. Across all four suites,71 distinct cases passed after the wording correction. Native/resume/recovery, named destination, local/fixture SSH, venv, explicit permissions, ACP and reviewed container profiles covered using isolated fixtures. No live agents launched or contacted.
- Screenshots visually inspected at1366x768 and393x852; geometry checked at1440x900,1366x768,393x852 and844x390. Desktop core form fits without scrolling; short/mobile content scrolls independently of footer. Screenshots under ignored test-results/compact-agent-launch-initial-*.png.
- `git diff --check`: passed. No Rust changes; no additional Rust run.

Earlier test invocation from repo root failed because relative fixture binary paths resolved outside the repo; corrected cwd to web. Initial geometry assertion incorrectly compared before/after disclosure expansion; corrected to assert footer stays inside viewport after expansion and does not move while scrolling. No application failure concealed by either correction.

No commit, push or production deployment. Existing uncommitted task0125 file-link changes preserved. Browser emulation is not an actual phone keyboard test.
