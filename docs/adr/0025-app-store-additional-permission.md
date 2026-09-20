# ADR 0025: An app-store additional permission, adopted while there is one copyright holder

- **Status**: Accepted
- **Date**: 2026-09-20
- **Deciders**: the repository owner, who ruled on each decision below on
  [#432](https://github.com/openzigs/onyourleft/issues/432) — including D-3's scope, in the words
  *"we will want to be able to deploy to apple store and google play store."* The rulings are the
  owner's because this is a **licence grant made in the copyright holders' name**, and
  `CLAUDE.md` §3 makes a licence question answerable before the code is written. Everything below
  the rulings is the author's
- **Issue**: [#432](https://github.com/openzigs/onyourleft/issues/432)
- **Number**: **0025**. 0021 remains a live reservation held by
  [#330](https://github.com/openzigs/onyourleft/issues/330); 0024 was taken by
  [#403](https://github.com/openzigs/onyourleft/issues/403).
  [`docs/architecture.md`](../architecture.md)'s reservation table is the check `CLAUDE.md` §7 asks
  for, and it said 0025 was free
- **Supersedes**: one cell of [ADR 0015](0015-dependency-licences.md)'s closure table — see D-5
- **Extends**: [ADR 0001](0001-licence.md). **The application stays `AGPL-3.0-or-later`.** This ADR
  grants *more* than ADR 0001 did and takes nothing away; it is not a relicense and it does not
  reopen ADR 0001's refusal of a CLA
- **Relates to**: [ADR 0018](0018-native-client-platform.md) D-3 (*"iOS is where it ships"*) and
  [ADR 0003](0003-platform-support-matrix.md), which both name the App Store and neither of which
  asked whether an AGPL client may be conveyed through it

> ⚠️ **This ADR was not reviewed by a lawyer, and it says so rather than implying otherwise.** It
> records a posture and adopts wording that is already in production use elsewhere. §"Three questions
> for a lawyer" states precisely what remains unanswered, in the manner of
> [ADR 0009](0009-clean-room-posture.md).

---

## Context

### A hole between three reasonable decisions

ADR 0001 chose `AGPL-3.0-or-later` for the application and **no CLA**. ADR 0003 and ADR 0018 route
the iOS client through Apple's App Store; [#95](https://github.com/openzigs/onyourleft/issues/95)
built the pipeline that publishes to Google Play. Each is sound alone. **No ADR had asked whether the
first is compatible with the other two** — `grep -rn -iE "app store.*(gpl|agpl)|VLC" docs/adr/`
returned nothing on 2026-09-20.

### The conflict, read 2026-09-20

**The argument** is the FSF's, made on vlc-devel in November 2010: Apple's store terms bind every
app *"no matter what the license of that app is"*, and GPL §6 (GPLv3/AGPLv3 §10) says *"You may not
impose any further restrictions on the recipients' exercise of the rights granted herein."*

**It has been enforced.** In January 2011 Apple removed VLC, GNU Go and Battle for Wesnoth after
**one** VLC copyright holder, Rémi Denis-Courmont, sent a notice (CNET, 2011-01). VLC returned only
after relicensing.

**Apple's terms today are softer and still in tension.** The Licensed Application End User License
Agreement still grants *"a nontransferable license"* and still says *"You may not transfer,
redistribute or sublicense the Licensed Application… modify, or create derivative works"* — now
followed by *"(except… to the extent as may be permitted by the licensing terms governing use of any
open-sourced components included with the Licensed Application)."* That carve-out speaks of
open-sourced **components**; whether it reaches an application that is open source *as a whole* is
not something this ADR can settle. And Apple's *Minimum Terms of Developer's End-User License
Agreement* still require that a custom EULA *"may not provide for usage rules… that are in conflict
with the Apple Media Services Terms"* and *"must be limited to a non-transferable license."*

**Google Play is structurally different.** Its Developer Distribution Agreement §5.3, read the same
day: *"If You choose, You may include a separate end user license agreement ('EULA') in Your Product
that will govern the user's rights to the Product."* The store imposes no usage rules of its own on
the recipient. **No conflict is documented there** — see D-3 for why it is named anyway.

### Why it has not bitten, and the day it starts to

**A sole copyright holder is not bound by their own licence** and may grant a store whatever it
needs. `git shortlog -sne --all` on 2026-09-20 shows every commit to be the owner (three spellings of
one address), AI-assisted commits, and Dependabot version bumps. **Today that is one copyright
holder.**

ADR 0001 makes the alternative permanent: *"this project cannot be relicensed without unanimous
consent of all contributors, and therefore in practice cannot be relicensed at all. That is the
intended outcome."* Under DCO with no CLA, **the first outside contributor holds copyright in their
contribution under plain AGPL** — and from that day any one of them can do to this project what one
contributor did to VLC, while adding a permission would need every one of them to agree.

**So the cheap cure has a clock on it, and the clock is the first merged outside pull request.**

---

## Decision

### D-1 — An additional permission under AGPL §7 is adopted. The licence does not change

AGPLv3 §7, from this repository's own byte-identical `LICENSE`: *"'Additional permissions' are terms
that supplement the terms of this License by making exceptions from one or more of its conditions.
Additional permissions that are applicable to the entire Program shall be treated as though they were
included in this License."*

That is the instrument the licence itself provides for this. It **grants more and removes nothing**;
every freedom the AGPL gives a recipient is intact, and anybody may strip the permission from their
own copy (§7 ¶2) and be left with plain AGPL.

### D-2 — A true §7 permission, not a covenant not to enforce

Two projects already ship copyleft apps on the App Store, by **different mechanisms**:

| | Mechanism | Words |
|---|---|---|
| **Signal** | a §7 **additional permission** (catalogued by ScanCode as `signal-gpl-3.0-exception`) | *"…also grants you the additional permission to convey through the Apple App Store non-source executable versions of the Program… as Executable Versions only under the Mozilla Public License version 2.0"* |
| **Nextcloud iOS** (`COPYING.iOS`) | a **covenant** | *"we have committed not to pursue any license violation that results solely from the conflict between the GNU GPLv3… and the Apple App Store terms of service"* |

**The permission is chosen.** §7 defines how it propagates — it is *"treated as though… included in
this License"*, so it reaches every recipient and every fork with the licence. A covenant binds only
the people who made it, and in a project with no CLA that is each future contributor, separately,
with nothing in the licence text saying how their silence is to be read.

**Signal's structure is adopted rather than new wording drafted.** Its mechanism is specific: store
executables are conveyed **under MPL-2.0**, whose §3.2 permits an executable to be distributed under
other terms *"provided that the license for the Executable Form does not attempt to limit or alter
the recipients' rights in the Source Code Form"*. Apple's terms restrict the executable; they say
nothing about the source; the source stays AGPL. ⚠️ **Adapted precedent that is in production is a
better footing than a clause invented here**, and that — not elegance — is the whole reason.

### D-3 — It names Apple's App Store **and** Google Play, and no other store

Owner ruling: both stores are distribution targets.

- **Apple's App Store** is named because the conflict is documented, was enforced, and survives in
  the current terms.
- **Google Play** is named although **no conflict is documented today**. The reason is the clock in
  §Context: a permission cannot be widened after the first outside contribution, and Google's terms
  are moving — its 2026 developer-verification requirement is the most recent instance. A permission
  is *optional to use*: conveying through Play under plain AGPL remains available and remains the
  default. **Naming Play costs nothing today and cannot be bought later.**
- ⚠️ **"Any app store" is deliberately not written.** A permission to convey under store terms nobody
  has read is a permission to restrict users in ways nobody has examined. Two named stores, each
  read, is the honest scope. The cost is stated in §Consequences.

### D-4 — The words, and where they live

The permission is the section **"Additional permission under GNU AGPL version 3 section 7"** in the
repository's [`COPYRIGHT`](../../COPYRIGHT) file, which already carries this project's licence notice
and its one other exception (the Apache-2.0 leaf packages). `COPYRIGHT` is a protected path that an
ADR may change (`CLAUDE.md` §7); this is that ADR.

- ⚠️ **It is not in `LICENSE`, and cannot be.** `LICENSE`, and every app's own `LICENSE`, is
  byte-identical to the canonical AGPL text and `LIC005` hashes it against the digest ADR 0001
  records. Editing licence text is itself a licensing problem.
- ⚠️ **Per-file SPDX headers do not change.** There is **no SPDX-listed exception identifier** for a
  permission of this kind — ScanCode's is a `LicenseRef-`. `AGPL-3.0-or-later` remains a *true*
  statement about every file under `apps/`, because §7 treats a program-wide permission as part of
  the licence. The precise form would be `AGPL-3.0-or-later WITH AdditionRef-…` on some eleven
  hundred files, with `LIC002` and the ESLint header rule taught to accept it; that cost buys
  precision no reader is currently missing. Recorded so the imprecision is a decision.
- It covers **the application** — everything that is `AGPL-3.0-or-later`. `packages/*` is Apache-2.0
  and needs no permission from anybody.

### D-5 — Third-party copyleft may be built with, never shipped. `DEP002`

**A permission this project's copyright holders grant cannot cover anybody else's code.** One
GPL-family dependency in what an app distributes is one third party able to send the notice VLC
received.

Measured 2026-09-20 over `apps/web` and `apps/mobile` with `pnpm licenses list --prod`: **MIT 18,
ISC 8, BSD-3-Clause 4, BSD-2-Clause 2, `(MIT OR Apache-2.0)` 1, 0BSD 1 — no GPL, LGPL or AGPL ships.**
But ADR 0015's table *permitted* it: the distributed closure under `apps/` admitted the copyleft set.

**That cell is superseded.** `scripts/check-dependency-licences.mjs` §`admitted` no longer admits
`POLICY.copyleft` in an application's **distributed** closure, and the refusal is reported as
**`DEP002`**, naming this ADR. Copyleft stays admitted in an application's **build-time** closure —
a tool that is not distributed conveys nothing — and ADR 0015 D-3's refusal under `packages/` is
untouched and stays `DEP001`. **LGPL is in the set on purpose**: its relinking requirement is no
easier to honour inside a signed store binary than the GPL's terms are.

### D-6 — Contributions are made under the licence **including** the permission

§7 ¶2: *"You may place additional permissions on material, added by you to a covered work, for which
you have or can give appropriate copyright permission."* A permission therefore reaches a later
contribution only if **its contributor places it there**. `CONTRIBUTING.md` §"Licensing of
contributions" now states that a contribution under `apps/` is made under `AGPL-3.0-or-later`
**together with** this additional permission, so the DCO sign-off covers it. Inbound equals outbound,
as it always did; outbound now includes the permission.

### D-7 — The source offer is a condition, and the app now meets it

The permission is granted only *"provided that you are otherwise in compliance… including without
limitation making the Corresponding Source available in compliance with section 6."* AGPL §6 obliges
whoever conveys object code to say where the source is.

⚠️ **Until this ADR the app did not.** `AboutView` named the licence and **never said where the
source was** — and a rider who installed from a store has never seen the repository, which is the
same fact ADR 0023 D-3 rests the credits screen on. The About screen now links to the repository
(`apps/web/src/privacy/policy.ts` §`SOURCE_CODE_URL`, written down once beside the privacy policy's
URL), and `AboutView.test.tsx` pins the link, because a build without it has not met the condition of
the permission it ships under.

---

## Consequences

### What this enables

- The iOS client ADR 0018 plans can be conveyed through the App Store **without that depending on
  there never being a second contributor.**
- A fork may ship through the same two stores on the same terms. That is intended: the permission is
  a property of the licence, not a privilege of the original authors.

### What this costs, stated plainly

- **Store executables may be conveyed under MPL-2.0.** That is weaker copyleft than AGPL *for the
  binary*. The source — the thing copyleft protects — stays AGPL, and AGPL §13's network clause has
  no work to do on a client binary. It is still a real concession and it is made knowingly.
- ⚠️ **The scope is frozen at two stores.** A third store with Apple-like terms (a headset's, a
  car's, a TV's) cannot be added once an outside contribution has merged, short of unanimous consent.
  D-3 chose examined-and-narrow over unexamined-and-broad; this is the bill.
- **One more rule to satisfy.** A useful GPL library can no longer be shipped by an app; it can be
  used at build time, or the feature lives without it.

### Constraints this places on other work

- ⚠️ **It must merge before any outside contribution does.** If one has landed first, this ADR is not
  wrong but it is incomplete: that contributor's consent is needed and must be recorded here.
- **`DEP002` cannot see native dependencies.** It reads pnpm's resolution. An iOS build also links
  CocoaPods / Swift packages, and an Android build links Gradle dependencies; today those are
  Capacitor and `@capacitor-community/bluetooth-le`, both MIT. **Whoever generates the iOS project
  (ADR 0018 D-5) owes the same check by hand**, and
  [#434](https://github.com/openzigs/onyourleft/issues/434)'s engine question owes it for an engine.
- A server application (`apps/api`, Phase 4,
  [#7](https://github.com/openzigs/onyourleft/issues/7)) would not ship through a store and might
  legitimately want an AGPL dependency. `DEP002` fails closed against that on purpose; the day it
  matters is the day to amend D-5 with the distinction, not before.
- The store listings, when written, carry the source link too (`apps/mobile/RELEASE.md`).

### What would make this ADR wrong

- **A lawyer answers any of the three questions below the other way.**
- **Apple's terms change** so that an application open source *as a whole* is plainly within the
  carve-out. The permission then becomes unnecessary and harmless.
- **Google's terms change** to impose usage rules. D-3 then turns out to have been necessary rather
  than precautionary — and already in place.
- **SPDX lists an exception identifier** for this class of permission, which would change D-4's
  arithmetic about headers.

---

## Three questions for a lawyer

1. **Does Signal's mechanism carry over to AGPLv3, and does it still cure the conflict under Apple's
   2026 terms?** Signal's text was written for GPLv3. The adaptation changes the licence named and
   the grantor and nothing else.
2. **Does a DCO sign-off, made under a `CONTRIBUTING.md` that states the inbound terms include the
   permission, bind the contribution to it** — so that no later contributor holds copyright under
   *plain* AGPL?
3. **Does naming Google Play do any harm**, given that no conflict is documented there today?

Until they are answered this ADR records a **posture adopted in good faith on the best available
reading**. It must not be quoted as legal clearance, in a README, a store listing or an issue.

## What was read, and when

| Source | Read | What it settled |
|---|---|---|
| `git shortlog -sne --all` | 2026-09-20 | §Context — one copyright holder today |
| `grep -rn -iE "app store.*(gpl\|agpl)\|VLC" docs/adr/` | 2026-09-20 | §Context — no ADR had asked the question |
| FSF, *"FSF position on GPLv2 & current App Store terms"*, vlc-devel, 2010-11 | 2026-09-20 | the *further restrictions* argument |
| CNET, *"Alt media player VLC cut from Apple App Store"*, 2011-01 | 2026-09-20 | that one copyright holder's notice was enough |
| Apple, *Licensed Application End User License Agreement* (`apple.com/legal/internet-services/itunes/dev/stdeula`) | 2026-09-20 | the restrictions and the open-sourced-components carve-out |
| Apple, *Minimum Terms of Developer's End-User License Agreement* | 2026-09-20 | a custom EULA may not contradict the Usage Rules |
| Google, *Play Developer Distribution Agreement* §5.3 (`play.google/developer-distribution-agreement.html`) | 2026-09-20 | D-3 — the developer's own EULA governs the user's rights |
| ScanCode LicenseDB, `signal-gpl-3.0-exception` | 2026-09-20 | D-2 — Signal's words, and that the identifier is a `LicenseRef-`, not SPDX-listed |
| `nextcloud/ios`, `COPYING.iOS` | 2026-09-20 | D-2 — the covenant alternative |
| `pnpm licenses list --prod` over `apps/web`, `apps/mobile` | 2026-09-20 | D-5 — no copyleft ships today |
| `LICENSE` §7, this repository's byte-identical AGPL text | 2026-09-20 | D-1, D-6 — the instrument, and how it reaches a contribution |
