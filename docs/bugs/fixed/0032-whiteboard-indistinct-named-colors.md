# Bug 0032: Whiteboard named colors inherit nonsemantic/duplicate ANSI slots

Observed: 2026-11-12
State: fixed (deployed 2026-11-12); task0066

Playwright screenshots and RGB inspection show Hackerman blue/magenta/purple nearly identical, orange rendered green, and several green swatches. Default theme accent/green and light theme accent/blue are exact matches. Red-only correction did not address the general terminal-ANSI-to-diagram mismatch. Some themes intentionally make ink and accent identical, so retain those two as separately labeled theme controls rather than pretending they are distinct named hues. Nine actual named colors need semantic light/dark hues and measured pairwise separation/contrast across all24 themes. No drawing-data changes required. Static and server palette must deploy together to preserve canonical export parity.

Semantic nine-color fix implemented/tested in task0066. >=4.5 contrast and >=0.08 OKLab pairwise separation across all24 themes; labeled Theme ink/accent separated. Read-only staged preview of actual32-object diagram verified. Joint UI/backend deployment pending human restart approval; no stored drawing data changed.

Joint deployment approved/completed: current browser and embedded renderer use the distinct semantic palette/fallbacks, and Whiteboard HTML is no-store. Live32-object scene checked without mutations; nine distinct named swatches and labeled theme controls verified.
