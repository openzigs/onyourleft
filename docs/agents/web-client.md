# The web client, directory by directory

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries the `apps/web` part of the §2 layout tree (everything but `src/game/`), moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you work anywhere in `apps/web` outside `src/game/` — the shell, design system, map, ride screen, recording, offline, privacy, the side camera (`src/camera/`), instance client, rooms, ride analysis, the browser harness pages, or the asset/brand/font tools.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

From the layout tree of CLAUDE.md §2, from `apps/` down to `apps/web/src/game/`:

```
apps/                 AGPL-3.0-or-later, without exception
  web/                browser client — the Phase 1 product (#48-#51)
    browser/            the browser gate (#63) — the one place a real browser runs;
                        a harness page driving the map adapter, and its Playwright
                        spec, and since #63's cold-load criterion the PMTiles
                        archive that page renders: built from arithmetic, emitted
                        at build time, never committed, and carrying no
                        OpenStreetMap data. See §4a and §4f. Since #111 it also holds
                        capture.html, which is NOT a gate: it is the tool a
                        person opens with a trainer in front of them, built by
                        the same second Vite config so it can never ship. Since
                        #63's hosted measurement it also holds hosted-archive.ts
                        — the opt-in archive on the real internet, the origins a
                        render may then reach, and where a ride goes inside
                        whatever coverage an archive declares. Since
                        #266 it also holds hud.html and hud-harness.tsx — the
                        ride HUD laid out at a phone's width, which is a gate,
                        and the one page here that renders React and measures a
                        box rather than reading back a pixel. Since #307's
                        review it also holds shell.html and shell-harness.tsx —
                        the app shell's own chrome at 320×256, the viewport
                        WCAG 2.2 SC 1.4.10 names, which is what closes this
                        repository's structural blindness to LAYOUT: jsdom
                        performs none and nothing here had ever laid out a
                        header. Since #316 that page also carries the button
                        specimens the touch-target measurement needs, because a
                        shell handed no ports renders no control at all. Since
                        #373 it also holds ride.html and ride-harness.tsx — the
                        ride screen's own layout in both orientations, which is
                        where the trainer status line is and where the
                        measurement that the HUD does not fit a landscape phone
                        came from. ⚠️ Since #423 that page RIDES: it starts a
                        ride through the real picker rather than re-typing
                        `GameView`'s markup, and what it measures is the stage
                        — every reading and control on screen with no
                        scrolling at nine viewports (eight until #512, which
                        added the short corners layout's tallest, 736×480), a
                        landscape tablet among them, which no gate had ever
                        measured. Since #422 it
                        also holds rideview.html and rideview-harness.tsx — the
                        Ride SCREEN at `#/`, which is a different route, where a
                        prose reading measure hid the workout below the fold.
                        ⚠️ Since #430/#425/#474/#369 it also holds realistic.html
                        and realistic-harness.ts — NOT a gate: the OWNER's page,
                        the one place ADR 0026 D-12 let the realistic world be
                        reached until #475 offered it in Settings, staged into
                        a local debug APK by `realistic:stage`. The gate is
                        game.html?realistic. Since #616 the page counts
                        triangles at the WebGL draw calls and takes
                        `?layers=-vegetation` and the like, and
                        realistic.browser.spec.ts (nightly since #866) is the gate on THOSE two
                        instruments only — the counter against three's own
                        `renderer.info`, and a control that must count 100 000
                        fewer. ⚠️ The layer switch changes nothing the product
                        ships: it wraps each belt class's `addTo` from the
                        harness (`browser/realistic/layers.ts`). Since #528 it also holds
                        sidecamera.html and sidecamera-harness.tsx — the
                        tripod phone's filming sign at a phone's size, driven
                        through the real shell with a scripted link, because
                        the real one (#529) does not exist yet. Since #660 it
                        also holds reflow.html and reflow-harness.tsx — the
                        real shell over EMPTY and POPULATED in-memory ports,
                        which `reflow.browser.spec.ts` walks route by route
                        from `ALL_ROUTES` (parameterised routes included) at
                        320×256, 390×844 and 844×390, failing any route whose
                        document scrolls sideways and any box that scrolls
                        sideways without being a focusable, named region.
                        Since #659 it also holds devices.html and
                        devices-harness.tsx — a new rider's walk from Home
                        to Devices to Pair, through the real shell, the
                        real ride controller and the real Web Bluetooth
                        transport over the scripted stack; its control is
                        the dead end #659 was filed against. Since #855 it
                        also holds identity.html and identity-harness.ts —
                        the app's own non-extractable device key signing in
                        to a REAL instance that `identity.browser.spec.ts`
                        runs in its own Node process (#772's cross-platform
                        criterion). ⚠️ The one place anything under
                        `apps/web` reaches `apps/instance`, and it is the
                        spec's NODE side, by a computed `import()` of the
                        instance's test support — never a page, never `src/`.
                        Since #782 `room.browser.spec.ts` is the second such
                        spec: it starts the production `startInstance`, a
                        room worker and one group-ride room from
                        `apps/instance/src/room/room-gate-testing.ts`, and two
                        browser contexts on `room.html` / `room-harness.ts`
                        each sign in and see the other move through the
                        production room port; its control is a third page with
                        fan-out switched off where the client meets it
    public/             what Vite copies verbatim into `dist` (#405) — the web app
                        manifest, the three icons it names and (since #965) the
                        favicon. A `.webmanifest` is on neither LIC001's nor
                        LIC002's extension list and a JSON document has nowhere
                        to put a header, so what records the icons is
                        `ASSETS.toml`. ⚠️ Since #965 the icons are the OWNER's
                        art, `CC-BY-4.0`, cut by `tools/brand/` — a reviewer who
                        remembers them `CC0-1.0` chevrons drawn by
                        `tools/icons/` is reading the old file (ADR 0024's
                        2026-10-01 amendment). ⚠️ Since #430 it also holds
                        `realistic/` — the realistic world's 17 files, 30.8 MiB,
                        CC0, made by `tools/realistic/`, in `dist` and so in the
                        APK, and excluded from the precache BY THAT DIRECTORY
                        (ADR 0026 D-7, and ADR 0024's 2026-09-22 amendment).
                        ⚠️ Since #530 it also holds `pose/` — the side
                        camera's pose model, Apache-2.0, excluded from the
                        precache by that directory too, with its runtime and
                        worker emitted beside it by `tools/pose/`. ⚠️ Since
                        #618 every realistic texture there but the sky is
                        KTX2 (Basis Universal) — no JPEG or PNG is left
    tools/basis/        the Basis Universal transcoder the realistic world's
                        KTX2 textures need, copied out of the pinned `three`
                        into `dist/realistic/basis/` — under the realistic
                        set's precache exclusion — never committed and never
                        from a CDN (#618); and the rewrite that takes
                        `KTX2Loader`'s own default URLs out of the build, which
                        would otherwise put a second copy in `assets/` and so
                        in the precache. ⚠️ Its licence is Apache-2.0 with a
                        BSD-3-Clause decoder inside, vendored in the MIT
                        `three` where `DEP001` cannot see it: the credits
                        screen and the third-party notices name it. ⚠️ Since
                        #597 it also holds `licences/Apache-2.0.txt` — a byte
                        copy of `LICENSES/Apache-2.0.txt`, which the credits
                        screen links from every Apache-2.0 credit (the map's
                        glyphs, the pose model) because §4(a) asks for the
                        text to travel with the work; `credits.test.ts` holds
                        the bytes equal
    tools/pose/         the pose model's WebAssembly runtime, copied out of
                        the pinned `@mediapipe/tasks-vision` into `dist/pose/`
                        and served from there in development (#530) — never
                        from a CDN, never committed
    tools/realistic/    the asset pipeline (#430, ADR 0026 D-5) — which upstream
                        pages were read and what they said, the input lock, the
                        headless-Blender scripts that made every derived file,
                        and `--check`, which re-makes them byte for byte. ⚠️ The
                        first `.py` in the tree, which is why LIC001/LIC002 scan
                        `.py` now. ⚠️ Blender is a TOOL: nothing in CI runs it,
                        and a version other than the pinned 4.4.3 is refused.
                        Since #624 it also DRAWS the realistic bicycle's four
                        maps from arithmetic (`draw-bicycle-maps.ts`, CC0-1.0,
                        nothing downloaded): no lock entry, and a drawn row's
                        `inputsha256` is the digest of the pixels drawn, which
                        `provenance.test.ts` redraws in CI. What each bicycle
                        part samples on them is `src/game/bicycle-surfaces.ts`
    tools/glyphs/       the map's label glyphs (#578) — a committed Roboto
                        v2.138, the LAST Apache-2.0 Roboto (v3 is OFL, which no
                        list here admits), and the reader, the signed-distance
                        rasteriser and the range-file writer that turn it into
                        `public/glyphs/Roboto-Regular/`. Plain arithmetic on the
                        pinned Node, so `generate-glyphs.test.ts` regenerates
                        every range byte for byte inside `pnpm run test`.
                        ⚠️ A newer Roboto is a licence change, not an upgrade
    tools/fonts/        the display face (#991, ADR 0043) — Barlow 1.408's two
                        upstream weights and its OFL.txt, committed as INPUTS;
                        `font-recipe.ts`, every pin; `subset-fonts.ts`
                        (`fonts:subset`), which runs a PINNED fontTools to write
                        the WOFF2 subsets into `src/design/fonts/`; and
                        `woff2.ts`, the reader `fonts.test.ts` holds each subset
                        with in CI, where there is no fontTools. ⚠️ The first
                        OFL-1.1 files here: `ASSET004` admits OFL for a FONT
                        FILE under `apps/` and nothing else
    tools/theme/        the plugin that writes `src/design/theme-selection.ts`'s
                        inline palette script into every page Vite builds —
                        product and harness — straight after the charset, so
                        the first frame is in the right palette (#672)
    tools/bundle/       two rules the product build checks about itself and
                        fails on (#673, #674): the Lucide icon modules in the
                        bundle are exactly the icons the source imports
                        (ADR 0034 D-2), and no view `shell/lazy/` names is in
                        the entry chunk's static graph
    tools/precache/     what the worker precaches, as a pure function over the
                        build's output (#406) — build-time code, so it lives
                        under `tools/` rather than in `src/`
    tools/icons/        two chevrons from arithmetic (#405) — since #965 NOT the
                        app's icons, only the mark the realistic rider's jersey
                        wears (#623), whose kit bytes depend on it.
                        Authoring-time code, the shape `packages/fit/tools`
                        has: in the typecheck, in the test run, and out of the
                        coverage report
    tools/brand/        the owner's brand art (#965): the three source pictures
                        (Google Gemini, `CC-BY-4.0`, credited to the owner),
                        `derive_brand.py` — which cuts every icon, the wordmark
                        and the logo out of them with pinned Pillow, NumPy and
                        SciPy and fetches nothing — and `brand.json`, its table.
                        `provenance.test.ts` holds `ASSETS.toml` to that table
                        and reads the pictures back (safe zones, cut-outs, no
                        green fringe, no tagline); CI cannot run the script, so
                        `--check` is run by hand (WebP logos by bytes, PNGs by
                        pixels with no rendering metadata, #1167; its tests are
                        `test_derive_brand.py`). `fixtures/` holds the WebP
                        reader's own pictures, made by `make_webp_fixtures.py`.
                        ⚠️ The full logo is the
                        owner's green-screen picture of 2026-10-01, cut by a
                        chroma key, with NO tagline; a reviewer who remembers
                        it cut from the v3 sheet by a rembg model is reading
                        the old file — rembg and its model are gone. ⚠️ Gemini
                        painted the "transparent" checkerboard INTO the sheets:
                        nothing in them is transparent. The name and the logo
                        are trademarks too: `TRADEMARKS.md`. ⚠️ The trainer
                        game's wordmark (#966) is NOT this pipeline's: it is
                        `game-wordmark.ts`, a Node script beside it with a
                        baseline JPEG decoder of this repository's own
                        (`jpeg-baseline.ts`), which keys the painted
                        checkerboard out of `gemini-assets-v2.jpeg` — the same
                        source picture, one `ASSETS.toml` row — and writes the
                        stylised world's PNG (`src/game/brand/`, precached);
                        `game-wordmark.test.ts` re-makes it pixel for pixel
                        inside `pnpm run test`, so unlike `derive_brand.py` it
                        IS checked in CI. The realistic world's KTX2 is the
                        same pixels, made by `tools/realistic/`'s `wordmark`
                        recipe because only that pipeline writes
                        `public/realistic/`
    src/brand/          the wordmark (header) and the full logo (About), each in
                        a light- and a dark-palette picture switched by
                        `data-theme`; the pictures are `alt=""` and the words are
                        a visually hidden span, so no name is lost with the
                        hidden one (#965)
    src/a11y/           the accessibility gate: rules, routes, contrast (#48) — see §4e
    src/athlete/        what the rider weighs (#325) — the one place a missing
                        mass is substituted, the one place a typed weight
                        becomes a kilogram, and the narrow write that puts it on
                        the athlete row. ⚠️ The mass here is the ATHLETE's; the
                        bicycle is added by `game/rider.ts` and only there,
                        because `RideConditions.totalMass` is both of them.
                        Since #623 also `kit-colour-port.ts`, the write of the
                        rider's kit colour — a KEY into `game/bicycle.ts`
                        §`KIT_PALETTE`, stored on the athlete row
    src/analysis/       zones and duration personal bests (#78) — the port, the one
                        place a threshold default is substituted, the bounded
                        library read, and the wording
    src/credits/        the in-app attribution, GENERATED from `ASSETS.toml` (#358)
                        — the reader for the manifest's own TOML subset, second
                        after the one in `check-repo-rules.sh` and written from
                        the same list of refusals; which entries are credited
                        because a licence asks and which as a courtesy; and the
                        one line that inlines the manifest at build time, so
                        there is no generated file to drift. ⚠️ For a
                        `CC-BY-4.0` asset this screen IS the obligation
                        (ADR 0023 D-3) — since #965 the owner's brand art is
                        the first in the tree — and a
                        screen rendering nothing would look correct, so
                        `CreditsView.test.tsx` renders a fixture manifest for
                        exactly that reason. Since #664 it also lists the
                        SOFTWARE the app includes, read from the contents of
                        the third-party notices `check:notices` generates and
                        gates (§4g), and links the full document
    src/design/         design tokens, theme.css and the primitives (#48), and since
                        #307 the two systems those tokens now form — the elevation
                        ramp, which is a surface COLOUR because a shadow is invisible
                        to every gate here, and the type scale's ratio. A new token
                        needs four things, not one: a value, a contrast pair with its
                        measured margin, a level if it is a surface, and a rule that
                        actually paints with it. Since #316 `.oyl-button` DECLARES its
                        touch target rather than arriving at one: the height used to
                        be a by-product of two spacing tokens, a type token and a
                        border, landing 0.8 px clear of 44 — see §4f. Since #660
                        `ScrollTable.tsx` is the only way a table is rendered: a
                        focusable, named region the table scrolls inside, so a
                        phone's PAGE never scrolls sideways (SC 1.4.10). Since
                        #669 `ride-time-controls.ts` names the controls a rider
                        presses DURING a ride, which wear `.oyl-button--ride`
                        (48 px, the owner's ruling) where every other button
                        keeps 44 — `ride-targets.browser.spec.ts` walks the list.
                        ⚠️ Since #672 there are TWO palettes: `tokens.ts`
                        §`DARK_COLOUR_TOKENS` (every name but the HUD's, which
                        is theme-independent) and `theme.css`'s
                        `:root[data-theme='dark']` block, every contrast pair
                        measured in both (`measured` is `{ light, dark }`), and
                        elevation going LIGHTER in dark. `theme-selection.ts`
                        picks one before the first paint — its inline script is
                        written into every page by `tools/theme/` — from
                        Settings' choice in `localStorage`, and ⚠️ since #992 a
                        device that has chosen nothing is DARK (the owner's
                        ruling): *Match this device* is a stored word now, and
                        every browser-gate context starts with it stored
                        (`playwright.config.ts` §`FOLLOW_THE_DEVICE`). A colour
                        drawn over the world or a camera picture (the stage, the
                        pairing code) uses a HUD token so it does not flip, and
                        the HUD keeps the LIGHT palette whatever the page is in:
                        `theme.css` §`.oyl-hud` restates every page colour token
                        at its light value, for the controls and notices inside it.
                        Since #936 the menus' house style is tokens: five `illo*`
                        colours (decoration: what is drawn OVER one declares a
                        pair, and the focus ring is paired with each), a
                        `display` type step, and `--oyl-motion-*` — no duration
                        literal above 200 ms anywhere in `theme.css`, and Motion
                        (ADR 0041, installed by #945) reads the same values from
                        `tokens.ts` §`MOTION_FOR_SCRIPT`. `shell.html?illustration=
                        specimens` paints them until a screen does.
                        ⚠️ Since #950 (ADR 0042) there is a CSS framework and a
                        headless primitive, and a reviewer who remembers "no CSS
                        framework and no component library" is reading the old
                        file: `tailwind.css` is Tailwind v4 with its own theme
                        CLEARED and rebuilt from the tokens (`var(--oyl-…)`
                        only), every utility prefixed `tw:`, no preflight, and
                        loaded AFTER `theme.css` everywhere, unlayered;
                        `a11y/tailwind.a11y.test.ts` compiles what the source
                        writes and fails a literal colour, an arbitrary `[…]`,
                        an opacity modifier, a duration other than the motion
                        tokens, a class that generates nothing, and an ink on a
                        surface that is not a declared pair. `StatusMessage` and
                        `ScrollTable` are drawn with utilities; `Button`, the
                        segmented control and the native controls stay in
                        `theme.css` (ADR 0042 D-8 says why). `ConfirmDialog.tsx`
                        is Radix's AlertDialog — `aria-modal`, focus trapped,
                        focus handed back — and never on a ride-time screen;
                        no `@radix-ui/` module may be in the entry chunk
                        (`tools/bundle/entry-graph.ts` §`LAZY_ONLY_PACKAGES`).
                        ⚠️ Since #992 (Phase 1 of epic #935) cards and panels
                        are FILLED tiles — `surfaceRaised`, no outline,
                        `--oyl-radius-card` — every button but the new
                        `tertiary` (text) is filled, the secondary TONAL
                        (`surfaceOverlay`), every view's `h1` is the display
                        step at 800 in `--oyl-font-family-display` (the one
                        token ADR 0043's face replaces), and a menu's figures
                        go through `Reading.tsx`. `look.browser.spec.ts` reads
                        it back on every route
    src/design/illustration/
                        the menus' illustration kit (#938): `Sky`, `Hills`,
                        `RoadRibbon`, `RiderSilhouette` (`game/bicycle.ts`'s own
                        parts and leg solve, side on), `SensorGlyph`,
                        `ProfileShape` and `WorkoutShape`, each an
                        `<svg aria-hidden="true" focusable="false">` with no
                        text, painted only by `paint.ts`' classes (one table
                        with `theme.css` §`.oyl-illo__*`). ⚠️ `index.ts`
                        exports PARTS ONLY: `illustration.test.tsx` renders
                        every export and fails a colour literal, a `<title>`
                        or an unpainted shape, and the harness draws every
                        export for `shell.browser.spec.ts` §"#938" to read in
                        both palettes. The two data parts are bounded at
                        100 000 inputs, draw nothing for nothing, and keep a
                        gap; `WorkoutShape` renders no digit. No production
                        caller until #939–#943
    src/camera/side-report*.ts
                        the side camera's post-ride report (#388) — the pose
                        numbers of one session reduced to SENTENCES, first third
                        against last third, sagittal only, each worded
                        "possibly" and holding no number; every sentence in
                        `side-report-wording.ts`; which ride it is saved with.
                        ⚠️ Since #801 the DIFFERENCES the sentences were chosen
                        from are kept too, as `side-session-summary.ts`, made
                        in the same pass (`side-report.ts` §`sideSessionFrom`)
                        and absent — never zeros — when nothing was compared
                        ⚠️ `no-absolute-angles.test.ts` beside them is a gate
                        over ALL of `src/`: a degree sign, the word, a
                        `'degree'` formatter or a frontal-plane word in any
                        rendered string is a red build (ADR 0030 D-8). Since
                        #564 it matches with invisible characters removed
                        (soft hyphen, zero-width space/joiners, word joiner),
                        reads a JSX element's text WHOLE as well as node by
                        node, and narrows `inversion`, level shoulders and
                        lateral movement to a body; and every report sentence
                        is held under the store's `MAXIMUM_SIDE_REPORT_SENTENCE`
                        by a test, because one past it is refused on save and
                        the keeper drops the report without a word
    src/efforts/        the effort-history screen's reads and its stub (#67) — the
                        read budget, and where a sample index comes from
    src/detail/         the ride detail view's data layer (#50) — the read budget, the
                        gap-preserving downsampler, the SVG trace and the
                        privacy-zone trim that says what a shared copy contains;
                        and since #388 the ride's "Side camera" section — only
                        for a ride with a saved report, rendering only sentences
                        `camera/side-report-wording.ts` can produce, with an
                        explicit "nothing to show" and no control of any kind;
                        and since #805 a model's WRITE-UP of the ride
                        (`RideWriteUpSection.tsx`, `write-up.ts`), on EVERY
                        ride and below that section, never in place of it —
                        ADR 0035 D-9 A's framing above it, the text as ONE
                        React text node (never markup or a link), and a saved
                        row SCREENED AGAIN before a word is shown, because a
                        row can be hand-edited. ⚠️ A failed, cancelled or
                        withheld ask keeps the earlier write-up and says why
                        ABOVE it (the owner's ruling of 2026-09-29); with no
                        model set up it is one sentence and a link to Camera
    src/instance/       the client half of signing in to an instance (#772) and
                        of linking this device to an athlete (#773): the local
                        athlete first, then the device key, then challenge →
                        sign → session, and the instance's athlete id kept on
                        the device. ⚠️ It names NO `fetch` and nothing in the
                        shipped client calls it yet: its transport is a
                        parameter, and #777 is the one module allowed to call
                        an instance, after #778's disclosures. Since #881
                        (#776) it also holds `sync.ts`, two-way sync with an
                        instance, under the same rule (no `fetch`, nothing in
                        the shipped client calls it). ⚠️ **The device's change
                        wins**, and a reviewer who remembers "pull, then push
                        whatever differs" is reading #893's first draft, which
                        pulled back a ride deleted here and overwrote a
                        write-up replaced here: each copy is read against the
                        device's SYNC BASE (`packages/store` §`SyncBaseRecord`,
                        schema v14) — a synced ride missing here is deleted on
                        the instance, a local item change is pushed, and only
                        an item unchanged here whose instance copy moved is
                        pulled
    src/home/           where the app opens (#428) — one bounded store read
                        and no stream decode on every launch, the week and the
                        fitness line carried to today, and the empty state a
                        new rider sees first. ⚠️ `#/` is Home since #428 and
                        the Ride screen is `#/ride`. ⚠️ Since #1010 Home
                        leads with ONE "Next up" card (the last route
                        ridden, else a free ride, else the first ride) —
                        at most ONE `getRoute` beyond #428's read
                        (`home.ts` §`loadNextUp`), and it opens the game on
                        that route through `#/game?route=…`, the one query
                        this shell reads (`shell/routes.ts`
                        §`gameRouteFromHash`). "The last workout used" is
                        not offered: no ride records which workout it was.
                        ⚠️ **"One bounded store read" holds only up to 5,000
                        rides** (#1130), and a reviewer who remembers it on
                        every launch is reading the old file: past
                        `HISTORY_ACTIVITY_LIMIT` Home also walks every older
                        ride forward for the badges, at most
                        `PROGRESS_PAGE_LIMIT` (10) more reads of 5,000, and
                        then falls back to two windows (`home.ts`
                        §`loadHome`). Its cost on the tablet is unmeasured
                        (#1168)
    src/instance/       connecting this app to an instance (#777) — which
                        addresses it will talk to (`https:`, and `http:` only
                        to this machine's loopback, refused before any
                        request), the ONE module `no-network.test.ts` permits
                        for instance traffic (`instance-transport.ts`, one
                        `fetch` and, since #782, one `WebSocket` — a room's
                        socket, `instanceRoomSocket` — through it, never
                        beside it: ADR 0036 D-3), signing in with the device key
                        (#772's `sign-in.ts`), and `instance-port.ts`, whose
                        `createInstancePort` only `main.tsx` names, so
                        deleting that wiring is a red `check:wiring`. The
                        session token and the address are kept on the DEVICE,
                        not the athlete row (ADR 0020 D-2's question, answered
                        the other way in the port's header). The screen is
                        `views/InstanceView.tsx` at `#/settings/instance`
    src/net/            a race room, from the client's side (#782) —
                        `room-port.ts` (the port and `createRoomPort`, which
                        only `main.tsx` names), `room-session.ts` (the hello
                        and its single-use ticket, a power report every
                        500 ms that is also the keepalive — never a position
                        — and reconnecting by itself with a fresh ticket on a
                        bounded backoff, giving up inside the room's 60 s
                        rejoin window), `snapshots.ts` (other riders drawn
                        1.5 frames behind the room's clock, between the two
                        frames that bracket it, never past the newest),
                        `correction.ts` (the rider moved toward the room's
                        position over 2 s and NEVER backwards —
                        `game/simulation.ts` §`correctToward` — with the
                        trainer's grade walked at ≤ 1 %/s meanwhile,
                        `game/gradient.ts` §`sample`) and `interest.ts` (#783:
                        the nearest K = 50, up to 100, drawn, a rider leaving
                        only past K + 5, and no membership change within 2 s).
                        A joined room holds the ride controller's foreground
                        service (`ride/controller.ts` §`keepAliveForRoom`).
                        Since #784 and #785 `rooms-port.ts` too: make a
                        private room on a route of the rider's own, join one
                        by code (its route fetched by hash and CHECKED against
                        the room's `routeRef` before it is ridden), start a
                        race, read its result — through the one instance
                        module, like the rest
    src/rooms/          the game's side of a rider's room (#784, #785) —
                        `RoomPanel.tsx` on the picker (an instance and a
                        declared weight before anything is offered),
                        `share.ts` (a route with ANY of it in a privacy zone
                        is refused before a request is made; the GPX sent has
                        no name and no times, and every rider — the maker
                        too — rides the profile read back out of it),
                        `race-result.ts` + `RaceResult.tsx` (the room's own
                        order, only once the room says the race is over;
                        W/kg beside others, the rider's own watts on their
                        own line alone). ⚠️ A race's rider is HELD on the line
                        until the room's first frame
                        (`game/simulation.ts` §`holdAt`); *Start the race* is
                        a ride-time control (`design/ride-time-controls.ts`)
                        `testing.ts` plays a room by hand. ⚠️ Nothing in the
                        product supplies a room id yet: a room is entered by
                        its code, #784's. `game/room-ride.ts` is what the game
                        does with a room each frame; remote riders are
                        `RiderMarker` kind `remote`, instances of the rider's
                        own meshes, and the HUD shows a COUNT and ONE chosen
                        rider's gap — never a list (ADR 0021 D-6)
    src/progress/       streaks and badges (#947) — derived on the device from the ride
                        summaries Home already reads and each ride's `rideFacts`
                        (`packages/store` §`RideFacts`, written at save and import,
                        and by Home's *Look at older rides*). Nothing earned is
                        stored and nothing is synced; a recording under
                        `RIDE_MINIMUM_MOVING_SECONDS` of moving time is not a ride
    src/library/        the activity library's row model, its port and its stub (#62).
                        ⚠️ Since #1041 every ride is a CARD at every width
                        (`views/ActivitiesView.tsx` §`RideCard`) and #660's
                        `layout.ts` — table or cards by width — is gone: a
                        reviewer who remembers a table on a tablet is reading
                        the old file. A card draws NO shape, because no stored
                        summary carries a track or a profile and a card may not
                        read one
    src/map/            the ride map (#63) — the basemap configuration and the proof
                        it reaches no other origin, the GeoJSON conversion, the
                        once-per-application protocol registration, and the one
                        file that names MapLibre. Since #578 it labels places
                        and road names from glyphs the app ships, at a RELATIVE
                        `glyphs` URL so they add no origin. ⚠️ MapLibre (6.10,
                        and 6.11 since #756) draws text in the device's font
                        when a range cannot be fetched, so a label painting
                        proves nothing about the
                        glyphs — the browser gate asserts the requests. Since
                        #672 every colour the map paints is in `basemap.ts`
                        §`MAP_COLOURS`, one table per palette, CHECKED against
                        the palette tokens rather than derived from them (the
                        map is cartography: `map-colours.a11y.test.ts` holds
                        its background and land within one elevation step of
                        `canvas`, on the palette's side, and every
                        `MAP_CONTRAST_REQUIREMENTS` pair to its recorded
                        margin both ways). The dark style is BUILT by the same
                        `basemapStyle`, so `styleOrigins` is unchanged; and
                        `themed-map.ts` is the ONE watch per map
                        (`theme-selection.ts` §`watchDocumentTheme`, a
                        `MutationObserver` on `data-theme`) that repaints a
                        live map through `MapView.setStyle` when the page
                        changes palette, ended by the map's `destroy`
    src/recording/      the recorder: engine + durable checkpoints + recovery (#46),
                        and since #14's fourth criterion the step that turns a
                        finished recording into an activity — the write order,
                        and why the checkpoint is discarded last; and since #212
                        the rides this device is still holding — the two kinds
                        of leftover, and the one that is never offered back
    src/ride/           the live ride screen: its state machine, panels and trainer
                        wiring (#49), and since #14 the workout lifecycle — one
                        clock for the ride and the workout, and the panel that
                        will not offer a control the trainer would refuse.
                        ⚠️ Since #659 PAIRING IS ON DEVICES, not on Ride, and
                        a reviewer who remembers the Ride screen's four Pair
                        buttons is reading the old file: `SensorPairing.tsx`
                        §`PairingPanel` is that block moved, driving the same
                        controller, and Ride renders §`ConnectedSensors` —
                        each device's state in words and a link to Devices.
                        Its *Forget* is `SensorTransport.forget` (#659):
                        `BluetoothDevice.forget()` in a browser where it
                        exists, the transport's own record everywhere.
                        ⚠️ Forgetting a trainer this app controls RELEASES it
                        first, through `controller.ts` §`releaseTrainer`
                        (§4h, #372): a running workout ENDS, and a refused
                        Stop keeps the trainer paired and says so. `detach`
                        unsubscribes `onControlLost` before it closes the
                        client and `close()` writes nothing, so any path that
                        detaches a controlling trainer without releasing it
                        first skips the release in silence
    src/offline/        the service worker, whether it is registered at all, and
                        when a new one may take over
                        (#406, #407) — the one cache strategy, the four handlers
                        over an injected scope so they can be tested without a
                        browser, and ⚠️ the refusal to register inside the
                        Android shell (ADR 0024 D-4), where every asset is
                        already in the APK. The precache is DERIVED from the
                        build's own output and never written down: a new model
                        or a new lazy route is cached with no edit here, which
                        is #142's failure mode inverted. ⚠️ Two `@unwired` tags
                        live here and both are structural — a service worker is
                        a second entry point, so `check:wiring` cannot reach it
                        from `index.html`; what the prefix buys is that deleting
                        `main.tsx`'s registration call is a red build. Since
                        #407 it also holds the update path: no `skipWaiting()`
                        on install, an offer the rider acts on, one reload on
                        `controllerchange` — and ⚠️ the interlock that refuses
                        to activate while a ride is recording OR PAUSED, which
                        lives in the watcher rather than in the button, because
                        a refusal in a view is one `disabled` attribute away
                        from being no refusal at all. ⚠️ Since #483 there are
                        SIX rider-facing states rather than four, and the two
                        new ones are about the tab that did NOT ask: an
                        activation takes over every client of the registration,
                        so a tab left behind runs an old bundle under the new
                        worker's cache and any lazy chunk it has not loaded is
                        a URL nothing serves. It is told so
                        ([ADR 0027](docs/adr/0027-a-tab-left-behind-by-another-tabs-update.md)),
                        the repair is a rider's reload rather than an automatic
                        one — `controllerchange` cannot be the signal, because
                        it fires with nobody having asked on a first visit
                        (#467) — and the same interlock holds it back over a
                        ride that is recording OR PAUSED
    src/privacy/        the boundaries where data leaves the athlete's control
                        (#34) — the two directions a payload can face, the walk
                        that finds a coordinate in a field nobody declared, and
                        the registry checked against the files on disk; and
                        since #95 the one place the published privacy policy's
                        URL is written down, derived from its path rather than
                        typed beside it, because Play requires the listing and
                        the in-app link to be the same URL
    src/routes/         saved routes (#73) — the store port and its read budget,
                        the edit decision and its concurrency token, what a
                        shared copy of a route contains, the export a rider
                        copies to a head unit (#74), and since #296 the import
                        form — the one claim a rider makes about a file's shape,
                        why it is declared rather than inferred, and the
                        refusal when the geometry disagrees
    src/routing/        planning a route (#70, #71, #72) — the draft and the
                        legs an edit makes stale, undo over whole drafts, what
                        a half-drawn route keeps across a reload, the elevation
                        profile and where its numbers came from. ⚠️ The
                        RoutingProvider INTERFACE is in packages/domain; there
                        is no engine adapter here and §4i says why
    src/segments/       the segment store port and the create form's pure core (#64),
                        the resumable matcher sweep over the library (#66), and
                        since #282 the thing that actually runs it — when a sweep
                        runs and why that is a control rather than a save hook,
                        the two refusals, and the only production writer of the
                        match checkpoint; and since #294 the one sweep this tab
                        runs, which is module state because the state that has
                        to outlive the screen is not the screen's
    src/shell/          the hash route table, the router hook and AppShell (#48),
                        and since #427 the navigation: four groups recorded on
                        the route table itself (`routes.ts` §`NavGroupId`), a
                        bar on a compact window and a rail on a wider one, and
                        the icons — ⚠️ Lucide's since #673 (ADR 0034:
                        `lucide-react`, named imports only; a reviewer who
                        remembers "authored here as inline SVG, no icon set
                        is a dependency" is reading the old file); and since
                        #670 `ListDetail.tsx`, the list beside its detail on
                        Activities, Workouts and Routes — two panes from the
                        ONE breakpoint `theme.css` §`--oyl-list-detail-from`
                        declares, the selection in the URL
                        (`#/<list>/selected/<id>`, a route's `selection`), and
                        `hidden` on the pane not shown, never a style alone.
                        ⚠️ Every selection pushes a history entry at BOTH
                        widths, on purpose (`ListDetail.tsx` §History), and
                        the panes' skip link goes list → detail only, at two
                        panes only. ⚠️ Since #674 every view but Home and
                        the not-found page is LAZY: one module per navigation
                        group under `lazy/`, loaded with a literal `import()`
                        through `lazy-view.tsx` (a loading line under the
                        `h1`, and a Reload on a chunk that cannot be fetched),
                        preloaded by `main.tsx` once Home is idle. A view
                        imported by name from the entry's graph fails
                        `pnpm run build` (`tools/bundle/entry-graph.ts`), and
                        the jsdom `mount`/`settle` wait for the loads.
                        Since #946 `menu-sounds.ts` is the menus' sounds: every
                        press in the shell goes to it and it alone decides —
                        off by default (`oyl.menuSounds.v1`), never on a ride
                        route, while recording or paused, or while immersive.
                        ⚠️ Since #1072 `ListDetail.tsx` carries a card into its
                        detail with Motion (ADR 0041), reached only through
                        that lazily loaded chunk
    src/support/        browser-capability detection and its notice (#48), and
                        since #409 whether this browser may throw a rider's
                        history away — the one place `persist()` is asked for,
                        once per session, and the panel that says what
                        persistence does AND does not protect against, and
                        since #85 the one question that decides which BLE
                        transport this build uses (§4h), and since #284 the
                        OTHER answer that question decides — the Devices
                        screen's read of the Android plugin's own availability,
                        and the half of that wiring the #278 gate can see; and
                        since #322 the bound on that read — the fifth thing the
                        screen can say, which is the one the plugin cannot, why
                        a late answer still wins, and why the deadline that
                        matters is an event rather than a timer
    src/validation/     the recording BluetoothPort (#111) — the wrapper that turns
                        an afternoon with real hardware into committable evidence,
                        and the two things it deliberately does not write down
    src/transfer/       file import and export (#51) — the batch importer, the
                        1 Hz sample grid, the export writer, and since #231 the
                        distance an imported track derives from its own
                        positions when the file states none — the three
                        rejections and the anchor two of them need; and since
                        #232 whether a GPX looked like a course rather than a
                        ride — the rule, its failure modes, and the one action
                        that turns the file into a route without re-finding it;
                        and since #15 the
                        one fixture both clients encode, which is how "the
                        mobile client's FIT output is byte-identical to the
                        web's" is asserted without a phone (§4h); and since #35
                        the account export — every ride plus the manifest of
                        what an activity file cannot carry, the bound on one
                        run, and the key half that is never written; and the
                        erase that is its pair, whose two lists say what goes
                        and what it cannot reach
    src/ride-analysis/  what a model is sent about a saved ride (#809, epic
                        #795) — `input.ts`, a PURE function from a ride, its
                        streams, laps and route profile to at most eight
                        sections of numbers. ⚠️ No coordinate, no absolute
                        altitude, no date, name or id, and no string but the
                        template version and its own enumerations —
                        `input.test.ts` walks a built input for all of it. A
                        gap is coverage, never a zero; W/kg only with a real
                        mass; the pose summary only with camera consent and
                        never in a section. ⚠️ Called since #804 (below).
                        Since #811 `runner.ts` runs a template's steps through
                        `model-step-port.ts` — per-step and per-run time and
                        token budgets, one parse-repair re-ask, a failed
                        section LEFT OUT, the #798 screen and one rewrite —
                        and saves nothing: a caller keeps a write-up only on
                        `written`. Time is a `RunnerClock` it is handed.
                        ⚠️ Its two `@unwired` tags came off with #804 —
                        a reviewer who remembers them is reading the old
                        file. Since #802
                        `own-computer-step.ts` is the step port to the rider's
                        own computer: text only (a step with any other field,
                        a byte array or a `data:` URL is refused as
                        `not-numbers` before a byte is sent), `finish_reason`
                        read, the runner's signal handed to the request. It
                        sends through `camera/analysis-transport.ts`
                        §`riderModelStepPort`, which hands it the client's ONE
                        `fetch`; ⚠️ it is NOT in that module because that
                        module builds pictures and this one must reach none.
                        Since #804 `ride-analysis.ts` is the post-ride ASK
                        behind `ride-analysis-port.ts`: one press on a ride's
                        page (`RideWriteUpControl.tsx`, the only caller) reads
                        the ride, runs the agent through the step port
                        `main.tsx` builds with `riderModelStepSource`, and
                        saves ONLY a `ScreenedWriteUp`, replacing the ride's
                        write-up; any failure leaves the earlier one as it
                        was. The rider's own computer is offered first.
                        ⚠️ Since #803 there IS a hosted source — a reviewer
                        who remembers "no hosted STEP port until #803" is
                        reading the old file: `hosted-step.ts` sends each step
                        through `CameraController.askHostedModel`, which
                        checks the hosted consent on EVERY step, to
                        `camera/hosted-transport.ts`'s one `fetch`. Only a
                        step the runner SEALED is sent (`sealed-step.ts`: a
                        brand no literal satisfies, and a `WeakSet` checked
                        by identity at run time); `sealed-step.test.ts` fails
                        if any production module but `runner.ts` names
                        `sealStep`. No `response_format` hint goes to a hosted
                        service. ⚠️ The port is an
                        optional prop, so `ride-analysis-wiring.test.tsx`
                        drives the real shell at the detail route with it
                        built as `main.tsx` builds it. ⚠️ Since #805 the
                        control is RENDERED by `detail/RideWriteUpSection.tsx`
                        rather than straight by the page, keeps its ask
                        controls in the tab order (`aria-disabled`) while a
                        run goes, and says beside them what will be sent, in
                        ADR 0035 D-9 B's words, marked kept-visible. A port
                        remembers a server that refused the `response_format`
                        hint and stops offering it (#805, from #831's review)
    src/rider-text/     the rider's own text for the analysis agent's history
                        (#836, ADR 0040 D-1, D-11) — the goals box on Settings,
                        a ride's note on its page (`RiderTextBox.tsx`, one
                        control for both) and the documents list
                        (`DocumentsPanel.tsx`): kept on THIS device first, and
                        synced by `instance/sync.ts` rule 8 as `goal`, `note`
                        and `document` items, both ways of a deletion included.
                        A document is plain text or Markdown only, UTF-8 or
                        refused, and never a picture (`document-file.ts`).
                        ⚠️ `disclosure.ts` is ADR 0040 D-11's DRAFTED wording,
                        word for word, kept visible beside every box; the
                        privacy policy and Play Data Safety do NOT change yet,
                        because nothing in a shipped build syncs (no production
                        caller of `syncWithInstance` until #898/#892) — the
                        pull request that wires sync owes them
    src/units/          which units a rider reads in (#238) — the one place a
                        number becomes a unit, the context a component asks,
                        and the source scan that stops a future screen writing
                        a unit literal by hand. ⚠️ Since #325 it has a fourth
                        tier, the mass one ADR 0020 D-1 reserved and declined to
                        ship without a caller; adding a quantity to the switch
                        means adding its labels AND its factors to the scan, and
                        #325 is the first time that has actually been done
    src/views/          one component per route (#48)
    src/workout/        the workout control loop (#14) — the one place the
                        player's decisions meet a trainer's control point,
                        driven end to end against the #44 simulator; and
                        since #585 `rescue-text.ts`, the ONE sentence both
                        screens show and say while a stall rescue holds a
                        workout's target down. ⚠️ On a phone the game's
                        "Eased" notice takes the notice cell from the road
                        notice while the rescue holds (`GameView.tsx`
                        §`roadNotice`); `ride.html?rescue=floor` is the
                        browser gate that measures it
    src/workouts/       the workout library and builder (#14) — the read
                        budget, the row model that quotes no watts, the one
                        place a typed percentage becomes a share, and since
                        #202 saving one to a file and reading one back
```
