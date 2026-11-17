# Bug 0040: ACP selection during project loading

State: fixed, 2026-11-16

Switching protocol while the shared launcher was awaiting projects invalidated the request generation without starting a replacement, leaving the launcher at Loading projects with disabled inputs. Restart project loading when changing protocol before projects are available. The lost-response browser test delays project discovery and switches immediately, then verifies one launch, one initial prompt, reload recovery and explicit close. Native delayed-preparation invalidation remains covered separately.
