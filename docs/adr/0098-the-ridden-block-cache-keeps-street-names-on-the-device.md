# ADR 0098: The ridden-block cache keeps street names, on the device

- **Status**: **Accepted**, 2026-11-25, by the owner's ruling on pull request
  [#2966](https://github.com/openzigs/onyourleft/pull/2966), option (a), quoted in Context
- **Date**: 2026-11-25
- **Deciders**: **the owner**, who chose option (a) from the three that #2966's review put. The
  author wrote the ADR to record the ruling. The rules for reading a kept name back (D-2) are the
  author's, and they are ADR 0096 D-1.3's own
- **Issue**: [#2891](https://github.com/openzigs/onyourleft/issues/2891) (the ridden-block cache),
  under the open-world epic [#2880](https://github.com/openzigs/onyourleft/issues/2880)
- **Number**: **0098**. On 2026-11-25 `docs/agents/conventions.md` §7 gives 0097 as the next free
  number, but **0097 is claimed** by the open pull requests
  [#3149](https://github.com/openzigs/onyourleft/pull/3149) and
  [#3194](https://github.com/openzigs/onyourleft/pull/3194), which both add `docs/adr/0097-…`.
  No open pull request or issue claims 0098
- **Supersedes, in part, for the ridden-block store alone**:
  - [ADR 0096](0096-the-open-world-names-its-streets-on-the-road-and-in-the-junction-prompt.md)
    **D-1.4**'s *"It is **never stored**"*, and **D-1.2**'s *"the store … never carry a name"*.

  ADR 0096 gains one dated `## Amendments` entry that points here (ADR 0013). Its body is not edited
- **Leaves standing**, word for word: the rest of ADR 0096 D-1.4 (*"never … logged or sent"*), its
  D-4.2 (a name is never in an error, a log line, a crash report or an instance request), its D-1.2
  for a route ride's corridor read, the corridor store (`worldCorridors`) and the export, and ADR
  0090 D-6.4 (the ridden-block store never leaves the device)

## Context

ADR 0090 D-6 keeps each block an open-world ride reads on the device, for the athlete who rode it,
and D-6.7 says a kept block is never asked of the archive again while it is kept. #2891 built that
cache. ADR 0096 D-1.4 says a street's name is *"held in memory with the block the reader holds and
dropped with that block. It is **never stored, logged or sent**."*

Together the two rules meant that once a block had been ridden, every later ride through it came
from the cache with no street names, on the road (ADR 0096 D-2) and in the junction prompt (D-3),
until the block was evicted. The streets a rider rides most, home first, would lose their names
first. #2966's review put the question to the owner with three options: (a) keep the names in the
cache, (b) accept the loss, (c) ship the cache unwired until a ruling.

The owner's ruling, 2026-11-25, on #2966:

> **Owner ruling, 2026-11-25: option (a).** Street names are kept in the on-device ridden-block
> cache, so a block that was ridden before still shows its names on the road (D-2) and in the
> junction prompt (D-3). This narrows ADR 0096 D-1.4 ("never stored, logged or sent") for this one
> store. The names stay on the device: they are never logged, never sent to an instance, never
> exported, and erased with the athlete.

ADR 0013 D-3 allows an `## Amendments` entry to record a fact that has become false, never a
change to what a reader should do. A narrowing of D-1.4 changes what the code may do, so it is
this ADR.

## Decision

### D-1: The one store that holds a street's name

1. `RiddenBlockRecord.streets` (`@onyourleft/store`, ADR 0090 D-6) holds each kept street's
   `name`, as the decoder handed it out, beside its road fields. It is the only store that does.
   The corridor store, a route ride's read and the account export carry no name, as before.
2. A name is kept only for a block read whole (#2891), and goes with the block: when it is
   evicted, replaced, read again from another archive, or erased with the athlete.
3. A block read from the cache names its streets on the road and in the junction prompt exactly
   as a fresh read of that block does.

### D-2: A kept name is read back under ADR 0096 D-1.3's rules

The blob is on the device, where it can be edited. So a name read back is held to the decoder's
own rules (ADR 0096 D-1.3), by the same function the decoder uses
(`@onyourleft/map-features` §`streetNameOf`). It must be well-formed text of at most 256 bytes of
UTF-8. Every control, bidirectional-override, isolate and zero-width character is dropped, runs of
space become one, and the result is trimmed and cut at the last whole word within 48 characters.
A value that is not a string, is malformed, or is empty after cleaning is no name.

### D-3: It still never leaves the device

Nothing in ADR 0096 D-4.2 or ADR 0090 D-6.4 moves. A kept name is never formatted into an error, a
log line, a crash report or an instance request. It is not in an export, not synced and not sent
to an instance, and it is erased with the athlete. The tests that hold this:

- `transfer/ridden-blocks-not-exported.test.ts` looks for a kept street's name, and for the packed
  streets' bytes, in every file of every export format;
- `privacy/world-corridor-never-sent.test.ts`'s scan of `apps/web/src/instance/` and
  `apps/instance/` includes the two functions that write and read a kept name;
- `world-data/ridden-blocks.test.ts` › "a kept street's name is never logged" rides named streets
  through a working store and a failing one, and no log line carries a name;
- the erasure tests remove the whole record with the athlete.

## Consequences

- A rider's familiar streets keep their names on every ride, which is what the owner asked for.
- The device holds the names of the streets in the blocks the rider has ridden, up to
  `RIDDEN_BLOCKS_LIMIT` blocks, with when each was last ridden. That was already location data,
  because which blocks are kept says where the rider rides. The names make it more readable to
  anyone with the device. `docs/privacy-policy.md`'s open-world paragraph says so.
- Each kept street costs a few more bytes, inside the same `RIDDEN_BLOCK_FEATURES_LIMIT_BYTES`
  bound, which is still owed to the tablet measurement.

## What would make this ADR wrong

- A name is found in an export, a log line or an instance request. Then the tests in D-3 have
  missed a path, and that is a defect against this ADR and ADR 0096 D-4.2.
- The owner wants names on route rides too. That is ADR 0054 D-2.2's store, and a new ADR.

## Sources

- The owner's ruling of 2026-11-25 on #2966, and #2966's review of the same day.
- ADR 0096 D-1.2, D-1.3, D-1.4 and D-4; ADR 0090 D-6; ADR 0013 D-3.
