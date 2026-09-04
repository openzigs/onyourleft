# The synthetic fixture corpus

Every file in `corpus/` is produced by [`../tools/fixture-corpus/`](../tools/fixture-corpus) and by
nothing else. None of them came from a device, and none of them ever will.

```
pnpm --filter @onyourleft/fit run fixtures:generate
```

---

## 1. No real person's ride file is a fixture, anywhere in this program, ever

That is [ADR 0004](../../../docs/adr/0004-privacy-and-location.md) decision G, and it is a hard
prohibition with no exceptions. Not a contributor's own rides; not a public activity downloaded from
another service; not a real trace translated, rotated or noised — *"derivation launders nothing"*.

The practical reason is in #29's own body and it is the one that bites: a file that exists on one
machine cannot be checked in CI, so an acceptance criterion resting on it is a criterion only its
author can discharge, which is not a criterion.

### The synthetic test regions

Every position in every fixture falls inside one of these boxes. Bounds are **inclusive** on all four
edges, and the definitive copy is
[`../src/synthetic-test-regions.ts`](../src/synthetic-test-regions.ts), which is what the guard reads.

| Region | Latitude | Longitude | Why it contains no land |
| --- | --- | --- | --- |
| `NULL-ISLAND` | −1.0 … +1.0 | −1.0 … +1.0 | Open water in the Gulf of Guinea. Nearest land roughly 380 nautical miles away; the only structure inside the box is the moored Soul buoy at 0, 0. Straddles both axes, so one fixture exercises both signs of both coordinates and the zero crossing. |
| `ANTIMERIDIAN-EAST` | −1.0 … +1.0 | +179.0 … +180.0 | Open Pacific, between the Gilbert and Phoenix groups. No island in the equatorial 179 E–180 band; the nearest, Nikumaroro, is more than three degrees of latitude south. |
| `ANTIMERIDIAN-WEST` | −1.0 … +1.0 | −180.0 … −179.0 | Open Pacific, the western half of the same crossing. No island in the equatorial 180–179 W band; the nearest, Malden, is four degrees of latitude south. |
| `POINT-NEMO` | −49.0 … −48.0 | −124.0 … −123.0 | The oceanic pole of inaccessibility — the nearest land in any direction is about 1450 nautical miles away, the greatest such distance on Earth. A ride-sized box with **both coordinates negative**. |

ADR 0004 tabulates `ANTIMERIDIAN` as one region with a disjunctive longitude rule (`>= +179.0 or
<= -179.0`). It is spelled here as the two boxes that rule denotes: a box is four comparisons and a
disjunction is a condition somebody can get subtly wrong. Two boxes also mean a track crossing the
antimeridian visibly changes region halfway through, which is the property the fixture exists for.

**Adding a region** requires ADR 0004's condition to be met — the box contains no land, so no ride has
ever been recorded in it — and the check recorded in this table next to the region.

### What the guard actually asserts

[`../tools/fixture-corpus/synthetic-region-guard.test.ts`](../tools/fixture-corpus/synthetic-region-guard.test.ts)
reads the **committed files off disk** and asserts:

1. **Every** position in **every** fixture is inside a declared region. Not a sample: for FIT it
   decodes both `sint32` semicircle fields at every recorded position offset; for GPX and TCX it
   scans the document text for every `lat`/`lon` attribute and every `LatitudeDegrees`/
   `LongitudeDegrees` element.
2. The number of positions it found equals the number the generator says it wrote, so a coordinate
   cannot hide by being somewhere the guard does not look.
3. The corpus contains a non-trivial number of positions in total, so the guard cannot pass
   vacuously over an empty corpus.
4. The corpus directory is **closed**: it contains exactly the generated names and no others. This is
   the check that catches a real ride file dropped in beside them, whatever its coordinates are.
5. Every committed file's bytes equal a fresh generation, so what the guard checked is what is
   committed.

The failure message deliberately **does not print the offending coordinate**. ADR 0004 decision D
makes an error message a boundary and fixes the rule for coordinates as "the field and the
constraint, never the value"; this guard fires exactly when a real position may be present, and this
repository's CI logs are public.

