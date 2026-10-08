# packages — area instructions

Claude Code loads this file whenever a session works on files under `packages/`, on top of the root
[`CLAUDE.md`](../CLAUDE.md), whose always-on rules still apply. Keep it short: it has an 8 KB budget
(`AGENT003`), and detail belongs in the topic files it points at. Same authority as the root.


## Always here

- Every file is **Apache-2.0**, and its header is `// SPDX-License-Identifier: Apache-2.0`. No GPL or
  AGPL dependency, build-time or shipped; a package exists to be droppable into somebody else's project.
- Nothing here may import from `apps/` (`boundaries/dependencies`). `domain`, `physics`,
  `sensors/src`, `sensors/protocol` and `protocol` name **no platform API at all** — two tsconfigs and
  the lint rules enforce it, and [`docs/agents/lint-boundaries.md`](../docs/agents/lint-boundaries.md) §4d says how.
- Read the package's own `README.md` before changing it: it records provenance, units and decisions.

## Read before working here

- [`docs/agents/packages.md`](../docs/agents/packages.md) — what each directory under `packages/` holds and why.
- [`docs/agents/store-harness.md`](../docs/agents/store-harness.md) — before testing anything `packages/store` persists.
- [`docs/agents/workout-format.md`](../docs/agents/workout-format.md) — workouts and their file format.
- [`docs/agents/web-bluetooth.md`](../docs/agents/web-bluetooth.md) — `packages/sensors` and its Web Bluetooth transport.
- [`docs/agents/wiring-gate.md`](../docs/agents/wiring-gate.md) §4j — before touching the five trainer-command seam modules.

## §2, the packages table

Which packages exist, and when each was created, is in [`docs/agents/packages.md`](../docs/agents/packages.md).
`apps/instance`'s row is in [`apps/instance/CLAUDE.md`](../apps/instance/CLAUDE.md).

| Package | Purpose | Must not depend on |
|---|---|---|
| `packages/domain` | Canonical units and types; every conversion in the program goes through it — the representations and the conversions are tabulated in [`packages/domain/README.md`](domain/README.md). Also signing/verification, analysis, and the **recording engine** (#45), because those must run identically on the device and on an instance. | **Any platform API at all** — no DOM, no Node globals, no I/O, no network types. The recording engine may not read a clock or schedule anything: time arrives as a parameter |
| `packages/fit` | FIT / GPX / TCX decode and encode | Anything server-specific; anything under `apps/` |
| `packages/sensors` | BLE sensor and trainer abstraction (`src/`), and the Web Bluetooth transport (`web-bluetooth/`) | `src/`: **any platform API at all**, and any BLE library. `web-bluetooth/`: every platform global except `navigator`. Web Bluetooth types must not escape above the transport boundary |
| `packages/physics` | Power → speed. Pure computation. | Any rendering, BLE or platform API |
| `packages/protocol` | The race-room wire format: messages, a bounded decoder, the version handshake (#768) | **Any platform API at all**, as `packages/domain` — and any production dependency |
| `packages/store` | Local activity, stream, **recording-checkpoint** and **signed-record** persistence, the device keypair, and its migrations | Anything under `apps/` |

## §5, migrations

### Migrations

The migration tool is **Dexie's own versioning** — `db.version(n).stores({...}).upgrade(...)`. There
is no separate migrator, deliberately: a second tool would be a second source of truth for the
schema version alongside the one IndexedDB already maintains.

**IndexedDB has no downgrade event.** `onupgradeneeded` fires only when the version increases;
opening at a lower version raises `VersionError`. So an in-place rollback does not exist and any
design assuming it does is wrong. Instead:

- Every migration is a **pair of pure functions**, `up` and `down`, side by side in `packages/store`.
- `down` is **tested** by applying `up` then `down` to a fixture and asserting the original shape
  returns. That test is what makes the rollback real.
- The runtime rollback path is **export → downgrade → re-import**, which local-first already
  supports because the athlete's signed files are the canonical artefact.
