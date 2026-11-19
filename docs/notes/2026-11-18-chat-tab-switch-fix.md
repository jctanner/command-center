# Cross-provider chat tab ownership

Task[0143](../tasks/done/0143-chat-tab-protocol-switch.md) fixes bug0056: ACP/native cards individually worked, but ACP→native selection restored nativeNodes after an early dock and the identity-only fast path missed the changed parent. Docking now follows restoration and checks actual parent.26 browser cases pass, including same-page Codex/ACP/pi selection and resize/poll/draft persistence. No live agents changed; source uncommitted/undeployed.
