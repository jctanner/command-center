# Private deployment data and Git history

Keep deployment-specific addresses, machine names, receipt IDs and local paths in ignored `.local/operations.md` or the existing private runtime configuration. The optional local notes may be absent on a fresh clone. Keep actual network listener and HTTPS-origin flags unchanged when restarting an existing installation; inspect the running configuration rather than copying synthetic documentation examples.

Public examples use synthetic private LAN addresses and CGNAT addresses for tailnet validation. Substitute addresses assigned to your backend. The example HTTPS hostname is a placeholder. Integration settings use the saved source or the first configured host; no personal machine name gets special treatment.

## Prepared cleanup

The privacy cleanup preserves the development timeline as five sanitized historical commits plus one Apache/privacy follow-up. Every historical file version and commit identity is filtered; author and committer emails use the owner's GitHub noreply identity. Public repository links and project attribution remain intact. Original history, uncommitted source files, a private replacement map and operational context are backed up outside Git.

The prepared repository and bundle contain only the cleaned reachable history. They are staged privately for review; the working repository's original branch and GitHub remote history remain unchanged until an explicit final action. Do not push original backup branches, merge old clones into the cleaned history, or upload the backup directory.

## GitHub publication decision

A force-push changes reachable branch history but cannot guarantee deletion of old GitHub cached commit views, pull-request references, other clones or forks. GitHub Support's removal process is limited and does not generally purge ordinary non-sensitive identifiers. See [GitHub's sensitive-data removal guidance](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).

For stronger separation, keep the existing repository private and publish the clean history into a genuinely new repository that has never received the original objects. Preserve the original repository's name by renaming that private archive first only after explicit approval. Repository rename, creation, force-push and visibility changes are separate final actions; preparation does not perform them.

If the owner instead chooses to overwrite the existing private main branch, use an exact force-with-lease guard against the reviewed remote tip, retain the private backup, coordinate other clones, and acknowledge the cache limitation. Never force-push blindly or treat the rewritten reachable history as proof of server-side erasure.
