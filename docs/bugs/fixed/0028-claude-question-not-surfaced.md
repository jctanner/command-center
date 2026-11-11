# Bug 0028: Claude clarification question is invisible in Agents

Observed: 2026-11-11
State: fixed (tested and deployed 2026-11-11)
Related: task 0056

A process-verified Claude pane displays the native AskUserQuestion menu, but Agents reports Unknown and no attention. Tool-approval parsing intentionally rejects arbitrary choices; fallback terminal prompt detection only recognizes permission wording. Native registry status waiting is also missing from the supported mapping. The question has numbered choices, one selected marker, a question heading and Enter/select/navigation/Escape footer.

Fix must preserve the distinction between a clarification and permission to run tools. Read-only question/context and attention may be shown; no approval tokens or guessed native response transport. Sanitize reproductions and keep live terminal evidence in ignored .local/reviews/.

Task 0056 is implemented/tested and deployed after the human approved the restart. Live coordinator now exposes terminal_question attention and a read-only question card, no tool approval/message capability. Its prompt was not answered.
