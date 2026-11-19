# The instance server and rooms

Part of the agent instructions. The root [`CLAUDE.md`](../../CLAUDE.md) is the index; this file
carries the `apps/instance` part of the §2 layout tree, moved out of it verbatim on 2026-10-05 so that it is read when it is needed
rather than loaded into every session. **Read it when you work in `apps/instance` — the server, its store, identity, sync, the history index, the room core and its adapters, or a rider's rooms.**

It has the same authority as the root file. Where the text below says "this file" or
"CLAUDE.md", it means the root index and the files under `docs/agents/` together; a bare
"§4c" is found through the topic map in the root.

---

From the layout tree of CLAUDE.md §2, under `apps/`:

```
  instance/           the self-hostable instance server (#767, ADR 0036, ADR 0037)
                        — one fetch-style handler (`Request → Response`,
                        `src/handler.ts`) behind a thin `node:http` listener
                        (`src/node-listener.ts`), run as TypeScript by Node 26
                        with no build step (`node src/main.ts`). It answers
                        `/health`, `/source` (AGPL-3.0 §13, ADR 0036 D-6),
                        `/openapi.json` and `/licences/third-party.txt` on a
                        running box; everything else in its route table —
                        identity (#855) and sync (#881) — answers
                        `unavailable` there (below). ⚠️ A reviewer who
                        remembers "and nothing else yet" is reading the old
                        file. ⚠️ **Its third-party runtime closure is
                        `kysely` (#769), `ws` (#780) and, since #1096, the
                        AI SDK (`ai`, `@ai-sdk/openai-compatible`)**, each
                        with an ADR 0037 D-9 row: its notices document says
                        so and `check:notices` holds it. A reviewer who
                        remembers "one, `kysely`" is reading the old file.
                        `src/analysis/` is the post-ride agent (#1096,
                        #1098): `model.ts` the ONE module that names the
                        SDK (static or `import()`, `eslint.config.js`),
                        `agent.ts` the tool-calling loop, `tools/` its
                        read-only tools. Since
                        #842 it also holds `src/store/` — the `SqlStore` port
                        over SQLite (`node:sqlite` through Kysely, with a
                        forty-line adapter because Kysely reads NO rows from
                        `node:sqlite` as it is), migrations each with a tested
                        `down` (five since #881 — count
                        `src/store/migrations/`, this line has said three and
                        four), and a round-trip harness — and
                        `src/blob/`, content-addressed blobs on local disk,
                        in memory, or in an S3-compatible bucket. Since #855
                        it also holds `src/auth/` — identity (#772, #773,
                        #774): device-key challenge–response, sessions stored
                        as SHA-256, room tickets (the room core's `Admit`),
                        link codes, recovery codes, optional email recovery,
                        display names and the ONE public projection of an
                        athlete — and migration 0004. ⚠️ **Since #780 the
                        entry point OPENS the store** — a reviewer who
                        remembers every identity route answering
                        `unavailable` on a running instance is reading the
                        old file: `main.ts` registers a resolve hook
                        (`src/node-imports.ts`) and imports `serve.ts`, which
                        starts `src/instance.ts` — the store opened and NEVER
                        migrated (the deploy runs `node src/operator/cli.ts
                        migrate` first; an un-migrated database is refused,
                        naming it, and one being migrated waits with
                        `/ready` 503), the accounts on it when
                        `OYL_INSTANCE_ORIGIN` is set, and the room router.
                        `/ready` and `/metrics` (operator-enabled, and
                        only for a request carrying
                        `OYL_INSTANCE_METRICS_TOKEN`) since #791, and every
                        log line through `log.ts` §`redacted`. Since
                        #907 it also serves `/report`, the notice page —
                        the instance's first HTML (`src/html.ts`: no
                        script, a CSP, everything escaped) for anybody
                        with no account, migration 0026's append-only
                        `notice` table, and `GET /v1/moderation/notices`;
                        `moderation/notices.ts` says what it keeps. Since
                        #1381 a notice's notifier details are erased six
                        months after its decision (twelve after receipt
                        with none recorded, #1923), on the hour
                        (`moderation/notice-retention.ts`, migration
                        0036: the ONE update the `notice` table allows).
                        Since #910 a suspension or a hidden name needs a
                        statement of reasons (migration 0027, append-only,
                        `moderation/statements.ts`), and `GET
                        /v1/statements` is the THIRD route a way-out
                        session reaches; since #911 an appeal against a
                        statement (migration 0028, decided once) is the
                        FOURTH. Since #912 a notice's steps are recorded
                        beside it (migration 0029, append-only), and
                        `moderation/record.ts` is the export. Since #913
                        one item (a room, its route, a row of a result) is
                        hidden alone (migration 0030, `hideItem`), and
                        `rooms/rooms.ts`'s join, route and results reads
                        each ask `listHiddenItemsOfRoom`. Since
                        #909 `/terms` serves the operator's own terms file
                        (`src/terms.ts`, never a default), named by date in
                        `GET /instance`. Behind a
                        proxy the sign-in rate limits read the client's
                        address from `OYL_INSTANCE_CLIENT_ADDRESS_HEADER`
                        (`cf-connecting-ip` behind the tunnel), and only
                        when the operator sets it. `src/operator/` is the operator's CLI
                        (migrate, backup, restore, verify, room-open);
                        `deploy/home/` is #807's compose file and #52's
                        `deploy.sh`; `tools/tunnel-soak.ts` is #807's tunnel
                        measurement, and `tools/replan-round-trip.ts` #1235's
                        (an analysis job timed start to decrypted result;
                        spike 0023). Since #881 it also holds `src/sync/` —
                        ingestion of a signed record and its original file
                        (#37), the athlete's own rides, detail and streams
                        (#38, never a position), the sync manifest, items and
                        tombstones (#776), and account export and deletion
                        (#35) — and migration 0009, served by a handler
                        HANDED a `sync`, which `src/instance.ts` does since
                        #1195 — ONLY on an instance holding keys, because
                        every sync route is sealed-only (ADR 0047 D-7) and a
                        keyless instance seals nothing; there every sync route
                        still answers `unavailable`. Its files go under the
                        blob directory's `objects/`, which `backup` copies.
                        Every sync route declares `reaches: 'own'` (#83's
                        choke point). ⚠️ It depends on `@onyourleft/fit`
                        (workspace, Apache-2.0) to decode the file it is sent
                        — the only way to know the bytes are an activity, and
                        where streams come from — so `packages/fit`'s XML
                        reader, which refuses a `<!DOCTYPE`, is on a
                        network-facing path for the first time
                        (`src/sync/ingest.test.ts` pins it there). Since
                        #835 it also holds `src/history/` — the history index
                        (ADR 0040): migration 0010's passages and unit
                        vectors, cut from synced write-ups, ride summaries,
                        goals, notes and documents (never a side-camera
                        report), embedded by a LOCAL Ollama (`truncate:
                        false`, the model's prefixes, `nomic-embed-text` by
                        default) and ranked by a dot product, and
                        `POST /v1/history/search`. ⚠️ The embedding address
                        is refused unless local, and every name is resolved
                        and checked on EVERY request (`address.ts`); a
                        refused or unset address turns the index off, never
                        the instance. `src/instance.ts` mounts it; sync does
                        not feed it yet (above). Since #1189 it also holds
                        `src/keys/` — the instance's Ed25519 identity key and
                        rotating X25519 encryption key (ADR 0047 D-4, D-5),
                        wrapped under `OYL_INSTANCE_SECRET_KEY` in migration
                        0015's table, `GET /v1/instance/keys`, and the
                        `instance-key` operator commands; no secret, no keys.
                        Since #1203 every pass that writes a key — the
                        instance's timer or an operator command — holds
                        migration 0016's key lease, and is refused `busy`
                        while another process does.
                        Since #1191 it also holds `src/sealed/` —
                        `POST /v1/sealed` (ADR 0047 D-8, D-9): opened, the
                        device signature checked under the SESSION's key,
                        120 s freshness, a durable replay record (migration
                        0017), and the inner request dispatched through the
                        same route table; a route marked `sealed: 'only'` is
                        reachable no other way. The envelope, AAD, padding
                        and framing are `packages/domain/src/sealed/`.
                        Since #1192 every ADR 0047 D-7 phase-1 route is
                        marked, and a plaintext request to one is
                        `sealed_required` on an instance that holds keys
                        (none: plaintext as before); `sealed/phase-one.ts`
                        and, since #1210, `sealed/phase-two.ts` (sign-in,
                        account, blocks, reports, room HTTP, session;
                        #1382 added statements, appeals and the in-room
                        report and host removal) are
                        the committed lists the table is held to, and a
                        test world's `call` seals a marked route itself.
                        Since #1095 `src/analysis/jobs.ts` is the job
                        engine (migration 0020, sealed-only routes, an SSE
                        stream with `Last-Event-ID` resume and a heartbeat
                        on injected timers); docs/architecture.md
                        §"Analysis jobs — #1095" says what it keeps.
                        Since #1229 a start may name the synced ride
                        (`rideId`, migration 0021, checked to be the
                        caller's), and the engine hands the agent the
                        history index — it was handed none before.
                        Since #1243 a second job type, a re-plan during
                        the ride (ADR 0048): `POST /v1/analysis/replans`,
                        told apart by `template_version` (`re-plan-1`),
                        its own input, template, tools and budgets in
                        `src/analysis/replan-*.ts`; it answers one
                        `Proposal` or none and writes nothing —
                        docs/architecture.md §"Re-plan jobs — #1243".
                        Since #2709 (ADR 0071) `src/analysis/tactics*.ts`:
                        `/v1/analysis/tactics/*`, sealed-only — a lap
                        race's bot moves from the LOCAL model only, under
                        the rider's consent naming its address (migration
                        0046), no tools, `think: false`; and the model slot:
                        while it is held the job worker claims re-plans
                        only, so write-ups wait — docs/architecture.md §"Bot-tactics
                        decisions and the model slot — #2709".
                        Since #2836 (ADR 0081) a decision is for ONE bot,
                        picked from the menu its ask carries (`tactics-8`,
                        the reason word first), 90 a minute, and each
                        writes one `tactics-call` log line of figures.
                        Since #2712 (ADR 0072) `POST /v1/analysis/pacer/decide`
                        (`tactics.ts` §`pace`, `pacer-prompt.ts`): the AI
                        pacer's plan, intent and one screened line, under
                        the same consent, slot and gates — docs/architecture.md
                        §"AI-pacer decisions — #2712".
                        Since #1251 `src/analysis/hosted-test.ts` is the
                        test question: `POST /v1/analysis/hosted/test`,
                        sealed-only, two fixed sentences on the rider's own
                        key through `source.ts` §`modelForSource` — the
                        gate a job passes — answering a closed word and
                        never the service's own.
                        Since #68 it also holds `src/segments/` —
                        segments published to the instance (named by a
                        digest of their definition, `@onyourleft/domain`
                        §`publishedSegmentId`), the efforts riders share on
                        them, and instance-scoped leaderboards, sealed-only
                        (ADR 0047's amendment of 2026-11-05), with migration
                        0038's `segment`, `segment_effort` and
                        `activity_record.visibility`. ⚠️ A board is the one
                        read across athletes' efforts, and it applies the
                        choke point's rule IN SQL (`sql-store.ts`
                        §`seenBy`), held to `canSee` pair by pair in
                        `segments/leaderboard.test.ts`;
                        docs/architecture.md §"Segments and leaderboards
                        (#68)" says what it keeps. Since #69 an impossible
                        implied speed is excluded when shared and a rider
                        with an effort there may flag (migration 0039's
                        `segment_flag`, and `segment_integrity_log`,
                        append-only by trigger, `down` refused while it holds
                        an entry); docs/leaderboard-integrity.md states the
                        rule and its measured detection. Since #2602
                        `src/operate/` is the owner-only Operate area's
                        server half: `reaches: 'owner'` (the owner's key,
                        NOT the deputy's; checked in the handler,
                        `unavailable` with no secret key), migration 0040's
                        append-only `operator_log`, and THE store function
                        `recordOperatorAction` — change and entry in one
                        transaction, the change on a store bound to it, its
                        calls' own transactions savepoints. The CLI's state
                        changes log through it too (`source: 'cli'`, no
                        athlete). docs/operating-an-instance.md §"The
                        Operate area". Since #2641 `src/admin/` is the
                        instance's own admin pages (ADR 0069), mounted only
                        with `OYL_INSTANCE_ADMIN_PAGES=on`: a one-time code
                        from `operator admin-code`, the `__Host-oyl-admin`
                        cookie session (migration 0044), CSRF, and
                        `admin/headers.ts` — answered BEFORE the route table,
                        never with the CORS `*`. ⚠️ The ONE cookie the
                        instance reads, and no route reads it. It reaches a
                        route only in-process as the owner, through
                        `handler.ts` §`dispatchAsOwner`, and only one whose
                        `admin` mark is `read` or `change`.
                        Since #2642 the owner's passkeys too (migration
                        0045, `admin/webauthn.ts` by hand against WebCrypto
                        over the bounded `admin/cbor.ts`): a code session
                        enrols one; every change needs a step-up bound to
                        its action and fields (`admin/step-up.ts`) by a
                        passkey `operator admin-passkeys confirm` confirmed.
                        Since #2643 a second Node listener on
                        `OYL_INSTANCE_ADMIN_LOOPBACK_PORT` serves `/admin`
                        alone, marking `ClientInfo.listener: 'loopback'`
                        itself (never a header); its origin, cookie, RP ID
                        and log source are its own. ⚠️ It grants nothing
                        the tunnel does not: Docker Desktop lets the tunnel
                        container reach it.
                        Since #2645 the pages: the shell (`admin/pages.ts`),
                        Status and the operator log, each the route's answer
                        through that seam and never a store read, answered
                        from `admin/admin-routes.ts` — which
                        `admin/pages.test.ts` (headers, CSRF, no session) and
                        the web a11y gate both read, so a new page is held to
                        them by being added. Status' words are
                        `packages/operate-text`'s, which the image now copies.
                        Since #2648 the AI backend page CHANGES things: a
                        `POST`/`DELETE` through the seam reaches only a route
                        marked `admin: 'change'` (the three analysis
                        changes), after a step-up, and the seam sets
                        `RouteContext.adminChannel`, from which the route
                        logs `admin_tunnel` or `admin_loopback`, never `app`.
                        Since #2646 Accounts reaches ADR 0069 D-9's three
                        moderation routes too (the queue, approve, refuse):
                        the only non-owner routes with an `admin` marker,
                        and a decision through them writes its moderation
                        log row with `registration_decided` in ONE operator
                        log transaction (`moderation.ts` §`act`'s channel).
                        Since #2647 Backups' "back up now" is the fourth
                        `'change'` route; `operate.requestBackup` takes the
                        `OperateOwner`, so its entry names the channel.
                        Since #2649 Rooms' End room too (`endRoom` takes
                        the `OperateOwner`); the room id is a form field,
                        shape-checked before it goes in `{roomId}`.
                        Since #2650 Keys reads `operate.keysView` itself
                        (`GET /v1/operate/keys` stays `never`) and hands
                        the card to the renderer on the LOOPBACK place only.
                        Since #2651 Recent problems draws `GET
                        /v1/operate/logs` as given, escaped, with no
                        redaction of its own and no second source.
                        Since #2783 `admin/qr.ts` draws the card and a
                        claim or invite code as one SVG QR (`uqr`, ADR
                        0037's 2026-11-18 row) and `pages.ts`
                        §`cardCodePart` the line beside it, for ADR 0080's
                        loopback `/setup` steps (#2784 mounts them); its
                        tests read the drawing back with `jsqr`.
                        Since #2784 `src/setup/setup.ts` is ADR 0080's
                        first-run setup at `/setup` on the LOOPBACK
                        listener, with the admin pages off too: the handler
                        asks it only for `ClientInfo.listener: 'loopback'`,
                        and it answers `undefined` (so `not_found`) once
                        migration 0048's `setup_state` says done — read per
                        request. Its own cookie, CSRF and code limiter;
                        changes log from the source `setup`. ⚠️ The
                        registration mode is now `identity.registrationMode()`
                        (the database's over `.env`'s), never
                        `config.registration`, wherever a rider meets it.
                        ⚠️ Only `src/store/` may
                        import the driver or Kysely (`eslint.config.js`).
                        ⚠️ It must not depend on `apps/web` or
                        `apps/mobile` (`boundaries/dependencies`), and nothing
                        in the client may import it: the client reaches an
                        instance over the network, through ONE module (#777,
                        ADR 0036 D-3.a). The route table (`src/routes.ts`) is
                        what the handler dispatches on AND what
                        `openapi.json` is generated from (#36). `Dockerfile`
                        is the first deploy target — built from the
                        REPOSITORY ROOT since #780, cut to an allowlist by
                        `Dockerfile.dockerignore`, with the production
                        closure (`kysely`, `ws`, the AI SDK, and five
                        workspace packages — `packages/fit` since #1195)
                        installed from the lockfile;
                        `scripts/check-instance-image.sh` builds it, runs the
                        migrate step in it, and asks `/health` inside the
                        container and `/ready` from outside
    src/room/core/      the room core (#779): one room as a deterministic
                        state machine — hello, capacity (50, up to 100),
                        countdown, a 1 Hz tick that re-simulates every rider
                        through `@onyourleft/physics`' `advanceRider` and
                        `ridingConditions`, coasting at 0 W, rejoin inside a
                        window, finish order — with NO socket, timer or clock:
                        time is a parameter to every method. ⚠️ Platform-free
                        by `tsconfig.room-core.json` (ES2024, no `types`) and
                        an `eslint.config.js` block that also bans `Date`, the
                        timers, `performance`, `Math.random` and `ws`.
                        `clock.ts` maps a client's `atMs` onto the room's
                        clock, because the two are never the same clock.
                        ⚠️ **A race names its riders and sends standings
                        since #1347** (ADR 0051, protocol 2): `name` once a
                        seat, from the admission's public name, and after
                        every frame `standings` with the ROOM's time gap to
                        each recipient and live W/kg; a group ride neither.
                        ⚠️ **And drafts since #787** (ADR 0038 D-4): every
                        `k` from the distances the room holds, before the
                        tick re-simulates; a room's maker may turn it off
                        (migration 0024), and off is `k = 1` for everybody.
                        ⚠️ **And runs a lap race with items since #1909**
                        (ADR 0060, protocol 3): settings' `lapRace` (laps,
                        items, the room's own seed) runs `@onyourleft/domain`'s
                        `stepRace` each tick from the room's effort distances
                        and the riders' `lane` and `item-use` INPUTS (one use a
                        tick, never queued); frames carry each rider's offset,
                        lane, held item and laps and the tick's item events.
                        A frame's `decimetres` stays the EFFORT distance.
                        `lap-race-conformance.test.ts` holds both adapters to it.
                        Since #1910 a rider makes one, private, on their own
                        loop (`rooms/rooms.ts` §`lapRace`): migration 0037's
                        `room_course.lap_laps`, `lap_items` and `lap_seed`
                        (drawn from the CSPRNG, never sent), read by `planFor`.
                        ⚠️ **Mounted by two adapters since #780**, and a
                        reviewer who remembers "not by the instance" is
                        reading the old file: the Node adapter
                        (`src/room/node/`, below) serves it, and #781's
                        Durable Object runs it under `workerd` in tests only.
                        Its workspace dependencies' extensionless imports load
                        under `node src/main.ts` through `src/node-imports.ts`
    src/room/node/      the Node adapter (#780, ADR 0037 D-2's first): the
                        router (`router.ts`) forks one room worker per core,
                        places every socket of one room on one worker and
                        hands it over as a handle (keeping an unread copy, so
                        a dead worker's rooms are closed `1011 room-lost`);
                        `room-host.ts` mounts the core on `ws` sockets in a
                        worker — a hello's ticket looked up once in the HTTP
                        process's book, backpressure (a client past 256 KiB
                        unsent is let go), a 25 s protocol ping for the
                        tunnel, results written as each becomes final, and
                        `permessage-deflate` OFF unless the operator sets
                        `OYL_INSTANCE_WS_COMPRESSION=on` (Q16). ⚠️ The router
                        stops the HTTP process READING a socket with the
                        handle's own `readStop`: `pause()` alone let it read
                        the hello the worker then never saw (`router.ts`
                        §`stopReading`). `close-codes.ts` beside it is both
                        adapters' close codes (1001, 1008, 1011, 4001–4008)
    src/room/durable-object/
                        the room core as a Cloudflare Durable Object (#781,
                        ADR 0037 D-2's second adapter), BUILT AND NOT DEPLOYED
                        (the owner's Q3/Q6): one object per room, every socket
                        through the Hibernation API with its connection in
                        its attachment, the 1 Hz tick as a storage alarm that
                        is not re-set once the room leaves countdown/running
                        (so an emptied room stops billing), and a lobby
                        restored after eviction by REPLAYING a log of the
                        core's own calls — with the admission's recorded
                        answers, so a ticket is verified once per hello and
                        never again. ⚠️ A room evicted after it left the lobby
                        is not restored: it refuses its sockets `room-closed`.
                        ⚠️ Platform-free by `tsconfig.durable-object.json`
                        (ES2024, no `types`) and an eslint block; what it
                        needs of the runtime is ports in `platform.ts`, not
                        `@cloudflare/workers-types`. ⚠️ **No production
                        Worker entry**: which room an object serves and where
                        its course comes from are #790's.
                        `worker-under-test.ts` is the only thing `workerd`
                        loads, and only for `test:workerd` (§4a). Held to the
                        core by `src/room/conformance.test.ts` — one script,
                        every adapter, byte-identical text per socket; #780
                        adds itself to that file's `ADAPTERS`
    src/rooms/          a rider's room (#784, #785): `POST /v1/rooms` makes a
                        group ride or race on the creator's own route (its
                        GPX, relayed by content hash), PRIVATE unless
                        `visibility: public` (#788: operator's switch, #775's
                        eligibility, blocks, 3 a day; `GET /v1/rooms/public`
                        lists by start then made; `POST /v1/rooms/{roomId}/join`),
                        with a 75-bit code (`code.ts`) stored only as its
                        SHA-256; `POST /v1/rooms/join` (the code in a body,
                        rate-limited per athlete and per address, right or
                        wrong); members alone are ticketed and fetch the route;
                        a room that is over deletes its route from the blob
                        directory's `rooms/` (outside the synced files and a
                        backup). ⚠️ **"Over" is five things since #929's
                        review, all through ONE close** (`rooms.ts` §`over`):
                        a worker lets a finished race or an emptied group ride
                        go; the sweep (at open and every ten minutes) ends a
                        room nobody is riding a DAY after it was made, a
                        started race no worker holds, and a room whose creator
                        is gone; and `DELETE /v1/account` ends the rider's own
                        rooms before their rows go. A reviewer who remembers
                        "a room nobody rides is never over" is reading the old
                        file. ⚠️ A result is read only once the room said the
                        race is over (`room_course.race_finished_at`, ADR 0028
                        D-7.7), never while it runs. ⚠️ **A race's result is published by ONE
                        function**, `publication.ts` §`publishRace` — W/kg,
                        never watts; flags by duration, on the W/kg side; an
                        erased rider or one the viewer may not see is "a
                        rider" — to the race's riders only. ⚠️ **Only a
                        room's CREATOR may start its race** (the owner's
                        ruling of 2026-09-30, reversing #785's "any rider
                        seated and connected"): the plan carries it
                        (`room/room-plan.ts` §`RaceStarter`) and
                        `room/node/room-host.ts` §`start` refuses anybody
                        else; an operator's `room open` room has no creator,
                        so any seated rider starts it. ⚠️ Results
                        are NOT signed by the instance (no ADR gives it a key);
                        `docs/architecture.md` §"A rider's room" says why.
                        Migration 0013 holds it, after #926's 0012
    src/voice/          a Discord voice channel per private room (#874,
                        spike 0017 option A): `discord.ts` the ONE module
                        that talks to Discord — REST over the platform's
                        `fetch`, no dependency, rate limits from the headers,
                        a `401` turns it off for good, an error kept by NAME
                        only — and `room-voice.ts` the channel, invite,
                        rotation and close, held in MEMORY only (no Discord
                        data at rest). Off unless the operator set
                        `OYL_INSTANCE_DISCORD_BOT_TOKEN_FILE` (a file, never
                        the token in the environment, #2146) and `…_GUILD_ID`;
                        `rooms.ts` §`over` deletes a room's channel, and the
                        room sweep deletes leftovers. Since #875 a rider's
                        PRIVATE room's link goes to its riders in the
                        welcome (protocol 4): `instance.ts`'s lookup asks
                        `inviteFor` for each socket, waiting at most 2 s,
                        and puts it in the plan; the worker sets it on the
                        core (`setVoiceInvite`), which says it in every
                        welcome and nowhere else. Never a public room.
                        Since #876 a removal from a room and a suspension
                        ROTATE the channel (`voice/voice-moderation.ts`),
                        after the action is logged and the rider's socket
                        closed: the riders who stay are told the new link
                        in a `voice` message (the router's
                        `setVoiceInvite`), the athlete it was about never,
                        and `rotate_voice` is appended to the log
                        (`SqlStore.logVoiceAction`). A linked rider's role
                        and disconnect wait for #877

```
