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
                        (`src/node-listener.ts`), run as TypeScript by Node 24
                        with no build step (`node src/main.ts`). It answers
                        `/health`, `/source` (AGPL-3.0 §13, ADR 0036 D-6),
                        `/openapi.json` and `/licences/third-party.txt` on a
                        running box; everything else in its route table —
                        identity (#855) and sync (#881) — answers
                        `unavailable` there (below). ⚠️ A reviewer who
                        remembers "and nothing else yet" is reading the old
                        file. ⚠️ **One third-party runtime dependency since
                        #769, `kysely`** (ADR 0037 D-9's row): its notices
                        document says so and `check:notices` holds it. Since
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
                        log line through `log.ts` §`redacted`. Behind a
                        proxy the sign-in rate limits read the client's
                        address from `OYL_INSTANCE_CLIENT_ADDRESS_HEADER`
                        (`cf-connecting-ip` behind the tunnel), and only
                        when the operator sets it. `src/operator/` is the operator's CLI
                        (migrate, backup, restore, verify, room-open);
                        `deploy/home/` is #807's compose file and #52's
                        `deploy.sh`; `tools/tunnel-soak.ts` is #807's tunnel
                        measurement. Since #881 it also holds `src/sync/` —
                        ingestion of a signed record and its original file
                        (#37), the athlete's own rides, detail and streams
                        (#38, never a position), the sync manifest, items and
                        tombstones (#776), and account export and deletion
                        (#35) — and migration 0009, served only by a handler
                        HANDED a `sync`, which `src/instance.ts` does not yet
                        (it hands the accounts, and no sync), so every
                        sync route answers `unavailable` on a running box.
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
                        is the committed list the table is held to, and a
                        test world's `call` seals a marked route itself.
                        Since #1095 `src/analysis/jobs.ts` is the job
                        engine (migration 0019, sealed-only routes, an SSE
                        stream with `Last-Event-ID` resume and a heartbeat
                        on injected timers); docs/architecture.md
                        §"Analysis jobs — #1095" says what it keeps.
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
                        closure (`kysely`, `ws`, three workspace packages)
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
                        PRIVATE group ride or race on the creator's own route
                        (its GPX, relayed by content hash; no field makes a
                        room public — public rooms wait for #907, #910, #911),
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

```
