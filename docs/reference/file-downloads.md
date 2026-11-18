# Machine-qualified file downloads

In an agent conversation, right-click a file link (or use Shift+F10) and choose **Download file**. The `⋯` button offers the same actions on touch devices. This uses the agent's machine and observed connection revision, independently of the browser's machine, selected terminal or current Files workspace. It never performs an agent send or terminal attach/resize.

Markdown file links, conservative inline-code paths and plain absolute artifact paths are linked. Video/audio/archive extensions are supported alongside source, HTML and document files. Clicking a known binary/media chat link opens file actions instead of the text editor. Whole absolute code paths can contain spaces and literal `#`/`%`; relative paths resolve against the agent project. `~/` is passed to the selected machine for home expansion; other-user tilde expressions, URLs, Windows paths, fenced code and ordinary code expressions are not reinterpreted. External hyperlinks remain external.

Files also offers per-file context/`⋯` actions, including binary files that cannot open in the text editor. An open document has a **Download** link for the on-disk file; unsaved editor content is preserved and is not the downloaded file.

## Transport and API

GET `/api/v1/hosts/{host}/file/download?path=...&connection_revision=...` returns raw `application/octet-stream` with `Content-Disposition: attachment` and a UTF-8 filename. An optional `version` query checks the earlier `x-cc-file-version` fingerprint. Downloads use normal account read permissions and arbitrary browsing paths; pinned projects are shortcuts, not access fences.

The backend opens one regular file through the shared local/SSH/ProxyJump transport, reusing strict host-key checks, SSH configuration/agent and multiplexing. Paths travel as bounded JSON on stdin, never shell interpolation. No SCP, remote daemon, temp copy or persistent artifact cache is required. Files stream through bounded buffers to the browser's native downloader, so the editor's1 MiB UTF-8 limit and browser Blob memory do not apply.

Limits:8 GiB/file, two simultaneous downloads separate from editor slots,64 KiB chunks,30-second read idle timeout and15-minute transfer deadline (plus bounded connection/completion checks). No Range/resume or automatic retries. Browser cancellation drops its owned producer/channel. Endpoint revisions are checked before headers and each chunk. Fingerprints detect replacement/size/time changes; the final chunk is held until regular-file and transport completion checks pass. This is a guarded streaming read, not an immutable snapshot or filesystem lock; avoid downloading files actively being rewritten.

Responses are no-store, nosniff and sandboxed; HTML is always an attachment at this endpoint. Existing [CC-89 HTML preview](../tasks/done/0117-sandboxed-html-file-preview.md) remains a separate static sandboxed Source/Preview view in Files. Relative asset loading, inline video playback, directory archives and uploading are outside this change.

## Conversation references and ACP

Native and ACP chats both carry the originating machine/revision for downloads. A relative path may reuse an unambiguous explicit full path already named in the same loaded conversation (for example, a worktree report while the broker project is its parent repository). Ambiguous matches retain ordinary project resolution; no filesystem or cross-machine search is performed. An explicit “`name` in the same folder/directory” statement can bind a bare sibling filename to the one directory named in that message. Home-relative paths stay machine-relative until the backend expands them. The menu/tooltip exposes the resolved machine/path. File-location hints are data, never permission to send prompts or change agent state.
