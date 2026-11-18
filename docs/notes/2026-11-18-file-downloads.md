# Machine-qualified file downloads

Task[0123](../tasks/done/0123-machine-qualified-file-downloads.md) adds chat/Files context downloads across local/SSH/ProxyJump, including video artifacts beyond the editor limit. Right-click, Shift+F10 and touch ⋯ preserve the originating machine/path and chat drafts. Binary bytes stream through bounded transport buffers to browser downloads;8 GiB/two concurrent/change/cancellation guards, no Blob or temp copy. CC-89 HTML preview already shipped and remains isolated.

Validation:98 Rust,5 helper,6 API and19 browser tests pass; build/typecheck/format/Clippy pass. Includes actual fixture SSH, binary >2 MiB, UTF-8 filenames, endpoint abort/capacity cleanup, HTML isolation and compact terminal independence. No real production file reads/transfers, deployments, commits or agent mutations. Source ready for requested release; iPhone Safari hardware remains unverified.

Subsequent human commit/push/deploy request completed in task[0124](../tasks/done/0124-release-file-downloads.md), feature7fe34a4. Four access paths return exact disposable binary fixture bytes/headers; local/remote tmux process identities and listeners/config/environment retained. No personal artifacts or agents touched.