**It has been watched to fail.** The pull request that introduced it records the output of a run with
a real-looking coordinate temporarily added to the corpus.

---

## 2. Byte stability

A test regenerates the corpus and asserts every byte is unchanged. Non-deterministic fixtures produce
failures that look exactly like parser bugs, and whoever is writing the decoder will spend a day on
it before suspecting the corpus.

So nothing in `tools/fixture-corpus/` may:

- read the clock — the ride starts at the constant `RIDE_START_UNIX_SECONDS`, 2024-06-15T09:00:00Z;
- call `Math.random`, seeded or otherwise;
- iterate a `Map` or a `Set` to produce output;
- format a number with the default `toString` — every number reaching a document goes through
  `decimal(value, places)`, and coordinates are held as integer 1e-7 degrees so no float accumulates
  across a track;
- derive anything from the environment, the filesystem or the platform.

---

## 3. Size budget

**Budget: 262 144 bytes (256 KiB).** The current total is in the table below and in
[`MANIFEST.json`](MANIFEST.json), which is regenerated with the corpus. `corpus.test.ts` fails when
the total crosses the budget.

A fixture corpus is the classic place a repository silently accumulates megabytes: nobody adds ten
megabytes, everybody adds two hundred kilobytes. The budget turns "should we commit a 4 MB ride?"
into a decision somebody makes on purpose.

---

## 4. The fixtures

Adding a case is ten lines in [`../tools/fixture-corpus/corpus.ts`](../tools/fixture-corpus/corpus.ts)
and a regeneration; the row below comes from the `purpose` field of that entry, so a fixture without
a recorded purpose cannot exist. A test asserts this block matches the corpus.

<!-- BEGIN GENERATED FIXTURE TABLE -->

