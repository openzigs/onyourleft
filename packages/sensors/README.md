# `@onyourleft/sensors`

The transport-agnostic sensor abstraction: the shape every Bluetooth Low Energy transport
implements. Device discovery, connection lifecycle, capability description and typed measurement
streams — and **no transport and no protocol**.

Apache-2.0, like everything under `packages/`. **No platform API at all** — no DOM, no
`navigator.bluetooth`, no Node globals, no network types. `tsconfig.json` narrows `lib` to `ES2024`
and empties `types`; `eslint.config.js` restates it for the module specifiers a `lib` narrowing
cannot see. See [`docs/architecture.md`](../../docs/architecture.md).

## What lives here, and what does not

| | Issue | Where |
|---|---|---|
| The interfaces below | #39 | here, `src/` |
| The Web Bluetooth adapter | #40 | `packages/sensors`, in its own directory with its own tsconfig |
| Heart Rate, CSC, Cycling Power, FTMS clients | #41–#43 | below the transport boundary |
| The device simulator | #44 | `src/simulator/`, exported as `@onyourleft/sensors/simulator` — [below](#the-device-simulator) |
| The transport conformance suite | #44 | `src/simulator/conformance.ts`, exported as `@onyourleft/sensors/conformance` |
| CoreBluetooth and Android BLE | #15 | the Capacitor plugin, behind the same interface |

A service UUID, a characteristic UUID or a `DataView` of GATT payload in this directory means the
boundary has been crossed.

**Bluetooth Low Energy only.** The other wireless sensor standard for cycling is out of scope
permanently — owner decision D2, recorded in [ADR 0005](../../docs/adr/0005-tech-stack.md) and
enforced by rule `SCOPE001`. There is no browser path for it (Web Bluetooth is BLE by definition),
no iOS path at all, its trainer-control spec is behind a login, and its licence forbids
redistributing source containing the network key.

## The surface

| Concern | Type | Notes |
|---|---|---|
| Which device, on which stack | `DeviceIdentity` = `TransportId` + `DeviceId` | both branded; **compared together** |
| One physical device | `SensorDevice` | one entry, one capability *set* |
| What it can do | `SensorCapability` = `MeasurementCapability` \| `ControlCapability` | `power`, `cadence`, `heart-rate`, `speed`, `trainer-control` |
| Where the link is | `ConnectionState` | `disconnected`, `connecting`, `connected`, `reconnecting`, `unavailable` |
| What arrives | `SensorMeasurement`, `MeasurementFor<C>` | every field a branded quantity from `@onyourleft/domain` |
| The per-device lifecycle | `createDeviceSession` | the one piece of behaviour this package ships |
| The stack itself | `SensorTransport`, `TransportTraits`, `TransportAvailability` | flat and `deviceId`-keyed |
| Spending the connection budget | `planCapabilitySources` | prefers the trainer's own stream |
| Failure | `SensorError` + `SensorErrorCode` | "nothing found" and "not permitted" are different codes |

Nothing here has a runtime dependency. The abstraction — everything `@onyourleft/sensors` exports —
imports `@onyourleft/domain` for its types only and calls no constructor from it, so it contributes
no code to a bundle. The simulator is a separate entry point precisely because it does call them:
it labels every value it emits, and it is not in the bundle unless something imports it by name.

## Validating the interface against more than one BLE stack

This is #39's second acceptance criterion: a written walkthrough showing that both Web Bluetooth and
a native stack satisfy the interface **unchanged**. An abstraction derived from one stack's quirks
does not survive the move to the others, and finding that out in #15 is the expensive version.

The two shapes are genuinely different. Web Bluetooth is an **object graph**; CoreBluetooth, the
Android GATT APIs and the Capacitor plugin that wraps both are **flat and keyed by a device
handle**:

```ts
// Web Bluetooth — an object graph
const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [0x1818] }] });
const server = await device.gatt.connect();
const service = await server.getPrimaryService(0x1818);
const characteristic = await service.getCharacteristic(0x2a63);
await characteristic.startNotifications();

// @capacitor-community/bluetooth-le 8.3.0 (MIT) — flat, deviceId-keyed
const device = await BleClient.requestDevice({ services: [SERVICE] });
await BleClient.connect(device.deviceId);
await BleClient.startNotifications(device.deviceId, SERVICE, CHARACTERISTIC, (value: DataView) => …);
```

