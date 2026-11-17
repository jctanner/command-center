# Bug0043: Fresh Codex first message cannot bootstrap history in CC

State: fixed in code, not deployed; found2026-11-16, task0086.

After Codex's updater is skipped, a fresh native process can own a thread-writer file before its conversation appears in the saved log/database. CC sees older project histories and no process-linked log, and durable sending waits for provider turn-state evidence that cannot exist until the first message. Human reproduced normal CC association after sending the first message in tmux. Selecting an older project history does not select the live process's thread and can make the interface look like another agent's conversation.

The original read-only capture saw a distinct open writer file; the process exited before its kernel ownership could be checked. Subsequent metadata-only lookup found that exact thread's persisted rollout. Fix must validate actual kernel ownership/start identity using fixtures and not claim that the original open-file observation alone proved ownership. Never infer the newest project transcript as active or copy unrelated history into a fresh session.

Task0086 implements exact pending UUID and first-input grants with same-session receipt confirmation. Desktop/mobile and native outbox regressions pass; no synthetic bootstrapping prompt or inferred Ready. See the task for limits and deployment status.
