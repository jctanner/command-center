# Bug 0039: ACP protocol selection ignored during native preparation

Status: fixed
Found: 2026-11-16 during task0077 approved live deployment verification

Selecting ACP while the native launcher was checking its default project reset the dropdown to native and returned without opening the ACP dialog. The handler treated a read-only check as if it were a launch mutation. Fixture tests initially missed the timing because preparation completed quickly.

Switching now invalidates the native preparation generation and opens ACP; late native results are discarded. Actual native launch IO or a retained uncertain launch receipt still blocks protocol handoff. No message or agent launch is triggered by changing protocol.

New delayed-native-check Playwright regression passes, along with desktop/mobile ACP integration tests3 total. Frontend-only correction is published as part of the approved task0077 deployment; no second backend restart required.
