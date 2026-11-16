# Settings token usage

Task [0076](../tasks/done/0076-settings-token-usage.md) removes cumulative tokens from cards and adds Settings → Token usage grouped by machine, with per-conversation input/output/cache totals. Deduplicates same-machine conversations and excludes stale/unverified usage; current inventory only, not durable lifetime accounting. Uses existing queue API, no backend/schema change. Staged build and ten Playwright checks pass, mobile screenshot inspected. Not committed, pushed or deployed; staged assets in web/dist-next.
