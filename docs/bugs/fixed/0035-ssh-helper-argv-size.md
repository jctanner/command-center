# Bug 0035: SSH helper source exceeds per-argument limit

Found during task0070's pre-deployment regression run. Agent helper source grew to about124k bytes; shell quoting expanded the SSH command above Linux's roughly128k per-argument limit. Remote fixture agent preparation failed with host-helper startup errors while local requests worked. Not deployed.

Fix: a constant small Python bootstrap receives trusted helper source plus the request over the existing stdin/SSH channel, bounded to16MiB, then restores payload stdin for existing helper readers. Source is supplied only by compiled backend code, never a client field. No remote files, daemon, new connection, weakened SSH verification or generic RPC capability. Existing output/time bounds remain. Full local/SSH launch and filesystem regressions verify compatibility; task0070 records evidence.
