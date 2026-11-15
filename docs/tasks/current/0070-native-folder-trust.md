# Task 0070: Native folder trust in CC (CC-72)

Owner: CC dev
Claimed: 2026-11-14
State: current

Human reprioritized ahead of CC-2/3 and CC-55; token metrics checkpoint f4645c4. Detect and surface native Claude/Codex folder-trust prompts, with an explicit human-only guarded action and audit. Inspect the human-identified CC-63 and CC-70 panes read-only (exact runtime targets remain private); never answer those live prompts. Report detection/guard/API design before implementing the answer action. Ask before any disposable harness launch or disruptive deployment. Unit/synthetic browser tests require no live harness starts. Local commit requested when done; no push. Optional pre-trust only if supported and justified, default off; avoid weakening normal trust/approval safeguards.

## Design reported before answer-action implementation

Known Claude Accessing workspace/Quick safety check and legacy/current Codex folder-access pickers. Require a complete live visible disclosure/choices/footer, foreground/start identity, matching CC launch marker, canonical folder/root identity, and no already-linked conversation. No missing-history heuristic or arbitrary onboarding response. Recognized cases expose awaiting_trust; unknown/wrapped/truncated layouts and authentication stay terminal-only. Optional pretrust deliberately omitted.

Human action uses a separate 120-second one-use capability and durable metadata-only receipt/claim, serialized with endpoint edits. A launch/process has one shared claim across disclosure revisions, so changed text cannot bypass uncertain/submitted decisions. Revalidate exact launch/process/folder/disclosure before bounded picker navigation and final Enter. Decline sends no keys and remains blocked; fresh explicit review can reverse a declined/proven-not-sent decision. Interrupted/uncertain input never replays. Audit choice/scope/time and explicit-human provenance; CC's current access boundary does not authenticate named users. Coordinators are instructed to report trust, never call this action or edit trust files.

## Implemented

- Native parser/action plus Rust `folder_trust` API: POST hosts/{host}/agents/folder-trust and GET agents/folder-trust/{id}. Claims/receipts are in the existing private Board sidecar; backend restart marks submitting uncertain. HTTP disconnect cannot drop owned receipt handling.
- Queue/detail activity awaiting_trust, attention/notifications integration, launch_state on observations, and lightweight ticket run/live activity metadata. Persisted runs exclude native screen/capabilities. Ordinary chat/outbox cannot answer trust.
- Desktop/phone explicit trust/decline UI reuses safe question receipt presentation with isolated storage/routes. Full disclosure opens by default, folder/root scope is visible, duplicate sends/lost acknowledgements retain one UUID, transport failure disables cached actions. Fixed contradictory terminal-only/Unknown labels found in screenshot review.
- OpenAPI/API/launch playbook/cc-launch skill/AGENTS updated; pi unchanged.
- [Bug0034](../../bugs/fixed/0034-native-folder-trust-invisible.md) tracks the launch blocker. [Bug0035](../../bugs/fixed/0035-ssh-helper-argv-size.md): growth exceeded quoted SSH argv limits. Fixed with a small bounded stdin bootstrap for compiled trusted helper source plus request data, preserving the existing helper stdin contract. No remote file/daemon install, new ports or client-supplied executable source. A large-source/literal-data unit test and local/SSH filesystem/launch cases verify it.

## Actual validation

- `cargo fmt --check`, Clippy all targets with -D warnings, release backend build and `npm --prefix web run build -- --outDir dist-next`: passed.
- `cargo test --lib --quiet`: 83 passed (includes durable cross-client claim, replay/decline/restart/expiry/endpoint guards, persisted-run privacy and source/data bootstrap tests).
- Python suites: folder trust 6, outbox 7, agent questions 4, question responses 13 passed; OpenAPI Contract 1 passed. Existing outbox fixture activity stubs now include their required source field.
- `CC_BINARY=target/release/command-center python3 -m unittest discover -s tests -p test_question_api.py`: 13 passed, scripted local/SSH durable question transport compatibility.
- Browser feature/question suites: 19 passed (synthetic provider executables only): both profiles without history, one Enter, no-key decline/fresh review, wrong launch/prompt/process, ticket observations/live run status, desktop/phone with no terminal sockets, lost-response reload/read-only receipt recovery, offline disabling, and old question behavior.
- Broader 53-case browser launch/feature regression: 52 passed; one existing fixture assumed filesystem directory order via calls().at(-1). Fixed assertion to select its exact recorded launch UUID; targeted policy plus local/SSH large-literal filesystem cases both passed. Earlier broad failures exposed and drove the SSH argv fix, not silently ignored. No provider failure was papered over.
- After final status wording correction, desktop/phone/offline UI tests: 3 passed; updated synthetic mobile screenshot inspected. No false desktop-terminal-only notice or Unknown feedback while trust controls are present.
- `git diff --check`: passed. Private evidence under /tmp/cc-trust-* and ignored test-results.

## Remaining gates / handoff

Read-only inspection of the human-identified live Claude panes found both already working, not at trust. No keys sent to them. No real Claude/Codex test agents launched. An asynchronous approval question requests two disposable real-harness sessions in fresh temporary folders; it remains unanswered. Real profile/initial-prompt-consumption acceptance is therefore NOT claimed. Unsupported dialogs fail closed. Do not launch those real harness tests without approval. Keep CC-2/3 paused pending CC-72 disposition; CC-55 remains later.

Implementation is ready for the requested local commit on main, not deployed/pushed. Disruptive deployment still needs explicit approval. Prepared `/tmp/cc-deploy-native-folder-trust.py` (syntax-checked, not executed) preserves runtime/listeners/panes, backs up state, preflights submitting outbox/question/export/trust receipts, verifies four health/SSE paths and trust contract using GET only. No live ticket status changed and no native trust decision made.
