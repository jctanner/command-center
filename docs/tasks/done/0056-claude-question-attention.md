# Task 0056: Surface Claude clarification questions in Agents

Owner: CC dev
Claimed: 2026-11-11
State: done (implemented/tested and deployed after explicit human approval)

Investigate coordinator terminal waiting dialog omitted from Agents. Recognize supported native Claude question layouts as terminal-only input requests, separate from tool permissions. Show attention, question/context and honest input labels without issuing approval capabilities or guessing native selection keystrokes. Preserve ordinary-message blocking and process identity guards. Add provider/native/Rust/frontend regression coverage and document actual deployment status. Never answer the live prompt, launch its suggested agents or approve tools.

## Findings and implementation

The live coordinator shows a native AskUserQuestion menu and process-verified registry waiting. Tool-menu grammar correctly rejects non-permission choices; registry waiting and clarification fallback were missing. Captured evidence stays in ignored .local/reviews/coordinator-approval/. No input, approval or agent launch was sent.

Added bounded read-only input_question detection: verified foreground identity, no copy mode, question heading/contiguous options/single selection/type-your-own entry/current footer. API returns optional input_request id/title/context, never keys or approval capabilities. Inferred terminal_question and verified registry claude_input use the existing approval attention enum, with distinct Awaiting input/Input (detected) labels and New input request notifications. Panel shows literal question/context and asks the user to answer in tmux. Sends are blocked; drafts survive question appearance/removal. Existing tool permission grammar/transports are unchanged. OpenAPI and feature docs updated.

## Actual validation

Saved live observation replay now recognizes the question and terminal_question attention while approval_menu remains absent; replay sends no IO. Four new Python question tests pass (context/identity, stale/invalid cases, detail capabilities, old send/approval grants rejected with zero tmux IO). All 34 history/status/approval tests, seven busy-input tests and 62 Rust tests pass. Clippy, fmt, release build, frontend type/build, contract/schema and diff checks pass. Existing fixture database resource warnings/Vite advisories remain unrelated.

Three new browser tests pass: desktop/mobile attention/read-only card/draft recovery/literal rendering/no forbidden writes or terminal sockets, plus isolated native tmux/API integration using disposable cat-as-Claude (not a real provider). Existing phone/SSH tool-approval/stale-target/cross-client duplicate-decision regression passes. Phone screenshot visually inspected.

## Deployment handoff

Source/release/web/dist-next are staged, NOT deployed. Prepared /tmp/cc-deploy-question-attention.py is syntax-checked, not executed. It preserves argv/env/listeners, backs up stopped DB/old executable/web and checks health/schema/config/native pane/PIDs. Ask before this brief restart; the previous Whiteboard deployment approval was completed. After approval, read the original coordinator target if still pending; never answer or recreate the question to test. No live message, launch, commit or push authorized/performed.

## Approved deployment

The human approved the requested restart on 2026-11-11. Prepared deployment executed successfully: four healthy access paths, exact config hashes/listeners preserved and canonical local tmux pane/PID inventory unchanged. Served schema includes input_request. Live coordinator detail now reports terminal_question attention, question present, no tool approval, no message token and send_available false. Its prompt remained unanswered.

Live desktop/phone Chromium check confirms Input required card visible, zero actionable choice buttons/tool-approval cards/page errors/terminal sockets. All browser writes were blocked for inspection (one ordinary attention/read acknowledgement was blocked); no input or approvals sent. Private evidence under .local/reviews/coordinator-approval/deployed*. Runtime backup/log details remain ignored. No agent launches/restarts, commit or push.
