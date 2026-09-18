# ADR 0023: CC-BY is admitted for committed assets, and the attribution lives in the app

- **Status**: Accepted
- **Date**: 2026-09-18
- **Deciders**: the repository owner, who ruled on
  [#357](https://github.com/openzigs/onyourleft/issues/357) — *"I would prefer if use better looking
  models for the scenery as well even if that means attributing it to the author… I don't want to
  pay for models."* The ruling is the owner's because it accepts a **continuing obligation** where
  [ADR 0022](0022-game-scenery-model-pack.md) had accepted only a one-off one, and because
  `CLAUDE.md` §3 makes a licence question answerable **before** the code is written. Everything
  below the ruling is the author's, following from it: which identifier is admitted and which two
  letters away is not, where the attribution has to be reachable from, what
  [`ASSETS.toml`](../../ASSETS.toml) carries so that it can be generated rather than maintained, and
  what is deliberately left unchanged
- **Issue**: [#357](https://github.com/openzigs/onyourleft/issues/357), under epic
  [#240](https://github.com/openzigs/onyourleft/issues/240)
- **Number**: **0023**. 0021 is a live reservation held by
  [#330](https://github.com/openzigs/onyourleft/issues/330) and still unwritten, 0022 was taken by
  [#340](https://github.com/openzigs/onyourleft/issues/340); [`docs/architecture.md`](../architecture.md)'s
  reservation table is the check `CLAUDE.md` §7 asks for and it said 0023 was free
- **Supersedes**: nothing
- **Extends**: [ADR 0015](0015-dependency-licences.md) D-2's closure-and-path reasoning to a
  **third** licence class — one that asks for something back — in the **asset** gate only. It
  changes neither ADR 0015's tables nor the dependency checker they govern, and **D-5 says why that
  is a decision rather than an omission**
- **Relates to**: [ADR 0022](0022-game-scenery-model-pack.md), whose D-2 author boundary and D-5
  path rule both survive unchanged — see D-6; and [ADR 0016](0016-unlicense.md), whose shape this
  follows exactly: a licence arrived, a gate stopped the build, an ADR ruled on it in the same pull
  request

---

## Context

[ADR 0022](0022-game-scenery-model-pack.md) adopted one CC0 model pack for the game's scenery, and
chose CC0 partly *because* it asks for nothing:

> *"There is **no third party to credit**, and no third party whose terms could change"*

The owner has now looked at the result and ruled that better-looking models are worth an attribution
obligation. That is a different trade from the one ADR 0022 made, and it is why this is an ADR
rather than a one-line edit to a shell variable.

### The gate already anticipated this exact moment

[`scripts/check-repo-rules.sh`](../../scripts/check-repo-rules.sh), where the asset licence sets are
defined, said so in as many words before any CC-BY asset existed:

> *"`CC-BY-4.0` is absent for the same reason — nothing in the tree needs it, and **a licence nobody
> has an asset for is a licence nobody has read**"*

That condition has arrived, so the licence gets read. This is the same path `Unlicense` took: it
entered the tree with [#87](https://github.com/openzigs/onyourleft/issues/87)'s Capacitor install,
`DEP001` stopped the build, and [ADR 0016](0016-unlicense.md) ruled on it in the same pull request.
[ADR 0015](0015-dependency-licences.md) §Consequences describes that as the expected shape rather
than as an incident.

### What CC BY 4.0 actually requires, because "put it in the LICENSE file" is not enough

Read from the legal code on 2026-09-18 (see §"What was read, and when"). §3(a)(1) requires, **when
the material is shared**, that you retain:

> *"identification of the creator(s) of the Licensed Material and any others designated to receive
> attribution"*, *"a copyright notice"*, *"a notice that refers to this Public License"*, *"a notice
> that refers to the disclaimer of warranties"*, and *"a URI or hyperlink to the Licensed Material to
> the extent reasonably practicable"*

and, separately, that you *"indicate if You modified the Licensed Material and retain an indication
of any previous modifications"*.

§3(a)(2) is the clause that makes this practical:

> *"You may satisfy the conditions in Section 3(a)(1) in any reasonable manner based on the medium,
> means, and context in which You Share the Licensed Material."*

⚠️ **The medium here is an APK.** `apps/mobile/capacitor.config.ts` sets `webDir: '../web/dist'`, so
an asset in the web build is shipped to a rider's phone. Someone who installs the app never sees
this repository, so a row in a file in git is not *reasonably discoverable by them* — and §3(a)(2)'s
test is about the medium the material is shared in. The notice has to be reachable from **inside the
app**. [`apps/web/src/views/AboutView.tsx`](../../apps/web/src/views/AboutView.tsx) already carries
the AGPL statement and the privacy policy for the same reason, so the place exists.

### And this obligation does not end

⚠️ **This is the material difference from every other identifier in either set, and it is the whole
reason this ADR is longer than a list.** CC0, MIT, MPL and `Unlicense` are all discharged for an
asset the moment the manifest row exists and the file is where it should be. CC BY is discharged by
the **shipped application crediting the work, every time it ships, for as long as it ships.** §6(a)
terminates the licence automatically on non-compliance; §6(b) reinstates it *"as of the date the
violation is cured, provided it is cured within 30 days of Your discovery of the violation"*. So a
credits screen that silently drops an asset is a build distributing that asset unlicensed, with a
cure period that only starts running once somebody notices.

**That is the risk CC0 does not carry at all**, and it is the risk this decision accepts on the
owner's ruling. [#358](https://github.com/openzigs/onyourleft/issues/358) — generating the credits
screen from the manifest rather than maintaining it by hand — is what makes the obligation
mechanical instead of a matter of somebody remembering, and D-3 is what makes the data it generates
from checkable today.

---

## Decision

### D-1 — `CC-BY-4.0` is admitted for a committed asset, under `apps/` only

It joins the asset gate as a **third** set, `ASSET_LICENCES_ATTRIBUTED`, admitted in exactly the
place `ASSET_LICENCES_WEAK` is: **permitted under `apps/`, refused under `packages/`, in both cases
by path**.

The path half is [ADR 0015](0015-dependency-licences.md) D-2's argument applied unchanged, and it is
*stronger* here than it was for CC0. An Apache-2.0 leaf package exists to be dropped into somebody
else's project. A public-domain dedication travelling inside one is an obligation that package's own
`LICENSE` does not describe; an **attribution requirement** travelling inside one is a live
condition that the recipient would breach by doing exactly what the package's licence invites them
to do. So `packages/` is not a preference and not a formality — it is the case the rule is for.

⚠️ **Exactly that identifier, and no relatives.** `CC-BY-3.0` is a different version with different
text, and `CC-BY-SA-4.0` adds a share-alike condition on adaptations that nobody here has read. Both
remain outside every set and therefore fail closed, on the posture [ADR 0016](0016-unlicense.md)
took towards `Zlib`: a licence nobody has an asset for is a licence nobody has read. Admitting one
later is an amendment to this ADR, not a variable edit.

### D-2 — `CC-BY-NC` stays forbidden, everywhere, and this is stated so it cannot be conflated

`CLAUDE.md` §3 names `CC-BY-NC` beside BUSL and SSPL: *"Anything **non-OSI** … fails everywhere and
needs an ADR before it is even discussed."* Nothing here touches that.

⚠️ **`CC-BY-4.0` and `CC-BY-NC-4.0` differ by two letters and by a world of obligation**, which is
exactly why this gets its own decision rather than a footnote. `CC-BY-NC` forbids commercial use;
this project is AGPL-3.0-or-later and imposes no field-of-use restriction on anybody, so shipping an
NC asset inside it would make the application's own licence statement false. OpenTrainer is
CC BY-NC-4.0 and is already on ADR 0009's do-not-copy list for precisely this reason.

Mechanically: every set in the checker is matched by **string equality**, never by prefix, so
`CC-BY-NC-4.0` falls through to the fail-closed branch. `check-repo-rules.test.sh` asserts it — with
the attribution keys present, so that the case also says that recording the attribution does not
rescue a licence the gate does not admit.

### D-3 — The attribution lives **in the app**, and `ASSETS.toml` carries the data it is generated from

Two halves, and the second is the one that is enforceable today.

**The notice is reachable from inside the application.** Not only from a file in git. `AboutView`
is where it goes, beside the AGPL statement that is already there for the same
reasonably-discoverable reason. [#358](https://github.com/openzigs/onyourleft/issues/358) builds it.

**The manifest carries creator, link and modification per asset**, so that the screen is
**generated** rather than maintained. Three keys, required when `licence` is one that requires
attribution and accepted on any entry:

| Key | What it is | Which clause wants it |
|---|---|---|
| `creator` | the name to credit, as the source gives it | §3(a)(1)(A)(i) |
| `url` | a link to the material | §3(a)(1)(A)(iv) |
| `modified` | whether this repository changed it, and how — `"no"` where it did not | §3(a)(1)(B) |

⚠️ **A widened list alone would have been the vacuous half of this change**, and that is the reason
`ASSET006` exists rather than a sixth name in an existing variable. Adding `CC-BY-4.0` to
`ASSET_LICENCES_WEAK` would have satisfied "a CC-BY asset now passes" while leaving the obligation
entirely unchecked — a green gate indistinguishable from a correct one, which is the shape this
repository has now refused in #299, #318, #142, #278 and #339. So: an entry under an
attribution-requiring licence that records no creator, no link or no modification note is a **red
build**, and the failure names the key.

⚠️ **`modified = "no"` is required rather than assumed.** An absent answer and "nothing to declare"
are the two things this file exists to tell apart, and a key that may be omitted when the answer is
the common one is a key nobody fills in.

⚠️ **The two notices §3(a)(1)(A)(ii) and (iii) ask for — the copyright notice and the
warranty-disclaimer notice — are not per-asset keys.** They are the same sentence for every CC BY
asset, so they belong in the credits screen's own wording once (#358) rather than repeated in every
row where they could drift. `licence` is the per-asset half of that, and it is already there.

### D-4 — A modification is declared, and rescaling or merging counts as one

§3(a)(1)(B) is the clause most likely to be skipped, because the change does not feel like one.
[#341](https://github.com/openzigs/onyourleft/issues/341) already *"merges a model of several parts
into one geometry"* and scales items 0.7–1.4×, and
[ADR 0022](0022-game-scenery-model-pack.md) D-7 requires every model to wear this repository's own
`MeshLambertMaterial` and colour rather than the pack's. **All three are modifications**, and under
this decision the `modified` value says so in words a reader of the credits screen can understand —
not "yes".

⚠️ This is the one key whose *content* nothing can check. `ASSET006` checks that an answer is
present and non-empty, which is the same posture `source` has carried since #339: a claim somebody
wrote and somebody else must trust, made visible in `git diff` so it is reviewed rather than
assumed.

### D-5 — ADR 0015's **dependency** tables are deliberately not extended, so the two sets now differ

`ASSET004`'s sets have until today mirrored ADR 0015 D-2's distributed-closure table exactly, and
`scripts/check-repo-rules.sh` says so where they are defined. **After this ADR they no longer
mirror it**, and that divergence is a decision:

| | asset (`ASSET004`) | dependency (`DEP001`) |
|---|---|---|
| `CC-BY-4.0` | admitted under `apps/` | **fails closed, everywhere** |

Three reasons, in the order they decide it. **Nothing in the tree has a dependency under CC-BY**, so
admitting it there would be ruling on a licence nobody has read in that position — the posture
ADR 0016 took towards `Zlib`, applied to the other gate. **Creative Commons itself recommends
against using its licences for software**, so a package declaring one is a signal worth stopping on
rather than waving through. And **the obligation has no home in a dependency closure**: D-3's answer
is a credits screen generated from `ASSETS.toml`, and a transitive npm dependency has no row there.

⚠️ `CLAUDE.md` §4g warns that ADR 0015's prose tables and the machine-readable `POLICY` in
`check-dependency-licences.mjs` can drift and that nothing mechanically prevents it. This ADR adds a
**third** table to that hazard, so the divergence is asserted rather than described:
`check-dependency-licences.test.sh` carries a case requiring `CC-BY-4.0` to fail as a dependency,
which goes red the moment somebody "tidies up" by adding it to `POLICY.weak`. ADR 0015 carries a
dated amendment recording this, under [ADR 0013](0013-adr-amendments.md).

### D-6 — This rules on a **licence**, not on a pack. ADR 0022's author boundary is untouched

[ADR 0022](0022-game-scenery-model-pack.md) D-2 says the scenery's assets come from `kenney.nl` and
nowhere else, and that *"a kit from a different author is a change to this ADR, not a pull-request
decision"*. **Nothing here relaxes that.** This ADR makes a CC-BY asset *admissible*; it does not
make any particular asset *adopted*.

The distinction that follows, because it will be the first question asked:

- **Scenery** — the six `ScatterKind`s ADR 0022 D-3 enumerates. A CC-BY model for one of those needs
  ADR 0022 changed as well as this one, because D-2 binds the source regardless of licence.
- **Anything that is not scenery** — the rider ([#349](https://github.com/openzigs/onyourleft/issues/349)
  is a cyclist, not a `ScatterKind`) — is outside ADR 0022 D-2 entirely, so this ADR alone admits a
  CC-BY one, subject to D-1's path rule and D-3's keys.

### D-7 — No CC-BY asset may be committed before the credits screen exists

There is **no CC-BY asset in this repository today**, and this pull request adds none. `ASSET006`
guarantees that when one arrives it brings the data a credits screen needs; it cannot guarantee that
a screen renders it, because it runs on a bare clone with no toolchain and a React view is outside
what it can see.

So this is stated as a constraint with a named owner rather than pretended into a gate:
**[#358](https://github.com/openzigs/onyourleft/issues/358) lands before the first CC-BY asset is
committed.** Until it does, the question belongs to a reviewer, and this decision records that it is
one. #358's own criterion — that every attribution-requiring entry in the manifest appears in the
rendered screen — is what turns it back into a gate.

---

## Consequences

### What this enables

- The scenery and the rider can be chosen on how they look rather than on which licence they carry,
  which is the whole of what the owner ruled.
- The pool of usable free assets grows by a large multiple. CC BY is the most common licence on
  general-purpose asset libraries, and it was the one thing between this project and most of them.
- `ASSETS.toml` becomes a **source** as well as a record. Its rows were previously read only by a
  gate; under D-3 they are read by the application, which is what makes a drifting credits screen a
  test failure rather than a discovery.

### What this costs, stated plainly

- ⚠️ **A permanent obligation replaces a one-off one.** ADR 0022 traded "the question does not
  arise" for "the question is answered". This trades "answered once per asset" for "answered on
  every build, for ever". If the credits screen ever drops an asset, the application is distributing
  it unlicensed; §6(b)'s 30-day cure runs from *discovery*, which is not the same as from the
  mistake.
- **The automation is now load-bearing.** Before this, #358 would have been tidiness. After it, #358
  is the control, and a regression in it is a licensing defect rather than a cosmetic one.
- **Three more keys per attributed asset**, each of them a claim somebody wrote and nobody offline
  can verify — the same limit `source` and `sha256` already carry, now with a consequence attached.
- **Two licence gates that used to agree now differ** (D-5). That is one more pair of tables a
  reader has to keep apart, and the mitigation is a test rather than a promise.
- **Nothing in the tree changes today.** No asset is added, no asset is relicensed, and the first
  run after this change reports the same 45 assets as before.

### Constraints this places on other work

| Work | What binds |
|---|---|
| [#358](https://github.com/openzigs/onyourleft/issues/358) | D-3's three keys are its input; its criterion is that **every** attribution-requiring entry reaches the rendered screen, derived from the manifest rather than listed. D-7 makes it a blocker for the first CC-BY asset rather than a follow-up |
| [#349](https://github.com/openzigs/onyourleft/issues/349) — the cyclist | D-6: a rider is not a `ScatterKind`, so ADR 0022 D-2 does not bind it and this ADR alone admits a CC-BY one. D-1's path and D-3's keys still do |
| A CC-BY model for **scenery** | D-6: ADR 0022 D-2 binds the author whatever the licence says. Two ADRs, not one |
| [#341](https://github.com/openzigs/onyourleft/issues/341) and anything that transforms a model | D-4: merging parts, rescaling and substituting the material are all modifications, and the `modified` value says which in words |
| A `CC-BY-3.0`, `CC-BY-SA-4.0` or `Zlib` asset | D-1: outside every set, fails closed, needs an amendment here |
| A CC-BY **dependency** | D-5: still refused by `DEP001`, deliberately. Its own decision if it ever arrives |

### What would make this ADR wrong

- **An asset's upstream attribution turns out to be incomplete or contested.** This is the risk CC0
  does not carry at all: a CC0 dedication that was not the dedicator's to make leaves a project with
  a bad asset, but a CC-BY asset additionally leaves it crediting the wrong person in a screen it
  ships. `ASSETS.toml`'s `source`, `url` and `read` date are what a correction would be checked
  against; nothing here can make the claim true.
- **The credits screen proves unmaintainable in practice** — for instance if a future asset class
  arrives that `ASSETS.toml` cannot describe, and somebody is tempted to hand-maintain a second
  list. The answer is to extend the manifest, and a hand-maintained credits list should be read as
  the failure of this decision rather than as a workaround.
- **The better-looking models turn out not to be better.** ADR 0022 §"What would make this ADR
  wrong" already records that the style question is judged from screenshots rather than measured. If
  the answer is that CC0 packs were adequate all along, this ADR's obligation was bought for
  nothing — and the fallback is the same one: a licence set is one variable, and no asset in this
  tree uses it today.
- **Creative Commons publishes a 5.0 licence**, or CC BY 4.0's text is superseded. The identifier
  is pinned exactly for this reason; a new one is a new decision.

## Notes

This ADR is an engineering decision recorded by an engineer. It is not legal advice. The reading of
§3(a)(2) — that an in-app credits screen is a *"reasonable manner based on the medium"* for an
application shipped as an APK, and that a file in a git repository is not — is the place a lawyer
would genuinely add value. The conservative course is taken: the notice goes in the app **as well
as** in the repository, so being wrong about which one suffices costs a screen rather than
compliance.

---

## What was read, and when

Every source below was read on **2026-09-18** from this environment, and the quotations are
verbatim. #240's BR-1 asks each pull request in this epic for a provenance sentence; this is this
document's.

| Source | What it established |
|---|---|
| `creativecommons.org/licenses/by/4.0/legalcode.en` §3(a)(1) | the five things attribution must retain, and the separate requirement to *"indicate if You modified the Licensed Material"* |
| the same, §3(a)(2) | *"in any reasonable manner based on the medium, means, and context in which You Share the Licensed Material"* — the clause D-3 rests on |
| the same, §6(a) and §6(b) | rights terminate automatically on non-compliance and reinstate *"provided it is cured within 30 days of Your discovery of the violation"* |
| `scripts/check-repo-rules.sh` §`ASSET_LICENCES_WEAK` | `CC-BY-4.0` was absent because *"a licence nobody has an asset for is a licence nobody has read"* |
| `scripts/check-dependency-licences.mjs` §`POLICY` | `CC-BY-4.0` is in none of `DEP001`'s tables, so it fails closed there — the state D-5 leaves unchanged |
| [ADR 0022](0022-game-scenery-model-pack.md) D-2, D-3, D-5, D-7 | the author boundary, the six kinds, the `apps/` path rule and the material substitution D-4 counts as a modification |
| [`ASSETS.toml`](../../ASSETS.toml) | 45 named assets, none of them CC-BY — so this ADR adds an admission rather than legalising something already committed |
| [`apps/web/src/views/AboutView.tsx`](../../apps/web/src/views/AboutView.tsx) | an in-app page already carrying the AGPL and privacy notices, which is where D-3's credits belong |

⚠️ **No competitor's product, asset, screenshot or source was consulted**, and no asset was
downloaded, converted or committed in the course of writing this.
[ADR 0009](0009-clean-room-posture.md) L2 and R2 are untouched.
