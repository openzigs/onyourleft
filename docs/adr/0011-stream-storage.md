# ADR 0011: Activity stream storage — per-channel packed binary in IndexedDB

- **Status**: Accepted
- **Date**: 2026-09-03
- **Deciders**: No owner decision was sought or given for this ADR, and none is claimed. Every
  decision below is the author's engineering work, constrained by three that are already merged:
  **owner decision D6** (no server, no account and no network in Phase 1),
  [ADR 0005](0005-tech-stack.md) §F (IndexedDB via Dexie 4.4.5, Dexie's own versioning, and "raw
  per-sample rows are never stored"), and [ADR 0004](0004-privacy-and-location.md) decision D (a
  coordinate's value never reaches an error message). Every number in the "what it costs" section
  is **measured by a test in this repository**, not estimated
- **Issue**: [#27](https://github.com/openzigs/onyourleft/issues/27)
- **Number**: **0011**, not the `0006` #27's acceptance criterion names. `0006` is
  [the FIT codec licensing ADR](0006-fit-codec-licensing.md) (#58); the ownership table in
  [`docs/architecture.md`](../architecture.md) settled the collision in favour of the ADR that
  merged documents already cite by number, and #27 carries a comment recording the change. Rule
  `ADR001` fails the build on a duplicate
- **Supersedes**: nothing
- **Constrains**: [#28](https://github.com/openzigs/onyourleft/issues/28) (the harness this shipped
  with), [#11](https://github.com/openzigs/onyourleft/issues/11) (analysis reads these streams),
  [#30](https://github.com/openzigs/onyourleft/issues/30)/[#31](https://github.com/openzigs/onyourleft/issues/31)
  (the FIT codec writes and reads them), [#35](https://github.com/openzigs/onyourleft/issues/35)
  (export), [#37](https://github.com/openzigs/onyourleft/issues/37) (import and dedup),
  [#62](https://github.com/openzigs/onyourleft/issues/62) (the ride view),
  [#7](https://github.com/openzigs/onyourleft/issues/7) (Phase 4 sync)
- **Relates to**: [ADR 0002](0002-local-first-architecture.md) (the athlete's signed files are the
  canonical artefact, which is what lets a derived stream set be lossy),
  [ADR 0003](0003-platform-support-matrix.md) (the browser floor this ADR's compression sits above),
  [ADR 0004](0004-privacy-and-location.md) (decision D binds the encoder's error messages),
  [ADR 0005](0005-tech-stack.md) (§F, which chose the engine and forbade per-sample rows),
  [ADR 0006](0006-fit-codec-licensing.md) (this ADR reuses FIT's *field encodings* — semicircles
  and the altitude scale — which are published protocol facts, and no Garmin SDK source)

---

## Context

A two-hour ride at 1 Hz across eight channels — power, heart rate, cadence, speed, latitude,
longitude, altitude, temperature — is about 7,200 samples per channel. #27 asks what shape that
takes on disk, and its acceptance criteria are written for a relational store beside an object
store, with an activity split across the two.

**Neither exists in Phase 1.** Owner decision D6 removes the server, the account and the network,
and ADR 0005 §F leaves exactly one storage engine: IndexedDB, through Dexie 4.4.5. So the criteria
are translated rather than approximated, and the table below is what each becomes. #26 did the same
for its own criteria and its pull request carries the equivalent table.

| #27 says | What it means here |
|---|---|
| "object storage" for the derived stream set | An IndexedDB object store holding packed binary blobs, one row per channel per activity. The blob *shape* is what #7 later syncs; only its backing changes |
| "the relational store" for summaries | A second IndexedDB object store holding one small indexed row per activity |
| "an activity split across the two" | Real, and preserved: `streamSets` is metadata and `streamBlobs` is bytes, and the ride view reads the first without touching the second |
| "a partial object referenced by a committed database row" | Both stores are written in **one Dexie read-write transaction**. A failure part way through aborts it, so neither lands |
| "measured storage cost per recorded hour" | Bytes per recorded hour, measured by a test. Not dollars — `navigator.storage.estimate()` is not available in the test environment and there is no bill in Phase 1; the Phase 3 currency figure is #54's |
| "$0.02–0.023/GB-mo and $0.09/GB egress" | Wrong, and corrected in #27's own revision block and again in [ADR 0010](0010-map-tiles-and-routing.md): R2 is $0.015/GB-month with **$0** egress, B2 is $0.00695/GB-month with free Class A/B/C calls. Irrelevant until #7 |

The property that decides the shape is in #27's own context and is worth restating because
everything below follows from it: **streams are append-once and read-whole.** Nobody queries "power
at second 4,137". They fetch a series to draw a chart. That is a poor fit for row storage and an
excellent fit for one packed array per channel.

---

## Decision

### A. Two object stores, added as schema version 2

`streamSets` holds one row per activity: the time base, the channel list, the sample count and the
stored byte count. `streamBlobs` holds one row per channel per activity, keyed on the compound
primary key `[activityId+channel]`, holding the packed bytes.

Version 2 **adds** both and changes no existing record's shape, so there is no `up`/`down` record
migration to write and `SCHEMA_MIGRATIONS` stays empty — which `migrations.test.ts` now asserts,
alongside a test that writes rows into a version-1 database, reopens it at version 2, and checks
every record survived and the new stores work.

**No stream reference is added to `ActivityRecord`.** A stream set *is* its activity's, keyed by the
activity id, so a reference field would be a second copy of an edge that already exists and a second
thing to keep consistent. `#26` predicted this would force a decision about `ActivitySummary`'s
projection; the decision is that there is nothing to project.

### B. One packed typed array per channel, not one blob for the set

| Shape | 4 h, 1 Hz, 8 channels | Rejected because |
|---|---|---|
| One row per sample per channel | ~115,200 rows | ADR 0005 §F already forbids it: roughly 25× the bytes, and every read is a range scan over rows nobody queries individually |
| One JSON document | ~900 KB | Every number becomes decimal text, and the parse allocates the whole set before a point is drawn |
| One binary blob for the whole set | ~239 KB | A chart of power alone would inflate and decode all eight channels, and a channel added by a later protocol client would mean re-encoding every ride the athlete already has |
| **One packed array per channel** | **239 KB packed, 89 KB stored** | **Chosen** |

Per channel costs `n` keyed gets instead of one, on an engine where a keyed get is cheap and the
eight are issued together inside a single read transaction.

**`Uint8Array`, not `Blob`.** Both survive the structured clone algorithm, and `Blob` is the more
obvious choice for something called object storage. A byte array wins on two counts: reading a
`Blob` back is asynchronous a second time inside code that has already spent its asynchrony on
decompression, and a `Blob` in IndexedDB is stored by reference to a file the browser manages
separately, so a blob whose backing file has gone is a failure mode a byte array has no analogue
for.

### C. Each channel has a declared resolution, and that resolution is the contract

| Channel | Stored as | Bytes | Resolution | Why |
|---|---|---|---|---|
| power | `uint16` | 2 | 1 W | Every power meter and every file format reports whole watts |
| heart rate | `uint8` | 1 | 1 bpm | Same |
| cadence | `uint8` | 1 | 1 rpm | Same |
| speed | `uint16`, mm/s | 2 | 0.001 m/s | Three orders below any wheel or trainer's own error |
| latitude | `sint32` semicircles | 4 | 8.4 × 10⁻⁸° | FIT's own encoding. ~9 mm at the equator, two orders better than consumer GNSS |
| longitude | `sint32` semicircles | 4 | 8.4 × 10⁻⁸° | Same |
| altitude | `uint16`, FIT scale 5 offset 500 | 2 | 0.2 m | FIT's own encoding; the offset is what carries below-sea-level altitudes |
| temperature | `sint8` | 1 | 1 °C | Every BLE Environmental Sensing and FIT temperature field |

A value **on** that grid round-trips exactly; a value off it comes back at the nearest grid point.
That is deliberate and it is what ADR 0002 buys: the athlete's **original file is the canonical
artefact**, and a stream set is a derived rendering aid. Storing eight `Float64` channels instead
would cost 921 KB for four hours — four times the packed shape — to preserve digits no sensor
produced.

The three non-trivial conversions are borrowed from `@onyourleft/domain` rather than rewritten:
`degreesLatitudeToSemicircles`, `degreesLongitudeToSemicircles` and `metresToFitAltitude`, with
their inverses. That is not only reuse. Those are the encodings #30's FIT decoder will hand this
store, so a stream imported from a file is stored at exactly the precision it arrived with and the
import path adds no second rounding.

`stream-codec.test.ts` proves both halves: exact equality for grid-aligned values, and a bounded
error — no worse than half a step — for values placed deliberately between grid points.

### D. A gap is `undefined`, carried on disk as a packed presence bitmap

**This is the representation decision #27's second criterion asks for.** A heart-rate strap that
dropped for thirty seconds comes back as thirty **absent** samples, in a public API where a gap is
`undefined` and a reading of zero is `0`. Nothing in this package interpolates, and nothing may:
#27 states that interpolating a gap into fiction "corrupts every downstream metric in #11", and
encoding a gap as `0` is worse than interpolating, because `0` is a value every one of the eight
channels admits and nothing downstream can tell it from a reading.

On disk it is **one bit per sample**, packed LSB-first into a separate array, rather than FIT's
all-ones sentinel per field. Two reasons:

1. A sentinel steals a value from the range, and `temperature` is a `sint8` in which all 256 values
   are real temperatures.
2. A bitmap is uniform — one rule for eight channels, rather than eight invalid constants a reader
   has to look up.

It costs one bit per sample: 1,800 bytes per channel over four hours before compression, and almost
nothing after it, because a bitmap of a single dropout is the most compressible thing in the set.
**The bitmap is omitted entirely when a channel has no gaps**, which is the common case, so the
dense set pays nothing for the feature.

### E. `deflate-raw`, through the platform's own `CompressionStream`

Per-second channels are slowly varying by construction — consecutive samples agree in their high
bits — so a general-purpose compressor finds a great deal in them. Measured below: **2.70×**.

A delta-plus-varint coder would beat deflate on these channels. It is also new code in the file that
holds the athlete's only copy of a ride, and its bugs are silent: an off-by-one in a varint reader
shifts every subsequent sample rather than failing. `CompressionStream` is the platform's,
`deflate-raw` (RFC 1951, no zlib or gzip wrapper) is the smallest of its three framings, and each
blob row records its `compression` so a second scheme can be added later without a migration.

The platform floor is Chrome 103, Safari 16.4, Firefox 113 and Node 18 — all more than three years
old and all older than the floor [ADR 0003](0003-platform-support-matrix.md) already sets. There is
deliberately **no uncompressed fallback**: a fallback nothing exercises is a second on-disk format
nobody has ever read back.

### F. The write is one transaction across both stores; the encoding happens outside it

`putStreamSet` encodes and compresses every channel **first**, then opens one Dexie read-write
transaction spanning `activities`, `streamSets` and `streamBlobs` which does nothing but write bytes
it already holds. Two consequences, both load-bearing:

- **#27's last criterion is a property rather than a protocol.** A failure part way through the
  eight blob writes aborts the transaction, so the metadata row written moments earlier does not
  survive. `stream-store.test.ts` proves it by making the real engine's `IDBObjectStore.put` throw
  on the third blob, then reopening on a fresh connection and finding both stores empty.
- **A channel that cannot be encoded fails before any write is attempted.** Awaiting a promise Dexie
  did not create inside a transaction lets the underlying IndexedDB transaction commit out from
  under the code still using it, and compression is asynchronous — so doing it outside is required
  as well as tidier.

### G. Every stream index leads with `athleteId`, on the write path as well as the read

`[athleteId+activityId]` on `streamSets` and `[athleteId+activityId+channel]` on `streamBlobs`.
There is no index that answers "the stream set for this activity" without also being told whose it
is, which is #26's pattern and `CLAUDE.md` §6's requirement.

The **write** path is scoped twice, because #26's review found that a two-athlete *read* fixture is
blind to a write-path hole: `putStreamSet` looks the parent activity up through
`[athleteId+id]` — so streams cannot be filed against another athlete's ride — and separately
refuses to overwrite a `streamSets` row whose stored owner differs, because `put` is keyed on the
primary key alone and the primary key here is the activity id. Both are exercised by a test, the
second against a row planted directly, because the public path cannot produce that state until an
activity id arrives from an imported file (#51).

### H. ADR 0004 decision D binds the encoder

Three channels carry coordinates: latitude, longitude, and altitude, which in a stream is always
reported beside them. **No error raised for those three names the value.**
`@onyourleft/domain`'s `UnitError` does name it — `assertInRange` appends `received 91.2`, which is
recorded against ADR 0004 and carried by [#104](https://github.com/openzigs/onyourleft/issues/104) —
so the codec catches a `UnitError` from a coordinate channel and **discards its message**, raising
the channel, the sample index and the constraint instead. The other five channels keep their values,
which is what decision D explicitly chose: "a blanket rule would buy a coordinate's privacy at the
cost of every other quantity's debuggability".

There is exactly **one** place in the codec where an out-of-range value becomes a message. An
earlier draft had two — the domain's error and a separate raw-range check — and a mutation run
showed the second path's coordinate masking was unreachable and therefore untested. It was folded
into the first.

---

## What it costs, measured

Every figure here is produced by `packages/store/src/stream-store.test.ts` and printed in the test
log prefixed `[#27]`. Re-run `pnpm --filter @onyourleft/store run test` to reproduce them.

**A four-hour, 1 Hz, eight-channel ride — 14,400 samples per channel, 115,200 samples in total:**

| Figure | Measured |
|---|---|
| Packed, before compression | **244,800 B** (239 KiB) |
| Stored, after `deflate-raw` | **90,763 B** (88.6 KiB) |
| Compression ratio | **2.70×** |
| **Per recorded hour** | **22,691 B — 22.2 KiB** |
| Per recorded hour, packed only | 59.8 KiB |

For scale, against #27's own arithmetic for the same channels: narrow database rows would be
~3.0 MB for a two-hour ride, so ~1.5 MB per hour — **66× this**. Naive JSON would be ~225 KB per
hour. A year of ten hours a week at this shape is **11.5 MB**, which is not a number a device quota
notices.

The measurement is of the encoded blobs, summed per channel, and it is asserted against the
`encodedBytes` the summary row records, so the number the store reports and the number on disk
cannot drift. `navigator.storage.estimate()` is deliberately **not** used: it is unavailable in the
test environment, and it reports a browser-quota figure that includes the origin's other storage
rather than this ride's cost.

**Retrieval latency**, budget stated before anything was measured:

| | |
|---|---|
| **Budget** | **500 ms** for the whole four-hour, eight-channel set. Derived from the product: #11 and #62 draw a chart when an athlete opens a ride, the perceptual ceiling for "no spinner" is about one second from tap to painted chart, and retrieval may have at most half of it because decoding, layout and paint have the other half |
| **Measured** | **~6 ms**, on Node 24 with `fake-indexeddb` |
| **Asserted in CI** | 5,000 ms, as a regression ceiling |

**The measured figure is not a device measurement and must not be quoted as one.** `fake-indexeddb`
keeps the store in memory and touches no disk, so what six milliseconds measures is the decompress
and decode path — roughly 80× under the budget, which is the useful part of the signal: the codec
is not where the time will go. The disk read on a phone is the unmeasured half, and a real figure
needs a real device. #62 owns it. The CI number is a ceiling rather than a budget, deliberately: a
tight assertion on a shared runner measures the runner.

---

## Alternatives considered

| Alternative | Why not |
|---|---|
| **A row per sample per channel** | Already foreclosed by ADR 0005 §F, and the measurement above puts it at ~66× the bytes for data nobody queries per sample |
| **A time-series or columnar store** (SQLite/DuckDB WASM, a TSDB) | #27's revision block rules it out and the reasoning holds: streams are append-once and read-whole, and the always-on compute of a stateful analytical engine dwarfs the storage line it would save. In Phase 1 it would also mean a second storage engine in a package that already has one |
| **Store the original FIT file and derive streams on read** | The original file *is* stored (it is `ActivityRecord.originalFile`), and it is the source of truth. Decoding a 300 KB FIT file to draw a chart is the work the derived set exists to avoid, and #30's decoder does not exist yet |
| **Eight `Float64` channels** | 921 KB for four hours to preserve digits no sensor produced, in a derived artefact whose canonical original is kept anyway |
| **A `Blob` per channel** | See decision B: a second round of asynchrony, and a failure mode with no analogue for a byte array |
| **An all-ones sentinel for gaps, as FIT does** | See decision D: it steals a value from `sint8` temperature, and it is eight constants where a bitmap is one rule |
| **Compress the whole set as one stream** | Better ratio, and it destroys the per-channel read that is decision B's whole point |
| **A hand-written delta + varint coder** | Better ratio again, and its bugs are silent in the file holding the athlete's only copy of a ride |

---

## Consequences

### What this enables

- **#11 and #62 can draw a chart from one keyed read per channel**, at a cost the measurement above
  bounds.
- **#35's export and #51's import have a stable on-disk contract.** Each blob row records its
  encoding and its compression, so a future change is detectable rather than silent.
- **#30's FIT decoder has nothing to convert.** The store speaks semicircles and FIT altitude units
  already.
- **#7's Phase 4 sync has an object to sync.** The blob rows are content-addressable byte arrays;
  moving their backing to R2 or B2 changes where they live and not what they are.

### What this costs

- **The stream set is lossy at the resolutions in decision C.** That is only acceptable because
  ADR 0002 makes the original file canonical. Anything that ever needs full precision must go back
  to the file, and any future feature that cannot must say so and change this ADR.
- **`CompressionStream` is a platform dependency in `packages/store`.** The package is deliberately
  not platform-isolated (it already uses `indexedDB`), so this crosses no boundary — but it does
  mean the package cannot run in an environment with IndexedDB and no compression streams, and
  there is no fallback by design.
- **Eight keyed reads instead of one** for a whole-set fetch, inside one read transaction.
- **A whole stream set is materialised in memory to be read.** 115,200 boxed numbers for four
  hours. A streaming or windowed read is not designed here; #11 should say if it needs one.

### Constraints this places on other work

1. **Nothing may interpolate a gap.** Not the store, not #11's analysis, not #62's chart. A gap is
   `undefined` and must survive as `undefined` to whatever decides how to draw it.
2. **No error message in any layer may name a coordinate value** — decision H, and ADR 0004
   decision D, which binds "every layer that formats a coordinate into a string".
3. **A new channel is a new entry in `STREAM_CHANNELS` and a new codec**, not a widening of an
   existing one. Its resolution goes in decision C's table.
4. **Anything that adds a write path to `packages/store` must add a fake to
   `src/testing/fakes.ts`.** The `PersistentStore` type is derived from `ActivityStore`, so a new
   method fails the build until the fakes account for it — which is what keeps a write path from
   shipping with nothing proving the harness catches its failure.
5. **#7 inherits the blob shape, not the engine.** The instance store must hold the same encoded
   bytes; a re-encode at the sync boundary would mean two formats and a translation layer nobody
   scoped.

---

## Notes

- The FIT **field encodings** reused here — semicircles, and altitude's scale of 5 with an offset of
  500 — are published protocol facts, taken from `@onyourleft/domain`, which per
  [ADR 0006](0006-fit-codec-licensing.md) was written from the public protocol documentation. No
  Garmin SDK source is involved, and none may be.
- This ADR was written with [#28](https://github.com/openzigs/onyourleft/issues/28)'s round-trip
  harness in the same change, and that is not a coincidence: every claim above about what survives a
  write is asserted through a connection that was closed and reopened, because a read through the
  writing handle cannot tell "persisted" from "still in this connection's transaction queue".
