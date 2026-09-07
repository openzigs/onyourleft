# ADR 0015: Dependency licences — two closures, and a ruling on the six that were deferred

- **Status**: Accepted
- **Date**: 2026-09-07
- **Deciders**: the author, as engineering work. This ADR does not overturn an owner decision and
  does not need one: it **discharges a deferral** that [ADR 0001](0001-licence.md) left open and
  that `CLAUDE.md` §3 has carried as *"not ruled on yet"* since the licences in question first
  entered the tree. Where the existing rule is unambiguous — GPL and AGPL anywhere under
  `packages/` — this ADR keeps it exactly as written rather than relaxing it, and D-3 says so in
  terms
- **Issue**: [#24](https://github.com/openzigs/onyourleft/issues/24), part 2
- **Number**: **0015**. `0012` is reserved for [#64](https://github.com/openzigs/onyourleft/issues/64)'s
  data-licence decision, `0013` is the amendment convention and `0014` is portable identity, so
  0015 is the next free number — the check `CLAUDE.md` §7 asks for before one is taken
- **Supersedes**: nothing
- **Constrains**: every future dependency addition, in every package; and
  [#85](https://github.com/openzigs/onyourleft/issues/85)'s Android work, which is the next place a
  new dependency closure arrives
- **Relates to**: [ADR 0001](0001-licence.md), whose *Constraints* item 3 states the rule this makes
  checkable

---

## Context

ADR 0001 put the licence boundary on a **path**: everything under `packages/` is Apache-2.0,
everything under `apps/` is AGPL-3.0-or-later. `CLAUDE.md` §3 calls it the HARD RULE and explains
why a path is the right shape — it can be checked mechanically, and it "cannot be silently
mis-declared the way a manifest field can".

That is enforced today for the code we write: `scripts/check-repo-rules.sh` checks the SPDX header
on every source file (`LIC001`/`LIC002`), the manifest field (`LIC003`), and the presence of a
per-package `LICENSE` (`LIC004`), and `check-licence-hashes.sh` checks those licence texts are
byte-identical to the canonical ones (`LIC005`).

**None of that looks at a dependency.** ADR 0001's *Constraints* item 3 says "#23 must not add a
dependency whose licence conflicts with the package it lands in", and nothing has ever checked it.
The direction the rule exists to protect against is precisely the one left open: a GPL dependency
inside an Apache-2.0 leaf package is a licensing incident, and it arrives looking like a version
bump. #24 records two live examples, neither visible in a diff — `webbluetooth` publishes
**licence-variant majors** (3.x MIT, 4.x BSD-3, 5.x GPL-3.0, 6.x BUSL-1.1), and `flutter_blue_plus`
relicensed from BSD-3 to a proprietary licence between versions.

### What blocked the check was a classification, not a script

`CLAUDE.md` §3 names six licences in the tree that no decision covers: `MPL-2.0` (via
`lightningcss`), `BlueOak-1.0.0` (`lru-cache`, `minimatch`), `CC0-1.0` (`mdn-data`) and `MIT-0`
(two `@csstools` packages). None is GPL or AGPL and none is non-OSI, so nothing is violated — but a
gate cannot be written against "not ruled on yet". §3 hands the ruling to this issue explicitly.

§3 also records the trap that shapes the answer: **all six reach `packages/*` through Vitest**, not
only `apps/web`, so "the MPL one is under `apps/`" is false and an allowlist written on that premise
"would scope itself to the wrong tree and pass vacuously".

### Two measurements this decision rests on

Both taken on 2026-09-07 with `pnpm licenses list --json --filter <pkg> [--prod]`, and both
reproducible with the checker this ADR authorises.

**1. The distributed closures are tiny and already entirely permissive.**

| Package | Production dependencies | Licences |
|---|---|---|
| `packages/domain` | 0 | — |
| `packages/fit` | 0 | — |
| `packages/physics` | 0 | — |
| `packages/sensors` | 0 | — |
| `packages/store` | 1 | Apache-2.0 |
| `apps/web` | 28 | MIT, BSD-2-Clause, BSD-3-Clause, ISC, `(MIT OR Apache-2.0)` |

**2. The build-time closures are ~100 packages each and carry an identical licence set** — every
one of the six deferred licences, in every package, exactly as §3 predicted.

So the two closures are not a theoretical distinction: they are the difference between a table with
nothing awkward in it and a table with all six.

### Why the closure is the right axis

A licence's obligations attach to what is **distributed**. A test runner is not shipped to anyone;
a bundled library is. The same identifier can therefore be unremarkable in one closure and wrong in
the other, and a single repo-wide allowlist has to be either too loose or too tight — which is #24's
own objection to one, and its reason for saying "both failure modes are worse than no check, because
they teach people to ignore the gate."

---

## Decision

### D-1 — The distributed closure is governed strictly by the path

A dependency reachable from a package's **production** dependencies is judged by the tree the
package sits in:

| Path | Admitted in a distributed closure |
|---|---|
| `packages/*` (Apache-2.0) | **Permissive only**: `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `Apache-2.0`, `ISC` |
| `apps/*` (AGPL-3.0-or-later) | The permissive set, **plus** the D-2 set, **plus** GPL/LGPL/AGPL |

### D-2 — The six deferred licences are permitted at build time, and not in a shipped leaf package

`MPL-2.0`, `BlueOak-1.0.0`, `CC0-1.0`, `MIT-0` and `0BSD` are **admitted in the build-time-only
closure under either path**, and in a distributed closure **under `apps/` only**.

`0BSD` is included although it is not in the tree today: §3 names it in the same breath as the other
five as unruled, so leaving it out would leave the deferral half-discharged.

The reasoning is the closure axis above. At build time nothing is distributed, so no obligation
attaches and the file-level copyleft in `MPL-2.0` has nothing to bite on. In a distributed
Apache-2.0 leaf package it does: those packages exist to be droppable into someone else's project,
and a shipped MPL-2.0 file carries obligations the package's own `LICENSE` does not describe. Under
`apps/` the artefact is AGPL-3.0-or-later and a weaker file-level obligation changes nothing.

This is a **ruling on a real question, not a rubber stamp**: it admits all six where they actually
are, and forbids the same six in the one position that would make an Apache-2.0 leaf package's
licence statement misleading. Today no package is in that position, which is what makes it cheap to
adopt now rather than after something is.

### D-3 — GPL and AGPL under `packages/` stay forbidden in **both** closures

`CLAUDE.md` §3 is unambiguous: *"A GPL or AGPL dependency anywhere under `packages/` fails CI. If a
package needs one, the code moves to `apps/` or the dependency is replaced. There is no third option
and no exemption."*

The distributed-artefact argument in D-2 would, taken alone, permit a GPL build-time tool inside an
Apache-2.0 package. **This ADR deliberately does not go there.** Reversing a rule stated that
emphatically is a decision for the owner, not a side effect of writing a checker, and nothing in the
tree needs it: there is no GPL or AGPL dependency in any closure of any package today. If a future
issue wants that relaxation it is a superseding ADR with the owner in the loop, per `CLAUDE.md` §7.

### D-4 — Non-OSI fails everywhere, and anything unrecognised fails closed

BUSL, SSPL, CC-BY-NC and "commercial use requires a licence" fail in every closure under every path,
as §3 already says.

**A licence that appears in none of the tables is a violation, not a pass.** The gate exists for the
licence nobody has considered yet, so "unrecognised" has to be the failing branch. The cost is one
line in this ADR and a reviewer's attention when a genuinely fine but unnamed licence arrives, and
that is the intended price rather than a rough edge. `MIT WITH <exception>` and any other SPDX form
the evaluator does not implement fall here too.

### D-5 — SPDX expressions are evaluated, not string-matched

`OR` passes if **any** operand is admitted — a dual-licensed package lets the recipient choose.
`AND` passes only if **every** operand is admitted — a combined work imposes all of them at once.
Parentheses group. `(MIT OR Apache-2.0)` is in `apps/web`'s distributed closure today via
`@maplibre/mlt`, so this is a form the gate meets on its first run rather than a hypothetical.

Getting the two operators the wrong way round would admit `MIT AND BUSL-1.1`, so both directions are
tested.

### D-6 — The check reads pnpm's own resolution, and covers every package by construction

The closures come from `pnpm licenses list --json --filter <pkg> [--prod]` rather than a hand-rolled
walk of `node_modules`. §3 records why the obvious alternative is worthless: a clean
`require.resolve` probe "is not evidence of anything", because under pnpm's isolated `node_modules`
it returns *not resolvable* for every transitive dependency.

⚠️ **`--filter` does not follow workspace links, and that was measured rather than assumed.**
`apps/web` declares `@onyourleft/store` as a production dependency and `store` declares `dexie`, yet
`dexie` does not appear in `--filter @onyourleft/web --prod`. It appears under
`--filter @onyourleft/store --prod` — which is where the licence question belongs, because `dexie`
lands in `store` and `store`'s path is what governs it.

The consequence is a requirement, not a footnote: **the union over every workspace package is what
makes the check complete.** The package list is therefore *discovered* from the workspace, and a
discovery that returns nothing is a failure rather than a clean run. A hard-coded list would stop
covering a package the day someone adds one — the vacuous-pass shape this repository has now shipped
five separate times.

---

## Consequences

**A dependency addition is now checked rather than reviewed.** `CONTRIBUTING.md` asks a contributor
to check a licence against the directory it lands in; that instruction is now backed by a gate, so
getting it wrong is a red build rather than something a reviewer has to notice.

**The tables live in two places on purpose, and they can drift.** The prose is here; the
machine-readable copy is `POLICY` in `scripts/check-dependency-licences.mjs`. A name added to one
and not the other is a real hazard, and nothing mechanically prevents it — the script says so where
the table is defined, and the failure message names this file. That is a weaker guarantee than the
SPDX-header rules get, and it is recorded rather than papered over.

**A new licence stops the build until somebody rules on it.** By design (D-4), and the friction is
the point. It will happen the first time a dependency arrives carrying `Unlicense` or `Zlib`, both
of which are perfectly fine and neither of which is in a table.

**The gate cannot see a licence pnpm reports wrongly.** It reads the `license` field each package
publishes. A package that declares MIT and vendors GPL code inside itself passes, and no automated
check at this layer would catch that. This is a real limit and it is the reason the ADR-0006 posture
toward `packages/fit` exists separately.

**It costs about eight seconds and needs an install**, so it is not part of `pnpm run check:repo`
(the bare-clone set) and is its own CI step, the same shape as the accessibility-suite check.

**Nothing in the tree changes.** The first run reported 659 dependency licences across 6 workspace
packages, all permitted where they land. That is the expected result: this ADR writes down a rule
the repository was already following by hand, at the moment the hand-checking became the weak part —
five dependencies were added across #175 and #176 alone, each verified in prose in a pull-request
body.

## Notes

This ADR is an engineering decision recorded by an engineer. It is not legal advice. The place a
lawyer would genuinely add value here is D-2's treatment of `MPL-2.0` in a distributed Apache-2.0
package — the conservative reading is taken (forbidden), so the risk of being wrong is friction
rather than exposure.
