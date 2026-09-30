# Operating an instance

What a person running an On Your Left instance has after the deploy command
([#791](https://github.com/openzigs/onyourleft/issues/791)): how to see into it, how big a box it
needs, how to back it up and put it back, how to upgrade it, and what the operator owes the people
who use it. The first deployment — the owner's own Windows machine behind a Cloudflare Tunnel — has
its own guide, [`self-hosting/home-machine.md`](self-hosting/home-machine.md); everything here
applies to it and to any other box.

Every command below runs inside the instance's image. From the home deployment's directory
(`apps/instance/deploy/home`) that is `docker compose run --rm --no-deps --entrypoint node migrate
src/operator/cli.ts <command>`; on a clone with Node 24, it is `node src/operator/cli.ts <command>`
from `apps/instance`, with `OYL_INSTANCE_DATABASE` and `OYL_INSTANCE_BLOBS` pointing at the data.

## Is it up, and may riders be sent to it?

| Ask | Answers | Means |
|---|---|---|
| `GET /health` | `200 {"status":"ok",…}` | the process is answering. Liveness, and nothing more: the image's own `HEALTHCHECK` asks it |
| `GET /ready` | `200 {"status":"ready","checks":{…}}`, or `503` with the same body and `"not_ready"` | the database answers, its migrations are at the head this build expects, and every room worker is alive. **Room sockets are refused (`503`) until it is ready** — which is what a box coming back from a reboot, mid-migration, looks like |
| `GET /metrics` | Prometheus text, only with `OYL_INSTANCE_METRICS=on` | see below |

The `checks` say which of the three failed: `"database": false`, `"migrations": "migrating"`
(the migrate step is running — wait), `"behind"` or `"ahead"` (see [Upgrading](#upgrading)), or
`"rooms": false` (a room worker died; the instance starts a new one by itself and says so in its
log as `room-worker-died`).

## Metrics

`OYL_INSTANCE_METRICS=on` serves `GET /metrics`, and **only to a request carrying
`OYL_INSTANCE_METRICS_TOKEN`** as `Authorization: Bearer <token>` (32 characters or more —
`openssl rand -hex 32`; the instance refuses to start with metrics on and no token). Any other
request gets `404`, as if metrics were off. It names no rider, but it is not for the public: scrape
it from the box with the token, and keep the token in the box's `.env` beside the tunnel's.

| Metric | What to watch |
|---|---|
| `oyl_room_tick_lateness_ms{worker,quantile="0.99"}` | **the first thing to go when a box is full** — spike 0013 §4 measured tick lateness p99 as what failed at saturation. A room ticks once a second; a p99 heading towards hundreds of milliseconds is a box that needs fewer rooms or more cores |
| `oyl_room_connected_riders{worker}`, `oyl_rooms{worker}` | how many riders and rooms each room worker holds |
| `oyl_room_worker_resident_bytes{worker}` | memory per worker — see [Sizing](#sizing) for what it should be |
| `oyl_room_refusals_total{worker,reason}` | sockets refused or let go: `ticket-refused`, `room-full`, `room-closed`, `too-slow` (a client that stopped reading) … the reasons are [the close codes](#room-close-codes) |
| `oyl_http_requests_total{route,status}`, `oyl_http_refusals_total{route,reason}` | requests by route PATTERN and status, and every refusal by its error code. The sync API (#776) is counted here by its routes as it lands |

⚠️ **No label is ever an athlete id, a display name, a room id or a coordinate.** A label value is
only a route pattern, a status, an error code or close reason, a worker's index or a quantile —
`apps/instance/src/metrics.ts` refuses anything else, and `instance.test.ts` scrapes the endpoint
after riders with names have joined a room and fails if any of those appears.

## Logs

One JSON line per event on standard output (`docker compose logs instance`). **Every line goes
through one function** (`apps/instance/src/log.ts` §`redacted`): only a fixed list of keys is
written, each with a number, a boolean or a short string, and anything else — a token, a
signature, a latitude, a display name, an object — is replaced by `[redacted]`. A request is logged
by the route PATTERN it matched, never its path, query, headers or body; an exception by its name,
never its message (ADR 0004 decision D).

## Sizing

From [spike 0013](spikes/0013-race-rooms-on-a-small-linux-box.md) and
[ADR 0037](adr/0037-instance-runtime-hosting-and-transport.md) D-7 — **both memory bounds, the
pessimistic one first**:

| Bound | Figure |
|---|---|
| CPU, one room worker (one core) | healthy at about **6 000** riders (51 % of a core), saturated at **~11 000–12 000** |
| Memory, compression on, **over an hour** | **~3.3 MiB per rider** — about **2 000 riders in ~7 GB**. The pessimistic bound, and the only one with an hour behind it |
| Memory, compression on, 180 s runs | ~0.67 MiB per rider — about 10 000 riders in ~7 GB |
| Memory, compression off (the default), 180 s runs | ~0.14–0.29 MiB per rider. ⚠️ No hour was run with compression off |

**Plan on ~2 000 riders — 40 rooms of 50 — on a 4-core, ~8 GB box**, with compression off or on,
until [#792](https://github.com/openzigs/onyourleft/issues/792) runs many rooms for an hour on Node.
⚠️ Every figure here was measured under `workerd`, and the instance runs on Node (ADR 0037 D-1):
memory per rider is the figure most likely to differ. The instance runs **one room worker per
core** by default (`OYL_INSTANCE_ROOM_WORKERS` to change it) — one event loop uses one core,
whatever the box has.

**On a home connection the upload is the first limit**, before CPU or memory: one 50-rider room at
1 Hz sends about **0.36 Mbit/s** with compression off and **0.18 Mbit/s** with it on (spike 0013
§5; ADR 0037 D-8.3). At an upload of *U* Mbit/s that is at most about *U* ÷ 0.36 rooms of 50
uncompressed — ~27 rooms at 10 Mbit/s — before any headroom and before the tunnel's own framing.

## The compression dial

`OYL_INSTANCE_WS_COMPRESSION` — `off` by default (ruling Q16). `permessage-deflate` **halves the
bytes a room sends and roughly doubles the memory it holds, and leaves CPU unchanged** (spike 0013
§5, ADR 0037 D-3). Turn it on where the upload binds before memory — a home connection — and leave
it off on a rented box with bandwidth to spare. Restart the instance to change it
(`docker compose up -d instance`). A client offers compression on every socket; with the dial off,
the handshake simply answers without it.

## Room close codes

A room's socket is closed with a code that says why (`apps/instance/src/room/close-codes.ts`),
the same on the Node server and the Durable Object:

| Code | Reason | When |
|--:|---|---|
| 1001 | `server-stopping` | the instance is shutting down; the race does not resume — reconnect later |
| 1008 | `hello-expected` | anything but a well-formed hello arrived first, **a hello with no ticket included** |
| 1011 | `room-lost` | the room worker holding the room died |
| 4001 / 4002 | `protocol-mismatch` / `physics-mismatch` | a client from another build |
| 4003 | `ticket-refused` | a ticket that is unknown, expired, for another room, **or already spent** |
| 4004 | `room-full` | the room holds its capacity |
| 4005 | `room-closed` | finished or closed — or a race that was interrupted and cannot resume |
| 4006 | `replaced` | the same athlete connected again; the newer socket is the rider |
| 4008 | `too-slow` | the client stopped reading, and its unsent bytes passed the limit (256 KiB) |

## Backup

```bash
node src/operator/cli.ts backup <directory> [--keep N] [--copy-to <second directory>]
```

An **online** snapshot, taken while the instance runs: SQLite's own `VACUUM INTO` — one read
transaction, so it neither stops the writer nor copies a half-written page — and every blob, into a
new directory `snapshot-<time>` with a `manifest.json` of what it holds (every table's row count,
the blob count, and the database's SHA-256). `--keep N` removes all but the newest N; `--copy-to`
copies the snapshot to a second place — the off-box copy. The home deployment runs this on a
schedule (the `backup` service: every six hours, fourteen kept, into `OYL_BACKUP_DIR` with a copy in
`OYL_OFFBOX_DIR`).

⚠️ **A backup kept only on the box it backs up is not a backup** of the box. `OYL_OFFBOX_DIR` is a
drive or a share that survives the machine: a USB drive that is unplugged and kept elsewhere, or a
network share. An S3-compatible bucket is not built into the backup yet; `rclone` pointed at the
snapshot directory does it, and is the operator's to run.

## Restore

```bash
node src/operator/cli.ts restore <snapshot directory> [--force]
node src/operator/cli.ts verify
```

**Stop the instance first** (`docker compose stop instance`): a restore writes where it keeps its
data. It refuses to write over a database that is there without `--force`, and refuses a snapshot
whose database is not the one its manifest describes. After copying it **checks what it restored**
— SQLite's integrity check, every table's row count and the blob count against the manifest, and
every blob's content against its name — and fails loudly if anything differs. `verify` prints the
same counts for the data in place, which is what to compare on a second machine.

A restore has been **performed** in a test, not only written: `apps/instance/src/operator/commands.test.ts`
backs up a populated instance while it is open and writing, restores the snapshot into an empty
place, and reads a known activity record back through the store. Restoring **on a second machine**
is an owner's step — see [issue #733](https://github.com/openzigs/onyourleft/issues/733).

## Upgrading

Migrations are **an explicit step the deploy runs before the new version starts**, never something
the server does to itself:

```bash
node src/operator/cli.ts migrate
```

It writes a marker beside the database while it runs, so an instance starting at the same moment
waits — not ready, room sockets refused — rather than reading a database mid-migration. Started
against a database that is **behind** its build and not being migrated, the instance **refuses to
start and names this command**. Against one that is **ahead** (a newer build migrated it), it
refuses too: run the newer build, or restore a snapshot taken before it.

On the home machine, `bash apps/instance/deploy/home/deploy.sh` does all of it: builds this
checkout, snapshots the data, starts the new build (Compose runs `migrate` first), waits for
`/ready`, and **rolls itself back** — the previous build, with the snapshot restored — if the new one
never becomes ready. `deploy.sh --rollback` does the same by hand. Every migration has a tested
`down` (ADR 0037 D-6), but a rollback restores a snapshot rather than migrating down, because a
`down` that drops a table drops its rows.

## Shutting down, sleeping and rebooting

`docker compose stop` sends SIGTERM: every room socket is closed `1001 server-stopping`, every result
already final is written (a race rider's result is written the moment they cross the line), and the
database is closed. A race interrupted this way — or by a sleep, a reboot or a power cut — **does not
resume**: when its riders' apps reconnect they are told `room-closed` in words (4005). A result is
on disk only for riders who had already finished. A **group ride** has no result to lose and opens
again, empty, for whoever rejoins it — from the start of the route. Every ride goes on recording on the rider's own
device, whatever happens to the instance (ADR 0036 D-3).

## Moderation and the operator's duties

Running an instance for other people is a set of duties as well as a box:

- **Rate limits behind a proxy.** Sign-in is rate-limited per client address. Behind the tunnel
  every connection comes from `cloudflared`, so the home deployment sets
  `OYL_INSTANCE_CLIENT_ADDRESS_HEADER=cf-connecting-ip` and the limits read the rider's own address
  from the header Cloudflare writes — **only** from `cloudflared`'s fixed address, which it names in
  `OYL_INSTANCE_TRUSTED_PROXIES`. From any other peer the header is ignored
  ([`docs/moderation.md`](moderation.md) §"Behind a proxy or a tunnel").
- **Registration** (`OYL_INSTANCE_REGISTRATION`) is `approval`, `invite`, `open` or `closed`. Unset,
  it is `closed`; the project's image sets `approval`, and the home deployment's compose file uses
  `closed` unless `.env` says otherwise. The owner and the deputy are named by device key (`OYL_INSTANCE_OWNER_KEY`,
  `OYL_INSTANCE_DEPUTY_KEY`) — [`docs/moderation.md`](moderation.md).
- **Blocking, reporting and moderation** ([#83](https://github.com/openzigs/onyourleft/issues/83)):
  riders block and report each other, and the owner and the deputy suspend, hide names and decide
  reports through the moderators' routes, every action in an append-only log —
  [`docs/moderation.md`](moderation.md) is the operator's page for it.
- **The source offer**: `GET /source` names the exact source of the running build (AGPL-3.0 §13, ADR
  0036 D-6). An operator who modified the instance sets `OYL_INSTANCE_SOURCE_URL` to their own.
- **Privacy**: Cloudflare terminates TLS on the tunnel's path and can see the instance's traffic in
  the clear; the privacy policy names it ([#778](https://github.com/openzigs/onyourleft/issues/778)).
  Erasing an athlete removes every row they own (`eraseAthlete`, tables found by their foreign keys).
