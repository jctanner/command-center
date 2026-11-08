---
name: cc-overlap-review
description: Compare CC agents' existing goals and relevant files to identify possible duplicate work or conflicting edits.
---

Start with `cc-inventory`. Compare recent user requests and assistant plans across relevant agents, then inspect the smallest useful set of machine-qualified files. Same folder or similar title alone is not a conflict. Distinguish duplicate goals, incompatible proposed edits, shared dependencies and harmless parallel work.

For each finding give confidence (possible or supported), exact agent/process/conversation references, machine-qualified file paths and versions, short message IDs/timestamps, why the work intersects, and missing evidence. Do not infer actual edits from plans or equate present file contents with an unobserved Git diff. History may be stale, truncated or unverified; say so.

Recommend a specific ownership boundary or additional read that would resolve uncertainty. Produce human-reviewable findings without messaging, stopping, merging or editing anything. Use `cc-coordinate` only to draft a handoff after the overlap is understood.
