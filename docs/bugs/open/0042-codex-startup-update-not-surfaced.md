# Bug0042: Codex startup update picker appears as Unknown

State: open; found2026-11-16 through task0085.

A human-launched Codex can stop at its native Update available picker before a conversation exists. The pane offers Update now (a package install), Skip, and Skip until next version. CC shows Unknown/no linked conversation without identifying that startup interaction. This looks like a launch failure even though the exact foreground process remains alive.

Future work should expose verified startup/onboarding evidence without inventing a conversation. Any response needs explicit human intent and exact process/screen/endpoint guards. Do not auto-update packages, choose an update option, or globally alter provider configuration merely to make startup unattended. No implementation yet.
