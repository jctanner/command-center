# Task 0045: Machine-qualified agent chat file links

Owner: CC dev
Claimed: 2026-11-10
State: done

Route assistant Markdown file links through Files on the originating machine using revision-checked context. Preserve safe external links, drafts and independent workspace selection. No file loads until explicit click; no direct browser filesystem/CC endpoint navigation or compact terminal traffic.

## Findings and implementation

Native assistant history already contained the report Markdown link. Chat deliberately stripped non-web hrefs because it had no machine-qualified file handoff, leaving the label as plain text.

Assistant file destinations now become explicit Files buttons with visible original labels and machine/path titles. Resolve absolute POSIX paths on the originating machine and relative paths from its project cwd; decode once and normalize dot segments. Reject unsupported schemes, network/UNC destinations, controls, malformed encodings, backslashes, home expansion and fragment-only routes. External HTTP/HTTPS/mail links retain safe external behavior. No file fetch occurs during rendering.

Bind each click to its captured host/connection. Open the independent Files workspace and revalidate after lazy import/browsing; existing documents and unsaved drafts share the current bank. Markdown opens in Preview with TOC. Reject stale file response identity and stale canonical drafts rather than rebinding them. Preserve terminal selection and compact isolation. File line/section anchors open the document but do not scroll to the fragment.

## Validation and deployment

- Four new Playwright cases pass: desktop/phone remote absolute+relative file opening, no eager file reads, literal unsafe destinations/external link preservation, agent/editor drafts and single-tab reuse, unchanged terminal host selection, zero writes/compact terminal traffic, stale agent endpoint rejection and stale response rejection.
- Final seven-case browser run passes in 7.7s, including existing real local/SSH draft/conflict tests, Markdown source/preview/TOC and chat sanitizer/phone layout. Initial fixture lacked host-event mocking; corrected the fixture to keep discovery/SSE identities consistent and distinguish revision-only checks from file content reads.
- Frontend TypeScript/Vite staging build and git diff --check pass (existing bundling warnings). No backend changes, Rust tests or backend rebuild needed for this slice.
- Frontend deployed with prior assets retained and atomic index replacement. Live compact browser clicked the actual report link and verified the originating machine, exact document path and rendered Markdown content. Zero terminal sockets or agent message/approval/launch actions. No backend/native restart, file writes or Board mutation. Private screenshot/evidence under ignored .local/reviews. Reload open clients for the new renderer.

Next task 0046; next bug 0027.
