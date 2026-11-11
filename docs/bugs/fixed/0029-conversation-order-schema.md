# Bug 0029: Conversation order schema rejects native plain text

Observed/fixed in source: 2026-11-11, task 0057

Full conversation contract validation during native question-response tests rejected messages with order -1. Existing message_order deliberately returns -1 for unsplit/plain-text content, but OpenAPI required minimum 0. Updated the contract minimum to -1 and documented the sentinel; native logs, ordering and UI behavior remain unchanged. Validation uses the full synthetic native conversation in tests/test_question_api.py.
