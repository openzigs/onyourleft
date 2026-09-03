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
ride, store it, view it. **No server, no account, no hosting bill.** A server arrives in Phase 3 with
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
  mobile/             Capacitor shell wrapping the same web build (#85; Phase 4)

packages/             Apache-2.0, without exception
  domain/             units, core types, validation, signing, analysis (#25)
  fit/                FIT / GPX / TCX codec (#29-#32)
  sensors/            sensor abstraction and BLE transport (#39-#44) — BLE only
  physics/            cycling power/speed model, Martin et al. 1998 (#88)
  store/              local activity and stream store (#27)

docs/
  architecture.md     layout, component boundaries, ADR index
  adr/                numbered architecture decision records

scripts/              dependency-free repository checks; run on a bare clone

.github/
  workflows/rules.yml runs those checks on every pull request — see §4c
```

**`apps/web` and `packages/domain` exist**, created by
[#23](https://github.com/openzigs/onyourleft/issues/23) along with the workspace, the toolchain and
the lockfile. The other four packages and `apps/mobile` do **not** — each is created by the issue
that owns its content (§4b), from `packages/domain` as the template. The layout is fixed here
because ~30 sub-issues reference it by name, and the workspace globs and lint boundaries already
cover the paths, so a package arrives inside the rules rather than beside them.

| Package | Purpose | Must not depend on |
|---|---|---|
| `packages/domain` | Canonical units and types; every conversion in the program goes through it. Also signing/verification and analysis, because those must run identically on the device and on an instance. | **Any platform API at all** — no DOM, no Node globals, no I/O, no network types |
| `packages/fit` | FIT / GPX / TCX decode and encode | Anything server-specific; anything under `apps/` |
| `packages/sensors` | BLE sensor and trainer abstraction, and the Web Bluetooth transport | Anything server-specific. Web Bluetooth types must not escape above the transport boundary |
| `packages/physics` | Power → speed. Pure computation. | Any rendering, BLE or platform API |
| `packages/store` | Local activity and stream persistence | Anything under `apps/` |

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

### 4a. Works today — executed and observed to succeed on 2026-09-03

**Bare clone — bash and coreutils only, no install, no network:**

```bash
# Enforce the repository rules that are checkable by path.
# Exits 0 clean; exits 1 listing each violation by rule id.
bash scripts/check-repo-rules.sh

# Test the checker itself. Fixture-driven; 27 cases.
bash scripts/check-repo-rules.test.sh

# Verify the licence texts are byte-identical to the canonical ones, by
# reproducing the two SHA-256 digests recorded in docs/adr/0001-licence.md.
# The digests are read out of the ADR rather than duplicated in the script, and
# a required digest that is missing fails — checking nothing is not a pass.
bash scripts/check-licence-hashes.sh

# Test that checker. Fixture-driven; 11 cases.
bash scripts/check-licence-hashes.test.sh

# Every environment variable the code reads is listed in .env.example.
# Exits 1 naming the file and the variable. A missing .env.example also fails —
# a template that is not there documents nothing.
bash scripts/check-env-example.sh

# Test that checker. Fixture-driven; 15 cases.
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

# tsc --noEmit followed by `vite build`, for apps/web. A green typecheck is not
# a green build: the bundler resolves imports the typechecker only reads types
# from, so run this before claiming a change compiles.
pnpm run build

# One package at a time, which is how you check a single package's harness:
pnpm --filter @onyourleft/domain run test
pnpm --filter @onyourleft/web run test

# All six bare-clone script checks in one command.
pnpm run check:repo
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
| `LIC004` | a package under `packages/` has no `LICENSE` file of its own |
| `SCOPE001` | ANT+ is referenced anywhere in a source tree (see §6) |
| `WF001` | `pull_request_target` appears in a `.github/workflows/` file (see §8) |
| `ADR001` | two ADRs share a number |
| `ADR002` | an ADR filename is not `NNNN-kebab-case.md` |

`scripts/check-licence-hashes.sh` enforces one more, separately because it hashes files rather than
reading paths:

| Rule | Fails when |
|---|---|
| `LIC005` | a licence text no longer matches the SHA-256 digest ADR 0001 records for it, **or** ADR 0001 no longer records a digest for one of them |

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

### 4b. Does **not** exist yet

> ⛔ **None of the following runs today.** Do not copy these into a PR description as though you had
> run them, and do not add them to a CI workflow before the issue that owns them lands.

- **`apps/mobile`, `packages/fit`, `packages/sensors`, `packages/physics`, `packages/store`.** The
  workspace globs (`apps/*`, `packages/*`) will pick each up the moment it appears, and the boundary
  and header rules already apply to its path — but the directories do not exist. They are created by
  the issues that own their content: [#29](https://github.com/openzigs/onyourleft/issues/29),
  [#39](https://github.com/openzigs/onyourleft/issues/39),
  [#88](https://github.com/openzigs/onyourleft/issues/88),
  [#27](https://github.com/openzigs/onyourleft/issues/27) and
  [#85](https://github.com/openzigs/onyourleft/issues/85). Copy `packages/domain` as the template: a
  manifest, a `LICENSE`, a `tsconfig.json`, a `vitest.config.ts` and a test.
- **A per-package dependency-licence gate.** Nothing yet checks that a dependency's *own* licence is
  permitted under the path it lands in — only that the manifests and headers declare the right
  thing. `pnpm licenses list --json` exists and is unused. Second half of
  [#24](https://github.com/openzigs/onyourleft/issues/24).
- **A coverage gate demonstrated to fail.** Coverage is reported and nothing enforces it, which is
  §5's deliberate design; what #24 still owes is the demonstration that the report is real.
- **`dexie`, `react-router` and the rest of the runtime dependency list in ADR 0005.** Only the
  toolchain, React 19, React DOM and Vite are installed. Add each in the issue that first needs it,
  after checking its licence against the directory it lands in (CONTRIBUTING.md).
- **`apps/api`, or anything else server-shaped.** Not "not yet" — not in Phase 1 at all. Owner
  decision D6.

### 4c. What CI runs, and what it deliberately does not

[`.github/workflows/rules.yml`](.github/workflows/rules.yml) runs on every pull request and on every
push to `main`. It runs **exactly** the §4a commands and nothing else: the six bare-clone script
checks, `shellcheck scripts/*.sh`, then `pnpm install --frozen-lockfile`, `format:check`, `lint`,
`typecheck`, `test:coverage` and `build`. If CI ever needs a step this file does not list, **this
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
| `@typescript-eslint/no-restricted-imports` in `packages/domain` | naming a Node builtin, `react`, `react-dom`, `vite` or `dexie` |
| `no-restricted-globals` in `packages/domain` | naming `window`, `document`, `navigator`, `localStorage`, `process`, `Buffer` or `__dirname` |

`packages/domain/tsconfig.json` narrows `lib` to `ES2024` and sets `types: []`, which makes the
*globals* compile errors as well. **It does not make the imports compile errors** — `types: []`
suppresses automatic inclusion of `@types` packages, but an explicit `import … from 'node:fs'` still
resolves through the workspace root's `@types/node`. That is why both mechanisms are configured and
why removing either leaves a hole.

When `packages/sensors` and the routing work arrive, their boundaries (#39, #40, #70) go in the same
file, as more `boundaries/dependencies` policies.

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

### The defect shape to hunt

The dominant failure in this program's persistence work is **a write that reports success while the
read cannot see it**, from four causes: *wrong storage* (it landed in a cache or a different key
prefix), *wrong layer* (acknowledged at the edge, nothing below persisted), *wrong time* (written
after the read, or in a transaction that never committed), *wrong harness* (the test asserted against
the object it just constructed rather than a fresh read).

**Always assert by reading back through the same path a real consumer uses.** Line coverage cannot
see any of these, which is part of why §5 has no percentage in it.

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
  message** is in scope.
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
- **ADRs**: `docs/adr/NNNN-kebab-case.md`, with **Status, Context, Decision, Consequences**. Numbers
  are unique and `ADR001` enforces it. Check `docs/architecture.md` for which numbers are taken
  **and which are claimed by open issues** before you pick one.
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
| `docs/adr/*.md` | An ADR is amended by a **new** ADR that supersedes it, not by editing it in place. |

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
programmatically; there is **no silent reconnect**; it is unavailable in Web Workers; and there is no
background operation. **Plan for ~3 concurrent connections**, not 7. Do not design a UI that hides
any of this.

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

<!-- Last updated: 2026-09-03 by delivery:code-issue resolving #23 (workspace, toolchain and quality gates) -->
