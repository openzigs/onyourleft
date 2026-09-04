# `@onyourleft/fit`

The FIT / GPX / TCX codec. Today it holds the **FIT activity file decoder**
([#30](https://github.com/openzigs/onyourleft/issues/30)) and the synthetic fixture corpus and
generator ([#29](https://github.com/openzigs/onyourleft/issues/29)). The FIT encoder is
[#31](https://github.com/openzigs/onyourleft/issues/31) and GPX/TCX import and export are
[#32](https://github.com/openzigs/onyourleft/issues/32).

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
> work in this package, and neither `@garmin/fitsdk` nor `fit-file-parser` appears in any dependency
> block of this repository or its lockfile.** (R1, R4.)

Section 3 below is the R2 record: where every profile number came from, per message, with the date it
was read.

---

## 2. Using the decoder

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
- **GPX and TCX.** #32.

---

## 5. The fixture corpus

[`fixtures/README.md`](fixtures/README.md) is the reference: what each file is for, why no real
person's ride is ever a fixture (ADR 0004 decision G), and the byte-stability and region guards.

The decoder is tested against the **committed** corpus in
[`tools/fixture-corpus/decode-corpus.test.ts`](tools/fixture-corpus/decode-corpus.test.ts), field by
field, with expectations computed from the generator's ride model rather than from the decoder. That
file lives under `tools/` because it reads files off disk and `src/` is compiled with no platform
surface at all — the decoder it exercises has no such dependency; the harness around it does.

## 6. Commands

```bash
pnpm --filter @onyourleft/fit run test        # run once; never `vitest` on its own
pnpm --filter @onyourleft/fit run typecheck   # both programs: the package, and src/ alone
pnpm --filter @onyourleft/fit run fixtures:generate
```
