# Container profile creation from launcher

Task[0131](../tasks/done/0131-launcher-create-container-profile.md) adds New container profile… in the Goose container launcher. It opens the selected machine’s Containers settings and an unsaved draft. Saving remains explicit; returning preserves launch folder/prompt and reloads profiles, with launch review required again. Unsaved-settings guards retained.

Build and22 distinct browser cases passed, including desktop/mobile save/return, second-machine selection and no implicit writes/engine calls. No backend change, live profile save, agent launch, commit/push or deployment. Live production remains task0130.
