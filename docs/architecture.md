# Architecture

The layout of this repository, the boundaries between its components, and the index of decisions
that produced them.

The reasoning lives in the ADRs — this file describes **what** the structure is and **where** each
line falls. [`docs/adr/0005-tech-stack.md`](adr/0005-tech-stack.md) says why.

> **Status: `apps/web` and `packages/domain` exist**, created by
> [#23](https://github.com/openzigs/onyourleft/issues/23) with the pnpm workspace, the toolchain, a
> committed lockfile and the lint-enforced boundaries. The other four packages and `apps/mobile` do
> not; each is created by the issue that owns its content, using `packages/domain` as the template.
> The layout is fixed here because roughly thirty sub-issues reference it by name, and moving it
> later means touching most of them. The workspace globs (`apps/*`, `packages/*`) and every rule
> below are written against these paths already, so a package arrives inside the rules rather than
> beside them.

## The shape of the product

**Local-first.** The athlete's own device holds the canonical copy: rides are recorded locally,
stored locally, encoded to FIT and signed with a per-athlete keypair. The signed file plus its signed
summary is the canonical artefact, so an athlete with their files needs no server to have their
history.

**One small instance, self-hostable, later.** It does only the four things a server is genuinely
required for — inbound reachability for clients that cannot listen, indexing, authority for real-time
state, and enforcement of privacy and erasure. Federation between instances is over signed records.
This is Phase 3, [#7](https://github.com/openzigs/onyourleft/issues/7).

**Not peer-to-peer.** A browser cannot be a peer; hole punching fails hardest on mobile-carrier
symmetric NAT; and a CRDT/P2P history makes privacy zones, enforced visibility and account deletion
unenforceable by construction. Recorded in the local-first ADR
([#57](https://github.com/openzigs/onyourleft/issues/57)).

```mermaid
graph TB
    subgraph P1["Phase 1 — one machine, no server, no account"]
        BLE["BLE sensors + trainer"] --> SEN["packages/sensors"]
        SEN --> WEB["apps/web"]
        PHY["packages/physics"] --> WEB
        WEB --> STO["packages/store<br/>(IndexedDB via Dexie)"]
        WEB --> FIT["packages/fit"]
        DOM["packages/domain"] -.used by all.-> WEB
    end
    subgraph P3["Phase 3 — one small self-hostable instance"]
        INST["sync, index, authority, enforcement"]
    end
    STO -. "opt in, signed records (#61)" .-> INST
    MOB["apps/mobile<br/>Capacitor, same web build"] -.Phase 4.-> WEB
    style P3 stroke-dasharray: 5 5
    style MOB stroke-dasharray: 5 5
```

## Layout

```
apps/                 AGPL-3.0-or-later, without exception
  web/                browser client — the Phase 1 product
  mobile/             Capacitor shell wrapping the same web build (Phase 4)

packages/             Apache-2.0, without exception
  domain/             units, core types, validation, signing, analysis
  fit/                FIT / GPX / TCX codec
  sensors/            sensor abstraction and BLE transport — BLE only
  physics/            cycling power/speed model
  store/              local activity and stream store

docs/
  architecture.md     this file
  adr/                numbered architecture decision records

scripts/              dependency-free repository checks; run on a bare clone

.github/
  workflows/rules.yml runs those checks on every pull request and on main
```

There is deliberately **no `apps/api`** (Phase 1 has no server — owner decision D6), **no `infra/`**
(Phase 1 deploys nothing; deployment is [#17](https://github.com/openzigs/onyourleft/issues/17)), and
**nothing anywhere for ANT+** (owner decision D2).

## Component boundaries

The licence boundary and the dependency boundary are the same line, which is what makes both
checkable.

| Component | Licence | Owns | Must not depend on | Issues |
|---|---|---|---|---|
| `apps/web` | AGPL-3.0-or-later | Routing, screens, design system, accessibility baseline, the live ride screen | — | #48–#51 |
| `apps/mobile` | AGPL-3.0-or-later | Capacitor shell, native permissions, foreground service | — | #85, #87 |
| `packages/domain` | Apache-2.0 | Canonical units and types; every conversion in the program; signing/verification; analysis computations | **Any platform API at all** — no DOM, no Node globals, no I/O, no network types | #25, #61, #66, #75–#78 |
| `packages/fit` | Apache-2.0 | FIT / GPX / TCX decode and encode | Anything server-specific; anything under `apps/`; **anything carrying the Garmin FIT Protocol License — see [ADR 0006](adr/0006-fit-codec-licensing.md)** | #29–#32 |
| `packages/sensors` | Apache-2.0 | BLE sensor and trainer abstraction; Web Bluetooth transport | Anything server-specific. Web Bluetooth types must not escape above the transport boundary | #39–#44 |
| `packages/physics` | Apache-2.0 | Power → speed, as separately testable terms | Any rendering, BLE or platform API | #88 |
| `packages/store` | Apache-2.0 | Local activity and stream persistence, and its migrations | Anything under `apps/` | #27 |

`packages/domain` is filled in as of [#25](https://github.com/openzigs/onyourleft/issues/25): the
canonical representation of each quantity, the conversions into and out of the wire formats (FIT
semicircles, the FIT 1989 epoch, the FIT altitude scale and offset, the wrapping 1/1024 s and 1/2048
s event-time counters), and the validation that runs where an untrusted number becomes a typed one.
Each is tabulated with its unit, its sign rule and the bug it prevents in
[`packages/domain/README.md`](../packages/domain/README.md), which is the reference a consumer reads
rather than this file.

**Dependencies point one way: `apps/` → `packages/`, never the reverse.** Combined with the licence
rule that is not a coincidence — Apache-2.0 code may be combined into an AGPL-3.0 work, but not the
other way round, so a `packages/` → `apps/` import would be a licence violation as well as a layering
one.

### Where the shared/deployment-specific line falls, and why it is not the usual one

Because the client owns the data and the **same computations must run identically on the device in
Phase 1 and on an instance in Phase 3**, the shared packages are not "code the client and server
happen to both need". They are **everything that is a function of the data rather than of the
deployment**.

That is why the constraint on `packages/domain` is *no platform dependency at all*, not *no server
API dependency*. A package that imports `window` or `fs` cannot run on both sides of a federation
boundary. The same code signs a record on a phone and verifies it on an instance.

What stays deployment-specific is narrow: reachability, indexing, authority and enforcement. All four
belong to the instance, and none exists in Phase 1.

### Boundaries that are enforced, not merely documented

A boundary maintained by review discipline will not survive a program this size.

**Enforced by `eslint.config.js`** since [#23](https://github.com/openzigs/onyourleft/issues/23):

| Rule | Fails when |
|---|---|
| `boundaries/dependencies` | anything under `packages/*` imports anything under `apps/*`, in either the relative or the `@onyourleft/…` workspace spelling |
| `@typescript-eslint/no-restricted-imports` | `packages/domain` names **any** Node builtin — the pattern list is derived from `builtinModules` rather than typed out, so `events`, `util` and `stream/promises` fail exactly as `node:fs` does — or `react`, `react-dom`, `vite` or `dexie` |
| `no-restricted-globals` | `packages/domain` names a DOM global (`window`, `document`, `navigator`, `location`, `history`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`), a Node global (`process`, `Buffer`, `__dirname`, `__filename`, `global`, `require`) or a network global (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Request`, `Response`, `Headers`). A named list, not a closure — the closure is the typechecker |
| `headers/header-format` | a `.ts`/`.tsx` file's first line is not the SPDX identifier its directory requires |

`packages/domain/tsconfig.json` is what makes the platform rules a *closure* rather than a denylist:
`lib: ["ES2024"]` with `types: []` leaves no ES-external name and no `@types` package in scope, so
`fetch`, `WebSocket`, `process` and `import … from 'events'` are all compile errors, not just the
ones somebody remembered to list.

That closure is conditional and it was broken until this section was written. `types: []` suppresses
the automatic `@types` lookup but does not stop a `/// <reference types="node" />` inside a `.d.ts`
the package imports, and `packages/domain/vitest.config.ts` used to import `vitest/config` — which
pulled Vite's declarations, and through them `@types/node`, into the same TypeScript program as
`src/`. Everything above typechecked cleanly inside the package that forbids it. That config file now
imports nothing. **Any import added to a file in this package's program can reopen it**, which is why
the ESLint rules above are not redundant with the tsconfig, and why a row in this table is checked by
writing the file it forbids and running both gates — never by reading the row.

**Still to be enforced**, each by the issue that introduces the code it constrains:

- No Web Bluetooth type above the transport boundary in `packages/sensors` (#39, #40).
- No routing-engine type above the `RoutingProvider` interface (#70).

And these are enforced with no toolchain at all, by `scripts/check-repo-rules.sh`,
`scripts/check-licence-hashes.sh` and `scripts/check-env-example.sh`:

| Rule | Fails when |
|---|---|
| `LIC001` / `LIC002` | a source file's SPDX header does not match the licence its directory requires |
| `LIC003` | a package manifest declares a licence its path does not permit |
| `LIC004` | a package under `packages/` or `apps/` has no `LICENSE` file of its own |
| `LIC005` | a licence text no longer matches the digest ADR 0001 records for it, or ADR 0001 no longer records one, or a leaf package's own `LICENSE` is not byte-identical to the canonical text its path requires |
| `SCOPE001` | ANT+ is referenced anywhere in a source tree |
| `WF001` | `pull_request_target` appears in a workflow — it receives secrets and bypasses the fork-approval gate |
| `ADR001` / `ADR002` | two ADRs share a number, or a filename is not `NNNN-kebab-case.md` |
| `ENV001` | a source file reads an environment variable `.env.example` does not list, or `.env.example` is missing |

**All of them run in CI**, on every pull request and every push to `main`, from
[`.github/workflows/rules.yml`](../.github/workflows/rules.yml). Before that workflow existed the
rules were checkable but unchecked — a distinction worth keeping in mind about every other row in
this document that says "enforced".

## Technology

Decided in [ADR 0005](adr/0005-tech-stack.md). Summary only; the reasoning and the rejected
alternatives are there.

| Concern | Choice |
|---|---|
| Language | TypeScript 6.0.3 — *not* 7.x, because typed linting does not support it yet |
| Runtime | Node 24 "Krypton" (Active LTS until 2026-10-20) |
| Package manager | pnpm 11 workspaces |
| Web client | React 19 + Vite 8 |
| Mobile client | Capacitor, wrapping the same web build — **not scaffolded yet**; #85 |
| Local data layer | IndexedDB via Dexie 4.4.5 — **not installed yet**; #27 adds it |
| Migrations | Dexie's own versioned schema; `up`/`down` pairs with a tested `down` |
| Instance data layer | **deferred to #7** |
| Test runner | Vitest 4.1.11 |
| Coverage gate | **no percentage** — every new code path covered by a test proven to fail without the change |
| Linter / formatter | ESLint 10 + typescript-eslint + Prettier 3 |
| Real-time transport | deferred to [#16](https://github.com/openzigs/onyourleft/issues/16) |

Installed as of #23: the toolchain above, React 19.2.8, React DOM 19.2.8 and Vite 8.2.2. Everything
else in the table is a decision that no `package.json` has acted on yet. `CLAUDE.md` section 4b
keeps that list; the commands are in section 4a.

## Decision record index

Numbers are unique, and `scripts/check-repo-rules.sh` rule `ADR001` fails the build if two files ever
share one.

### Written

| ADR | Title | Issue |
|---|---|---|
| [0001](adr/0001-licence.md) | Licensing — AGPL-3.0 app + Apache-2.0 leaf packages | #18 |
| [0004](adr/0004-privacy-and-location.md) | Activity privacy and the location-data model | #21 |
| [0005](adr/0005-tech-stack.md) | Technology stack and workspace layout | #22 |
| [0006](adr/0006-fit-codec-licensing.md) | FIT codec licensing — implement from the public protocol documentation | #58 |

### Claimed by open issues — **check here before you pick a number**

> ⚠️ **Three numbers are claimed twice.** Read from the issue bodies on 2026-09-03, and tracked in
> [#97](https://github.com/openzigs/onyourleft/issues/97). Until that is settled, whoever writes the
> second ADR of a colliding pair must renumber, and amend the acceptance criterion in their own issue
> when they do.

| Number | Claimed by | Also claimed by |
|---|---|---|
| 0002 | #19 — clean-room posture | **#57 — local-first architecture** (ADR 0001 already refers to the local-first decision as "ADR 0002") |
| 0003 | #20 — platform support matrix | — |
| **0005** | **#22 — tech stack (written)** | **#57 — local-first architecture** |
| **0006** | **#58 — FIT codec licensing (written)** | **#27 — stream storage** |
| 0007 | #59 — patent posture | — |
| 0008 | #86 — mobile client architecture | **#60 — tiles and routing** |

### Dependencies between decisions

- **ADR 0005 depends on ADR 0008 (#86).** #86 chose Capacitor + TypeScript for the mobile client
  precisely so the leaf packages and the web build are *shared* rather than reimplemented in a second
  language. Overturning TypeScript in ADR 0005 would invalidate ADR 0008; the dependency runs both
  ways and is recorded in both.
- **ADR 0005 depends on the local-first decision (#57).** The architecture is what decides where the
  boundary between shared domain code and deployment-specific code falls, which is what makes
  `packages/domain` platform-free rather than merely server-free.
- **ADR 0005 is stricter than ADR 0001.** ADR 0001 permits per-package licence declaration; ADR 0005
  makes the boundary structural, decided by path. Deliberate: a path cannot be silently mis-declared.
- **ADR 0001 is constrained by #58 and #59.** #58 is now [ADR 0006](adr/0006-fit-codec-licensing.md)
  and it **discharges that constraint**: the codec is implemented from the public FIT protocol
  documentation and depends on nothing carrying Garmin's terms, so §2(d) never attaches and ADR 0001
  is not reopened. That conclusion is conditional — ADR 0006 names the three things that would
  overturn it, and the first is a Garmin FIT artefact reaching this repository, its lockfile, its CI
  or a contributor's toolchain. #59 remains open.
