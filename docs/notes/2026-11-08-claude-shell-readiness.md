# Claude shell foreground readiness

A process-linked Claude card became Unknown on native registry shell state. Native implementation derives shell from idle foreground with background shell work; map it to Ready, retaining separate background observations, unknown states, identity/time validation and newer root-turn precedence. Terminal text corroborated the diagnosis but is not readiness authority.

62 Python checks, 44 Rust library tests, formatting/Clippy/release pass. Backend deployed with current args/environment/config and local panes preserved. The original remote agent/conversation remains linked and is now Working on a new turn. A pre-existing human-queued intent became Seen through the existing guarded worker; no manual sends, replay, approvals or native restart. Four access paths healthy. Initial expected-Ready live check correctly stopped when fresh foreground activity superseded registry readiness.

See [Task 0033](../tasks/done/0033-claude-shell-background-ready-state.md) and [Bug 0019](../bugs/fixed/0019-claude-shell-registry-state-unknown.md). Prior uncommitted UI work preserved. Next task 0034, bug 0020.
