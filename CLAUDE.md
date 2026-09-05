# CLAUDE.md

Instructions for any agent or contributor working in this repository. Read this before touching
anything. Where it disagrees with a general habit you brought with you, this file wins.

Decisions here are recorded in [`docs/adr/0005-tech-stack.md`](docs/adr/0005-tech-stack.md); the
layout and component boundaries are in [`docs/architecture.md`](docs/architecture.md).

---

## 1. What this is

**On Your Left** — a free, open alternative to Strava + Zwift for cycling: ride tracking, indoor
smart-trainer control, and live sensor capture over **Bluetooth Low Energy**.

The first milestone (v0.1) is deliberately small and **entirely local**: pair a BLE trainer, record a
ride, store it, view it. **No server, no account, no hosting bill.** A server arrives in Phase 4 with
[#7](https://github.com/openzigs/onyourleft/issues/7).

> ⚠️ **There is no server in Phase 1.** Do not add one, do not scaffold `apps/api`, and do not write
> a command, config or test that assumes one exists. This is owner decision D6 and it is the single
> most common thing to get wrong here, because most of this program's issue text was written before
> it.

---

## 2. Repository layout

```
apps/                 AGPL-3.0-or-later, without exception
  web/                browser client — the Phase 1 product (#48-#51)
    src/a11y/           the accessibility gate: rules, routes, contrast (#48) — see §4e
    src/design/         design tokens, theme.css and the primitives (#48)
    src/recording/      the recorder: engine + durable checkpoints + recovery (#46)
    src/ride/           the live ride screen: its state machine, panels and trainer wiring (#49)
    src/shell/          the hash route table, the router hook and AppShell (#48)
    src/support/        browser-capability detection and its notice (#48)
    src/views/          one component per route (#48)
  mobile/             Capacitor shell wrapping the same web build (#85; Phase 3)

packages/             Apache-2.0, without exception
  domain/             units, core types, validation, signing, analysis (#25)
    recording/          the recording session state machine and stream merge (#45)
  fit/                FIT / GPX / TCX codec (#29-#32)
  sensors/            sensor abstraction and BLE transport (#39-#44) — BLE only
    src/                the transport-agnostic abstraction; no platform API at all
    protocol/           the GATT profile clients (#41, #42) — service UUIDs, payload decoding
    web-bluetooth/      the browser transport (#40) — the one place a BluetoothDevice exists
  physics/            cycling power/speed model, Martin et al. 1998 (#88)
  store/              local activity, stream and recording-checkpoint store, and the
                      round-trip harness (#26-#28, #46)

docs/
  architecture.md     layout, component boundaries, ADR index
  adr/                numbered architecture decision records

scripts/              dependency-free repository checks; run on a bare clone

.github/
  workflows/rules.yml runs those checks on every pull request — see §4c
```

**`apps/web`, `packages/domain`, `packages/sensors`, `packages/fit` and `packages/store` exist.**
The first two were created by [#23](https://github.com/openzigs/onyourleft/issues/23) along with the
workspace, the toolchain and the lockfile, `packages/sensors` by
[#39](https://github.com/openzigs/onyourleft/issues/39), `packages/store` by
[#26](https://github.com/openzigs/onyourleft/issues/26) and `packages/fit` by
[#107](https://github.com/openzigs/onyourleft/issues/107). **`packages/physics` and `apps/mobile` do
not** — each is created by the issue that owns its content (§4b), from `packages/domain` as the
template. The layout is fixed here
because ~30 sub-issues reference it by name, and the workspace globs and lint boundaries already
cover the paths, so a package arrives inside the rules rather than beside them.

| Package | Purpose | Must not depend on |
|---|---|---|
| `packages/domain` | Canonical units and types; every conversion in the program goes through it — the representations and the conversions are tabulated in [`packages/domain/README.md`](packages/domain/README.md). Also signing/verification, analysis, and the **recording engine** (#45), because those must run identically on the device and on an instance. | **Any platform API at all** — no DOM, no Node globals, no I/O, no network types. The recording engine may not read a clock or schedule anything: time arrives as a parameter |
| `packages/fit` | FIT / GPX / TCX decode and encode | Anything server-specific; anything under `apps/` |
| `packages/sensors` | BLE sensor and trainer abstraction (`src/`), and the Web Bluetooth transport (`web-bluetooth/`) | `src/`: **any platform API at all**, and any BLE library. `web-bluetooth/`: every platform global except `navigator`. Web Bluetooth types must not escape above the transport boundary |
| `packages/physics` | Power → speed. Pure computation. | Any rendering, BLE or platform API |
| `packages/store` | Local activity, stream and **recording-checkpoint** persistence, and its migrations | Anything under `apps/` |

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
- **Weak, file-level copyleft (MPL-2.0, EPL) and permissive licences this list does not name** —
  `BlueOak-1.0.0`, `0BSD` — are **not ruled on yet**, and three are already in the tree as build-time
  devDependencies: `lightningcss` (MPL-2.0) and `minimatch` (BlueOak-1.0.0). Nothing is violated —
  neither is GPL or AGPL, and neither is linked into a distributed artefact. Note that `lightningcss`
  reaches **`packages/domain`** through Vitest, not only `apps/web`: an allowlist written against
  "the MPL one is under `apps/`" would scope itself to the wrong tree and pass vacuously. The
  per-package dependency-licence allowlist in
  [#24](https://github.com/openzigs/onyourleft/issues/24) decides these explicitly. Verify with
  `pnpm licenses list --json` rather than from this paragraph, which ages.
- Anything **non-OSI** — BUSL, SSPL, CC-BY-NC, "commercial use requires a licence" — fails
  everywhere and needs an ADR before it is even discussed.
- Where a change lands is therefore a **licence question answered before you write the code**, not a
  taste question settled in review.

Every source file carries an SPDX identifier in its opening lines:

```ts
// SPDX-License-Identifier: Apache-2.0        // anything under packages/
// SPDX-License-Identifier: AGPL-3.0-or-later // anything under apps/
```

---

## 4. Commands

**Read this section literally.** Commands are split into ones that work **today** and ones that do
not exist yet. A documented command nobody has run is the most expensive kind of wrong, because every
downstream issue's acceptance criteria depend on these.

### 4a. Works today — executed and observed to succeed on 2026-09-05

**Bare clone — bash and coreutils only, no install, no network:**

```bash
# Enforce the repository rules that are checkable by path.
# Exits 0 clean; exits 1 listing each violation by rule id.
bash scripts/check-repo-rules.sh

# Test the checker itself. Fixture-driven; 47 cases.
bash scripts/check-repo-rules.test.sh

# Verify the licence texts are byte-identical to the canonical ones, by
# reproducing the two SHA-256 digests recorded in docs/adr/0001-licence.md.
# The digests are read out of the ADR rather than duplicated in the script, and
# a required digest that is missing fails — checking nothing is not a pass.
bash scripts/check-licence-hashes.sh

# Test that checker. Fixture-driven; 16 cases.
bash scripts/check-licence-hashes.test.sh

# Every environment variable the code reads is listed in .env.example.
# Exits 1 naming the file and the variable. A missing .env.example also fails —
# a template that is not there documents nothing.
bash scripts/check-env-example.sh

# Test that checker. Fixture-driven; 21 cases.
bash scripts/check-env-example.test.sh

# The same two digests, printed for reading by eye.
shasum -a 256 LICENSE LICENSES/Apache-2.0.txt
```

**The workspace — needs Node 24 and pnpm 11, and the first run needs the network.**
Executed in this order on a clean clone on 2026-09-03, from nothing installed to green:

```bash
# Node 24 "Krypton", read from .nvmrc so the runner and you cannot disagree.
# With nvm: `nvm install` then `nvm use`. Any other version manager is fine;
# what matters is that `node --version` reports v24.
nvm install && nvm use

# pnpm 11, from the `packageManager` field in package.json rather than a global
# install, so the version is the one the lockfile was written by. Corepack ships
# with Node. The first `pnpm` command after this downloads that exact version,
# and in an interactive terminal corepack asks before it does — answer yes, or
# set COREPACK_ENABLE_DOWNLOAD_PROMPT=0. CI sets neither because corepack does
# not prompt when CI=true.
corepack enable pnpm

# Install. --frozen-lockfile is what CI runs: it fails rather than quietly
# resolving something the committed lockfile does not describe.
pnpm install --frozen-lockfile

# Prettier. `format:check` reports and exits 1; `format` rewrites.
pnpm run format:check
pnpm run format

# ESLint 10 + typescript-eslint, type-aware. Also enforces the SPDX header and
# the package boundaries — see §3 and §4d.
pnpm run lint

# tsc --noEmit, per package, because each package is allowed a different
# platform surface. Runs the root config too.
pnpm run typecheck

# Vitest, run-once. Never `vitest` on its own: watch mode does not belong in a
# gate, and a watching process in an agent session never exits.
pnpm run test

# The same run with a coverage report. There is no percentage threshold and you
# must not add one — see §5.
pnpm run test:coverage

# The accessibility gate (#48): every route in apps/web is rendered into a DOM
# and audited, and the design tokens are checked for WCAG 2.2 AA contrast. This
# is a SUBSET of `pnpm run test` — the same files, run again under a name that
# says what broke. Unlike coverage it DOES gate: criterion 4 of #48 is that a
# violation fails the build. See §4e.
pnpm run test:a11y

# tsc --noEmit followed by `vite build`, for apps/web. A green typecheck is not
# a green build: the bundler resolves imports the typechecker only reads types
# from, so run this before claiming a change compiles.
pnpm run build

# One package at a time, which is how you check a single package's harness.
# `@onyourleft/sensors`' and `@onyourleft/fit`'s typechecks each run TWO
# programs — see §4d — and both have to pass; the second is the one that
# enforces the platform boundary.
pnpm --filter @onyourleft/domain run test
pnpm --filter @onyourleft/fit run test
pnpm --filter @onyourleft/sensors run test
pnpm --filter @onyourleft/store run test
pnpm --filter @onyourleft/web run test

# Regenerate the #29 synthetic FIT fixture corpus from its generator. It is
# DETERMINISTIC: running it on a clean tree leaves `git status` clean, which is
# what makes a corpus that is committed and generated the same corpus. It writes
# only under `packages/fit/fixtures/corpus`, and prints the byte budget it is
# inside. Run it after changing the generator, never to "fix" a failing test.
pnpm --filter @onyourleft/fit run fixtures:generate

# All six bare-clone script checks in one command.
pnpm run check:repo

# Render coverage per package as Markdown. Reads coverage/coverage-summary.json,
# so it runs AFTER `test:coverage`. Prints; never gates — see §5. Exits non-zero
# only when the report is missing or unparseable, because an empty table reads
# like good news.
node scripts/coverage-summary.mjs

# Its tests. Needs Node, so it is deliberately NOT in `check:repo`, which is the
# bare-clone set. 17 cases.
bash scripts/coverage-summary.test.sh
```

**Need a tool installed, or the network** — these work, but not on a bare clone:

```bash
# Requires shellcheck (brew install shellcheck / apt install shellcheck).
# Preinstalled on the standard Ubuntu runner, so CI runs it without installing
# anything — but the runner's shellcheck is older than a typical developer's
# (0.9.0 on ubuntu-24.04), and the two can disagree. CI prints its version.
shellcheck scripts/*.sh

# Requires npm and network access.
# Check whether typed linting has caught up with TypeScript 7 yet (see §8).
npm view typescript-eslint peerDependencies.typescript
```

`scripts/check-repo-rules.sh` enforces:

| Rule | Fails when |
|---|---|
| `LIC001` | a source file under `packages/` is missing an SPDX header, or declares one other than `Apache-2.0` |
| `LIC002` | a source file under `apps/` is missing an SPDX header, **or** declares one other than `AGPL-3.0-or-later` |
| `LIC003` | a package manifest declares a licence its path does not permit |
| `LIC004` | a package under `packages/` **or `apps/`** has no `LICENSE` file of its own |
| `SCOPE001` | ANT+ is referenced anywhere in a source tree (see §6) |
| `WF001` | `pull_request_target` appears in a `.github/workflows/` file (see §8) |
| `ADR001` | two ADRs share a number |
| `ADR002` | an ADR filename is not `NNNN-kebab-case.md` |
| `ADR003` | an ADR's `## Amendments` section is not the last section, or there are two of them, or an entry does not open with a bold ISO date — see §7 and [ADR 0013](docs/adr/0013-adr-amendments.md) |

`scripts/check-licence-hashes.sh` enforces one more, separately because it hashes files rather than
reading paths:

| Rule | Fails when |
|---|---|
| `LIC005` | a licence text no longer matches the SHA-256 digest ADR 0001 records for it, **or** ADR 0001 no longer records a digest for one of them, **or** a leaf package's own `LICENSE` is not byte-identical to the canonical text its path requires |

`scripts/check-env-example.sh` enforces one more, separately because it reads code rather than paths:

| Rule | Fails when |
|---|---|
| `ENV001` | a source file under `apps/` or `packages/` reads an environment variable `.env.example` does not list, **or** `.env.example` is missing |

The stack the workspace is built on is decided in ADR 0005 and is not open:

| Concern | Decision |
|---|---|
| Language | TypeScript **6.0.3** — *not* 7.x, see §8 |
| Runtime | Node **24 "Krypton"** (Active LTS until 2026-10-20) |
| Package manager | **pnpm 11** workspaces |
| Web client | React 19 + Vite 8 |
| Test runner | Vitest 4.1.11 + `@vitest/coverage-v8` |
| Linter / formatter | ESLint 10 + typescript-eslint + Prettier 3 |
| Typechecker | `tsc --noEmit` |
| Local data layer | IndexedDB via **Dexie 4.4.5** |
| Migration tool | **Dexie's own versioned schema** — no separate migrator; see §5 |
| Monorepo task runner | none |

**When you run tests, always use the run-once form.** Vitest defaults to watch mode and a watching
process never belongs in a gate. `pnpm run test` is already the run-once form; `pnpm exec vitest` is
not.

### 4b. Does **not** exist yet — and, below the line, what does

> ⛔ **None of the bullets in the first list runs today.** Do not copy these into a PR description
> as though you had run them, and do not add them to a CI workflow before the issue that owns them
> lands. The ⛔ stops at "What exists, and what each is **not** yet" — everything under that heading
> is in the tree, and its commands are in §4a.

- **`apps/mobile` and `packages/physics` do not exist.** The workspace globs (`apps/*`,
  `packages/*`) will pick each up the moment it appears, and the boundary and header rules already
  apply to its path. They are created by the issues that own their content:
  [#85](https://github.com/openzigs/onyourleft/issues/85) and
  [#88](https://github.com/openzigs/onyourleft/issues/88). Copy `packages/domain` as the template: a
  manifest, a `LICENSE`, a `tsconfig.json`, a `vitest.config.ts` and a test.
- **A per-package dependency-licence gate.** Nothing yet checks that a dependency's *own* licence is
  permitted under the path it lands in — only that the manifests and headers declare the right
  thing. `pnpm licenses list --json` exists and is unused. Second half of
  [#24](https://github.com/openzigs/onyourleft/issues/24).
- **A coverage gate demonstrated to fail.** Coverage is reported and nothing enforces it, which is
  §5's deliberate design; what #24 still owes is the demonstration that the report is real.
- **`react-router` and the rest of the runtime dependency list in ADR 0005.** See the dependency
  paragraph below the next heading for what *is* installed.
- **`apps/api`, or anything else server-shaped.** Not "not yet" — not in Phase 1 at all. Owner
  decision D6.

#### What exists, and what each is **not** yet

Reconciled by [#110](https://github.com/openzigs/onyourleft/issues/110) once
[#107](https://github.com/openzigs/onyourleft/issues/107),
[#39](https://github.com/openzigs/onyourleft/issues/39) and
[#26](https://github.com/openzigs/onyourleft/issues/26) had all landed, rather than by each of the
three editing this list on its own branch and conflicting with the other two.

  - **`packages/sensors/src`** ([#39](https://github.com/openzigs/onyourleft/issues/39)) holds the
    interfaces, `createDeviceSession`, `planCapabilitySources` and the simulator (#44).
    **`packages/sensors/web-bluetooth`** ([#40](https://github.com/openzigs/onyourleft/issues/40))
    holds the browser transport: the `DeviceId → device/server/service/characteristic` map, the
    global GATT operation queue, `createWebBluetoothTransport`, and a scripted Web Bluetooth stack
    at `@onyourleft/sensors/web-bluetooth/testing`. It holds **no profile** — not one service UUID
    and not one byte of payload. ⚠️ Since [#49](https://github.com/openzigs/onyourleft/issues/49)
    it also holds `fitness-machine-channel.ts`, the **production `FitnessMachineChannel`** and the
    only place in the program that writes to a GATT characteristic. That write must be
    `writeValueWithResponse`; `gatt.ts` declares the unacknowledged sibling *and never calls it* so
    that a swap is a red test rather than a silent regression, and
    `fitness-machine-channel.test.ts` is the test. `transport.openFitnessMachine(id)` returns the
    channel together with the Supported Power Range, the Supported Resistance Level Range and the
    Fitness Machine Feature bits, all **read from the device** — a setpoint bounded by anything
    else is the hard-coded assumption #43's criteria forbid.
    **`packages/sensors/protocol`** ([#41](https://github.com/openzigs/onyourleft/issues/41),
    [#42](https://github.com/openzigs/onyourleft/issues/42),
    [#43](https://github.com/openzigs/onyourleft/issues/43)) is where the profiles are: Heart Rate
    (`0x180D`), Cycling Speed and Cadence (`0x1816`), Cycling Power (`0x1818`) and the Fitness
    Machine Service (`0x1826`), exported as `@onyourleft/sensors/protocol`. FTMS is split in two
    because it is the one that also **writes**: `fitness-machine.ts` reads Indoor Bike Data
    (**`0x2AD2`** — the issue body's `0x2AD3` is Training Status and is wrong), the Feature
    characteristic and the two supported ranges; `fitness-machine-control.ts` drives the control
    point, which applies physical resistance to a person who is pedalling and is bounded before it
    writes rather than after — see `packages/sensors/README.md` §"Trainer control". ⚠️
    `protocol/` is a **third** directory rather than part of either neighbour, and it is
    platform-free: `src/` bars a service UUID and a `DataView` of GATT payload by its own rule, and
    a decoder inside `web-bluetooth/` would make the native stacks (#15) depend on the browser
    adapter, when the promise is that it is "the same parser, unchanged". `DataView` is an
    ECMAScript built-in, which is why a payload decoder can be platform-free at all.
  - **`packages/fit`** holds the **synthetic fixture corpus and its generator**
    ([#107](https://github.com/openzigs/onyourleft/issues/107)), the **FIT activity file decoder**
    ([#30](https://github.com/openzigs/onyourleft/issues/30)) in `src/decode/` as
    `decodeFitActivity(bytes)`, the **FIT activity file encoder**
    ([#31](https://github.com/openzigs/onyourleft/issues/31)) in `src/encode/` as
    `encodeFitActivity(activity)`, and **GPX 1.1 / TCX v2 import and export**
    ([#32](https://github.com/openzigs/onyourleft/issues/32)) in `src/xml/` as
    `decodeGpx` / `encodeGpx` / `decodeTcx` / `encodeTcx`. Per
    ADR 0006 all of them are written from the published protocol documentation and from the #29
    fixtures — **nothing carrying Garmin's terms may enter this package**, and R2 requires the
    provenance of every profile number to be recorded per message.
    The codec's record is
    [`packages/fit/README.md`](packages/fit/README.md) §3 and the corpus's is
    `packages/fit/fixtures/README.md` §5; they are **deliberately separate and independently
    derived**, and a test asserts the two tables agree so that a disagreement is visible rather
    than shared. ⚠️ Like `packages/store` it is not one program: `tsconfig.json` admits
    `@types/node` for the generator under `tools/`, and `tsconfig.platform-free.json` compiles
    `src/` alone with `lib: ["ES2024"]` and `types: []`. A `TextDecoder` in `src/` is therefore a
    compile error, which is why the codec carries its own UTF-8 reader **and its own XML reader**.
    ⚠️ **`fit-file-parser` 5.0.2 (MIT) is now a devDependency of `packages/fit`**, imported from
    one test file (`tools/fixture-corpus/third-party-acceptance.test.ts`) and never from `src/`. It
    is the independent third-party FIT reader #31's acceptance criterion requires, adopted under
    that issue's revision block, which struck "validate with the SDK's own checker" under
    ADR 0006 R1. `packages/fit/README.md` §1 records the reconciliation; that README's declaration
    no longer claims the package depends on nothing named `fit-file-parser`, and a reviewer
    expecting the old sentence should read the new one.
    ⚠️ **`src/xml` refuses a `<!DOCTYPE` outright rather than configuring a parser to be safe.**
    That is not a setting to be revisited: a DTD is the only place an XML document can declare an
    entity, so refusing the declaration is what closes XXE and billion-laughs together, and the
    only entity references resolved at all are the five XML predefines. Do not swap in a
    general-purpose XML parser without reading `packages/fit/README.md` §7 first.
    ⚠️ **`tools/fuzz/` runs a seeded corpus fuzz inside `pnpm run test`**
    ([#128](https://github.com/openzigs/onyourleft/issues/128)) — about six seconds, no CI job of
    its own. Two things about it are easy to get wrong and are recorded in
    `packages/fit/README.md` §5: it **repairs the FIT checksums on half its mutations**, because a
    file CRC is verified before any record is read and a fuzzer that skips the repair tests
    `bad-file-crc` tens of thousands of times and never reaches the record loop; and its assertions
    go **beyond the error type**, because `subarray` clamps rather than throwing, so a bounds bug
    in this decoder produces no exception to watch for. Change the seed or the budget deliberately,
    and re-run the M16 mutation in `src/decode/container.ts` afterwards — that is the mutation the
    harness exists to catch and the only thing that says it still can.
  - **`packages/store`** holds athletes, activities, laps and privacy zones
    ([#26](https://github.com/openzigs/onyourleft/issues/26)) with the migration `up`/`down`
    contract, **per-second streams** at schema version 2
    ([#27](https://github.com/openzigs/onyourleft/issues/27), decided in
    [ADR 0011](docs/adr/0011-stream-storage.md)), **recording checkpoints** at schema version 3
    ([#46](https://github.com/openzigs/onyourleft/issues/46) — a session header plus append-only
    chunks, packed but deliberately **not** compressed, recovered as a contiguous prefix that stops
    at the first hole; `packages/store/README.md` §"Recording checkpoints" records why) and the
    **round-trip persistence harness**
    ([#28](https://github.com/openzigs/onyourleft/issues/28)) at `@onyourleft/store/testing` — see
    §5. Devices and gear are still additive object stores in a later schema version. ⚠️ It is
    **not** platform-isolated the way `packages/domain` is — it uses `indexedDB` and
    `CompressionStream`, so its `tsconfig.json` includes the DOM lib, and `eslint.config.js`'s
    `no-restricted-globals` block stays scoped to `packages/domain`.

**And the dependencies that exist.** The toolchain,
React 19, React DOM, Vite, — since #26 — `dexie` 4.4.5 and `fake-indexeddb` 6.2.5 (both
Apache-2.0, both zero-dependency, both under `packages/store`) and — since #40 —
`@types/web-bluetooth` 0.0.21 (MIT, zero-dependency, types only, a devDependency of
`packages/sensors`) and — since #31 — `fit-file-parser` 5.0.2 (MIT, a devDependency of
`packages/fit`, whose closure is `buffer` MIT → `base64-js` MIT and `ieee754` BSD-3-Clause) are
installed; **nothing else from ADR 0005's runtime list is**, `react-router` included. Add each in
the issue that first needs it, after checking its licence against the
directory it lands in (CONTRIBUTING.md).

### 4c. What CI runs, and what it deliberately does not

[`.github/workflows/rules.yml`](.github/workflows/rules.yml) runs on every pull request and on every
push to `main`. It runs **exactly** the §4a commands and nothing else: the six bare-clone script
checks, `shellcheck scripts/*.sh`, then `pnpm install --frozen-lockfile`, `format:check`, `lint`,
`typecheck`, `test:coverage`, `bash scripts/coverage-summary.test.sh`, `test:a11y` and `build` — then
publishes the coverage table to the run summary and uploads the HTML report as an artefact.
Those last two carry `if: always()` and cannot fail the job: the run where coverage moved
unexpectedly is exactly the one whose table you want, and a reporting step that can fail a
build is a percentage floor arriving by the back door, which §5 forbids. If CI ever needs a step this file does not list, **this
file is wrong and gets fixed in the same PR**; CI must not accumulate private knowledge, because
that is how a contributor's local green becomes CI's red with no explanation.

> ⚠️ **The workflow's `name:` and its job's `name:` are both `Repository rules`, and `main` requires
> a status check whose context is exactly that string.** Rename either and the required check never
> reports, which makes every subsequent pull request unmergeable — including the one doing the
> renaming. Extend the existing job; do not add a second job for a new gate, because a second job
> reports under a different context and its failure would not block a merge.

It runs on `ubuntu-latest`, holds `permissions: contents: read`, and pins `actions/checkout` and
`actions/setup-node` to full commit SHAs with the `gh api` command that produced each in a comment.
All of that is §8 rules rather than preference. Node comes from `.nvmrc` and pnpm from
`packageManager` via corepack, so the runner cannot drift from a contributor. There is deliberately
**no dependency cache**: it would mean another action to pin and a writable cache in every job's
dependency path, to save seconds on a workspace this size.

**Still absent from CI**, and owned by the second half of
[#24](https://github.com/openzigs/onyourleft/issues/24): the per-package dependency-licence
allowlist, and a coverage gate demonstrated to fail.

Repository-level security scanning — CodeQL default setup, secret scanning with push protection, and
Dependabot alerts and security updates — is **already enabled on the repository** and needs no
workflow step. Adding one would duplicate it.

### 4d. The boundaries the linter enforces

`eslint.config.js` is not only style. Three of its blocks are the enforcement half of decisions that
would otherwise be documented and unenforced, which is the gap this project keeps closing:

| Enforced by | What fails |
|---|---|
| `headers/header-format` | a `.ts`/`.tsx` file whose first line is not the SPDX identifier its directory requires. Duplicates `LIC001`/`LIC002` on purpose: the script covers file types ESLint never parses and runs with no toolchain, the lint rule runs in the editor |
| `boundaries/dependencies` | an import from `packages/*` into `apps/*`, in either the relative (`../../../apps/web/src/...`) or the workspace (`@onyourleft/web`) spelling. Dependencies point one way |
| `@typescript-eslint/no-restricted-imports` in `packages/domain`, `packages/sensors/src`, `packages/sensors/protocol` and `packages/sensors/web-bluetooth` | naming **any** Node builtin — the list is derived from `builtinModules`, not typed out, so `events`, `util` and `stream/promises` fail exactly as `node:fs` does — or `react`, `react-dom`, `vite` or `dexie`, or a BLE library |
| `no-restricted-globals` in `packages/domain`, `packages/sensors/src` and `packages/sensors/protocol` | naming a DOM global (`window`, `document`, `navigator`, `location`, `history`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`), a Node global (`process`, `Buffer`, `__dirname`, `__filename`, `global`, `require`) or a network global (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Request`, `Response`, `Headers`). This one **is** a named list; the closure is the typechecker below |
| `no-restricted-globals` in `packages/sensors/web-bluetooth` | naming any of the same list **except `navigator`** — the adapter is the transport boundary and `navigator.bluetooth` is the one platform API it exists to reach. The exception is derived by subtracting one name from the list above rather than restating it, so the two cannot drift |

`packages/domain/tsconfig.json` narrows `lib` to `ES2024` and sets `types: []`. That is the closure
the lint list cannot be: with no ES library entry and no `@types` package in scope, *any* name from
outside ES2024 is a compile error, `fetch` and `WebSocket` included, and so is `import … from
'events'` (`Cannot find name 'events'`). The lint rules are the fast duplicate — they fire in the
editor with a message that says why, seconds before a typecheck finishes — and they are the half that
survives the paragraph below.

> ⚠️ **That closure is conditional, and it was silently broken until #23's review.** `types: []`
> suppresses the automatic `@types` lookup; it does **not** stop a `/// <reference types="node" />`
> inside a `.d.ts` the package imports. `packages/domain/vitest.config.ts` used to
> `import { defineConfig } from 'vitest/config'`, which pulled Vite's declarations — and through them
> all of `@types/node` — into the same program as `src/`, so `process`, `Buffer` and `fetch` all
> typechecked cleanly inside the package that forbids them. That file now **imports nothing** and
> exports a plain object, and says so at the top. **Any import added to a file inside
> `packages/domain`'s tsconfig program can reopen this**, which is why the ESLint rules are not
> redundant with it: check both gates with a probe file, never one.

`packages/fit` narrows through a second tsconfig for the same reason and with the same shape:
`tsconfig.json` is the wide program, because it has to cover `tools/` — the fixture generator, which
reads and writes files and legitimately needs `@types/node` — and
**`tsconfig.platform-free.json` is the one that enforces**, compiling `src/` alone with
`lib: ["ES2024"]` and `types: []`. That is why the codec carries its own UTF-8 reader and its own
XML reader: a `TextDecoder` in `src/` is a compile error. `pnpm --filter @onyourleft/fit run
typecheck` runs both, and reading only the first is how the boundary would be believed absent.

`packages/sensors/src` (#39) is isolated the same way and for a stricter reason: its interfaces have
to be satisfied **unchanged** by Web Bluetooth, CoreBluetooth and the Android BLE APIs, so an
interface that can name a browser type has already chosen one of the three. It carries one
restriction `packages/domain` does not — a BLE-library denylist, because a library is not a global
and neither the `lib` narrowing nor the globals list can see one.

⚠️ **`packages/sensors` narrows through a *second* tsconfig, not its main one**, for the reason
`packages/fit` does. ESLint's project service resolves a file to the nearest `tsconfig.json`, so
that file has to cover the whole package — including `web-bluetooth/`, which needs the DOM — or lint
reports "not found by the project service" instead of anything useful. So
`packages/sensors/tsconfig.json` is the wide program (`lib: ["ES2024", "DOM"]`,
`types: ["web-bluetooth"]`) and **`packages/sensors/tsconfig.platform-free.json` is the one that
enforces**: `src/` **and `protocol/`**, `lib: ["ES2024"]`, `types: []`. `pnpm run typecheck` runs
both, and a `navigator` in either fails the second while passing the first. Reading only the first
is how this would be believed to be broken; reading only the second is how a lint config change
would be missed.

> ⚠️ **`no-restricted-imports` `group` patterns are matched with gitignore semantics**, where a
> pattern containing no slash matches *any* path segment. The derived Node-builtin list therefore
> matched `@onyourleft/domain` on the builtin named `domain`, and **no workspace package could
> import the units package** until #39 added a `'!@onyourleft/*'` exemption to that group.
> `packages/domain` never hit it because it does not import itself. The same collision waits for any
> future `@onyourleft/<builtin-name>`.

#40's Web Bluetooth adapter needed the DOM, so it arrived in its own directory
(`packages/sensors/web-bluetooth`) with its own entry in `eslint.config.js`, and
`packages/sensors/src` stayed platform-free. #41 and #42's protocol clients arrived on the same
terms in `packages/sensors/protocol` — a third entry, and `platformIsolation` verbatim, because they
name a wire format but no platform. The routing work (#70) goes in the same file when it lands.

### 4e. The accessibility gate

Added by [#48](https://github.com/openzigs/onyourleft/issues/48), whose fourth acceptance criterion
is that *automated accessibility checks run on every route in CI and fail the build on a violation*.
It lives in [`apps/web/src/a11y/`](apps/web/src/a11y/) and it is **the one gate in this repository
with a real pass/fail line in it** — coverage deliberately has none (§5), and this one is not a
percentage.

| File | What it decides |
|---|---|
| `audit.ts` | fourteen structural rules over a rendered DOM — an unnamed control, a control not in the tab order, a broken heading order, a dangling ARIA reference, a positive `tabindex`, and so on. `tabbableElements` is the tab-order model the keyboard tests rest on |
| `audit.test.ts` | a violating fixture for **every** rule, plus an assertion that every rule in `ACCESSIBILITY_RULES` has one. A rule added without a failing fixture fails the build |
| `routes.a11y.test.tsx` | renders every entry in `shell/routes.ts` and audits it. A route added to the table is audited without anyone editing this file |
| `contrast.a11y.test.ts` | WCAG 2.2 AA contrast for every declared token pair, and that every token appears in a pair |
| `theme.a11y.test.ts` | that `theme.css` carries the same values as `design/tokens.ts`, in both directions |
| `index-html.a11y.test.ts` | `lang`, and that the viewport meta does not block zoom |
| `degradation.a11y.test.tsx` | that a chart which throws is replaced by its table and does not take the page with it |

**There is no `axe-core` and adding one is a decision, not a tidy-up.** It is MPL-2.0, which §3
records as *not ruled on yet* and [#24](https://github.com/openzigs/onyourleft/issues/24)'s to
decide; and its highest-value rule — colour contrast — is inert under a headless DOM, because jsdom
performs no layout and resolves no custom property. That is why contrast is checked at the tokens
instead.

⚠️ **The suite loads no stylesheet, so an element hidden by CSS alone looks focusable to
`tabbableElements`.** The shell therefore hides nothing that way: the skip link is moved off-screen
with a `transform` and stays focusable. Hiding a control with `display: none` in a stylesheet would
make this checker wrong rather than make the control safe.

⚠️ **jsdom updates `location.hash` when a fragment link is clicked and then does not fire
`hashchange`**, which the HTML standard requires and every browser does. `testing/mount.tsx`
supplies the missing event. Do not "fix" that by making the router set the hash itself in a click
handler — that would be changing shipping behaviour to suit a test double, and it costs the
browser's own middle-click and open-in-new-tab handling.

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

**What the report covers**, decided in [#110](https://github.com/openzigs/onyourleft/issues/110) and
recorded in `vitest.config.ts` beside the patterns: `packages/*/src/**`, `packages/*/*/src/**` (the
adapter directories that need a platform library — `packages/sensors/web-bluetooth/src` today) and
`apps/*/src/**`. The `packages/fit/tools/` tree is **deliberately outside it**: it is the #29 fixture
generator, authoring-time code that produces a committed artefact and ships in nothing. Its tests do
run — `packages/fit/vitest.config.ts` includes `tools/**/*.test.ts` — and the corpus tests assert
its output; including it in the report would only mix a generator's coverage into a codec's
denominator. #107's observation that the report listed `apps/web` alone at 125 statements predated
the second pattern and is no longer true: all five packages appear.

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

#### The round-trip harness — use it rather than writing the naive version

[`@onyourleft/store/testing`](packages/store/src/testing/index.ts) (#28) exists so that no later
issue has to remember all four causes. Its primitive is **write through the public path → close
every connection → open a fresh one → read through the public path → compare**, and its `read()`
*cannot* be served by the handle that wrote: it discards every open handle before it opens another.

```ts
import {
  createStoreHarness, seedAthletes, seedRide, streamSetFor, assertStreamSetRoundTrip, ATHLETE_A,
} from '@onyourleft/store/testing';

const harness = createStoreHarness();          // its own database, per test
await seedAthletes(harness);                   // three athletes, always — see below
const ride = await seedRide(harness, ATHLETE_A);

// The whole round trip in one call:
await assertStreamSetRoundTrip(harness, streamSetFor(ride));

// Or the two halves, for anything else:
const read = await harness.roundTrip(
  async (store) => store.putActivity(ride),
  async (store) => store.getActivity(ATHLETE_A, ride.id),
);

await harness.destroy();                       // in afterEach
```

Four things to know before you use it:

- **The fixtures carry three athletes, not two.** Two cannot distinguish "scoped correctly" from
  "returns everything the requester is connected to". The scoping *assertions* that need the third
  belong with #34 in Phase 3; the fixture is there now because retrofitting it is a rewrite.
- **`seedRide` and `streamSetFor` take an owner**, so the write-path scoping case is as short to
  write as the read-path one. #26's review found that a two-athlete *read* fixture is blind to a
  write-path hole entirely.
- **The assertions throw `RoundTripFailure`; they are not `expect` calls.** That is what lets the
  same assertion body run green against the real store and red against a fake, which is the only
  honest proof that a harness works.
- **`fakes.ts` holds four deliberately broken stores** — one that writes to memory, one that
  commits to the real database under a key the reader does not use, one that fills every gap
  with a zero, and one whose every second flush is acknowledged and never written.
  `harness.test.ts` runs the same round trip against each and requires it to go red. **If you add a
  write path to `packages/store`, the `PersistentStore` type fails to compile until the fakes
  account for it.** That is deliberate: it is what stops a write path shipping with nothing proving
  the harness catches its failure — and it is how the fourth fake arrived, with #46's checkpoint
  write.

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

### Never paste Garmin FIT SDK source into a public issue, PR or commit

The Garmin FIT Protocol License Agreement **§4 declares the Licensed Technology to be Garmin
Confidential Information**. This repository is public and its history is permanent, so a paste cannot
be undone by a later commit.

**The licence text itself is public** on GitHub
(`garmin/fit-javascript-sdk/LICENSE.txt`) and **is safe to quote** — quoting the terms is how the
decision gets recorded. Quoting the *SDK source* is not. See
[#58](https://github.com/openzigs/onyourleft/issues/58).

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
  owning athlete**. This passes every single-athlete test in the suite.
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
- **ADRs**: `docs/adr/NNNN-kebab-case.md`, with **Status, Context, Decision, Consequences**. Numbers
  are unique and `ADR001` enforces it. Check `docs/architecture.md` for which numbers are taken
  **and which are claimed by open issues** before you pick one. ⚠️ **`0012` is reserved and not
  free** — it belongs to [#64](https://github.com/openzigs/onyourleft/issues/64)'s data-licence
  decision, which is the destination ADR 0001's *Data* deferral had no number for
  ([#119](https://github.com/openzigs/onyourleft/issues/119)). The next free number is **0014**.
- **Changelog**: there is **no `CHANGELOG.md` and no changelog convention** in this repository. Do
  not add one as a drive-by; if a release needs one, that is its own issue.
- **Versions**: do not bump any version unless the issue asks for it.
- **Do not reformat files you did not come to change.** A drive-by format buries the real diff.

### Protected paths — do not edit without an ADR

| Path | Why |
|---|---|
| `LICENSE` | Byte-identical AGPL-3.0 text. Editing licence text is itself a licensing problem. SHA-256 recorded in ADR 0001. |
| `LICENSES/Apache-2.0.txt` | Same, for Apache-2.0. |
| `COPYRIGHT` | Copyright is held by "The On Your Left contributors", each retaining their own. |
| `docs/adr/*.md` | An ADR is amended by a **new** ADR that supersedes it, not by editing it in place — **with one narrow exception, [ADR 0013](docs/adr/0013-adr-amendments.md)**: a dated entry may be **appended** to an `## Amendments` section at the end of the file, recording that a statement of fact in the body has become false. The body is still never edited, `Status` does not change, and **reversing a decision still needs a superseding ADR**. Rule `ADR003` checks the shape; it cannot check that the change was an append, so a reviewer reading a `docs/adr/` diff asks the one question that matters — **does any hunk touch a line that already existed?** |

`.gitignore` un-ignores `.env.example` while ignoring `.env` and `.env.*`. Honour that: a committed
template with placeholder values, real secrets never. **Never `git add -f` past an ignore rule** —
secret scanning with push protection is on, and a pushed commit is permanent regardless of what a
later commit deletes.

---

## 8. Known gotchas

**TypeScript is pinned to 6.0.3, and 7.0.2 is the current release.** This looks like neglect and is
not. `typescript-eslint` declares `typescript: ">=4.8.4 <6.1.0"` — its canary too, checked
2026-09-03 — so adopting 7.x means shipping a workspace whose linter cannot do type-aware analysis.
Re-check with `npm view typescript-eslint peerDependencies.typescript` and move when the range
admits 7.x.

**Node 26 is not the answer yet.** It enters Active LTS on **2026-10-28**. Until then Node 24
"Krypton" is the line. Move on the date, not before.

**Vitest 5 is in release candidate.** Ship on 4.1.11.

**pnpm 11 refuses a lockfile entry published in the last 24 hours.** `minimumReleaseAge` is a
default, not something this repository configured, and it is a supply-chain control worth keeping:
the window it closes is the one where a compromised release is published and pulled again. It bites
when you pin the newest version of something: `pnpm install` writes the entry, then fails the
lockfile policy check on the next run with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`. **Pin a version
that is more than a day old rather than adding a `minimumReleaseAgeExclude`** — the exclusion turns
the protection off for that package permanently. Rewriting a lockfile that already contains a
too-new entry needs `pnpm clean --lockfile` first; deleting `pnpm-lock.yaml` alone is not enough,
because the copy under `node_modules/.pnpm` is read too.

**An install script is a decision, recorded in `pnpm-workspace.yaml`.** pnpm 11 does not run
dependency build scripts until `allowBuilds` names them, and leaves `pnpm install` exiting 1 until
each is answered `true` or `false`. Answer it rather than deleting the entry: an install script runs
arbitrary code with your privileges before any lint or test gate sees the package. The one entry
today is `unrs-resolver`, answered `false` — it ships prebuilt native bindings as platform optional
dependencies, so the script has nothing to do.

**That block is therefore a security-relevant file on every fork pull request.** CI installs from the
*fork's* `pnpm-workspace.yaml`, so flipping an entry to `true` and adding a dependency is what makes
that dependency's install script run on the runner. The controls that keep it acceptable are all
already in place — `pull_request` rather than its target-context counterpart, `permissions: contents:
read`, no secrets in the job, `persist-credentials: false`, and the first-time-contributor approval
gate — and the residual exposure is runner CPU and outbound network, which is inherent to running an
install in CI at all. Read the block anyway when reviewing a fork's pull request.

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

**A recorder fed only power auto-pauses, and that is correct.** `apps/web/src/recording/channels.ts`
counts speed and cadence as movement and deliberately **not** power: an ERG-mode trainer holds a
power target while the rider is off the bike getting a drink, and a crank-based meter reports the
torque of a bike being wheeled. A test that feeds power alone and expects a sixty-second ride gets
ten seconds of moving time and fifty of automatic pause — which cost an afternoon to diagnose the
first time. Feed a movement signal, or pass `autoPause: null`.

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
decisions D2, D5 and D6, and several state things that are now false — including "#18 is still open"
(it is merged) and package layouts that include `apps/api` or ANT+. The quoted revision block at the
top of an issue **supersedes its body**.

---

## 9. Where to look

| Question | File |
|---|---|
| Why these tools, and what was rejected | [`docs/adr/0005-tech-stack.md`](docs/adr/0005-tech-stack.md) |
| Layout, boundaries, ADR index | [`docs/architecture.md`](docs/architecture.md) |
| Why AGPL + Apache, and what it forecloses | [`docs/adr/0001-licence.md`](docs/adr/0001-licence.md) |
| Sign-off, SPDX, adding a dependency | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| What CI runs on every pull request | [`.github/workflows/rules.yml`](.github/workflows/rules.yml) and §4c |
| What counts as a vulnerability, and how to report it | `SECURITY.md` (added by [#96](https://github.com/openzigs/onyourleft/pull/96)) |
| Which lint rule enforces which boundary | [`eslint.config.js`](eslint.config.js) and §4d |
| Why a package's tsconfig narrows `lib` and `types` | `packages/domain/tsconfig.json` and §4d |
| The canonical unit for a quantity, and the conversion into it | [`packages/domain/README.md`](packages/domain/README.md) |
| What an error message may say about a coordinate, and what it may not | [`packages/domain/README.md`](packages/domain/README.md) §"A coordinate message names the field and the constraint, never the value", [ADR 0004](docs/adr/0004-privacy-and-location.md) decision D |
| Where a FIT profile number came from, and what the decoder does with a bad file | [`packages/fit/README.md`](packages/fit/README.md) §1–§5 |
| Which GPX/TCX schema versions are targeted, what each format loses, and how XXE is refused | [`packages/fit/README.md`](packages/fit/README.md) §7 |
| How a ride is recorded, checkpointed and recovered, and the stated data-loss bound | [`packages/store/README.md`](packages/store/README.md) §"Recording checkpoints", `apps/web/src/recording/recorder.ts`, `README.md` §"If the tab closes mid-ride" |
| What the live ride screen may claim about a trainer, and why a stale metric shows no number | `apps/web/src/ride/controller.ts`, `apps/web/src/ride/metrics.ts`, `apps/web/src/ride/TrainerPanel.tsx` |

<!-- Last updated: 2026-09-05 by delivery:code-issue resolving #49 (the live ride screen, and the production FTMS control channel) -->
