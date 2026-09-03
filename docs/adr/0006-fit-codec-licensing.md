# ADR 0006: FIT codec licensing strategy

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: repository owner
- **Issue**: [#58](https://github.com/openzigs/onyourleft/issues/58)
- **Supersedes**: nothing
- **Constrains**: [#29](https://github.com/openzigs/onyourleft/issues/29),
  [#30](https://github.com/openzigs/onyourleft/issues/30),
  [#31](https://github.com/openzigs/onyourleft/issues/31),
  [#32](https://github.com/openzigs/onyourleft/issues/32) — everything in `packages/fit`
- **Relates to**: [ADR 0001](0001-licence.md) (which names this decision as constraint 1 on its own
  validity), [ADR 0005](0005-tech-stack.md) (which makes the Apache-2.0 boundary a *path*), and
  [#19](https://github.com/openzigs/onyourleft/issues/19) (clean-room posture)

> This ADR is an engineering decision recorded by engineers. It is **not legal advice**. ADR 0001
> says the same about itself, and this ADR is deliberately consistent with it: the two questions
> where a lawyer would genuinely add value rather than confirm the obvious are stated explicitly at
> the end, so the review is a fifteen-minute question and not a research project.

---

## Context

FIT — Flexible and Interoperable Data Transfer — is Garmin's binary format and the lingua franca of
cycling. `packages/fit` cannot be built without deciding first whether this project may legally read
and write it, because ADR 0001 chose **AGPL-3.0-or-later** for the application and **Apache-2.0** for
the leaf packages, and the FIT Protocol License Agreement §2(d) appears on its face to forbid both.

ADR 0001 recorded that dependency rather than resolving it:

> **#58 must reconcile the FIT codec with this decision — and it may conflict.** … On its face that
> names MIT, Apache-2.0 **and** AGPL-3.0 — every option this ADR could have chosen. … if #58
> concludes the conflict is real, this ADR is reopened rather than the codec shipped.

This ADR resolves it. **ADR 0001 is not reopened.** The reasoning is below, and the operating rules
the conclusion depends on are binding on `packages/fit`, not advisory.

### Sources, with fetch dates

Everything below was read on **2026-09-03** unless stated otherwise. Digests are recorded so that a
future reader can tell whether the terms changed rather than trusting this summary.

| Source | URL | Observed |
| --- | --- | --- |
| FIT Protocol License Agreement | `https://raw.githubusercontent.com/garmin/fit-javascript-sdk/main/LICENSE.txt` | 20 035 bytes; SHA-256 `6cc7ff94b5afc8c3a2b14aeb3e90da97a9fb6c8d40644304da94df5cf56428cf`; footer reads `Last updated: October 12, 2022` |
| The same text in four other Garmin SDK repositories | `garmin/fit-java-sdk`, `garmin/fit-cpp-sdk`, `garmin/fit-csharp-sdk`, `garmin/fit-sdk-tools`, each `/main/LICENSE.txt` | **Byte-identical** — same SHA-256. `garmin/fit-python-sdk` carries no `LICENSE.txt` at its root (HTTP 404) |
| The agreement bundled in the artefact npm actually serves | `@garmin/fitsdk` 21.214.0 tarball, `package/LICENSE.txt` | **Byte-identical** — same SHA-256 |
| `@garmin/fitsdk` registry metadata | `https://registry.npmjs.org/@garmin%2Ffitsdk` | latest `21.214.0`, published 2026-08-25T17:32:21Z, `"license": "SEE LICENSE IN LICENSE.txt"`, no runtime dependencies |
| Garmin's SDK distribution page | `https://developer.garmin.com/fit/get-the-sdk/` | GitHub repositories plus NuGet / Maven Central / npm / SwiftPM / PyPI. **No zip.** Tools including `Profile.xlsx` come from `garmin/fit-sdk-tools` |
| The download page #30 and #58 both reference | `https://developer.garmin.com/fit/download` | **HTTP 404** — with and without a trailing slash |
| Public FIT protocol documentation | `https://developer.garmin.com/fit/protocol/` (article body at `/fit/articles/fit-protocol/fit_protocol.html`) | Served publicly: no login, no click-through acceptance |
| The older, Alberta-law licence text | `https://www.thisisant.com/resources/fit-sdk/` | **301 redirects to `https://developer.garmin.com/ant-program`.** Historic text read from the Wayback snapshot `web.archive.org/web/20200809083739/…`, headed "FIT SDK 21.32.00" |
| `fit-file-parser` | `https://registry.npmjs.org/fit-file-parser` and `github.com/jimmykane/fit-parser` | 5.0.2 published 2026-08-23T06:26:24Z; npm manifest `"license": "MIT"`; GitHub licence detection **`NOASSERTION`**; runtime dependency `buffer ^6.0.3`; **devDependency `@garmin/fitsdk` pinned at `21.208.0`** |
| `dtcooper/python-fitparse` | `github.com/dtcooper/python-fitparse` | GitHub licence detection `MIT`; `fitparse/profile.py` header reads `EXPORTED PROFILE FROM SDK VERSION 20.8 ON 2019-03-05`; repository active, ~818 stars |

**A note on what this repository may quote.** CLAUDE.md §6 forbids pasting FIT SDK *source* into a
public issue, PR or commit, because §4 declares the Licensed Technology to be Garmin Confidential
Information and this repository's history is permanent. The licence *text* is published openly on
GitHub and quoting it is how the decision gets recorded, so it is quoted at length below. No SDK
source, profile table or generated definition appears anywhere in this ADR, and none may appear in
this repository.

---

### Which licence text is authoritative — resolved, not deferred

Two materially different agreements have both been called "the FIT Protocol License", and they reach
opposite conclusions on the question that matters.

**The older text**, hosted by `thisisant.com` and captured above from 2020, is short, is governed by
the law of **Alberta, Canada** ("Garmin Canada Inc."), and says:

> The Licensee agrees that it will not distribute, transfer, or otherwise provide the FIT SDK and
> source code files to any person or entity other than employees of Licensee who have a need to have
> access to such information.

> This Agreement shall be governed by the laws of the Province of Alberta, Canada, without regarding
> to any conflicts of laws principles.

It has **no §2(d) equivalent at all** — no clause about onward licences that grant a right to modify.
Its restriction is blunter: nobody outside your own employees, full stop.

**The current text**, carried by `garmin/fit-javascript-sdk` and every other Garmin SDK repository,
is long, is governed by the law of **Kansas** (Garmin International, Inc., Olathe, Kansas), permits
distribution in the narrow circumstances §2 leaves open, and *adds* §2(d).

The acceptance criterion for this ADR asked that the question be settled by downloading the SDK from
`developer.garmin.com/fit/download` and reading the bundled agreement. **That page no longer exists**
— it returns HTTP 404, because since SDK 21.194.00 Garmin distributes no zip at all. The equivalent
evidence was therefore obtained from the artefacts that *are* distributed, which is strictly better
evidence than a download page would have been, because it is the agreement shipped inside the thing a
consumer actually installs:

1. The `@garmin/fitsdk` 21.214.0 tarball on the npm registry bundles `package/LICENSE.txt`, and it is
   **byte-identical** to the GitHub text — same SHA-256, `6cc7ff94…`.
2. The same digest appears in four other Garmin SDK repositories, **including `garmin/fit-sdk-tools`,
   which is where `Profile.xlsx` now lives.** There is no per-language or per-artefact variation.
3. `thisisant.com` no longer serves the older text at all; the URL redirects to Garmin's own site.
4. §11(e) of the current text disposes of the ambiguity on its own terms:

   > **e. Entire Agreement.** This Agreement constitutes the sole and entire agreement of the parties
   > hereto with respect to the subject matter of this Agreement and supersedes all prior and
   > contemporaneous understandings, agreements, representations and warranties, both written and
   > oral, with respect to such subject matter.

**Conclusion: the operative agreement is the Kansas-law text of 2022-10-12, SHA-256 `6cc7ff94…`.**
The Alberta text is historical and is recorded here only so that a future reader who finds it does not
mistake it for the current terms. This is the criterion most likely to be skipped, and skipping it
would have produced the wrong answer in either direction: the Alberta text would have made option (a)
plainly impossible and said nothing about (b), and the Kansas text alone would have hidden that the
terms have already been rewritten once and can be again — see §11(g) below.

---

### The clauses that decide this, verbatim

From the text identified above. Section numbers are Garmin's.

**§1, second sentence of the preamble, defining who is bound:**

> PLEASE READ THIS AGREEMENT CAREFULLY BEFORE USING THE LICENSED TECHNOLOGY. BY USING THE LICENSED
> TECHNOLOGY, YOU SIGNIFY YOUR AGREEMENT TO THESE TERMS …

**§1, defining what is licensed:**

> As used in this Agreement, the "Licensed Technology" means Garmin's Flexible and Interoperable Data
> Transfer ("FIT") software development kit ("SDK") that includes documentation describing the FIT
> protocol and related source code files.

**§2(c) — distribution:**

> Licensee shall not, and shall not permit any third party to, directly or indirectly:
>
> c. except as set forth herein, rent, lease, lend, sell, sublicense, assign, distribute, publish,
> transfer or otherwise make available the Licensed Technology, or any features or functionality of
> the Licensed Technology, to any third party for any reason;

**§2(d) — the clause that put ADR 0001 in question:**

> d. distribute the Licensed Technology or any derivatives thereof so that any part of it becomes
> subject to any license that requires that the Licensed Technology or any of Garmin's other
> intellectual property be disclosed or distributed in source code form, or that others have the
> right to modify it;

**§2(f) — the clause that bears on #31's validation criterion:**

> f. use the Licensed Technology for purposes of benchmarking or a competitive analysis of the
> Licensed Technology;

**§4, first paragraph — confidentiality:**

> In connection with this Agreement, Garmin may disclose or make available Confidential Information to
> Licensee. "Confidential Information" means information in any form or medium (whether oral, written,
> electronic or other) that: (a) if disclosed in writing or other tangible form or medium, is marked
> "confidential" or "proprietary"; or (b) if disclosed orally or in another intangible form or medium,
> is identified by Garmin as confidential or proprietary when disclosed and later summarized and
> marked "confidential" or "proprietary" in writing by Garmin. Without limiting the foregoing, the
> Licensed Technology is Confidential Information of Garmin.

§4 also carries the exclusion that makes the licence text itself quotable and makes the public
protocol documentation a different kind of object from the SDK: Confidential Information does not
include information that "was or becomes generally known by the public other than by Licensee's
noncompliance with this Agreement".

**§11(g) — the terms can change under us, and pinning a version does not pin the agreement:**

> g. Amendment. This Agreement may be amended from time to time by Garmin in its sole discretion.
> Licensee is responsible for reviewing and becoming familiar with any such amendment. Licensee's
> continued use of the Licensed Technology after such amendment signifies Licensee's agreement to and
> acceptance of this Agreement, as amended.

---

### The hinge: §2 binds a *Licensee*, and you become one by using the SDK

Everything in §2 is framed as "Licensee shall not". The preamble says you become a Licensee **by
using the Licensed Technology**, and §1 defines the Licensed Technology as the SDK. There is no
clause purporting to bind a party that has never obtained or used it — the agreement is a contract of
use, not a claim of right against the world.

That is the whole shape of the decision. **The question is not "which licence can survive §2(d)". It
is "does this project ever become a Licensee at all".** If it does not, §2(d) never attaches and ADR
0001 stands untouched. If it does — at any point, through any contributor, in any package — §2(d)
attaches to material this project is required by ADR 0005 to distribute under a licence that grants
the right to modify.

### Why the §2(d) tension is acute for *this* project specifically

The common counter-argument is that an npm dependency is not redistribution: the consumer installs
the package themselves from Garmin's own registry entry, under Garmin's own terms, and the depending
project never distributes Garmin's code. That argument is unresolved in general and this ADR does not
purport to settle it. **It does not need to be settled, because it does not reach this project.**

- `apps/web` is a **bundled browser application**. Vite inlines every runtime dependency into the
  JavaScript served to the user. A FIT SDK reached through `packages/fit` would be *copied verbatim
  into the artefact this project publishes*. That is publishing and making available the Licensed
  Technology to third parties in §2(c)'s own words, not an abstraction about package managers.
- `apps/web` is **AGPL-3.0-or-later**, and AGPL §13 obliges us to offer network users the
  Corresponding Source of the whole combined work. The bundled SDK is part of that work. Offering its
  source, to everyone, on demand, is the precise act §2(d) prohibits.
- `packages/fit` is **Apache-2.0**, which grants every recipient the right to modify. Under CLAUDE.md
  §3 that is a path rule, not a manifest field: nothing under `packages/` can be anything else.
- CLAUDE.md §3 independently disposes of a runtime dependency on `@garmin/fitsdk`: its declared
  licence is `SEE LICENSE IN LICENSE.txt`, which is **not an OSI licence**, and "anything non-OSI …
  fails everywhere and needs an ADR before it is even discussed." This is that ADR, and the answer is
  no.

### What the public documentation actually covers — and the part it deliberately does not

Option (c) was described in #58 as "implement from the published FIT protocol documentation". That
framing is optimistic and this ADR corrects it, because the gap is where the entire cost of option (c)
lives.

The public protocol page fully specifies the **container**: the file header and its data-size field,
record headers, definition messages, base types and their invalid values, arrays, developer-field
descriptions, compressed timestamp headers, and the trailing CRC. A complete, correct FIT container
reader and writer can be built from it and from nothing else.

It does **not** specify the **Global FIT Profile** — the message numbers, field numbers, scales,
offsets, units and enumerations that give those bytes meaning. The page says so, twice and explicitly:

> All Global Message Numbers are found in the mesg_num base type defined in the SDK.

> The field definition numbers for each global FIT message are provided in the SDK.

So option (c) is not "write a parser from a spec". It is "write a container codec from a spec, and
obtain a profile subset some other way". Any plan for `packages/fit` that does not have an answer for
the second half is not a plan. The decision below supplies one.

### Option (b) inspected rather than assumed

`fit-file-parser` 5.0.2 was the cheapest-looking route: MIT, published four days before this was
written, encodes as well as parses. Reading the repository rather than the npm badge changes the
picture entirely.

- Its `package.json` carries `"@garmin/fitsdk": "21.208.0"` as a **devDependency**.
- `codegen/garmin-profile.ts` opens with `import { Profile } from '@garmin/fitsdk'` and writes
  `src/garmin_profile.generated.ts`.
- That generated file's own header states its provenance: *"Generated from @garmin/fitsdk 21.208.0.
  Do not edit this file directly."*
- It is compiled into `dist/`, which is what npm publishes. It is distributed, under MIT.

**Option (b) therefore does not avoid the §2(d) question. It performs the act §2(d) describes and
hands us the result.** A machine transformation of the Licensed Technology is the most natural reading
of "any derivatives thereof"; MIT is exactly a licence under which "others have the right to modify
it"; and putting that file inside an Apache-2.0 package under `packages/` would make this project do
the same thing a second time. Relying on it means relying on a third party's grant of rights over
material they may not have had the right to grant, and a licence grant cannot convey more than the
grantor holds. Option (b) is *more* exposed than option (a), not less — under (a) the SDK at least
travels under its own terms unmodified.

Three smaller findings, recorded so #30 and #31 do not rediscover them:

- GitHub reports the repository as `NOASSERTION` despite a `LICENSE` file whose body is verbatim MIT.
  The cause appears to be two extra lines inside the copyright block. It is cosmetic, and it is not
  the reason to reject the library.
- v5.0 is a breaking release with a documented 4.x→5.0 rename table. Any future use must pin exactly;
  a `^5` range is not acceptable.
- Its encoder is deliberately **profile-agnostic** — callers supply message and field numbers, base
  types and raw values, and applying FIT scales and offsets is the caller's job. Even had the licence
  question come out the other way, #31 would not have been "wire up a library".

### Tolerance is not permission

`dtcooper/python-fitparse` is MIT, has shipped an SDK-exported profile since 2019 — its
`fitparse/profile.py` says so in its own header — has ~818 stars, and has apparently never been
enforced against. It is tempting to read that as settled practice.

**It is evidence of tolerance, not of permission.** A rights holder's forbearance creates no licence,
binds no successor, and is withdrawn at will; §9 of the agreement lets Garmin terminate immediately on
breach and §11(g) lets it amend the terms unilaterally. This project cannot build a licence boundary
that CI enforces by path on top of an inference that nobody has complained yet. It is recorded here in
those terms so that the next person who finds it does not have to re-derive the point.

---

## Decision

**Option (c): implement the FIT codec from the publicly served FIT protocol documentation, and depend
on nothing that carries Garmin's terms.** `packages/fit` remains an Apache-2.0 leaf package under
`packages/`, exactly as ADR 0001 and ADR 0005 place it.

Options (a) and (b) are **rejected**. (a) because a bundled browser build plus AGPL §13 makes the
"an npm dependency is not redistribution" argument unavailable to this project, and because a non-OSI
runtime dependency fails CLAUDE.md §3 everywhere regardless. (b) because its MIT grant covers a file
generated from `@garmin/fitsdk`, which relocates the §2(d) question one layer down and adds a
defective-grant risk on top of it.

The decision is only worth what the rules that implement it are worth, so they are stated as rules.

### R1 — No Garmin FIT artefact, in the repository or in the toolchain

No Garmin FIT artefact enters this repository, its lockfile, its CI, or the working environment of
anyone contributing to `packages/fit`. That means, by name: the FIT SDK in any language; `Profile.xlsx`;
anything from `garmin/fit-sdk-tools`; `FitCSVTool`; `Fitgen`; the `ActivityRepairTool`; and
`@garmin/fitsdk` in `dependencies`, `devDependencies` or `optionalDependencies`.

The reason is R1's whole point and it is not squeamishness: **using it is what makes you a Licensee**,
and a Licensee contributing to an Apache-2.0 package is the §2(d) event. The correction below about
where `Profile.xlsx` now lives is a correction to a stale fact, **not an invitation to go and fetch
it** — `garmin/fit-sdk-tools` carries the identical licence text, verified by digest above.

### R2 — Where the profile comes from

`packages/fit` implements the **container** from the public protocol documentation, and carries a
**narrow, enumerated profile subset** covering only the messages and fields this product reads and
writes — `file_id`, `activity`, `session`, `lap`, `record`, `event`, `device_info`, and the
`developer_data_id` / `field_description` pair, plus whatever #29's fixtures prove is needed.

Every number in that subset is obtained from a source that is not the SDK, and **its provenance is
recorded per message in `packages/fit/README.md`**, naming the source and the date. Permitted sources:
the public protocol documentation; the values observable in the FIT fixture files #29 collects, which
are files this project lawfully holds; and third-party published tables that are not themselves
SDK-derived. A number whose provenance cannot be recorded does not go in.

That README section replaces #30's acceptance criterion "the FIT SDK version the profile was derived
from is recorded in `packages/fit/README.md`", which under this ADR would be a record of a rule
violation.

### R3 — Numbers may be recorded; expression may not be copied

Message and field numbers, base type codes, scales and offsets are **facts about a wire format**, in
the same sense CLAUDE.md §6 already uses when it says a physical constant or a published equation
carries no restriction while an implementation of it does. They are recorded as this project's own
data structures in this project's own shape. What is never copied, from any source, is *expression*:
Garmin's tables, its generated code, its identifiers-as-laid-out, its comments, its file layout.

This rule binds equally to the GPL and AGPL prior art CLAUDE.md §6 already names. Reading GoldenCheetah
(GPL-2.0) or Auuki (AGPL-3.0) to check a protocol detail is fine; copying from either is fatal under
`packages/`, which admits neither licence at all.

### R4 — The declaration

Whoever opens a pull request touching `packages/fit` states in the PR body that they have not consulted
the FIT SDK, `Profile.xlsx`, or any Garmin FIT tool in the course of the work, and where each profile
number came from. This is a stated convention, not a machine check; making it machine-checkable is out
of scope here and belongs with the clean-room posture in
[#19](https://github.com/openzigs/onyourleft/issues/19), which this ADR does not pre-empt.

---

## Consequences

### ADR 0001 is not reopened

ADR 0001's constraint 1 is discharged. AGPL-3.0-or-later for `apps/`, Apache-2.0 for `packages/`, and
the path rule in CLAUDE.md §3 all stand unchanged. No edit to ADR 0001 is required and none is made —
it is a protected path, amended only by a superseding ADR.

The conclusion is conditional on R1 holding, and it is worth being blunt about what would overturn it:

1. **R1 is breached** — a Garmin artefact reaches the repository, the lockfile, CI, or a contributor's
   work on `packages/fit`. Then §2(d) attaches to material `packages/` must distribute under
   Apache-2.0, and the question ADR 0001 deferred becomes live again.
2. **Lawyer question 1 below is answered against us** — the public documentation page is held to be
   served under the FIT agreement rather than under Garmin's ordinary website terms. Then reading it
   makes us a Licensee and option (c) collapses into option (a).
3. **Lawyer question 2 below is answered against us** — the profile numbers are held to be protectable
   expression rather than facts. Then no lawful source for them exists short of a licence, and
   `packages/fit` cannot ship a profile at all.

**Who decides**: the repository owner, on advice, on either question. In case 1 the remedy is to revert
the offending change; in cases 2 or 3 ADR 0001 is reopened by a superseding ADR and `packages/fit` is
blocked in the meantime. Nothing about this is a matter for review-time judgement.

### `packages/fit` stays Apache-2.0 under `packages/` — and would not have under (a)

This is the load-bearing structural consequence and it is stated loudly because ADR 0005 made the
boundary a path that CI enforces.

Under option (c), `packages/fit` sits under `packages/`, declares `Apache-2.0` in its manifest, carries
its own `LICENSE` byte-identical to `LICENSES/Apache-2.0.txt` (rule `LIC005`), and every source file
opens with `// SPDX-License-Identifier: Apache-2.0` (rules `LIC001`, `LIC003`, `LIC004`). Nothing about
the layout in `docs/architecture.md` changes.

Under option (a) it could not have. A non-OSI runtime dependency under `packages/` fails CLAUDE.md §3
with no exemption, and moving the codec into `apps/` to escape that would have destroyed the reason
ADR 0001 split the licences in the first place — a FIT codec is the single leaf package most worth
other people being able to adopt. **Option (a) was not a cheaper version of the same architecture. It
was a different architecture.**

### #31's third-party validation criterion — ruled

#31 currently requires that the file header data size and trailing CRC be validated "with the SDK's
own checker rather than our own".

**Ruling: no Garmin tool may be used, for any part of #31's validation.**

The primary reason is R1, not §2(f). Running `FitCSVTool` means obtaining and using the Licensed
Technology, which makes the operator a Licensee and re-attaches all of §2 to a person then contributing
to an Apache-2.0 package. The route by which the tool would be a problem is the same route by which the
library was.

§2(f) is the secondary reason and this ADR is candid that it is the weaker one. Validating that *our*
output conforms is conformance testing, and the ordinary meaning of "benchmarking or a competitive
analysis **of the Licensed Technology**" is measuring Garmin's implementation, not checking our own
file. A restrictive reader could still say that comparing our encoder's output against Garmin's
decoder's expectations analyses the Licensed Technology's behaviour. The ambiguity is real, it does not
need to be resolved, and it should not be resolved by an engineer, because R1 already answers the
question.

**Permitted validators for #31**, replacing that criterion:

1. **Round-trip through our own decoder** — necessary, and explicitly *not* sufficient. #31 already
   says so, and it is right: self-consistency proves only that the encoder and decoder share
   assumptions, including wrong ones.
2. **An independent non-Garmin decoder, as a test-time devDependency that is never shipped.**
   `fit-file-parser` (MIT) and `dtcooper/python-fitparse` (MIT) both qualify. This is consistent with
   rejecting option (b) rather than in tension with it: option (b) was rejected because it puts
   SDK-derived material into an artefact this project *distributes*, and a devDependency is not
   distributed. The residual risk — that the MIT grant over the generated profile is defective — is
   materially smaller for a tool that is only executed, and it is **severable**: deleting a
   devDependency is a one-line change, whereas unpicking a shipped runtime dependency from a released
   package is not. If it is used, it goes in `devDependencies` with an exact pin and a comment
   pointing at this paragraph.
3. **Acceptance by real consumer platforms.** An encoded file that imports successfully into two
   independent platforms — Strava, Garmin Connect, TrainingPeaks, intervals.icu, a head unit — is the
   evidence #31 actually wants, because the failure #31 exists to prevent is remote rejection.
   Uploading a file we wrote to a service that accepts uploads is ordinary use of that service and
   involves no Licensed Technology on our side. Name the platforms and attach the evidence, as #31
   already requires.

Header data size and CRC correctness are checkable directly against the public protocol
documentation's Table 1 and CRC description; they do not need any third party's tool.

### #30's acceptance criteria change

- The claim that the canonical definitions ship "in `Profile.xlsx` inside the SDK zip" is **stale and
  is corrected**: since SDK 21.194.00 no zip is distributed, `developer.garmin.com/fit/download`
  returns 404, and `Profile.xlsx` is published in `garmin/fit-sdk-tools` — which carries the same
  agreement, digest-verified. Correcting the fact does not authorise fetching the file; see R1.
- "Ground truth is the Garmin FIT SDK" is **no longer true for this project** and must be struck.
  Ground truth is the public protocol documentation for the container, and #29's fixtures plus the
  R2 provenance record for the profile.
- The criterion "the FIT SDK version the profile was derived from is recorded in
  `packages/fit/README.md`" is **replaced** by R2's per-message provenance record.
- `fit-file-parser` is **not adopted** as a runtime dependency. Its API having been verified since #30
  was written does not change that; the reason is licensing, not capability.
- Everything else in #30 — mid-file redefinition of a local message type, the truncated fixture
  yielding a structured error with a byte offset, unknown developer fields, absent versus zeroed
  position channels, CRC rejection, no I/O — is untouched and remains correct.

### The cost this accepts, stated plainly

Option (c) is the most expensive of the three and this ADR chooses it anyway. #30 and #31 are 8 points
each and will not get smaller; the container work is genuinely new code rather than integration, and
the profile subset carries a per-number provenance obligation that integration would not. The
compensating value is that `packages/fit` is then a genuinely adoptable Apache-2.0 component with no
third party's terms reaching into it — which is the reason ADR 0001 split the licences at all, and the
reason ADR 0001 itself predicted this outcome.

Two further consequences worth having written down:

- **Only the subset is supported.** A narrow profile means files containing messages outside it decode
  with those messages skipped, not with an error. #30's unknown-developer-field criterion already
  establishes that shape; R2 extends it to unknown *native* messages.
- **The profile grows by pull request, not by regeneration.** There is no code-generation step to rerun
  when Garmin adds a message. Adding one is a deliberate change with a provenance line, which is slower
  and is the point.

### Numbering

This ADR takes number **0006**, as #58's acceptance criteria specify. `docs/architecture.md` records
that 0006 is also claimed by [#27](https://github.com/openzigs/onyourleft/issues/27) (stream storage),
one of three double-claimed numbers tracked in
[#97](https://github.com/openzigs/onyourleft/issues/97). Under the convention already recorded there,
**#27 renumbers** and amends its own acceptance criterion when it does. Rule `ADR001` in
`scripts/check-repo-rules.sh` fails the build on a duplicate, so this cannot be got wrong silently.

---

## The two questions for a lawyer

Both are narrow, both are answerable without reading this repository, and between them they cover
everything above that an engineer should not be deciding.

**Question 1 — does reading Garmin's public FIT protocol web page make us a Licensee?**

§1 defines the Licensed Technology as "Garmin's … SDK that includes documentation describing the FIT
protocol and related source code files", and the preamble forms the contract on *use* of the Licensed
Technology. Garmin separately publishes a description of the protocol at
`https://developer.garmin.com/fit/protocol/`, served over the open web with no login and no
click-through acceptance, under its ordinary website terms. **Is the public web page outside the
agreement — such that a codec written solely from it, and from FIT files we lawfully hold, never brings
us within §2 at all?** Everything in this ADR rests on yes. If the answer is no, option (c) collapses
into option (a) and ADR 0001 is reopened.

**Question 2 — are the Global FIT Profile's message and field numbers facts or expression?**

The message numbers, field numbers, scales, offsets and units are the interface specification of a wire
format. Recording them as our own data structures, from sources other than the SDK, is either the
recording of unprotectable facts and interface specifications — the analysis in *Google v. Oracle*
(2021), where reimplementing declaring code for interoperability was held to be fair use — or it is
copying protectable expression. **Which?** If facts, R2 and R3 are sufficient and `packages/fit` can
proceed. If expression, no lawful source for the profile exists short of a licence, and this project
cannot ship a FIT codec at all in its current licensing shape.

Two things a lawyer is **not** being asked, because they do not need answering: whether the general
"an npm dependency is not redistribution" argument is sound — it is unresolved and this project does
not rely on it either way, because a bundled browser build under AGPL §13 puts us outside its reach
regardless; and whether §2(f) forbids conformance validation with a Garmin tool — the answer is moot,
because R1 forbids obtaining the tool for an independent and prior reason.

---

## Notes

Not legal advice, as stated at the top and as ADR 0001 states about itself. The specific points where
a lawyer adds value are the two questions above; ADR 0001 already names one of them ("the §2(d) FIT
conflict (#58)") as one of its own two, and this ADR resolves that into the sharper pair. The other,
the ODbL derivative-database question, is unaffected and remains with #64.

The FIT Protocol License Agreement may be amended by Garmin unilaterally under §11(g). The digest
recorded in the sources table above is what makes a future change detectable: recompute
`shasum -a 256` over `garmin/fit-javascript-sdk/LICENSE.txt` and compare against
`6cc7ff94b5afc8c3a2b14aeb3e90da97a9fb6c8d40644304da94df5cf56428cf`. A different digest means the terms
this ADR reasons about have moved and this ADR needs re-reading — not editing, since it is a protected
path, but superseding.
