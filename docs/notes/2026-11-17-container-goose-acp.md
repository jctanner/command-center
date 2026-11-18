# CC-100 implementation handoff

[Task0102](../tasks/done/0102-container-managed-goose-acp.md) implements reviewed container Goose profiles, launch/cards/chat, explicit permissions, exact-volume/session ACP restart and close. Real rhlaptop tests passed; only managed scratch was mounted. Native launch remains default. Final stdin credential bootstrap avoids Podman env/OCI metadata copies and was independently validated with an authenticated model reply. The first Goose test session was used by the human and preserved; all separate disposable test containers/workspaces/volumes and isolated backends were cleaned.

No production deploy, commit or push. Deployment must preserve current listeners, SSH agent environment and all live agents; staged frontend also contains CC-89. The retained human Goose needs a separately explicit Restart & update broker after deployment to upgrade its earlier credential path. Setup/limits are documented in [the container reference](../reference/acp-containers.md); full checks and private evidence are in task0102.

Preparation and a host-side exclusive lock also prevent two Goose containers from sharing/relabeling an active scratch directory. The original container is exempt only for a verified restart; real read-only host validation and unit race tests pass.
