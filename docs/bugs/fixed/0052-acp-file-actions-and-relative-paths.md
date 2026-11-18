# Bug0052: ACP file links omit download context and lose explicit artifact locations

Confirmed2026-11-18 from CC-75 metadata and recent message references. AcpChat calls chatMarkdown without its machine/revision download context, so recognized paths lack CC menus. Native-only regression coverage missed this call site. Latest relative artifact paths are resolved against broker project even when earlier messages identify the actual worktree; home-relative video paths are not linked. Canonical artifacts remain on disk. Fix tracked in task0125; do not change conversation/agent cwd or relocate files as a workaround.

Fixed in task0125: ACP receives explicit download scope; contextual home/worktree/sibling paths resolve conservatively, and media clicks open actions.30 browser regressions and a read-only live CC-75 menu/HTML preview check passed. Frontend-only correction deployed without backend/agent restart; source pending commit.