| Fixture | Bytes | Positions | What it is for |
| --- | ---: | ---: | --- |
| `nominal-outdoor-ride.fit` | 3427 | 120 | Baseline. 120 records at 1 Hz carrying every channel this product reads: position, altitude, distance, speed, heart rate, cadence, power and temperature, wrapped in the file_id / device_info / event / record / lap / session / activity message order a head unit writes. Every other FIT fixture is this one with something changed. |
| `indoor-trainer-no-position.fit` | 2461 | 0 | An indoor trainer ride with no position channel at all — not a zeroed one, not one full of invalid markers: the record definition simply does not declare the two fields. Half this product is indoor riding, and a decoder that assumes position exists fails here rather than on a rare file. |
| `paused-laps.fit` | 3472 | 120 | Two laps separated by a 300 s pause with no records in it, each bracketed by timer start and stop events. Elapsed time and moving time differ by the pause, and a decoder that reports one as the other is wrong by five minutes in a way nothing else in the file contradicts. |
| `sensor-dropout-30s.fit` | 2647 | 90 | Thirty consecutive seconds with heart rate, cadence and power set to their base types’ invalid markers, with position and timestamps uninterrupted either side. "The strap was not reporting" and "the rider produced zero watts" are different facts and both average plausibly; this is the file that separates them. |
| `antimeridian-crossing.fit` | 1347 | 40 | A track walking east across +180 degrees. In semicircles the longitude steps from 2^31 - 1 to -2^31 between two consecutive records — the largest positive sint32 to the most negative. A decoder that reads the field as uint32, or that interpolates across the crossing, produces a track that spans the entire map. |
| `point-nemo-southern-western.fit` | 1867 | 60 | A ride with negative latitude AND negative longitude throughout, neither crossing zero. A sign error survives every test written with two positive coordinates and puts a European ride in the Southern Ocean; packages/domain learned this in #25 and its position tests all use a negative pair for the same reason. |
| `truncated-mid-record.fit` | 967 | 30 | A ride cut off nine bytes into a record message — past the header, past the timestamp, halfway through the latitude field. The file header still claims the full data size and there is no trailing CRC. This is the realistic corruption case: a head unit whose battery died. It must yield a structured error with a byte offset, never a crash and never a silent short read. |
| `developer-fields.fit` | 1250 | 30 | A developer_data_id and a field_description declaring a field from an application this program has never heard of, carried on every record message. FIT is extensible by design and an unknown developer field must be carried or skipped, never fatal. |
| `heart-rate-16-bit.fit` | 958 | 30 | record.heart_rate declared as a uint16 with values from 260 to 310. Legal: a definition message carries each field’s size and base type rather than inheriting them from the profile. A decoder that hard-codes one byte for heart rate does not merely misread this field, it desynchronises and misreads every field after it. |
| `timestamp-epoch-boundary.fit` | 81 | 0 | date_time values at 0 (the FIT epoch, 1989-12-31, and legitimate), 1, the top of the reserved system-time range, the first value above it, and 0xFFFFFFFF (invalid). A value below the epoch cannot be written into a uint32 at all, which is why the rejection belongs on the encode side — see the note in fit-fixtures.ts and the test that pins it. |
| `event-timestamp-1024-wrap.fit` | 2151 | 0 | An hr.event_timestamp counter at 1/1024 s, declared as the uint16 the counter actually is and walked twice across its rollover at 65 536 ticks. Subtracting consecutive readings gives -65 488 once a minute and a negative cadence; packages/domain’s unsignedCounterDelta gives the right answer. #41 depends on this being handled. |
| `zero-length.fit` | 0 | 0 | Nothing at all: zero bytes. What a failed write leaves on disk, and what an empty upload form posts. Must be rejected as too short for a header, not indexed out of bounds. |
| `header-only.fit` | 16 | 0 | A valid 14-byte header declaring zero data bytes, its header CRC and the file CRC, and nothing else. Structurally valid and semantically empty — the boundary between "corrupt" and "an activity with no records", which are different errors to a user. |
| `nominal-ride.gpx` | 10304 | 30 | Baseline GPX 1.1: 30 track points with elevation, time and the TrackPointExtension heart rate and cadence a cycling file carries. The same track as the nominal FIT fixture, so a GPX import can be compared against the first 30 records of the binary one, point for point. |
| `point-nemo.gpx` | 7064 | 20 | GPX with both coordinates negative throughout. In XML a coordinate is text, so the sign bug here is a formatting and parsing one rather than a two’s-complement one — a writer that drops the minus and a reader that parses it with parseInt both produce a valid file in the wrong hemisphere. |
| `xxe-external-entity.gpx` | 1367 | 10 | A well-formed GPX whose DOCTYPE declares an external general entity pointing at file:///etc/passwd, referenced from the track name. SECURITY.md puts XXE in GPX and TCX specifically in scope; #32 must reject or refuse to expand it, and this is what that test asserts against. |
| `nominal-ride.tcx` | 19602 | 30 | Baseline TCX v2: one activity, one lap, 30 trackpoints with Position, AltitudeMeters, DistanceMeters, HeartRateBpm, Cadence and the ActivityExtension Watts. TCX nests its coordinates in elements rather than attributes, which is a different parsing path from GPX and fails differently. |
| `indoor-no-position.tcx` | 13032 | 0 | A TCX whose trackpoints carry no Position element at all. The indoor case again, in the format where "no position" is an absent child rather than an undeclared field — a reader that dereferences Position unconditionally throws on the first point. |
| `xxe-external-entity.tcx` | 3160 | 10 | The TCX counterpart of the hostile GPX: an external general entity referenced from the activity Id. Both formats are carried because a parser is usually configured per format and hardening one is not hardening the other. |

**19 fixtures, 75173 bytes of the 262144 byte budget (29%), 620 positions.** Regenerated with the corpus, so it cannot go stale.

<!-- END GENERATED FIXTURE TABLE -->

---

## 5. Where the FIT numbers came from — ADR 0006 R2

[ADR 0006](../../../docs/adr/0006-fit-codec-licensing.md) chose option (c): implement from the
publicly served FIT protocol documentation and depend on nothing carrying Garmin's terms. R2 requires
the provenance of every profile number to be recorded, naming the source and the date.

