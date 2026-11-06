# Bug 0012: Window-close fixture assumes a removed host ID

The successful machine-management regression removes/recreates its configured host. A later close-guard test still addressed literal host ID test, which no longer exists. Resolve the unique fixture socket's configured host ID and carry it into the close receipt/helper instead. This changes only fixture targeting, not production closure safeguards. Validate the machine-edit and close-guard tests together.

Validated: machine-edit followed by close-guard regression, 2 passed.
