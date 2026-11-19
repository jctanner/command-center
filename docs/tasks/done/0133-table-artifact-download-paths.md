# Task0133: CC-112 table artifact download paths

Claimed2026-11-18 by CC-dev. CC-112 names a home-relative clips directory immediately before a table of bare MP3 filenames. Files exist, but links resolve against the project and return404. Bind table-relative artifact links to one explicit directory in the immediately preceding paragraph, without filesystem guessing or broader context inference. Verify actual CC-112 file metadata and synthetic native/ACP downloads, negative ambiguity cases and existing path regressions. No agent input or commit/deploy requested.

## Completed2026-11-18

Bug[0055](../../bugs/fixed/0055-table-artifact-directory-context.md) repaired in the shared native/ACP Markdown renderer. A table’s relative links/code filenames use one absolute/home-relative directory ending in slash explicitly introduced by in/under/inside/to in the immediately preceding paragraph. Explicit full paths remain authoritative. Hints never cross tables/paragraphs/messages or override traversal guards; no filesystem guessing. Non-table paths and ambiguous/detached folder references retain existing project resolution.

Verification:
- Actual CC-112 artifacts are intact under the named clips folder. All9 MP3 download paths returned200 with attachment headers; read1 byte per stream then closed. Original project-relative path reproduced404. No media contents printed or stored. Private metadata proof .local/reviews/cc112-download-path-proof.json.
- `npm run build --prefix web -- --outDir dist-next` passed TypeScript/Vite with existing bundle advisory.
- From web/: `TMPDIR=/var/tmp CC_WEB_DIR=dist-next npx playwright test tests/chat-file-links.spec.ts --workers=1`:18 passed. Includes actual binary byte checks, native/ACP desktop/mobile table paths, Markdown links/code spans, no scope leak outside table, ambiguous/missing/detached introductions and all previous file-link regressions. No writes or compact terminal traffic. Log .local/cc112-file-links-tests.log.
- `git diff --check` passed. No Rust/API changes; Rust checks not rerun.

No agent input, restart, commit/push or deployment. Live CC still has the old renderer until a frontend release; pending CC-112 video generation was not touched.
