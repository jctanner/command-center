# Bug 0011: Background host errors leak across workspaces

Inventory polling wrote every failure into the global notice and wrote Host unavailable when no terminal existed, even in Agents/Files/Settings. Successful inventory reads did not clear that error or reset the status unless a terminal was attached. This leaves stale timeout banners and attributes one offline host to the whole application. Fix in Task 0017; preserve explicit action failure warnings.

Fixed by Task 0017. Offline/recovery, late response and stream/action-warning regressions pass; deployed and endpoint health verified.
