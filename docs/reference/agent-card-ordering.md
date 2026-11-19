# Pinned agent card ordering

Pinned cards use shared **manual order by default**. Activity, approvals and unread replies update their indicators without moving those cards. Unpinned cards retain activity sorting below them. Existing pins start in saved card creation order; newly pinned cards append. Explicit restart/connection-mode metadata transfer retains the pin position.

Drag a pinned card on desktop or use its visible grip on touch screens. Ordinary card scrolling/selection remains available outside the grip. Focus a card and use **Alt+Up/Down**, or use its right-click/Shift+F10 menu’s **Move pinned card up/down**. These moves act on visible pinned neighbors; filters never remove hidden cards from the saved order. Sorting is saved centrally across browsers and backend restarts, independently of agent input or state.

**Settings → Agents → Pinned agent card order** offers **Manual** and **Automatic — sort by activity**. Save explicitly. Automatic mode hides/disables reorder controls, retains the saved manual order and affects pinned cards only. Returning to Manual restores positions.

GET/PUT `/api/v1/settings/agents` exposes revision, pinned_sort (manual/activity), and an opaque order-key array. PUT requires the exact revision; omitted fields stay unchanged. An order change must preserve every existing order member exactly once, including hidden/historical cards. New pins discovered between reads reject incomplete writes.409 conflicts require refresh and a fresh user action; the UI never retries the move automatically. Card order_key is presentation metadata, not an agent-control capability. Queue snapshots hydrate current layout metadata independently of cached host inventory; null layout means storage unavailable.

The SQLite board sidecar stores only ordering/preferences and existing card metadata. No transcript copies or remote commands are used. Browser/device refresh preserves order; closing or replacing agents does not retarget messages. Absent historical keys may remain in metadata within the existing4096-card bound.
