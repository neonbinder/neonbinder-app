---
name: agent-shell-node-ignores-nvmrc
description: In an agent's Bash tool, `node` is the nvm default binary, not .nvmrc's version; prepend the pinned nvm bin dir to PATH per gate call, and resolve a major-only .nvmrc (e.g. "22") to an installed full version first
metadata:
  type: reference
---

CLAUDE.md warns that `node` is a shell function re-reading `.nvmrc`. That is
the INTERACTIVE shell. In an agent's Bash tool it is a plain binary on PATH
(`type node` → `$NVM_DIR/versions/node/<default>/bin/node`), so `cd apps/web &&
node --version` can print the nvm default while `.nvmrc` pins another version.
CI reads the `.nvmrc` file, so a gate run on the default is not the gate CI runs.

**How to apply:** before any gate, compare `node --version` with that
package's `.nvmrc` (`apps/web` and `services/fake-bsc` pin different ones).
Run every gate command in one Bash call that starts with
`export PATH=$HOME/.nvm/versions/node/v<full version>/bin:$PATH` (shell state
does not persist between calls), then print `node --version` in the same call.

**Major-only .nvmrc trap:** `services/fake-bsc/.nvmrc` holds just `22`, so
`v$(cat .nvmrc)` builds `.../v22/bin`, which does not exist; PATH silently
keeps the default 24.x and the suite runs on the wrong Node while looking
pinned. Pick the full dir with `ls ~/.nvm/versions/node | grep '^v22\.'`.
Report the version you gated on, and say so if the pinned major is not installed.
