# Agent report file links

Task [0045](../tasks/done/0045-agent-chat-file-links.md) fixes bug [0026](../bugs/fixed/0026-agent-markdown-file-links-disabled.md): native report links were present but their file destinations were stripped. Explicit assistant file buttons now open independent Files on the originating host/revision, resolve relative project paths, preserve drafts and preview Markdown. Unsafe destinations remain non-navigable and no file reads occur before click.

Frontend build and seven final local/SSH/phone/security/draft browser cases pass. Frontend deployed; live compact inspection opens the exact reported remote file in Preview with zero terminal sockets or agent input. No backend/native restart or file writes. Screenshot remains private. Next task 0046; bug 0027.
