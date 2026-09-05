# `@onyourleft/fit`

The FIT / GPX / TCX codec. It holds the **FIT activity file decoder**
([#30](https://github.com/openzigs/onyourleft/issues/30)), the **FIT activity file encoder**
([#31](https://github.com/openzigs/onyourleft/issues/31)), **GPX 1.1 and TCX v2 import and export**
([#32](https://github.com/openzigs/onyourleft/issues/32)), and the synthetic fixture corpus and
generator ([#29](https://github.com/openzigs/onyourleft/issues/29)).

Apache-2.0, like everything under `packages/`.

**It is handed bytes; it never opens anything.** `tsconfig.platform-free.json` compiles `src/` with
`lib: ["ES2024"]` and `types: []`, so `node:fs`, `fetch` and even `TextDecoder` are compile errors
here rather than review findings. That is what lets [#15](https://github.com/openzigs/onyourleft/issues/15)
use the decoder unchanged in a browser, in a Capacitor shell and — in Phase 3 — on an instance.

---

## 1. ADR 0006 declaration

[ADR 0006](../../docs/adr/0006-fit-codec-licensing.md) chose option (c): implement from the publicly
served FIT protocol documentation and depend on nothing carrying Garmin's terms.

> **No Garmin FIT SDK in any language, `Profile.xlsx`, `garmin/fit-sdk-tools` artefact, `FitCSVTool`,
> `Fitgen` or `ActivityRepairTool` was consulted, downloaded, installed or read in the course of the
> work in this package, and `@garmin/fitsdk` appears in no dependency block of this repository or its
> lockfile.** (R1, R4.)

Section 3 below is the R2 record: where every profile number came from, per message, with the date it
was read.

### `fit-file-parser` is a test-time devDependency, and that is a ruling rather than a lapse

⚠️ The sentence above **used to say** that `fit-file-parser` appeared in no dependency block either.
It now does, pinned exactly at **5.0.2 (MIT)** in this package's `devDependencies`. That changed with
#31 and it changed because #31's revision block ruled on it directly.

The original acceptance criterion was *"validating with the SDK's own checker rather than our own"*.
That criterion is **struck**, under **R1** — obtaining and running `FitCSVTool` makes the operator a
Licensee, and a Licensee contributing to an Apache-2.0 package is the §2(d) event ADR 0006 exists to
avoid. The permitted replacement the block names is *"an independent non-Garmin decoder, as a
test-time devDependency that is never shipped. `fit-file-parser` (MIT) and `dtcooper/python-fitparse`
(MIT) both qualify."*

That is consistent with ADR 0006 rejecting option (b) rather than in tension with it: (b) was
rejected for putting SDK-derived material into a **distributed** artefact, and a devDependency is
neither distributed nor linked into one. It is severable in one line.

Concretely:

- It is imported from **exactly one file**,
  [`tools/fixture-corpus/third-party-acceptance.test.ts`](tools/fixture-corpus/third-party-acceptance.test.ts),
  and never from `src/`. `packages/fit`'s `exports` do not reach it.
- Its dependency closure is `buffer` (MIT) → `base64-js` (MIT), `ieee754` (BSD-3-Clause). All
  permissive, all fine under `packages/` per CLAUDE.md §3. Verified with `pnpm licenses list --json`.
- It exists to **disagree with this package**. Its own reading of a file is what #31's third-party
  acceptance criterion is asserted against.

---

## 2. Using the FIT codec

```ts
import { decodeFitActivity } from '@onyourleft/fit';

const { activity, faults } = decodeFitActivity(bytes);
```

`activity` is the file's contents in `@onyourleft/domain` quantities. `faults` is every recoverable
problem, each a `FitDecodeError` carrying a `code` and the `byteOffset` it was found at.

### Two kinds of bad file, and they are not the same kind

`decodeFitActivity` **throws** a `FitDecodeError` only when nothing about the bytes can be believed,
and **collects a fault** when the file is readable up to a point.

| Thrown | When |
|---|---|
| `file-too-short` | fewer bytes than the smallest legal header |
| `bad-header-size` | the header's own size byte is not a size a header can have |
| `bad-signature` | bytes 8..11 are not `.FIT` |
| `bad-header-crc` | the 14-byte header's CRC does not match its first twelve bytes |
| `bad-file-crc` | the trailing CRC does not match the bytes it covers |

| Collected | When |
|---|---|
| `truncated-file` | the header promises more data than the file contains |
| `truncated-record` | a message runs off the end of the available bytes |
| `missing-file-crc` | the file ends without its two CRC bytes |
| `undefined-local-message-type` | a data message names a local type no definition has bound |
| `compressed-timestamp-without-reference` | a compressed-timestamp record arrived before any full timestamp |
| `invalid-field-value` | a field decoded to a value `@onyourleft/domain` rejects |
| `duplicate-file-id` | a second `file_id` arrived after the first; **the first is kept** |

A truncated file therefore returns **the records that were readable, plus a fault naming the byte
offset of the cut**. It never discards the ride and it never returns a silently empty activity — a
silent empty result is indistinguishable from a rest day.

**A fault message never carries the value that caused it.** ADR 0004 decision D fixes the rule for a
coordinate — *the field and the constraint, never the value* — and this package applies it to every
field, because the message that reports a rejected latitude and the message that reports a rejected
cadence are written by the same code, and an exemption is where the next coordinate leaks into a
public CI log.

### A gap is `undefined`

Every field of the decoded shape is optional, and a field the file did not record is `undefined` —
never zero, never the base type's invalid marker. That is `packages/store`'s rule for stream gaps
([ADR 0011](../../docs/adr/0011-stream-storage.md)) and it is the same rule for the same reason: an
indoor ride has **no** position channel, and a channel of zeros puts it in the Gulf of Guinea.

### Which shape it decodes into, and why that one

The decoder defines its own shape rather than reusing `packages/store`'s `ActivityRecord`, and rather
than hoisting those record types into `packages/domain`. The reason is that the mapping the other two
options exist to remove does not go away: a decoder is handed bytes, and it cannot produce an
`ActivityId`, an `AthleteId`, a display name, an ADR 0004 visibility or an IANA time zone. Every one
of those is supplied by whoever imports the file (#37), not by the file, so `ActivityRecord` is not
the decoder's output under any of the three options.

What **is** shared is the thing that matters: the units. Every measured value is a
`@onyourleft/domain` quantity — the same branded types `packages/store`'s records and stream channels
carry — so mapping fit → store is a field rename and never a unit conversion. And the shape is
symmetric, which is what #31 needs: decode is `bytes → FitActivity`, encode will be
`FitActivity → bytes`, and `packages/fit` still depends on nothing but `@onyourleft/domain`.

### `date_time` is two things sharing one field

A FIT `date_time` at or below `FIT_SYSTEM_TIME_MAX` is seconds since the device powered on, not an
instant. The decoded type is a union so a consumer cannot read one and forget the other exists:

```ts
type FitDateTime =
  | { kind: 'instant'; instant: UnixSeconds }
  | { kind: 'systemTime'; sinceDeviceStart: Seconds };
```

`packages/domain`'s `time.ts` asks for exactly this, and `timestamp-epoch-boundary.fit` is the
fixture that pins it.

### Using the encoder

```ts
import { decodeFitActivity, encodeFitActivity } from '@onyourleft/fit';

const { activity } = decodeFitActivity(bytes);
const { bytes: written, faults } = encodeFitActivity(activity);
```

`FitActivity` satisfies `FitEncodeInput` structurally, so `encode(decode(x))` needs no adapter —
which is what makes the corpus round trip a test of the encoder rather than a test of a mapping
written to make it pass. Every collection is optional, so a ride recorded on a trainer is
`{ records, laps, sessions, summary }` and nothing else.

`faults` is every field of the input that could not be carried into the bytes, each naming the global
message number and field number it came from. A caller that ignores them still gets a valid file.

| Fault | When |
|---|---|
| `nothing-to-encode` | the activity carries no messages at all, so the file is a header and a checksum |
| `value-not-representable` | a value no base type in this profile subset can hold, or one `@onyourleft/domain` rejects. **The one value is written as a gap; the channel is kept** |
| `instant-not-representable` | an instant before the 1989 epoch or past `uint32`. Dropped, never wrapped |
| `instant-reads-back-as-system-time` | an instant whose FIT `date_time` falls in the range reserved for "seconds since the device powered on" — before 1998-07-03T21:24:15Z. Written anyway, because the format offers no alternative, and reported |

`too-many-message-types` is the only **thrown** `FitEncodeError`: an activity needing more than the
sixteen local message types a FIT file can bind at once has no file to write. Nothing this profile
subset produces reaches it.

#### What the encoder decides that the caller does not

- **A channel no record carries is not declared at all**, so an indoor ride's record definition has
  no `position_lat` field rather than a channel of invalid markers, and certainly not one of zeros.
- **A record missing a channel other records carry gets that base type's invalid marker.** Never a
  zero: "the strap was not reporting" and "the rider produced no watts" are different facts and both
  average plausibly. **The marker fills the field's whole declared width**, one element at a time —
  a sixteen-byte `developer_data_id.application_id` that a message does not carry is sixteen bytes
  of `0xFF`, not four. A data message has no delimiters, so a field written at the wrong width moves
  every field and every record after it; the encoder reports `faults: []` and the decoder reports
  `truncated-record`. ⚠️ **The corpus cannot see this and a round trip through it stays green**:
  `developer-fields.fit` carries the same two-byte field on all thirty of its records, and two is
  one of the three widths a base-type-driven writer gets right by accident. It is covered in
  `src/encode/container.test.ts` and `src/encode/activity.test.ts` instead, at widths 1, 2, 3, 4, 5,
  8 and 16.
- **A channel is widened when its values do not fit its natural base type.** `heart-rate-16-bit.fit`
  carries 260–310 bpm in a `uint16`, which is legal, and an encoder that always wrote a `uint8` would
  turn 260 into 4. A value that is *equal* to a base type's invalid marker — 255 bpm in a `uint8` —
  counts as not fitting, because every reader would read it as a gap.
- **The natural width is a floor, never a ceiling.** `manufacturer` is written as a `uint16` even
  when it would fit a byte. Squeezing it is a gratuitous way to find out which third-party readers
  read the definition message properly.

---

## 3. Where the FIT numbers came from — ADR 0006 R2

R2 requires the provenance of every profile number to be recorded per message, naming the source and
the date. This record is **independent of the one in
[`fixtures/README.md`](fixtures/README.md)**, which was compiled for #29. That is deliberate:
`fixtures/README.md` §5 asks #30 to re-verify rather than inherit, *"so that a disagreement is
visible rather than shared"*, and
[`tools/fixture-corpus/decode-corpus.test.ts`](tools/fixture-corpus/decode-corpus.test.ts) asserts the
two tables agree. If they ever disagree, that test says so.

### Sources

| Source | What was taken from it | Read |
| --- | --- | --- |
| Garmin's public FIT protocol documentation, `developer.garmin.com/fit/articles/fit-protocol/fit_protocol.html` | The container: file header layout, record header bits including the compressed timestamp header, definition message layout, the base type table, the CRC description | 2026-09-04 |
| `fitfileeditor.com/skill` — an independent format reference | Corroboration of all of the above, including the developer field section of a definition message; the global message numbers 0, 18, 19, 20, 21, 23, 34, 132 | 2026-09-04 |
| `pinns.co.uk/osm/fit-for-dummies.html` — an independent write-up | Corroboration of the `record` message field numbers, read from an annotated hex dump | 2026-09-04 |
| The `blog.studioblueplanet.net` write-up of an independent FIT reader | Corroboration of the header, the definition/data record split and the local message type range | 2026-09-04 |
| The #29 fixture corpus in [`fixtures/`](fixtures) — files this project generated and lawfully holds, which ADR 0006 R2 names as a permitted source | The field definition numbers of `lap`, `session`, `activity`, `device_info`, `developer_data_id`, `field_description` and `hr`, and the global message numbers 206 and 207 | 2026-09-04 |
| The CRC catalogue's published parameters for CRC-16/ARC | The polynomial, and the check value `0xBB3D` over `123456789` that pins this implementation | 2026-09-04 |

**No number was taken from a Garmin SDK artefact, from `Profile.xlsx`, or from GPL/AGPL prior-art
source.** Reading prior art to check a protocol detail is permitted by `CLAUDE.md` §6; copying from
it is not, and nothing was copied. That includes the sixteen-entry CRC nibble table the public
documentation presents inside a C routine: the routine is expression, so `src/decode/crc.ts` derives
the loop from the polynomial instead, and `crc.test.ts` regenerates the nibble table from the same
polynomial and asserts the two agree.

> ⚠️ **Two of the numbers below rest on the corpus alone**, and that is stated rather than hidden.
> `field_description` = 206 and `developer_data_id` = 207 were not found on any of the independent
> web sources read for this work. They are recorded here because the corpus is a permitted R2 source
> and because they are checked by a passing decode of `developer-fields.fit`; a reader who finds a
> published table disagreeing with them should treat that table as the better evidence.

### Container

| Element | Value | Source |
| --- | --- | --- |
| File header size | 14 bytes; 12 is the legacy form and is read | protocol documentation, corroborated |
| Header layout | `size(1) protocolVersion(1) profileVersion(2) dataSize(4) ".FIT"(4) [headerCrc(2)]` | protocol documentation, corroborated |
| Header CRC | over bytes 0..11; a stored `0` means the writer did not compute one | protocol documentation |
| Normal record header | bit 7 clear; bit 6 definition/data, bit 5 developer data, bits 0–3 local message type | protocol documentation, corroborated |
| Compressed timestamp header | bit 7 set; bits 5–6 local message type (0–3), bits 0–4 a time offset in seconds relative to the most recent full timestamp, rolling over every 32 s | protocol documentation, corroborated |
| Definition message | `reserved(1) architecture(1) globalMessageNumber(2) fieldCount(1)` then `number(1) size(1) baseType(1)` per field; then, if the developer flag is set, `developerFieldCount(1)` and `number(1) size(1) developerDataIndex(1)` per developer field | protocol documentation, corroborated |
| Architecture | `0` little-endian, `1` big-endian, and it governs the definition's own `globalMessageNumber` as well as its data | protocol documentation, corroborated |
| Base type byte | low five bits the type number, bit 7 set when the type is endian-sensitive | protocol documentation, corroborated |
| File CRC | the last two bytes, little-endian, over every preceding byte | protocol documentation, corroborated |
| CRC algorithm | CRC-16/ARC: reflected polynomial `0xA001`, initial value `0x0000`, no final XOR | CRC catalogue; check value asserted in `crc.test.ts` |

`profileVersion` carries **no meaning for this decoder** and is deliberately given none. The corpus
stamps its own constant into it so that it does not claim to be a Garmin SDK version, which under R2
would be a record of a rule violation rather than a fact.

### Base types

| Number | Name | Size | Invalid marker |
| ---: | --- | ---: | --- |
| 0 | `enum` | 1 | `0xFF` |
| 1 | `sint8` | 1 | `0x7F` |
| 2 | `uint8` | 1 | `0xFF` |
| 3 | `sint16` | 2 | `0x7FFF` |
| 4 | `uint16` | 2 | `0xFFFF` |
| 5 | `sint32` | 4 | `0x7FFFFFFF` |
| 6 | `uint32` | 4 | `0xFFFFFFFF` |
| 7 | `string` | 1 per element | `0x00` — a NUL-terminated, NUL-padded field |
| 8 | `float32` | 4 | `NaN` |
| 9 | `float64` | 8 | `NaN` |
| 10 | `uint8z` | 1 | `0x00` |
| 11 | `uint16z` | 2 | `0x0000` |
| 12 | `uint32z` | 4 | `0x00000000` |
| 13 | `byte` | 1 per element | every byte `0xFF` |

Source: the protocol documentation's base type table, corroborated against `fitfileeditor.com/skill`,
both read 2026-09-04.

### Global message numbers

| Message | Number | Source |
| --- | ---: | --- |
| `file_id` | 0 | protocol documentation, corroborated by two independent references |
| `session` | 18 | independent format reference |
| `lap` | 19 | independent format reference |
| `record` | 20 | protocol documentation, corroborated by two independent references |
| `event` | 21 | independent format reference, corroborated by the hex-dump write-up |
| `device_info` | 23 | independent format reference |
| `activity` | 34 | independent format reference |
| `hr` | 132 | independent format reference |
| `field_description` | 206 | the #29 corpus **only** — see the warning above |
| `developer_data_id` | 207 | the #29 corpus **only** — see the warning above |

### Field definition numbers

`timestamp` is 253 and `message_index` is 254 in every message that carries them; both are reserved
across the profile rather than assigned per message.

| Message | Field → number | Source |
| --- | --- | --- |
| `file_id` | `type` 0, `manufacturer` 1, `product` 2, `serial_number` 3, `time_created` 4 | independent format reference |
| `record` | `position_lat` 0, `position_long` 1, `altitude` 2, `heart_rate` 3, `cadence` 4, `distance` 5, `speed` 6, `power` 7, `temperature` 13 | hex-dump write-up, corroborated by the independent format reference |
| `event` | `event` 0, `event_type` 1, `data` 3 | the #29 corpus |
| `lap` | `start_time` 2, `total_elapsed_time` 7, `total_timer_time` 8, `total_distance` 9 | independent format reference (names), the #29 corpus (numbers) |
| `session` | `start_time` 2, `sport` 5, `total_elapsed_time` 7, `total_timer_time` 8, `total_distance` 9, `num_laps` 26 | independent format reference (names), the #29 corpus (numbers) |
| `activity` | `total_timer_time` 0, `num_sessions` 1, `type` 2, `event` 3, `event_type` 4, `local_timestamp` 5 | independent format reference (names), the #29 corpus (numbers) |
| `device_info` | `device_index` 0, `manufacturer` 2, `serial_number` 3, `product` 4, `software_version` 5 | the #29 corpus |
| `developer_data_id` | `application_id` 1, `manufacturer_id` 2, `developer_data_index` 3, `application_version` 4 | the #29 corpus |
| `field_description` | `developer_data_index` 0, `field_definition_number` 1, `fit_base_type_id` 2, `field_name` 3, `units` 8 | the #29 corpus |
| `hr` | `event_timestamp` 9 | the #29 corpus |

### Scales, offsets and enumerated values

| Element | Value | Where it is applied |
| --- | --- | --- |
| `record.distance`, `lap`/`session.total_distance` | centimetres | `SCALE.distance` = 100 |
| `record.speed` | millimetres per second | `SCALE.speed` = 1000 |
| `lap`/`session`/`activity` durations | milliseconds | `SCALE.time` = 1000 |
| `record.altitude` | `uint16`, scale 5, offset 500 m | **`@onyourleft/domain`'s `fitAltitudeToMetres`**, not re-derived here |
| `position_lat`, `position_long` | semicircles, `sint32` | **`@onyourleft/domain`'s `semicirclesToPosition`**, not re-derived here |
| `date_time` | seconds since 1989-12-31T00:00:00Z | **`@onyourleft/domain`'s `fitTimestampToUnixSeconds`**, not re-derived here |
| `file_id.type` = 4 | an activity file | `FILE_TYPE_ACTIVITY` |
| `session.sport` = 2 | cycling | `SPORT_CYCLING` |
| `event.event` = 0 | the recording timer | `EVENT_TIMER` |
| `event.event_type` = 0 / 1 | timer started / stopped | `EVENT_TYPE_START` / `EVENT_TYPE_STOP` |

`hr.event_timestamp` is deliberately **not** scaled by its 1/1024 s tick rate. It is a free-running
counter, `event-timestamp-1024-wrap.fit` walks it across its rollover twice, and dividing a wrapped
counter by its tick rate destroys the modulus `unsignedCounterDelta` needs.

---

## 4. Only the subset is supported

ADR 0006: *"A narrow profile means files containing messages outside it decode with those messages
skipped, not with an error."* A global message number this profile does not name is counted in
`activity.skippedGlobalMessages` and dropped, so "the profile is too narrow for this file" is
something a reviewer can see rather than something that shows up as missing data.

**The profile grows by pull request, not by regeneration.** There is no code-generation step to rerun
when a message is added. Adding one is a deliberate change with a provenance line in section 3, which
is slower and is the point.

### Known gaps, named so nobody assumes they are covered

- **64-bit base types** (`sint64`, `uint64`, `uint64z`). A field declaring one keeps its bytes and has
  no numeric value; nothing desynchronises, because the definition message gave its size. Nothing in
  this profile subset uses one.
- **Arrays of a numeric base type.** A field whose declared size is a multiple of its base type's
  width keeps its bytes and has no scalar value, rather than silently becoming its first element.
- **A record with one coordinate and not the other** is reported as an `invalid-field-value` fault and
  the position is dropped. `GeographicPosition` is a pair by construction, and pairing the survivor
  with a zero is the bug the indoor fixture exists to prevent.
- **Accumulated fields and component expansion.** FIT can express a field as bit-packed components of
  another. Nothing in this profile subset does, and the decoder does not implement it.
- **Chained files.** A FIT file may be followed immediately by another complete FIT file. Bytes after
  the first file's trailing CRC are ignored rather than decoded as a second activity.
- **`hr.event_timestamp` above 65535.** The decoder reads the field through
  `@onyourleft/domain`'s `eventTicks`, which is a **`uint16`** counter reading and rejects anything
  above 65535. Real FIT declares the field as a `uint32` ticking at 1024 Hz, so a file whose `hr`
  messages run past **≈ 64 seconds** carries values the reading rejects: those messages get an
  `invalid-field-value` fault and lose that one field, while every other field of the message — and
  the whole rest of the ride — decodes. This is a real interoperability limit against real head
  units, not a theoretical one, and it is why `event-timestamp-1024-wrap.fit` walks a `uint16`
  counter rather than a `uint32` one. Widening it means widening the domain quantity and the
  `unsignedCounterDelta` modulus with it, which is a change to a merged package and belongs in its
  own issue. Tested at `src/decode/activity.test.ts` — *"drops an hr event timestamp wider than the
  uint16 counter it is read as"*.

The encoder's own gaps, which are not the same list:

- **It never writes a compressed timestamp header.** The decoder reads them, because real files use
  them; the encoder writes an ordinary `timestamp` field on every message. A compressed header saves
  three bytes per record and costs a class of bug — a five-bit offset relative to the most recent
  full timestamp — that no reader can diagnose from the outside.
- **It never rebinds a local message type.** Sixteen distinct message shapes is the limit and
  exceeding it is `too-many-message-types` rather than a silent rebinding, which would make every
  earlier definition unreadable to a streaming reader.
- **It writes little-endian only.** The decoder reads either order; a writer has no reason to offer
  a choice.
- **A developer field is carried verbatim** — its bytes, its size and its application index, exactly
  as the decoder found them. Nothing is re-derived from a `field_description` the encoder may never
  have been given.

---

## 5. The fixture corpus

[`fixtures/README.md`](fixtures/README.md) is the reference: what each file is for, why no real
person's ride is ever a fixture (ADR 0004 decision G), and the byte-stability and region guards.

The decoder is tested against the **committed** corpus in
[`tools/fixture-corpus/decode-corpus.test.ts`](tools/fixture-corpus/decode-corpus.test.ts), field by
field, with expectations computed from the generator's ride model rather than from the decoder. That
file lives under `tools/` because it reads files off disk and `src/` is compiled with no platform
surface at all — the decoder it exercises has no such dependency; the harness around it does.

### The corpus is also fuzz seed material

[`tools/fuzz/`](tools/fuzz/) mutates the committed corpus and requires the FIT decoder and the
GPX/TCX readers to survive it — #128. It runs inside `pnpm run test` and adds no CI job.

- **Seeded, not random.** Every case is a pure function of `FUZZ_SEED` in
  [`decode-fuzz.test.ts`](tools/fuzz/decode-fuzz.test.ts), the committed corpus and a stated budget.
  A failure prints the seed, the case index, the mutation kind, the seed file and the byte offset,
  which is the whole reproduction.
- **Two things it asserts beyond "it did not crash."** No message may report bytes from outside the
  data section the header declared, and no decode may produce more output than the input could
  encode. The first is what catches a missing record-length check: `subarray` clamps rather than
  throwing, so a bounds bug in this decoder has no exception to watch for.
- **It repairs the checksums on half the mutations, deliberately.** A FIT file's trailing CRC is
  verified before any record is read, so a fuzzer that does not recompute it tests `bad-file-crc`
  tens of thousands of times and never reaches the record loop at all.
- **The harness is itself tested** in [`harness.test.ts`](tools/fuzz/harness.test.ts): each
  invariant is run against input that violates it and required to go red, the same discipline
  `@onyourleft/store/testing` uses for the round-trip harness.

## 6. Commands

```bash
pnpm --filter @onyourleft/fit run test        # run once; never `vitest` on its own
pnpm --filter @onyourleft/fit run typecheck   # both programs: the package, and src/ alone
pnpm --filter @onyourleft/fit run fixtures:generate
```

---

## 7. GPX and TCX — #32

### The schema versions this package targets

#32's last acceptance criterion is that these are pinned here rather than inferred from the code.

| What | Namespace / version | Read | Written |
| --- | --- | :---: | :---: |
| **GPX 1.1** | `http://www.topografix.com/GPX/1/1` | yes | yes |
| GPX 1.0 | `http://www.topografix.com/GPX/1/0` | as far as `trk`/`trkseg`/`trkpt` allows | **no** |
| Garmin `TrackPointExtension` v1 | `http://www.garmin.com/xmlschemas/TrackPointExtension/v1` | yes | no |
| Garmin `TrackPointExtension` v2 | `http://www.garmin.com/xmlschemas/TrackPointExtension/v2` | yes | yes |
| Garmin `PowerExtension` v1 | `http://www.garmin.com/xmlschemas/PowerExtension/v1` | yes | yes |
| **TCX v2** | `http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2` | yes | yes |
| Garmin `ActivityExtension` v2 (`TPX`) | `http://www.garmin.com/xmlschemas/ActivityExtension/v2` | yes | yes |

**Extensions are recognised by local element name, case-insensitively, and only inside an
`<extensions>` / `<Extensions>` subtree.** Matching on namespace URI alone would be correct and
would drop most real files: Garmin has two `TrackPointExtension` versions in the wild, and Strava,
Wahoo, Hammerhead and Zwift each write their own. Power alone appears as `PowerInWatts`, `power` and
`Watts`. The scoping to an extensions subtree is what keeps that from being reckless — a `<name>`
element elsewhere in the document is not a channel.

### What each format cannot carry

Round-trip is *"semantically equal for every channel the format can represent, with the lossy
channels documented explicitly"*. This is that list, and `gpx.test.ts` and `tcx.test.ts` assert each
line rather than only describing it.

| Channel | GPX 1.1 | TCX v2 |
| --- | :---: | :---: |
| position, altitude, time | yes | yes |
| heart rate, cadence | `gpxtpx` | native |
| power | `gpxpx:PowerInWatts` | `ns3:TPX/Watts` |
| speed | `gpxtpx:speed` | `ns3:TPX/Speed` |
| temperature | `gpxtpx:atemp` | **lost** — no element in TCX v2 or `ActivityExtension` |
| per-point distance | **lost** — no element in GPX 1.1 or any extension written here | native |
| lap `totalElapsedTime`, `totalDistance` | **lost** — GPX has no lap | native |
| activity name | `<trk><name>` | **lost** — `<Notes>` is a rider's note, not a title |
| lap boundaries | one `<trkseg>` per lap; the count survives | native |
| sport | `<type>`, free text, passed through | `Sport`, mapped onto `Biking` / `Running` / `Other`; **an absent sport becomes `Other`, not absent** |
| activity start | `<metadata><time>`; **derived from the first point when absent** | `<Id>`; derived the same way |
| lap start | **lost** — GPX has no per-segment time, so the first point's timestamp comes back | `Lap@StartTime`, native; derived from the first point only when absent |

A GPX lap is a `<trkseg>`, which is the nearest thing the format has. A ride imported from TCX and
exported as GPX keeps its points, its segments and every channel with an extension; it loses each
lap's totals because there is nowhere to put them.

⚠️ **The last three rows are things the exporter *supplies*, not channels it drops**, and they are
the reason `withoutGpxLossyChannels` and `withoutTcxLossyChannels` apply those derivations rather
than only stripping channels. A normaliser that described a tidier export than the encoder performs
would turn every round-trip test into a test of the fixture — which is what happened while
`sampleActivity()` set every start time to exactly the value the derivation produces, and while the
TCX normaliser mapped an absent sport to absent and the encoder beside it wrote `Sport="Other"`.

### Timestamps

Both formats carry absolute instants and nothing else, so `TrackPoint.timestamp` is a `UnixSeconds`
rather than the FIT decoder's `{ instant } | { systemTime }` union — XML has no way to write "seconds
since the device powered on" and no file does.

ISO 8601 is parsed and written by hand rather than through `new Date(text)`, because ECMAScript
leaves parsing outside its own Date Time String Format implementation-defined and these files arrive
hand-edited. **A timestamp with no zone designator is refused, not assumed to be UTC and not read as
local time** — the same file would otherwise import as a different ride depending on where the rider
is sitting. Fractional seconds are truncated toward the past, never rounded; rounding moves a sample
past the next one. Everything is written as `YYYY-MM-DDTHH:MM:SSZ`, always UTC: a local time with an
offset would round-trip equally well and would put the rider's approximate longitude into a file they
may have exported precisely to share without it.

### XML is a security boundary, and the defence is the grammar

`SECURITY.md` names **XXE in GPX and TCX specifically**. This package parses XML with its own reader
([`src/xml/parse.ts`](src/xml/parse.ts)) rather than a dependency, for three reasons in this order:
`src/` has no platform surface so `DOMParser` is a compile error; a parser dependency under
`packages/` is a licence question before it is a technical one (CLAUDE.md §3, and MPL/EPL/BlueOak are
unruled until #24); and the subset needed is small enough that the FIT decoder's precedent —
depending on nothing — applies.

The defence is **two independent layers**, because one control is a single edit away from being none:

1. **A `<!DOCTYPE` is a fatal error before its contents are read.** A DTD is the only place an XML
   document can declare an entity, so this closes external entity resolution *and* billion-laughs
   entity expansion at the same point and by the same rule. It is a property of the grammar, not a
   parser setting that can be re-enabled.
2. **The only entity references resolved at all are the five XML predefines and numeric character
   references.** `&xxe;` in a document with no DOCTYPE is `unknown-entity` — never a silent empty
   string and never a passthrough.

Plus a nesting depth limit of 256, against a document built out of ten megabytes of `<a>`.

**A character XML 1.0 forbids is refused on the way in and dropped on the way out.** A `&#1;` is
`bad-character-reference`, and `escapeXmlText` removes any C0 control other than tab, line feed and
carriage return, along with unpaired surrogates and `U+FFFE`/`U+FFFF`. Both halves at once,
deliberately: this package accepted `&#1;` on import and wrote the character back out raw, so a
control character round-tripped through a codec that agreed with itself and produced a document expat
rejects. **A leniency shared by both ends of a codec is invisible to a round-trip test**, which is
why `write.test.ts` pins the writer's character class to the parser's `isXmlCharacter` rather than
trusting the two to stay in step.

Asserted against the **committed** hostile fixtures in
[`tools/fixture-corpus/xml-corpus.test.ts`](tools/fixture-corpus/xml-corpus.test.ts):
`xxe-external-entity.gpx`, `xxe-external-entity.tcx` and `billion-laughs.gpx`. Deleting either layer
turns those tests red, which is what makes this paragraph a description of behaviour rather than a
claim about intent.

**Nothing under `src/xml` reads a file, opens a socket or resolves a URI.** It cannot: `src/`
compiles with `lib: ["ES2024"]` and `types: []`.

### Errors

`ActivityXmlError` carries a `code` and a **character offset**, and splits the same way the FIT
decoder's does. Structural problems — not well-formed, a DOCTYPE, a truncation, the wrong root
element — are **thrown**, because there is no partial answer to give and offering one for a DOCTYPE
is the vulnerability. A single unreadable value inside an otherwise readable document — a latitude
that is not a number, a timestamp with no zone, a heart rate `@onyourleft/domain` rejects — is a
**collected fault**, the point is dropped, and the rest of the ride survives.

A message never carries the value that caused it (ADR 0004 decision D). That matters more here than
in the FIT decoder: an XML parse error naturally wants to quote the offending text, and the offending
text in a GPX file is very often a coordinate.
