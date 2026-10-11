# What exists and what does not

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries §4b, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you are about to claim something exists, works, or has been verified — Android, sensors, the FIT codec, the store, physics, rooms, sync — or are adding a dependency.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

### 4b. Does **not** exist yet — and, below the line, what does

> ⛔ **None of the bullets in the first list runs today.** Do not copy these into a PR description
> as though you had run them, and do not add them to a CI workflow before the issue that owns them
> lands. The ⛔ stops at "What exists, and what each is **not** yet" — everything under that heading
> is in the tree, and its commands are in §4a.

- ⚠️ **`apps/mobile` now DOES exist** — this bullet used to say it did not, and a reviewer who
  remembers that is reading the old file. [#87](https://github.com/openzigs/onyourleft/issues/87)
  created it, ahead of [#85](https://github.com/openzigs/onyourleft/issues/85), because #87's own
  criteria are about the Android shell and there was nothing to put them in. See the heading below
  for what it holds and, more usefully, what it has NOT been able to prove.
- **A router package.** ADR 0005 names none, and none is installed: routing is hash-based and
  hand-written (`apps/web/src/shell/routes.ts`), the decision
  [`docs/architecture.md`](../architecture.md) §"`apps/web`: the shell, the design system and the
  accessibility baseline" records. ⚠️ This bullet used to list `react-router` as ADR 0005's, and a
  reviewer who remembers that is reading the old file.
- **`apps/api`** — and there never will be: the server is `apps/instance` (§2,
  [ADR 0036](../adr/0036-a-self-hostable-instance-server-now.md)). ⚠️ This bullet used to read
  *"`apps/api`, or anything else server-shaped. Not 'not yet' — not in Phase 1 at all"* (owner
  decision D6), and a reviewer who remembers it is reading the old file.
- **A PUBLIC room.** ⚠️ Since [#780](https://github.com/openzigs/onyourleft/issues/780)
  a running instance opens its store, serves accounts (with `OYL_INSTANCE_ORIGIN` set) and serves
  rooms through the Node adapter, and since [#784](https://github.com/openzigs/onyourleft/issues/784)
  and [#785](https://github.com/openzigs/onyourleft/issues/785) a RIDER makes and joins **private**
  rooms from the game's picker — a reviewer who remembers "no room anybody can reach" or "a way for a
  rider to make a room does not exist" in this bullet is reading the old file. What does not exist
  is a public room (#907, #910, #911; ADR 0028 D-6.4): nothing makes a room `public`. Who may start
  a race is decided by the owner (2026-09-30) — the room's creator, seated and connected in it. Nothing is deployed: the home
  deployment (#807) is the owner's to run. The Durable Object adapter
  ([#781](https://github.com/openzigs/onyourleft/issues/781)) is still **deployed nowhere**.
  ⚠️ **Sync is served and called, sealed only, since #1195** — a reviewer who remembers "Sync is
  BUILT and unreachable" is reading the old file. `src/instance.ts` hands the handler a sync when
  the instance holds keys (every sync route is sealed-only, ADR 0047 D-7; with no keys every sync
  route still answers `unavailable`), and the Instance screen's *Sync now* calls it through
  `apps/web/src/instance/sync-port.ts`, only with the instance's card.
  ⚠️ **`GET /instance` answers the operator's `OYL_INSTANCE_NAME` or `null` since #777**, never a
  made-up default, and **every answer carries `Access-Control-Allow-Origin: *`**, with a preflight
  to a routed path answering `204`, because the rider's app is always on another origin; it is safe
  only because the instance reads no cookie and never sends `Allow-Credentials` (`src/handler.ts`
  argues it).

#### What exists, and what each is **not** yet

Reconciled by [#110](https://github.com/openzigs/onyourleft/issues/110) once
[#107](https://github.com/openzigs/onyourleft/issues/107),
[#39](https://github.com/openzigs/onyourleft/issues/39) and
[#26](https://github.com/openzigs/onyourleft/issues/26) had all landed, rather than by each of the
three editing this list on its own branch and conflicting with the other two.

  - **`apps/mobile`** ([#87](https://github.com/openzigs/onyourleft/issues/87)) holds
    `capacitor.config.ts`, the generated `android/` project, and the Capacitor BLE adapter. ⚠️ **Six
    of #87's eight acceptance criteria could not be verified in the container this was written in
    and were not.** There was no Android SDK and `dl.google.com` is refused by the egress proxy, so
    nothing in `android/` had been compiled and no emulator or device had run it. ⚠️ **This bullet
    used to go on to say that "the merged manifest has not been asserted", and a reviewer who
    remembers that sentence is reading the old file.**
    [#318](https://github.com/openzigs/onyourleft/issues/318) discharged it: an Android SDK is
    available on a developer machine, `apps/mobile/src/android/merged-manifest.ts` locates the
    Gradle merge's own output and `merged-manifest.test.ts` asserts the permission set it ships —
    each `maxSdkVersion`, every `<permission>` it defines, every component it exports and every
    `<queries>` entry — against a **reviewed list** rather than against our own manifest, because
    three of the eleven permissions that ship are injected by libraries and all three are correct.
    ⚠️ **It is not a CI gate and must not be quoted as one**: CI does not build Android (§4c), so
    those assertions **skip** there, loudly, naming the paths they looked in and the Gradle command
    that would produce one. The half that runs everywhere is the reader, over throwaway trees.
    [`apps/mobile/README.md`](../../apps/mobile/README.md) §5 is the table of what was and was not
    available; read it before treating any Android claim here as checked. ⚠️ It also records that
    `android/gradle/wrapper/gradle-wrapper.jar` is a **committed binary whose checksum could not be
    verified** from this environment, and what would settle it.
  - **`packages/sensors/src`** ([#39](https://github.com/openzigs/onyourleft/issues/39)) holds the
    interfaces, `createDeviceSession`, `planCapabilitySources` and the simulator (#44).
    **`packages/sensors/web-bluetooth`** ([#40](https://github.com/openzigs/onyourleft/issues/40))
    holds the browser transport: the `DeviceId → device/server/service/characteristic` map, the
    global GATT operation queue, `createWebBluetoothTransport`, and a scripted Web Bluetooth stack
    at `@onyourleft/sensors/web-bluetooth/testing`. It holds **no profile** — not one service UUID
    and not one byte of payload. ⚠️ Since [#49](https://github.com/openzigs/onyourleft/issues/49)
    it also holds `fitness-machine-channel.ts`, the **production `FitnessMachineChannel`** and the
    only place in the program that writes to a GATT characteristic. That write must be
    `writeValueWithResponse`; `gatt.ts` declares the unacknowledged sibling *and never calls it* so
    that a swap is a red test rather than a silent regression, and
    `fitness-machine-channel.test.ts` is the test. `transport.openFitnessMachine(id)` returns the
    channel together with the Supported Power Range, the Supported Resistance Level Range and the
    Fitness Machine Feature bits, all **read from the device** — a setpoint bounded by anything
    else is the hard-coded assumption #43's criteria forbid.
    **`packages/sensors/protocol`** ([#41](https://github.com/openzigs/onyourleft/issues/41),
    [#42](https://github.com/openzigs/onyourleft/issues/42),
    [#43](https://github.com/openzigs/onyourleft/issues/43)) is where the profiles are: Heart Rate
    (`0x180D`), Cycling Speed and Cadence (`0x1816`), Cycling Power (`0x1818`) and the Fitness
    Machine Service (`0x1826`), exported as `@onyourleft/sensors/protocol`. FTMS is split in two
    because it is the one that also **writes**: `fitness-machine.ts` reads Indoor Bike Data
    (**`0x2AD2`** — the issue body's `0x2AD3` is Training Status and is wrong), the Feature
    characteristic and the two supported ranges; `fitness-machine-control.ts` drives the control
    point, which applies physical resistance to a person who is pedalling and is bounded before it
    writes rather than after — see `packages/sensors/README.md` §"Trainer control". ⚠️
    `protocol/` is a **third** directory rather than part of either neighbour, and it is
    platform-free: `src/` bars a service UUID and a `DataView` of GATT payload by its own rule, and
    a decoder inside `web-bluetooth/` would make the native stacks (#15) depend on the browser
    adapter, when the promise is that it is "the same parser, unchanged". `DataView` is an
    ECMAScript built-in, which is why a payload decoder can be platform-free at all.
  - **`packages/fit`** holds the **synthetic fixture corpus and its generator**
    ([#107](https://github.com/openzigs/onyourleft/issues/107)), the **FIT activity file decoder**
    ([#30](https://github.com/openzigs/onyourleft/issues/30)) in `src/decode/` as
    `decodeFitActivity(bytes)`, the **FIT activity file encoder**
    ([#31](https://github.com/openzigs/onyourleft/issues/31)) in `src/encode/` as
    `encodeFitActivity(activity)`, and **GPX 1.1 / TCX v2 import and export**
    ([#32](https://github.com/openzigs/onyourleft/issues/32)) in `src/xml/` as
    `decodeGpx` / `encodeGpx` / `decodeTcx` / `encodeTcx`. Per
    ADR 0006 all of them are written from the published protocol documentation and from the #29
    fixtures — **nothing carrying Garmin's terms may enter this package**, and R2 requires the
    provenance of every profile number to be recorded per message.
    The codec's record is
    [`packages/fit/README.md`](../../packages/fit/README.md) §3 and the corpus's is
    `packages/fit/fixtures/README.md` §5; they are **deliberately separate and independently
    derived**, and a test asserts the two tables agree so that a disagreement is visible rather
    than shared. ⚠️ Like `packages/store` it is not one program: `tsconfig.json` admits
    `@types/node` for the generator under `tools/`, and `tsconfig.platform-free.json` compiles
    `src/` alone with `lib: ["ES2024"]` and `types: []`. A `TextDecoder` in `src/` is therefore a
    compile error, which is why the codec carries its own UTF-8 reader **and its own XML reader**.
    ⚠️ **`fit-file-parser` 6.1.2 (MIT) is now a devDependency of `packages/fit`**, imported from
    one test file (`tools/fixture-corpus/third-party-acceptance.test.ts`) and never from `src/`. It
    is the independent third-party FIT reader #31's acceptance criterion requires, adopted under
    that issue's revision block, which struck "validate with the SDK's own checker" under
    ADR 0006 R1. `packages/fit/README.md` §1 records the reconciliation; that README's declaration
    no longer claims the package depends on nothing named `fit-file-parser`, and a reviewer
    expecting the old sentence should read the new one. ⚠️ **It was 5.0.2 until #755**: 6.1.2's
    effective message and type tables differ from 5.0.2's only by two sub-sports (153
    `mountain_enduro`, 154 `mountain_downhill`), and it parses every corpus file and the #138
    uploads to identical output in both `list` and `cascade` mode.
    ⚠️ **Since [#89](https://github.com/openzigs/onyourleft/issues/89) it also holds
    `src/route/`**, `decodeGpxRoute` — the #32 decoder composed with
    `@onyourleft/domain`'s route profile, and the only place the codec and the profile meet. That
    issue also taught `decodeGpx` to read **`<rte>`/`<rtept>`**, which a route planner writes and
    which nothing in this codec read before; ⚠️ a `<trk>` **wins outright** when a document carries
    both, because planners export the same line twice at different densities and concatenating them
    would double the ride.
    ⚠️ **`src/xml` refuses a `<!DOCTYPE` outright rather than configuring a parser to be safe.**
    That is not a setting to be revisited: a DTD is the only place an XML document can declare an
    entity, so refusing the declaration is what closes XXE and billion-laughs together, and the
    only entity references resolved at all are the five XML predefines. Do not swap in a
    general-purpose XML parser without reading `packages/fit/README.md` §7 first.
    ⚠️ **`tools/fuzz/` runs a seeded corpus fuzz inside `pnpm run test`**
    ([#128](https://github.com/openzigs/onyourleft/issues/128)) — about six seconds, no CI job of
    its own. Two things about it are easy to get wrong and are recorded in
    `packages/fit/README.md` §5: it **repairs the FIT checksums on half its mutations**, because a
    file CRC is verified before any record is read and a fuzzer that skips the repair tests
    `bad-file-crc` tens of thousands of times and never reaches the record loop; and its assertions
    go **beyond the error type**, because `subarray` clamps rather than throwing, so a bounds bug
    in this decoder produces no exception to watch for. Change the seed or the budget deliberately,
    and re-run the M16 mutation in `src/decode/container.ts` afterwards — that is the mutation the
    harness exists to catch and the only thing that says it still can.
  - **`packages/store`** holds athletes, activities, laps and privacy zones
    ([#26](https://github.com/openzigs/onyourleft/issues/26)) with the migration `up`/`down`
    contract, **per-second streams** at schema version 2
    ([#27](https://github.com/openzigs/onyourleft/issues/27), decided in
    [ADR 0011](../adr/0011-stream-storage.md)), **recording checkpoints** at schema version 3
    ([#46](https://github.com/openzigs/onyourleft/issues/46) — a session header plus append-only
    chunks, packed but deliberately **not** compressed, recovered as a contiguous prefix that stops
    at the first hole; `packages/store/README.md` §"Recording checkpoints" records why) and the
    **round-trip persistence harness**
    ([#28](https://github.com/openzigs/onyourleft/issues/28)) at `@onyourleft/store/testing` — see
    §5, and — since [#61](https://github.com/openzigs/onyourleft/issues/61) — the **device keypair
    and the signed activity record** at schema version 4, decided in
    [ADR 0011](../adr/0011-stream-storage.md)'s sibling
    [ADR 0014](../adr/0014-portable-identity.md), and — since
    [#89](https://github.com/openzigs/onyourleft/issues/89) — **saved routes** at schema version 7,
    which is the only record in the store that holds a whole *computed* artefact rather than
    measurements: `records.ts` says why that is safe here and is not for a ride's load.
    ⚠️ The private key is a **non-extractable
    `CryptoKey`**, stored as a handle: `crypto.subtle.exportKey` on it rejects, which is what makes
    "the private key never leaves the device" a property of the platform rather than a promise about
    our code. Do not replace it with a stored byte array. `packages/store/src/web-crypto.ts` is the
    only file in **non-test** code that calls `crypto.subtle` for a signature — `identity-verifier.test.ts`
calls `crypto.subtle.verify` directly and deliberately, because it is the independent spec verifier
and routing it through `web-crypto.ts` would destroy the independence it exists for; the record format, the
    canonical bytes and the verification logic are in `packages/domain`, which cannot name `crypto`
    at all. Devices and gear are still additive object stores in a later schema version. ⚠️ It is
    **not** platform-isolated the way `packages/domain` is — it uses `indexedDB` and
    `CompressionStream`, so its `tsconfig.json` includes the DOM lib, and `eslint.config.js`'s
    `no-restricted-globals` block stays scoped to `packages/domain`.
  - **`packages/physics`** ([#88](https://github.com/openzigs/onyourleft/issues/88)) holds the
    **Martin et al. 1998** power/speed model: the six force terms one exported function at a time
    (`terms.ts`), the forward model and its steady-state inverse (`power.ts`), the deterministic
    tick (`simulate.ts`) and an ISO 2533 air-density model (`air.ts`). It is platform-free the way
    `packages/domain` is, through one `tsconfig.json` rather than two, and it has **no runtime
    dependency but `@onyourleft/domain`**. Provenance for every constant, and the two that rest on
    weaker evidence, is [`packages/physics/README.md`](../../packages/physics/README.md) §2. ⚠️ **It has
    no production consumer, and since #92 it has a caller** — `src/pacer.ts` composes the pacing
    rule with `advance`, so a bot and a rider go through the same tick. Nothing *renders* a speed
    from it yet; #91 and #94 are the issues that will, and both need `apps/mobile`. ⚠️ Its determinism is enforced in
    `eslint.config.js`, **not** by the typechecker: `Date` and `Math.random` are ECMAScript
    built-ins and survive `lib: ["ES2024"]`, exactly as `DataView` does in `packages/sensors`.
    ⚠️ Do not "simplify" the tick's integrator. It splits the drive (integrated in energy) from
    the resistance (integrated in force) because the two have singular points in different places;
    the naive single-form version froze a coasting rider at 0.00027 m/s and never let a stationary
    one roll down a hill, and both failures are now tests.
**And the dependencies that exist.** The toolchain,
React 19, React DOM, Vite, — since #26 — `dexie` 4.4.5 and `fake-indexeddb` 6.2.5 (both
Apache-2.0, both zero-dependency, both under `packages/store`) and — since #40 —
`@types/web-bluetooth` 0.0.21 (MIT, zero-dependency, types only, a devDependency of
`packages/sensors`) and — since #31 — `fit-file-parser` **6.1.2** (MIT, a devDependency of
`packages/fit` **and, since #51, of `apps/web` too**, whose closure is `buffer` MIT → `base64-js`
MIT and `ieee754` BSD-3-Clause) and — since #63 — `maplibre-gl` **6.11.2** and `pmtiles` 4.5.0 (both
BSD-3-Clause, both runtime dependencies of `apps/web`, whose closure adds BSD-2-Clause, ISC, MIT and
one `(MIT OR Apache-2.0)` and no GPL, AGPL or non-OSI licence — ⚠️ **this said 6.7.0 until #489**,
which took 6.10.0 with the browser gate re-run; the bump added `bidi-js` and `require-from-string`
to that closure, both MIT, so the sentence above still describes it; and **6.10.0 until #756**,
which took 6.11.2 with the browser gate re-run and changed no dependency of `maplibre-gl` at all)
and — also since #63 —
`@playwright/test` 1.63.0 (Apache-2.0, with `playwright` and `playwright-core`, all three
Apache-2.0; a devDependency of `apps/web`, and the only dependency in the workspace that pins a
**browser** as well as a version — see §4f) and — since #91 — `three` **0.185.1** (MIT,
**zero dependencies**, a runtime dependency of `apps/web`) with `@types/three` 0.185.4 (MIT, a
devDependency, because `three` ships no types of its own) and — since #529 — `uqr` 0.1.3 (MIT) and
`jsqr` 1.4.0 (Apache-2.0), both **zero-dependency** runtime dependencies of `apps/web`, which draw and
read the side camera's pairing QR codes and are named in exactly one file,
`apps/web/src/camera/side-link-qr.ts` and loaded from it with `import()` only while pairing, so
neither is in the entry chunk, and — since #673 — `lucide-react` 1.48.0 (ISC, with MIT for the
icons derived from Feather; **zero dependencies**, a runtime dependency of `apps/web`, named imports
only — [ADR 0034](../adr/0034-lucide-icons.md)), and — since #950 — `tailwindcss` and
`@tailwindcss/vite` 4.3.3 (MIT, **build-time** devDependencies of `apps/web`, with
`@tailwindcss/node` and `@tailwindcss/oxide` pinned beside them for the gate that compiles what the
source writes) and `@radix-ui/react-alert-dialog` 1.1.23 (MIT, a runtime dependency of `apps/web`
reached only from the History group's lazily loaded chunk; its closure is sixteen `@radix-ui/*`
packages, `react-remove-scroll` and its helpers, `aria-hidden`, `get-nonce`, `detect-node-es` and
`use-callback-ref`, all MIT — [ADR 0042](../adr/0042-tailwind-and-radix-over-the-tokens.md)) and —
since #1072 — `motion` 13.5.1 (MIT, with `framer-motion`, `motion-dom` and `motion-utils`, all MIT; a
runtime dependency of `apps/web` reached only from the list–detail layout's lazily loaded chunk, and
`tools/bundle/entry-graph.ts` fails the build if any of it is in the entry —
[ADR 0041](../adr/0041-motion-for-menu-animation.md)), are
installed;

⚠️ **`three` is pinned at 0.185.1 rather than at the current 0.186.0 deliberately, and since #489
the reason is the ADRs alone.** This paragraph used to give two reasons and **one of them has
expired**: 0.186.0 was published on 2026-09-08, the same day it was wanted, and pnpm's
`minimumReleaseAge` refuses a lockfile entry younger than 24 hours — that release is two weeks old
now and no longer bites, so a reviewer who remembers the pin resting partly on it is reading the
old file. (§8's rule stands and is unrelated to this package: pin something older rather than add a
`minimumReleaseAgeExclude`, which turns the protection off for that package permanently.) What
holds the pin is that **ADR 0008's engine table names 0.185.x** and **[ADR 0026](../adr/0026-realistic-game-world.md) D-2
pins it by version** under the heading *"What does NOT change"*, and an ADR is not reversed by a
dependency bump — [#453](https://github.com/openzigs/onyourleft/pull/453) was declined on exactly
that ground. Moving it is its own issue and it owes: `test:browser` re-run with the figures the gate
prints restated; ADR 0026 **D-8**'s 527 333-byte `KTX2Loader`/`basis_transcoder.wasm` measurement
retaken from the installed tree; and a check that `PMREMGenerator`, the HDR loader, `GLTFLoader` and
`KTX2Loader` all still resolve out of `examples/jsm/`, which is the least stable part of that
package's surface. **No router package is installed**: ADR 0005 names none, and the hand-written
hash router in `apps/web/src/shell/routes.ts` is the recorded decision (`docs/architecture.md`).
⚠️ This used to read *"nothing else from ADR 0005's runtime list is, `react-router` included"*, and
neither half held — ADR 0005 names no router, and the list above is not every runtime dependency
(`@mediapipe/tasks-vision` under `apps/web` and the Capacitor packages under `apps/mobile` are
installed and not named in it), so read each `package.json` rather than this paragraph. Add a new
dependency in the issue that first needs it, after checking its licence against the
directory it lands in (CONTRIBUTING.md).

⚠️ **`@onyourleft/fit` moved from `apps/web`'s `devDependencies` to its `dependencies` in #51**,
because the import and export screen is the codec's first *production* caller rather than a test's.
The second entry for `fit-file-parser` is there for #51's third-party-acceptance assertion, and it
needs its **own** ambient declaration at `apps/web/src/transfer/fit-file-parser.d.ts`: TypeScript
resolves a `declare module` inside the program that includes the file, and `apps/web`'s program does
not include `packages/fit/tools`. Two declarations of one untyped devDependency is the cost of not
making a client's typecheck depend on another package's authoring-time directory layout.
