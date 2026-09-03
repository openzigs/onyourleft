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
| The interfaces below | #39 | here |
| The Web Bluetooth adapter | #40 | `packages/sensors`, in its own directory with its own tsconfig |
| Heart Rate, CSC, Cycling Power, FTMS clients | #41–#43 | below the transport boundary |
| The device simulator | #44 | its own transport |
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

Nothing here has a runtime dependency. `@onyourleft/domain` is imported for its types only —
`src/` calls no constructor from it — so the abstraction contributes no code to a bundle.

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

## Running it

```bash
pnpm --filter @onyourleft/sensors run test
pnpm --filter @onyourleft/sensors run typecheck
```
