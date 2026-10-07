# apps/instance — area instructions

Claude Code loads this file whenever a session works on files under `apps/instance/`, on top of the root
[`CLAUDE.md`](../../CLAUDE.md), whose always-on rules still apply. Keep it short: it has an 8 KB budget
(`AGENT003`), and detail belongs in the topic files it points at. Same authority as the root.


## Always here

- Every file is **AGPL-3.0-or-later**: `// SPDX-License-Identifier: AGPL-3.0-or-later`.
- It must not import `apps/web` or `apps/mobile`, and nothing in the client may import it: the client
  reaches an instance over the network through one module (ADR 0036 D-3).
- ADR 0036 D-3's four invariants in the root bind this server above all: the device copy is canonical,
  and the instance never becomes the only place a rider's data is.
- Only `src/store/` may import the SQLite driver or Kysely, and any new runtime dependency needs a row
  in ADR 0037 D-9's table.

## Read before working here

- [`docs/agents/instance.md`](../../docs/agents/instance.md) — the server, store, identity, sync, the history index and the room core.
- [`docs/agents/commands.md`](../../docs/agents/commands.md) §4a — the instance's commands (tests, `test:workerd`, the operator CLI, the image).
- [`docs/agents/ci.md`](../../docs/agents/ci.md) §4c — what CI runs of the instance, and why `test:workerd` is local only.

## The server is `apps/instance`, not `apps/api`

>
> ⚠️ **This section used to forbid a server.** It said *"There is no server in Phase 1. Do not add
> one, do not scaffold `apps/api`"* — owner decision D6, which ADR 0036 supersedes. A reviewer who
> remembers that sentence is reading the old file, and an issue body that repeats it predates the
> ruling (§8, "Read the issue's revision block first"). **The server is `apps/instance`, not
> `apps/api`**: no package of that name exists or is planned.