**No Garmin FIT SDK, `Profile.xlsx`, `fit-sdk-tools` artefact, `FitCSVTool`, `Fitgen` or
`ActivityRepairTool` was consulted, downloaded, installed or read in the course of this work, and
neither `@garmin/fitsdk` nor `fit-file-parser` is a dependency of anything here** (R1, R4).

### Sources

| Source | What was taken from it | Read |
| --- | --- | --- |
| Garmin's public FIT protocol documentation, `developer.garmin.com/fit/protocol/` | The container: file header, record header, definition message and data message layout, base type codes | 2026-09-03 |
| `fitfileeditor.com/skill` — an independent format reference | Corroboration of the same container layout and the base type table; the global message numbers | 2026-09-03 |
| `pinns.co.uk/osm/fit-for-dummies.html` — an independent write-up | Corroboration of the `record` message field numbers and base types, read from an annotated hex dump | 2026-09-03 |
| The CRC catalogue's published parameters for CRC-16/ARC | The polynomial, and the check value `0xBB3D` over `123456789` that pins this implementation | 2026-09-03 |

Every number below was corroborated across at least two of those, and none was taken from a Garmin
SDK artefact or from GPL/AGPL prior-art source. Reading prior art to check a protocol detail is
permitted by `CLAUDE.md` §6; copying from it is not, and nothing was copied — including the
sixteen-entry CRC nibble table, which is derivable from the polynomial and is therefore derived
rather than transcribed.

### Container

| Element | Value | Source |
| --- | --- | --- |
| File header size | 14 bytes (12 is the legacy form) | protocol documentation |
| Header layout | `size(1) protocolVersion(1) profileVersion(2) dataSize(4) ".FIT"(4) headerCrc(2)` | protocol documentation, corroborated |
| Record header | bit 7 header type, bit 6 definition/data, bit 5 developer data, bits 0–3 local message type | protocol documentation, corroborated |
| Definition message | `reserved(1) architecture(1) globalMessageNumber(2) fieldCount(1)` then `number(1) size(1) baseType(1)` per field; then `developerFieldCount(1)` and `number(1) size(1) developerDataIndex(1)` per developer field | protocol documentation, corroborated |
| Base type byte | low five bits the type number, bit 7 set when the type is endian-sensitive | protocol documentation, corroborated |
| CRC | CRC-16/ARC: reflected polynomial `0xA001`, initial value `0x0000`, no final XOR | CRC catalogue; check value asserted in `fit-crc.test.ts` |

`profileVersion` is written as `1` and is **this project's own constant**. It deliberately does not
claim to be any Garmin SDK version, which under R2 would be a record of a rule violation rather than
a fact. #30 must not read meaning into it.

### Global message numbers

| Message | Number |
| --- | ---: |
| `file_id` | 0 |
| `session` | 18 |
| `lap` | 19 |
| `record` | 20 |
| `event` | 21 |
| `device_info` | 23 |
| `activity` | 34 |
| `hr` | 132 |
| `field_description` | 206 |
| `developer_data_id` | 207 |

### Field definition numbers

`timestamp` is 253 and `message_index` is 254 in every message that carries them — those two are
reserved across the profile rather than assigned per message.

| Message | Field → number |
| --- | --- |
| `file_id` | `type` 0, `manufacturer` 1, `product` 2, `serial_number` 3, `time_created` 4 |
| `record` | `position_lat` 0, `position_long` 1, `altitude` 2, `heart_rate` 3, `cadence` 4, `distance` 5, `speed` 6, `power` 7, `temperature` 13 |
| `event` | `event` 0, `event_type` 1, `data` 3 |
| `lap` | `start_time` 2, `total_elapsed_time` 7, `total_timer_time` 8, `total_distance` 9 |
| `session` | `start_time` 2, `sport` 5, `total_elapsed_time` 7, `total_timer_time` 8, `total_distance` 9, `num_laps` 26 |
| `activity` | `total_timer_time` 0, `num_sessions` 1, `type` 2, `event` 3, `event_type` 4, `local_timestamp` 5 |
| `device_info` | `device_index` 0, `manufacturer` 2, `serial_number` 3, `product` 4, `software_version` 5 |
| `developer_data_id` | `application_id` 1, `manufacturer_id` 2, `developer_data_index` 3, `application_version` 4 |
| `field_description` | `developer_data_index` 0, `field_definition_number` 1, `fit_base_type_id` 2, `field_name` 3, `units` 8 |
| `hr` | `event_timestamp` 9 |

