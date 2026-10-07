# CLAUDE.md

Instructions for any agent or contributor working in this repository. Read this before touching
anything. Where it disagrees with a general habit you brought with you, this file wins.

Decisions here are recorded in [`docs/adr/0005-tech-stack.md`](docs/adr/0005-tech-stack.md); the
layout and component boundaries are in [`docs/architecture.md`](docs/architecture.md).

## How these instructions are organised

This file is the **index**: the hard rules and invariants every task needs, the essential
commands, the conventions, and a map. Everything else lives in topic files under
[`docs/agents/`](docs/agents/), moved there verbatim so that a session loads only what it uses.
**Read the topic file the map below names before working in its area** — it has the same
authority as this file. A reference elsewhere in the repository to "CLAUDE.md" with no file
beside it means this index and those topic files together; a section number (§4c, §4f …) is
found through the topic map's second column.

> ⚠️ **HARD RULE — do not add detail to this file.** New rules, gotchas, measurements and history
> go in the matching `docs/agents/` topic file. Only a genuinely new topic gets a one-line entry
> in the topic map below. This file has a **48 KB budget** (49 152 bytes), enforced by `AGENT002`
> in `pnpm run check:repo`: it is loaded into every agent session on every turn, and it grew from
> 97 KB to 659 KB in a month because detail kept being appended here.

### Topic map

