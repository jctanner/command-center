# Bug 0014: Integration source settings prefer a personal machine

Slack, Email and Jira source dialogs preferred a particular personal host name over the first configured machine when no source was saved. Public-source cleanup removes that name and its setup prompts; preserve an existing saved/active selection, otherwise select the first configured machine. Source revisions, endpoint guards and credentials are unchanged. Validated by the frontend build and all 45 integration browser tests, including source settings, source changes, SSH-backed reads and mobile isolation.
