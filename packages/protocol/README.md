# `@onyourleft/protocol`

The race-room wire format ([#768](https://github.com/openzigs/onyourleft/issues/768)): every message a
client (`apps/web`) and a room (`apps/instance`) exchange, its encoder, a bounded decoder that
refuses what it does not recognise, and the version handshake.

**Apache-2.0**, because it is under `packages/` ([CLAUDE.md §3](../../CLAUDE.md)). **No production
dependency at all**: validation is hand-written, in the style of
`packages/domain/src/workout/format.ts`. `@onyourleft/physics` is a **devDependency**, read by one
test that holds this package's restated bounds equal to the physics' own.

Platform-free like `packages/domain`: `tsconfig.json` narrows `lib` to ES2024 with `types: []`, and
`eslint.config.js` applies `platformIsolation`. A `WebSocket` or a `fetch` in `src/` fails both. The
transport is the adapters' business, never the format's.

## The messages

The transport is [ADR 0037](../../docs/adr/0037-instance-runtime-hosting-and-transport.md) D-3 and
D-4's: JSON over a WebSocket, compression off by default, a client reporting at 2 Hz and the room
answering at 1 Hz. The room re-simulates every rider
([ADR 0028](../../docs/adr/0028-racing-fairness.md) D-2), so a report carries **power, never a
position**.

| Direction | `type` | Fields |
|---|---|---|
| client → room | `hello` | `protocol`, `physicsVersion`, `ticket` |
| room → client | `welcome` | `riderId`, `routeRef: { sha256 }`, `roomConfig: { kind, ridingPosition, reportIntervalMs, frameIntervalMs, drafting, lapRace? }`, `voiceInvite?` — `lapRace: { laps, items }` in a lap race only; `voiceInvite`, the room's Discord voice link on `https://discord.gg/` and nothing else (`VOICE_INVITE_PATTERN`), only where the instance offers voice ([#875](https://github.com/openzigs/onyourleft/issues/875)) |
| room → client | `refuse` | `reason` |
| client → room | `report` | `sequence`, `atMs`, `powerWatts`, `cadenceRpm?` |
| client → room | `item-use` | `sequence`, `atMs` — a lap race only; names no item ([#1908](https://github.com/openzigs/onyourleft/issues/1908)) |
| client → room | `lane` | `sequence`, `atMs`, `lane` — a lap race only |
| room → client | `frame` | `tick`, `ackSequence?`, `riders: [[riderId, decimetres, centimetresPerSecond, draftPercent, flags]]` — or, in a lap race, nine slots: those five, then `raceOffsetCentimetres, lane, held, lapsDone`; `itemEvents?: [[riderId, event, item]]` in a lap race only |
| room → client | `countdown` | `startsInMs` — a race only |
| room → client | `name` | `riderId`, `displayName` — a race only, once a seat ([#1347](https://github.com/openzigs/onyourleft/issues/1347)) |
| room → client | `standings` | `tick`, `riders: [[riderId, gapDeciseconds, wattsPerKilogramTenths, flags]]` — a race only, after every frame, gaps to the recipient ([ADR 0051](../../docs/adr/0051-live-race-standings.md)) |
| room → client | `finish` | `order: [riderId, …]` |

`PROTOCOL_VERSION` is **4** since #875 added the welcome's `voiceInvite`: the decoder refuses a key it
does not know, so a version-3 build would refuse every welcome from a room with voice. It was **3** from
#1908, which added the lap race (epic
[#1894](https://github.com/openzigs/onyourleft/issues/1894),
[ADR 0060](../../docs/adr/0060-the-lap-race-effort-distance-and-a-bounded-race-offset.md)), and **2**
from #1347, which added `name` and `standings`. A hello from any other version is refused
`protocol-mismatch`.

- A report carries **no `riderId`**: the room attaches it from the connection, never from the wire.
- **A lap race's client sends inputs, never outcomes** (ADR 0060 D-5.4). A client message carrying a
  key in `CLIENT_OUTCOME_FIELDS` — `hit`, `raceOffset`, `position`, a held item, a lap count, every
  slot of the room's rider bar its id — is refused `outcome-from-client`, apart from an unknown key,
  so a room can count a client that claims a result. The item keys, the lane count and the race-offset
  bound are restated from `@onyourleft/domain`, a devDependency read only by
  `src/lap-race-agreement.test.ts`, which holds them equal.
- **No field carries a coordinate or a place name.** A rider is a distance along the route, and the route is named by
  the SHA-256 of its content; its geometry travels once, over HTTP, through the route-share path
  ([#784](https://github.com/openzigs/onyourleft/issues/784)). `src/coordinates.test.ts` walks the
  schema for a coordinate-named field.

## What the decoder refuses

`decodeClientMessage` (what a room receives) and `decodeRoomMessage` (what a client receives) never
throw. Each returns a message or a refusal with one of twelve reasons — the order and the bounds are
in `src/codec.ts`'s header and `src/schema.ts`. The byte limit (16 KiB of UTF-8 since version 3; 8 KiB
before) and the nesting
bound (3) are checked **before** the text is parsed. A hello from another protocol version or
another physics version is refused with a reason of its own, read before any other field of the
hello, because a newer client's hello may carry fields this build does not know.

A refusal's detail names a path and a rule, never a value from the message.

`encodeMessage` decodes what it writes before returning it, so `decode(encode(m)) ≡ m` for
everything it returns, and a `NaN` or an out-of-range value is thrown as `ProtocolEncodeError` here
rather than refused at the other end.

## Size

A 50-rider frame mid-race is **1 132 bytes** and the largest legal frame (100 riders, every slot at
its bound) **3 682 bytes**. A lap race's largest legal frame (100 riders of nine slots and 200 item
events, every one at its bound) is **14 597 bytes**, which is why the byte limit doubled in version 3. All
three are computed in `src/frame-size.test.ts`, which also says why no binary encoding is built.

## The fuzz

`src/decode-fuzz.test.ts` runs a seeded fuzz of 10 000 mutated and random inputs inside
`pnpm run test`, on `packages/fit/tools/fuzz/`'s precedent: every input must decode to a refusal
with a known reason or to a message that re-encodes to itself and holds inside every bound the schema
states, and nothing may throw.
