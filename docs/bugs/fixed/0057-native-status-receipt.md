# Bug0057: Native /status waits forever for a chat receipt

Reported2026-11-18. Successful terminal submission was always left submitted awaiting native user-message matching, but Codex/Claude /status is terminal-local and may never enter the conversation. Task0153 adds cli_submitted with an honest transport-only label, narrow provider/command recognition, and recovery of old submitted receipts. Uncertain records are not upgraded. No model-read or execution claim; no retry.
