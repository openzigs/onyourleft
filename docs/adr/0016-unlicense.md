# ADR 0016: `Unlicense` joins the weak-and-permissive set, at build time only

- **Status**: Accepted
- **Date**: 2026-09-08
- **Deciders**: the repository owner, on the question ADR 0015 D-4 said would need answering the
  first time an unclassified licence arrived. Drafted as engineering work; the ruling is the
  owner's, because §3 makes a dependency's licence a question answered **before** the code is
  written rather than settled in review
- **Issue**: [#87](https://github.com/openzigs/onyourleft/issues/87), which is the change that
  brought the licence into the tree
- **Number**: **0016**. Every number from 0001 to 0015 was written and `CLAUDE.md` §7 recorded 0016
  as the next free one with no live reservation — the check §7 asks for before a number is taken.
  The same pull request moves that sentence, and `docs/architecture.md`'s index, on to 0017
- **Supersedes**: nothing
- **Extends**: [ADR 0015](0015-dependency-licences.md) D-2, by adding one name to its set. It
  **reverses nothing**: every rule in 0015 stands exactly as written, D-3's prohibition included
- **Relates to**: [ADR 0001](0001-licence.md), whose *Constraints* item 3 is the rule both ADRs make
  checkable

---

## Context

ADR 0015 built the dependency-licence gate and closed it against the unknown. Its D-4 says why, and
predicted this ADR in the same breath:

> **A licence that appears in none of the tables is a violation, not a pass.** The gate exists for
> the licence nobody has considered yet, so "unrecognised" has to be the failing branch. The cost is
> one line in this ADR and a reviewer's attention when a genuinely fine but unnamed licence arrives,
> and that is the intended price rather than a rough edge.

`CLAUDE.md` §4g goes further and names the licence: *"A perfectly fine but unnamed licence
(`Unlicense`, `Zlib`) will stop the build until someone adds it to ADR 0015 **and** to `POLICY` in
the script."*

That happened on 2026-09-08. #87 adds Capacitor to `apps/mobile`, and `pnpm run check:licences`
refused the install:

```
DEP001: @onyourleft/mobile (apps/mobile): big-integer is Unlicense, which is not permitted in
        the build-time closure of an AGPL-3.0-or-later application
DEP001: @onyourleft/mobile (apps/mobile): stream-buffers is Unlicense, which is not permitted in
        the build-time closure of an AGPL-3.0-or-later application
```

**This is the gate working, not a defect in it.** It stopped a licence nobody had ruled on from
entering the tree unexamined, which is the whole of what D-4 bought.

### What was measured, on 2026-09-08

Both packages declare `Unlicense` in their published `license` field, read with `npm view`:

| Package | Version | Licence | How it arrives |
|---|---|---|---|
| `big-integer` | 1.6.52 | `Unlicense` | `@capacitor/cli` → `xcode` → `simple-plist` → `bplist-parser`; and → `native-run` → `bplist-parser` |
| `stream-buffers` | 2.2.0 | `Unlicense` | `@capacitor/cli` → `xcode` → `simple-plist` → `bplist-creator` |

Two facts about where they sit, both checked rather than assumed:

1. **Neither is in a distributed closure.** `pnpm licenses list --json --prod --filter
   @onyourleft/mobile` returns five packages and contains neither. They reach the tree only through
   `@capacitor/cli`, which is a `devDependency` — a tool that generates and syncs the native project
   and ships in nothing.
2. ⚠️ **Both arrive through iOS tooling specifically.** `xcode` and `simple-plist` exist to write
   Xcode project files and binary property lists. This project has **no iOS path at all** — §6
   records that as part of owner decision D2's reasoning — so these two packages will never execute
   here. That is a reason the ruling is cheap, and deliberately **not** the reason it is correct: a
   licence classification that depended on "we do not run that code path" would have to be revisited
   the day somebody did.

### What `Unlicense` is

A public-domain dedication with a permissive fallback licence, **OSI-approved**. It imposes no
attribution requirement, no notice-retention requirement and no copyleft. Against the sets ADR 0015
already rules on, it is **strictly more permissive than `0BSD`** — which D-2 admits and which at
least requires nothing beyond what Unlicense requires — and it is the same shape as `CC0-1.0`, also
already admitted: a public-domain-equivalent dedication rather than a licence that grants terms.

⚠️ **Its weakness is legal rather than technical, and it is why this ADR is narrow.** Public-domain
dedications are not uniformly effective in every jurisdiction — some do not permit an author to
abandon copyright — which is why the Unlicense carries a fallback grant and why the FSF has
criticised its drafting. The practical consequence for this repository is nil at build time and
non-nil in a shipped Apache-2.0 leaf package, which is exactly the axis ADR 0015 D-2 already splits
on. So this ADR splits it the same way rather than inventing a new distinction.

---

## Decision

### D-1 — `Unlicense` joins ADR 0015 D-2's set

`Unlicense` is admitted **in the build-time-only closure under either path**, and in a distributed
closure **under `apps/` only**. It is added to `POLICY.weak` in
`scripts/check-dependency-licences.mjs`, which is the machine-readable copy of D-2's set.

The set named by ADR 0015 D-2 therefore reads, in full: `MPL-2.0`, `BlueOak-1.0.0`, `CC0-1.0`,
`MIT-0`, `0BSD`, **`Unlicense`**.

`Unlicense` sits in `weak` rather than `permissive` **although it is more permissive than most of
that list**, and the placement is deliberate. `permissive` in ADR 0015 is `CLAUDE.md` §3's list
verbatim — a stable, quotable set that the HARD RULE names — and growing it silently would make §3
and the script disagree about what §3 says. `weak` is the set ADR 0015 created for "ruled on here",
which is what this is. The name is a slight misfit for a public-domain dedication; the alternative
was worse.

### D-2 — This changes nothing about a distributed `packages/*` closure

`Unlicense` is **forbidden in a distributed closure under `packages/`**, exactly as the other six
are. An Apache-2.0 leaf package exists to be droppable into someone else's project, and a
public-domain dedication whose effectiveness varies by jurisdiction is not something that package's
own `LICENSE` describes. Nothing in the tree is in that position today and nothing in #87 puts
anything there.

### D-3 — Every other rule in ADR 0015 stands unchanged

D-1's path table, D-3's prohibition on GPL and AGPL under `packages/` in both closures, D-4's
fail-closed branch and D-5's SPDX-expression evaluation are untouched. This ADR adds a member to one
set. **The next unclassified licence still fails the build**, which is the property worth keeping.

---

## Consequences

**What this buys.** `apps/mobile` can take `@capacitor/cli` as a pinned devDependency, so the tool
that generates the native project is reproducible from the lockfile rather than being whatever npm
serves on the day — which is `CLAUDE.md` §8's posture on supply-chain pinning applied to a build
tool.

**What it costs.** One more name that a reader of §3's HARD RULE will not find there, and has to
follow a link to. ADR 0015 already created that cost; this widens it by one.

**What it does not decide.** `Zlib` — named alongside `Unlicense` in §4g as the other plausible
unclassified arrival — is deliberately **not** ruled on here. Nothing in the tree carries it, and
ruling on a licence nobody has met is how a table grows entries nobody checked. It fails closed
until something needs it, which is D-4 working as designed.

**A reviewer's check.** ADR 0015's own §Consequences asks that the ADR and `POLICY` be changed
together, because "adding a name here without amending the ADR is how the two drift". This ADR and
that one-line `POLICY` change are in the same pull request, and
`scripts/check-dependency-licences.test.sh` gains a case that goes **red** for a distributed
`packages/*` closure carrying `Unlicense` as well as one that passes at build time — because a
policy entry with only a passing test is an entry nobody has watched fail.
