# Bug0047: Recovered switch receipt still blocks a new review

Reported2026-11-17 after the coordinator's explicit native recovery. Old checking receipt correctly remains an uncertainty barrier, but there is no supported resolution action; browser dismissal only deletes its local reference. Add distinct recovered state and metadata-only guarded resolution after exact process/conversation/endpoint/target verification and old broker/adapter exit. Preserve original receipt, never call the old switch again, keep outbox barriers and require fresh separate switch review. Read-only discovery supports cleared browser storage; UI resolution remains accessible when old broker status fails. See task0095 for tests and deployment evidence.

Deployed2026-11-17 13:34:56 UTC. Guarded API resolved the reported coordinator receipt; original audit retained and fresh review prepared without a switch.26 browser/92 Rust/10 helper/6 OpenAPI checks passed.
