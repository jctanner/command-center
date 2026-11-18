# File previews

Files offers Source / Preview for Markdown and HTML (`.html` / `.htm`, case-insensitive). Preview uses the current editor draft; changing view does not save or rewrite source. Existing machine/connection, revision, external-change and unsaved-draft guards remain in effect. A chat file link opens a supported document in Preview on the originating agent's machine. The Browser button can hide navigation to give the preview more room on a phone.

## Static HTML

HTML preview is a separate sandboxed iframe with an opaque origin, never inline CC content. V1 deliberately disables scripts: script-driven charts, canvas drawing and application demos may be incomplete. There is no Run scripts option. Inline CSS and embedded PNG/JPEG/GIF/WebP data images are supported. Remote and sibling stylesheets, images, scripts and fonts are not loaded. The preview shares Files' 1 MiB limit, including unsaved drafts.

DOMPurify sanitizes a disconnected document before serialization. Scripts, event handlers, forms, nested frames/objects, meta/base/link elements and navigation attributes are removed. The iframe has an empty sandbox and no same-origin, script, form, popup, download or navigation grants. A CC-owned CSP is inserted before the document: default/script/connect/font/media/frame/object sources are denied, inline styles and data images are the only resource exceptions, and base-uri/form-action are denied. Source-supplied CSP/base/refresh elements cannot replace this policy. The frame sends no referrer. Navigation-bearing attributes are removed rather than relying on browser support for a CSP navigation directive. Leaving Preview removes its frame.

Source remains literal and unsanitized for editing/saving; sanitization affects only the preview. This feature adds no server asset route, upload, remote installation or arbitrary URL fetch. Sibling assets and script execution need a separately designed boundary.

## Chat paths

Markdown file links continue to use existing machine-qualified navigation. A whole inline-code token with a recognized file extension can also become a file button: absolute or project-relative, with conservative ASCII path characters and no whitespace. Examples: `/home/user/reports/demo.html`, `reports/demo.htm`, `./notes.md`. Existing normalization and URL/control/backslash rejection apply. Code blocks, expressions, URLs, `~` paths and Windows paths are not rewritten. Merely rendering a file button never reads the file; clicking uses the existing current machine/process connection guards. Paths containing spaces or unusual characters should use an explicit Markdown link.
