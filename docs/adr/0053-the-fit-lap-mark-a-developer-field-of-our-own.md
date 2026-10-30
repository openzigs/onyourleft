# ADR 0053: The FIT lap mark — a developer field of this client's own, as a permanent format

- **Status**: Accepted, 2026-10-21, on the owner's ruling quoted in Context
- **Date**: 2026-10-21
- **Deciders**: **the owner**, on the format as
  [#1520](https://github.com/openzigs/onyourleft/pull/1520) proposed it and as a permanent commitment
- **Issue**: [#1320](https://github.com/openzigs/onyourleft/issues/1320); built by
  [#1520](https://github.com/openzigs/onyourleft/pull/1520). Relates to
  [#1471](https://github.com/openzigs/onyourleft/issues/1471) (FIT's own lap fields, still open) and
  [#1321](https://github.com/openzigs/onyourleft/issues/1321) (the mark this is the FIT half of)
- **Number**: **0053**, the next free number in
  [`docs/agents/conventions.md`](../agents/conventions.md) §7 on 2026-10-21, checked against the
  ownership table in [`docs/architecture.md`](../architecture.md)
- **Supersedes**: nothing
- **Relates to**: [ADR 0006](0006-fit-codec-licensing.md) R1–R3 (where a FIT number may come from),
  which it does **not** amend; [ADR 0019](0019-signed-records-in-an-export.md) D-1's reason 3, which
  weighed a developer field for a different payload

---

## Context

Since #1316 a FIT file this client writes for a lapped ride has more splits than the ride has laps:
the time before the first line, between two laps that do not meet, and after the last each get a
split of their own. TCX says which split is which with `Intensity` and `TriggerMethod` (#1474). FIT's
own lap fields for that, `intensity` and `lap_trigger`, wait on #1471, which needs a lawfully held
fixture before ADR 0006 R2 lets their numbers in. Until then this client's own FIT files, which are
what instance sync carries to a second device, brought no laps back.

#1520 marks the laps with **a developer field of this client's own** instead. A developer field's
number, name and values belong to the application that defines it, so none of them is a Garmin
profile number. The two messages that declare one, `field_description` (206) and `developer_data_id`
(207), are already in `packages/fit`'s subset on the #29 corpus's evidence
([`packages/fit/README.md`](../../packages/fit/README.md) §Sources), so R2 is met with no new row.

ADR 0019 reason 3 called a developer field "not forbidden, and not worth it" for a signed record,
partly because a `developer_data_id` UUID's registration lives with the SDK. That does not apply
here: the UUID below is a version 4 UUID drawn once for #1320, and no registration is used or needed.
A reader that does not know the application ignores the field, as the protocol allows.

The cost the PR named is permanence: once released, files carrying the mark exist on riders' devices
and instances, and every later version of this client must read them.

**The owner's ruling**, 2026-10-21, on #1520 and #1320:

> *"the developer-field lap mark is approved as a permanent format: application UUID
> `05caf269-eaf0-4c85-bfae-12fe9e66d973`, field 0, name `oyl_lap_kind`, uint8 values 0 = outside
> every lap, 1 = whole lap, 2 = part lap."*

The ruling asked for it to be recorded as an amendment to ADR 0006. It is an ADR of its own instead,
because an [ADR 0013](0013-adr-amendments.md) amendment records only that a statement of fact in a
body has become false, and nothing in ADR 0006 has: this is a new decision that rests on R1–R3.

## Decision

### D-1 — The format

| What | Value |
|---|---|
| Application id, in its `developer_data_id` | `05caf269-eaf0-4c85-bfae-12fe9e66d973` |
| Field definition number | `0` |
| Name, in its `field_description` | `oyl_lap_kind` |
| Base type | `uint8`, one byte |
| Where | one on every `lap` message of a file that declares it |
| `0` | outside every lap: a lead-in, a gap or a tail |
| `1` | a whole lap, ended at the line |
| `2` | a part lap, ended by the rider |

The constants are in `apps/web/src/transfer/fit-lap-mark.ts` and are not changed.

### D-2 — Export

Only a ride with stored laps carries the declaration and a mark on each split. **A ride with no laps
is exported byte-identical to before**, with no declaration.

### D-3 — Import

- The mark is found **by application id, not by developer data index**, which the file chooses.
- A file that declares the application and breaks the mark — a lap with no mark, a value other than
  0, 1 or 2, or a mark that is not one byte wide — **lists no laps** and raises the fault
  `BROKEN_FIT_LAP_MARK`. The file is untrusted input, so it is not guessed at.
- A file with no declaration is read exactly as before.

### D-4 — Permanence

Once released, a file carrying the mark **stays readable for good**: the id, the field number, the
width and the three values keep their meaning, and none is reused for anything else. If #1471 later
adds FIT's own `intensity` and `lap_trigger`, the export may write both, and the import keeps reading
this mark for older files. A change to any of this is a superseding ADR.

### D-5 — Provenance

No number here comes from Garmin's profile or SDK, or from GPL or AGPL code or data. Messages 206 and
207 are already in `packages/fit`'s subset per its README §Sources; the rest is this application's
own.

## Consequences

- This client's own FIT files bring their laps back on a second device, without waiting on #1471.
- Every future reader of FIT in this client carries the D-3 rule for as long as the project exists.
- A third-party tool that re-writes a marked file and keeps the developer field is read by its mark;
  one that drops the field yields a file read as unmarked.
- A lapped ride's FIT bytes changed with #1520, so a signed ride whose push never got through is now
  reported `file-changed` by sync, as #1316 already caused; rides with no laps are unaffected.
- ADR 0006 is unchanged and gains no amendment.
