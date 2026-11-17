# ACP busy-time queue ready

Task0096 adds explicit broker-owned FIFO follow-ups while Working/Approval:16 ×12000-byte unsent intents,24h expiry, exact instance/session, durable UUID receipts and no uncertain replay. Pending text is private/temporary and deleted on claim/cancel/expiry; snapshots stay bounded. One bubble transitions queued→submitted→completed, supports cancel-before-dispatch; broker Close cancels queued intents. Lost ack/reload/backend restart preserve identity. Older brokers lack capability and are not auto-restarted.

41 ACP Python,11 mode-helper,92 Rust,6 API contract and28 browser regressions passed, plus2 strengthened backend-restart queue checks against final release. Frontend/release builds, Clippy/format/diff passed. No deploy/commit/push or live-agent action; existing brokers require separately approved replacement/resume after deployment. Real provider/SSH coverage not claimed. See task0096 for evidence/limits.
