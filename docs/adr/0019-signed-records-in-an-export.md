# ADR 0019: How a signed activity record travels in an export

- **Status**: Accepted
- **Date**: 2026-09-09
- **Deciders**: drafted as engineering work on
  [#221](https://github.com/openzigs/onyourleft/issues/221), whose first acceptance criterion is
  that *"a decision is recorded — in this issue or an ADR — for how a signed activity record travels
  in an export, with the three options above weighed and the ADR 0006 question answered if the FIT
  option is chosen"*. It is an ADR rather than an issue comment because one of the three options is
  a licensing question and `CLAUDE.md` §3 makes those answerable **before** the code is written
- **Issue**: [#221](https://github.com/openzigs/onyourleft/issues/221)
- **Number**: **0019**. [`docs/architecture.md`](../architecture.md)'s index recorded 0019 as the
  next free number with no live reservation, and no open pull request claimed it when this was
  written (checked 2026-09-09). The same pull request moves that sentence and adds this row
- **Supersedes**: nothing
- **Applies**: [ADR 0014](0014-portable-identity.md) D-4 and D-7, and
  [ADR 0006](0006-fit-codec-licensing.md) R1–R3, to a packaging question none of them was asked
- **Relates to**: [ADR 0009](0009-clean-room-posture.md) R5 — *file-based interoperability is the
  entire interoperability surface* — which this extends by one **native** sidecar file rather than
  by a claim about anybody else's format

---

## Context

[#61](https://github.com/openzigs/onyourleft/issues/61) gave every ride a signed,
content-addressed record, and [ADR 0014](0014-portable-identity.md) made it verifiable by a stranger:
the record carries its own public key, and `docs/architecture.md` §"The signed activity record" is
written so that somebody outside this project can build a verifier from the prose.

What none of that settled is **what a signed record looks like as a file an athlete carries between
devices**. It has a canonical byte form for *signing* — `packages/domain/src/identity/canonical.ts`,
RFC 8785 over the six payload members — and that is a different question from a portable artefact:
the signing input deliberately excludes the signature itself, so it is not a record, it is the thing
a record is a signature *of*.

The gap this leaves is not theoretical. A `/code-review` pass over
[#218](https://github.com/openzigs/onyourleft/issues/218),
[#219](https://github.com/openzigs/onyourleft/pull/219) and
[#220](https://github.com/openzigs/onyourleft/pull/220) found that
`activityRecords` **goes in the erase and does not come out in the export**, so a rider who does the
responsible thing — export everything, then erase — loses every signed record silently, and the
manifest does not say so. ADR 0014 D-7 makes that permanent in a way nothing else in this product
is: the private key is non-extractable, so an erased identity can never sign anything again, and a
record destroyed with it can never be re-minted.

⚠️ **And re-minting is forbidden even where it is possible.** ADR 0014: *"re-signing an old ride
with a new key would be the device asserting something it did not witness."* An export moves
records. It never makes one.

### The three options #221 puts up

**(a) Inline in the manifest**, as JSON beside the activity entry.

**(b) One `.json` per ride** beside its activity file.

**(c) Inside the FIT file as a developer field.**

---

## Decision

### D-1 — A signed record travels as its **own JSON file, one per ride**, beside the activity file

Option **(b)**. The file is the record's own JSON object — the seven members ADR 0014 specifies and
nothing else — named by taking the activity file's name and replacing its extension with
`.record.json`. `Morning ride.gpx` is accompanied by `Morning ride.record.json`.

The name is derived from the **de-duplicated** activity file name that
`export-everything.ts` already computes, so two rides both called "Morning ride" get
`Morning ride.gpx` / `Morning ride.record.json` and `Morning ride (2).gpx` /
`Morning ride (2).record.json`. Uniqueness of the record names is therefore a consequence of
uniqueness of the file names rather than a second rule that could disagree with the first.

**Why not (a), inline in the manifest.** The manifest is the *most sensitive single file in the
archive* — it carries the athlete's privacy zones, which are their home address stated precisely, and
their thresholds. A signed record is the *least* sensitive artefact this project produces: #61's
sixth acceptance criterion is that it carries no location data at all, which is exactly what makes it
publishable. Inlining welds the one to the other, so an athlete who wants to hand somebody a single
ride's record — the whole use ADR 0014 built it for — has to hand over the file with their home in
it, or hand-edit JSON. It also makes the manifest the thing that must be kept byte-intact for
anything to verify, when the manifest is the file a person is most likely to open, reformat or paste
into something.

**Why not (c), a FIT developer field.** Four reasons, and the first is decisive on its own:

1. **It is circular.** A record's `contentHash` is the SHA-256 of the activity file it vouches for.
   Embedding the record *in* that file changes the file's bytes, so the hash the record carries can
   never be the hash of the file containing it. The only escapes are to hash a subset of the file —
   inventing a second, unpublished canonicalisation whose bugs are silent — or to accept that the
   content hash is of some other artefact nobody holds. Both are worse than a sidecar.
2. **It is FIT-only.** The export offers FIT, GPX and TCX. A record that rides inside FIT is a record
   two of the three formats drop, and #221's complaint is precisely about a thing that is silently
   dropped.
3. **ADR 0006, answered rather than dodged** — the question #221 asks be answered if this option
   were chosen. It is not a *fatal* answer, and it is worth saying so rather than implying the
   licence forbids what it does not: developer fields are described in the **public** FIT protocol
   documentation, `packages/fit` already encodes and decodes them, and doing so was ruled acceptable
   under R2's provenance discipline. But R1 forbids obtaining any Garmin artefact, and the developer
   field mechanism's interoperability rests on a `developer_data_id` UUID whose registration and
   conventions live with the SDK; R2 would require a provenance row for every number written, and R3
   forbids copying expression. So choosing (c) means taking on a provenance argument for a
   *publishing* decision that has a cost-free alternative. **The ADR 0006 answer is therefore: (c)
   is not forbidden, and it is not worth it.**
4. It puts this project's bytes inside somebody else's format for a payload that has nothing to do
   with that format's subject matter.

**What (b) costs, stated plainly.** The archive's file count roughly doubles for rides that have a
record, and a browser downloading many files in quick succession is already a problem
`export-everything.ts`'s header calls the sink's to fix. That is a real cost and it is the right one
to pay: an extra file is visible and recoverable, and a lost record is neither.

### D-2 — A ride with no record is a normal ride, and the manifest says which is which

Not every ride has a record: they are written by the recorder, and an imported ride never had one.
So the absence of a record is not a failure, is not reported as one, and does not stop the ride
exporting.

But it must not be *invisible*, because "this ride never had a record" and "the export dropped the
record" look identical from inside the archive. Every manifest entry therefore carries a
`signedRecord` member which is either **the record file's name** or **`null`** — an explicit JSON
null, never an absent member, because `JSON.stringify` omits `undefined` and an omitted member is
back to being indistinguishable from a bug.

### D-3 — The export carries the record; it does not verify it, and it does not re-sign it

`exportEverything` writes out what `getActivityRecord` returns. It does not check the signature
first, and it does not mint one for a ride that has none.

Not verifying is deliberate and follows the store's own posture, stated at the top of
`packages/store/src/identity.ts`: *parsing is not verifying*. A record whose signature does not check
out is still **evidence** — it is what this device holds — and an export that silently dropped it
would be destroying the only copy of the thing a rider needs in order to find out what happened. The
verification boundary is the *import* (ADR 0014, #37), where a record crosses from somebody else into
this athlete's history.

### D-4 — What a holder of the archive can check, and what they cannot

This is the part most likely to be misread, so it is written as a rule rather than as a note.

A record's `contentHash` names the bytes that were signed. **The activity file beside it in the
archive is a re-encode** — `exportActivity` reads the stored streams and writes a new FIT, GPX or TCX
file — so it is, in general, *not* those bytes, and the same ride exported as GPX and as TCX produces
two different files and one record. Therefore:

- **`verifyRecordSignature` is the check that applies to an archive.** It answers "is this record
  authentic, and whose is it", from the record file's bytes alone, using the public key inside the
  record. That is the check #221's second acceptance criterion asks for and the one the test in this
  pull request performs.
- **`verifyActivityRecord` — signature *and* content hash — applies only to the file the record
  actually names**, which is the original the athlete or the recorder hashed. Running it against a
  re-encoded export file will return `content-mismatch`, and that answer would be *correct*: the
  file is not the one the record vouches for.

`packages/domain/src/identity/record.ts` already makes the weaker check a separately named function
for exactly this reason — *"an optional `fileDigest` that silently skips the content check when
omitted is the shape that lets a caller believe a record was fully verified when half of it never
ran"* — and this decision is the first place that distinction has a consumer.

### D-5 — Laps are not part of this decision, and are fixed as the bug they are

The second half of #221 — laps go in the erase and do not come out in the export — needs no format
decision. FIT and TCX both carry laps natively and GPX carries the split boundaries as track
segments; `exportActivity` simply never read them. It reads `listLaps` now, for the single-ride
export as much as the account one, because a single-ride export lost them too.

A ride with no stored laps still exports the one synthesised lap spanning the whole ride, exactly as
before. That is the shape every reader expects of a file with no splits in it, and changing it would
be a regression dressed as a fix.

---

## Consequences

**The archive is now self-describing about identity.** A rider can hand somebody one
`.record.json` and that person can verify it with a stock Ed25519 library and a stock RFC 8785
canonicaliser, holding nothing else of the rider's. That was already ADR 0014's promise; until now
there was no file it applied to.

**The erase dialogue can finally be accurate.** `ERASE_REMOVES` names signed records and laps,
because they go — and, unlike before, they now also come out in the export, so the sentence a rider
reads before the irreversible action is true in both directions.

**A future importer must not verify-then-discard.** When #37 reads an archive back, a record whose
signature fails is a thing to *report*, not to drop: the same argument as D-3 in the other direction.
This ADR does not decide #37's behaviour; it records the constraint the export's semantics place on
it.

**The version member did not move.** The manifest's `onYourLeftAccountExport` stays at `1`. A member
added to an object is a compatible change to a format nothing outside this repository reads yet, and
bumping it would invalidate archives produced by #219 for no reader's benefit. The day something
external reads a manifest, that stops being true and the version becomes a real cost to change —
which is the reason it exists.

**If a signed record ever needs to travel inside an activity file** — a head unit that reads
developer fields, a partner format — D-1 is reopened by a new ADR, not by an edit to this one
(ADR 0013). The circularity in (c) is the finding that would have to be answered first, and it is a
technical problem rather than a licensing one.
