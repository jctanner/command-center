# Bug 0023: Pi bang input leaves a chat receipt Submitted

State: fixed

A chat message beginning with ! is interpreted by pi as native shell input. The provider records bashExecution rather than a user message, so the receipt waits forever for chat Seen. Classify exact same-log/post-baseline active-branch command evidence separately, never as chat Seen or permission to resend. Reject future leading-bang chat before input IO with a clear rephrase instruction. Task 0042.

Fixed/deployed: exact native shell evidence settles as command, never chat Seen; future bang chat is rejected before input IO with a draft-preserving rephrase hint. Rust persisted one-use and Python branch/guard tests plus browser status/zero-send coverage pass. Original affected receipt classified without replay. Task [0042](../../tasks/done/0042-pi-command-input-receipts.md) is complete: the human approved a separate FYI:-prefixed correction, sent once and confirmed Seen while the original command receipt remained unchanged.
