# Task 0070: Native folder trust in CC (CC-72)

Owner: CC dev
Claimed: 2026-11-14
State: done (2026-11-15; real-harness validation, preparation consent and deployment complete)

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

## Original gates / handoff (superseded by approved completion below)

Read-only inspection of the human-identified live Claude panes found both already working, not at trust. No keys sent to them. No real Claude/Codex test agents launched. An asynchronous approval question requests two disposable real-harness sessions in fresh temporary folders; it remains unanswered. Real profile/initial-prompt-consumption acceptance is therefore NOT claimed. Unsupported dialogs fail closed. Do not launch those real harness tests without approval. Keep CC-2/3 paused pending CC-72 disposition; CC-55 remains later.

Implementation is ready for the requested local commit on main, not deployed/pushed. Disruptive deployment still needs explicit approval. Prepared `/tmp/cc-deploy-native-folder-trust.py` (syntax-checked, not executed) preserves runtime/listeners/panes, backs up state, preflights submitting outbox/question/export/trust receipts, verifies four health/SSE paths and trust contract using GET only. No live ticket status changed and no native trust decision made.

## Approved push and deployment

Human explicitly requested push then deploy. Pushed local checkpoint f4645c4 and implementation 483b14f to origin/main, then executed `/tmp/cc-deploy-native-folder-trust.py` successfully. All four configured health/access paths and initial SSE events passed. Configuration hashes and canonical tmux pane/PID inventory unchanged. Trust routes present in served contract; no new native trust decisions or agent launches attempted.

Read-only live Chromium: Agents loaded, zero page errors, zero trust-decision POSTs. Read-only rhlaptop filesystem request validated the new stdin helper over the existing shared SSH/ProxyJump path. Runtime/database/assets backed up privately. Existing browsers need one reload for the new controls.

Deployment gate is resolved; real Claude/Codex disposable acceptance tests remain separately unapproved and unperformed. Task stays current for that validation, with no claim that actual provider acceptance/initial-prompt consumption was verified. CC-2/3 remains paused, CC-55 later.

## Approved completion (2026-11-15)

Human explicitly authorized real Claude/Codex disposable trust tests (including decline/no-input audit and guarded UI trust), optional default-off per-launch pre-trust, docs/skill updates, local commits, then push/deploy and stop. Existing agents/windows remain untouched. Tests use fresh throwaway folders, isolated CC state and tmux socket with real installed harnesses and normal auth. Remove owned sessions/folders afterwards. Design: Codex pre-trust is an exact canonical-path CLI configuration override for this invocation, never a CC write to trust files or an approval/sandbox bypass. Claude/pi reject unsupported pre-trust; their normal trust behavior stays intact. Bind the boolean into preparation, review, launch metadata and durable ticket run; no client flags or global defaults. Revalidate the installed executable/config-flag support at preparation and use. Real tests must confirm this mechanism, not merely mock it.

## Completion implementation and real evidence (2026-11-15)

The initially proposed Codex CLI trust override was tested in a disposable real Git folder and did not dismiss native trust; it was removed before shipping. Final pre_trust is explicit human preparation consent to one normal guarded native decision for Claude/Codex, default false, pi rejected. Exact canonical folder/root/inode, endpoint, installed launch identity and original process are bound; wider repository roots, prior decisions and changed/unsupported prompts require human review. It uses the existing durable claim/receipt path with preauthorized attribution, not CLI bypass flags or provider file edits. Bounded startup waits pin the original pane PID/start while its CLI wrapper becomes observable. Check/recovery/restart never replays this work. Ticket run metadata retains the choice and outcome; both UI launchers show the exact reviewed scope and clear consent when scope changes.

Real native matrix against the staged release: four passed. Claude2.1.325 and Codex0.167.0 each passed card/ticket awaiting_trust, no-key Decline with durable audit, guarded UI Trust and initial no-tools prompt consumption; each also passed exact-folder preparation consent with attributed durable receipt. Codex's native trust prompt appears for fresh Git folders, while empty non-Git folders started read-only without one. Native screens exposed two new picker variants, fixed under bug0036. All owned test folders/processes cleaned up (verified zero remaining). Tests used isolated CC storage/socket, not live production tickets or existing agents.

Validation: Rust88 passed, native trust Python8 and preparation Python3, frontend build/fmt/Clippy passed, OpenAPI6 passed, synthetic trust/UI12 passed. Real provider checks are explicitly opt-in (`CC_REAL_TRUST_TESTS=1`); ordinary suites skip them. Disk-backed TMPDIR=/var/tmp was needed because the host's per-user /tmp quota blocked SQLite/test files; a symlinked temporary root also correctly failed existing filesystem canonical-path guards. Those environment failures were resolved without weakening tests. Existing launch regressions are being rerun with explicit staged release/assets (their defaults point to old debug/dist builds).

Human has authorized push and deployment after checks. No production restart has yet occurred for this completion. No live native trust prompts other than the disposable tests were answered.

Final staged launch regressions:17 passed with explicit CC_BINARY=../target/release/command-center and CC_WEB_DIR=dist-next (local/SSH endpoint/directory guards, literal initial prompts, ticket claims, recovery across backend restart, phone navigation, policy and Python venv). Existing Python policy/activity/outbox suites:4/5/7 passed. Native-profile/preparation tests8/3, Rust88, OpenAPI6, synthetic trust/UI12 and real native4 all pass; fmt/Clippy/build clean. Release gate resolved; deploying next under the explicit human request.


## Approved completion deployment

Implementation2711a0b pushed and deployed under the human's explicit request. Existing exact runtime/environment/listeners preserved, backups retained privately, and no submitting outbox/question/trust/export operations interrupted. All four configured health paths, Whiteboard SSE and served trust/token-metrics contracts passed. Running executable hash matches the staged release. Configuration hashes and canonical tmux pane/PID inventory are unchanged.

Live desktop1440px and compact393px Chromium checks: preparation checkbox default off, unsupported pi disabled/reset, zero page errors, API writes or terminal sockets. No production agent launches/restarts/trust decisions were needed for this verification. All disposable native test folders and processes removed; provider-owned native audit/history is left to the provider. Coordinator docs and skill explain awaiting_trust, explicit human controls and preparation consent, and prohibit coordinator trust answers.

Final outcome: real native4, synthetic trust/UI12, staged launch regressions17, Rust88, Python native profiles8/preparation3/policy4/activity5/outbox7, OpenAPI6 passed; fmt/Clippy/frontend/release build passed. CC-72 is complete. No further work authorized by this completion; stop after reporting commits/deployment evidence.
