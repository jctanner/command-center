# Task0166: Coordinator skills for upstream tickets

Claimed2026-11-19 by CC-dev. Update ticket CRUD and coordination/launch guidance for new upstream references; distinguish contract availability, preservation and external tracker permissions. Use skill-creator guidance for focused edits.

## Completed2026-11-19

Updated cc-tickets with upstream schema/example/limits, optional key-only refs, exact revision merge/preservation, explicit clear and served-contract compatibility. No guessed Jira URLs or implied external writes. cc-coordinate and cc-launch include supplied upstream keys/links in ticket handoff prompts and distinguish CC IDs. Existing cc_board helper passes JSON unchanged and needs no change.

Validation: skill-creator quick_validate.py passed for cc-tickets,cc-coordinate,cc-launch; git diff --check passed. Documentation-only; no coordinator message, restart, live write, commit or deployment. Feature task0165 still undeployed, so skills instruct checking the served schema before sending upstream.
