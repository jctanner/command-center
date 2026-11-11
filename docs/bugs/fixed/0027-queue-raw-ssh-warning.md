# Bug 0027: Raw SSH warnings dominate Agents

State: fixed

A dual-boot machine presents a different SSH host key in its alternate OS. Queue correctly rejects SSH but concatenates the full multiline stderr into the persistent checked-at status paragraph. This creates a large repeated error even while viewing healthy agents. Keep trust rejection and move raw detail behind an explicit disclosure.

Fixed by task 0047: compact disclosure with strict SSH trust unchanged. Desktop/mobile failure and recovery tests pass.
