# Lighter Board cards

Lifted theme-derived card fill and secondary labels for easier scanning. Dark/light contrast checks pass; default dark screenshot reviewed. Review also exposed late machine-name discovery leaving IDs visible: visible Board/List now rerenders on host updates without changing drafts or data.

Frontend build, whitespace checks and two focused browser tests pass (3.1s). Deployed frontend atomically; stage index/live card color/aliases verified with no ticket mutations or backend restart. See [Task 0032](../tasks/done/0032-lighter-board-cards.md) and [Bug 0018](../bugs/fixed/0018-board-machine-labels-stale-after-host-discovery.md). Changes and preceding Board/List work uncommitted. Next task 0033, bug 0019.
