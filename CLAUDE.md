# CLAUDE.md

Instructions for any agent or contributor working in this repository. Read this before touching
anything. Where it disagrees with a general habit you brought with you, this file wins.

It opens with the **always-on rules** (§1, §3, §5–§8), then the essential commands and a map.
Everything else is in [`docs/agents/`](docs/agents/) and in the area `CLAUDE.md` under `apps/web/`,
`apps/instance/`, `apps/mobile/` or `packages/`, which loads when you work there. They carry this
file's authority: read the file the map names before working in its area.

## 1. What this is

**On Your Left** — a free, open alternative to Strava + Zwift for cycling: ride tracking, indoor
smart-trainer control, and live sensor capture over **Bluetooth Low Energy**.

Since ADR 0036 there is a self-hostable server, `apps/instance`; **no issue may take a paid service
as a prerequisite** (ADR 0036 D-7). The rest of §1 is in [`docs/agents/layout.md`](docs/agents/layout.md).

> ⚠️ **The device is canonical, and a rider with no instance loses nothing.** That is the part of
> the old rule that survives, as ADR 0036 D-3's four invariants: (a) no feature that works with no
> instance today may start to require one — `apps/web/src/privacy/no-network.test.ts` admits
> exactly one module for instance traffic (#777) and nothing else; (b) the device copy is never
> deleted on an instance's confirmation (#47); (c) the instance never becomes the only place a
> rider's data is (#776); (d) nothing the client refuses to send leaves through the instance
> (#777). A change that makes any of the four false is a change to an ADR, not a review note.

## 3. HARD RULE — the licence boundary is a **path**

> **Everything under `packages/` is `Apache-2.0`. Everything under `apps/` is
> `AGPL-3.0-or-later`. Without exception.**

Every source file carries an SPDX identifier in its opening lines:

```ts
// SPDX-License-Identifier: Apache-2.0        // anything under packages/
// SPDX-License-Identifier: AGPL-3.0-or-later // anything under apps/
```

**A GPL or AGPL dependency under `packages/` fails CI, and a non-OSI licence (BUSL, SSPL, CC-BY-NC) fails
everywhere.** Where a change lands is a licence question to answer before writing it. The rest of §3
and §3a (`.spdx-exempt`) are in [`docs/agents/licence-boundary.md`](docs/agents/licence-boundary.md).

## 5. The quality gate, in brief

- **Every new code path is covered by a test proven to fail without the change**: mutate the
  implementation, watch the test go red, restore it, and **list each mutation and what went red in the
  PR body**. There is no coverage percentage floor, and you must not invent one.
- **Assert by reading back through the path a real consumer uses**: the dominant defect here is a write
  that reports success while the read cannot see it. Run `git status` before probing a guarantee.
- The full section is [`docs/agents/quality-gate.md`](docs/agents/quality-gate.md) §5.

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

Load-metric trademarks (never `NP`, `TSS`, `IF`, `CTL`, `ATL`, `TSB`), prior art (read GPL code,
never copy it) and the rest of §6: [`docs/agents/scope-and-ip.md`](docs/agents/scope-and-ip.md).

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

## 7. Conventions

- **Sign off every commit.** `git commit -s`. Mandatory, DCO 1.1, no CLA. A commit without a
  `Signed-off-by:` line cannot be merged.
- **PRs** reference the issue they resolve, and carry the mutation list from §5.
- **A closing keyword is fixed when the pull request is OPENED.** Editing the body later does not
  unlink the issue, and it still closes on merge. If a PR must not close an issue, **write `Refs #N`
  in the body you open with**; a closing verb mentioned in prose beside a number counts too.
- **Quote a command in a PR body as run only if you ran it**, with what it printed; say what was skipped.
- There is **no `CHANGELOG.md`** and no changelog convention: do not add one.
- **Versions**: do not bump any version unless the issue asks for it.
- **Do not reformat files you did not come to change.** A drive-by format buries the real diff.
- Branches, ADR numbering and the next free ADR number, and spikes are in
  [`docs/agents/conventions.md`](docs/agents/conventions.md) §7.

### Protected paths — do not edit without an ADR

- `LICENSE` and `LICENSES/Apache-2.0.txt` are byte-identical licence texts (`LIC005`). Never edit them.
- `COPYRIGHT` carries the AGPL §7 app-store permission (ADR 0025): rewording it is a legal act.
- **An ADR's body is never edited.** The one exception is a dated entry appended to its `## Amendments`
  section (ADR 0013); reversing a decision needs a superseding ADR. The reasons are in
  [`docs/agents/conventions.md`](docs/agents/conventions.md).

`.gitignore` un-ignores `.env.example` while ignoring `.env` and `.env.*`. Honour that: a committed
template with placeholder values, real secrets never. **Never `git add -f` past an ignore rule** —
secret scanning with push protection is on, and a pushed commit is permanent regardless of what a
later commit deletes.

**Never commit signing-key material** — a `.jks`, `.keystore`, `.p12`, `.pfx` or `.key` file,
`keystore.properties`, or a `PRIVATE KEY` block in any file (`REL001`). A pushed key cannot be
un-published by a later commit.

## 8. Known gotchas

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

**Keep pnpm's supply-chain controls on.** A release under a day old is refused: pin an older version,
never add a `minimumReleaseAgeExclude`, which turns the check off for that package for good.
`allowBuilds` in `pnpm-workspace.yaml` is security-relevant: answer each install script deliberately,
and never set one to `true` to make an install pass ([`toolchain.md`](docs/agents/toolchain.md) §8).

**Read the issue's revision block first.** Most issue bodies in this repository predate owner
decisions D2, D5 and D6 (D6 itself since superseded by ADR 0036), and several state things that are
now false — including "#18 is still open" (it is merged), "there is no server" (there is:
`apps/instance`) and package layouts that include `apps/api` or ANT+. The quoted revision block at the
top of an issue **supersedes its body**.

---

## 4. Commands

Every command and what it enforces is [`docs/agents/commands.md`](docs/agents/commands.md) §4a; what CI
runs is [`docs/agents/ci.md`](docs/agents/ci.md) §4c. The ones nearly every change needs:

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

## How these instructions are organised

> ⚠️ **Do not add detail here.** Every session loads this file on every turn: its budget is
> **15 KB** (`AGENT002`), an area `CLAUDE.md`'s 8 KB (`AGENT003`). Detail goes in the topic or area
> file; a new topic gets one map line. The map says where each cited section (§1–§9) now lives.

### Topic map

- [commands.md](docs/agents/commands.md) §4a: any other command; what each check enforces
- [project-state.md](docs/agents/project-state.md) §4b: before claiming something exists or works; a new dependency
- [ci.md](docs/agents/ci.md) §4c: workflows, gates, timeouts, the nightly job
- [lint-boundaries.md](docs/agents/lint-boundaries.md) §4d: cross-package imports, eslint, tsconfigs, platform-free packages
- [accessibility.md](docs/agents/accessibility.md) §4e: routes, views, tokens, contrast, `*.a11y.test.*`
- [browser-gate.md](docs/agents/browser-gate.md) §4f: `apps/web/browser/`, Playwright, layout, the map, offline
- [licence-gates.md](docs/agents/licence-gates.md) §4g: a dependency added or bumped; third-party notices
- [game.md](docs/agents/game.md) §4h: the trainer game, `apps/web/src/game/`
- [route-planning.md](docs/agents/route-planning.md) §4i: route planning
- [wiring-gate.md](docs/agents/wiring-gate.md) §4j: `game/`, `ride/`, `offline/`, `net/`, `*-port.ts`, the trainer-command seam
- [generated-and-cost-gates.md](docs/agents/generated-and-cost-gates.md) §4k, §4l: Capacitor bumps; `docs/cost-model.md`
- [web-client.md](docs/agents/web-client.md) §2: `apps/web` outside `src/game/`
- [mobile.md](docs/agents/mobile.md) §2: `apps/mobile`
- [instance.md](docs/agents/instance.md) §2: `apps/instance`
- [packages.md](docs/agents/packages.md) §2: `packages/`
- [layout.md](docs/agents/layout.md) §1, §2: the rest of §1; the top-level tree
- [licence-boundary.md](docs/agents/licence-boundary.md) §3, §3a: licence classes, scanned file types, `.spdx-exempt`
- [quality-gate.md](docs/agents/quality-gate.md) §5: tests, the mutation list, the defect shape
- [coverage.md](docs/agents/coverage.md) §5: the coverage report
- [store-harness.md](docs/agents/store-harness.md) §5: testing persistence
- [scope-and-ip.md](docs/agents/scope-and-ip.md) §6: metric names, prior art, Garmin, `SCOPE001`
- [workout-format.md](docs/agents/workout-format.md) §6: the workout file format
- [conventions.md](docs/agents/conventions.md) §7: branches, ADRs and the next free number, spikes, protected paths
- [adr-numbering.md](docs/agents/adr-numbering.md) §7: which ADR numbers were taken
- [toolchain.md](docs/agents/toolchain.md) §8: toolchain pins, pnpm, install scripts, auto-pause
- [web-bluetooth.md](docs/agents/web-bluetooth.md) §8: what Web Bluetooth cannot do
- [agent-docs.md](docs/agents/agent-docs.md) how these files are arranged; the `AGENT` rules
- [where-to-look.md](docs/agents/where-to-look.md) §9: which file answers a question (grep it)
