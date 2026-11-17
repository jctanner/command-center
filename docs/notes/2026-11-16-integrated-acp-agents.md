# Integrated ACP agent cards and chat

Task0082 is implemented and verified, not deployed. ACP now joins the regular agent cards and conversation panel; the native launcher remains default and explicit ACP selection starts through internal one-use preparation. Shared metadata/read attention coexist with protocol-specific permission and receipt controls. Explicit reviewed close targets the exact broker via pidfd; restart/resume and busy-time queue remain unsupported.

Validation: frontend build, 90 Rust library tests, 13 Python broker/helper tests, Clippy all-targets with warnings denied and 12 focused browser regressions passed. The optimized release build additionally passed all four ACP browser tests and all six OpenAPI checks. Desktop/mobile, delayed project loading, lost launch response/reload recovery, metadata, permissions, close review and native default behavior are covered. One existing remote broker was inspected read-only for compatibility; no real-provider input or new launch occurred.

No deployment, commit or push in this task. Ask the human before restarting the backend; preserve listener flags and tmux processes. Existing brokers need no restart. Prior uncommitted ACP prototype/layout work remains intact.

## Deployment follow-up

Human subsequently approved deployment. One backend restart completed; all four access paths, SSE, frontend/binary hashes and integrated contracts verified. Configuration, runtime listener arguments and tmux pane PIDs unchanged. Read-only live desktop/mobile checks each found 12 cards and opened existing ACP chat, with zero browser errors, terminal sockets or API writes. No agents restarted or messages sent. Reload existing clients once to load the new interface. No commit/push.
