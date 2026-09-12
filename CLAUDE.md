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
    browser/            the browser gate (#63) — the one place a real browser runs;
                        a harness page driving the map adapter, and its Playwright
                        spec. See §4a and §4f. Since #111 it also holds
                        capture.html, which is NOT a gate: it is the tool a
                        person opens with a trainer in front of them, built by
                        the same second Vite config so it can never ship
    src/a11y/           the accessibility gate: rules, routes, contrast (#48) — see §4e
    src/analysis/       zones and duration personal bests (#78) — the port, the one
                        place a threshold default is substituted, the bounded
                        library read, and the wording
    src/design/         design tokens, theme.css and the primitives (#48)
    src/efforts/        the effort-history screen's reads and its stub (#67) — the
                        read budget, and where a sample index comes from
    src/detail/         the ride detail view's data layer (#50) — the read budget, the
                        gap-preserving downsampler, the SVG trace and the
                        privacy-zone trim that says what a shared copy contains
    src/library/        the activity library's row model, its port and its stub (#62)
    src/map/            the ride map (#63) — the basemap configuration and the proof
                        it reaches no other origin, the GeoJSON conversion, the
                        once-per-application protocol registration, and the one
                        file that names MapLibre
    src/recording/      the recorder: engine + durable checkpoints + recovery (#46),
                        and since #14's fourth criterion the step that turns a
                        finished recording into an activity — the write order,
                        and why the checkpoint is discarded last; and since #212
                        the rides this device is still holding — the two kinds
                        of leftover, and the one that is never offered back
    src/ride/           the live ride screen: its state machine, panels and trainer
                        wiring (#49), and since #14 the workout lifecycle — one
                        clock for the ride and the workout, and the panel that
                        will not offer a control the trainer would refuse
    src/privacy/        the boundaries where data leaves the athlete's control
                        (#34) — the two directions a payload can face, the walk
                        that finds a coordinate in a field nobody declared, and
                        the registry checked against the files on disk
    src/routes/         saved routes (#73) — the store port and its read budget,
                        the edit decision and its concurrency token, what a
                        shared copy of a route contains, and the export a rider
                        copies to a head unit (#74)
    src/routing/        planning a route (#70, #71, #72) — the draft and the
                        legs an edit makes stale, undo over whole drafts, what
                        a half-drawn route keeps across a reload, the elevation
                        profile and where its numbers came from. ⚠️ The
                        RoutingProvider INTERFACE is in packages/domain; there
                        is no engine adapter here and §4i says why
    src/segments/       the segment store port and the create form's pure core (#64),
                        and the resumable matcher sweep over the library (#66)
    src/shell/          the hash route table, the router hook and AppShell (#48)
    src/support/        browser-capability detection and its notice (#48), and
                        since #85 the one question that decides which BLE
                        transport this build uses (§4h)
    src/validation/     the recording BluetoothPort (#111) — the wrapper that turns
                        an afternoon with real hardware into committable evidence,
                        and the two things it deliberately does not write down
    src/transfer/       file import and export (#51) — the batch importer, the
                        1 Hz sample grid, the export writer, and since #15 the
                        one fixture both clients encode, which is how "the
                        mobile client's FIT output is byte-identical to the
                        web's" is asserted without a phone (§4h); and since #35
                        the account export — every ride plus the manifest of
                        what an activity file cannot carry, the bound on one
                        run, and the key half that is never written; and the
                        erase that is its pair, whose two lists say what goes
                        and what it cannot reach
    src/views/          one component per route (#48)
    src/workout/        the workout control loop (#14) — the one place the
                        player's decisions meet a trainer's control point,
                        driven end to end against the #44 simulator
    src/workouts/       the workout library and builder (#14) — the read
                        budget, the row model that quotes no watts, the one
                        place a typed percentage becomes a share, and since
                        #202 saving one to a file and reading one back
    src/game/           the trainer game (#85) — the fixed-tick simulation the
                        renderer cannot influence, the road corridor built from
                        #89's profile, the quality ladder for a throttling
                        phone, the scene, and the one file that names three.
                        ⚠️ Here rather than in apps/mobile because
                        capacitor.config.ts ships apps/web/dist — see §4h
    src/game/hud/       the ride HUD (#94) — the eight fields, the dropped
                        sensor that is not a zero, and the wake lock
    src/game/sensors.ts the four metric states the ride controller reports,
                        mapped to the three things a HUD renders
    src/game/ghost-source.ts
                        which attempt a rider races, and how a ghost's distance
                        is integrated when no distance channel exists
  mobile/             Capacitor shell wrapping the same web build (#85, #87)
    android/            the generated Android project, plus the connectedDevice
                        foreground service and its plugin bridge — MIT template
                        output, whose provenance and licence obligation are
                        apps/mobile/README.md §2 and whose exemptions are .spdx-exempt
    src/android/        reading a manifest as a document — NOT merging one (#87)
    src/index.ts        what the shell offers the client that runs inside it —
                        the reason this package is no longer an island (§4h)
    src/ble/            the Capacitor transport against #39's interface,
                        unchanged, the one file that names BleClient, and the
                        Android side of the FTMS control point — the write
                        that is acknowledged, and the sibling that is not
    src/permission/     what a rider is told when Bluetooth will not work (#87)

packages/             Apache-2.0, without exception
  domain/             units, core types, validation, signing, analysis (#25)
    analysis/           the power-duration curve and the critical-power fit (#75),
                        the training zones (#78), the per-ride load metrics
                        (#76) and the fitness/fatigue series (#77) — whose
                        NAMES are a trademark question, see §6
    identity/           the record format, the canonical bytes, verification (#61)
    recording/          the recording session state machine and stream merge (#45)
    route/              the route profile (#89) — elevation and gradient as a
                        function of distance, the three windows it is built
                        from, and the loop wrap
    routing/            the engine-agnostic routing interface (#70) — the
                        named product options a rider chooses, and the one
                        place an engine's numbers are checked before anything
                        believes them. Here rather than in a client because
                        ADR 0010 D-4 says the interface outlives the transport
    pacer/              the bot pacer (#92) — the pacing rule at a fixed 75 kg,
                        and the gap to the rider as two unwrapped odometers
    trainer/            the gradient setpoint driver (#90) — where the rider is
                        on the route, the grade there, and whether it is worth
                        a write yet
    ghost/              racing your own previous attempt (#93) — a replay of
                        recorded distance against recorded time, never a
                        re-simulation, and no athlete id anywhere in it
    workout/            structured workouts (#14) — the model, the timeline a
                        player looks up rather than replays, the ERG
                        spiral-of-death rule, the player itself, which emits an
                        intent and writes nothing, and since #202 the file
                        format: one key that is both identity and version, an
                        unknown key refused rather than ignored, and the bound
                        that stops an expansion allocating two million
                        segments. ADR 0017, and §6
    segment/            the segment model (#64), the matcher (#66) and the effort
                        comparison (#67) — endpoints and bearings, the cell
                        prefilter, discrete Fréchet, the effort with its
                        three-state visibility, and where the time went
  fit/                FIT / GPX / TCX codec (#29-#32)
    tools/uploads/      the six files #138 asks a person to upload (#111) — this
                        package's own encoder output, built from the synthetic
                        corpus, and the one of the six that is expected to be
                        refused
    src/route/          route import (#89) and export (#74) — the #32 decoder
                        composed with the profile, the refusals a rider can act
                        on, and the GPX and TCX course writers
  sensors/            sensor abstraction and BLE transport (#39-#44) — BLE only
    src/                the transport-agnostic abstraction; no platform API at all
    protocol/           the GATT profile clients (#41, #42) — service UUIDs, payload
                        decoding, and since #90 the simulation writer and the
                        choice of control point on a machine offering two, and
                        since #14 the ERG writer, which cannot send a Reset
                        because the method is not on the type it holds
    web-bluetooth/      the browser transport (#40) — the one place a BluetoothDevice exists
  physics/            cycling power/speed model, Martin et al. 1998 (#88), and
                      the synthetic rider that composes #92's rule with it
  store/              local activity, stream, recording-checkpoint, signed-record,
                      segment, effort and route store, and the round-trip harness
                      (#26-#28, #46, #61, #64, #66, #89)

docs/
  architecture.md     layout, component boundaries, ADR index
  adr/                numbered architecture decision records
  spikes/             numbered spike write-ups — a dated measurement, not a decision
  validation/         numbered hardware-validation procedures — a script for one
                      afternoon, with its result tables empty until somebody runs
                      it. Not an ADR and not a spike; it decides nothing

scripts/              dependency-free repository checks; run on a bare clone

.spdx-exempt          the files LIC001/LIC002 do not apply to, one exact path at a
                      time — third-party generator output only, enforced by LIC006

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

**`apps/web`, `apps/mobile`, `packages/domain`, `packages/sensors`, `packages/fit`,
`packages/store` and `packages/physics` exist.**
The first two were created by [#23](https://github.com/openzigs/onyourleft/issues/23) along with the
workspace, the toolchain and the lockfile, `packages/sensors` by
[#39](https://github.com/openzigs/onyourleft/issues/39), `packages/store` by
[#26](https://github.com/openzigs/onyourleft/issues/26), `packages/fit` by
[#107](https://github.com/openzigs/onyourleft/issues/107), `packages/physics` by
[#88](https://github.com/openzigs/onyourleft/issues/88). ⚠️ **`packages/matching` existed
between #65 and #66 and does not any more** — it was the #65 spike, and #66 hardened its algorithm
into `packages/domain/src/segment/` and deleted it, which is the fate
[`docs/spikes/0001-segment-matching.md`](docs/spikes/0001-segment-matching.md) gave it. A reviewer
who remembers this paragraph naming it is reading the old one. ⚠️ **`apps/mobile` now DOES
exist**, and this sentence used to say it did not:
[#87](https://github.com/openzigs/onyourleft/issues/87) created it ahead of
[#85](https://github.com/openzigs/onyourleft/issues/85), because #87's criteria are about the
Android shell and there was nothing to put them in. §4b is where what it has and has **not** proved
is recorded. The layout is fixed here
because ~30 sub-issues reference it by name, and the workspace globs and lint boundaries already
cover the paths, so a package arrives inside the rules rather than beside them.

| Package | Purpose | Must not depend on |
|---|---|---|
| `packages/domain` | Canonical units and types; every conversion in the program goes through it — the representations and the conversions are tabulated in [`packages/domain/README.md`](packages/domain/README.md). Also signing/verification, analysis, and the **recording engine** (#45), because those must run identically on the device and on an instance. | **Any platform API at all** — no DOM, no Node globals, no I/O, no network types. The recording engine may not read a clock or schedule anything: time arrives as a parameter |
| `packages/fit` | FIT / GPX / TCX decode and encode | Anything server-specific; anything under `apps/` |
| `packages/sensors` | BLE sensor and trainer abstraction (`src/`), and the Web Bluetooth transport (`web-bluetooth/`) | `src/`: **any platform API at all**, and any BLE library. `web-bluetooth/`: every platform global except `navigator`. Web Bluetooth types must not escape above the transport boundary |
| `packages/physics` | Power → speed. Pure computation. | Any rendering, BLE or platform API |
| `packages/store` | Local activity, stream, **recording-checkpoint** and **signed-record** persistence, the device keypair, and its migrations | Anything under `apps/` |

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
  clean `require.resolve` probe is not evidence of anything.** This trap has now caught two
  dependencies — `lightningcss` and, in #141, `jsdom` — so #143 recorded how to check it.
  `pnpm why lru-cache --recursive` lists `@onyourleft/domain`, `fit`, `sensors` and `store` under
  `vitest`, because pnpm re-resolves `vitest` per importer with the peer in the key and a
  devDependency declared under `apps/` reaches every package through that graph. The other probe
  answers a **narrower** question — whether that package's own source could `import` the name — and
  under pnpm's isolated `node_modules` it returns *not resolvable* for every transitive dependency,
  **`lightningcss` from `packages/domain` included**, which the bullet above records as reaching
  there. Both probes were re-run for #143 and that is what they said; a "not resolvable" therefore
  proves the package cannot be imported by name, and nothing about the licence boundary.
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
`.xml`. The identifier may sit anywhere in the first **five** lines, not only the first, because a
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
header, which is why four of the twenty `cap add` wrote are deliberately absent from the list.

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

**Read this section literally.** Commands are split into ones that work **today** and ones that do
not exist yet. A documented command nobody has run is the most expensive kind of wrong, because every
downstream issue's acceptance criteria depend on these.

### 4a. Works today — executed and observed to succeed on 2026-09-05

**Bare clone — bash and coreutils only, no install, no network:**

```bash
# Enforce the repository rules that are checkable by path.
# Exits 0 clean; exits 1 listing each violation by rule id.
bash scripts/check-repo-rules.sh

# Test the checker itself. Fixture-driven; 100 cases.
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

# Every relative link in the documentation points at something. RELATIVE ONLY —
# an https:// target is not checked and must not be, because that needs the
# network and would turn a bare-clone gate into one that fails on an aeroplane.
# A dead external link is a real problem and is not this script's.
bash scripts/check-doc-links.sh

# Test that checker. Fixture-driven; 28 cases.
bash scripts/check-doc-links.test.sh

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

# What proves that gate selects every accessibility test there is (#142). Runs
# `vitest list` with the same selector `test:a11y` uses — read out of
# package.json, never copied — and compares it against the files on disk. Needs
# Node and an install, so it is NOT part of `check:repo`.
pnpm run check:a11y-suite

# Its own suite. Fixture-driven; 27 cases. Needs Node, so also not in
# `check:repo`.
bash scripts/check-a11y-suite.test.sh

# tsc --noEmit followed by `vite build`, for apps/web. A green typecheck is not
# a green build: the bundler resolves imports the typechecker only reads types
# from, so run this before claiming a change compiles.
pnpm run build

# The browser gate (#63). Builds `apps/web/browser/` and drives it in a real
# headless Chromium through Playwright. This is the ONLY place in the
# repository where a browser runs: jsdom implements no WebGL, so MapLibre
# cannot be constructed in the Vitest suite at all, and three things are
# checkable nowhere else — that MapLibre initialises against the style we
# build, that `addProtocol` takes effect in a real engine, and **which hosts
# the map actually contacts**. That last one is #63's third criterion in its
# literal form and the assertion `styleOrigins` cannot make, because a request
# a dependency issues on its own initiative is in no style at all.
#
# Needs the pinned browser present. In a container that already has one (
# `PLAYWRIGHT_BROWSERS_PATH` set, revision matching) it runs as-is; on a bare
# machine or a CI runner, install it first with the line below.
pnpm run test:browser

# Fetch the browser the lockfile pins. @playwright/test 1.63.0 ships Chromium
# revision 1243 and this fetches exactly that, so the browser is as
# reproducible as the toolchain. ~170 MB, and `--with-deps` uses sudo to add
# the shared libraries a headless Chromium needs. Skip it where a matching
# browser is already installed.
pnpm --filter @onyourleft/web exec playwright install --with-deps chromium

# One package at a time, which is how you check a single package's harness.
# `@onyourleft/sensors`' and `@onyourleft/fit`'s typechecks each run TWO
# programs — see §4d — and both have to pass; the second is the one that
# enforces the platform boundary.
pnpm --filter @onyourleft/domain run test
pnpm --filter @onyourleft/fit run test
pnpm --filter @onyourleft/sensors run test
pnpm --filter @onyourleft/store run test
pnpm --filter @onyourleft/physics run test
pnpm --filter @onyourleft/web run test

# Regenerate the #29 synthetic FIT fixture corpus from its generator. It is
# DETERMINISTIC: running it on a clean tree leaves `git status` clean, which is
# what makes a corpus that is committed and generated the same corpus. It writes
# only under `packages/fit/fixtures/corpus`, and prints the byte budget it is
# inside. Run it after changing the generator, never to "fix" a failing test.
pnpm --filter @onyourleft/fit run fixtures:generate

# Build the six files #138 asks a person to upload to Strava and to a second
# platform: two synthetic rides — one outdoor, one indoor with no position at
# all — each as FIT, GPX and TCX. They are DECODED from the #29 corpus and
# RE-ENCODED by this package, because #138's criterion is about this package's
# output rather than about a fixture. Written to packages/fit/dist, which is
# gitignored: regenerate rather than commit. `docs/validation/0001-trainer-and-
# sensors.md` part C is where the results go, and it says which of the six is
# expected to be refused and why that is the finding rather than a bug.
pnpm --filter @onyourleft/fit run uploads:generate

# The dependency-licence gate (#24 part 2). Every dependency's OWN licence,
# checked against the path its package lands in -- the other half of the
# boundary check-repo-rules.sh performs on the code we write. Reads pnpm's own
# resolution of its own lockfile, so it needs an install and is NOT part of
# `check:repo`. About eight seconds. ADR 0015 classifies the licences; see
# also section 4g.
pnpm run check:licences

# Its own suite. Fixture-driven; 49 cases, every policy branch with a case that
# FAILS as well as one that passes. Needs Node, so also not in `check:repo`.
bash scripts/check-dependency-licences.test.sh

# All eight bare-clone script checks in one command.
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
| `LIC006` | an entry in `.spdx-exempt` names a file that is not there, a directory, an absolute or `..` path, or uses glob syntax — see §3a |
| `SCOPE001` | ANT+ is referenced anywhere in a source tree, **or named as a dependency in a `package.json` under `packages/` or `apps/`** (see §6) |
| `WF001` | `pull_request_target` appears in a `.github/workflows/` file (see §8) |
| `ADR001` | two ADRs share a number |
| `ADR002` | an ADR filename is not `NNNN-kebab-case.md` |
| `ADR003` | an ADR's `## Amendments` section is followed by **any** heading, or there are two of them, or an entry does not open with a bold ISO date, or an entry is dated **before the one above it**, or an **unclosed code fence** would hide any of those — see §7 and [ADR 0013](docs/adr/0013-adr-amendments.md) |
| `REL001` | signing key material is committed anywhere — by name (`.jks`, `.keystore`, `.p12`, `.pfx`, `.key`, `keystore.properties`) **or** by content (a `PRIVATE KEY` block in a file with an innocent name). #95, and the one rule here whose violation cannot be undone by fixing it |
| `REL002` | `apps/mobile/android/variables.gradle` targets below API **36**, or declares no `targetSdkVersion` at all. Checked here rather than in Gradle because nobody in this environment can run a Gradle build — a rule that only fires inside a build nobody runs never fires |
| `XML001` | `--` appears inside an XML comment in a non-generated `.xml` file, which XML 1.0 §2.5 forbids and no parser accepts. #225 — the rule exists because `AndroidManifest.xml` shipped in #87 with three of them and passed every gate here for months, until the first Gradle build ever run failed on it |
| `XML002` | an XML comment is never closed — the `DOC002` failure mode in XML, where the scanner's state sticks, everything after it is silently skipped, and a parser drops every element that follows |

`scripts/check-licence-hashes.sh` enforces one more, separately because it hashes files rather than
reading paths:

| Rule | Fails when |
|---|---|
| `LIC005` | a licence text no longer matches the SHA-256 digest ADR 0001 records for it, **or** ADR 0001 no longer records a digest for one of them, **or** a leaf package's own `LICENSE` is not byte-identical to the canonical text its path requires |

`scripts/check-env-example.sh` enforces one more, separately because it reads code rather than paths:

| Rule | Fails when |
|---|---|
| `ENV001` | a source file under `apps/` or `packages/` reads an environment variable `.env.example` does not list, **or** `.env.example` is missing |

`scripts/check-doc-links.sh` enforces two more, separately because it reads **prose** and then
resolves paths out of it:

| Rule | Fails when |
|---|---|
| `DOC001` | a relative link in a `.md` file points at nothing. Absolute URLs, `mailto:` and bare `#anchor` targets are skipped; a `#fragment` is stripped before the path is resolved, and a link inside a code fence is an example rather than a link |
| `DOC002` | a code fence is never closed. Without it the fence state machine sticks and every link after the fence is skipped **while the file reports clean** — the "rule that cannot fire" shape this repository has now shipped five separate times |

`scripts/check-dependency-licences.mjs` enforces one more, separately because it reads the installed
dependency graph rather than the repository:

| Rule | Fails when |
|---|---|
| `DEP001` | a dependency's own licence is not permitted in the closure and path where it was found — including a licence in none of [ADR 0015](docs/adr/0015-dependency-licences.md)'s tables, which fails closed |

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

- ⚠️ **`apps/mobile` now DOES exist** — this bullet used to say it did not, and a reviewer who
  remembers that is reading the old file. [#87](https://github.com/openzigs/onyourleft/issues/87)
  created it, ahead of [#85](https://github.com/openzigs/onyourleft/issues/85), because #87's own
  criteria are about the Android shell and there was nothing to put them in. See the heading below
  for what it holds and, more usefully, what it has NOT been able to prove.
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

  - **`apps/mobile`** ([#87](https://github.com/openzigs/onyourleft/issues/87)) holds
    `capacitor.config.ts`, the generated `android/` project, and the Capacitor BLE adapter. ⚠️ **Six
    of #87's eight acceptance criteria cannot be verified in a container and were not.** There is no
    Android SDK and `dl.google.com` is refused by the egress proxy, so nothing in `android/` has
    been compiled, no emulator or device has run it, and — the one that matters most — **the merged
    manifest has not been asserted**, because the merge is the SDK's and checking the app's *own*
    manifest instead would be exactly the false pass #87 warns about.
    [`apps/mobile/README.md`](apps/mobile/README.md) §4 is the table of what was and was not
    available; read it before treating any Android claim here as checked. ⚠️ It also records that
    `android/gradle/wrapper/gradle-wrapper.jar` is a **committed binary whose checksum could not be
    verified** from this environment, and what would settle it.
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
    ⚠️ **Since [#89](https://github.com/openzigs/onyourleft/issues/89) it also holds
    `src/route/`**, `decodeGpxRoute` — the #32 decoder composed with
    `@onyourleft/domain`'s route profile, and the only place the codec and the profile meet. That
    issue also taught `decodeGpx` to read **`<rte>`/`<rtept>`**, which a route planner writes and
    which nothing in this codec read before; ⚠️ a `<trk>` **wins outright** when a document carries
    both, because planners export the same line twice at different densities and concatenating them
    would double the ride.
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
    §5, and — since [#61](https://github.com/openzigs/onyourleft/issues/61) — the **device keypair
    and the signed activity record** at schema version 4, decided in
    [ADR 0011](docs/adr/0011-stream-storage.md)'s sibling
    [ADR 0014](docs/adr/0014-portable-identity.md), and — since
    [#89](https://github.com/openzigs/onyourleft/issues/89) — **saved routes** at schema version 7,
    which is the only record in the store that holds a whole *computed* artefact rather than
    measurements: `records.ts` says why that is safe here and is not for a ride's load.
    ⚠️ The private key is a **non-extractable
    `CryptoKey`**, stored as a handle: `crypto.subtle.exportKey` on it rejects, which is what makes
    "the private key never leaves the device" a property of the platform rather than a promise about
    our code. Do not replace it with a stored byte array. `packages/store/src/web-crypto.ts` is the
    only file in **non-test** code that calls `crypto.subtle` for a signature — `identity-verifier.test.ts`
calls `crypto.subtle.verify` directly and deliberately, because it is the independent spec verifier
and routing it through `web-crypto.ts` would destroy the independence it exists for; the record format, the
    canonical bytes and the verification logic are in `packages/domain`, which cannot name `crypto`
    at all. Devices and gear are still additive object stores in a later schema version. ⚠️ It is
    **not** platform-isolated the way `packages/domain` is — it uses `indexedDB` and
    `CompressionStream`, so its `tsconfig.json` includes the DOM lib, and `eslint.config.js`'s
    `no-restricted-globals` block stays scoped to `packages/domain`.
  - **`packages/physics`** ([#88](https://github.com/openzigs/onyourleft/issues/88)) holds the
    **Martin et al. 1998** power/speed model: the six force terms one exported function at a time
    (`terms.ts`), the forward model and its steady-state inverse (`power.ts`), the deterministic
    tick (`simulate.ts`) and an ISO 2533 air-density model (`air.ts`). It is platform-free the way
    `packages/domain` is, through one `tsconfig.json` rather than two, and it has **no runtime
    dependency but `@onyourleft/domain`**. Provenance for every constant, and the two that rest on
    weaker evidence, is [`packages/physics/README.md`](packages/physics/README.md) §2. ⚠️ **It has
    no production consumer, and since #92 it has a caller** — `src/pacer.ts` composes the pacing
    rule with `advance`, so a bot and a rider go through the same tick. Nothing *renders* a speed
    from it yet; #91 and #94 are the issues that will, and both need `apps/mobile`. ⚠️ Its determinism is enforced in
    `eslint.config.js`, **not** by the typechecker: `Date` and `Math.random` are ECMAScript
    built-ins and survive `lib: ["ES2024"]`, exactly as `DataView` does in `packages/sensors`.
    ⚠️ Do not "simplify" the tick's integrator. It splits the drive (integrated in energy) from
    the resistance (integrated in force) because the two have singular points in different places;
    the naive single-form version froze a coasting rider at 0.00027 m/s and never let a stationary
    one roll down a hill, and both failures are now tests.
**And the dependencies that exist.** The toolchain,
React 19, React DOM, Vite, — since #26 — `dexie` 4.4.5 and `fake-indexeddb` 6.2.5 (both
Apache-2.0, both zero-dependency, both under `packages/store`) and — since #40 —
`@types/web-bluetooth` 0.0.21 (MIT, zero-dependency, types only, a devDependency of
`packages/sensors`) and — since #31 — `fit-file-parser` 5.0.2 (MIT, a devDependency of
`packages/fit` **and, since #51, of `apps/web` too**, whose closure is `buffer` MIT → `base64-js`
MIT and `ieee754` BSD-3-Clause) and — since #63 — `maplibre-gl` 6.7.0 and `pmtiles` 4.5.0 (both
BSD-3-Clause, both runtime dependencies of `apps/web`, whose closure adds BSD-2-Clause, ISC, MIT and
one `(MIT OR Apache-2.0)` and no GPL, AGPL or non-OSI licence) and — also since #63 —
`@playwright/test` 1.63.0 (Apache-2.0, with `playwright` and `playwright-core`, all three
Apache-2.0; a devDependency of `apps/web`, and the only dependency in the workspace that pins a
**browser** as well as a version — see §4f) and — since #91 — `three` **0.185.1** (MIT,
**zero dependencies**, a runtime dependency of `apps/web`) with `@types/three` 0.185.4 (MIT, a
devDependency, because `three` ships no types of its own) are
installed;

⚠️ **`three` is pinned at 0.185.1 rather than at the current 0.186.0 deliberately.** 0.186.0 was
published on 2026-09-08, the same day it was wanted, and pnpm's `minimumReleaseAge` refuses a
lockfile entry younger than 24 hours — §8 says to pin something older rather than add a
`minimumReleaseAgeExclude`, which would turn the protection off for that package permanently.
0.185.x is also the version ADR 0008's engine table names. **nothing else from ADR 0005's runtime list is**, `react-router` included. Add each in
the issue that first needs it, after checking its licence against the
directory it lands in (CONTRIBUTING.md).

⚠️ **`@onyourleft/fit` moved from `apps/web`'s `devDependencies` to its `dependencies` in #51**,
because the import and export screen is the codec's first *production* caller rather than a test's.
The second entry for `fit-file-parser` is there for #51's third-party-acceptance assertion, and it
needs its **own** ambient declaration at `apps/web/src/transfer/fit-file-parser.d.ts`: TypeScript
resolves a `declare module` inside the program that includes the file, and `apps/web`'s program does
not include `packages/fit/tools`. Two declarations of one untyped devDependency is the cost of not
making a client's typecheck depend on another package's authoring-time directory layout.

### 4c. What CI runs, and what it deliberately does not

[`.github/workflows/rules.yml`](.github/workflows/rules.yml) runs on every pull request and on every
push to `main`. It runs **exactly** the §4a commands and nothing else: the eight bare-clone script
checks (`check-repo-rules`, `check-licence-hashes`, `check-env-example` and `check-doc-links`, each
with its own fixture suite), `shellcheck scripts/*.sh`, then `pnpm install --frozen-lockfile`, `format:check`, `lint`,
`typecheck`, `test:coverage`, `bash scripts/coverage-summary.test.sh`, `check:a11y-suite`,
`test:a11y`, `bash scripts/check-a11y-suite.test.sh`, `build`, `playwright install --with-deps
chromium`, `test:browser`, `bash scripts/check-dependency-licences.test.sh` and `check:licences` — then
publishes the coverage table to the run summary and uploads the HTML report as an artefact.
Those last two carry `if: always()` and cannot fail the job: the run where coverage moved
unexpectedly is exactly the one whose table you want, and a reporting step that can fail a
build is a percentage floor arriving by the back door, which §5 forbids. If CI ever needs a step this file does not list, **this
file is wrong and gets fixed in the same PR**; CI must not accumulate private knowledge, because
that is how a contributor's local green becomes CI's red with no explanation.

⚠️ **There is exactly one step that is not a §4a command, and this is it:
`sudo rm -f /etc/apt/sources.list.d/google-chrome.*` immediately before the browser install.**
It is recorded here rather than left as private CI knowledge, which is what the paragraph above
forbids. `playwright install --with-deps` runs `apt-get update` across **every** source the runner
image configures, and the image configures Google's own Chrome apt repository for the Chrome it
ships. On 2026-09-09 that repository served a `Release` file regenerated at 17:16 UTC beside a
`Packages.gz` last modified at 09:41; apt refused the mismatch (`Hash Sum mismatch`), the install
exited 100, and it failed **byte-identically on a re-run** rather than settling. Nothing in this
repository uses that source: the browser is the one the lockfile pins, fetched from Playwright's
own CDN, and `--with-deps` takes its shared libraries from Ubuntu's archives. Removing it
therefore makes CI trust **less** than it did, which is why it is a safe answer to an outage and
not a workaround with a cost. It is a no-op the day Google's index is consistent again, and
deleting the step is a one-line revert if the trade is ever judged wrong.

> ⚠️ **The workflow's `name:` and its job's `name:` are both `Repository rules`, and `main` requires
> a status check whose context is exactly that string.** Rename either and the required check never
> reports, which makes every subsequent pull request unmergeable — including the one doing the
> renaming. Extend the existing job; do not add a second job for a new gate, because a second job
> reports under a different context and its failure would not block a merge.

**The browser gate (#63) is in that same job, and it is the step that most looks like it wants its
own.** It installs a ~170 MB Chromium and then runs for about three seconds, which is exactly the
shape a separate job exists for — and it stays here anyway, because a second job reports under a
different context and could not block a merge. A gate that cannot block is not a gate. The job's
`timeout-minutes` moved from 10 to 15 to give the download room; that number is a stop on a hung
job, not a budget.

⚠️ **The browser is pinned by the lockfile, not by the install command.** `@playwright/test`
**1.63.0** ships Chromium revision **1243**, and `playwright install chromium` fetches whatever the
installed Playwright names. Bumping Playwright therefore changes the browser under the gate, which
is a thing to do deliberately and to re-run the gate after — the same posture as the fixture-corpus
generator in `packages/fit`. ⚠️ **These two numbers move together and are the reason this bump is
not a routine one.** #206 took 1.56.0 → 1.63.0, which took Chromium **1194 (141.0.7390.37) → 1243
(153.0.8010.12)** — twelve major browser versions in one version bump, read from each release's own
`browsers.json` rather than from the changelog. The gate was re-run on the new browser before that
merge and stayed green. A future bump updates this paragraph in the same pull request; a Dependabot
bump that leaves it saying 1.56.0 is the drift §4c forbids.

It runs on `ubuntu-latest`, holds `permissions: contents: read`, and pins `actions/checkout` and
`actions/setup-node` to full commit SHAs with the `gh api` command that produced each in a comment.
All of that is §8 rules rather than preference. Node comes from `.nvmrc` and pnpm from
`packageManager` via corepack, so the runner cannot drift from a contributor. There is deliberately
**no dependency cache**: it would mean another action to pin and a writable cache in every job's
dependency path, to save seconds on a workspace this size.

**This pipeline has been proved to go red**, which is the whole of what
[#24](https://github.com/openzigs/onyourleft/issues/24) was for. #100 did it for the bare-clone
script rules; the toolchain steps were demonstrated on 2026-09-07 in a throwaway pull request
(#180, closed unmerged) carrying one defect per commit, each chosen to pass every earlier step so
the failure lands on the step under test:

| Defect | Failed at | Run |
|---|---|---|
| a floating promise (`tsc` allows it, `@typescript-eslint/no-floating-promises` does not) | **Lint** | [34116473625](https://github.com/openzigs/onyourleft/actions/runs/34116473625) |
| a `string` assigned to a `number` (type-aware ESLint passes it — assignment compatibility is `tsc`'s job) | **Typecheck** | [34116588471](https://github.com/openzigs/onyourleft/actions/runs/34116588471) |
| an assertion that is simply false | **Tests and coverage report** | [34116723271](https://github.com/openzigs/onyourleft/actions/runs/34116723271) |

Two things that demonstration settled beyond the criterion. The coverage steps **ran anyway** in
the two failing runs, reported the missing report, and did **not** fail the job — §4c's `if:
always()` design, observed rather than asserted. And a defect that trips an *earlier* step proves
nothing about a later one, which is why each was verified locally against every preceding step
before being pushed.

**The coverage report is real, and that is a separate claim from any threshold.** Measured the
same day on `main`: the suite reports 6408/6616 statements (96.85%); removing
`apps/web/src/transfer/export-activity.test.ts` and re-running moves that file from 54/54 to
50/54 and the total to 6404/6616 (96.79%). It drops by four rather than to zero because
`TransferView.test.tsx` exercises the same code — which is the more useful half of the result:
coverage is attributed to what actually executes, not to a filename that looks related.

⚠️ **#24's own wording for this asks for something §5 forbids.** The criterion reads *"the
coverage gate is enforced and demonstrated to fail below threshold"*, and it **predates §5 and
does not govern**: §5 bans a percentage floor outright, and §4b reframes what is owed as the
demonstration above. Read §5, not that criterion.

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
| `@typescript-eslint/no-restricted-imports` in `packages/domain`, `packages/physics`, `packages/sensors/src`, `packages/sensors/protocol` and `packages/sensors/web-bluetooth` | naming **any** Node builtin — the list is derived from `builtinModules`, not typed out, so `events`, `util` and `stream/promises` fail exactly as `node:fs` does — or `react`, `react-dom`, `vite` or `dexie`, or a BLE library |
| `no-restricted-globals` in `packages/domain`, `packages/physics`, `packages/sensors/src` and `packages/sensors/protocol` | naming a DOM global (`window`, `document`, `navigator`, `location`, `history`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`), a Node global (`process`, `Buffer`, `__dirname`, `__filename`, `global`, `require`) or a network global (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Request`, `Response`, `Headers`). This one **is** a named list; the closure is the typechecker below |
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
>
> ⚠️ **It reaches relative imports too, and #88 hit it.** A file named `constants.ts` — or
> `util.ts`, `stream.ts`, `path.ts`, `crypto.ts`, `assert.ts`, `events.ts`, `url.ts`, `os.ts`, and
> about forty more — could not be imported as `./constants` from a platform-isolated package,
> because that specifier's last segment is a builtin's name. `packages/physics/src/constants.ts`
> holds `g` and the ISO 2533 atmosphere and was reported as importing a Node builtin. #88 added
> `'!./*'` and `'!../*'` to the same group, which fixes it for every package at once rather than
> renaming one file and leaving the trap for whoever writes the next `util.ts`. **It exempts nothing
> that was ever a violation** — a Node builtin is always a bare specifier, never a relative one — and
> a bare `import 'constants'` and a `node:constants` are both still errors, checked with a probe
> file.

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
| `audit.a11y.test.ts` | a violating fixture for **every** rule, plus an assertion that every rule in `ACCESSIBILITY_RULES` has one. A rule added without a failing fixture fails the build |
| `routes.a11y.test.tsx` | renders every entry in `shell/routes.ts` and audits it. A route added to the table is audited without anyone editing this file |
| `contrast.a11y.test.ts` | WCAG 2.2 AA contrast for every declared token pair, and that every token appears in a pair |
| `theme.a11y.test.ts` | that `theme.css` carries the same values as `design/tokens.ts`, in both directions |
| `index-html.a11y.test.ts` | `lang`, and that the viewport meta does not block zoom |
| `degradation.a11y.test.tsx` | that a chart which throws is replaced by its table and does not take the page with it |

⚠️ **An accessibility test file is named `*.a11y.test.{ts,tsx}`, and that name is what the gate
selects on** — `test:a11y` is `vitest run --project web .a11y.test.`. Until
[#142](https://github.com/openzigs/onyourleft/issues/142) the filter was the *directory* name, which
failed closed against deleting `apps/web/src/a11y/` and **open** against renaming it: renaming to
`src/accessibility/` dropped `audit.test.ts` and the step stayed green with 6 files and 61 tests
instead of 7 and 101. A filename cannot be moved out of the gate by a directory rename, and a new
file that carries the convention is picked up with no CI edit.

`scripts/check-a11y-suite.mjs` closes what the convention alone cannot: a test file inside a
directory named `a11y` or `accessibility` that does **not** carry the convention fails the build,
rather than sitting silently outside the gate. It takes the selector out of `package.json` and asks
`vitest list` which files it picks, so the check and the gate cannot drift apart; a `test:a11y` it
cannot parse is a failure, not a pass. Run it with `pnpm run check:a11y-suite`, and its own suite
with `bash scripts/check-a11y-suite.test.sh`.

⚠️ **Two of its four rules look like each other and are not**, which #155 raised as a rule that
could not fire. **It can** — the two catch different things and the suite now isolates each:

- *A test inside an `a11y`/`accessibility` directory that lacks the convention* is **rule 3**, and
  it is what catches #142's own regression. Renaming the directory leaves the old filter matching
  the *filename*, so the conventional files stay selected and only the non-conventional one is
  silently dropped — rule 3 is the one that notices.
- *A selected file that lacks the convention* is **rule 2**, and it catches a filter broadened the
  other way, past the convention, pulling in tests that are not accessibility tests at all. Rule 3
  cannot see that, because the file is outside any accessibility directory.

The confusion was reasonable: the pre-existing fixture for rule 2 put its file *inside* `src/a11y/`,
where rule 3 also fires, so deleting rule 2 left the case red anyway and the rule looked redundant.
A fixture outside such a directory isolates it, and deleting rule 2 now turns that case green.

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

### 4f. The browser gate

Added by [#63](https://github.com/openzigs/onyourleft/issues/63). It lives in
[`apps/web/browser/`](apps/web/browser/) and it is **the only place in this repository where a real
browser runs**.

| File | What it is |
|---|---|
| `index.html`, `harness.ts` | a page that builds a map through the **real** `map/maplibre.ts` and the **real** `basemapStyle`, and publishes what happened on `window.__oylHarness` |
| `map.browser.spec.ts` | the Playwright spec that drives it |
| `game.html`, `game-harness.ts` | since #91, the same idea for the renderer: a page that builds a scene through the **real** `game/three-renderer.ts` and the **real** `terrain.ts` |
| `game.browser.spec.ts` | its spec — the renderer constructs against a live context, the geometry is one a driver accepts, and a frame reaches the drawing buffer (read back with `readPixels`, because `render` not throwing is a weaker claim) |
| `../playwright.config.ts` | Chromium only, no retries, and the SwiftShader flags without which a GPU-less runner gives MapLibre no context at all |
| `../vite.browser.config.ts` | the harness build. A second Vite config, so the harness cannot reach a shipped bundle |

**Why it exists at all**, given that #48's suite already renders every route: **jsdom implements no
WebGL**, so `new maplibregl.Map(...)` cannot be constructed in the Vitest suite. `src/map/port.ts`
records the seam that follows from that, and it leaves exactly three questions open — whether
MapLibre initialises against the style we build, whether `addProtocol` takes effect in a real
engine, and **which hosts the map actually contacts.** The third is #63's criterion 3 in its literal
wording (*"intercepts all network traffic during a map render"*), and it catches what `styleOrigins`
cannot: a request a dependency issues on its own initiative is in no style at all.

⚠️ **The browser gate does not subsume `styleOrigins`, and it is easy to assume it does.** Adding a
third-party `glyphs` URL to `basemapStyle` turns the **jsdom** check red and leaves the **browser**
gate green — glyphs are fetched lazily, only when a symbol layer draws text, and the minimal style
has no symbol layers. So the static check catches a third-party URL that is *declared* and the
browser catches a host that is *contacted* but declared nowhere. Neither is the other's superset and
deleting either leaves a real hole. Found by mutation; recorded here so it is not rediscovered.

⚠️ **It is NOT part of `pnpm run test`.** It needs a browser and a built harness, and a five-second
browser run does not belong in the fast suite a contributor runs on every save. It is its own
command and its own CI step.

⚠️ **`vite.browser.config.ts` names both entries explicitly, and must.** Vite's multi-page mode
discovers only `index.html`; a page added without a line in `build.rollupOptions.input` is simply
not built, and the failure is a 404 while the spec runs rather than a build error — which reads
like a server fault and sends the next person to `playwright.config.ts`.

⚠️ **What the game half does NOT prove.** Not that the scene looks right — there is no reference
image and ADR 0009 forbids deriving one from another product. And **not ADR 0008 D-2's spike**: no
frame rate, no thermal behaviour, nothing measured on a phone. That gate was **waived** rather than
passed (see the 2026-09-08 amendment on [ADR 0008](docs/adr/0008-mobile-client-architecture.md)),
and #91's 60-minute measured run on the device floor is still outstanding.

⚠️ **Do not reach for `networkidle`.** There is no published archive (#53), so the archive request
404s and **MapLibre retries a failed source** — the network never goes idle. The first version of
the spec waited on it and four of five tests burned sixty seconds each before failing. Wait on the
event you mean (`waitForRequest`), which is both faster and stricter: it fails immediately when the
request is never made, which is what a broken protocol registration looks like.

⚠️ **`renderer.create` does not register the protocol.** `MapPanel.tsx` calls
`protocol.ensure()` before it creates a map, and the harness has to do the same. Omitting it is
silent: MapLibre meets a `pmtiles://` URL it has no handler for, never requests the archive, and
every network assertion waits out its timeout rather than failing with a reason.

⚠️ **The harness server is a *static file server*, not a single-page app.** `vite.browser.config.ts`
sets `appType: 'mpa'` so a missing archive comes back `404` — Vite's default rewrites every unknown
path to `index.html` and returns `200` with a page of HTML, which the "there is no archive yet"
assertion reads as success. A real PMTiles archive sits on object storage behind a CDN (ADR 0010
D-1), which 404s what it does not have.

⚠️ **The harness server binds `127.0.0.1` explicitly, and that is load-bearing.** `vite preview`
defaults to `localhost`, which is **not** a synonym for `127.0.0.1`: Debian and Ubuntu map
`localhost` to both `127.0.0.1` and `::1`, Node resolves it verbatim in whatever order
`getaddrinfo` returns, and a server handed `::1` listens on IPv6 loopback alone while Playwright
polls the IPv4 one. This gate's first CI run died on that URL — green in a container with no IPv6
at all, red on the runner, with `Timed out waiting 60000ms from config.webServer` and **no other
output**, because Playwright ignores a web server's stdout by default. ⚠️ The IPv6 split is the
**explanation, not an observation**: what that run established is that nothing answered on
`127.0.0.1`, and the one line that would have named the address the server *did* bind to is exactly
the line that was missing. Binding explicitly turned it green; `stdout: 'pipe'` is what would settle
it outright next time. `playwright.config.ts` now
builds the bind address and the polled URL from one `HOST` constant so they cannot drift, and sets
`stdout: 'pipe'` so Vite's own "bound to …" line is in the log the next time something of this
shape happens. A green browser gate on a developer's machine says nothing about which addresses
that machine has.

**What it does not prove: that tiles render.** There is no archive to render from. The spec asserts
the 404 rather than tolerating it, so the day #53 lands that test goes red — which is the right
moment for somebody to come back and replace it with one that asserts tiles actually drew.

### 4g. The dependency-licence gate

Added by [#24](https://github.com/openzigs/onyourleft/issues/24) part 2 and classified by
[ADR 0015](docs/adr/0015-dependency-licences.md). `scripts/check-repo-rules.sh` checks the licence
of the code **we write** — the header, the manifest, the `LICENSE` file. This checks the licence of
the code **we pull in**, which is the direction §3's HARD RULE actually protects against: a GPL
dependency inside an Apache-2.0 leaf package is a licensing incident and it arrives looking like a
version bump.

**Two closures, judged by different tables**, because a licence's obligations attach to what is
distributed:

| | `packages/*` (Apache-2.0) | `apps/*` (AGPL-3.0-or-later) |
|---|---|---|
| **Distributed** (`--prod`) | permissive only | permissive + weak + GPL/LGPL/AGPL |
| **Build-time only** | permissive + weak | permissive + weak + GPL/LGPL/AGPL |

where *weak* is ADR 0015 D-2's set — `MPL-2.0`, `BlueOak-1.0.0`, `CC0-1.0`, `MIT-0`, `0BSD` — plus
`Unlicense`, added to that set by [ADR 0016](docs/adr/0016-unlicense.md) D-1. `Unlicense` grants
more than MIT does and still sits in *weak* rather than *permissive*, because the permissive row is
§3's quotable list verbatim and stays that way; ADR 0016 D-1 gives the reasoning.

⚠️ **GPL and AGPL stay forbidden under `packages/` in BOTH closures.** The distributed-artefact
argument alone would permit a GPL build-time tool there; ADR 0015 D-3 deliberately does not go
there, because §3 states the rule with no exemption and reversing it is an owner's decision rather
than a side effect of writing a checker.

⚠️ **It fails closed.** A licence in none of the tables is a violation, not a pass — the gate exists
for the licence nobody has considered yet. A perfectly fine but unnamed licence (`Zlib`, say) will
stop the build until someone adds it to ADR 0015 **and** to `POLICY` in the script. Those two tables
can drift and nothing prevents it; the script says so where `POLICY` is defined and the failure
message names the ADR.

⚠️ **That is not hypothetical — it has now happened once, and `Unlicense` is no longer the example.**
#87's `@capacitor/cli` install reached `bplist-parser` and `bplist-creator` (`Unlicense`) and
`DEP001` stopped the build. [ADR 0016](docs/adr/0016-unlicense.md) ruled on it and `POLICY.weak`
carries it, in the same pull request, which is the shape ADR 0015's §Consequences asks for. `Zlib`
was deliberately **not** ruled on at the same time: nothing in the tree needs it, and a licence
nobody has a dependency for is a licence nobody has read.

⚠️ **`pnpm licenses list --filter` does NOT follow workspace links, and that was measured.**
`apps/web` declares `@onyourleft/store`, which declares `dexie`, yet `dexie` does not appear in
web's closure — it appears in `store`'s, which is where the licence question belongs. So **the union
over every workspace package is what makes the check complete**, the package list is *discovered*
rather than written down, and a discovery returning nothing is a failure rather than a clean run.

⚠️ **It cannot see a licence the package declares wrongly.** It reads the `license` field each
package publishes. A package that declares MIT and vendors GPL inside itself passes, and no check at
this layer would catch that — which is why `packages/fit`'s clean-room posture (ADR 0006) exists
separately rather than being subsumed here.

**Not part of `pnpm run check:repo`**: it needs an install, the same reason `check:a11y-suite` is
not. Its own suite is `bash scripts/check-dependency-licences.test.sh` — 49 cases, and every policy
branch has a case that goes **red** as well as one that passes.

### 4i. Route planning has an interface and no engine, deliberately

[#70](https://github.com/openzigs/onyourleft/issues/70)'s `RoutingProvider` is in
**`packages/domain/src/routing/`** and there is **no HTTP adapter anywhere**. Both halves of that
are decisions, and the second is the one that looks like an omission.

**Why the interface is in the Apache-2.0 leaf.**
[ADR 0010](docs/adr/0010-map-tiles-and-routing.md) D-4 chose Valhalla (MIT), self-hosted, reached
**over HTTP as a separate process** — so nothing is linked and no engine's licence attaches to this
codebase at all. What decides where the *interface* lives is D-4's other argument: *"the interface
outlives the transport… the moment anyone wants an offline or in-browser route, a permissive engine
can be compiled in and a GPL one cannot."* An Apache-2.0 leaf is where that door stays open.

⚠️ **#70's "no engine-specific type appears above the interface, proved by a lint-enforced import
boundary" is discharged by a rule that already existed.** `boundaries/dependencies` forbids any
import from `packages/*` into `apps/*` in both spellings (§4d), so a Valhalla type reaching
`packages/domain/src/routing/` is a lint error rather than a review note. `packages/domain`'s own
`lib: ["ES2024"]` / `types: []` closure is the second half: that file could not name `fetch`,
`Response` or `URL` even if somebody wanted it to.

⚠️ **Why there is no adapter, and why writing one would be worse than not.** Nothing is running.
Standing up Valhalla is [#53](https://github.com/openzigs/onyourleft/issues/53), and #70's own
criteria — *"the same test suite passes against two different engines"* and *"repointed from a
bootstrap endpoint to a self-hosted instance"* — cannot be met without one. An adapter written
against an API nobody in the loop can call is §4a's *"a documented command nobody has run is the
most expensive kind of wrong"* in a new place, and it is **worse than absent**: a reviewer reads
request-shaping code as evidence the engine was talked to. `apps/web/src/routing/testing.ts` says
this at the point somebody would go looking, and `routing/preferences.ts` carries the named-option
→ costing mapping as a table so the adapter starts from ADR 0010's recorded read rather than a
guess.

**What is real, and what the tests therefore prove.** The interface; the validation every engine's
numbers must pass; the draft, its undo and its stale-leg accounting; the elevation profile and its
coverage; the screen. #71's two hardest criteria are about *how many times* an engine was asked and
*which legs* — a real engine answering correctly proves neither, which is why the double counts its
calls and a test reads the count.

⚠️ **`packages/domain` now exports two things called an elevation source and they are not the same.**
`segment/segment.ts`'s `ElevationSource` is a three-value category (`'device' | 'dem' | 'none'`);
`routing/provider.ts`'s **`ElevationDataset`** is a named dataset and its grid resolution, which is
what #72 requires a route to store. The second is not called `ElevationSource` because the first
already is — a collision the typechecker caught rather than a naming preference.

### 4h. Where the trainer game lives, and why it is not `apps/mobile`

[#85](https://github.com/openzigs/onyourleft/issues/85)'s renderer (#91), ghost (#93) and HUD (#94)
are in **`apps/web/src/game/`**. Every one of those issues says `Component: apps/mobile`, so this
paragraph exists to stop that being read as a mistake.

**`apps/mobile/capacitor.config.ts` sets `webDir: '../web/dist'`.** The Android shell wraps
**apps/web's build** — that is #85's own premise, *"the mobile shell wraps the same web build, so
there is exactly one client and a divergence between the two is impossible rather than merely
discouraged"*. So a renderer under `apps/mobile/src` would typecheck, test green, and **never be
copied into the APK**. It would be the false pass `apps/mobile/README.md` §4 warns about, arrived at
from a new direction.

Three things reinforce it. [ADR 0008](docs/adr/0008-mobile-client-architecture.md) D-1 chose
Capacitor partly *for* web UI reuse. §2's layout already describes `apps/mobile` as the shell. And
both gates that can verify this work — the accessibility gate (§4e) and the browser gate (§4f) —
run against `apps/web` only; #94 has a WCAG AA contrast criterion, and putting the HUD in
`apps/mobile` would place it outside the one gate built to check exactly that.

⚠️ Those issue bodies **predate `apps/mobile` existing at all**. They were written 2026-09-03 and
#87 created the directory afterwards, so `Component:` there is a planning-time guess rather than a
decision — §8's "read the issue's revision block first" applies.

**The split that does hold is by capability, not by folder.** Computation and UI in `apps/web`;
only what genuinely cannot be web — `PowerManager.getThermalHeadroom()` (API 30+) and the
foreground-service wake lock — behind ports in `apps/web` with Capacitor implementations in
`apps/mobile`, exactly as #39's sensor interface relates to #40's Web Bluetooth transport.

⚠️ **`apps/mobile` had no importers at all until #85's wiring branch, and that sentence used to
stand here unqualified — a reviewer who remembers it is reading the old file.** Nothing in
`apps/web` reached for #87's Capacitor BLE transport, so the shell shipped a web build that could
not pair with anything on Android. Three things were missing and all three are now there:
`apps/mobile` declared no `exports` (so nothing *could* import it), nothing implemented
`CapacitorBlePort` against the real `BleClient` (so there was nothing to hand the transport), and
`main.tsx` had no way to tell a WebView from a browser.

**How the choice is made now.** `support/capacitor.ts` asks `Capacitor.isNativePlatform()` — not the
user agent, because a Capacitor WebView *is* Chrome and reports itself as Chrome, and not
`'Capacitor' in window`, because Capacitor's web build defines that global too. `main.tsx`'s
`buildRideController` is asynchronous for exactly this: inside the shell it `import()`s
`@onyourleft/mobile` and builds the Capacitor transport; in a browser it never downloads a line of
it. `pnpm run build` shows the split, and `grep -c BleClient` over the entry chunk returns 0.

⚠️ **The Android trainer-control path is WRITTEN and has never driven a trainer**, and this
paragraph used to say "Trainer control now works on Android too" — a reviewer who remembers that
sentence is reading the old file, and [#230](https://github.com/openzigs/onyourleft/issues/230) is
why it was wrong. Nothing downstream of pairing could work, because **pairing itself did not**:
`BleClient.initialize()` was called only from `availability()`, which nothing in `apps/web` calls,
so every `discover()` reached `requestDevice()` with the plugin uninitialised. #230 fixed that
(`transport.ts`'s `ensureInitialized`), and what is established today is that the **code** is
there: `openCapacitorTrainer` in `apps/web/src/ride/trainer.ts` is the Android counterpart of
`openWebBluetoothTrainer`, `apps/mobile/src/ble/fitness-machine-channel.ts` implements
`packages/sensors/protocol`'s `FitnessMachineChannel` over the plugin, and everything that decides
*what may be written* — `createTrainerControl`, the bounding, the quantisation, the feature gating
— is the same platform-free code on both, which is #39's promise being kept for the one operation
that writes. What is **not** established is that any of it has reached a trainer: that is
[validation 0002](docs/validation/0002-android-shell-and-game.md) Parts B–D, and its result tables
are still empty. Write "works on Android" again only when one of them is filled in.

⚠️ **The write is `port.write`, never `port.writeWithoutResponse`, and the wrong one is declared on
the port so the swap is a red test.** `FitnessMachineChannel` warns that an unacknowledged write
*"compiles, satisfies every test in this file, and reintroduces exactly the fire-and-forget failure
the client exists to prevent"* — so `plugin-port.ts` declares the unsafe sibling, `ble-client.ts`
implements it, nothing calls it, and `fitness-machine-channel.test.ts` asserts it stays uncalled.
The same shape `web-bluetooth/src/gatt.ts` uses for `writeValueWithoutResponse`.

⚠️ **`openCapacitorTrainer` hands this program's `DeviceId` straight to the plugin**, which is
correct only because `transport.ts` mints the one from the other — and its own `Link.pluginId`
comment warns they are "not necessarily" the same. `fitness-machine-channel.test.ts` pins that
assumption, because if it ever breaks the symptom is a control point write addressed to a device the
plugin has never heard of, on the one path that applies physical resistance to somebody.

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
the second pattern and is no longer true: all six packages appear (`packages/physics` since #88).

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
  "returns everything the requester is connected to". ⚠️ **The scoping assertions that need the
  third now exist, and this bullet used to say they were waiting for Phase 3** — a reviewer who
  remembers that is reading the old file. `activity-store.scoping.test.ts` derives every
  `owner`-taking member from `ActivityStore.prototype` and requires a probe for each, and
  `activity-store.erasure.test.ts` derives the table list from `SCHEMA_VERSIONS`. Both fail closed,
  and both use all three athletes.
- **`seedRide` and `streamSetFor` take an owner**, so the write-path scoping case is as short to
  write as the read-path one. #26's review found that a two-athlete *read* fixture is blind to a
  write-path hole entirely.
- **The assertions throw `RoundTripFailure`; they are not `expect` calls.** That is what lets the
  same assertion body run green against the real store and red against a fake, which is the only
  honest proof that a harness works.
- **`fakes.ts` holds five deliberately broken stores** — one that writes to memory, one that
  commits to the real database under a key the reader does not use, one that fills every gap
  with a zero, one whose every second flush is acknowledged and never written, and one that
  **tidies a signed claim on its way in**. The same round trip is run against each and required to
  go red. **If you add a write path to `packages/store`, the `PersistentStore` type fails to compile
  until the fakes account for it.** That is deliberate: it is what stops a write path shipping with
  nothing proving the harness catches its failure — and it is how the fourth fake arrived, with
  #46's checkpoint write, and the fifth with #61's signed record. The fifth one's red/green pair is
  in `identity-store.test.ts` rather than `harness.test.ts`, because it needs WebCrypto and that
  file imports no platform primitive.
- **A round trip over a *signed* artefact ends in a verification, not a comparison.**
  `assertSignedRecordRoundTrip` verifies the signature on what came back, using only the public key
  inside the record. The rounding fake is why: the record comes back complete, well-formed and
  parseable, and only the signature check notices.

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

⚠️ **This section used to say the question was open and that
`packages/domain/src/workout/` defined the model and no format. A reviewer who remembers that is
reading the old file.** [#202](https://github.com/openzigs/onyourleft/issues/202) settled it and
[ADR 0017](docs/adr/0017-workout-file-format.md) records the decision.

**The de facto format is not adopted.** Its three obstacles were each answered rather than noted,
and the answers are why the decision went the way it did:

- **L1** greps every diff for `zwift`, case-insensitively, and permits a hit only in prose or in an
  exact R3 template instance. An adopted extension would appear in a file picker's `accept` string,
  in an exported filename and probably in a directory name. That is a hit L1 forbids outright, not
  one it invites a defence of. **Under our own format the argument does not arise.**
- **R1** permits taking facts and forbids taking *somebody's compilation* of them as a table, and an
  element set is such a compilation. R1's escape hatch — re-derive from the specification — is
  **closed here**, because there is no published specification and **every open implementation is
  GPL-2.0, GPL-3.0 or AGPL-3.0**, which §3 makes fatal anywhere under `packages/`. That is the
  material difference from FIT, where published documentation existed. **Under our own format R1 is
  not engaged: nothing was consulted.**
- **ADR 0006 R2's provenance** column would have read "recalled". **Under our own format it reads
  `packages/domain/src/workout/workout.ts`, #201**, which is the strongest provenance any format in
  this tree has.

**So `packages/domain/src/workout/format.ts` is the format**, and it is JSON mirroring the model
one-for-one. Four things about it are decisions rather than details:

- **One key, `onYourLeftWorkout: 1`, is both the identity and the version** (D-3). A `format` string
  beside a `version` number can disagree with itself; one key cannot. **The decoder never looks at
  the filename.**
- ⚠️ **An unrecognised key is refused, not ignored** (D-4) — the opposite of the usual convention.
  A future field that changed what a workout *does* would otherwise be dropped silently and the
  rider would ride something else against a machine applying resistance to them. Forward
  compatibility comes from the version number instead. The cost is that an older build refuses a
  newer file wholesale, and that is the intended trade.
- ⚠️ **The format is in `packages/domain`, not `packages/fit`** (D-5). `packages/fit` is where
  *other people's* formats live and its identity is ADR 0006's clean-room posture; a serialisation
  of our own model has none of those questions to declare.
- ⚠️ **`validateWorkout` now bounds the expansion**, and until #202 nothing did: `expandWorkout`
  allocates one entry per segment, and ten thousand interval blocks at `MAXIMUM_REPEATS` is two
  million. The bound is in `validateWorkout` rather than in the decoder **so that it covers a
  hand-edited IndexedDB row as well as a file** — one rule instead of two that can drift.

**What this costs, and it is worth saying plainly: the free library is not bought.** A rider with a
folder of workouts in the de facto format cannot open them here, and this project starts with a
corpus of zero. #14's fifth criterion — *"at least 50 workouts from the existing open ZWO corpus
parse"* — **is not met and is not claimed to be**; ADR 0017 supersedes it. Importing that format is
[#210](https://github.com/openzigs/onyourleft/issues/210), with the licence and corpus questions
attached, and ADR 0017's §"What would make this ADR wrong" says what would reopen it.

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
- **ADRs**: `docs/adr/NNNN-kebab-case.md`, with **Status, Context, Decision, Consequences**. Numbers
  are unique and `ADR001` enforces it. Check `docs/architecture.md` for which numbers are taken
  **and which are claimed by open issues** before you pick one. **Every number from 0001 to 0019 is
  now written and the next free number is 0020** — there is no live reservation. ⚠️ **0019 is
  [ADR 0019](docs/adr/0019-signed-records-in-an-export.md)**, taken by
  [#221](https://github.com/openzigs/onyourleft/issues/221) for how a signed activity record travels
  in an export; a reviewer who remembers this paragraph offering 0018 or 0019 is reading an old one.
  **0018 is [ADR 0018](docs/adr/0018-native-client-platform.md)**, taken by
  [#15](https://github.com/openzigs/onyourleft/issues/15) for the native-client platform question. ⚠️ `0012` **was**
  reserved and is no longer: [#64](https://github.com/openzigs/onyourleft/issues/64) consumed it
  with [ADR 0012](docs/adr/0012-data-licence.md), the data licence, which is the destination
  ADR 0001's *Data* deferral had no number for
  ([#119](https://github.com/openzigs/onyourleft/issues/119)). A reviewer who remembers this
  paragraph telling them to skip 0012 is reading the old one.
- **Spikes**: `docs/spikes/NNNN-kebab-case.md`. A spike write-up is **not an ADR and does not
  decide anything** — it is a dated measurement that an ADR or an issue may then rest on, and it
  ages the way a measurement does. `scripts/check-repo-rules.sh`'s `ADR00*` rules are scoped to
  `docs/adr/` and do not apply. Do not renumber one, and do not edit a finding out of one: if a
  later run contradicts it, that is a second write-up.
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
| What is expected of contributors, and why this is not the Contributor Covenant | [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) |
| Why Dependabot is configured at all, and the one failure it will cause | [`.github/dependabot.yml`](.github/dependabot.yml) |
| Why a link inside a code fence is not a broken link, and what an unclosed fence does | `scripts/check-doc-links.sh` |
| Why a manifest no parser accepts passed every gate for months, and what the XML rule deliberately does not check | `scripts/check-repo-rules.sh` §`XML001`, [#225](https://github.com/openzigs/onyourleft/issues/225) |
| Which lint rule enforces which boundary | [`eslint.config.js`](eslint.config.js) and §4d |
| Why a package's tsconfig narrows `lib` and `types` | `packages/domain/tsconfig.json` and §4d |
| The canonical unit for a quantity, and the conversion into it | [`packages/domain/README.md`](packages/domain/README.md) |
| The signed activity record's format, so a stranger can write a verifier | [`docs/architecture.md`](docs/architecture.md) §"The signed activity record", [ADR 0014](docs/adr/0014-portable-identity.md) |
| What happens to signed records after key loss, and why there is no rotation | [ADR 0014](docs/adr/0014-portable-identity.md) §Consequences, [`packages/store/README.md`](packages/store/README.md) §Identity |
| Where a physics constant came from, and why the tick splits drive from resistance | [`packages/physics/README.md`](packages/physics/README.md) §2, §4 |
| Why a gap in a ride yields no best effort rather than a weak one, and why the library curve is a pointwise maximum | `packages/domain/src/analysis/power-duration.ts` |
| Where the critical-power model comes from, and when it refuses to report a number | `packages/domain/src/analysis/critical-power.ts` |
| What an error message may say about a coordinate, and what it may not | [`packages/domain/README.md`](packages/domain/README.md) §"A coordinate message names the field and the constraint, never the value", [ADR 0004](docs/adr/0004-privacy-and-location.md) decision D |
| Where a FIT profile number came from, and what the decoder does with a bad file | [`packages/fit/README.md`](packages/fit/README.md) §1–§5 |
| Which GPX/TCX schema versions are targeted, what each format loses, and how XXE is refused | [`packages/fit/README.md`](packages/fit/README.md) §7 |
| Why a client must create its athlete row before its first write, and why `putAthlete` is the wrong call | `apps/web/src/local-athlete.ts`, [`packages/store/README.md`](packages/store/README.md) §"`ensureAthlete`", [#184](https://github.com/openzigs/onyourleft/issues/184) |
| How a finished ride becomes an activity, and why the checkpoint is discarded only after it is durable | `apps/web/src/recording/finish.ts`, `apps/web/src/ride/controller.ts` §`saveTheRide` |
| Why a ride the rider already stopped is not offered back to be continued | `apps/web/src/recording/recovery.ts`, `apps/web/src/ride/controller.ts` §`continueRecovered` |
| Why the offer says "up to" a length rather than a length | `apps/web/src/recording/recovery.ts` §"What this deliberately does not read" |
| Why a recorded ride's distance is integrated from speed, and what a dropout does to it | `apps/web/src/recording/finish.ts` §`distanceOf` |
| What a rider is told when a finished ride cannot be added to their activities | `apps/web/src/views/RideView.tsx`, and the four cases in `RideView.test.tsx` |
| What proves an ERG workout's targets survive all the way into a FIT file | `apps/web/src/workout/erg-to-file.test.ts` |
| How a ride is recorded, checkpointed and recovered, and the stated data-loss bound | [`packages/store/README.md`](packages/store/README.md) §"Recording checkpoints", `apps/web/src/recording/recorder.ts`, `README.md` §"If the tab closes mid-ride" |
| What the live ride screen may claim about a trainer, and why a stale metric shows no number | `apps/web/src/ride/controller.ts`, `apps/web/src/ride/metrics.ts`, `apps/web/src/ride/TrainerPanel.tsx` |
| How a bulk import reports a file it cannot read, and what bounds the memory an imported file can ask for | `apps/web/src/transfer/import-batch.ts`, `apps/web/src/transfer/read-activity-file.ts` §`MAXIMUM_IMPORTED_SAMPLES` |
| What an export tells a rider it could not carry, and why altitude can never be the answer | `apps/web/src/transfer/export-activity.ts` §`EXPORT_FAULT_TEXT`, and the finding in `export-activity.test.ts` §"what the file could not carry" |
| How a signed activity record leaves the device, what the manifest says about a ride that has none, and which of the two verify functions applies to an archive | [ADR 0019](docs/adr/0019-signed-records-in-an-export.md), `apps/web/src/transfer/export-everything.ts` §`signedRecordFile`, [`docs/architecture.md`](docs/architecture.md) §"The signed activity record" |
| What the import screen may say about another platform, word for word | [ADR 0009](docs/adr/0009-clean-room-posture.md) R3, `apps/web/src/transfer/TransferView.tsx`, and the assertions in `TransferView.test.tsx` |
| Why the ride detail view reads a stream summary before it reads a sample, and what bounds the points a chart is handed | `apps/web/src/detail/load.ts`, `apps/web/src/detail/series.ts` §`CHART_POINTS` |
| Which zone a reading exactly on a boundary lands in, and why a gap is not zone one | `packages/domain/src/analysis/zones.ts` §"Rule 1", §"Rule 2" |
| Why time in zone does not always sum to a ride's moving time, and what it does sum to | `packages/domain/src/analysis/zones.ts` §"What time in zone sums to", `apps/web/src/analysis/present.ts` §`coverageNote` |
| Where the one threshold default is substituted, and why the store does not substitute it | `apps/web/src/analysis/thresholds.ts`, [`packages/store/README.md`](packages/store/README.md) §"An optional field is not a migration" |
| How many rides a personal-best read decodes, and what happens to the history beyond that | `apps/web/src/analysis/load.ts` §`BESTS_ACTIVITY_LIMIT` |
| Why the analysis screen encodes nothing in colour, and how duration bests are told apart from segment bests | `apps/web/src/views/AnalysisView.tsx` |
| Why the load metrics are not called by the names you know, and what the trademark check found | `packages/domain/src/analysis/load.ts` §"The names are somebody's trademarks" |
| What a ride's load is derived from, why power wins over heart rate, and why a gap is never scored as zero | `packages/domain/src/analysis/load.ts`, `apps/web/src/analysis/load.ts` §`loadFrom` |
| Why a ride stores half a load rather than a whole one, and what goes stale if it stores the whole one | `apps/web/src/analysis/summary.ts`, `packages/store/src/records.ts` §`effortWeightedPower` |
| How the fitness chart is drawn from one store read and no stream decode, and what the backfill control is for | `apps/web/src/analysis/history.ts` §`HISTORY_ACTIVITY_LIMIT`, §`backfillLoadSummaries` |
| Why the fitness series walks the calendar rather than the rides, and what its seeding does not invent | `packages/domain/src/analysis/fitness.ts` §`fitnessSeries`, §`FitnessPoint.warmingUp` |
| Why a malformed day key draws nothing instead of hanging the tab | `packages/domain/src/analysis/fitness.ts` §`dayCount` and the counted loop above it |
| How a rider sets a threshold, why a blank box clears it, and why the refusal is a pure function | `apps/web/src/analysis/thresholds.ts` §`thresholdsToSave`, [`packages/store/README.md`](packages/store/README.md) §"`ensureAthlete`" |
| Why a gap in a trace is a break in the line rather than a straight line across it | `apps/web/src/detail/series.ts` §`traceSegments`, `apps/web/src/detail/TraceChart.tsx` |
| What a *shared* copy of a ride contains, and why the rider's own view is not trimmed | [ADR 0004](docs/adr/0004-privacy-and-location.md) decisions B, C and E, `apps/web/src/detail/privacy.ts`, `apps/web/src/transfer/export-activity.ts` |
| Which origins the map is allowed to reach, and why the style is built rather than fetched | `apps/web/src/map/basemap.ts` §`styleOrigins`, [ADR 0010](docs/adr/0010-map-tiles-and-routing.md) D-1 |
| Why MapLibre is behind a seam, and what that seam does not prove | `apps/web/src/map/port.ts` |
| What a real browser checks that jsdom cannot, and why it shares one CI job | §4f, `apps/web/browser/`, `.github/workflows/rules.yml` |
| Whether a dependency's licence is allowed where it lands, and which licences are ruled on | §4g, [ADR 0015](docs/adr/0015-dependency-licences.md), `scripts/check-dependency-licences.mjs` §`POLICY` |
| Where the basemap URL is configured, and why nothing is configured today | `.env.example` §`VITE_BASEMAP_PMTILES_URL`, [#53](https://github.com/openzigs/onyourleft/issues/53) |
| Which segment-matching approach was chosen, what it measured, and which of its numbers no longer describe the shipped code | [`docs/spikes/0001-segment-matching.md`](docs/spikes/0001-segment-matching.md) and its 2026-09-08 retirement note |
| Why a fixed endpoint radius detects nothing above a 1 s recording interval, and why widening it alone makes things worse | `packages/domain/src/segment/segment.ts` §`endpointReachRadius`, §`nearestEndpointSample`, `docs/spikes/0001-segment-matching.md` §1 |
| Why two paths are resampled before they are compared, and what that assumes | `packages/domain/src/segment/frechet.ts` §`densify` |
| Why an effort's visibility has three values and never two | `packages/domain/src/segment/effort.ts`, `packages/store/src/records.ts` §`SegmentEffortRecord` |
| What actually makes re-matching idempotent, and what the derived effort id buys instead | `packages/store/src/schema.ts` §`STORES_V6`, `packages/store/src/testing/fakes.ts` §`appendingEffortStoreFactory` |
| How a backfill resumes, and why it is a cursor rather than an offset | `apps/web/src/segments/backfill.ts`, `packages/store/src/activity-store.ts` §`startedAfter` |
| Where a device's capability set comes from, and what happens when a device contradicts itself | [`packages/sensors/README.md`](packages/sensors/README.md) §"What a device says it can do", `packages/sensors/web-bluetooth/src/transport.ts` §`declaredBy`, §`noteUndeclared` |
| What a segment matcher may not do, and the prior art the design-around cites | [ADR 0007](docs/adr/0007-patent-posture.md) D-2 and D-6, `docs/spikes/0001-segment-matching.md` §7 |
| Which time basis a segment board ranks by, and why moving time is not it | `packages/domain/src/segment/effort.ts` §`RANKING_BASIS` |
| How two efforts recorded at different rates are compared without truncating either | `packages/domain/src/segment/comparison.ts`, §`overlayEfforts` |
| Why an effort stores no sample indices, and where they come from instead | `apps/web/src/efforts/load.ts` §`sampleIndexAt` |
| Why a route's gradient is three windows rather than one smoothing pass, and what each costs | `packages/domain/src/route/profile.ts`, [`docs/architecture.md`](docs/architecture.md) §"The route profile" |
| Why a lone bad elevation reading never reaches the trainer, and the case where two do | `packages/domain/src/route/profile.ts` §`DESPIKE_WINDOW_METRES`, `profile.test.ts` §"where the despike stage stops working" |
| Why total ascent is accumulated by run rather than by step, and what a median cannot fix | `packages/domain/src/route/profile.ts` §`ASCENT_THRESHOLD_METRES` |
| What happens when a rider passes the end of a loop, and when a route is refused as one | `packages/domain/src/route/profile.ts` §`distanceOnRoute`, §`LOOP_CLOSURE_METRES` |
| Which GPX element a planned route is read from, and which one wins when a file has both | `packages/fit/src/xml/gpx.ts` §`decodeGpx`, `packages/fit/src/route/gpx-route.ts` |
| Why a saved route stores its whole profile where a ride stores half a load | `packages/store/src/records.ts` §`RouteRecord` |
| Where a route's heights came from, and why an absent source is never substituted | `packages/store/src/records.ts` §`RouteRecord.elevation`, `apps/web/src/routing/elevation.ts` |
| Why only two legs are re-routed when a waypoint moves, and what a change-detector gets wrong | `apps/web/src/routing/draft.ts` §`moveWaypoint`, §`insertWaypoint` |
| Why undo stores whole drafts, and why an engine's answer is not a history step | `apps/web/src/routing/history.ts` §`record`, §`settle` |
| Why a route being drawn is kept in `localStorage` and a recording is not | `apps/web/src/routing/draft-storage.ts` |
| Why the drawing canvas is a list of controls before it is a map | `apps/web/src/views/RouteBuilderView.tsx`, §4i |
| Why there is a routing interface and no routing engine | §4i, [ADR 0010](docs/adr/0010-map-tiles-and-routing.md) D-4, `apps/web/src/routing/testing.ts` |
| Why a route exports as a `<trk>` rather than a `<rte>`, and what a head unit has never been asked | [`packages/fit/README.md`](packages/fit/README.md) §8, `packages/fit/src/route/gpx-course.ts` |
| Why an exported route carries an OSM notice even when nothing establishes it came from OSM | `packages/fit/src/route/course.ts` §Attribution, [ADR 0012](docs/adr/0012-data-licence.md) |
| Why a long route is warned about rather than simplified, and where the warning belongs | `packages/fit/src/route/course.ts`, `apps/web/src/routes/export.ts` §`LONG_ROUTE_SAMPLES` |
| Why a TCX course carries a time of zero rather than an estimate | `packages/fit/src/route/tcx-course.ts` |
| Why a saved workout stores its blocks where a route stores its computed profile | `packages/store/src/records.ts` §`WorkoutRecord`, [`packages/store/README.md`](packages/store/README.md) §"Workouts" |
| Why the store re-validates a workout on the way out, and what a decoder that trusted the row would hand a trainer | `packages/store/src/persisted.ts` §`fromPersistedWorkout` |
| Why a target is range-checked twice, and why the brand is not the check | `packages/domain/src/workout/workout.ts` §`assertShare` |
| Why the gradient driver is in `packages/domain` and not beside the control point | `packages/domain/src/trainer/simulation.ts`, [`packages/sensors/README.md`](packages/sensors/README.md) §"Driving simulation mode from a route" |
| Why a stalled trainer drops gradients instead of queueing them, and why the newest survives | `packages/sensors/protocol/src/simulation-writer.ts` |
| Which control point a trainer with two of them is driven through, and what happens when only the proprietary one is there | `packages/sensors/protocol/src/trainer-control-choice.ts` |
| Whether editing a route versions it or overwrites it, and what stops a second tab winning silently | `apps/web/src/routes/save.ts` §`editRoute`, `packages/store/src/records.ts` §`RouteRecord.updatedAt` |
| Why a route that starts inside a privacy zone cannot be shared at all, where a ride can | `apps/web/src/routes/share.ts` §`RouteShare.usable`, §`PUBLIC_ROUTE_WARNING` |
| Where a route's visibility default is applied, and the one place an absent field is substituted | `apps/web/src/routes/save.ts` §`routeFromGpx`, `packages/store/src/persisted.ts` §`fromPersistedRoute` |
| Why the bot's power is a fraction of a flat figure and never a recorded one, and what enforces that | `packages/domain/src/pacer/pacing.ts` §`SyntheticInput`, [ADR 0007](docs/adr/0007-patent-posture.md) D4 |
| What makes "the bot and the rider go through the same physics" a fact about the call graph rather than a comment | `packages/physics/src/pacer.ts` §`advanceBot` |
| Why a bot a full lap ahead reads as a lap ahead rather than as level with you | `packages/domain/src/pacer/gap.ts` |
| Why a workout target is branded, and which two numbers it stops being confused | `packages/domain/src/workout/workout.ts` §`ThresholdShare` |
| Why a workout is expanded into a timeline instead of walked with a cursor | `packages/domain/src/workout/timeline.ts` |
| How the ERG spiral of death is told apart from a rider grinding on purpose | `packages/domain/src/workout/erg-safety.ts` §`assessErgCadence` |
| Why the workout clock keeps running while a target is unacknowledged, and what waits instead | `packages/domain/src/workout/player.ts` §"An interval has not begun until its target is acknowledged" |
| Why a quantised acknowledgement is not a change, and the busy loop that follows from reading it as one | `packages/domain/src/workout/player.ts` §`acknowledge` |
| Which single place rebases the workout offset after a pause, and why the other two do not | `packages/domain/src/workout/player.ts` §`resume` |
| Why a workout player cannot send an FTMS Reset even by mistake | `packages/sensors/protocol/src/erg-writer.ts` §`ErgSink` |
| Why a workout release is `stop()` and never a target of zero, and which object may reach for it | `apps/web/src/workout/session.ts` §`release`, §`WorkoutTrainer` |
| Why a lost trainer link does not close the ERG writer, and what closing it cost | `apps/web/src/workout/session.ts` §`linkLost` |
| Why the session assumes the trainer is already holding something when a workout starts | `apps/web/src/workout/session.ts` §`released` |
| What the #44 simulator proves about the control loop that neither package can prove alone | `apps/web/src/workout/session.test.ts` |
| Why the workout's clock is the ride's clock, and what a second one would drift into | `apps/web/src/ride/controller.ts` §`rideSeconds` |
| Why a workout is anchored on `now()` rather than on the last tick | `apps/web/src/ride/controller.ts` §`startWorkout` |
| Why the ERG trend is judged at the caller's clock and not at elapsed time | `packages/domain/src/workout/player.ts` §"Judged at `now`" |
| Why the ride screen will not start a workout before the trainer grants control | `apps/web/src/ride/WorkoutPanel.tsx`, `apps/web/src/ride/controller.ts` §`startWorkout` |
| Where a typed percentage becomes a share of threshold, and why that has exactly one home | `apps/web/src/workouts/build.ts` §`percentToShare` |
| Why a workout row quotes no watts, no load and no score | `apps/web/src/workouts/library.ts` §`WorkoutRow` |
| Why a workout's shape is a sentence rather than a chart | `apps/web/src/workouts/library.ts` §`WorkoutRow.shape` |
| Why the workout file format is ours rather than the de facto one, and what would reopen that | [ADR 0017](docs/adr/0017-workout-file-format.md), §6 "The workout file format is this project's own" |
| What a workout file contains, and why an unknown key in one is refused rather than ignored | `packages/domain/src/workout/format.ts`, [ADR 0017](docs/adr/0017-workout-file-format.md) D-3, D-4 |
| What stops a workout expanding into two million segments, and why the bound is not in the decoder | `packages/domain/src/workout/workout.ts` §`MAXIMUM_SEGMENTS`, [ADR 0017](docs/adr/0017-workout-file-format.md) D-6 |
| Why a file input's `instanceof File` check does not mean a file was chosen | `apps/web/src/views/WorkoutsView.tsx` §`onImport` |
| Why there is no test helper that attaches a file to a file input | `apps/web/src/testing/mount.tsx` §`submitForm` |
| Why a ghost replays recorded distance rather than re-simulating recorded power | `packages/domain/src/ghost/replay.ts` |
| What stops a ghost being somebody else's ride, and why it is not in the ghost code | `packages/store/src/activity-store.ts` §`listRouteAttempts`, `activity-store.ghost-scope.test.ts` |
| Why the eleventh store fake breaks a read where the other ten break a write | `packages/store/src/testing/fakes.ts` §`unscopedAttemptStoreFactory` |
| Why the simulation derives its step count from the origin rather than accumulating deltas | `apps/web/src/game/simulation.ts`, and the 0.23 m drift recorded in its header |
| What happens to a ride when the phone is backgrounded for five minutes | `apps/web/src/game/simulation.ts` §`MAXIMUM_STEPS_PER_ADVANCE` |
| Why the road is a corridor rather than a world, and where its vertices come from | `apps/web/src/game/terrain.ts`, [ADR 0008](docs/adr/0008-mobile-client-architecture.md) D-5 |
| What the renderer gives up when the phone gets hot, and why recovery is not the same threshold | `apps/web/src/game/quality.ts` §`HEADROOM_RESTORE_BELOW` |
| Why the HUD's panel is opaque, and why that is what makes its contrast checkable | `apps/web/src/design/tokens.ts` §`hudSurface` |
| How a rider tells a dropped sensor from a genuine zero | `apps/web/src/game/hud/fields.ts` §`NO_READING`, `HudPanel.a11y.test.tsx` |
| Why the wake lock's *release* is the half that is tested | `apps/web/src/game/hud/wake-lock.ts` |
| Why the renderer and the HUD are in `apps/web` when their issues say `apps/mobile` | §4h, `apps/mobile/capacitor.config.ts` §`webDir` |
| How the client decides whether it is in a browser or the Android shell | `apps/web/src/support/capacitor.ts`, §4h |
| Why a rider with no heart rate strap is not told their strap has dropped | `apps/web/src/game/sensors.ts`, `apps/web/src/ride/metrics.ts` |
| Which previous attempt a ghost races, and why it is the fastest rather than the latest | `apps/web/src/game/ghost-source.ts` §`fastestAttempt` |
| Why a ghost's distance is integrated from speed, and what a long dropout does to it | `apps/web/src/game/ghost-source.ts` §`GHOST_GAP_TOLERANCE_SECONDS` |
| How trainer control reaches an FTMS control point on Android | `apps/mobile/src/ble/fitness-machine-channel.ts`, `apps/web/src/ride/trainer.ts` §`openCapacitorTrainer` |
| Why the unacknowledged write is declared on the plugin port and never called | `apps/mobile/src/ble/plugin-port.ts` §`writeWithoutResponse`, §4h |
| What a trainer that reports no power range gets, and why | `apps/mobile/src/ble/fitness-machine.ts` |
| What is enforced about Android signing keys, and what is merely written down | [`apps/mobile/RELEASE.md`](apps/mobile/RELEASE.md) §1, `scripts/check-repo-rules.sh` §`REL001` |
| Why ADR 0008's rendering gate was waived, and what that does not cancel | [ADR 0008](docs/adr/0008-mobile-client-architecture.md) §Amendments, 2026-09-08 |
| Which platform the next client is built on, and why there is no desktop one | [ADR 0018](docs/adr/0018-native-client-platform.md) |
| What a person does with a real trainer, in what order, and why the dangerous step is last | [`docs/validation/0001-trainer-and-sensors.md`](docs/validation/0001-trainer-and-sensors.md) |
| What a capture records off real hardware, and the two things it deliberately does not | `apps/web/src/validation/capture.ts`, `apps/web/browser/capture.html` |
| Why an indoor GPX has trackpoints with no coordinates, and what settles whether that is wrong | `packages/fit/src/xml/gpx.ts` §`writeTrackPoint`, `packages/fit/tools/uploads/uploads.test.ts` |
| Which of #15's acceptance criteria can be checked without a phone, and what each of the others needs | [`docs/spikes/0002-background-recording.md`](docs/spikes/0002-background-recording.md) |
| What proves the mobile shell cannot encode a FIT file of its own | `apps/web/src/transfer/cross-client-fixture.ts`, `apps/web/src/transfer/cross-client-fit.test.ts` |
| Why an ANT+ dependency used to pass the rule that bans ANT+ | `scripts/check-repo-rules.sh` §`SCOPE001`, §6 |
| What an athlete gets when they ask for everything, and what the manifest carries | `apps/web/src/transfer/export-everything.ts` §`accountManifest` |
| Why the manifest names its fields instead of spreading the row | `apps/web/src/transfer/export-everything.ts` §`accountManifest` |
| Why the account export's cursor is an instant, and the case it gets wrong | `apps/web/src/transfer/export-everything.ts` §`continueAfter` |
| What a rider is told before erasing a device, and why the signing key is named | `apps/web/src/transfer/erase-device.ts` §`ERASE_CANNOT_REACH`, [ADR 0014](docs/adr/0014-portable-identity.md) D-7 |
| Why erasing needs a typed phrase rather than a second button | `apps/web/src/transfer/erase-device.ts` §`eraseDecision` |
| What proves no store read crosses athletes, and how a new read is caught | `packages/store/src/activity-store.scoping.test.ts` |
| What proves an erased athlete leaves no row behind, and why the table list is derived | `packages/store/src/activity-store.erasure.test.ts`, `packages/store/src/schema.ts` §`SCHEMA_VERSIONS` |
| Which way a payload faces, and why an export is deliberately not trimmed | `apps/web/src/privacy/boundaries.ts`, [#35](https://github.com/openzigs/onyourleft/issues/35) |

<!-- Last updated: 2026-09-09 by delivery:code-issue on #35 (the account export, and the erase that is its pair) -->
