# ADR 0001: Licensing

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: repository owner (confirmed 2026-09-03)
- **Issue**: [#18](https://github.com/openzigs/onyourleft/issues/18)
- **Supersedes**: nothing
- **Constrained by**: [#58](https://github.com/openzigs/onyourleft/issues/58) (FIT codec licensing),
  [#59](https://github.com/openzigs/onyourleft/issues/59) (patent posture)

## Context

Until this ADR landed, the repository had no `LICENSE` file. Under the Berne Convention that is not
a neutral state: work without a licence is under exclusive copyright by default, so nobody could
legally fork, contribute to, or self-host it. Every stated goal of the project requires that they
can.

Four separate questions have to be answered together, because a choice on any one of them can
invalidate a choice on another.

### 1. What is this project trying to prevent?

Not use. Not commercial use. Specifically: **someone taking the source, closing it, and running it
as a paid hosted service** — the failure mode that a permissive licence does nothing about, and the
one every closely-analogous project in this space chose copyleft to avoid.

| Project | Domain | Licence |
|---|---|---|
| Auuki | Browser + Web Bluetooth trainer control | AGPL-3.0 |
| GoldenCheetah | Cycling analysis | GPL-2.0 |
| Indoor Bike | Android, local-first trainer app | GPL-3.0 |

A plain GPL does not close this hole. GPL obligations attach to *distribution*, and running software
as a network service is not distribution — the "SaaS loophole". **AGPL-3.0 §13** is the clause that
closes it: users interacting with a modified version *over a network* must be offered its source.

### 2. Patents are a live risk here, not a hypothetical one

**Strava sued Garmin over live segment-matching patents on 2025-09-30.** Segment matching is a core
feature of this project (#65, #66). Separately, Peloton's leaderboard patent family led both Echelon
and iFIT to remove on-demand leaderboard technology in settlement rather than litigate (#59).

This decides one thing on its own: **not MIT.** MIT is silent on patents. It grants copyright
permission and says nothing about patent rights, so it offers no defensive posture at all in a field
with active litigation. **Apache-2.0 §3** grants an express patent licence from every contributor and
terminates that licence for anyone who files a patent suit alleging the work infringes. That is the
crispest patent protection available in a standard licence, and it costs nothing to adopt.

AGPL-3.0 also carries patent provisions (§11), so the protection is not lost on the copyleft side.

### 3. The cost of copyleft lands unevenly

AGPL's real cost is that no permissively-licensed project can embed our code. For the *application*
that cost is close to zero — nobody embeds an application. For the **reusable leaf packages** it is
the whole value: a FIT codec, a BLE sensor abstraction and a shared domain package are worth more to
this project's ecosystem if other people can actually use them, including in permissive and
commercial projects.

Compatibility runs one way, which makes the split safe: **Apache-2.0 code can be combined into an
AGPL-3.0 work; AGPL-3.0 code cannot be combined into an Apache-2.0 work.** Our own application can
therefore consume our own libraries freely, while outsiders can adopt the libraries alone.

### 4. Options considered

| Option | Closes SaaS hole | Patent grant | Libraries adoptable | Verdict |
|---|---|---|---|---|
| MIT everywhere | No | **No** | Yes | Rejected — no patent grant, and Strava v. Garmin is active |
| Apache-2.0 everywhere | **No** | Yes | Yes | Rejected — permits a closed paid hosted fork |
| AGPL-3.0 everywhere | Yes | Yes | **No** | Rejected — kills the leaf packages as reusable components |
| **AGPL-3.0 app + Apache-2.0 libraries** | Yes | Yes | Yes | **Accepted** |

## Decision

### Code

**`AGPL-3.0-or-later`** for the application: the instance server, the web app, and anything that is
part of the deployed product.

**`Apache-2.0`** for the reusable leaf packages — the shared domain package (#25), the FIT/GPX/TCX
codec (#29–#32), and the BLE sensor abstraction and device clients (#39–#44).

Mechanically:

- The root `LICENSE` file carries the **full, unmodified** AGPL-3.0 text. It is the repository's
  default licence: anything not explicitly marked otherwise is AGPL-3.0-or-later.
- `LICENSES/Apache-2.0.txt` carries the full, unmodified Apache-2.0 text.
- Each Apache-2.0 package must carry its **own** `LICENSE` file and declare
  `"license": "Apache-2.0"` in its manifest. A package that does not do both is AGPL by default,
  and that default is deliberate — the failure mode should be more copyleft, not less.
- Source files should carry an `SPDX-License-Identifier:` header. #23 configures the linter to
  enforce this, so the boundary is checked by a machine rather than remembered by a person.

**On the copyright line.** The `LICENSE` file is byte-identical to the canonical text from
gnu.org and is *not* edited to add one — modifying the licence text is itself a licensing problem,
and both licences say so. The copyright statement lives in `COPYRIGHT` and in per-file SPDX headers,
which is where the AGPL's own "How to Apply" appendix puts it. Copyright is held by
**"The On Your Left contributors"**, each retaining their own — see Contributor terms below.

Integrity of the committed texts, verifiable with `shasum -a 256`:

```
0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0  LICENSE
cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30  LICENSES/Apache-2.0.txt
```

### Data

**Deferred to ADR 0007, owned by #64, and it must land before #64 or #73 merges.**

The question: OSM-derived segment and route geometry served from an instance is plausibly a
**Derivative Database** under **ODbL 1.0 §4.4**, which attaches share-alike obligations to *that
dataset* independently of whatever licence the code carries. The OSMF test is whether the published
result "is intended for the extraction of the original data". A rendered map tile is a Produced Work
and needs attribution only; a stored corpus of OSM-snapped segment geometry probably is not, and
would inherit ODbL. **ODbL §4.6** offers a way out — publish the algorithm rather than the database.

This is deferred rather than decided because it depends on a design decision that has not been made
yet: whether segments are stored as OSM-snapped geometry or as raw GPS traces with snapping applied
at read time. The second shape may avoid the question entirely. Deciding the licence before the data
model would be deciding it blind.

**What is settled now:** any instance serving OSM-derived tiles or routes must display OSM
attribution, and the ODbL question must be answered before segment geometry is persisted anywhere.

### Contributor terms

**DCO (Developer Certificate of Origin) 1.1.** Contributors sign off commits with `git commit -s`.
`CONTRIBUTING.md` carries the text and the mechanics.

**No CLA.** This is a deliberate, and effectively irreversible, choice.

A CLA would preserve the option to relicense or dual-license the project later — for instance to
offer a commercially-licensed hosted tier. It has to be collected **from the first contributor
onward**: retrofitting one requires the consent of every copyright holder, and a single holdout
blocks it permanently. So the decision genuinely has to be made now.

We decline it because a CLA asks contributors to hand a single party the power to take their work
proprietary, which measurably suppresses contribution to community projects, and because the
relicensing option it preserves is one this project has just decided it does not want. **The
consequence: this project cannot be relicensed without unanimous consent of all contributors, and
therefore in practice cannot be relicensed at all.** That is the intended outcome — it is the same
property that protects contributors from a future maintainer closing the project.

### Self-hosting

**Yes — self-hosting is a first-class, supported, unconditional goal.** This answers open question 3
from #1 and unblocks #54.

It follows from decision D5 and ADR 0002 (#57): the recommended architecture is one small
self-hostable instance, not a single central service. Self-hosting is therefore not a courtesy
offered to enthusiasts, it is the deployment model. AGPL-3.0 §13 reinforces it — anyone running a
modified instance owes its users the source, so forks stay visible and self-hosters keep the same
rights we have.

## Consequences

### What this forecloses

- **A closed-source hosted commercial tier is off the table.** Anyone — including us — running a
  modified instance must offer users its source under AGPL §13. If the project later needs revenue
  for hosting, the routes remaining are donations, optional paid hosting of the *unmodified* open
  source, sponsorship or a foundation. Not a proprietary edition. This is the single most consequential
  effect of this ADR and it is intended: the tension between "free to the end user forever" and
  "someone pays the tile bill" is resolved in favour of the user.
- **Relicensing is effectively impossible** without unanimous contributor consent (no CLA, above).
- **Some organisations will not deploy AGPL software** under blanket policy, regardless of the
  merits. Expect this and do not treat it as a bug. The Apache-2.0 leaf packages are the mitigation:
  the parts most likely to be wanted elsewhere are the parts that are freely adoptable.

### What this enables

- Nobody can take this project closed and sell it back to its own users.
- The FIT codec, BLE layer and domain package can be adopted by anyone, including commercially,
  which is how they attract outside maintenance.
- Contributors and self-hosters get an express patent grant on the Apache-2.0 packages, in a field
  with active patent litigation.

### Constraints this places on other work

1. **#58 must reconcile the FIT codec with this decision — and it may conflict.** The Garmin FIT
   Protocol License **§2(d)** forbids distributing the Licensed Technology or derivatives "so that
   any part of it becomes subject to any license that requires that the Licensed Technology ... be
   disclosed or distributed in source code form, or that others have the right to modify it."
   On its face that names MIT, Apache-2.0 **and** AGPL-3.0 — every option this ADR could have
   chosen. **This ADR does not resolve that; #58 does, and #58 blocks #30 and #31.** A licence
   decision that makes the codec undistributable is not a licence decision, so if #58 concludes the
   conflict is real, this ADR is reopened rather than the codec shipped. The likely resolution is
   option (c) — implement from the published protocol documentation and depend on nothing carrying
   Garmin's terms — which is exactly why the codec is an Apache-2.0 leaf package rather than part of
   the AGPL application.
2. **#53 must re-check its routing engine choice.** OpenRouteService is **GPL-3.0**, pgRouting is
   **GPL-2.0**, tilemaker is FTWPL, and planetiler-openmaptiles carries a bespoke MapTiler/Klokan
   licence with attribution obligations. #53 currently names ORS as the bootstrap without flagging
   its licence. GPL-3.0 is compatible with AGPL-3.0 for our purposes, but it is not compatible with
   an Apache-2.0 leaf package, so the routing engine must stay on the application side of the
   boundary. Permissive alternatives confirmed 2026-09-02: OSRM (BSD-2), Valhalla (MIT), GraphHopper
   (Apache-2.0), BRouter (MIT), PMTiles implementations (BSD-3, spec CC0), MapLibre (BSD-3), Martin
   (Apache-2.0).
3. **#23 must not add a dependency whose licence conflicts** with the package it lands in, and must
   configure SPDX-header linting so the AGPL/Apache boundary is machine-checked.
4. **#64 and #73 are blocked** on the deferred data-licence question above.

## Notes

This ADR is an engineering decision recorded by engineers. It is not legal advice. The two places
where a lawyer would genuinely add value, rather than confirm the obvious, are the §2(d) FIT
conflict (#58) and the ODbL derivative-database question (#64).
