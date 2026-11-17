# Task 0080: Desktop launch modal width

Owner: CC dev
Claimed: 2026-11-16
State: done (deployed)

Human reports Start agent modal is artificially narrow on desktop. Preserve compact styles and widen desktop cap from560px to1100px with viewport margins. Build and verify real rendered geometry before publishing frontend-only correction.

Desktop media rule now uses min(1100px,100vw -48px). Base compact rule and field layout unchanged. TypeScript/Vite build passed. Isolated browser geometry1440x900 and1280x768 measured1100px; touch393x852 measured355px and852x393 measured560px, all within viewport. The initial compact assertion overlooked the browser's native dialog max-width; corrected the check to retain that existing constraint. Synthetic desktop screenshot inspected.

Frontend-only publication verified2026-11-17T01:21:20Z: four access paths/index hashes healthy, backend/config/native pane PIDs unchanged. Live browser confirms1100px desktop width and mobile ACP/native entry, zero errors/API writes/terminal sockets. No restart, agent input, commit or push. Private evidence under .local/reviews/launch-width and launch-modal-width-*.json.
