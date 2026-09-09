# ADR 0017: A workout file format of this project's own, and why not the de facto one

- **Status**: Accepted
- **Date**: 2026-09-09
- **Deciders**: the repository owner, on the question
  [#202](https://github.com/openzigs/onyourleft/issues/202) split out of
  [#14](https://github.com/openzigs/onyourleft/issues/14) precisely so that it would be decided
  rather than discovered in review. Drafted as engineering work; the ruling is the owner's, because
  the alternative is a licensing question and `CLAUDE.md` §3 makes those answerable **before** the
  code is written
- **Issue**: [#202](https://github.com/openzigs/onyourleft/issues/202)
- **Number**: **0017**. Every number from 0001 to 0016 was written and `CLAUDE.md` §7 recorded 0017
  as the next free one with no live reservation — the check §7 asks for before a number is taken.
  The same pull request moves that sentence, and [`docs/architecture.md`](../architecture.md)'s
  index, on to 0018
- **Supersedes**: nothing
- **Applies**: [ADR 0009](0009-clean-room-posture.md) R1 and L1, and
  [ADR 0006](0006-fit-codec-licensing.md) R2, to a format question none of them had been asked
  about. It **changes none of them**
- **Relates to**: [ADR 0009](0009-clean-room-posture.md) R5, whose "file-based interoperability is
  the entire interoperability surface" this decision extends by one format — a **native** one,
  which is a different thing from importing somebody else's and is treated as such below

---

## Context

[#14](https://github.com/openzigs/onyourleft/issues/14)'s scope section says, in as many words:

> *"A workout file format — the ZWO format is the de facto standard and is what the existing
> open-source corpus is written in … Adopting it buys an enormous free library."*

**The library really would be enormous and the argument for it is real.** That sentence was written
on 2026-09-03, before [ADR 0009](0009-clean-room-posture.md) existed, and #202's job was to say
whether it survives it. This ADR is the answer, and the answer is not "no to that format for ever" —
it is "not without a route that ADR 0009 permits, and there is not one today."

Everything #14 needs that does **not** depend on the answer is already built and shipped:
`packages/domain/src/workout/` holds the model, the timeline a player looks up rather than replays,
the ERG spiral-of-death rule and the player itself. **Every format that ever lands maps onto that
model.** What was missing was the ability to save a workout to a file, hand it to somebody, or bring
one back — which is the whole of what this ADR unblocks.

### The three things that collide, each answered rather than noted

#202 named three obstacles and said any one of them is enough to stop. Here is each, answered.

#### L1 — the mark

[ADR 0009](0009-clean-room-posture.md) L1 bans *"no Strava or Zwift name, mark, logo, stylisation,
brand colour or overall get-up in the product"*, and its check is a case-insensitive grep of the
diff where **every hit must be prose in `docs/`, `README.md`, `CLAUDE.md`, an issue or an ADR, or an
exact R3 template instance**.

A format named after a product puts this project in an argument about whether a file extension is a
mark. That argument may well be winnable — file extensions are functional, and functionality is not
what trademark protects — but **L1's check is a grep, and a grep does not weigh arguments.** An
adopted extension would appear in a file picker's `accept` string, in an exported filename, and
almost certainly in a directory name, and every one of those is a hit L1 forbids outright rather
than one it invites a defence of.

**Under this decision that argument does not arise.** The extension, the media type, the directory
and the version key all carry this project's own name. L1 is answered by having nothing to answer.

#### R1 — the compilation

[ADR 0009](0009-clean-room-posture.md) R1 permits taking **facts** — a UUID, an opcode, a byte
offset — and forbids taking **somebody's compilation of them as a table**:

> A **generated table** — a FIT profile, a message-definition map, a UUID registry — lifted as a
> table. The individual numbers are facts; **somebody's compilation of them is their work**, and a
> wholesale transcription takes the compilation.

**The element and attribute set of a file format is exactly such a compilation.** And R1's usual
escape hatch — *"re-derive from the specification, not from the implementation"* — is closed here,
because there is no published specification to re-derive from. The only statements of that format's
element set are inside implementations, and **every open implementation of it is GPL-2.0, GPL-3.0 or
AGPL-3.0**, which `CLAUDE.md` §3 makes fatal anywhere under `packages/` with no exemption.

So the ordinary route this repository used for FIT — read the published protocol documentation,
write it fresh, record where every number came from — **does not exist for this format.** That is
the material difference between #29–#32 and this, and it is why "we did it for FIT" is not an
argument that carries across.

**Under this decision R1 is not engaged at all.** Nothing was consulted. The field names in the
format below are the field names of `packages/domain/src/workout/workout.ts`, which this repository
authored under [#201](https://github.com/openzigs/onyourleft/issues/201). There is no third-party
compilation in the picture to have taken.

#### ADR 0006 R2 — provenance

[ADR 0006](0006-fit-codec-licensing.md) R2 requires the provenance of every profile number to be
recorded per message, and `packages/fit/README.md` §3 is where `packages/fit` discharges it — with a
test asserting the codec's table and the corpus's table agree, so that a disagreement is visible
rather than shared.

For an adopted format **the provenance column would read "recalled"**, which is the one outcome
ADR 0006 exists to prevent.

**Under this decision the provenance column reads `packages/domain/src/workout/workout.ts`, #201,
for every field**, because the format is a serialisation of a model in this repository. That is the
strongest provenance any format in this tree has, and it is the single best argument for (b).

### And #14's corpus criterion cannot be met as written

#14's fifth epic criterion asks that *"at least 50 workouts from the existing open ZWO corpus parse
and play without modification"*. That needs the corpus, vendored under a licence somebody has read.
Nobody has done that, there is no lawful offline route to it from this environment, and **the
criterion is therefore not met and is not claimed to be.** #14's own revision discipline
(`CLAUDE.md` §8, *"read the issue's revision block first"*) is what applies: the criterion predates
ADR 0009 and is superseded by this ADR, which replaces it with the round-trip and refusal criteria
in §Consequences.

---

## Decision

### D-1 — This project specifies its own workout file format. The de facto one is not adopted.

Route **(b)** of #202's three. Not (a), because R1 has no permitted route to the element set and
ADR 0006 R2 has no answer; not (c), because (c) is (b) plus a promise, and a deferral written into
an ADR is a promise nobody owns.

⚠️ **Importing the de facto format is filed as its own issue rather than deferred here.** That issue
carries the licence question and the corpus question, and it is where somebody with a lawful route
to a specification — or a rights-holder's permission — picks it up. This ADR does not decide against
it for ever; it declines to adopt it *on the evidence available today*, and §"What would make this
ADR wrong" says what would change that.

### D-2 — The format is JSON, and its shape mirrors the model one-for-one

```json
{
  "onYourLeftWorkout": 1,
  "name": "Over-unders",
  "description": "Three blocks of six.",
  "blocks": [
    { "kind": "steady", "seconds": 600, "target": 0.6, "label": "Warm-up" },
    { "kind": "ramp", "seconds": 300, "from": 0.6, "to": 0.9 },
    {
      "kind": "intervals",
      "repeats": 6,
      "hardSeconds": 180,
      "hardTarget": 1.05,
      "easySeconds": 180,
      "easyTarget": 0.6
    },
    { "kind": "free-ride", "seconds": 600, "label": "Spin down" }
  ]
}
```

**No renaming, no abbreviation, no wire-specific vocabulary.** A format that renames the model's
fields needs a mapping table, and a mapping table is a second source of truth for the model that can
drift from it silently. The cost of mirroring instead is real and is stated in §Consequences: the
format is coupled to the model's vocabulary, so renaming a model field is a format version bump.
That is the right way round — the bump is visible, a drifting mapping table is not.

JSON rather than XML because there is no third party to interoperate with. `packages/fit/src/xml/`
exists because GPX and TCX are somebody else's formats and had to be met where they are; a native
format has no such constraint, and `JSON.parse` is an ECMAScript built-in, which is what lets the
decoder live in a package that may name no platform API at all.

### D-3 — One key is both the identity and the version, and it is required

`onYourLeftWorkout: 1` answers both questions a reader has — *is this one of ours?* and *written to
which version?* — in a single key that **cannot disagree with itself**. A `format` string beside a
`version` number can, and the failure mode when it does is a decoder choosing which half to believe.

A document without that key is refused as not being a workout file, whatever else it contains, and
whatever it is called. **The decoder never looks at the filename**; identity is in the content.

### D-4 — An unrecognised key is a refusal, not something to ignore

This is the decision most likely to be read as a mistake, so here is the reasoning.

The conventional choice is to ignore unknown keys, so that a file written by a newer version still
loads in an older one. **That convention is wrong for this payload.** A future version may add a
field that changes what the workout *does* — a cadence target, an absolute-watts escape hatch, a
per-block ERG/slope mode. An older decoder that silently dropped it would ride a **different
workout** from the one its author wrote, against a machine applying physical resistance to somebody
pedalling, and would report success. `CLAUDE.md` §6 puts trainer control in the safety class, and
silently riding something other than what the file says is the failure that class is about.

So: refusal, naming the key. **Forward compatibility comes from D-3's version number, not from
leniency.** The cost — an older build refuses every newer file rather than loading part of it — is
stated in §Consequences and is accepted deliberately.

### D-5 — The format lives in `packages/domain/src/workout/`, not `packages/fit`

`packages/fit` is where **other people's** formats live, and its whole identity is ADR 0006's
clean-room posture: a provenance table per message, a corpus derived independently, a rule that
nothing carrying Garmin's terms may enter. A serialisation of this repository's own model has none
of those questions, and filing it there would put a format with nothing to declare beside four that
declare everything, blurring what that package's README means.

Beside the model is also where the decoder can reach `validateWorkout` without a package hop, which
matters for D-6.

### D-6 — A decoded workout is re-validated, and the expansion is bounded before it is built

The decoder does not trust the file. It re-checks every block through the same `validateWorkout`
every other consumer goes through, for the reason `packages/store/src/persisted.ts` already gives
about a store row: a `target` of `88` where `0.88` was meant is a plausible-looking number that asks
a trainer for 88 times threshold, and only the constructor's own guard tells the two apart.

⚠️ **And one bound did not exist and does now.** `expandWorkout` had no limit on its output: a
workout of 10 000 interval blocks at `MAXIMUM_REPEATS` expands to two million segments, and nothing
refused it. That was unreachable while blocks could only come from the builder. A file is untrusted
input under `CLAUDE.md` §6 — *"malformed input must produce an error, never … resource
exhaustion"* — and so, already, is a hand-edited IndexedDB row reaching `fromPersistedWorkout`.

The bound therefore goes in **`validateWorkout`**, not in the file decoder, so that it covers the
row and the file with one rule rather than two that can drift. The segment count is computed by
arithmetic without building the array, the way `packages/domain/src/analysis/fitness.ts`'s
`dayCount` is.

---

## Consequences

### What this enables

- A workout can be saved to a file, sent to somebody, and opened again — #202's stated block on
  *"saving, loading and sharing a workout"*, lifted.
- The provenance question is answered with the strongest answer available: the format is ours.
- The bound in D-6 closes a resource-exhaustion path that was already open through the store,
  independently of any file ever being imported.

### What this costs, stated plainly

- **The free library is not bought.** This is the real loss and it is worth naming rather than
  glossing: a rider with a folder of workouts in the de facto format cannot open them here, and this
  project starts with a corpus of zero. The follow-on issue is where that is addressed; until it is,
  the honest description of this feature is "save and share the workouts you build here".
- **D-4 makes old builds strict.** A file written by a future version is refused wholesale by
  today's, rather than loading in part. That is the intended trade and not a rough edge.
- **D-2 couples the format to the model's field names.** Renaming a model field is a format version
  bump and a migration in the decoder. Accepted, because the alternative drifts silently.
- **Nothing here is machine-checkable in the way L1 is.** ADR 0009's §"What a machine checks today"
  applies unchanged: L1's grep still runs on every diff and still passes, because this decision
  introduces no third-party name. There is no new gate, and none is claimed.

### Constraints this places on other work

| Work | What binds |
|---|---|
| The follow-on import issue | R1 and ADR 0006 R2 must be answered **before** an element set is written down, not in review. A vendored corpus needs its licence named and reasoned by hand, since `DEP001` reads dependency manifests and not vendored data |
| Any new `WorkoutBlock` kind | Is a format change. Bump `onYourLeftWorkout`, and remember D-4 means every older build refuses the new files |
| Any consumer of `expandWorkout` | The bound in D-6 is in `validateWorkout`, which `expandWorkout` calls first. A caller that skips validation skips the bound |
| `packages/fit` | Unchanged. This format is deliberately not filed there, and ADR 0006's declaration does not extend to it |

### What would make this ADR wrong

- **A published specification for the de facto format appearing**, from its vendor or from a body
  that has one. R1's re-derive-from-the-specification route would open and (a) would become
  ordinary work.
- **A rights-holder's written permission**, which would answer L1 and R1 together.
- **The format's element set turning out to be documented in a source with a licence this project
  can accept.** #202 records that nobody has established this either way; it was not established
  here either, because establishing it means reading implementations, which is the act R1 forbids.

None of those is unlikely over the life of this project, which is why D-1 declines to adopt rather
than deciding against.
