# OpenAPI and ticket CRUD

Published docs/openapi.json at GET /api/v1/openapi.json. Initial scope: coordinator reads and complete Board routes. Added revision-checked logical ticket deletion retaining UUIDs/numbers/private contents/history and rejecting unreleased launches. Coordinator gains cc-tickets skill, CRUD helper and agent ticket API guide. No automatic agent launches or mutations inferred from inventory.

44 Rust library tests, Clippy/formatting, standard OpenAPI validation, five isolated release HTTP/CRUD/schema tests and thirteen coordinator tests pass. Backend deployed preserving all listeners/HTTPS; served contract verified and live ticket rows match pre-restart private backup. Only normal attention/approval metadata updated. No live ticket mutations or agent inputs/launches were tested.

See [Task 0027](../tasks/done/0027-openapi-and-ticket-crud.md) and [agent ticket guide](../reference/agent-ticket-api.md). Changes and prior coordinator scaffold remain uncommitted. Task 0009 remains untouched. Next task 0028, bug 0016.
