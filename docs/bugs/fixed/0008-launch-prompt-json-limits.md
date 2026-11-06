# Bug 0008: Launch JSON limits are smaller than supported prompt payloads

Found: 2026-11-05
State: fixed
Fixed: 2026-11-05

Launch defaults to a 16 KiB HTTP body limit despite supporting a 24,000-byte initial prompt. JSON escaping can exceed the helper's 32 KiB input reader too. Existing ticket prompt handoff uses that same helper. Set bounded 160 KiB JSON envelopes on the launch route/helper, retaining the independent 24,000-byte prompt limit and smaller defaults for other routes. Verify a full-size quote-heavy prompt reaches the fixture literally.

[Task 0012](../../tasks/done/0012-launch-initial-prompt.md)

The full-size case also hit tmux's argv command-size boundary. Bounded JSON envelopes plus a private one-shot argv handoff for large commands now preserve exact 24,000-byte quoted prompts. The handoff is checked for ownership/permissions/size and deleted before exec. Final provider/SSH/ticket/phone/recovery regressions pass and the fix is deployed.
