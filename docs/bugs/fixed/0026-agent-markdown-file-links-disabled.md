# Bug 0026: Assistant file links lose their destination

State: fixed

Native assistant Markdown contains a file report link, but chat strips non-web hrefs because no machine-qualified Files handoff exists. Add explicit file buttons bound to originating host/revision and project cwd, preserving safe external links and preventing direct browser/CC API navigation. Task 0045.

Fixed in [task 0045](../../tasks/done/0045-agent-chat-file-links.md) with explicit machine/revision-bound Files buttons and shared draft preservation. Seven focused browser tests pass; live reported link opens its exact remote Markdown report in compact Files Preview without terminal traffic. Frontend-only deployment.
