# `@onyourleft/sensors`

The transport-agnostic sensor abstraction: the shape every Bluetooth Low Energy transport
implements. Device discovery, connection lifecycle, capability description and typed measurement
streams — and **no transport and no protocol**.

Apache-2.0, like everything under `packages/`.

**`src/` depends on no platform API at all** — no DOM, no `navigator.bluetooth`, no Node globals, no
network types. `tsconfig.platform-free.json` narrows `lib` to `ES2024` and empties `types` for that
directory alone; `eslint.config.js` restates it for the module specifiers a `lib` narrowing cannot
see. `tsconfig.json` covers the whole package and admits the DOM, because ESLint's project service
resolves every file to the nearest config and a file outside every program is reported as "not found
by the project service" rather than as anything useful — the narrower program is the one that
enforces, and `pnpm run typecheck` runs both.

**`web-bluetooth/` is the one directory that may name a platform API**, and the only one it may name
is `navigator`. It is the transport boundary (#40); nothing it declares escapes above it. See
[`docs/architecture.md`](../../docs/architecture.md).

## What lives here, and what does not

| | Issue | Where |
|---|---|---|
| The interfaces below | #39 | here, `src/` |
| The Web Bluetooth adapter | #40 | `web-bluetooth/`, its own directory with its own place in `eslint.config.js` — [below](#the-web-bluetooth-adapter) |
| Heart Rate, CSC and Cycling Power clients | #41, #42 | `protocol/`, its own directory on the same terms, exported as `@onyourleft/sensors/protocol` — [below](#the-protocol-clients) |
| The FTMS client and trainer control | #43 | `protocol/`, split into `fitness-machine.ts` (reads) and `fitness-machine-control.ts` (writes) — [below](#trainer-control) |
| The device simulator | #44 | `src/simulator/`, exported as `@onyourleft/sensors/simulator` — [below](#the-device-simulator) |
| The transport conformance suite | #44 | `src/simulator/conformance.ts`, exported as `@onyourleft/sensors/conformance` |
| CoreBluetooth and Android BLE | #15 | the Capacitor plugin, behind the same interface |

A service UUID, a characteristic UUID or a `DataView` of GATT payload in **`src/`** means the
boundary has been crossed. All three belong in `protocol/`, which is why that is a directory of its
own rather than a subdirectory of either neighbour.

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
| "Nothing found" is not "not permitted" | four `TransportAvailability` kinds and eleven `SensorErrorCode`s |
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

- **`Percent`** — battery level, which every BLE sensor exposes.
- **`Kilojoules`** — FTMS total energy, which the characteristic reports in kilojoules *and* in
  kilocalories; they are not the same quantity. #43 reports the kilocalorie fields as raw numbers on
  `IndoorBikeDataReading` and fans neither out as a capability.

**Two of these arrived with #43**, because trainer control could not be typed without them:
`GradePercent` (signed — a descent is a negative grade, and dropping the sign makes a descent feel
like a climb) and `ResistanceLevel` (unitless and non-negative, and deliberately *not* the same
brand as `Watts`, because an ERG target of 250 and a brake level of 250 are the same literal written
to the same control point one op code apart).

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
| `ftmsTrainer()` | FTMS | `power`, `cadence`, `speed`, `trainer-control` | Indoor Bike Data fanned out with **one instant**; Control Point; Fitness Machine Status. Since #43 it also answers Set Target Resistance Level, Set Indoor Bike Simulation Parameters and Stop or Pause, and reports its supported ranges on the bench handle |
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
| Set Indoor Bike Simulation Parameters on a machine built `supportsSimulation: false` | `0x02` Op Code Not Supported | FTMS 4.16.2.22 — what a trainer with Target Setting bit 13 clear does |
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

`knownDevices()` is asserted the same way, and the shape of that assertion is worth stating because
it is the one method where transports legitimately disagree. Web Bluetooth returns none, a native
stack returns its restorable peripherals, and the simulator returns its catalogue; **all three are
correct**, so the suite does not assert a count — that would only be asserting which transport is
under test. It asserts that each entry is *usable*: issued by this transport, not a duplicate (a
repeated id aliases two devices onto one handle, the failure `device.ts` exists to prevent), and
accepted by the id-keyed methods, since a transport that returns a device it cannot then address has
reported a device that is not there.

`simulator.test.ts` runs it against all five device kinds, and since #40
`web-bluetooth/src/conformance.test.ts` runs the **same** suite against the Web Bluetooth adapter
with a scripted stack underneath it — the second point on the line the criterion draws. The same call
with a factory that wraps the adapter over a real `navigator.bluetooth` runs it against a trainer on
the desk, and a contributor with hardware can report the diff. The factory supplies
`settle(duration)`: the simulator advances its clock, the scripted stack notifies once per simulated
second, a real transport waits.

### What is deliberately not here

- **Bytes.** No characteristic encoding, for the reason given above. The byte-level cases in #44's
  revision block — the `uint24` total distance, the five-octet expended-energy triple behind bit 8,
  the Cycling Power qualifier bits 1 and 3 that are not presence bits — are decoder fixtures, and
  they arrive with the decoders in #41–#43.
- **Result codes no scenario reaches** — `0x04` Operation Failed. `0x02` Op Code Not Supported was
  in this list until #43 gave it a scenario (`supportsSimulation: false`).
- **Indoor Bike Data fields with no unit** — expended energy, heart rate, metabolic equivalent. The
  *decoder* reads all three (#43); the simulator's frames do not carry them.
- **Noise, fatigue and physics.** The rider is steady until the bench changes it. Power → speed is
  `packages/physics` (#88), and a second model of it in a test fixture would be a second source of
  truth.

## The Web Bluetooth adapter

`@onyourleft/sensors/web-bluetooth` is `SensorTransport` over `navigator.bluetooth`, and it is the
**only place in this program where a `BluetoothDevice` exists** (#40). It owns the flattening
`src/transport.ts` describes: a `DeviceId → { device, server, service, characteristic }` map, so that
the flat, `deviceId`-keyed interface every other stack fits is what the rest of the program sees.

```ts
import { createWebBluetoothTransport } from '@onyourleft/sensors/web-bluetooth';

const transport = createWebBluetoothTransport({ profiles: [heartRate, indoorBikeData] });

const availability = await transport.availability();
if (availability.kind !== 'available') { /* Safari, Firefox, Linux, or the radio is off */ }

button.addEventListener('click', async () => {          // one gesture, one device
  const strap = await transport.discover({ capabilities: ['heart-rate'] });
  await transport.connect(strap.identity.id);
  await transport.subscribe(strap.identity.id, 'heart-rate', render);
});
```

### ⚠️ The constraints a caller must design around, not work around

These are platform facts. #49's pairing UX and #48's browser-support screen are built on them, and a
UI that hides any of them promises the athlete something the browser will not do.

| Constraint | What it means for a caller |
|---|---|
| **`requestDevice()` needs a user gesture, and one per device** | `traits.requiresUserGestureToDiscover` is `true`. A trainer plus two sensors is **three separate clicks**. There is no "pair everything" button, and the adapter checks `navigator.userActivation` before it calls, so a programmatic `discover` fails with `user-gesture-required` rather than as a `SecurityError` that also means three other things. |
| **There is no silent reconnect, and there will not be one in 2026** | `traits.canReconnectWithoutUserGesture` is `false` and `knownDevices()` returns nothing. `getDevices()`, `watchAdvertisements()` and Persistent Device Permissions all sit behind `chrome://flags`, with `watchAdvertisements` absent on ChromeOS and Linux entirely and MDN marking `getDevices()` "Limited availability / Experimental". **Do not build automatic reconnection.** A page reload costs a button press per device. |
| **Reconnecting *within* a session is free, and the adapter does the re-arming** | Only `requestDevice()` needs a gesture; `gatt.connect()` does not. So a dropout is recovered by calling `connect` again — and every subscription the caller still holds starts delivering again by itself. Do not re-subscribe: the `Unsubscribe` handles stayed valid, and re-subscribing would double the readings. |
| **This transport never enters `reconnecting`** | That state means "being restored without asking the athlete for anything", which Web Bluetooth cannot promise. A UI that showed it would be promising a recovery that does not arrive. |
| **No Safari, no Firefox, no Web Workers, no background** | `availability()` answers `unsupported` for the first two rather than throwing, which is the difference between a support message and a blank screen. The tab must stay live. |
| **Chrome on Linux is `unsupported`, even though the object is there** | WebBluetoothCG's own status file: *"Linux is partially implemented and not supported"*. The adapter requires both `requestDevice` and `getAvailability` to be callable and treats a `getAvailability` that throws as `unsupported`, so `'bluetooth' in navigator` is **not** the check. |
| **About three concurrent connections, not seven** | `traits.maxConcurrentConnections` is `MAX_RECOMMENDED_CONCURRENT_CONNECTIONS`. The budget is OS-wide and shared with the athlete's earbuds and watch. Use `planCapabilitySources`. |
| **The declared capability set is what you asked for** | Web Bluetooth cannot reveal a device's services before a link exists, and `SensorTransport` has no way to amend a `SensorDevice` afterwards. So `discover` declares the request's capabilities, and `subscribe` is the truthful check — it refuses one that no service on the connected device supplies. |

### One global GATT queue, across every device

`createGattQueue` serialises **every** GATT operation on **every** device onto one chain.
WebBluetoothCG records that some GATT operations cannot run in parallel (`web-bluetooth#188`), and
FTMS §4.16.3 independently permits one control-point procedure at a time; a per-device queue
satisfies neither. Pairing three sensors is therefore serial, and that is the cost of the operations
completing at all.

The queue also bounds every operation. `gattserverdisconnected` fires only for a link that **was
up**, so a device switched off during `gatt.connect()` sends no event — and Web Bluetooth specifies
no timeout for anything. Without a deadline that await never ends and the ride screen sits on a
spinner for ever. `DEFAULT_GATT_OPERATION_TIMEOUT` is 30 seconds; `operationTimeout` overrides it.

### Profiles come from `protocol/`

This directory contains no service UUID and decodes no payload. A `GattProfile` is a service, a
characteristic, the capabilities it supplies and a `decode(value, sink, at)`, and
[`protocol/`](#the-protocol-clients) supplies them — Heart Rate, Cycling Speed and Cadence and
Cycling Power today (#41, #42), FTMS with #43. Three things the seam guarantees, so a decoder cannot
get them wrong:

- **It cannot misattribute a measurement.** The device identity is the adapter's.
- **It cannot misdate one.** The receive instant is stamped once per notification, before `decode`
  runs, so every field out of one frame shares it — and since #41 it is passed *into* `decode` as
  well, because telling one lap of a wrapping event counter from none needs the wall-clock gap and
  a decoder must not read a clock of its own.
- **It cannot allocate per notification.** The sink is built once per characteristic per link and
  the `DataView` is the characteristic's own — so a decoder must not retain either, because the
  browser reuses the buffer for the next notification. A stateful profile keys its per-link
  accumulator on the sink through a `WeakMap`, which is a weak reference and not a retention; see
  `protocol/src/derivation.ts`.

A decoder that throws costs that one notification. Sensor data is untrusted input from a device that
may not be what it claims (`SECURITY.md`), and an exception let into the browser's event dispatch is
one nothing this program wrote can catch. `onProtocolError` is where a malformed stream becomes
diagnosable rather than merely silent.

### Testing against it

`@onyourleft/sensors/web-bluetooth/testing` is a scripted Web Bluetooth stack — devices, services,
characteristics, notifications, and a bench that can drop the link at a chosen instant, hold a GATT
call open for ever, and count installed listeners.

It exists **beside** the simulator rather than instead of it, and the boundary is worth stating.
The simulator is a second `SensorTransport`: it stands where this adapter stands, and
`src/simulator/profiles.ts` is explicit that it models field presence and not bytes. So there is
nothing under it for a Web Bluetooth adapter to sit on — no GATT server, no characteristic, no
`DataView`, and no way to script a disconnect in the middle of an operation. The adapter is run
against the simulator where the simulator fits: `web-bluetooth/src/conformance.test.ts` runs the same
`describeTransportConformance` suite against it that `src/transport-conformance.test.ts` runs against
the simulator, which is the cross-implementation diff #44's fifth criterion asks for.

```ts
import { createFakeBluetooth } from '@onyourleft/sensors/web-bluetooth/testing';

const { bluetooth, bench } = createFakeBluetooth({ devices: [myDevice] });
const transport = createWebBluetoothTransport({ profiles: [mine], bluetooth });

bench.hold('startNotifications');       // a trainer that stops answering
bench.device('my-device').drop();       // the link goes, mid-operation
bench.device('my-device').listeners(service, characteristic);   // count the leak
```

## The protocol clients

`protocol/`, exported as `@onyourleft/sensors/protocol` (#41, #42, #43). The half of the stack that
turns an untrusted little-endian GATT payload into branded domain quantities — and, for FTMS, the
half that writes back.

```ts
import {
  heartRateProfile,
  createCyclingSpeedCadenceProfile,
  createCyclingPowerProfile,
  createIndoorBikeDataProfile,
} from '@onyourleft/sensors/protocol';
import { metres } from '@onyourleft/domain';

const transport = createWebBluetoothTransport({
  profiles: [
    heartRateProfile,
    createIndoorBikeDataProfile(),
    createCyclingPowerProfile({ wheelCircumference: rider.wheelCircumference }),
    createCyclingSpeedCadenceProfile({ wheelCircumference: rider.wheelCircumference }),
  ],
});
```

### Why a third directory

| Where it could go | Why it does not |
|---|---|
| `src/` | that directory bars a service UUID and a `DataView` of GATT payload by its own rule — #39's abstraction must not know a wire format |
| `web-bluetooth/` | the same decoders are the native stacks' (#15). A decoder inside the browser adapter makes CoreBluetooth and Android depend on it, and this file's own table promises "**the same parser, unchanged**" |

So it arrives the way `web-bluetooth/` did: its own entry in `eslint.config.js` and its own paths in
both tsconfig programs. It is **platform-free** — `tsconfig.platform-free.json` compiles it with
`lib: ["ES2024"]` and `types: []`, so `navigator` and every Web Bluetooth type are compile errors
here exactly as in `src/`. `DataView` is an ECMAScript built-in, which is the whole reason a payload
decoder can be platform-free at all.

### What each service reports, and what has to be derived

| Service | Reports on the wire | This program reports |
|---|---|---|
| Heart Rate `0x180D` | beats per minute (8- or 16-bit), sensor contact, energy expended, RR intervals | `heart-rate` — **withheld** when the strap says it has lost contact, because the zero it transmits is a valid `BeatsPerMinute` |
| Cycling Speed and Cadence `0x1816` | cumulative revolutions and a last-event time. **Neither an rpm nor a km/h** | `cadence`, `speed` — both differenced client-side |
| Cycling Power `0x1818` | a mandatory `sint16` of watts, and up to twelve optional flag-gated fields | `power`, `cadence`, and `speed` when a wheel circumference is configured |
| Fitness Machine `0x1826` | Indoor Bike Data: a speed in 0.01 km/h, a cadence in half-rpm, a `uint24` of metres, and up to thirteen flag-gated fields | `power`, `cadence`, `speed` — **one notification, one instant, three measurements**, which is why `planCapabilitySources` spends one connection here instead of three |

⚠️ **FTMS carries a Heart Rate field and this program does not report it.** It is whatever strap the
*machine* paired with itself; fanning it out would stamp the trainer's device identity on a reading
from a device the athlete never connected, and would let a trainer outrank the strap the athlete did
choose. It is on `IndoorBikeDataReading` for a caller who asks for it by name.

**Wheel circumference has no default and is a required argument.** It is a rider setting, not a
device property, and a default of 700×25c silently misreports distance for everyone else.

### The counters, and which of them actually wrap

| Counter | Width | Tick rate | Wraps |
|---|---|---|---|
| CSC wheel / crank event time | `uint16` | 1/1024 s | **every ~64 s** — on every ride |
| CPS **wheel** event time | `uint16` | **1/2048 s** | every ~32 s |
| CPS **crank** event time | `uint16` | 1/1024 s | every ~64 s |
| Cumulative crank revolutions | `uint16` | — | ≈ 12 h at 90 rpm |
| Cumulative wheel revolutions | `uint32` | — | effectively never |
| Accumulated torque, accumulated energy | `uint16` | — | on a long ride |

⚠️ **The same field name means different things in `0x1818` and `0x1816`.** Every helper takes the
tick rate and the modulus as parameters; there is one wrapping subtraction in this program,
`@onyourleft/domain`'s `unsignedCounterDelta`, and one derivation, `src/revolutions.ts`.

### The UUIDs, re-verified

#41 requires re-verification against the primary source, because both issue bodies carried values
corroborated from secondary sources during planning. Every value below was read on **2026-09-04**
from the Bluetooth SIG's own machine-readable assigned numbers — the `bluetooth-SIG/public`
repository, `assigned_numbers/uuids/service_uuids.yaml` and `characteristic_uuids.yaml`. **All ten
matched the issue text.**

| Name | Assigned number |
|---|---|
| Heart Rate | `0x180D` |
| Heart Rate Measurement | `0x2A37` |
| Body Sensor Location | `0x2A38` |
| Cycling Speed and Cadence | `0x1816` |
| CSC Measurement | `0x2A5B` |
| CSC Feature | `0x2A5C` |
| Cycling Power | `0x1818` |
| Cycling Power Measurement | `0x2A63` |
| Cycling Power Feature | `0x2A65` |
| Sensor Location | `0x2A5D` |

#43 added seven more, read from the same source on the same date:

| Name | Assigned number |
|---|---|
| Fitness Machine | `0x1826` |
| Fitness Machine Feature | `0x2ACC` |
| **Indoor Bike Data** | **`0x2AD2`** |
| Supported Resistance Level Range | `0x2AD6` |
| Supported Power Range | `0x2AD8` |
| Fitness Machine Control Point | `0x2AD9` |
| Fitness Machine Status | `0x2ADA` |

⚠️ **#43's issue body names `0x2AD3` for Indoor Bike Data and is wrong** — `0x2AD3` is Training
Status. Its own revision block corrects it. `protocol-registry.test.ts` pins both the correct value
and the fact that it is *not* the wrong one, because a client subscribed to Training Status pairs,
reports connected and delivers nothing.

The transcription into 128-bit form is checked rather than trusted:
`web-bluetooth/src/protocol-registry.test.ts` asserts each literal equals `canonicalUuid` of its own
assigned number. A transposed digit is otherwise a sensor that pairs and then reports nothing, which
is the hardest failure in this stack to diagnose.

### Sensor data is untrusted input

Every read is bounds-checked and every failure is a `SensorError('malformed-payload')` — never a
bare `RangeError`, never an out-of-bounds `DataView` read. A flag claiming a field the buffer does
not contain is the obvious attack on a flags-gated variable-length characteristic, and
`cycling-power.test.ts` truncates a full packet at **every** field boundary rather than at one.

A profile decodes the whole frame before it reports anything. Instantaneous power is mandatory and
comes first, so the tempting implementation reports it and then fails on a later field — it must
not, because the truncation means the offsets are not what they were read as.

### Indoor Bike Data has three traps a bit loop cannot survive

1. **Flag bit 0 is inverted.** It is *More Data*, and Instantaneous Speed is present when the bit is
   **clear** (FTMS 1.0 §4.9.1.2). Every other bit is normal polarity, so "for each set bit, consume
   a field" reads a speed that is not there on the first packet and misaligns everything after it.
2. **Bit 8 gates three fields and five octets** — Total Energy `uint16`, Energy per Hour `uint16`,
   Energy per Minute `uint8`. A decoder that reads one reads the heart rate out of the middle of the
   energy triple. Each has a "Data Not Available" sentinel (`0xFFFF`, `0xFF`) that is reported as
   absent rather than as 65 535 kcal.
3. **Total Distance is a `uint24`.** There is no `DataView.getUint24`.

**Recorded, not resolved: FTMS 1.0 and GSS v9 disagree about bit 2.** Table 4.10 describes the
Instantaneous Cadence bit with *inverted* polarity — the same wording as the More Data row directly
above it — while GSS v9 §3.124 says the field is present when the bit is set. The field is two
octets, so choosing wrongly shifts everything after it. **This client implements GSS v9**: it is six
years newer and is the delegated authority, the equivalent Cross Trainer table inverts only bit 0,
and the duplicated wording reads as a copy-paste erratum. The SIG states Errata Correction 23224 is
mandatory for FTMS 1.0 compliance and it was not obtained; it is the likely resolution. Both
readings are pinned by tests, so a correction changes a test rather than surprising a rider.

## Trainer control

`fitness-machine-control.ts` is **the file that applies physical resistance to a person who is
pedalling**. CLAUDE.md §6 and SECURITY.md both call that a safety problem rather than only a
security one.

```ts
import {
  createTrainerControl,
  decodeSupportedPowerRange,
} from '@onyourleft/sensors/protocol';
import { gradePercent, watts } from '@onyourleft/domain';

const trainer = createTrainerControl(channel, {
  powerRange: decodeSupportedPowerRange(await readSupportedPowerRange()),
  scheduleTimeout,            // a clock this package cannot have; see below
});

await trainer.requestControl();          // until this succeeds, nothing is written
await trainer.setTargetPower(watts(250)); // resolves with the QUANTISED value, or throws
await trainer.setSimulationParameters({ grade: gradePercent(-6.2) }); // a descent stays a descent
```

### The control point is a protocol, not a write

A fire-and-forget implementation *appears to work*, because the developer writing it is usually also
pedalling. It fails for a rider in a workout, silently, for the rest of the session.

| What has to happen | What goes wrong without it |
|---|---|
| `0x2AD9` is configured for **indications** — CCCD `0x0002`, not `0x0001` | silence, or an ATT error, which reads as a broken trainer |
| **Request Control** succeeds before any setpoint | the machine does not error on a setpoint, it **ignores** it (FTMS §4.16.2) |
| every write awaits its indication and **correlates the op code** | an ERG target the trainer rejected is reported as applied |
| a non-success result code becomes an error | the same, one layer down |
| control loss is detected — **three different ways** | a stale control assumption is how two apps fight over resistance |

The three ways control is lost, all of which this client watches for:

- Fitness Machine Status **`0xFF`** — at the *top* of the range, not the bottom. The only push
  signal that another client took control.
- A **`0x05` Control Not Permitted** result with no status notification at all. The routine case on
  a phone that reconnected.
- **This client's own Reset.** FTMS §4.16.2.1: control permission ends when the client initiates a
  Reset. The trap for a workout player that resets between intervals and keeps sending targets.

### The bounds, in order

The device is an **actuator** as well as a sensor, so its own advertised limits are not trusted on
their own:

1. **This client's ceiling.** `MAX_PLAUSIBLE_TARGET_POWER_WATTS` (2 000 W) and
   `MAX_PLAUSIBLE_GRADE_PERCENT` (±40 %). `decodeSupportedPowerRange` **refuses a device that
   advertises a maximum above the first**, so a hostile trainer cannot define its own ceiling.
2. **The device's advertised range**, read from Supported Power Range `0x2AD8` — three fields, not
   two, the third being the minimum increment. A range whose increment is zero is refused, because
   it divides by zero the moment a setpoint is quantised.
3. **Quantisation to that increment**, measured from the device's minimum and never rounded up past
   its maximum.

A setpoint failing any of them is refused **without being written**. `setTargetPower` resolves with
the value actually written, which is not always the value asked for.

⚠️ **`MAX_ENCODABLE_RESISTANCE_LEVEL` is 25.5, and FTMS 1.0 is internally inconsistent about it.**
The Supported Resistance Level Range is a `sint16` at 0.1 (so up to 3 276.7, and machines
advertising 32 are common) while the Set Target Resistance Level parameter is a `uint8` at 0.1. A
level above 25.5 is refused rather than truncated — truncating the octet would set 6.4 where 32 was
asked for.

### What the client believes, and how sure it is

`targetPower()` returns one of three states, not `Watts | undefined`:

| State | Means |
|---|---|
| `none` | nothing is set, or control was lost and whoever took it may change it |
| `confirmed` | the machine answered this exact value with `0x01` |
| `unknown` | a procedure timed out, or the link dropped while a target was held — the machine may or may not be holding it, and **this client can no longer change it** |

`unknown` is the state a UI has to be able to show. It is the honest answer to *"what happens on
disconnect mid-ERG?"*: the trainer keeps applying whatever it last accepted, nothing this program
can write will reach it, and reporting the last confirmed figure would tell the rider everything is
fine.

### The procedure timeout is an injected port

`protocol/` is platform-free, so there is no `setTimeout` and no `Date` here.
`TrainerControlOptions.scheduleTimeout` is how a transport lends this client a clock; without one, a
machine that never answers leaves its procedure pending until `linkLost()` or `close()` — and
because writes are serialised, every later setpoint waits behind it. **Pass one.** FTMS §4.16.4 names no timeout and the
ATT transaction timeout underneath is 30 s; `CONTROL_POINT_PROCEDURE_TIMEOUT_SECONDS` is 5 s, a
product choice: a rider whose ERG target has not moved in five seconds has already noticed.

### What is deliberately not implemented

- **The vendor control characteristic inside `0x1818`.** #43's revision block records its op codes
  *and* records that two independent open-source implementations disagree by a factor of ten on the
  rolling-resistance scaling. Writing an unverifiable scaling to a brake is exactly what this file
  is careful about. GoldenCheetah's precedence rule is adopted regardless and costs nothing: prefer
  a standard controllable service and fall back only when none was found.
- **Spin Down (`0x13`)**, whose success response carries a parameter no other procedure has and
  which needs hardware to be worth anything.
- **Set Target Speed, Inclination and Heart Rate**, which an indoor bike client has no use for.

### What is deliberately not here

- **Control points** (`0x2A39`, `0x2A55`, `0x2A66`). `SensorTransport` has no write path, and #43
  owns the command surface.
- **FTMS `0x1826`.** #43's, with its own review: its control point applies physical resistance to a
  person who is pedalling, which CLAUDE.md §6 calls a safety problem rather than only a security one.
- **Reading the Feature characteristics on connect.** `decodeCyclingPowerFeature` and
  `decodeCscFeature` exist and are tested; wiring a characteristic *read* into the transport belongs
  with [#131](https://github.com/openzigs/onyourleft/issues/131), which is the issue that owns a
  device's capability set being fixed to what was requested.
- **Scaling a left-only power meter's doubled figure.** The device's number is passed through
  unscaled and the pedal power balance and its reference are surfaced beside it. There is no field
  that distinguishes a meter that doubles from one that does not, so guessing would halve the power
  of the riders whose meter does not.

## Running it

```bash
pnpm --filter @onyourleft/sensors run test
pnpm --filter @onyourleft/sensors run typecheck
```
