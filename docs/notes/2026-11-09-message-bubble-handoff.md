# Message bubble handoff

Task [0039](../tasks/done/0039-outbox-message-handoff-gap.md) and bug [0021](../bugs/fixed/0021-outbox-seen-before-history-bubble-gap.md) fix independent Seen/history polling that briefly removed sent messages. Retain only current-view pending intents until their exact native replacement is rendered, including fast confirmation before POST returns. No delivery changes or old-receipt resurrection.

Frontend build and four distinct focused browser cases pass; final frontend deployed and served bundle verified. No backend or agent restart/live input. Next task 0040; next bug 0022.