> ⚠️ **#30 must re-verify each of these against the public documentation before the decoder relies on
> it.** These numbers were corroborated across the independent sources above, which is enough for a
> fixture whose purpose is to exercise a container; it is not the same standard as a decoder's
> profile subset, and ADR 0006 R2 requires #30 to record its own provenance rather than inherit this
> one. The two are meant to be independent, so that a disagreement is visible rather than shared.

### The scales and offsets are `packages/domain`'s, not this generator's

Semicircles, the FIT epoch, the altitude scale and offset and the 1/1024 s counter modulus are all
computed by [`@onyourleft/domain`](../../domain/README.md) — `degreesLatitudeToSemicircles`,
`degreesLongitudeToSemicircles`, `unixSecondsToFitTimestamp`, `metresToFitAltitude`,
`unsignedCounterDelta`. Nothing here re-derives them. The two semicircle functions take distinct
branded types, so a fixture that transposed latitude and longitude would not compile.

---

## 6. What this corpus deliberately does not cover

Each of these is a real gap, named so nobody assumes it is covered:

- **A big-endian file.** Every definition message here declares little-endian architecture. A
  big-endian fixture is cheap and worth adding.
- **A compressed timestamp header.** The container's 5-bit time offset wraps every 32 seconds.
- **A file that rebinds a local message type mid-file.** The builder allows it by not tracking
  bindings, so the fixture is a few lines when it is wanted.
- **A bad CRC.** Every valid file here has a correct one; `truncated-mid-record.fit` has none at all.
  A file with a *wrong* CRC is a different rejection path from a missing one.

  > **All four are covered by #30, and none of them by a fixture.** The decoder handles the
  > architecture byte, the compressed timestamp header and mid-file rebinding, and rejects a wrong
  > CRC; each is tested in `packages/fit/src/decode/container.test.ts` against bytes laid out by
  > hand there, and the wrong-CRC case is tested by damaging the *committed* bytes of
  > `nominal-outdoor-ride.fit`. They stay listed as corpus gaps because they are still gaps in the
  > corpus, and #31's encoder will want fixtures for the first three.
- **UTF-8 outside ASCII.** `ByteWriter.asciiString` throws rather than transcoding, so a UTF-8 fixture
  would be a deliberate addition rather than a by-product of somebody pasting an accented character
  into a device name.
- **A real decoder.** Nothing in `tools/fixture-corpus/` reads a FIT file, and nothing here may: a
  fixture validated only by the code under test proves that the two share a bug. #30's decoder lives
  in `packages/fit/src/decode/` with its own independently derived profile table and its own CRC, and
  `decode-corpus.test.ts` is where the two are made to agree — or, if they ever stop agreeing, where
  that becomes visible.

---

## 7. Licence and repository rules

`packages/fit` is `Apache-2.0`, like everything under `packages/`. Every `.ts` file here carries the
SPDX header `LIC001` requires.

**The fixture files themselves carry no SPDX header, and no exclusion was needed for that.**
`scripts/check-repo-rules.sh` scopes `LIC001` and `SCOPE001` to source extensions — `.ts`, `.tsx`,
`.js`, `.jsx`, `.mjs`, `.cjs`, `.css`, `.sh` — and its own comment says why: *"Data and generated
formats are excluded because a header cannot be added to them without corrupting them."* A `.fit` is
binary and a `.gpx` or `.tcx` is a schema-constrained XML document; neither can carry a comment the
rule would find. Their licence comes from their path, which is the whole point of the path rule in
`CLAUDE.md` §3. Nothing in the checker was changed for this corpus.
