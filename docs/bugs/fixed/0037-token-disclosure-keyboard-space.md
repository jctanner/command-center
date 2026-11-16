# Bug 0037: Token disclosure reduces compact keyboard reading space

Found: 2026-11-15, task0072 / CC-77.
State: fixed and deployed with human approval

The existing phone keyboard regression exposes only172.5px of history at a380px visual viewport, below its180px budget. The collapsed Token details disclosure consumes an extra row beneath Usage unreported. Keep collapsed disclosure beside the usage summary; expanding it remains explicit and preserves exact counts/provenance. Do not weaken the keyboard-height assertion. Validate phone portrait/landscape, details open/close and desktop usage alignment before marking fixed.


Validation: the unchanged phone visualViewport-height380px test now passes its history>180px and composer-bottom<=380px assertions. Details expand/collapse, exact metrics, phone landscape and laptop alignment also pass. Collapsed disclosure now shares a grid row with the usage summary; no assertion was relaxed. See task0072 for release status.
