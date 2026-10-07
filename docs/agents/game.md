# The trainer game and the realistic world

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries §4h and the `apps/web/src/game/` part of the §2 layout tree, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you work on the trainer game — the simulation, renderer, camera, bicycle, racing line, scenery, terrain, water, settlements, HUD, gradient control, the realistic world — or wonder why it is in `apps/web` and not `apps/mobile`.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

### 4h. Where the trainer game lives, and why it is not `apps/mobile`

[#85](https://github.com/openzigs/onyourleft/issues/85)'s renderer (#91), ghost (#93) and HUD (#94)
are in **`apps/web/src/game/`**. Every one of those issues says `Component: apps/mobile`, so this
paragraph exists to stop that being read as a mistake.

**`apps/mobile/capacitor.config.ts` sets `webDir: '../web/dist'`.** The Android shell wraps
**apps/web's build** — that is #85's own premise, *"the mobile shell wraps the same web build, so
there is exactly one client and a divergence between the two is impossible rather than merely
discouraged"*. So a renderer under `apps/mobile/src` would typecheck, test green, and **never be
copied into the APK**. It would be the false pass `apps/mobile/README.md` §4 warns about, arrived at
from a new direction.

Three things reinforce it. [ADR 0008](../adr/0008-mobile-client-architecture.md) D-1 chose
Capacitor partly *for* web UI reuse. §2's layout already describes `apps/mobile` as the shell. And
both gates that can verify this work — the accessibility gate (§4e) and the browser gate (§4f) —
run against `apps/web` only; #94 has a WCAG AA contrast criterion, and putting the HUD in
`apps/mobile` would place it outside the one gate built to check exactly that.

⚠️ Those issue bodies **predate `apps/mobile` existing at all**. They were written 2026-09-03 and
#87 created the directory afterwards, so `Component:` there is a planning-time guess rather than a
decision — §8's "read the issue's revision block first" applies.

**The split that does hold is by capability, not by folder.** Computation and UI in `apps/web`;
only what genuinely cannot be web — `PowerManager.getThermalHeadroom()` (API 30+) and the
foreground-service wake lock — behind ports in `apps/web` with Capacitor implementations in
`apps/mobile`, exactly as #39's sensor interface relates to #40's Web Bluetooth transport.

⚠️ **`apps/mobile` had no importers at all until #85's wiring branch, and that sentence used to
stand here unqualified — a reviewer who remembers it is reading the old file.** Nothing in
`apps/web` reached for #87's Capacitor BLE transport, so the shell shipped a web build that could
not pair with anything on Android. Three things were missing and all three are now there:
`apps/mobile` declared no `exports` (so nothing *could* import it), nothing implemented
`CapacitorBlePort` against the real `BleClient` (so there was nothing to hand the transport), and
`main.tsx` had no way to tell a WebView from a browser.

**How the choice is made now.** `support/capacitor.ts` asks `Capacitor.isNativePlatform()` — not the
user agent, because a Capacitor WebView *is* Chrome and reports itself as Chrome, and not
`'Capacitor' in window`, because Capacitor's web build defines that global too. `main.tsx`'s
`buildPlatform` — named `buildRideController` until #284 gave it a second thing to build — is
asynchronous for exactly this: inside the shell it `import()`s
`@onyourleft/mobile` and builds the Capacitor transport; in a browser it never downloads a line of
it. `pnpm run build` shows the split, and `grep -c BleClient` over the entry chunk returns 0.

⚠️ **The Android trainer-control path is WRITTEN and has never driven a trainer**, and this
paragraph used to say "Trainer control now works on Android too" — a reviewer who remembers that
sentence is reading the old file, and [#230](https://github.com/openzigs/onyourleft/issues/230) is
why it was wrong. Nothing downstream of pairing could work, because **pairing itself did not**:
`BleClient.initialize()` was called only from `availability()`, which at the time nothing in
`apps/web` called, so every `discover()` reached `requestDevice()` with the plugin uninitialised.
(⚠️ That last clause was present tense until #284 falsified it: `apps/web/src/support/shell-support.ts`
is `availability()`'s production caller now, and the Devices screen is what reaches it.) #230 fixed that
(`transport.ts`'s `ensureInitialized`), and what is established today is that the **code** is
there: `openCapacitorTrainer` in `apps/web/src/ride/trainer.ts` is the Android counterpart of
`openWebBluetoothTrainer`, `apps/mobile/src/ble/fitness-machine-channel.ts` implements
`packages/sensors/protocol`'s `FitnessMachineChannel` over the plugin, and everything that decides
*what may be written* — `createTrainerControl`, the bounding, the quantisation, the feature gating
— is the same platform-free code on both, which is #39's promise being kept for the one operation
that writes. What is **not** established is that any of it has reached a trainer: that is
[validation 0002](../validation/0002-android-shell-and-game.md) Parts B–D, and its result tables
are still empty. Write "works on Android" again only when one of them is filled in.

⚠️ **The write is `port.write`, never `port.writeWithoutResponse`, and the wrong one is declared on
the port so the swap is a red test.** `FitnessMachineChannel` warns that an unacknowledged write
*"compiles, satisfies every test in this file, and reintroduces exactly the fire-and-forget failure
the client exists to prevent"* — so `plugin-port.ts` declares the unsafe sibling, `ble-client.ts`
implements it, nothing calls it, and `fitness-machine-channel.test.ts` asserts it stays uncalled.
The same shape `web-bluetooth/src/gatt.ts` uses for `writeValueWithoutResponse`.

⚠️ **`openCapacitorTrainer` hands this program's `DeviceId` straight to the plugin**, which is
correct only because `transport.ts` mints the one from the other — and its own `Link.pluginId`
comment warns they are "not necessarily" the same. `fitness-machine-channel.test.ts` pins that
assumption, because if it ever breaks the symptom is a control point write addressed to a device the
plugin has never heard of, on the one path that applies physical resistance to somebody.

⚠️ **Letting a trainer go goes through ONE method, and on the one trainer measured nothing it could
send releases anything** ([#372](https://github.com/openzigs/onyourleft/issues/372)). A reviewer
who remembers `stop()` being "the deliberate way to end resistance", **or** PR #442's "a release is
an FTMS Reset", is reading an old file. On the owner's trainer an acknowledged `0x08` Stop kept a grade
(2026-09-19) and an ERG target (2026-09-21), and an acknowledged `0x01` Reset kept the ERG target too
(2026-09-21) — while also revoking control. The owner **accepted end-of-ride retention** on the
condition, measured and met, that the app can take control again. So `TrainerControl.letGo()` in
`packages/sensors/protocol` sends a **Stop** and keeps control, and every release goes through
`ride/controller.ts` §`releaseTrainer` — *End ERG*, the end of a workout, stopping a ride, and a game
ride ending by button or by navigating away. What survives from #442 is structural: one release; it
is **not reported as a loss** (no "Control lost", and a workout ends rather than pausing); nothing
takes control back after one; and a refused Stop is reported as **Not released**.
⚠️ **Easing a rider DURING a workout is a different command**
([#441](https://github.com/openzigs/onyourleft/issues/441)): this trainer honours `0x05` Set Target
Power to within ±2 W, so a free-ride block, a stalled rider and a paused ride write the machine's own
Supported Power Range **minimum** through the ERG writer — never a Stop — and `ErgSink` stays
`Pick<TrainerControl, 'setTargetPower'>`, which is all that needs. ⚠️ **No test here proves a real
trainer lets go or eases** — every test asserts what is sent. Validation 0002 L5, L7, Part R and
Part S are the hardware steps.

From the layout tree of CLAUDE.md §2, under `apps/web/`:

```
    src/game/           the trainer game (#85) — the fixed-tick simulation the
                        renderer cannot influence, the road corridor built from
                        #89's profile, the quality ladder for a throttling
                        phone, the scene, and the one file that names three.
                        ⚠️ Since #323 the simulation also keeps the step BEFORE
                        the newest one, and the frame is drawn between the two:
                        20 Hz physics under a 60 fps loop drew each position
                        three times and jumped, and no gate here could see it
                        because every one of them asks where the rider IS.
                        ⚠️ Here rather than in apps/mobile because
                        capacitor.config.ts ships apps/web/dist — see §4h.
                        Since #237 the simulation also advances the bot pacer,
                        on the same fixed step as the rider and through
                        #92's advanceBot rather than a second integrator
    src/game/camera.ts  the chase camera as ONE composition (#424) — height,
                        distance behind, look-ahead and lens, which were four
                        constants in two files with four gates stated against
                        them. ⚠️ **The law in its header is the thing to read
                        before moving any of them**: the rider's share of the
                        frame and the point at which roadside scenery enters
                        it both depend on the camera through the one product
                        `B · tan(fov / 2)`, so #355's "verge in shot level with
                        the rider" and #424's "rider prominent" are one dial
                        and cannot both be had — 20.6 % of the owner's tablet
                        is the most the first leaves the second. The lens is
                        70° because that is what holds #355's 72 % near-field
                        bound with the camera 4.5 m back; it is solved, not
                        chosen. ⚠️ Since #423 the lens is also a function of
                        the FRAME: the world is full-bleed, and a fixed
                        vertical angle on an upright phone is a 36° slot.
                        ⚠️ The camera pitches with the ROAD — both the eye and
                        the look-at ride the corridor's own heights — so a
                        pacer 50 m ahead stays put on a 20 % hill where a level
                        gaze put it behind the rider's back
    src/game/bicycle.ts the rider, as a bicycle and somebody on it (#349) — the
                        parts as numbers rather than an asset, the two-bone knee
                        that puts each foot on its own pedal, and the one rule
                        that decides whether the RIDER's cranks turn: they turn
                        exactly when the HUD shows a cadence number, at exactly
                        that number. ⚠️ **Since #546 that rule has ONE exception,
                        the owner's, and a reviewer who remembers it without one
                        is reading the old file**: in a bend tight enough that
                        the inside pedal would strike the road (about 31° of
                        BICYCLE lean, computed from this file's own pedal —
                        `PEDAL_STRIKE_LEAN_RADIANS`), every rider's cranks, the
                        rider's own included, are DRAWN parked with the outside
                        pedal down (`drawnCrankAngle`). The HUD and
                        `advanceCrank` are unchanged, and the cranks come back
                        to the integrated angle after the bend. ⚠️ And since
                        #546 the body is not merged into the bicycle: the upper
                        body is its own mesh, held back toward upright about the
                        hips (`bicycleRoll`), so the BICYCLE leans a few per cent
                        more than `tan φ = v²/(g·R)` and the pair's centre of
                        mass leans exactly that. ⚠️ It names no model, no pack and no licence —
                        `ASSETS.toml` gains no row, and ADR 0022 D-1's "one CC0
                        source" is untouched, because there is no CC0 rigged
                        cyclist to download and a pedalling clip would have had
                        to be authored. ⚠️ **Since ADR 0026 (#431) D-1's "one
                        CC0 source" is superseded, and a reviewer who remembers
                        it as the reason there is no rider asset is reading the
                        old file**: a realistic rider — a MakeHuman CC0 body on
                        a CC0 or verified CC-BY-4.0 bicycle (#369) — is ADR 0026
                        D-12's fourth layer, and is posed from THIS file's crank
                        angle, so the cadence rule above binds it unchanged.
                        ⚠️ **Since #369 the BICYCLE is a race bike and is still
                        nobody's asset**, and the search that settled it is
                        written out in the file's own header so it is not run a
                        third time: ten sources on 2026-09-22, of which six hold
                        no bicycle at all, OpenGameArt's two are `CC-BY 3.0`
                        (which `ASSET004` fails closed and ADR 0023 admits only
                        at 4.0), and Sketchfab — whose "CC Attribution" **is**
                        `CC-BY-4.0`, read from the grant — holds exactly one CC0
                        bicycle in its whole downloadable corpus, a museum scan
                        of a wooden velocipede. ⚠️ And its downloads answer
                        `401` without an account, so ADR 0026 D-5's input digest
                        cannot be taken for any of them. What landed instead is
                        #369's own named answer: a drop bar from one number,
                        `BAR_BEND_RADIUS`, with `HAND_POSITIONS` a point ON it
                        per `RidingPosition` — because the hands used to be two
                        constants here and the drops four literals in
                        `three-renderer.ts`, 50 mm apart, with every gate green.
                        ⚠️ The stylised world's budget is DRAW CALLS rather
                        than triangles (#240 NFR-2), and the bar leaves that
                        at six; the realistic world's is triangles, and the
                        bar costs 96 of its 12 000. ⚠️ **#546 spent one**: the
                        riders are FOUR instanced meshes since then, not three,
                        because the upper body rolls against the bicycle —
                        `game.browser.spec.ts` §`SCENE_DRAW_CALLS` is 9 —
                        11 since #966, which drew the start gate and its
                        wordmark board in the stylised world too.
                        ⚠️ **Since #368 the bot and the ghost
                        DO get one, and a reviewer who remembers "the bot and
                        the ghost deliberately do NOT get one: three
                        silhouettes beat three bicycles in three colours" is
                        reading the old file.** That note is REPLACED rather
                        than deleted, because it was an argument: all three are
                        instanced into the same three meshes, so the two
                        solids' draw calls are gone and the scenery-free scene
                        costs 5 rather than 6. What tells them apart is a
                        per-instance TINT on the shared palette, which is
                        colour alone and is a weaker position than the old one
                        — the distances it was checked at are validation 0002
                        Part N. `simulatedCrankAngle` turns the other two's
                        cranks from their own ODOMETER at a fixed gear, which
                        is neither a reading nor a rate anybody invented.
                        ⚠️ **Since #625 the realistic body MOVES** — pelvis
                        roll, trunk rock, a head held level, ankling
                        (`riderMotion`, amplitudes cited) — only while the
                        marker's `pedalling` says a reading turns the cranks,
                        and a breath on the RIDE's clock (`rideSeconds`), so a
                        held ride holds it. The stylised rider does not move
    src/game/racing-line.ts
                        the line each rider rides through a bend, and the lean
                        (#499) — the least PEAK curvature inside the
                        carriageway, 0.6 m in from each edge, and
                        `tan φ = v² / (g·R)` from THAT line and the rider's own
                        speed, capped at 38.7° as a drawing decision. ⚠️ **The
                        line is how a rider is DRAWN, never how far they rode**:
                        distance, the trainer's grade, the ghost, the pacer's
                        gap and "To go" stay on the centreline, and
                        `line-on-the-road.test.ts` holds a trainer's grades
                        through a hairpin identical with and without it. ⚠️ Its
                        header records three objectives that were tried and why
                        each lost — the sum of squared curvature rides a hairpin
                        round its OUTSIDE, and the second difference (#499's own
                        elastic band) cuts inside and comes out more curved than
                        the centreline. `scene.ts` §`lateralOf` is where two
                        level riders are kept apart, and the camera follows the
                        rider across the road without rolling. ⚠️ **Since #546
                        a straight is ridden on the RIGHT, not on the centre
                        line**, and a reviewer who remembers the line settling
                        to offset nought is reading the old file: the owner
                        ruled a CLOSED road (the whole width through a bend), the
                        right-hand side "for now" (`ROAD_SIDE`, one constant,
                        and the road's normal is the rider's RIGHT, which the
                        browser gate reads back), a LATE
                        apex (`LATE_APEX_GAIN`), and a roll rate bounded per
                        SECOND as well as per metre (60°/s). `leanAt` is the
                        COMBINED lean; `bicycle.ts` §`bicycleRoll` splits it.
                        ⚠️ **Since #583 that normal is the MAP's right as well
                        as the screen's**, and a reviewer who remembers "the
                        corridor is a mirror of the map in a right-handed
                        renderer" here is reading the old file: it was, and
                        every route was drawn mirror-imaged — a right-hand bend
                        on the map turned LEFT on the screen, against the
                        HUD's north-up plan. `terrain.ts` §`localGroundPosition`
                        puts east on `−x` now. `ROAD_SIDE` did not move; the
                        tests that named a map-right bend "the normal's
                        negative side" did, and a test that measured the old
                        drawing now rides the MIRRORED fixture
                        (`route-fixtures-testing.ts`' `hand`), which reproduces
                        its digests to the digit
    src/game/contact-shadow.ts
                        where each rider's contact shadow lies (#426) — thrown
                        from `world.ts`'s ONE sun, never a second light
                        direction, and who casts one at all. ⚠️ **The ghost
                        does not**, on purpose: a bicycle with no shadow reads
                        as "not really here", which is #93's at-a-glance
                        criterion. `three-renderer.ts` §`ContactShadowBelt`
                        draws them as one instanced transparent call, ON the
                        road rather than received by it, because the road is
                        unlit and has no shadow lookup at all. A real shadow
                        map for the riders is `quality.ts`
                        §`RIDER_SHADOW_MAP_RUNG`: above the ladder, and ⚠️
                        **since #547 the rung every STYLISED ride starts on**
                        — the owner's *"use bike shaped shadow over blob"*
                        after validation 0002 Part T. A reviewer who remembers
                        "off unless a device asks" is reading the old file: a
                        device now stores `oyl.game.riderShadowMap = off` to
                        not get it. The blob is the FALLBACK — every rung after
                        the first step down (`keepsShadowMap`'s latch is
                        unchanged), and a device that turned the map off.
                        ⚠️ **Since #626 NOT the realistic world**, which casts
                        a bike-shaped silhouette on the same rungs instead
                        (`rider-silhouette.ts`, `three-renderer.ts`
                        §`RiderSilhouetteBelt`): the rider's side view made
                        once, thrown along the sun each frame by a shader whose
                        TypeScript twin is `silhouetteCoverage`, and which the
                        browser gate holds to that twin. ⚠️ **The ghost casts no MAP shadow
                        either**, and did until #547: it shares the rider's
                        meshes, so `three-renderer.ts` §`RiderBelt` hands the
                        pass the casters only, by this file's table. The ride's
                        opening stall (a 4 950 ms GPU frame on the tablet) is
                        paid in `three-renderer.ts` §`prepare`, which draws the
                        first frame into one pixel before any is shown. Part
                        T5 (20 minutes with the map on) is still owed.
                        ⚠️ **Since #620 its sun projection is SHARED**:
                        `sunThrowPerMetre` is the one place `world.ts`'s sun
                        becomes a shadow on the ground, and the scenery's
                        blobs read it too rather than a copy
    src/game/ground-blob.ts
                        where the realistic scenery darkens the ground it
                        stands on (#620) — a soft blob under every tree,
                        shrub, rock and structure the realistic world draws
                        as a mesh, thrown from the ONE sun through
                        `contact-shadow.ts` §`sunThrowPerMetre`, lying on the
                        landform TRIANGLE under its middle
                        (`groundUnderBlob`, the triangles the renderer draws;
                        where a hairpin's two sheets overlap, the one nearest
                        the caster's foot, and a middle thrown over the road
                        lies in the foot's plane rather than being dropped),
                        and clipped at the road's edge by two half-planes, one
                        per stretch of road in reach (`roadClip`; a third
                        folds into one of them). ⚠️ **What gates the clip is
                        two things, and the unit test alone is not one of
                        them**: `ground-blob.test.ts` holds `roadClip`'s
                        planes through `keptByRoadClip`, a TypeScript twin of
                        the GLSL; the SHIPPED shader is held by
                        `game.browser.spec.ts` §"#620", which forces a plane
                        through a blob's middle in the harness and reads one
                        half dark and the other not, with a no-op control
                        (`game-harness.ts` §`groundBlobClip`). #686's review
                        inverted the shader's offset and dropped its planes
                        with every gate green before that. `three-renderer.ts` §`GroundBlobBelt` draws
                        them: ONE draw call, two triangles a blob, no texture,
                        no shadow state, realistic rungs only, at most
                        `realistic-budget.ts` §`REALISTIC_GROUND_BLOBS` (62) —
                        counted in the frame's triangles. ⚠️ **A blob is
                        blended over the ENCODED pixel** (three tone-maps and
                        encodes inside each material's shader), so its 0.3
                        takes 0.3 off the displayed ground, and the browser
                        gate holds that from both sides. ⚠️ The furthest tree
                        with a blob FADES it toward the next tree back: #617's
                        hand-over measured it popping on in one frame
    src/game/terrain.ts the road as geometry (#91), and since #242 as a road: two
                        edge lines and a broken centre line built into the same
                        vertex buffer, and a surface tinted by signed gradient.
                        The dash grid is in ROUTE distance, which is what stops
                        it varying with a route's own grid or crawling as the
                        rider moves. ⚠️ Since #323 a centreline point's
                        POSITION is interpolated between two route samples
                        rather than rounded to the nearer — it used to freeze
                        the whole world for a grid cell and then jump one — and
                        the phase correction that rounding needed is gone with
                        it. A reviewer who remembers `writeCentreLine` carrying
                        one is reading the old file. ⚠️ Since #543 the road is
                        DRAWN rather than traced: a point is the exact mean of
                        the route over 10 m either side, and from 60 m behind
                        the rider to 150 m ahead the corridor steps every ~2 m
                        rather than every grid point, because a planner's GPX
                        turns 25° to 45° a sample and drew as straights meeting
                        at corners. A point's route distance, height and
                        gradient are still the centreline's; how far the
                        corridor reaches is still the grid's, which is why the
                        arrangement digest did not move; and the ground beside
                        it has ~2.8× the rows, which is why `landform.ts`
                        §`foldReach` reads its fold per pair of rows rather
                        than per row: the rows are no longer evenly spaced.
                        `unsmoothed` is the control. ⚠️ **Since #583 `x` is
                        WEST** (`localGroundPosition`): north `+z`, up `+y`,
                        east `−x`, which is what a right-handed renderer needs
                        for a map to be drawn as a map rather than its mirror.
                        Anything written in the compass follows the projection
                        — `world.ts`'s sun negates its east component, and is
                        named 225° where it was 135°: the same light, which
                        under the mirror stood in the south-west — and
                        nothing measured along the road can move, because none
                        of it is read off `x`
    src/game/world.ts   the ground, the sky and the depth cue (#241), and since
                        #286 the one light direction — the two axes a route is
                        read on, the one number that is physics rather than
                        choice, the sun's elevation band and the intensity that
                        is solved rather than written down, and the provenance
                        of every other one. Pure, so the renderer stays the
                        only file that names three
    src/game/scatter.ts where the scenery goes, what kind it is and — since
                        #367 — which of that kind's shapes it wears (#243) — a
                        seeded, stateless hash of where you are rather than a
                        walk forward, the three places a route is read as, the
                        verge that keeps a tree out of the carriageway, and the
                        budget that thins the far view instead of truncating
                        it. ⚠️ It PLACES and draws nothing; #244 draws it, so
                        SceneFrame.scatter ships unread until then. ⚠️ Since
                        #351 the density of the FOREGROUND is a measured
                        property rather than a taste — #348 tuned four of these
                        constants in one change and emptied the world, and
                        every gate here stayed green, so scatter.test.ts §"#351"
                        counts what stands in the nearest 60 m. ⚠️ Since
                        #341 NOTHING here changed and that is the point: the
                        models replaced the shapes only, and
                        arrangement-unchanged.test.ts pins a route's whole
                        arrangement to a digest taken on main before the swap.
                        ⚠️ **#348 is the one change that moved that digest on
                        purpose**, and a reviewer who reads the line above as
                        "the arrangement never changes" is reading it too
                        strongly: the grid doubled to 20 m, a band became a
                        DEPTH rather than also a position along the road, the
                        verge went back to 6 m, and a clustering field leaves
                        stretches of road bare. The budget did not move and
                        must not. ⚠️ **#583 kept that digest by MIRRORING
                        THE TEST FIXTURE**, and a reviewer who reads that as
                        "a real route draws as it did" is reading it too
                        strongly: the world stopped being a mirror of its
                        map, so on a real route scenery keeps its screen side
                        while every bend turns the other way, the
                        inside-of-bend limits land on the other side, and the
                        owner's routes do not look identical — the fixture
                        left bending east gives 6 954 natural items where
                        main gave 6 952. Since #348 the file also caps how far
                        scenery may stand from a BENDING road — without it a
                        band this deep folds through the inside of a hairpin
                        and stands in the carriageway, which the committed
                        code did at radii under about 12 m. ⚠️ Since #353 the
                        band is 15 m rather than 25 m, and the measurement that
                        change produced is the one to read before tuning
                        anything here: SCATTER_BAND_METRES moves scenery
                        SIDEWAYS and moves no density figure at all — supply a
                        frame, frames over budget, items in the nearest 60 m
                        and the digest's 1 120 distinct places are identical at
                        band depths of 25, 22, 20, 18, 16, 15, 14 and 12. #353's
                        own body predicts the opposite. Density lives in
                        SCATTER_CELL_METRES and the clustering pair, and
                        MINIMUM_SCATTER_SEPARATION_METRES followed the band
                        down from 2 m to 1.3 m because it is a measurement of
                        the layout rather than a setting. ⚠️ **Since #355 the
                        verge is 3 m rather than 6 m, and the reason is the
                        one thing four passes of tuning never computed**: a
                        perspective cone has an apex, so an item at the verge
                        is off the side of the frame until
                        `(ROAD_WIDTH_METRES / 2 + SCATTER_VERGE_METRES) /
                        spread − CAMERA_BEHIND_METRES` metres ahead of the
                        rider. SCATTER_VERGE_METRES is therefore a
                        VISIBILITY constant as well as a placement one, and
                        three-renderer.test.ts §"the verge and the camera
                        cone" is the gate rather than the note. ⚠️ **Every
                        figure that used to follow that formula here — +1.26 m
                        at a 6 m verge, −1.67 m at 3 m — was taken through a
                        camera #424 replaced**; it is +0.72 m now, on purpose,
                        and `camera.ts` argues it. Each floor in that gate is
                        held from BOTH sides — the shipped verge must clear it
                        and the 6 m one must not, through today's camera — so
                        it cannot be re-pinned to a new constant. ⚠️ #355's
                        own arithmetic OVERSTATES the effect and the file says
                        so: 13.7 items stood in the first 25 m and 9.3 of them
                        were already in frame, so this moved 9.3 to 10.6 and
                        did not fill a bare near field
    src/game/scenery-models.ts
                        which files each kind's shapes come from (#341, #367) —
                        the five ADR 0022 D-3 gives a model, the sixth it leaves
                        alone, the budget on how many shapes a kind may have,
                        and the one rule that says what a model may fetch.
                        ⚠️ **The "geometry and nothing else" note is GONE and a
                        reviewer who remembers it is reading the old file**:
                        since #366 each vertex carries the colour its own model
                        gives it, so `LIT_COLOURS` is no longer a complete
                        statement of the palette and `scenery-palette.ts` is
                        what replaces that claim. ⚠️ Since #366 the
                        resource rule is a REDIRECTION rather than a refusal —
                        the buildings' atlas is committed and every answer the
                        rule gives is a URL of ours, which is a stronger
                        statement than the identity-only one it made before.
                        ⚠️ **Since ADR 0026 (#431) the world goes realistic,
                        and a reviewer who remembers "the geometry is bought
                        and nothing else" or "one CC0 source, one house style"
                        as the rule is reading the old file.** What this file
                        maps is the STYLISED world, which is kept — the low
                        rung, the default and the precached world — and a
                        realistic world of textured, physically based assets
                        is built beside it, a rung a rider chooses (ADR 0026
                        D-3). No rung mixes the two. The engine, this renderer
                        and every placement decision are unchanged
    src/game/scenery-palette.ts
                        what colour the scenery is, now that the models decide
                        (#366) — the linear space a `baseColorFactor` is
                        already in, the rule for sampling an atlas and the
                        orientation trap inside it, the ceiling a pack's own
                        colour is brought under because there is nobody to ask
                        for a darker one, and `SCENERY_PALETTE`: the enumeration
                        that REPLACES `LIT_COLOURS`' completeness claim.
                        ⚠️ Here rather than in `three-renderer.ts` because that
                        file must never name a sun constant, and the ceiling is
                        derived from `world.ts`'s peak irradiance.
                        `model-bytes-testing.ts` beside it is the INDEPENDENT
                        glTF and PNG reader the gate reproduces that table with
                        — the same argument `identity-verifier.test.ts` makes
    src/game/models/    the committed .glb files — Kenney CC0, upstream bytes,
                        one ASSETS.toml row each (ADR 0022 D-5). ⚠️ **"Kenney
                        CC0, upstream bytes" describes the STYLISED world only
                        since ADR 0026 (#431)**, and a reviewer who remembers it
                        as the rule for every model is reading the old file: a
                        realistic asset comes from ADR 0026 D-4's source list
                        and is DERIVED — reproducible from a recorded input by a
                        committed headless-Blender script (#430), never
                        committed verbatim at source resolution, and none may be
                        committed until #430 teaches ASSET005 the keys that
                        record it. ⚠️ The first
                        binaries in this repository that anything SHIPS, so
                        they land under apps/ and could not land under
                        packages/: ASSET004 admits CC0-1.0 under apps/ only.
                        ⚠️ Since #357 it admits CC-BY-4.0 there too
                        (ADR 0023) — but only with creator, url and modified
                        recorded, because that obligation is continuing and a
                        row alone does not discharge it. Nothing here is CC-BY
                        yet, and ADR 0023 D-7 says the credits screen (#358)
                        lands before anything is
    src/game/three-seam.test.ts
                        what keeps that true, and which illumination classes the
                        scene is allowed. ⚠️ It matches a capitalised `Light`
                        ANYWHERE in the file, prose included, so a helper called
                        `tonedForLight` is a red test — which is why
                        `scenery-palette.ts` calls it `tonedForTheSun` — a grep over apps/ and packages/
                        rather than a review note (#240's epic criterion).
                        ⚠️ Since #286 it allows EXACTLY an AmbientLight and a
                        DirectionalLight; until then it allowed none at all, and
                        a reviewer who remembers "keeps the scene unlit" is
                        reading the old file
    src/game/pacer-choice.ts
                        the rider's pacer choice, turned into a plan or into a
                        refusal (#237) — the one place in the client a
                        BotPacerPlan is built, and therefore the only place the
                        rider's own mass could get into one
    src/game/tree-levels.ts
                        the realistic trees' three levels of detail (#617) —
                        full, middle and impostor by RANK, both tree kinds
                        ranked together, and at each hand-over one tree drawn
                        at both levels with a screen-space dither whose fade is
                        continuous across a swap of ranks. ⚠️ **Since #617 the
                        trees are not in `REALISTIC_NEAR_MESHES`**, and a
                        reviewer who remembers "the nearest 3 broadleaf and 3
                        conifer" is reading the old file:
                        `realistic-budget.ts` §`REALISTIC_TREE_LEVELS` is the
                        count, and the arithmetic for why it is not per kind.
                        The middle GLBs carry no image and wear the near file's
                        materials, paired by name (`three-renderer.ts`
                        §`prepareMiddleLevel`). ⚠️ **Since #639 a tree is ONE
                        material a level**, and a reviewer who remembers a call
                        per scan material is reading the old file: the scan's
                        materials are LAYERS of it (`mergeShapeMaterials`), a
                        byte a vertex says which, the texture transforms are
                        baked into the coordinates, and no committed file
                        moved — so the wooded view is 27 calls, not 37, over
                        the same triangles and the same pixels
                        (`realistic-budget.ts` §`REALISTIC_WOODED_DRAW_CALLS`,
                        whose browser-gate control loads the world unmerged,
                        and which the owner's page at `at=2550` is held to
                        as well). ⚠️ Since #617's review only
                        trees the CAMERA can see are ranked
                        (`three-renderer.ts` §`treeCanBeSeen`) — a tree behind
                        the camera used to take the one full slot — and
                        `TreeHandOver` paces each tree's move between levels
                        inside the same slots, because a swap of ranks is
                        continuous and the ranked SET changing is not; the
                        cases it still cannot hold are in its comment
    src/game/realistic-*.ts
                        the realistic world (ADR 0026, #425, #474, #369) — its
                        asset table, its D-6 budget (re-set from validation
                        0002 Part Z's soak by #475; every figure stood), and
                        the arithmetic that makes its sky and sun one sky —
                        and since #622 its air: the fog leaning towards the
                        sky in the direction looked, a valley haze, and why
                        there is no grade.
                        ⚠️ **Since #618 its textures stay compressed on the
                        GPU** (ADR 0026 D-8's 2026-09-27 amendment): KTX2,
                        transcoded by three's `KTX2Loader` to ETC2 and ASTC on
                        the tablet, and the budget's texture estimate prices
                        them so — 59.3 MiB where RGBA8 was 136, the sky 40 of
                        it. A reviewer who remembers "every texture decoded to
                        RGBA8" is reading the old file. The
                        renderer half is in `three-renderer.ts` (D-10).
                        ⚠️ **Since #475 a rider CAN choose it**, and a reviewer
                        who remembers "NOT OFFERED to a rider" is reading the
                        old file: `world-preference.ts` is the device's choice,
                        OFF by default everywhere (D-3), set by Settings'
                        Game world switch and read by `GameView.tsx` when a ride
                        starts. `realistic-offered.test.ts` now fails the build
                        if any OTHER module the product ships names a way in.
                        ⚠️ **Since #623 the realistic rider is DRESSED, and a
                        reviewer who remembers a body "coloured by dominant
                        bone" under a sphere cap is reading the old file**: the
                        On Your Left house kit, drawn by
                        `tools/realistic/blender/process_rider.py` from the
                        numbers in `rider_kit.py` (dedicated CC0-1.0, no text,
                        no mark but the two chevrons `tools/icons/` draws —
                        the app's icons until #965, not its mark since), MakeHuman's CC0 skin detail and brows
                        (ADR 0026's 2026-09-28 amendment: MakeHuman's own
                        system assets pack IS the D-4 MakeHuman row; the
                        site's community packs are not), an athletic build
                        from MakeHuman's own targets, a baked normal map with
                        procedural creases (no cloth simulation), and a
                        modelled helmet and glasses — all inside the old
                        8 998 triangles. ⚠️ The jersey's main colour is in NO
                        map: `orm`'s blue channel is its share, premultiplied,
                        and the renderer ADDS `share × ` the body's own kit
                        colour, from `three-renderer.ts` §`RIDER_KITS`: the
                        rider's is `bicycle.ts` §`HOUSE_KIT`'s jersey — the
                        app's `accent` in BOTH worlds since #623 — and the
                        pacer's and the ghost's is `PACER_KIT`'s blue. ⚠️ The
                        #368 tint MULTIPLIES the kit a kind wears, and orange
                        over teal was near-black with green leading red while
                        every gate stayed green (#742's review): the stylised
                        belt writes the kit per INSTANCE over vertices marked
                        `oylKit`, at no draw call. Multiplying a white shade by
                        a 0/1 mask instead drew a pale halo on every hem; do
                        not go back to it
    src/game/gradient.ts
                        the gradient control loop (#362) — where #90's driver
                        meets a real trainer, and the answer to "the game
                        computed a hill and never told the machine". ⚠️ Both
                        halves it composes live in `packages/` and had **no
                        caller under `apps/`** for four milestones; a whole ride
                        on Android produced 252 inbound notifications and zero
                        writes. It owns the three things neither package can: a
                        refused write restarts the driver, ending a ride
                        releases the trainer, and a refusal becomes a sentence.
                        ⚠️ **The release is an FTMS Stop through the ride
                        controller's ONE release, and on the one trainer
                        measured it does NOT remove the grade — nor did the
                        Reset PR #442 tried** (#372, §4h). ⚠️ It sends the **grade and nothing
                        else** — the rider's wind is out of scope and their drag
                        area would double-count against the game's own physics
    src/game/trainer-port.ts
                        what the game may ask of a trainer, and the five things
                        it is told when it may not (#362). ⚠️ A `*-port.ts` on
                        purpose: the seam is threaded through JSX, which §4j's
                        own §Limits say the gate cannot follow, so the suffix
                        buys the one rule that looks at the interface instead.
                        The control is handed over **only** in the `ready`
                        state, which is what makes "a machine that does not
                        offer simulation mode is not written to" a property of
                        the construction rather than of a guard. ⚠️ **The fifth
                        state is `workout`, and it is a SAFETY state rather than
                        a fifth flavour of "not available"**: there is one
                        control point on the machine and a running workout owns
                        it, `RideSession` is mounted above the router so
                        `workoutTick` keeps driving ERG targets while the rider
                        is in the game, and the game's own release is an FTMS
                        **Stop** — after which the machine ignores setpoints
                        until it is started again, so ending a game ride would
                        have left the workout's clock running against a machine
                        that had stopped listening while every target reported
                        success. `ride/controller.ts` §`simulationControl`
                        refuses the handle and this supplies the sentence
    src/game/rider.ts   what the rider and their bicycle weigh together, what
                        air they ride through, and — since #365 — **how much of
                        it they are pushing**. ⚠️ `RideConditions.coefficients`
                        was `undefined` on every ride, so everybody was
                        simulated as Martin's track racer: 150 W gave 20.1 mph
                        on the flat against about 17.8 for a rider on the hoods.
                        The three positions and the game's own `C_RR` are here
                        and the drag area is set through `withDragArea`, never
                        by editing one factor. ⚠️ **`packages/physics` keeps
                        Martin's and must** — it reproduces its source paper and
                        `martin-1998.test.ts` rests on it. ⚠️ **Since #325 it exports a
                        FUNCTION and no `RIDER_MASS_KILOGRAMS`** — the mass is
                        the athlete's own now, so a reviewer who remembers a
                        constant to assert the bot's 75 kg against is reading
                        the old file; `rider.test.ts` §"#325 criterion 4"
                        asserts the bot is unmoved across two rider masses
                        instead, which is the same claim without the
                        coincidence. The bicycle is added
                        here and nowhere else, and the air is still a
                        placeholder: there is no altitude in the store at all
                        yet. ⚠️ It carries NO headwind and must not: since
                        #326 the wind is a vector on `SimulationSetup`, resolved
                        per step, because a headwind is not "everything about
                        the ride that does not change from tick to tick" — the
                        rider turns
    src/game/wind-choice.ts
                        the rider's wind, typed in and turned into a `Wind` or
                        into a refusal (#326) — and the answer to that issue's
                        fifth criterion, which is that the source is
                        **rider-entered**. Anything external is #248 and is not
                        attempted here. ⚠️ **It is the ONLY place a wind is
                        chosen**: #335 settled that it cannot be changed
                        mid-ride, and `simulation.ts` §`SimulationSetup.wind`
                        is where that is written down
    src/game/hud/       the ride HUD (#94) — and since #396/#397 its ONE live
                        region: `announce.ts` is the pure core (one sentence per
                        window, priority by ORDER never by politeness, lower
                        items dropped not queued, no clock, no speechSynthesis —
                        all lint-enforced) and `announce-preference.ts` keeps
                        the rider's choice on the DEVICE, off by default. The
                        eight fields, the dropped
                        sensor that is not a zero, and the wake lock. ⚠️ Since
                        #423 it is an OVERLAY: four small OPAQUE panels over a
                        full-bleed world, in two tiers — power, cadence and
                        heart rate large, everything else smaller
                        (`fields.ts` §`ReadingTier`, which is about SIZE and
                        says nothing about what is spoken; that is #395). The
                        panels stay opaque because a translucent one has no
                        fixed colour to check contrast against, and changing
                        that is an ADR, not a CSS edit; and since
                        #285 the route in plan with the rider on it — north-up,
                        one path per unbroken run, and the wrapped fraction
                        that keeps a rider on lap two off the finish line.
                        ⚠️ It needs NO basemap and issues no request: it is a
                        projection of `RouteProfile.positions`, which the game
                        already holds. ⚠️ **Since #287 the elevation strip
                        shares that wrapped fraction** — it used to clamp, and
                        a reviewer who remembers the two deliberately
                        disagreeing is reading the old file. ⚠️ **Since #335
                        there are NINE fields on a ride the rider set a wind
                        for and eight on one they did not** — the wind reading
                        is last and absent rather than nought in still air, on
                        the `NO_READING` precedent, and "nine" is safe only
                        because the wind cannot change mid-ride
    src/game/audio-cues.ts
                        the ride's non-speech sounds (#400) — every rule about
                        them, against `audio-port.ts`: off by default, audio
                        resumed only inside a press, a dropped power reading is
                        SILENCE and never a floor tone, the mute silences at the
                        port rather than at a flag, and a short sound plays only
                        with its sentence. `web-audio.ts` is the one file that
                        names `AudioContext`; `SoundControls.tsx` is the mute and
                        the volume a rider reaches DURING a ride (WCAG 2.2 SC
                        1.4.2). ⚠️ No dependency and no speech engine, and
                        nothing claims a sound beats the screen
    src/game/hud/climb-ahead.ts
                        a climb or a descent ahead (#399), read off
                        `RouteProfile.grades` with no new engine, from
                        `plan.ts` §`planProgress`'s WRAPPED position — so lap
                        two's climb is announced and lap one's is not
    src/game/landform.ts
                        the ground beside the road (#458) — built from the SAME
                        centreline and normals as the road, so its innermost
                        column IS the road's edge (no crack at distance 0 or
                        across a loop's wrap); the road's own height plus a
                        seeded, stateless lateral profile and a cross-slope that
                        follows the gradient, so a climb is a hillside; the three
                        rules that keep it out of the carriageway (the clear
                        band, the fold on a bend, the clearance from any other
                        stretch of road); and the hills on the horizon. ⚠️ **It
                        replaced a flat quad the renderer drew at the rider's
                        height, and a reviewer who remembers
                        `GROUND_RADIUS_METRES` is reading the old file.** The
                        ground is LIT and WRITES DEPTH since #458;
                        `three-renderer.ts` §`TerrainBelt` says why both.
                        ⚠️ Since #469 its four arrays — and `waterways.ts`'s
                        surface — are LENT: the next build writes over them,
                        the renderer throws on a stale one, and a test or
                        harness that holds two frames takes
                        `frame-testing.ts` §`retainedFrame` first. Comparing
                        two frames' arrays without it compares one array
                        with itself and passes
    src/game/waterways.ts
                        water and bridges (#459) — a stream at every valley
                        floor of the route's own elevation, a lake beside a
                        long level stretch the road climbs out of, the channel
                        and lake beds the landform is cut to, what the scenery
                        may not stand on, and the bridge's parapets, slab and
                        abutments. ⚠️ The deck is the ROAD, unchanged, and the
                        grade a trainer is sent there is the route's — a test
                        rides the gradient session across it. No culverts and
                        no tunnels, and the file says why
    src/game/settlements.ts
                        places, not houses (#460) — villages and farmsteads on
                        level, low, dry stretches of the route, each building
                        facing the road at one setback; five kinds of building
                        (a house from the pack, and a barn, a church, a row of
                        shops and a shed built from numbers in `buildings.ts`
                        and painted by `three-renderer.ts` §`STRUCTURE_STYLE`);
                        walls, hedges and fences along the fields; blank
                        signposts. ⚠️
                        **`building` is not a scatter kind since #460**, and a
                        reviewer who remembers six `SCATTER_KINDS` is reading
                        the old file: `StructureKind` and `SCENERY_KINDS` are in
                        `scatter.ts`, and the frame carries the structures FIRST
                        on a budget of their own (`QualitySettings.structureItems`)
    src/game/buildings.ts
                        the buildings as SHAPES (#500) — walls with their doors
                        and windows cut in, recessed and framed, eaves that
                        overhang, a ridge, a plinth, a house's chimney, and two
                        proportions a kind; pure, and naming no rendering
                        library. ⚠️ **Both worlds draw its SAME triangles**, the
                        stylised painting each role and the realistic dressing
                        it (`realistic-assets.ts` §`REALISTIC_BUILDING_SURFACES`),
                        which is what keeps "a realistic structure is no heavier
                        than the stylised one" true; and every vertex stays in
                        `settlements.ts` §`STRUCTURE_FOOTPRINTS`, which is why
                        the arrangement digest did not move. Which shape a
                        building wears is its seeded `variant`, so windows
                        cannot vary house by house beyond that: every house of
                        a shape is one instanced mesh. The realistic HOUSE is
                        this file's too; the stylised one is still Kenney's
    src/game/billboards.ts
                        the game's billboards (#966) — at a boundary between
                        two settlement sites, never on a bend's inside (the
                        outside, or none where the bend is tight), held off
                        every stretch of the road by `settlements.ts`
                        §`footprintClearance`, clear of every structure, and
                        COUNTED in the structures budget (`scene.ts`). Not a
                        structure kind, so the arrangement digest did not
                        move. `logo-board.ts` is the board itself — the same
                        shape on every gate's beam, the start's and, since
                        #978, the finish's (`carriesTheLogo`) — and
                        `three-renderer.ts` §`LogoBelt` draws every board in a
                        frame in ONE call, in both worlds. ⚠️ Since #966 the
                        stylised world draws the gantries too (unlettered:
                        their banner atlas would be a second texture), and
                        NOT the "to go" board before a line, which unlettered
                        would be a bare post
    src/game/seeded.ts  the hash every seeded, stateless placement draws from —
                        moved out of `scatter.ts` by #458, unchanged to the bit
    src/game/instance-tint.ts
                        the realistic world's seeded per-instance tint (#621) —
                        hue, saturation and brightness drawn from `seeded.ts`,
                        keyed by where an item stands, bounded HERE because
                        `SCENERY_PALETTE` does not cover the realistic path
                        (ADR 0026 D-10), and carried as ONE float in the
                        instance colour's third channel. ⚠️ A tree's first two
                        channels are its #617 hand-over keep, so
                        `three-renderer.ts` §`withInstanceChannels` takes
                        three's own tint by the instance colour out of every
                        realistic material; the stylised belt allocates no
                        instance colour at all
    src/game/road-wear.ts, ground-blend.ts, foliage-light.ts
                        the realistic world's surfaces (#870: #628, #627, #630)
                        — where the road is worn and by how much (every colour
                        term clamped to 0.04, solved from the 3.889 : 1 the
                        road reads with the wear off, with 0.01 left for the
                        wheel track's specular term, to keep 3.5 : 1 — ⚠️ the
                        first cut solved 0.06 from a stale 3.97, whose worst
                        case was 3.449, #879's review), which surface the
                        ground is by verge, slope
                        and tree line, and the far band's light and the
                        foliage's breeze. ⚠️ **The breeze is VISUAL and reads
                        no rider's wind** (#326), runs on the ride's clock, and
                        grows the near-plane cull by its reach (`near-field.ts`
                        §`nearPyramid`'s `grow`); the `?realistic&trees` load
                        measures in still air (`foliageStillOf`)
    src/game/gantry.ts, gantry-wording.ts, banner-atlas.ts
                        the start and finish gantries (#679) — at the lines and
                        nowhere else (`SceneFrame.lines` is empty away from
                        one), every word in ONE module, lettered at load from
                        the map's own `0-255.pbf`: no font, no binary and no
                        ASSETS.toml row of their own. ⚠️ A distance on a
                        board is `units/format.ts`', never typed. ⚠️ Every
                        barrier piece stands on the DRAWN road at its own
                        route distance (`PlacedStand.boxes`), never along the
                        line's tangent, which on a 60 m circuit put one on the
                        centre line (#879's review); a banner that cannot be
                        lettered costs the banners, never the realistic world
                        (`three-renderer.ts` §`bannersOf`)
    src/game/route-fixtures-testing.ts
                        routes built from arithmetic for the landform, the water
                        and the settlements to be asserted over — a hill, a
                        valley, a hairpin, a circuit. Test support, never shipped
    src/game/sensors.ts the four metric states the ride controller reports,
                        mapped to the three things a HUD renders
    src/game/ghost-source.ts
                        which attempt a rider races, and how a ghost's distance
                        is integrated when no distance channel exists
    src/game/ghost-outcome.ts
                        how the race against that attempt ended (#259) — the
                        one answer in game/ that is LATCHED rather than derived
                        from the current state, why re-deriving it congratulates
                        a slower rider who keeps pedalling, and the one case it
                        gets wrong with the bound on it. `GameView` holds the
                        single frame of memory and clears it in `start`
```
