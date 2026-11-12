# CC-46 remaining-feature audit

Audit against dcd0b20 and original human brief, before remaining canvas implementation.

| Capability | Shipped state | Proposed order |
| --- | --- | --- |
| Multi-select | Shift-click, Shift-marquee and select-all implemented | Preserve and regression-check |
| Duplicate | Button and keyboard implemented | Preserve |
| Sticky notes | Filled labelled rectangles implemented | Preserve |
| Ticket link UI | Link ticket accepts CC-number/UUID; rename preserves link | Preserve |
| Mobile | Touch drawing/pan/pinch covered in Chromium; actual iPhone untested | Keep coverage; real-device check remains |
| Attribution | Creator/last editor in API, selection details and tooltip; no visual author style | Add visual option after transfers design |
| Groups/frames | Missing | Minimal API named scopes for export first; GUI grouping/framing later |
| Align/lock | Missing | After group/frame GUI |
| Image paste/drop | CC-55 item 4 deployed in task 0059: scoped raster blobs, paste/drop, resize/sync/history/export | Validated/deployed; other CC-55 items remain backlog |
| Excalidraw import | Missing | After image support; bounded semantic conversion with warnings |
| Mermaid import | Missing, optional | Last; existing semantic graph API handles simple flows |
| Server image export | Missing; only browser images and REST JSON/text | First implementation task 0052 |
| Remote attachments | Missing; outbox is text-only | Design and human approval before code |
| Harness delivery verification | Not performed | Only after approved attachment implementation and explicit outward test authorization |

Initial plan: implement server export and a read-only download helper; document attachment transport/API/receipt/checksum/expiry contract for human approval; then build guarded transfers and run authorized harness checks; finally fill GUI features in the order above. Do not count existing sticky/ticket/touch tools as missing work, or claim that text messages carry files. No agent messages, remote file writes, live drawing mutations or deployment are part of the export development step.

2026-11-12 scope update: only CC-55 item 4 was implemented and deployed. Frames/groups UI, align/lock, visual attribution, Excalidraw/Mermaid import and real Claude/pi image checks remain outside this task. See [task 0059](../tasks/done/0059-whiteboard-images.md).

2026-11-12 colors follow-up: task0064 adds red/orange/green/teal/purple/gray alongside the original five, plus optional soft/none shape fills, deployed after approval. Other CC-55 items remain unchanged. See [task0064](../tasks/done/0064-whiteboard-palette-fills.md).