npm `webbluetooth` 3.7.0 (MIT), a Node implementation of the spec, is a third point on the same map,
and the plugin's own documentation says it "aims for consistent features across platforms **based on
the Web Bluetooth API**". Their common shape is `requestDevice(options)`, `connect(deviceId)`,
`startNotifications(deviceId, service, characteristic, cb)` and `write(deviceId, service,
characteristic, value)`.

**This interface takes the flat form, because the flat form is the target.** A flat interface maps
onto the object graph by keeping a map; an object-graph interface does not map onto CoreBluetooth at
all, because there is no object to hold.

### Method by method

| `SensorTransport` | Web Bluetooth (#40) | Capacitor plugin over CoreBluetooth / Android (#15) |
|---|---|---|
| `availability()` | `navigator.bluetooth.getAvailability()`, plus a feature-detect for the whole API — Safari and Firefox return `unsupported` | `BleClient.initialize()` then `isEnabled()`; a permission refusal is `not-permitted`, an adapter that is off is `adapter-unavailable` |
| `discover(request)` | `requestDevice({ filters })` inside the user gesture; capabilities become service filters; a cancelled chooser is `no-device-selected` | `BleClient.requestDevice({ services })`; same mapping, no gesture needed |
| `knownDevices()` | `[]` — permitted devices are not enumerable without a permissions API this program does not rely on | the peripherals the stack can restore |
| `connect(id)` | look `id` up in the handle map → `device.gatt.connect()` → resolve services and characteristics → store them | `BleClient.connect(id)`; **the Android disconnect-before-reconnect workaround lives here** |
| `disconnect(id)` | `device.gatt.disconnect()` | `BleClient.disconnect(id)` |
| `connectionState(id)` | the session's state, driven by `gattserverdisconnected` | the session's state, driven by the plugin's `onDisconnect` callback |
| `subscribe(id, capability, cb)` | `characteristic.startNotifications()` + a `characteristicvaluechanged` listener; the payload is parsed by #41–#43 and fanned out into typed measurements | `BleClient.startNotifications(id, service, characteristic, cb)`; **the same parser, unchanged** |

The parsing in #41–#43 is the half that must not be written twice, and in this arrangement it is not:
it takes bytes and returns `SensorMeasurement`s, and both adapters hand it bytes.

### The differences the interface exposes rather than hides

| Difference | How it appears |
|---|---|
| Web Bluetooth needs a user gesture per `requestDevice()` | `traits.requiresUserGestureToDiscover`, and the `user-gesture-required` error code |
| Web Bluetooth has no silent reconnect | `traits.canReconnectWithoutUserGesture` is `false`, so its transport never enters `reconnecting` |
| Native stacks work in the background | `traits.canRestoreConnectionsInBackground` |
| "Nothing found" is not "not permitted" | four `TransportAvailability` kinds and ten `SensorErrorCode`s |
| Device ids are not portable between stacks | `DeviceIdentity` carries the `TransportId`, and `sameDevice` compares both |
| The connection budget is small and OS-wide | `traits.maxConcurrentConnections`, and `planCapabilitySources` |

### The one asymmetry that must **not** appear here

The Capacitor plugin documents that on some Android devices `connect()` fails for a device that was
connected before, and that the caller must call `disconnect()` first. **That workaround belongs
inside the adapter.** An interface that exposed it — as a flag, as a documented calling order, or as
a `forceDisconnect` option — would have failed, because every other transport would then carry a
parameter describing one vendor's firmware bug. `connect()` is documented as idempotent from the
caller's side; making that true is the adapter's job.

## One device, several capabilities

A modern smart trainer is simultaneously an FTMS machine, a power meter and a speed/cadence sensor.
It is **one** `SensorDevice` with a capability set of four, so a device list renders it once. The
alternative — one device per capability — is what a GATT-shaped abstraction produces, and an athlete
recognises it immediately as broken.

### And the design rule that follows from it

**Prefer taking power and cadence from the trainer's own FTMS Indoor Bike Data stream over opening
separate sensor connections.** Plan for about three concurrent BLE connections, not seven: there is
no specified limit, reported evidence ranges from three to seven, and the budget is OS-wide and
shared with the athlete's earbuds and watch. Trainer + strap + power meter is already three.

`planCapabilitySources` makes that the natural expression rather than the awkward one. Ask for what
you need; the trainer wins because it covers three capabilities in one connection, and no caller has
to know that is why:

```ts
const plan = planCapabilitySources(discovered, {
  required: ['power', 'cadence', 'heart-rate'],
});
// plan.connections  → [trainer, strap]      two connections, not three
// plan.assignments  → power and cadence from the trainer, heart rate from the strap
// plan.unsatisfied  → []                    reported, never thrown
```

## Connection state is explicit, and only one state may deliver

```
                ┌───────────────┐
                │  unavailable  │◀── from anywhere: adapter off, permission gone
                └───────┬───────┘
                        ▼ (only)
  ┌────────────────────────────────────────────┐
  │ disconnected ──▶ connecting ──▶ connected  │
  │       ▲              │             │  ▲    │
  │       └──────────────┴─────────────┤  │    │
  │                                    ▼  │    │
  │                              reconnecting  │
  └────────────────────────────────────────────┘
```

`disconnected` cannot reach `connected` directly, so a transport cannot announce a link it has not
established. `unavailable` returns only to `disconnected`, because Bluetooth coming back on does not
restore a link — and on Web Bluetooth does not even restore permission to attempt one without a
gesture.

**Only `connected` may deliver measurements**, including not `reconnecting`: a transport that
buffered notifications across a drop and flushed them on recovery would deliver samples whose
receive instants are minutes old, and a recorder cannot tell those from live data.
`createDeviceSession` enforces it, so the rule is written and tested once rather than in each of the
five transports that will implement this interface.

## Units this package still needs from `@onyourleft/domain`

Left out rather than typed as a bare `number`, because the first unlabelled number on this boundary
is the one that costs a ride:

- **`Percent`** — battery level (every BLE sensor exposes it), and FTMS resistance level.
- **A signed grade type** — FTMS inclination.
- **`Kilojoules`** — FTMS total energy, which the characteristic reports in kilojoules *and* in
  kilocalories; they are not the same quantity.

## The device simulator

`@onyourleft/sensors/simulator` is a **second implementation of `SensorTransport`** with no radio
behind it, and a bench for driving it. It exists for three reasons, and the third is the one that
justifies its cost:

1. **CI can test the sensor layer with no hardware.** `ubuntu-latest` has no Bluetooth adapter; the
   simulator's suite runs there on every pull request.
2. **A hardware bug report becomes a scenario.** A contributor's trainer refuses a control write, or
   goes quiet for thirty seconds, or wraps a counter at an awkward moment; the maintainer encodes
   that as a script and reproduces it without buying the trainer. The worked example is
   [below](#adding-a-misbehaviour-from-a-bug-report).
3. **It is evidence that #39's interface is transport-agnostic.** An interface with one
   implementation is a description of that implementation. The simulator satisfies `SensorTransport`
   **unchanged**; if it could not have, that would have been a finding against #39, not something
   to fix by widening the interface.

Two further consequences that research established and nothing else records:

- **This is the contributor on-ramp.** Without it, contributing to the BLE layer requires owning a
  smart trainer — a contributor pool of roughly one. With it, every protocol client and every piece
  of pairing UI can be written and tested by someone who has never seen one.
- **It is also the App Store reviewability story.** An app reviewer has no smart trainer, and the
  standard `bluetooth-central` rejection fires when a reviewer cannot see the Bluetooth functionality
  the app declares. A reviewer-reachable demo mode built on this simulator is what prevents that. It
  is a downstream use for the native shell (#15), not scope here; it is noted so that #15 does not
  rediscover the need.

### Two faces

```ts
import { seconds, watts } from '@onyourleft/domain';
import { deviceId } from '@onyourleft/sensors';
import { createSimulator, modernTrainer } from '@onyourleft/sensors/simulator';

const { transport, bench } = createSimulator({ devices: [modernTrainer({ id: 'kickr' })] });

// The transport face: SensorTransport, exactly as apps/web will drive #40's adapter.
const device = await transport.discover({ capabilities: ['power', 'cadence', 'speed'] });
await transport.connect(device.identity.id);
await transport.subscribe(device.identity.id, 'power', (m) => console.log(m.at, m.power));

// The bench face: a virtual clock, the rider, scenarios, inspection, the FTMS control point.
bench.advance(seconds(5)); // five notifications, five power measurements
bench.rider.set({ power: watts(310) });
bench.device(device.identity.id).script({ kind: 'notification-dropout', duration: seconds(30) });
```

Nothing on the bench is part of `SensorTransport`. The control point in particular is on the bench
because #39 has no write path — `transport.ts` says why — and #43 owns the command surface. The
simulator serves the *device* side of that surface now so that #43's client has something to be
tested against when it arrives.

### Time is virtual

`lib` is `ES2024` and `types` is empty, so there is no `setTimeout` and no `Date` in this package.
The clock moves only when `bench.advance(seconds(n))` is called, one second at a time — the
notification period every profile here uses, and the cadence at which a real FTMS host has been
observed writing setpoints. A thirty-second dropout takes microseconds to run and is exactly
reproducible. `advance` takes a `Seconds`, not a number, and refuses a fraction.

### What it emulates

| Builder | Services | Declares | Notes |
|---|---|---|---|
| `hrsStrap()` | Heart Rate | `heart-rate` | 1 Hz, the rider's heart rate |
| `cpsPowerMeter()` | Cycling Power | `power`, `cadence` | crank-based; cadence is **derived** from the `uint16` crank counter and its 1/1024 s event time, exactly as #42 must derive it |
| `cscsSensor()` | Cycling Speed and Cadence | `cadence` | wheel (`uint32`) and crank (`uint16`) counters both modelled; **not** `speed`, because that needs the athlete's wheel circumference — `capability.ts` states the rule |
| `ftmsTrainer()` | FTMS | `power`, `cadence`, `speed`, `trainer-control` | Indoor Bike Data fanned out with **one instant**; Control Point; Fitness Machine Status |
| `modernTrainer()` | FTMS + Cycling Power + CSC | all four | **one `deviceId`**, one capability set; power arrives **once** per cycle although two services carry it |

The modern trainer is the case that matters most. It is #39's design decision — capabilities are a
set on one device — made concrete enough to break an adapter that gets it wrong: a `SensorDevice`
per service fails the identity assertions, and delivering power from both FTMS and CPS fails the
once-per-cycle assertion. A simulator with one profile per device could catch neither.

Frames are **field-presence records**, not bytes: each service's frame carries the fields the
characteristic's flags say are present, as labelled quantities or as the raw counters the profile
defines. There is no `DataView` here, because this directory bars GATT payload and because the
encoder for each characteristic is the mirror image of the decoder #41–#43 write — it belongs
beside them, where the two can be checked against each other. The frames are shaped so that an
encoder is a table lookup away (`INDOOR_BIKE_DATA_FLAG_BIT` records the bits, including the
inverted sense of bit 0).

### Scripted misbehaviour, each one watched to fire

Every scenario has a test that scripts it and asserts the consequence **through
`SensorTransport`** — what a subscriber received, what a state observer saw. A scenario that only
changes internal state is decoration.

| Scenario | Observable consequence | Test |
|---|---|---|
| `disconnect` | state → `disconnected`; nothing more delivered; the ATT bearer's state (indications, control, a queued response) is gone | `scenarios.test.ts`, `control-point.test.ts` |
| `disconnect` with `recoverAfter` | state → `reconnecting`, nothing delivered meanwhile, → `connected` on its own; **refused** on a transport whose traits say it cannot | `scenarios.test.ts` |
| `notification-dropout` (30 s) | 30 s gap in every stream while the state never leaves `connected` | `scenarios.test.ts` |
| `notification-dropout` (70 s, past the 64 s horizon) | the first cadence afterwards is **not emitted** — `eventTimeIntervalIsAmbiguous` says the counter has lapped an unknown number of times | `scenarios.test.ts` |
| `counter-wrap` | crank count and event time both lap on the next frames; the cadence stream does not notice | `scenarios.test.ts` |
| `control-permission-lost` | Fitness Machine Status `0xFF`; the next setpoint answers `0x05`; the power stream does not move | `control-point.test.ts` |
| `indoor-bike-data-fields` | speed present with flag bit 0 **clear**, total distance present, no cadence: the cadence stream goes quiet, power and speed continue | `scenarios.test.ts` |

The trainer's control-point refusals are not scenarios — they are its ordinary behaviour under the
sequence of writes that provokes them, so a client reaches them by writing:

| Write sequence | Answer | Source |
|---|---|---|
| Set Target Power before Request Control | result `0x05` Control Not Permitted, power unchanged | FTMS 4.16.2 — the routine case on a phone that reconnected |
| Request Control, Set Target Power | `0x01`, `0x01`, status `0x08` Target Power Changed, power holds the target | FTMS 4.16.2 |
| Set Target Power above the supported range | `0x03` Invalid Parameter | FTMS 4.16.2.5 |
| Reset | `0x01`, status `0x01`, **and the client's own control is revoked** | FTMS 4.16.2.1 |
| any write before indications are enabled | ATT error `0xFD` CCCD Improperly Configured | Core Spec Supplement, Part B |
| a write while a response is outstanding | ATT error `0xFE` Procedure Already in Progress | Core Spec Supplement, Part B |
| a write at 1 Hz for thirty seconds | thirty successes | observed host behaviour |

### Adding a misbehaviour from a bug report

Suppose a contributor reports: *"My trainer sends Indoor Bike Data with the power field missing for
a second or two after every ERG change. The app shows zero watts and my ride file has a hole."*

1. **Find the observable consequence.** Not "the flag byte is `0x44`" — the consequence through
   `SensorTransport`: a `power` subscriber receives nothing for those frames while `cadence` and
   `speed` continue, and the frames carry the same `at`.
2. **Check whether an existing scenario reaches it.** Here `indoor-bike-data-fields` already does:
   script `new Set(['instantaneous-speed', 'instantaneous-cadence'])` after a Set Target Power and
   the power stream goes quiet. If it does, the work is a test, not a scenario.
3. **If it does not, add a variant to `Scenario` in `src/simulator/scenario.ts`**, with a doc
   comment that names the real device or the specification clause it comes from. A scenario nobody
   can trace to a source is one nobody can decide to remove.
4. **Implement it in `script()` in `src/simulator/simulator.ts`**, or in the service model it
   concerns (`ftms.ts`, `profiles.ts`, `counters.ts`). Refuse it with `capability-unsupported` on a
   device that does not have the service it needs, rather than ignoring it.
5. **Write the test first**, in `scenarios.test.ts`: script it, `advance`, and assert on what the
   subscriber received. Watch it fail against the unmodified simulator.
6. **Mutate the implementation** — invert the condition, delete the write — and watch the test go
   red again. List the mutation in the pull request; CLAUDE.md §5 makes that the gate.
7. **Add a row to the table above.** The table is how the next contributor finds out the fault is
   already reproducible.

### The conformance suite, and pointing it at hardware

`@onyourleft/sensors/conformance` exports `describeTransportConformance(name, subject)`: what every
`SensorTransport` must do, written once as a function of a factory. It asserts only what is true of
every transport and every real device — the lifecycle runs `disconnected → connecting → connected`,
each declared capability delivers within five seconds, nothing arrives before connection or after
disconnection, every measurement names the device — so it cannot check an exact value or script a
fault; the simulator's own tests do those.

`simulator.test.ts` runs it against all five device kinds. When #40 lands, the same call with a
factory that wraps the Web Bluetooth adapter runs it against a trainer on the desk, and a contributor
with hardware can report the diff. The factory supplies `settle(duration)`: the simulator advances
its clock, a real transport waits.

### What is deliberately not here

- **Bytes.** No characteristic encoding, for the reason given above. The byte-level cases in #44's
  revision block — the `uint24` total distance, the five-octet expended-energy triple behind bit 8,
  the Cycling Power qualifier bits 1 and 3 that are not presence bits — are decoder fixtures, and
  they arrive with the decoders in #41–#43.
- **Set Indoor Bike Simulation Parameters (`0x11`)** needs a grade type `@onyourleft/domain` does
  not have. Left out rather than typed as a bare number, like the units listed
  [above](#units-this-package-still-needs-from-onyourleftdomain).
- **Result codes no scenario reaches** (`0x02` Op Code Not Supported, `0x04` Operation Failed) and
  Indoor Bike Data fields with no unit (expended energy, heart rate, metabolic equivalent).
- **Noise, fatigue and physics.** The rider is steady until the bench changes it. Power → speed is
  `packages/physics` (#88), and a second model of it in a test fixture would be a second source of
  truth.

## Running it

```bash
pnpm --filter @onyourleft/sensors run test
pnpm --filter @onyourleft/sensors run typecheck
```
