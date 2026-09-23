# ADR 0031: Model licences — committed weights are already covered, and a hosted model is in no closure at all

- **Status**: Accepted. ⚠️ **No question here is left to the owner**, which makes this the one Phase A
  document of the four that decides everything it was asked to. **D-0** still blocks implementation,
  because the other three Phase A documents do
- **Date**: 2026-09-22
- **Deciders**: the author, as engineering work. This ADR **discharges a gap** rather than reversing
  a decision: `CLAUDE.md` §3 and [ADR 0015](0015-dependency-licences.md) rule on dependencies, and
  [ADR 0023](0023-cc-by-assets-and-attribution.md) rules on committed assets, and **neither reaches a
  model reached over an API.** It is the third time a licence gate's fail-closed branch has produced
  an ADR rather than a waiver, after [ADR 0016](0016-unlicense.md) and ADR 0023 — except that this
  time the branch did not fire, because nothing exists for it to fire on. That is the finding
- **Issue**: [#380](https://github.com/openzigs/onyourleft/issues/380). Parent
  [#377](https://github.com/openzigs/onyourleft/issues/377)
- **Number**: **0031**, read from [`docs/architecture.md`](../architecture.md)'s ownership table
  after [ADR 0029](0029-camera-imagery-as-a-data-class.md) and
  [ADR 0030](0030-what-the-app-may-say-about-a-body.md) took 0029 and 0030 in the same pull request.
  ⚠️ **0021 is a live reservation** ([#330](https://github.com/openzigs/onyourleft/issues/330)) and
  is left alone
- **Supersedes**: nothing. ⚠️ In particular it does **not** extend, narrow or restate
  [ADR 0015](0015-dependency-licences.md)'s dependency tables or
  [ADR 0023](0023-cc-by-assets-and-attribution.md)'s asset sets. Both stay exactly as written and
  **D-2 explains why widening either would have been the wrong repair**
- **Relates to**: [ADR 0015](0015-dependency-licences.md) (the closure axis this reasons with),
  [ADR 0016](0016-unlicense.md) and [ADR 0023](0023-cc-by-assets-and-attribution.md) (the two
  precedents for a licence ruling), [ADR 0025](0025-app-store-additional-permission.md) (D-5's
  `DEP002`, which is why "compatible" is not "shippable"),
  [ADR 0026](0026-realistic-game-world.md) (D-5, the derived-asset rule D-8 applies to a quantised
  weights file), [ADR 0002](0002-local-first-architecture.md) (what D-6 does and does not disturb),
  [ADR 0029](0029-camera-imagery-as-a-data-class.md) (D-7, whose endpoint this document says what
  may be at the far end of),
  [#328](https://github.com/openzigs/onyourleft/issues/328),
  [#339](https://github.com/openzigs/onyourleft/issues/339),
  [#387](https://github.com/openzigs/onyourleft/issues/387)

---

## Context

### Half of this is already solved, and a sentence in #328 says otherwise

[#328](https://github.com/openzigs/onyourleft/issues/328) states, correctly as of 2026-09-16:

> *"`DEP001` will not catch them because they are not a dependency."*

⚠️ **That has not been true since [#339](https://github.com/openzigs/onyourleft/issues/339) landed
`ASSETS.toml` and rules `ASSET001`–`ASSET006`**, and a sub-issue inheriting the sentence would
re-derive a solved argument and build a second, parallel checker. Discovery in
`scripts/check-repo-rules.sh` walks for binaries **by content** — a NUL byte in the first 8000,
git's own rule — deliberately **not** by an extension list, because a list fails closed against
deleting a format and **open** against adding one. A committed `.tflite`, `.onnx`, `.task`,
`.safetensors` or `.gguf` is such a binary and is inside the gate the day it lands, with no edit to
the checker at all. **D-1 records that, and #328 carries a comment pointing here.**

### The half that is a genuine hole

**A model reached over an API is covered by nothing in this repository.**

| Gate | Why it does not see a hosted model |
|---|---|
| `DEP001`/`DEP002` | It reads pnpm's resolution of the lockfile. A hosted endpoint is in no dependency closure |
| `ASSET001`–`ASSET007` | They walk committed files. A hosted model is not a file here |
| `LIC001`–`LIC006` | They read SPDX headers in source we write. There is no file to head |
| `check:licences` | The union over every workspace package's closure. Same reason as `DEP001` |

Every licence gate this repository has is built on one of two substrates — **the lockfile** or **the
working tree** — and a hosted model is in neither. **This epic is the first thing in the repository
to reach for one**, and owner decision **D-B** on #377 makes it reachable by design.

### The concrete case, read first-hand rather than inherited

#377 and #380 both name **Kimi K3**, from the owner's own sketch. The licence text was read on
**2026-09-22** from `https://huggingface.co/moonshotai/Kimi-K3/raw/main/LICENSE` — the file itself,
not a summary — and the Hugging Face API for the same repository reports the tag `license:other` on
the same date. The operative clauses, quoted in the fragments the analysis turns on:

> *"'Model as a Service' means giving a third party access to language model inference or fine-tuning
> (e.g., via API) in a manner that allows such third party to exercise meaningful control over the
> inputs, parameters, or training data. This does not include (a) end-user products with model
> capabilities solely embedded within specific features or harnesses, or (b) mere relaying of
> requests to models hosted by others.*
>
> *If the Licensee or any of its affiliates operates a Model as a Service business, and the aggregate
> revenue of the Licensee and its affiliates exceeds 20 million US dollars … in total over any
> consecutive 12 months, the Licensee must enter into a separate agreement with Moonshot AI before
> using the Software or its derivative works for any commercial purpose."*
>
> — Kimi K3 License §2

> *"If the Software (or any derivative works thereof) is used for any of the Licensee's commercial
> products or services that have more than 100 million monthly active users, or more than 20 million
> US dollars … in monthly revenue, 'Kimi K3' must be prominently displayed on the user interface of
> such product or service."*
>
> — §3

> *"The requirements set forth in Sections 2 and 3 do not apply to: (a) internal use of the Software,
> defined as any use that does not make the Software, its outputs, or its underlying capabilities
> available to third parties; or (b) any use of the Software accessed through Moonshot AI's official
> products or certified inference partners."*
>
> — §4

⚠️ **Two facts the first-hand read adds that #377 and #380 do not carry**, recorded in
[ADR 0007](0007-patent-posture.md) D7's shape because both cut *toward* the model rather than
against it and a document that only recorded the unfavourable half would be arguing rather than
reporting:

- **§2's own definition of Model-as-a-Service excludes what this app would be.** *"End-user products
  with model capabilities solely embedded within specific features or harnesses"* and *"mere relaying
  of requests to models hosted by others"* are both carved out by name, and this app is the first
  and — under owner decision D-B's hosted path — the second.
- **§4(a)'s internal-use exemption** disapplies §2 and §3 entirely for a use that makes nothing
  available to third parties. A rider running a model on their own machine for themselves is
  squarely inside it.

**Neither changes the ruling, and D-5 says why.** `CLAUDE.md` §3 rules on **the licence**, not on
whether this project currently trips its conditions: *"Anything non-OSI — BUSL, SSPL, CC-BY-NC,
'commercial use requires a licence' — fails everywhere and needs an ADR before it is even
discussed."* §2 is literally *"commercial use requires a licence"* above a revenue line, and a
licence whose obligations switch on at somebody's balance sheet is not a permissive licence whatever
the current balance sheet says. This ADR is the *"before it is even discussed"* that sentence asks
for, and the discussion ends in a refusal.

### There is no licence pressure to reach for a restricted model

Read **2026-09-22** from Hugging Face's own model API, which reports the licence tag each repository
declares. ⚠️ **What that establishes is the tag, not the licence file** — for Kimi K3 the file itself
was read, and for the rest it was not.

| Model | Repository read | Tag on 2026-09-22 |
|---|---|---|
| Qwen3-VL 4B / 8B Instruct | `Qwen/Qwen3-VL-4B-Instruct`, `…-8B-Instruct` | `license:apache-2.0` |
| Molmo2-4B | `allenai/Molmo2-4B` | `license:apache-2.0` |
| InternVL3-8B | `OpenGVLab/InternVL3-8B` | `license:apache-2.0` |
| Pixtral 12B | `mistralai/Pixtral-12B-2409` | `license:apache-2.0` |
| Gemma 4 (12B, 31B, E4B `-it`) | `google/gemma-4-12B-it` and siblings | `license:apache-2.0` — ⚠️ this **resolves #377's recorded contradiction in the direction of Apache-2.0 at the tag level**, and the model card's own text was **not** read, so a prohibited-use flow-down in the card is not excluded |
| Llama 4 Scout | `meta-llama/Llama-4-Scout-17B-16E-Instruct` | `license:other` — the Llama 4 Community License. **Not OSI** |
| NVLM 1.0 D 72B | `nvidia/NVLM-D-72B` | `license:cc-by-nc-4.0`. **Not OSI**, and `CC-BY-NC` is refused by name in ADR 0023 D-2 |
| Kimi K3 | `moonshotai/Kimi-K3` | `license:other`; **licence file read in full**, quoted above |
| YOLO26 | `Ultralytics/YOLO26` | `license:agpl-3.0` |

⚠️ **MoveNet and BlazePose were NOT re-verified** and #377's *"could not confirm"* row for MoveNet
stands: Apache-2.0 is reported by redistributors rather than by a first-party Google model card, and
the TF Hub page's own CC-BY-4.0 covers its *content* rather than the weights. **Nothing may be
committed on that basis** — `ASSET004` would fail closed on an unrecorded licence anyway, which is
the gate doing its job.

**Four Apache-2.0 vision-language models with verified tags exist at sizes that run on a consumer
machine.** So every restricted candidate is a want rather than a need, which is what makes the
refusals below cheap.

---

## Decision

Eight rules. **D-1** to **D-2** are about committed weights, which are already solved. **D-3** to
**D-5** are the hole. **D-6** is what it costs the architecture. **D-7** is the gate deliberately not
written. **D-8** is the one new obligation on `ASSETS.toml`, and it is about quantisation.

### D-0 — Nothing is built until Phase A lands, and this ADR builds nothing

No model of any kind is fetched, committed, or reached until #378, #379, #380 and #381 are closed —
#377's own rule. This ADR adds no dependency, no script rule, no CI step and no line of TypeScript.

### D-1 — Committed weights are covered today by `ASSET001`–`ASSET007`, and **no second checker is built**

> **The rule.** A model weights file committed to this repository is an asset, governed by
> `ASSETS.toml` and rules `ASSET001`–`ASSET007`, exactly as a `.glb` or a launcher icon is. Nothing
> new is written for it.

| Rule | What it already requires of a weights file |
|---|---|
| `ASSET001` | It is named in `ASSETS.toml`, or the build is red. Discovery is by **content**, so no format list needs extending |
| `ASSET002` | The manifest names no path that is not there |
| `ASSET003` | Its SHA-256 reproduces |
| `ASSET004` | Its licence is permitted **where it lands** — and fails closed on anything unlisted |
| `ASSET006` | If the licence requires attribution, `creator`, `url` and `modified` are all recorded |
| `ASSET007` | If it is derived, the derivation is recorded and repeatable — see **D-8** |

**#328's sentence is superseded** and that issue carries a comment saying so. The failure this rule
prevents is named in #380's own body: a future implementer re-deriving a solved argument and
building a second, parallel checker — which is how a repository ends up with two gates that disagree
and a third nobody runs.

### D-2 — Which licence classes are admissible for **committed** weights, and why neither existing set is widened

The answer is **the sets that already exist**, applied unchanged:

| Class | Where a weights file carrying it may land | Examples |
|---|---|---|
| **Permissive** (`Apache-2.0`, `MIT`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`) | Anywhere | Qwen3-VL, Molmo2, InternVL3, Pixtral |
| **Weak** (`CC0-1.0`, `MPL-2.0`, `BlueOak-1.0.0`, `MIT-0`, `0BSD`, `Unlicense`) | `apps/` only | — |
| **Attribution-requiring** (`CC-BY-4.0`) | `apps/` only, **and only with `creator`, `url` and `modified`** — ADR 0023 D-3, and the credits screen is the discharge | — |
| **Copyleft** (`GPL-*`, `AGPL-3.0`, `CC-BY-SA-4.0`) | **Nowhere.** Fatal under `packages/` unconditionally (`CLAUDE.md` §3), and since [ADR 0025](0025-app-store-additional-permission.md) **D-5** not shippable in an app either — an app-store additional permission this project's copyright holders grant cannot reach a third party's copyleft | **YOLO26 (`AGPL-3.0`)** |
| **Non-OSI use-restricted** (`CC-BY-NC-4.0`, OpenRAIL-M and the RAIL family, Llama-style community licences, the Kimi K3 License, and any licence conditioning use on revenue, headcount, field of endeavour or an acceptable-use policy) | **Nowhere** | NVLM 1.0, Llama 4, Kimi K3 |

⚠️ **OpenRAIL-M is ruled on by name although nothing here uses it**, because it is the licence a
contributor is most likely to meet on a model card and most likely to read as open: it grants
broadly and then attaches **use restrictions** in an annex. A use restriction is a restriction on
fields of endeavour, which is what puts it outside the OSD — so it is refused under `CLAUDE.md` §3's
non-OSI sentence, like the rest of its row, and *"but the restrictions are ones we would never
breach"* is not an argument, for exactly the reason D-5 gives about Kimi K3's thresholds.

⚠️ **Neither ADR 0015's nor ADR 0023's list is widened**, and that is the decision rather than an
omission. Every class above is already handled by the sets those ADRs define: the permitted ones are
in them, and every refused one fails `ASSET004`'s **fail-closed** branch, which is the branch that
produced ADR 0016 and ADR 0023 in the first place. Widening a list to name a licence that must be
refused would be the opposite of what a fail-closed gate is for. **What this ADR adds is the
statement of which classes exist and how each is decided, so the fail-closed failure has a document
to point at rather than producing a fourth ADR.**

### D-3 — A hosted model is in **no closure**, and it is admitted only with a **named ADR** recording its terms

> **The rule.** No code under `apps/` or `packages/` may be merged that reaches a specific hosted
> model — by name, by default endpoint, or by shipped configuration — unless an ADR records, at
> minimum: the vendor, the endpoint, the URL of the terms, **the date they were read**, what is
> transmitted, and what the rider is told. `ASSETS.toml` is **not** where this goes.

**Why not `ASSETS.toml`.** Its schema is about committed bytes: `path` is repository-relative and
exact, `sha256` is over the committed file, `ASSET002` fails on a path that is not there and
`ASSET003` on a digest that does not reproduce. A hosted model has no path and no bytes, so three of
its five required keys are unanswerable and a row for one would be a row every rule skipped. **A
manifest whose entries some rules cannot check is worse than no entry, because the file's whole
value is that every row is checked.** `ASSET005` refuses an unrecognised key for the same family of
reason (ADR 0017 D-4's choice), and inventing a second entry shape would be reopening it.

**Why an ADR rather than a new data file.** Because the thing that actually needs recording is a
*decision* — somebody read somebody else's terms and concluded this project may rely on them — and
this repository already has exactly one artefact for that, with a numbering gate, an amendment
convention and a review habit attached to it. A new file would need a new rule, a new fixture and a
new place for a reader to forget to look.

**And the rider is told, which is the part a file could never do.** Whatever an ADR records, the
consent screen [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-7 quotes is what a rider
actually reads, and it says the operative thing: *"That is a company or a computer that is not yours
and not ours, and we cannot see what they do with it or how long they keep it."*

### D-4 — The bring-your-own-key path is **permitted**, and what makes it permissible is that this client names no vendor

This is the genuinely hard question #380 identifies, and §3 does not answer it mechanically: §3
governs what this repository's **closure** contains, and a hosted endpoint is in no closure at all.
The ruling, with the reasoning shown because it is the one that could be got wrong in either
direction:

> **The rule.** A rider may point this client at a model endpoint **they** chose, on **their** key,
> under **their** agreement with whoever runs it. To make that true rather than nominal, **this
> client ships no vendor name, no vendor list, no default endpoint and no vendor-specific request
> shaping.** There is one code path, it takes a URL and a key the rider typed, and the same path
> serves a local Ollama or `llama.cpp` instance and a hosted service.

Four conditions, all of them checkable in review:

1. **No key of this project's ever ships, is defaulted, or is suggested.** `.env.example` gains
   nothing; `ENV001` already fails the build on an environment variable the template does not list,
   and there is none to list.
2. **No vendor endpoint is hard-coded, and no vendor is named in source.** Not in a constant, not in
   a placeholder, not in a dropdown, not in a comment that a future contributor promotes to a
   default. A rider who wants Kimi K3 types Moonshot's URL; nothing in this repository told them to.
3. **The request is vendor-neutral.** It targets the OpenAI-compatible shape that Ollama and
   `llama.cpp` both serve — which is what makes condition 2 a design consequence rather than a
   discipline: there is nothing vendor-specific to write, because the local path needs none.
4. **Anything non-OSI is refused wherever *we* choose it**, and permitted only where the rider chose
   it themselves. D-2 is unchanged; what D-4 adds is that a rider's own contract with a vendor is
   not this repository's closure and is not this repository's to police.

**Why this is the right line, rather than a refusal.** A refusal would say a rider may not use their
own account with their own supplier through software they run. That is a restriction on the user,
from a project whose whole licence posture exists to prevent restrictions on the user, and it would
be unenforceable in any case — the rider can point a local proxy at anything. **Why it is not
broader**: the moment this client names a vendor, it is recommending one, its request shaping is
written for one, and the vendor's terms start to describe a relationship this project has rather
than one the rider has. Conditions 2 and 3 are what keep that from happening by accretion.

⚠️ **This also means the client cannot help the rider.** No provider picker, no "known good"
endpoints, no test-this-key button that knows what a valid key looks like. That cost is real, it
falls on the least technical rider, and it is accepted.

### D-5 — Kimi K3, by name: refused as anything this project ships, names or selects

> **The ruling.** Kimi K3 may not be committed, named in source, offered in a list, set as a
> default, or presented to a rider as an option. It is reachable **only** as a URL a rider types
> under D-4.

Three reasons, in order of weight:

1. **Its licence is not OSI-approved and conditions commercial use on revenue.** §2, quoted above.
   `CLAUDE.md` §3: anything non-OSI *"fails everywhere and needs an ADR before it is even
   discussed"*. ⚠️ **Being below both thresholds today is not the answer**, and neither are §2's
   carve-out and §4(a)'s internal-use exemption, both of which this ADR found by reading the file
   and both of which cut the other way. §3 rules on the licence and not on the balance sheet, and a
   licence whose obligations switch on at a revenue line is a licence this project would have to
   re-read every time its circumstances changed. That is precisely the class of obligation a path
   rule exists to avoid.
2. **It cannot be the local half of owner decision D-B, ever.** 2.8 T total / 104 B active
   parameters, ~1.56 TB of weights, and Moonshot's own deployment guidance recommends 64+
   accelerators (#377, read 2026-09-19). So *"a local LLM **or** Kimi K3"* conflates D-B's two
   halves, and the two must never be presented as interchangeable — one is the default and one is
   the opt-in that #377's own D-B gates behind explicit consent.
3. **Nothing needs it.** D-2's table lists four Apache-2.0 vision-language models with tags verified
   on 2026-09-22, at sizes that run at 4-bit on a 16–24 GB machine. The owner's suggestion is
   answered in writing rather than quietly dropped, and the answer is that the thing it would buy is
   already available under a licence with no conditions at all.

### D-6 — What a hosted model does to ADR 0002's promise and to the cost model

**ADR 0002 is not disturbed, and saying why matters more than the conclusion.**
[ADR 0002](0002-local-first-architecture.md)'s promise is about **where the canonical artefact
lives**: the athlete's signed files are the source of truth and the device holds them. A frame sent
out for analysis is not a canonical artefact — under
[ADR 0029](0029-camera-imagery-as-a-data-class.md) D-2 it is usually not an artefact at all by the
time the analysis returns — and what comes back is a description the rider reads, not a record
anything depends on. **Local-first survives.**

⚠️ **What does not survive is `docs/privacy-policy.md`'s first sentence**, and that is
[ADR 0029](0029-camera-imagery-as-a-data-class.md)'s and #377's open question 1, not this
document's. It is named here so that a reader who concludes "ADR 0031 says the architecture is fine"
does not also conclude the policy is.

**The cost model gains nothing, and the trigger that would change that is named.**
[`docs/cost-model.md`](../cost-model.md) is gated by `check:cost-model`, which recomputes every
figure from the inputs beside it. Under D-4 the machine is the rider's, the key is the rider's, the
LAN is the rider's, and this project pays nothing — **so the model gains no input and
`check:cost-model` has nothing to recompute.** ⚠️ **The assumption breaks the moment *we* supply a
key**, which D-4 condition 1 forbids; if that is ever reversed, the cost model gains an input
(tokens or images per rider per month, and a per-unit price with its provenance and confidence word)
and `check:cost-model` is where the arithmetic is redone rather than argued. ⚠️ **It has not been
run for this ADR**, because nothing in this ADR changes an input, and running a gate to observe that
it is unchanged is not evidence of anything.

### D-7 — **No new `check-repo-rules.sh` rule is written**, and the trigger that would make one owed

#380's acceptance criterion is conditional — *"If the ruling adds a checkable rule…"* — and this
ruling deliberately does not.

**Why not.** There is nothing to check. No weights file is committed, so the rules that would govern
one are `ASSET001`–`ASSET007` and they already exist. No hosted model is reached, so a rule
requiring an ADR for one would scan a tree in which no such code exists and pass on every run from
the day it lands. That is the **"guard that cannot fire"** shape `CLAUDE.md` tabulates and this
repository has shipped several times — and worse here than usual, because a rule that passes
vacuously about *licences* reads as a licence check having been performed.

`CLAUDE.md`'s own habit says the same thing from the other side:
`scripts/check-dependency-licences.mjs` records that *"a licence nobody has a dependency for is a
licence nobody has read"*, which is why `Zlib` is still unruled after ADR 0016. A gate for an
artefact class with no members is that sentence in reverse.

**The trigger, stated precisely so it is not a matter of judgement.** A rule is owed in the **same
pull request** as whichever of these lands first:

1. The first committed weights file — at which point the rule worth writing is not a new `ASSET`
   rule but a **fixture** in `scripts/check-repo-rules.test.sh` proving `ASSET004` goes red on a
   non-OSI model licence, because that is the branch everything above rests on and nothing has ever
   exercised it against this class.
2. The first code that reaches a model endpoint (#387) — at which point a scan for a hard-coded
   vendor host or a vendor name under `apps/web/src`, in the shape of
   `apps/web/src/units/no-inline-units.test.ts`, is what makes **D-4 conditions 2 and 3**
   mechanical rather than editorial. ⚠️ It is a **Vitest source scan, not a script rule**, for the
   reason `no-inline-units.test.ts` is one: it needs to know which module is allowed the exception,
   which is a question about the module graph rather than about paths.

Until then **D-1 to D-6 are review-time obligations**, and a reader should know that rather than
infer an enforcement that is not there — [ADR 0007](0007-patent-posture.md)'s §"Which of D1–D7 a
machine checks" is the precedent and the wording.

### D-8 — A **quantised** weights file is a derived asset, and `ASSET007` already says what it owes

This is the one new obligation, and it is the one a first committed model would actually trip.

Nobody commits a 16-bit `.safetensors` release to an app repository; they commit a 4-bit or 8-bit
quantisation, or a converted `.tflite`/`.onnx`/`.gguf`. **That file is not the upstream artefact** —
it is a file this repository made from an upstream input by running a tool — which is exactly
[ADR 0026](0026-realistic-game-world.md) **D-5**'s definition, and `ASSET007` is the rule.

> **The rule.** A weights file this repository produced from an upstream release by quantising,
> converting, pruning or merging is a **derived** asset. Its `ASSETS.toml` row carries `input`,
> `inputsha256`, `script` and `tool` alongside the five ordinary keys, with `modified` saying in
> words what was done — *"quantised to 4-bit with …"*, not *"yes"*.

Three things follow and each is the point:

- **`sha256` alone would have been misleading.** It pins what is committed, and for a converted file
  that is a number nobody can relate to anything: the upstream release's own digest does not match
  it and never will, so the row would record provenance that cannot be checked against its source.
  `inputsha256` is what restores that.
- **`script` must be committed** — `ASSET007` fails on a script that is not in the repository,
  because *"a derivation whose script is not committed cannot be repeated"*. So a quantisation run
  by hand in a notebook cannot be recorded, which means it cannot be committed.
- **`tool` is a pinned version**, because two versions of a quantiser produce different bytes from
  the same input, the same way ADR 0026's note about Blender's decimation says.

⚠️ **The upstream licence travels with the derived file, and `ASSET004` judges the derived file's
row.** Quantising an Apache-2.0 release produces an Apache-2.0 file; quantising a Llama 4 release
produces a file still bound by the Llama 4 Community License, which D-2 refuses. **Conversion is not
laundering**, and the reason to say it out loud is that a `.gguf` looks like a new file in a way a
resized texture does not.

---

## Consequences

### What this enables

- **#387 can be written**, knowing what may be at the far end of the pipe
  [ADR 0029](0029-camera-imagery-as-a-data-class.md) D-6 and D-7 describe, and knowing that the
  answer is "whatever the rider typed" rather than a vendor somebody has to choose.
- **#328 is unblocked on the licence question** for a committed on-device pose model: D-1 says the
  gate exists, D-2 says which licences pass, D-8 says what a quantised one owes.
- **A future contributor meeting OpenRAIL-M or a Llama-style licence has an answer** with the
  reasoning attached, rather than a fail-closed gate and an argument.
- **The owner's own suggestion is answered in writing.** D-5 refuses Kimi K3, having read its
  licence rather than a summary of it, and records the two clauses that cut in its favour as well as
  the ones that do not.

### What this costs, stated plainly

- **The client cannot help a rider configure a hosted model.** D-4 conditions 2 and 3 mean no
  provider list, no defaults and no test button. The least technical rider pays that cost, and the
  feature will look unfinished beside any product that ships a dropdown.
- **No gate covers the hosted path**, and D-7 says so rather than shipping one that could not fire.
  That leaves D-3 and D-4 as review-time obligations for however long it takes #387 to land, which
  is the period in which they are most likely to be forgotten.
- **A quantised model becomes materially more expensive to commit.** D-8 means a committed
  quantisation script, a pinned tool version, a locked input digest, and a reproduction somebody
  runs by hand. That is a real barrier to *"just drop the .gguf in"*, and it is meant to be.
- **MoveNet and BlazePose are still unverified**, so the two models most obviously suited to #328's
  on-device classifier cannot be committed on today's evidence.

### Constraints this places on other work

| Issue | What it inherits |
|---|---|
| [#387](https://github.com/openzigs/onyourleft/issues/387) | D-3 entire, D-4's four conditions, and D-7's trigger 2 — the vendor-name source scan lands with the code it constrains |
| [#328](https://github.com/openzigs/onyourleft/issues/328) | D-1, D-2, D-8, and D-7's trigger 1 — the first committed weights file brings the red `ASSET004` fixture |
| Any future model work | D-2's five classes, and D-5 as the worked example of a refusal |
| [#54](https://github.com/openzigs/onyourleft/issues/54) | Nothing today. D-6 names the one change that would give it an input |

---

## What was read, and when

| Source | Where | Read |
|---|---|---|
| Kimi K3 License, **in full** | `huggingface.co/moonshotai/Kimi-K3/raw/main/LICENSE` | 2026-09-22 |
| Kimi K3 licence **tag** (`license:other`) | `huggingface.co/api/models/moonshotai/Kimi-K3` | 2026-09-22 |
| Licence **tags** for Qwen3-VL 4B/8B, Molmo2-4B, InternVL3-8B, Pixtral 12B, Gemma 4 (12B/31B/E4B), Llama 4 Scout, NVLM-D-72B, YOLO26 | `huggingface.co/api/models/<repo>` | 2026-09-22 |
| `ASSETS.toml`'s own header, `ASSET001`–`ASSET007` in `scripts/check-repo-rules.sh` | this repository, at `5ed21c8` | 2026-09-22 |
| Kimi K3's size and deployment guidance; the Cloudflare and accuracy findings | [#377](https://github.com/openzigs/onyourleft/issues/377)'s body, **not re-verified here** | 2026-09-19 by #377 |

⚠️ **A licence tag is not a licence.** For every row but the first, what was read is the string a
repository declares on a metadata endpoint. The file itself was read for exactly one model, and
`ASSET004`'s fail-closed branch is what stops a wrong tag becoming a committed file — because a
licence that is not on a list fails whether the tag was right or not.

---

## What would make this ADR wrong

- **A weights file is committed whose licence is one of D-2's refused classes**, on the argument
  that the obligations do not currently bind. D-5's first reason is written to close that, and it is
  the argument most likely to be made, because it is a reasonable argument about a balance sheet and
  an unreasonable one about a licence.
- **D-4 is read as permitting a vendor picker "for convenience".** Conditions 2 and 3 are the whole
  of what makes the bring-your-own-key path a rider's relationship rather than this project's, and a
  dropdown is the specific thing that dissolves them.
- **A quantised file is committed as though it were upstream bytes.** `ASSET003` would pass — the
  digest is over what is there — and `ASSET007` would not fire, because nothing declares the row
  derived. **That is the one place this ADR's rules can be satisfied by an entry that is untrue**,
  and it is a reviewer's question: *is this file the upstream release, or something we made?*
- **A hosted model reaches this client before #387**, through a dependency that calls out on its own
  initiative. `no-network.test.ts` scans the source this project writes and says plainly that it
  does not scan dependencies. D-3 would be breached by something no gate here can see.
- **The Kimi K3 License is revised.** Every quotation is dated 2026-09-22 from the file; a later
  version is a new read.