| File | Sections | Read it when |
|---|---|---|
| [`docs/agents/commands.md`](docs/agents/commands.md) | §4a | You need a command beyond the handful in the root, want to know what a check prints or enforces (the rule tables: LIC, ADR, SPIKE, REL, XML, SH, ASSET, ENV, DOC, DEP), or the stack table |
| [`docs/agents/project-state.md`](docs/agents/project-state.md) | §4b | You are about to claim something exists, works, or has been verified — Android, sensors, the FIT codec, the store, physics, rooms, sync — or are adding a dependency |
| [`docs/agents/ci.md`](docs/agents/ci.md) | §4c | You touch `.github/workflows/`, add or move a gate, change a timeout or a Vitest case timeout, move something to the nightly job, or read a CI timing |
| [`docs/agents/lint-boundaries.md`](docs/agents/lint-boundaries.md) | §4d | You add an import across packages, touch `eslint.config.js` or a package tsconfig, or work in a platform-free package (`packages/domain`, `physics`, `sensors`, `protocol`, the instance core) |
| [`docs/agents/accessibility.md`](docs/agents/accessibility.md) | §4e | You add or change a route, a view, a design token, a contrast pair, or a `*.a11y.test.*` file |
| [`docs/agents/browser-gate.md`](docs/agents/browser-gate.md) | §4f | You touch anything under `apps/web/browser/`, a Playwright spec or harness page, layout, position, z-index, touch targets, the map, the offline worker, or `playwright.config.ts` |
| [`docs/agents/licence-gates.md`](docs/agents/licence-gates.md) | §4g, part of §3 | You add, remove or bump a dependency, or touch the third-party notices |
| [`docs/agents/route-planning.md`](docs/agents/route-planning.md) | §4i | You work on route planning, the routing interface, or anything that would talk to a routing engine |
| [`docs/agents/wiring-gate.md`](docs/agents/wiring-gate.md) | §4j | You add a module under `apps/web/src/game/`, `ride/`, `offline/`, `net/`, a `*-port.ts`, touch the trainer-command seam in `packages/`, or write `@unwired` / `@test-facing` |
| [`docs/agents/generated-and-cost-gates.md`](docs/agents/generated-and-cost-gates.md) | §4k, §4l | You bump Capacitor, touch the committed Gradle files `cap sync` writes, or edit `docs/cost-model.md` |
| [`docs/agents/web-client.md`](docs/agents/web-client.md) | §2 tree: `apps/web` | You work anywhere in `apps/web` outside `src/game/` — the shell, design system, map, ride screen, recording, offline, privacy, the side camera (`src/camera/`), instance client, rooms, ride analysis, the browser harness pages, or the asset/brand/font tools |
| [`docs/agents/game.md`](docs/agents/game.md) | §4h, §2 tree: `apps/web/src/game` | You work on the trainer game — the simulation, renderer, camera, bicycle, racing line, scenery, terrain, water, settlements, HUD, gradient control, the realistic world — or wonder why it is in `apps/web` and not `apps/mobile` |
| [`docs/agents/mobile.md`](docs/agents/mobile.md) | §2 tree: `apps/mobile` | You work in `apps/mobile` (also read `apps/mobile/README.md` and `apps/mobile/RELEASE.md`) |
| [`docs/agents/instance.md`](docs/agents/instance.md) | §2 tree: `apps/instance` | You work in `apps/instance` — the server, its store, identity, sync, the history index, the room core and its adapters, or a rider's rooms |
| [`docs/agents/packages.md`](docs/agents/packages.md) | §2 tree: `packages/` | You work in any package under `packages/` (and read that package's own README) |
| [`docs/agents/coverage.md`](docs/agents/coverage.md) | part of §5 | You touch the coverage configuration, read a coverage figure, or wonder why a file reads as untested |
| [`docs/agents/store-harness.md`](docs/agents/store-harness.md) | part of §5 | You write or test anything that persists data — a store write path, a migration, a fake |
| [`docs/agents/workout-format.md`](docs/agents/workout-format.md) | part of §6 | You touch workouts, their file format, or an import of somebody else's workout format |
| [`docs/agents/adr-numbering.md`](docs/agents/adr-numbering.md) | part of §7 | You are about to write an ADR and need to know which numbers were taken, by what, and why some were reserved (the next free number itself stays in the root) |
| [`docs/agents/toolchain.md`](docs/agents/toolchain.md) | part of §8 | You bump TypeScript, Node, Vitest or pnpm, add a dependency with an install script, touch `pnpm-workspace.yaml`, or test the recorder's auto-pause |
| [`docs/agents/where-to-look.md`](docs/agents/where-to-look.md) | §9 | You need to find which file answers a question — grep this file for a keyword rather than reading it end to end |

Section numbers are stable, because the rest of the repository cites them: §1, §2 (the packages
table and the top level), §3, §3a, §4 (the essentials), §5, §6, §7 and §8 are in this file, and
every other section, or part of one, is in the file the map names in its second column.

---

## 1. What this is

**On Your Left** — a free, open alternative to Strava + Zwift for cycling: ride tracking, indoor
smart-trainer control, and live sensor capture over **Bluetooth Low Energy**.

The first milestone (v0.1) was deliberately small and **entirely local**: pair a BLE trainer, record
a ride, store it, view it, with no server, no account and no hosting bill. **That client is still the
whole product for a rider who wants nothing more**, and it stays that way.

**There is now a server as well: `apps/instance`**, the one self-hostable instance
([ADR 0036](docs/adr/0036-a-self-hostable-instance-server-now.md), the owner's ruling of 2026-09-28;
[ADR 0037](docs/adr/0037-instance-runtime-hosting-and-transport.md) for how it is built). Accounts
(#6), sync and ingestion (#7), self-hosting (#17) and race rooms (#16) are built on it. Its first
deploy is a Docker image on the owner's own machine behind a Cloudflare Tunnel (#807) — **no hosting
bill is implied**, and no issue may take a paid service as a prerequisite (ADR 0036 D-7).

> ⚠️ **The device is canonical, and a rider with no instance loses nothing.** That is the part of
> the old rule that survives, as ADR 0036 D-3's four invariants: (a) no feature that works with no
> instance today may start to require one — `apps/web/src/privacy/no-network.test.ts` admits
> exactly one module for instance traffic (#777) and nothing else; (b) the device copy is never
> deleted on an instance's confirmation (#47); (c) the instance never becomes the only place a
> rider's data is (#776); (d) nothing the client refuses to send leaves through the instance
> (#777). A change that makes any of the four false is a change to an ADR, not a review note.
>
> ⚠️ **[ADR 0046](docs/adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md),
> accepted 2026-10-07, makes (a) false for AI analysis alone**: a model's write-up of a ride runs
> only on the rider's instance (the owner's rulings of 2026-10-04 and 2026-10-07, #1092, #1093), so
> a rider with no instance loses the write-up and nothing else. Every other feature (a) covers still
> works with no instance, and (b), (c) and (d) hold (ADR 0046 D-14). A reviewer who remembers this
> sentence calling ADR 0046 proposed is reading the old file.
>
> ⚠️ **This section used to forbid a server.** It said *"There is no server in Phase 1. Do not add
> one, do not scaffold `apps/api`"* — owner decision D6, which ADR 0036 supersedes. A reviewer who
> remembers that sentence is reading the old file, and an issue body that repeats it predates the
> ruling (§8, "Read the issue's revision block first"). **The server is `apps/instance`, not
> `apps/api`**: no package of that name exists or is planned.

---

## 2. Repository layout

The whole tree, one entry per directory with what it holds and why, is split by area across
[`docs/agents/web-client.md`](docs/agents/web-client.md), [`docs/agents/game.md`](docs/agents/game.md), [`docs/agents/mobile.md`](docs/agents/mobile.md), [`docs/agents/instance.md`](docs/agents/instance.md), [`docs/agents/packages.md`](docs/agents/packages.md). Read the one for the directory you are working in. The top level:

```
apps/                 AGPL-3.0-or-later, without exception

packages/             Apache-2.0, without exception

docs/
  architecture.md     layout, component boundaries, ADR index
  cost-model.md       what "free to the end user" costs and who pays it (#54) —
                      the inputs with their provenance, what follows from them at
                      three populations, and the line item that dominates at each.
                      ⚠️ Its arithmetic is a GATE, not prose: `check:cost-model`
                      recomputes every figure from the inputs beside it, so
                      editing a rate without the table is a red build. §4l
  adr/                numbered architecture decision records
  spikes/             numbered spike write-ups — a dated measurement, not a decision
  validation/         numbered hardware-validation procedures — a script for one
                      afternoon, with its result tables empty until somebody runs
                      it. Not an ADR and not a spike; it decides nothing

scripts/              dependency-free repository checks; run on a bare clone

.spdx-exempt          the files LIC001/LIC002 do not apply to, one exact path at a
                      time — third-party generator output only, enforced by LIC006

ASSETS.toml           the provenance, licence and SHA-256 of every committed
                      BINARY, which is the one file class no SPDX header can
                      reach and no dependency gate ever sees (#339). Enforced by
                      ASSET001–ASSET005, and ⚠️ discovery walks for binaries by
                      CONTENT rather than by extension, which is what stops a
                      `.gltf` beside a `.glb` reintroducing the hole

.github/
  workflows/rules.yml runs those checks on every pull request — see §4c
  dependabot.yml      weekly version updates, so DEP001 sees a bump before a
                      human does — and the minimumReleaseAge collision it causes
  pull_request_template.md
                      the closing keyword and the mutation list, because §7 and
                      §5 are the two rules a template can actually enforce
  ISSUE_TEMPLATE/     bug and feature, both routing a security report away from
                      a public issue
```

Which packages exist, and when each was created, is in [`docs/agents/packages.md`](docs/agents/packages.md).

| Package | Purpose | Must not depend on |
|---|---|---|
| `packages/domain` | Canonical units and types; every conversion in the program goes through it — the representations and the conversions are tabulated in [`packages/domain/README.md`](packages/domain/README.md). Also signing/verification, analysis, and the **recording engine** (#45), because those must run identically on the device and on an instance. | **Any platform API at all** — no DOM, no Node globals, no I/O, no network types. The recording engine may not read a clock or schedule anything: time arrives as a parameter |
| `packages/fit` | FIT / GPX / TCX decode and encode | Anything server-specific; anything under `apps/` |
| `packages/sensors` | BLE sensor and trainer abstraction (`src/`), and the Web Bluetooth transport (`web-bluetooth/`) | `src/`: **any platform API at all**, and any BLE library. `web-bluetooth/`: every platform global except `navigator`. Web Bluetooth types must not escape above the transport boundary |
| `packages/physics` | Power → speed. Pure computation. | Any rendering, BLE or platform API |
| `packages/protocol` | The race-room wire format: messages, a bounded decoder, the version handshake (#768) | **Any platform API at all**, as `packages/domain` — and any production dependency |
| `packages/store` | Local activity, stream, **recording-checkpoint** and **signed-record** persistence, the device keypair, and its migrations | Anything under `apps/` |
| `apps/instance` | The instance server: HTTP now, rooms later. AGPL-3.0-or-later by path | `apps/web` and `apps/mobile` — and the client must not import it either. Any runtime dependency outside ADR 0037 D-9's table without a row like it |

---

## 3. HARD RULE — the licence boundary is a **path**

> **Everything under `packages/` is `Apache-2.0`. Everything under `apps/` is
> `AGPL-3.0-or-later`. Without exception.**

The boundary *is* the directory, so it is checkable by path rather than by reading manifests. This is
**stricter than [ADR 0001](docs/adr/0001-licence.md) requires** — ADR 0001 permits per-package
declaration — and the extra strictness is deliberate: a path rule cannot be silently mis-declared the
way a manifest field can.

Belt **and** braces, not one instead of the other. Each package still carries:

- its own `LICENSE` file, **and**
- `"license"` in its manifest matching its path.

What this means in practice:

- A **GPL or AGPL dependency anywhere under `packages/`** fails CI. If a package needs one, the code
  moves to `apps/` or the dependency is replaced. There is no third option and no exemption.
- **Permissive** dependencies (MIT, BSD-2/3, Apache-2.0, ISC) are fine anywhere.
- **Weak, file-level copyleft (MPL-2.0) and permissive licences the list above does not name** —
  `BlueOak-1.0.0`, `CC0-1.0`, `MIT-0`, `0BSD` and, since
  [ADR 0016](docs/adr/0016-unlicense.md), `Unlicense` — **are now ruled on, by
  [ADR 0015](docs/adr/0015-dependency-licences.md) D-2**, which discharges the deferral this bullet
  used to carry. They are admitted **in the build-time-only closure under either path**, and in a
  distributed closure **under `apps/` only** — an Apache-2.0 leaf package exists to be droppable
  into someone else's project, and a shipped MPL-2.0 file carries obligations its own `LICENSE`
  does not describe. Six such packages are in the tree as build-time devDependencies. Read on
  2026-09-05 from `pnpm licenses list --json`: `lightningcss` and `lightningcss-darwin-arm64`
  (MPL-2.0), `lru-cache` and `minimatch` (BlueOak-1.0.0), `mdn-data` (CC0-1.0), and
  `@csstools/color-helpers` and `@csstools/css-syntax-patches-for-csstree` (MIT-0). Two more
  arrived with #87's Capacitor install and are the reason ADR 0016 exists: `bplist-parser` and
  `bplist-creator` (`Unlicense`), reached from `@capacitor/cli` through `xcode` and `simple-plist`,
  build-time under `apps/mobile` and in no distributed closure at all. **All of the first six
  reach `packages/*` through Vitest**, not only `apps/web`: an allowlist written against "the MPL
  one is under `apps/`" would scope itself to the wrong tree and pass vacuously — which is exactly
  why ADR 0015 splits on the closure rather than the path alone. Enforced by `DEP001`; verify with
  `pnpm run check:licences` rather than from this paragraph, which ages.
- ⚠️ **An "it lands under `apps/`" argument is checked with `pnpm why <pkg> --recursive`, and a
  clean `require.resolve` probe is not evidence of anything** — why, and what each probe answers, is
  in [`docs/agents/licence-gates.md`](docs/agents/licence-gates.md).
- **`OFL-1.1` is admitted for a committed FONT FILE under `apps/` and for nothing else**, since
  [ADR 0043](docs/adr/0043-ofl-display-typeface.md) (#991): not a picture, not a file under
  `packages/`, not a dependency (`DEP001` is unchanged, so a font *package* is still refused), and
  not `OFL-1.1-RFN`. Enforced by `ASSET004`. A subset stays `OFL-1.1` in `ASSETS.toml` — the font
  keeps its licence, as a CC0 model does.
- Anything **non-OSI** — BUSL, SSPL, CC-BY-NC, "commercial use requires a licence" — fails
  everywhere and needs an ADR before it is even discussed.
- Where a change lands is therefore a **licence question answered before you write the code**, not a
  taste question settled in review.

Every source file carries an SPDX identifier in its opening lines:

```ts
// SPDX-License-Identifier: Apache-2.0        // anything under packages/
// SPDX-License-Identifier: AGPL-3.0-or-later // anything under apps/
```

`LIC001` and `LIC002` scan `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.sh` and — since
[#87](https://github.com/openzigs/onyourleft/issues/87) — `.kt`, `.kts`, `.java`, `.gradle` and
`.xml`, and — since [#430](https://github.com/openzigs/onyourleft/issues/430) — `.py`, because the
realistic world's Blender scripts live under `apps/` (ADR 0026 D-5) and a Python file there passed
with no header at all. The identifier may sit anywhere in the first **five** lines, not only the first, because a
shebang and an XML declaration both legitimately precede it. An `AndroidManifest.xml` therefore
carries `<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->` on line 2.

### 3a. `.spdx-exempt` — the one way out, and why it cannot become a blanket

Some files under `apps/` are **not ours**: `cap add android` writes about twenty of them from
`@capacitor/cli`'s MIT template, launcher artwork included. Stamping `AGPL-3.0-or-later` on those
would be a *worse* misdeclaration than leaving them bare — it claims authorship we do not have, and
it displaces the notice MIT requires to travel with the work. So they are exempt, and the exemption
is a file: [`.spdx-exempt`](.spdx-exempt) at the repository root, one repository-relative path per
line.

⚠️ **The list is the classic vacuous pass, so `LIC006` is what stops it being one.** An entry is
rejected when it names a file that is not there, names a **directory**, is absolute or contains
`..`, or uses **glob syntax**. Exact paths only. Three consequences, all of them the point:

- A generator that writes a file under a **new** name lands *outside* the list and fails
  `LIC001`/`LIC002` until somebody reads it. The list fails closed.
- A **stale** entry — the file was deleted or renamed — is a violation rather than a line nobody
  notices. An exemption that has stopped meaning something stops the build.
- You cannot exempt a tree, or a file you have not written yet.

**The one reason to be on that list is "verbatim output of a third-party generator, whose own
licence notice we reproduce instead".** `apps/mobile/README.md` §2 reproduces Capacitor's. "The
header is awkward here" is not a reason: a file this repository authors *or edits* carries the
header, which is why five of the twenty `cap add` wrote are deliberately absent from the list —
`res/values/styles.xml` since #672, which paints the launch window and the window behind the
WebView in the page's canvas colour.

⚠️ Three Capacitor trees are **pruned rather than exempted** — the copied web build under
`android/app/src/main/assets/public`, `android/app/src/main/res/xml/config.xml`, and
`android/capacitor-cordova-android-plugins/`. `cap sync` regenerates all three and Capacitor's own
nested `.gitignore` keeps them out of the repository, so they are absent from a clean clone and an
`.spdx-exempt` entry naming one would be a `LIC006` violation. `.prettierignore` carries the same
three plus two generated JSON assets, because **Prettier reads only the root `.gitignore`, not a
nested one** — without it `format:check` reports a minified bundle on any machine where a sync has
run, which is a local-only red with no fix a contributor can apply.

---

## 4. Commands

Every command, what it prints and what it enforces is [`docs/agents/commands.md`](docs/agents/commands.md) §4a — **read it
literally**: a command listed there has been run, and nothing else may be quoted as if it had. What
CI runs is [`docs/agents/ci.md`](docs/agents/ci.md) §4c. The ones nearly every change needs (Node 24 from `.nvmrc`,
pnpm 11 from `packageManager` through `corepack enable pnpm`):

```bash
pnpm install --frozen-lockfile
pnpm run check:repo        # the bare-clone script checks and their suites (bash only)
pnpm run format:check
pnpm run lint
pnpm run typecheck
pnpm run test              # run-once Vitest; never bare `vitest`
pnpm run test:a11y         # the accessibility gate (§4e)
pnpm run check:wiring      # the wiring gate (§4j)
pnpm run build             # a green typecheck is not a green build
pnpm run test:browser      # the browser gate (§4f); needs the pinned Chromium
```

Add `check:licences` and `check:notices` when a dependency changes (§4g), `check:capacitor` when
Capacitor does (§4k), `check:cost-model` when `docs/cost-model.md` does (§4l).

**When you run tests, always use the run-once form.** Vitest defaults to watch mode and a watching
process never belongs in a gate. `pnpm run test` is already the run-once form; `pnpm exec vitest` is
not.

> ⚠️ **The workflow's `name:` and its job's `name:` are both `Repository rules`, and `main` requires
> a status check whose context is exactly that string.** Rename either and the required check never
> reports, which makes every subsequent pull request unmergeable — including the one doing the
> renaming. Extend the existing job; do not add a second job for a new gate, because a second job
> reports under a different context and its failure would not block a merge.

---

## 5. The quality gate

`CONTRIBUTING.md` states the pre-PR gate. This section says what each bullet means concretely.

### Coverage: a mutation requirement, not a percentage

> **Every new code path is covered by a test proven to fail without the change.**

Concretely, for each meaningful test you add:

1. **Mutate the implementation** — invert a condition, delete a write, return a constant, skip the
   persist.
2. **Watch the test go red.** Note which test, and why.
3. **Restore the implementation.**
4. **List the mutations in the PR body**, with what went red.

**There is no percentage floor and you must not invent one.** A percentage measures lines executed,
not behaviour asserted: a test that calls a function and asserts nothing scores the same as one that
pins the contract. And a floor set against a repository with no code is red on arrival, which means
it gets routed around rather than met. Coverage is still *reported*, because an untested branch is
worth seeing in review. It is a signal, not a gate. **The mutation list is the gate.**

What the report covers (which trees, and which files run outside it and so read as untested) is
[`docs/agents/coverage.md`](docs/agents/coverage.md).

### Verifying a *compile-time* guarantee

A brand, a nominal type or a `@ts-expect-error` is only a guarantee while its absence breaks the
build. So it is mutation-tested like everything else, and the mutation is specific:

> **Remove the brand from the signature and confirm the suite goes red with
> `TS2578: Unused '@ts-expect-error' directive`.**

That error is the whole mechanism. It means the guard cannot rot silently: if someone later widens
the parameter back to `number`, the directive that documented the guarantee becomes the thing that
fails the build.

**Two ways of "verifying" that do not work, both of which have produced a wrong answer in this
repository:**

1. **Grepping for the type name.** A brand can exist in a file and not be reachable from the
   signature you care about. Presence is not enforcement.
2. **Probing against the working tree.** A guarantee observed in a dirty tree may be supplied by
   uncommitted changes. This is not hypothetical: during #25 an agent died mid-edit leaving branded
   types uncommitted, a probe run in that tree reported type safety, the safety was credited to the
   committed code, and the uncommitted changes were then discarded — closing a correct,
   twice-raised blocking finding as a false positive. **Run `git status` before you probe, and read
   the committed file with `git show HEAD:<path>` whenever a previous review round has been wrong
   about it.**

The same rule binds a *review*: if a fix commit claims a review finding was mistaken, that claim is
unverified until you have re-run it yourself. A dismissal closes the loop, so a wrong dismissal is
never raised again.

### The defect shape to hunt

The dominant failure in this program's persistence work is **a write that reports success while the
read cannot see it**, from four causes: *wrong storage* (it landed in a cache or a different key
prefix), *wrong layer* (acknowledged at the edge, nothing below persisted), *wrong time* (written
after the read, or in a transaction that never committed), *wrong harness* (the test asserted against
the object it just constructed rather than a fresh read).

**Always assert by reading back through the same path a real consumer uses.** Line coverage cannot
see any of these, which is part of why §5 has no percentage in it.

#### The round-trip harness

Use `@onyourleft/store/testing` rather than writing the naive round trip: how, and the four
things to know before you do, are in [`docs/agents/store-harness.md`](docs/agents/store-harness.md).

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

---

## 6. Rules that constrain what you may write, before you write it

### ANT+ is out of scope permanently — owner decision D2

**No package, directory, dependency, permission or string in this project is for ANT+.**
`packages/sensors` is **BLE only**. There is no browser path (Web Bluetooth is BLE by definition), no
iOS path at all, the FE-C spec is behind an ANT+ Alliance login, and the ANT+ Shared Source License
forbids redistributing source containing the network key.

`scripts/check-repo-rules.sh` rule `SCOPE001` fails the build if ANT+ appears in a source tree.
Documentation may name it **to explain why it is excluded**; source may not.

⚠️ **It scans package manifests too, and until #15 it did not.** The rule walked the SPDX header
extension list — `.ts .tsx .js .jsx .mjs .cjs .css .sh .kt .kts .java .gradle .xml` — which covers
**code** by extension and **permission** through an `AndroidManifest.xml`, and left the third word
of the sentence above unenforced: `ant-plus` or `@abandonware/ant-plus` in a `package.json`
`dependencies` block was not a source file and passed a rule whose whole job is to stop the scope
quietly returning. A second loop now scans every `package.json` under `packages/` and `apps/`,
`node_modules` pruned. It is the same word-bounded pattern, so `antenna`, `Levenshtein` and
`participant` still do not match; [spike 0002](docs/spikes/0002-background-recording.md) §"Criterion
5" records the hole and how it was found.

### Never paste Garmin FIT SDK source into a public issue, PR or commit

The Garmin FIT Protocol License Agreement **§4 declares the Licensed Technology to be Garmin
Confidential Information**. This repository is public and its history is permanent, so a paste cannot
be undone by a later commit.

**The licence text itself is public** on GitHub
(`garmin/fit-javascript-sdk/LICENSE.txt`) and **is safe to quote** — quoting the terms is how the
decision gets recorded. Quoting the *SDK source* is not. See
[#58](https://github.com/openzigs/onyourleft/issues/58).

### The names of the load metrics are registered trademarks — ours are our own

Checked for [#76](https://github.com/openzigs/onyourleft/issues/76), which flagged the question and
recorded that it had **not** been verified. It has been now:

- **NORMALIZED POWER** — USPTO registration **4450848**, serial **85913880**, owner
  TRAININGPEAKS, LLC, filed 2013-04-24, registered 2013-12-17.
- **"Training Stress Score"** and **"Intensity Factor"** are reported registered to the same owner
  (Peaksware / TrainingPeaks), and all of them passed to **Garmin** with its acquisition of
  TrainingPeaks on 2026-07-22.
- ⚠️ **`CTL`, `ATL` and `TSB` are reported registered too**, which #76 did not flag. That landed on
  [#77](https://github.com/openzigs/onyourleft/issues/77)'s chart, which uses its own plain names
  instead: **`base`** (the slow average), **`recent`** (the fast one) and **`freshness`** (the gap).
- **"Functional Threshold Power" / "FTP" could not be established either way.** `packages/store`
  calls the setting `thresholdPower`, which is plainly descriptive, so nothing turns on it.

⚠️ **The primary registers could not be reached from this environment** — `tmsearch.uspto.gov`,
`trademarks.justia.com`, `trademarkia.com` and `trainingpeaks.com` are all blocked by the egress
proxy — so the registration numbers above come from search-result summaries rather than from a
record read directly. Re-verify before relying on them for anything beyond "pick a different name".

**So this project uses its own plainly descriptive names**, which is the trivially avoidable path:
`effortWeightedPower`, `thresholdFraction`, `rideLoad`, `base`, `recent`, `freshness`. **Do not
rename them to the familiar ones**
in code, in a UI label, in a metric key or in a column header. The *formulae* are unaffected — they
are published (Allen & Coggan, 2006) and a trademark protects a name, not arithmetic.

### The workout file format is this project's own — ADR 0017 answered it

This project's own format, not the de facto one: [ADR 0017](docs/adr/0017-workout-file-format.md)
decides it, and why, with the four things about `packages/domain/src/workout/format.ts` that are
decisions rather than details, is [`docs/agents/workout-format.md`](docs/agents/workout-format.md).

### Reading prior art is fine. Copying from it binds this project's licence.

**Every mature prior-art project in this space except `incyclist/devices` (MIT) is GPL-2.0, GPL-3.0
or AGPL-3.0:**

| Project | Licence |
|---|---|
| GoldenCheetah | GPL-2.0 |
| qdomyos-zwift | GPL-3.0 |
| Auuki | AGPL-3.0 |
| OpenTrainer | CC BY-NC-4.0 — **not open source under the OSD** |
| `incyclist/devices` | MIT |

**Reading them to check a protocol detail or a formula is fine.** Copying code from them **binds this
project's licence** — and under §3 it is fatal to anything under `packages/`, because none of those
licences may appear there at all.

Facts are not copyrightable: a physical constant or an equation from a published paper (Martin et al.
1998, for instance) carries no such restriction. An implementation of it does.

**You are being told this before you borrow, not in review.**

### Security-sensitive classes

`SECURITY.md` is authoritative. The classes that most often show up as an ordinary-looking bug:

- **Location data.** GPS traces reveal where people live. Anything that exposes a private activity,
  defeats a privacy zone, or leaks location through an API response, an export, a cache **or an error
  message** is in scope. The error-message half is ADR 0004 decision D and it is now applied, not
  merely stated: **a message about a coordinate names the field and the constraint and never the
  value**, and every other quantity keeps its value because for those the number is the diagnostic.
  `packages/domain/src/unit-error.ts` applies it from the field label (#104) and
  `packages/store/src/stream-codec.ts` applies it per channel, where it also covers `altitude`,
  which is a coordinate only when it is reported beside one. The rule binds **every layer that
  formats a coordinate into a string** — a log line, a toast, a crash report, a Phase 3 error body —
  not only those two files.
- **Cross-athlete exposure.** Any query matching on an entity id **without also filtering on the
  owning athlete**. This passes every single-athlete test in the suite — which is why
  `packages/store/src/activity-store.scoping.test.ts` exists and why its enumeration is *derived*
  from the store rather than written down. Adding a read that takes `owner` and forgetting to
  filter on it is a red test; adding one and forgetting the test is also a red test. The same file
  header says what it cannot cover.
- **Sensor data is untrusted input.** Malformed or hostile GATT payloads come from a device that may
  not be what it claims.
- **Activity file parsing.** FIT/GPX/TCX come from user-supplied files. Malformed input must produce
  an error — never memory corruption, a crash loop, resource exhaustion or code execution. **XXE in
  GPX and TCX is specifically in scope.**
- **Trainer control is a safety issue, not only a security one.** A smart trainer applies physical
  resistance to a person who is pedalling. Anything that lets an attacker set resistance or an ERG
  target is high severity.

Never open a public issue with vulnerability details — use GitHub private vulnerability reporting.

---

## 7. Conventions

- **Sign off every commit.** `git commit -s`. Mandatory, DCO 1.1, no CLA. A commit without a
  `Signed-off-by:` line cannot be merged.
- **Branches**: `feature/issue-{number}-{slug}`, from `main`. (Observed convention — `#18` used
  `feature/issue-18-licence`.)
- **PRs** reference the issue they resolve, and carry the mutation list from §5.
- **A closing keyword must be correct when the pull request is OPENED.** GitHub creates the
  issue link at open time, and **editing the body afterwards does not remove it** — neither
  does overriding the squash commit message with `gh pr merge --body`. An issue linked by an
  `Closes #N` that was later softened to `Refs #N` still closes on merge, and the close event
  carries no commit id, which is the only outward tell. This cost #42, #43 and #31, each of
  which was closed against an explicit, written decision not to close it. If a PR must not
  close an issue — because an acceptance criterion is deferred, or needs hardware nobody in
  the loop has — **write `Refs #N` in the body you open with**. If you discover it too late,
  the honest repair is to file the remainder as its own issue and say on the closed one what
  happened; reopening leaves a mostly-done issue open for something that is really separate
  work. Prose that merely *mentions* a keyword counts too: #29 was closed by `Resolves #29`
  inside an ADR table cell.
- **ADRs**: `docs/adr/NNNN-kebab-case.md`, with **Status, Context, Decision, Consequences** —
  and since [#416](https://github.com/openzigs/onyourleft/issues/416) that is `ADR004` rather than
  prose. ⚠️ A reviewer who remembers this sentence being unenforced is reading the old file:
  deleting an ADR's `- **Status**: Accepted` line used to leave `check-repo-rules.sh` reporting
  clean at exit 0. Numbers are unique and `ADR001` enforces it. Check `docs/architecture.md` for which numbers are taken
  **and which are claimed by open issues** before you pick one. **The next free number is 0047.**
  Which numbers were taken, by which issue and when, and the reservations, are the record in
  [`docs/agents/adr-numbering.md`](docs/agents/adr-numbering.md); read it before picking one.
- **Spikes**: `docs/spikes/NNNN-kebab-case.md`. A spike write-up is **not an ADR and does not
  decide anything** — it is a dated measurement that an ADR or an issue may then rest on, and it
  ages the way a measurement does. `scripts/check-repo-rules.sh`'s `ADR003` and `ADR004` are scoped
  to `docs/adr/` and do not apply — a spike has no Status and no Decision to be missing. ⚠️ **The
  numbering rules DO apply since [#493](https://github.com/openzigs/onyourleft/issues/493), and a
  reviewer who remembers the whole `ADR00*` family being out is reading the old file**: `SPIKE001`
  and `SPIKE002` are siblings of `ADR001` and `ADR002` rather than a widening of them, because the
  remedy differs. Do not renumber one, and do not edit a finding out of one: if a later run
  contradicts it, that is a second write-up. **A colliding number is resolved by the file that has
  not merged taking the next free one** — which is why `SPIKE001`'s message says that and `ADR001`'s
  does not.
- **Changelog**: there is **no `CHANGELOG.md` and no changelog convention** in this repository. Do
  not add one as a drive-by; if a release needs one, that is its own issue.
- **Versions**: do not bump any version unless the issue asks for it.
- **Do not reformat files you did not come to change.** A drive-by format buries the real diff.

### Protected paths — do not edit without an ADR

| Path | Why |
|---|---|
| `LICENSE` | Byte-identical AGPL-3.0 text. Editing licence text is itself a licensing problem. SHA-256 recorded in ADR 0001. |
| `LICENSES/Apache-2.0.txt` | Same, for Apache-2.0. |
| `COPYRIGHT` | Copyright is held by "The On Your Left contributors", each retaining their own. ⚠️ Since [ADR 0025](docs/adr/0025-app-store-additional-permission.md) it also carries the **GNU AGPL §7 additional permission** for the Apple App Store and Google Play. That paragraph is a licence grant in the copyright holders' name: **rewording it is a legal act, not an edit**, and widening it needs every contributor's consent. |
| `docs/adr/*.md` | An ADR is amended by a **new** ADR that supersedes it, not by editing it in place — **with one narrow exception, [ADR 0013](docs/adr/0013-adr-amendments.md)**: a dated entry may be **appended** to an `## Amendments` section at the end of the file, recording that a statement of fact in the body has become false. The body is still never edited, `Status` does not change, and **reversing a decision still needs a superseding ADR**. Rule `ADR003` checks the shape; it cannot check that the change was an append, so a reviewer reading a `docs/adr/` diff asks the one question that matters — **does any hunk touch a line that already existed?** |

`.gitignore` un-ignores `.env.example` while ignoring `.env` and `.env.*`. Honour that: a committed
template with placeholder values, real secrets never. **Never `git add -f` past an ignore rule** —
secret scanning with push protection is on, and a pushed commit is permanent regardless of what a
later commit deletes.

---

## 8. Known gotchas

The toolchain pins and their reasons (TypeScript 6.0.3 not 7.x, Node 24 until 2026-10-28,
Vitest 4.1.11), pnpm's 24-hour `minimumReleaseAge` (pin an older version; never add a
`minimumReleaseAgeExclude`), install scripts and `allowBuilds` in `pnpm-workspace.yaml` (a
security-relevant file on every fork pull request), and why a recorder fed only power
auto-pauses are in [`docs/agents/toolchain.md`](docs/agents/toolchain.md).

**CI runners: use only the standard labels** — `ubuntu-latest`, `windows-latest`, `macos-latest`.
Standard GitHub-hosted runners are free and unlimited on public repositories, and this repository is
public. **Larger runners (`4-core`, `8-core`, any `larger` label) are ALWAYS charged, even on a
public repo.** It is a one-word diff that produces an invoice, and nothing in the CI output warns
you.

**`pull_request_target` is banned.** It receives secrets and is not subject to the first-time
contributor approval gate. It is the single most common Actions compromise vector, and this is a
public repository where anyone can propose a workflow change. **Enforced, not merely stated** — rule
`WF001` fails the build if it appears anywhere under `.github/workflows/`. A documented ban is not a
gate. Prose may name it in order to ban it; the rule is scoped to workflow files for that reason.

**Pin every third-party action to a full commit SHA**, never a tag. A tag is mutable.

**Web Bluetooth constraints are product constraints, not bugs.** No Safari (desktop or iOS), no
Firefox, anywhere, ever — `caniuse` `usage_perc_y` was **76.46% when read on 2026-09-02** (a
browser-share figure that drifts monthly; re-read it rather than quoting this), so roughly a quarter
of visitors cannot use the core feature. `requestDevice()` needs a **user gesture per device** and cannot be called
programmatically; there is **no silent reconnect that is shippable in 2026** — `getDevices()`,
`watchAdvertisements()` and Persistent Device Permissions all exist behind `chrome://flags`, with
`watchAdvertisements` absent on ChromeOS and Linux entirely, so the product conclusion is unchanged:
do not build automatic reconnection; it is unavailable in Web Workers; and there is no
background operation. **Plan for ~3 concurrent connections**, not 7. Do not design a UI that hides
any of this.

**And `'bluetooth' in navigator` is not the feature detect.** Chrome on Linux exposes the object and
WebBluetoothCG's own status file says *"Linux is partially implemented and not supported"*. #40's
`readAvailability` requires both `requestDevice` and `getAvailability` to be callable and treats a
`getAvailability` that throws as `unsupported`. **Web Bluetooth also specifies no timeout for any
operation, and `gattserverdisconnected` fires only for a link that was up** — so a device switched
off during `gatt.connect()` produces no event and no rejection. #40's queue bounds every operation
for that reason; anything else awaiting a GATT promise must too.

**Read the issue's revision block first.** Most issue bodies in this repository predate owner
decisions D2, D5 and D6 (D6 itself since superseded by ADR 0036), and several state things that are
now false — including "#18 is still open" (it is merged), "there is no server" (there is:
`apps/instance`) and package layouts that include `apps/api` or ANT+. The quoted revision block at the
top of an issue **supersedes its body**.

---

## 9. Where to look

The question-to-file table is [`docs/agents/where-to-look.md`](docs/agents/where-to-look.md) — grep it for a keyword rather
than reading it end to end.
