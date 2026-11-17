# Bug0046: Claude session/load aborts on historical images

Reported2026-11-17 after coordinator native→ACP conversion. Original conversation is intact, replacement broker remains failed with generic ACP stream error, switch receipt checking. Bounded read-only transcript metadata confirms multiple records above1MiB; replay stopped at a historical image-read tool. Original adapter reader bound1MiB cannot accept legitimate image frames. Source fix raises only adapter frame bound to8MiB, still discards images, keeps1MiB client snapshot limit and adds specific oversize error. Fixture replay/oversize tests added. Existing failed broker must not be retried/replaced without explicit human recovery request. See task0094.

Fixed source deployed2026-11-17 13:21:32 UTC after human-approved exact native recovery. Coordinator verified native/Ready; no real ACP retry, automatic fallback or receipt rewriting. New brokers use8MiB bound; running brokers remain unchanged.
