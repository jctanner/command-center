---
name: cc-inventory
description: Passively inventory Command Center agents, machine-qualified projects and current work from existing history and files.
---

Read the coordinator role instructions. From the coordinator directory, use `python3 tools/cc_read.py hosts` and `agents`. Retain checked-at time, host errors and scan-limit flags. Do not ping agents or attach terminal viewers.

For relevant machines read `inventory` and `projects`. For each relevant agent read `history --machine ID --agent ID`; keep process association separate from selected project history. If several candidates are unlinked, report ambiguity or inspect an explicitly chosen candidate without claiming it belongs to the live agent. Carry returned history versions/branches when paging. A history reset invalidates the previous page sequence.

Read only files necessary to substantiate the current user goal and recent assistant plan using `list` and `file`. Record canonical machine/path/version and truncation. Do not infer a diff or file ownership from current contents alone.

Report a compact table: agent/card, machine and tmux target, current goal, observed activity with source/time, project, conversation association and evidence references. Separate unavailable, incomplete and uncertain entries. End with concrete questions or candidate overlap investigations, not automatic actions. Do not save raw conversation contents.
