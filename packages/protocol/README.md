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
| room → client | `welcome` | `riderId`, `routeRef: { sha256 }`, `roomConfig: { kind, ridingPosition, reportIntervalMs, frameIntervalMs }` |
| room → client | `refuse` | `reason` |
| client → room | `report` | `sequence`, `atMs`, `powerWatts`, `cadenceRpm?` |
| room → client | `frame` | `tick`, `ackSequence?`, `riders: [[riderId, decimetres, centimetresPerSecond, draftPercent, flags]]` |
| room → client | `finish` | `order: [riderId, …]` |

- A report carries **no `riderId`**: the room attaches it from the connection, never from the wire.
- **No field carries a coordinate.** A rider is a distance along the route, and the route is named by
  the SHA-256 of its content; its geometry travels once, over HTTP, through the route-share path
  ([#784](https://github.com/openzigs/onyourleft/issues/784)). `src/coordinates.test.ts` walks the
  schema for a coordinate-named field.

## What the decoder refuses

`decodeClientMessage` (what a room receives) and `decodeRoomMessage` (what a client receives) never
throw. Each returns a message or a refusal with one of eleven reasons — the order and the bounds are
in `src/codec.ts`'s header and `src/schema.ts`. The byte limit (8 KiB of UTF-8) and the nesting
bound (3) are checked **before** the text is parsed. A hello from another protocol version or
another physics version is refused with a reason of its own, read before any other field of the
hello, because a newer client's hello may carry fields this build does not know.

A refusal's detail names a path and a rule, never a value from the message.

`encodeMessage` decodes what it writes before returning it, so `decode(encode(m)) ≡ m` for
everything it returns, and a `NaN` or an out-of-range value is thrown as `ProtocolEncodeError` here
rather than refused at the other end.

## Size

A 50-rider frame mid-race is **1 132 bytes** and the largest legal frame (100 riders, every slot at
its bound) **3 682 bytes** — both computed in `src/frame-size.test.ts`, which also says why no binary
encoding is built.

## The fuzz

`src/decode-fuzz.test.ts` runs a seeded fuzz of 10 000 mutated and random inputs inside
`pnpm run test`, on `packages/fit/tools/fuzz/`'s precedent: every input must decode to a refusal
with a known reason or to a message that re-encodes to itself, and nothing may throw.
