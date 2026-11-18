# Task0114: Quiet ACP submitted receipts

Owner CC dev; claimed2026-11-17. Remove routine submitted delivery labels from ACP chat bubbles and composer feedback; retain queued, uncertain and failure feedback and full receipts in Details. Frontend-only; no deployment requested.

Done: routine submitted/completed message labels and success receipt feedback are suppressed. Queued spinners/cancel actions and unsuccessful or uncertain delivery feedback remain; detailed receipt records are unchanged. TypeScript/Vite build passed (existing chunk advisory), whitespace check passed. Two focused Playwright busy-queue/reload/cancellation cases passed for Claude and Codex, including an assertion that a submitted working prompt has no delivery footer. Logs `.local/quiet-acp-{build,tests}.log`. Not deployed or committed.
