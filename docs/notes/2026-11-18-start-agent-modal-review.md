# Start agent modal: independent UI reviews

Task[0126](../tasks/done/0126-start-agent-modal-independent-reviews.md) captured the deployed modal via Playwright, then obtained fresh independent Claude (claude-opus-5-5) and Codex (gpt-6.1-sol) CLI reviews. Both received the same neutral brief, seven screenshots and measured geometry, in a separate read-only input directory. They did not see each other's reports; both completed successfully. Raw reviews and screenshots stay ignored under.local/reviews/start-agent-modal-2026-11-18/. No product changes, launches, agent messages, commit/push or deployment.

## Shared findings

- Native content is1416px tall versus874px desktop and742px laptop client height; phone1554px versus826px. All native Start/Check/Cancel buttons begin below the fold. The1100px desktop width is still a single column.
- Core intent is separated: machine/project/provider are above optional setup, while conversation and prompt appear later. Help paragraphs take considerable vertical space.
- Model hint is misplaced below venv controls; folder-trust checkbox is detached/centered. See bug[0053](../bugs/fixed/0053-launcher-help-and-consent-layout.md).
- Project/Directory repeat the same location, yet long phone paths clip the distinguishing suffix.
- Claude ACP still shows a native Codex readiness summary. See bug[0054](../bugs/fixed/0054-launcher-stale-native-status-in-acp.md).

## Suggested direction, not implemented

Keep one dialog with machine, project/resolved path, agent, fresh/resume choice and prompt in the primary area. Pair short fields on desktop, stack on phone. Keep status/Cancel/Start reachable in a fixed footer. Place less frequent execution/destination/environment/permission controls in accessible disclosures with visible summaries, explicit nondefault state and unchanged default-off trust/approval guards. Move help to its field and shorten persistent copy.

Claude keeps Model visible, Codex proposes grouping it with environment. Given the user's interest in explicit model selection, retain Model beside Agent as a small optional field. Protocol should remain accessible without occupying a full-width leading row; preserve native default and clarify ACP readiness. No additional preparation wizard or backend behavior change is needed to begin this layout work.

## Limits

Phone capture caught transient preparation, so its disabled Start is not evidence of permanently broken readiness. Captured label strings use first-child text and do not establish missing accessible names. Window/card naming is supported by ticket launch/API but not visible in this standalone modal; the neutral brief included this broader capability, and both reviewers correctly said they could not assess unseen controls. Neither recommendation changes launch guarantees, assumes actual phone keyboard testing, or authorizes implementing/deploying the redesign.
