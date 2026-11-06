# Task 0021: Public README setup and security

Owner: CC dev
Claimed: 2026-11-06
State: done
Completed: 2026-11-06

User requested the remaining README release fixes: explicit no-login/account-control trust boundary, accurate Rust/Node prerequisites and Linux support, Settings navigation and optional integration setup expectations. Keep the SSH clone URL, concise entry-point scope and privacy cleanup. Documentation only; do not publish, deploy or change runtime configuration. Resolve setup bug 0013 with honest validation limits.

## Change and validation

README now identifies the early-preview/Linux backend scope, prominently explains no application login and full account-level file/terminal/SSH control, distinguishes Host/Origin and TLS from authentication, covers shared-machine loopback and unencrypted LAN risks, and protects all enabled listeners behind the chosen trusted boundary. Added current stable Rust with the locked Rust 1.89 dependency floor, Node 22.12+/npm, Python/tmux/OpenSSH requirements, actual verified versions and the untested-minimum caveat. Corrected Settings > Machines and default-off integration/source prerequisites. SSH clone URL and Apache link retained.

Validated every local README link/anchor, installed Rust 1.99.1/Node 22.23.1, locked Vite engine metadata, navigation/security wording and git diff --check. Previous isolated clean builds/startup remain the runtime evidence; no code changed and no new runtime tests or deployment needed. Fixed bug 0013. The owner subsequently requested commit/push of these documentation changes; repository visibility is unchanged. Task 0009 remains pending.
