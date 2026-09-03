# ADR 0005: Technology stack and workspace layout

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: repository owner (decisions A, B and C below confirmed 2026-09-03)
- **Issue**: [#22](https://github.com/openzigs/onyourleft/issues/22)
- **Depends on**: [ADR 0001](0001-licence.md) (licence boundary),
  the local-first architecture decision ([#57](https://github.com/openzigs/onyourleft/issues/57)),
  and the mobile client decision ([#86](https://github.com/openzigs/onyourleft/issues/86))
- **Implemented by**: [#23](https://github.com/openzigs/onyourleft/issues/23) (workspace scaffold),
  [#24](https://github.com/openzigs/onyourleft/issues/24) (CI gates)

## Context

Before this ADR the repository contained documentation and a licence and nothing else: no manifest,
no lockfile, no CI, no `CLAUDE.md`. The only technical signal anywhere in it was `.gitignore`, which
lists `node_modules/`, `dist/`, `build/` and `coverage/`.

That is an **inference**, not a decision. Roughly thirty sub-issues state acceptance criteria in
terms of "the project's own commands" and "the project's coverage gate", and those phrases have
until now referred to nothing. This ADR defines them, which is why it blocks essentially everything.

Two constraints shape every choice below, and they pull in opposite directions from the usual
defaults:

1. **Phase 1 has no server at all** (owner decision D6). The first milestone pairs a Bluetooth
   trainer, records a ride, stores it and views it, on one machine, with no account and no hosting
   bill. The layout must leave room for a server without requiring one to exist —
   [#7](https://github.com/openzigs/onyourleft/issues/7) brings it in Phase 3.
2. **The licence boundary is load-bearing** (ADR 0001). Reusable leaf packages are Apache-2.0 so
   others can adopt them; the application is AGPL-3.0-or-later so nobody can run a closed hosted
   fork. A stack choice that makes that boundary hard to check is a bad stack choice, regardless of
   its other merits.

Every version number below was read from the npm registry or the vendor's own release data on
**2026-09-03**, with the command that produced it recorded, so a future reader can re-run the check
rather than trust this summary.

## Decision

### A. Language and runtime: TypeScript on Node — the `.gitignore` inference is **ratified**

The inference is explicitly **ratified, not silently inherited**. TypeScript on Node is the decision.

The reason is not the ignore file. It is that
[ADR 0008 (#86)](https://github.com/openzigs/onyourleft/issues/86) chose **Capacitor** for the mobile
client precisely so the leaf packages are *shared* rather than reimplemented in a second language,
and so the same web build is reused rather than only the leaf packages. **Overturning TypeScript here
would invalidate ADR 0008.** That dependency runs both ways and is recorded here deliberately: if
the #91 rendering spike fails and the mobile client falls back to React Native, TypeScript still
holds — both candidates were TypeScript, which is what made that fallback survivable. Only a move to
Flutter or a native-per-platform client would reopen this, and ADR 0008 closed both.

The same argument decides it for the leaf packages independently: `packages/domain`,
`packages/fit`, `packages/sensors` and `packages/physics` must run unchanged in a browser, in a
Capacitor WebView, on a Node instance in Phase 3, and in tests. One language that reaches all four
is the whole point.

#### Runtime version: **Node 24 "Krypton"**

Read from `nodejs/Release/schedule.json` on 2026-09-03:

| Line | Codename | Active LTS from | Maintenance from | End of life |
|---|---|---|---|---|
| v22 | Jod | 2024-10-29 | 2025-10-21 | 2027-04-30 |
| **v24** | **Krypton** | **2025-10-28** | 2026-10-20 | 2028-04-30 |
| v26 | — | 2026-10-28 | 2027-10-20 | 2029-04-30 |

Node 24 is the **Active LTS line today** and stays supported until 2028-04-30. Node 26 enters Active
LTS on **2026-10-28**; move to it then, not before — "Current" is not a line to build a program on.
Pin the version in `.nvmrc` and in `engines`, and use the same major in CI, so a contributor and a
runner never disagree about what "it works on my machine" means.

#### TypeScript version: **6.0.3 — deliberately not 7.0.2, and this is a trap worth recording**

```
$ npm view typescript dist-tags     # 2026-09-03
latest: 7.0.2       (published 2026-07-08)
$ npm view typescript-eslint peerDependencies
{ eslint: "^8.57.0 || ^9.0.0 || ^10.0.0", typescript: ">=4.8.4 <6.1.0" }
$ npm view typescript-eslint@canary peerDependencies.typescript
>=4.8.4 <6.1.0
```

**TypeScript 7.0.2 is the current release and typed linting does not support it.** `typescript-eslint`
8.69.0 caps its peer range at `<6.1.0`, and so does its canary — so this is not a "wait a week"
situation, it is the state of the ecosystem on the date this was checked. Adopting the newest
TypeScript would mean shipping a workspace whose linter cannot do type-aware analysis, which is most
of what the linter is for here (`no-floating-promises` alone matters in a codebase full of BLE and
IndexedDB async).

So: **TypeScript 6.0.3** (published 2026-04-16), the last stable 6.x. The trigger to revisit is a
single command, and it belongs in `CLAUDE.md` rather than in someone's memory:

```bash
npm view typescript-eslint peerDependencies.typescript
```

When that range admits 7.x, move — the 6.x line was published as the compatibility bridge to the
native Go compiler, so this is a scheduled migration, not an indefinite deferral.

### B. The licence boundary is **structural**, decided by path

This is the most important layout decision in this ADR.

> **Everything under `packages/` is Apache-2.0. Everything under `apps/` is AGPL-3.0-or-later.
> Without exception.**

The boundary **is** the directory. That makes it checkable by path rather than by reading manifests,
and `scripts/check-repo-rules.sh` checks it today, before any package exists.

**This is stricter than ADR 0001 requires, and the extra strictness is deliberate.** ADR 0001 permits
per-package declaration: a package states its licence in its manifest and carries its own `LICENSE`.
That remains true and is still required — each package carries both. But a manifest field can be
silently mis-declared, mis-copied from a template, or edited in a large diff nobody reads closely; a
path cannot. A file's location is visible in every diff, in every file listing, and to every tool,
including tools that do not parse manifests. The path rule is belt and braces, not a replacement.

The consequence that makes it worth the rigidity: **a GPL or AGPL dependency appearing anywhere under
`packages/` fails CI**, and the check needs to know nothing except which directory the manifest is
in. [#24](https://github.com/openzigs/onyourleft/issues/24) owns wiring the dependency-licence half
of that gate; the declaration half is enforced now.

The rigidity has a real cost, and it should be paid consciously: a package that genuinely needs a
GPL dependency cannot live under `packages/`. It has to move to `apps/`, or the dependency has to be
replaced. That is the correct outcome — it is the boundary doing its job — but it means "where does
this code live" is a licence question, not a taste question, and it is answered before the code is
written rather than in review.

### C. Coverage gate: **no percentage — a mutation requirement**

> **Every new code path is covered by a test proven to fail without the change.**

Concretely, and this is the phrasing `CLAUDE.md` carries: the author mutates the implementation —
inverts a condition, deletes a write, returns a constant — watches the test go red, restores the
implementation, and **lists the mutations in the PR body**.

**No percentage is set, and one should not be invented.** Two reasons, both recorded so the number
does not get added back by reflex:

1. **A percentage measures lines executed, not behaviour asserted.** A test that calls a function and
   asserts nothing scores identically to one that pins the contract. The dominant defect shape this
   program has to survive — a write that reports success while the read cannot see it, enumerated in
   [#4](https://github.com/openzigs/onyourleft/issues/4) — is invisible to line coverage by
   construction, because the buggy line *did* execute.
2. **A floor that is red on arrival gets routed around.** This repository has no code. Any percentage
   set today is set against nothing, and the first packages to land would either fail a gate that
   measures noise or be granted an exemption that then never expires.

`@vitest/coverage-v8` is still configured and coverage is still reported, because the *report* is a
useful review artefact — an untested branch is worth seeing. It is a signal, not a gate. The gate is
the mutation list, and it is enforced by review of the PR body, which is where
`CONTRIBUTING.md` already puts it: *"Tests pass, and you have watched each new test fail before
making it pass."* This ADR turns that sentence into a procedure with an output.

Mutation testing tooling (`@stryker-mutator/core` 10.0.0, Apache-2.0) is **not** adopted now.
Automating the mutation is attractive and can be revisited once `packages/domain` and
`packages/physics` exist — pure-computation packages are where it pays. Adopting it before there is
code to mutate would be configuring a tool against nothing.

### D. Workspace layout

```
apps/                 AGPL-3.0-or-later, without exception
  web/                browser client — the Phase 1 product (#48-#51)
  mobile/             Capacitor shell wrapping the same web build (#85, ADR 0008; Phase 4)

packages/             Apache-2.0, without exception
  domain/             units, core types, validation, signing, analysis — no platform API at all (#25)
  fit/                FIT / GPX / TCX codec (#29-#32)
  sensors/            sensor abstraction and BLE transport (#39-#44)
  physics/            cycling power/speed model, Martin et al. 1998 (#88)
  store/              local activity and stream store (#27)

docs/
  architecture.md     the layout, the boundaries, and the ADR index
  adr/                numbered architecture decision records

scripts/              dependency-free repository checks that run on a bare clone
```

Notes on what is **not** there, each deliberate:

- **No `apps/api`.** Owner decision D6: Phase 1 has no server. The layout leaves room for one — it is
  a sibling of `apps/web` when [#7](https://github.com/openzigs/onyourleft/issues/7) arrives in
  Phase 3 — but creating the package now would produce an empty manifest, a place for server-shaped
  code to leak into Phase 1, and a `CLAUDE.md` command that runs nothing. **Do not scaffold it, and
  do not write a command that assumes it exists.**
- **No ANT+ anywhere.** Owner decision D2. `packages/sensors` is **BLE only**. No package, directory,
  dependency, permission or string in this project is for ANT+, and `scripts/check-repo-rules.sh`
  rule `SCOPE001` fails the build if one appears in a source tree. Documentation may name ANT+ to
  explain why it is excluded; source may not.
- **No `infra/`.** The original proposal in #22 included one. Phase 1 deploys nothing, and
  deployment is [#17](https://github.com/openzigs/onyourleft/issues/17). An empty `infra/` invites
  premature deployment config that will not survive the architecture decision it precedes.
- **`packages/store` was not in the original proposal** and is added here because
  [#27](https://github.com/openzigs/onyourleft/issues/27) names it. It is under `packages/`, so it is
  Apache-2.0, and the path rule settles that without a debate.
- **`packages/physics` was not in the original proposal** either — it did not exist when #22 was
  written. It is created by [#88](https://github.com/openzigs/onyourleft/issues/88), is
  Apache-2.0, and is pure computation with zero dependency on any rendering, BLE or platform API.

#### Where the boundary between shared and deployment-specific code falls

The local-first architecture (#57) is what decides this, and it moves the line from where a
conventional client/server split would put it.

Because **the client owns the data** and the same computations must run identically on the device in
Phase 1 and on an instance in Phase 3, the shared packages are not "code the client and server
happen to both need". They are **everything that is a function of the data rather than of the
deployment**: units, types, validation, signing and verification, segment matching, and every
analysis computation. That is why `packages/domain` may depend on **no platform API at all** — not
merely no server API. No browser globals, no Node globals, no I/O. A package that imports `window`
or `fs` cannot run on both sides of a federation boundary, and #25 makes that an enforced criterion
rather than a convention.

What stays deployment-specific is narrow by comparison: reachability, indexing, authority and
enforcement. All four are the instance's job and none exists in Phase 1.

### E. Web client: React 19 + Vite 8

- **React 19.2.8** (MIT) with **Vite 8.2.2** (MIT).
- Decided largely by ADR 0008 rather than on its own merits: Capacitor wraps **the same web build**,
  so the client framework choice is simultaneously the mobile client's UI framework, and the recorded
  fallback if the #91 rendering spike fails is React Native — which is only a fallback at all if the
  web client is React. Choosing Svelte or Solid here would be choosing to rewrite the UI on the
  fallback path.
- Vite is also the test runner's host (Vitest shares its transform pipeline), so the two are one
  toolchain rather than two.

**#63 already assumes this**, incidentally: it specifies MapLibre's `addProtocol` must be called
"once per application lifecycle — in React, a root-level effect". This ADR ratifies what that issue
had already presumed, rather than leaving it presumed.

### F. Data layer and migration tool

The original decision table in #22 asked for one data layer. Owner decision D6 split it in two, and
only the first half is decided here.

#### Phase 1, the device — decided: **IndexedDB via Dexie 4.4.5** (Apache-2.0)

Dexie is Apache-2.0, so it sits inside `packages/store` without touching the licence boundary. It
gives a **declarative versioned schema with upgrade hooks**, which is the thing #4 needs a home for:

```
db.version(2).stores({ ... }).upgrade(tx => { ... })
```

The shape of what is stored follows #27 and is not renegotiated here: the **immutable original file**
and the **compactly encoded derived stream set** are `Blob`s; the object stores hold summaries,
indices and references. **Raw per-sample rows are never stored** — that shape is roughly 25× the
size and generates ~57,600 rows for a single two-hour ride.

**The migration tool is Dexie's own versioning. There is no separate migration tool, and that is a
decision rather than an omission** — a standalone migrator would be a second source of truth for the
schema version alongside the one IndexedDB already maintains.

**The rollback story, stated honestly because #4 cannot invent one:** *IndexedDB has no downgrade
event.* `onupgradeneeded` fires only when the version increases; opening a database with a lower
version than the one on disk raises `VersionError`. So "rollback" cannot mean an in-place downgrade,
and any design that assumes it can is wrong. It means:

1. Every migration is written as a **pair of pure functions** over serialisable records, `up` and
   `down`, living beside each other in `packages/store`.
2. `down` is **tested** by applying `up` then `down` to a fixture and asserting the original shape
   returns. That test is what makes the rollback real rather than aspirational, and it is cheap
   because both functions are pure.
3. The **runtime** rollback path is export → downgrade → re-import, which the local-first design
   already requires for other reasons: the athlete's signed files are the canonical artefact, so a
   full rebuild from them is a supported operation, not a disaster procedure.

`idb` 8.0.3 (ISC) was the alternative — thinner and equally permissive. Dexie wins on the one axis
that matters here: it has somewhere for a versioned migration to live, and `idb` would mean writing
that machinery by hand in the package that can least afford a bug.

#### Phase 3, the instance — **deferred to #7**, with constraints recorded

Naming a server database and a server migration tool today would be deciding blind: there is no
server, no schema, and #57's federation shape is not yet ratified. What is recorded now, so #7
inherits it rather than rediscovers it:

- The instance schema must **mirror the local store's shape**, because the same domain code produces
  both. A divergence there means two schemas and a translation layer nobody scoped.
- The chosen migration tool must support **reversible migrations with a tested down path**. This is
  the criterion that eliminates candidates: `drizzle-kit` 0.31.10 (MIT) does not generate down
  migrations, so adopting Drizzle would import the same rollback problem this ADR just solved for
  the device, on the side where it is far more expensive.
- Whatever is chosen must be **permissively licensed or live on the AGPL side**. Under decision B a
  GPL data layer is simply unavailable to anything under `packages/`.

### G. Test runner: **Vitest 4.1.11** + `@vitest/coverage-v8` (both MIT)

- Shares Vite's transform pipeline, so there is one build configuration rather than two, and the test
  environment matches the app's.
- Runs the same specs in Node and in a browser environment, which this program specifically needs:
  `packages/domain` must be provable in a bare environment with **neither a DOM nor a filesystem**
  (#25), while `packages/sensors` needs a browser-shaped environment for Web Bluetooth.
- Vitest 5.0.0 is in release-candidate as of 2026-09-03 (`5.0.0-rc.4`, 2026-08-31). **Ship on 4.1.11**
  and let #23 revisit; a release candidate is not a foundation.

**Watch mode is the default in this ecosystem and must never appear in a gate.** Every documented
command uses the run-once form.

### H. Formatter, linter and typechecker

- **ESLint 10.9.1** (MIT) with **typescript-eslint 8.69.0** (MIT)
- **Prettier 3.9.6** (MIT)
- **`tsc --noEmit`** from TypeScript 6.0.3 as the typechecker
- **ShellCheck** for the scripts under `scripts/`

**Biome 2.5.12 was seriously considered and rejected, on a specific and checkable ground.** Biome is
faster and is one tool instead of two, which is a real advantage. But this project needs its linter
to enforce two things that are not ordinary style rules:

1. **SPDX headers.** `CONTRIBUTING.md` already states this is "linted in CI, so a missing or
   mismatched header fails the build rather than being caught in review".
2. **Import boundaries.** #23 requires that an import from `packages/domain` into a client-only or
   server-only module *fails lint*, and #23's revision adds three more: no platform or network type
   in the shared domain package, no Web Bluetooth type above the transport boundary, and no
   routing-engine type above the `RoutingProvider` interface.

Biome's configuration schema, fetched from `biomejs/biome@main` on 2026-09-03, contains **no
license-header rule of any kind**, and its import restriction is `noRestrictedImports` — a glob
deny-list, not a layered-architecture model. ESLint has published plugins for both:
`eslint-plugin-headers` 1.3.4 (ISC) and `eslint-plugin-boundaries` 7.2.0 (MIT). The project's
requirements are unusual enough that tool speed loses to tool capability.

One Biome capability found during that check is worth handing to #24 rather than discarding: Biome
ships **`noUntrustedLicenses`**, which takes SPDX `allow`/`deny` lists and a `requireFsfLibre` flag.
That is close to exactly the per-package dependency-licence gate #24 needs, and it is usable
standalone without adopting Biome as the linter. **#24 should evaluate it against
`pnpm licenses list --json`** (verified present in pnpm 11.18.0 on 2026-09-03) before writing a
bespoke script.

### I. Package manager and workspace tool: **pnpm 11** workspaces, no monorepo task runner yet

pnpm's default **strict, non-hoisted `node_modules`** is not a performance preference here, it is a
licence control. Under a hoisted layout, a package can `import` a transitive dependency it never
declared, and that dependency's licence was never checked against the package it landed in. Decision
B makes that a licence violation rather than an untidiness. pnpm makes it an error.

Two further reasons: `pnpm licenses list --json` is built in, which #24 needs; and workspace
protocol dependencies (`workspace:*`) make the package graph explicit rather than inferred.

**No Turborepo or Nx.** Both are MIT and both are reasonable, but neither earns its configuration
cost across a handful of packages, and each adds a layer between a contributor and the command that
actually runs. Revisit in #23 only if measured build times demand it.

### J. Real-time transport: deferred to #16, and nothing is scaffolded for it

Unchanged from #22's framing, with one correction from #57 carried forward so it is not
re-litigated: real-time multiplayer compute is **bounded and cheap on a VPS** and unbounded only on
per-request serverless pricing. The layout leaves room for an always-on service as a sibling under
`apps/`; it creates nothing now.

## Alternatives considered

| Decision | Chosen | Rejected | Why |
|---|---|---|---|
| Language | TypeScript | Rust / Go core + TS client | Would fork `packages/sensors` and `packages/fit` into a second language and invalidate ADR 0008's Capacitor choice, whose entire justification is that the web build and leaf packages are shared |
| TypeScript version | 6.0.3 | 7.0.2 (latest) | `typescript-eslint` peer range is `>=4.8.4 <6.1.0`, canary included — adopting 7.x means no type-aware linting |
| Node version | 24 Krypton (Active LTS) | 26 (Current) | 26 does not enter Active LTS until 2026-10-28 |
| Package manager | pnpm 11 | npm workspaces | Hoisted `node_modules` permits undeclared transitive imports, which under decision B is a licence violation; npm also has no `licenses` subcommand |
| Monorepo runner | none | Turborepo, Nx | Not earned at this size; adds a layer between contributor and command |
| Web framework | React 19 | Svelte, SolidJS | ADR 0008's React Native fallback is only survivable if the web client is React |
| Local data layer | Dexie 4.4.5 | `idb` 8.0.3, SQLite WASM + OPFS | `idb` has nowhere for a versioned migration to live; SQLite WASM's OPFS VFS adds cross-origin-isolation headers to a milestone whose whole point is that it needs no infrastructure |
| Server data layer | deferred to #7 | Drizzle + drizzle-kit | `drizzle-kit` does not generate down migrations, and #4 requires tested rollbacks |
| Test runner | Vitest 4.1.11 | Jest, `node:test` | Shares Vite's pipeline; runs the same spec in Node and browser environments, which #25 and #39 both need |
| Coverage gate | mutation rule, no percentage | an 80% line-coverage floor | Line coverage cannot see the defect class this program is most exposed to, and a floor set against an empty repository is routed around |
| Linter / formatter | ESLint + Prettier | Biome 2.5.12 | Biome has no license-header rule and no layered-boundary model; both are hard requirements here |

## Consequences

### What this enables

- Every downstream issue's "the project's own commands" and "the project's coverage gate" now
  resolve to something concrete, in `CLAUDE.md`.
- The licence boundary is checkable by a machine on a bare clone, with no toolchain installed, from
  the moment this ADR merges — not after #23 or #24 land.
- The mobile client (#85) inherits the web build rather than a rewrite, which is what ADR 0008 was
  chosen for.

### What this costs

- **A package that needs a GPL dependency cannot live under `packages/`.** Decision B makes that a
  structural fact. Expect it to bite at least once — #53's routing engines are the likely candidate,
  since OpenRouteService is GPL-3.0 and pgRouting is GPL-2.0.
- **The stack is one major version behind on TypeScript**, on purpose, and that will look like
  neglect to anyone who checks the version without reading this ADR. That is why the re-check command
  is in `CLAUDE.md`.
- **There is no automated coverage floor**, so a PR with weak tests is caught by review of its
  mutation list rather than by a machine. This is the deliberate trade in decision C, and it means
  reviewers must actually read that section of a PR body.

### Constraints this places on other work

1. **#23** scaffolds exactly the layout in decision D and no more. In particular it creates **no
   `apps/api`** and **no ANT+ anything**. It must configure `eslint-plugin-headers` and
   `eslint-plugin-boundaries`, because decisions B and H are otherwise unenforced.
2. **#24** wires `scripts/check-repo-rules.sh` into CI and adds the **dependency-licence** half of
   the boundary gate, which this ADR does not implement because it needs a lockfile. Use only
   standard GitHub-hosted runner labels — larger runners are always charged, even on a public repo.
3. **#25** inherits "no platform API at all", not "no server API".
4. **#27** inherits the Dexie decision and the export → downgrade → re-import rollback path.
5. **#7** owns the Phase 3 data layer, under the three constraints in decision F.
6. **#88** places `packages/physics` under `packages/`, therefore Apache-2.0, therefore no GPL,
   AGPL or NonCommercial dependency — which independently rules out copying from GoldenCheetah
   (GPL-2.0), qdomyos-zwift (GPL-3.0), Auuki (AGPL-3.0) and OpenTrainer (CC BY-NC-4.0).

## Licence check of every dependency named here

Per #22's final acceptance criterion, and read from the npm registry on **2026-09-03** with
`npm view <pkg> version license`. Every one is permissive, so every one is usable in an Apache-2.0
leaf package as well as in the AGPL application.

| Package | Version | Licence | Lands in |
|---|---|---|---|
| `typescript` | 6.0.3 | Apache-2.0 | tooling |
| `eslint` | 10.9.1 | MIT | tooling |
| `typescript-eslint` | 8.69.0 | MIT | tooling |
| `eslint-plugin-headers` | 1.3.4 | ISC | tooling |
| `eslint-plugin-boundaries` | 7.2.0 | MIT | tooling |
| `prettier` | 3.9.6 | MIT | tooling |
| `vitest` | 4.1.11 | MIT | tooling |
| `@vitest/coverage-v8` | 4.1.11 | MIT | tooling |
| `vite` | 8.2.2 | MIT | `apps/web` |
| `react` / `react-dom` | 19.2.8 | MIT | `apps/web` |
| `dexie` | 4.4.5 | Apache-2.0 | `packages/store` |
| `@capacitor/core` | 8.5.1 | MIT | `apps/mobile` (Phase 4) |
| `pnpm` | 11.x | MIT | tooling |

Evaluated and **not** adopted: `@biomejs/biome` 2.5.12 (MIT OR Apache-2.0),
`@stryker-mutator/core` 10.0.0 (Apache-2.0), `idb` 8.0.3 (ISC), `drizzle-orm` 0.45.2 (Apache-2.0),
`drizzle-kit` 0.31.10 (MIT), `turbo` 2.10.12 (MIT), `nx` 23.2.0 (MIT). All permissive; each was
rejected on merit above, not on licence.

## A defect found while writing this, and not fixed here

**ADR numbers collide across three pairs of open issues.** Read from the issue bodies on 2026-09-03:

| Number | Claimed by | Also claimed by |
|---|---|---|
| 0005 | #22 (this ADR) | #57 (local-first architecture) |
| 0006 | #58 (FIT codec licensing) | #27 (stream storage) |
| 0008 | #86 (mobile client architecture) | #60 (tiles and routing) |

This ADR keeps **0005**, because that is what #22 specifies and what the other issues cross-reference.
The already-merged ADR 0001 refers to the local-first decision as "ADR 0002", so #57 is the
collision to resolve, and 0002 is also claimed by #19 (clean-room posture). This is filed as
[#97](https://github.com/openzigs/onyourleft/issues/97) rather than resolved here, because renumbering
another issue's ADR inside this PR would edit acceptance criteria this issue does not own.

`scripts/check-repo-rules.sh` rule `ADR001` now fails the build if two ADR **files** ever share a
number, so the collision cannot survive contact with the repository even if it survives in the issue
tracker.

## Notes

This ADR records engineering decisions, not legal advice. The licence table above reports what each
package **declares**; ADR 0001's cautions about declared-versus-actual licensing
(`react-native-ble-plx` declaring MIT in its manifest and Apache-2.0 in its `LICENSE`; `fit-file-parser`
detected as NOASSERTION despite a verbatim MIT file) apply here too, and #24's dependency gate is
where that discrepancy gets caught mechanically.
