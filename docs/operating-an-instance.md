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

## The history index

With `OYL_INSTANCE_EMBEDDING_URL` set, the instance keeps a searchable index of each rider's synced
history for the post-ride write-up ([ADR 0040](adr/0040-a-history-index-on-the-riders-instance.md)).
It is an **index, never a store of record**: every row is cut from an item a rider's device synced,
it goes with that item and with the account, it is not in a rider's export (the export says which
model built it), and it can be thrown away and made again.

| You see | It means |
|---|---|
| `"event":"history-index","state":"on","model":…` at start | the index is on, with that model |
| `"event":"history-index","state":"off","code":"not-set"` | no embedding address is set: history is off, and nothing else changes |
| `…"state":"off","code":"not-local"` | the address was refused: it must be localhost, a loopback or private address, or a single-label (Compose service) name. Standard error has the sentence |
| `"event":"history-indexed","indexed":n,"failed":f,"stopped":null` | a catch-up indexed `n` items and nothing is waiting. `f` of them the model refused or answered wrongly for: each is marked, gone past, and tried again an hour later (#918) |
| `…"stopped":"unreachable"` (or `not-local`, `unresolved`, `unavailable`) | the model could not be reached, or answered about itself — `unavailable` is a 404 (a model not yet `ollama pull`ed), or a 429; the items wait, and nothing is embedded anywhere else. It is tried again every five minutes, at the next sync and at the next start, so a model started after the instance is picked up on its own (#918) |
| `…"stopped":"server-error"` | the model server answered 5xx for every item in a page of sixteen (or for every item waiting, if fewer), and answered about none of them: look at the model server's own log. A 5xx can be about one input rather than the server — Ollama answers 500 for a text its model makes a NaN of — so the sweep holds each such item unmarked and goes on to the next. The first time the model answers about any item, every held item is pinned: marked `failed`, counted in `f`, and tried again an hour later. Only a page with no answer at all stops the sweep, so an outage costs at most sixteen requests a sweep; until then nothing is marked, and it is tried again every five minutes (#928) |

**How often a rider may search.** `POST /v1/history/search` embeds a query on this machine, so it
is limited per rider: 30 a minute, then `429 rate_limited` (#918). The count is kept in memory by
rider, not by address, and forgotten when its minute ends, as every other limit is.

**Changing the model** (`OYL_INSTANCE_EMBEDDING_MODEL`, or either prefix) re-embeds every item at
the next start. Until it has finished, a search returns fewer passages, never rows of two models.
**Throwing the index away** — `DELETE FROM history_passage; DELETE FROM history_source;` on a
stopped instance's database — loses nothing: the next start makes it again from the synced items.

⚠️ **Nothing is measured on the owner's box yet**: the ingest rate (passages a second) and one
query's time, CPU-only and on a GPU if present, are owed by #835.

## Analysis model

With `OYL_INSTANCE_ANALYSIS_MODEL_URL` and `OYL_INSTANCE_ANALYSIS_MODEL` set, the instance can
reach a model for the post-ride write-up's agent
([ADR 0046](adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md) D-8, D-9;
#1096). ⚠️ **Nothing starts a job yet**: the agent runs from the job engine, #1095, which is not
built, so today the setting only checks the address and makes the connection ready.

**Running Ollama beside the instance, in Compose.** The home deployment's `ollama` service serves
the history index and the analysis model both. Set `COMPOSE_PROFILES=analysis` (or
`history,analysis`) in `.env`, start it once with `docker compose up -d ollama`, pull the model you
chose with `docker compose exec ollama ollama pull <model>`, and set:

```
OYL_INSTANCE_ANALYSIS_MODEL_URL=http://ollama:11434/v1
OYL_INSTANCE_ANALYSIS_MODEL=<the model you pulled>
```

**No model is recommended, and none is named in this repository** (ADR 0031 D-4): there is no
default, and an address with no model name leaves analysis off and says so. Two things to check of
the model you choose. **It must support tool calling**: the agent lets the model choose its tools,
and a model whose server answers *"does not support tools"* fails every job with a sentence saying
so — there is no fallback (ADR 0046 D-7). **Its licence must be one ADR 0031 D-2 admits**, as
ADR 0040 D-5 requires of any model these documents would name. And give Ollama a context window
larger than its default of 4 096 tokens (its `OLLAMA_CONTEXT_LENGTH`): a tool-calling run re-sends
the whole conversation every turn, and Ollama cuts an over-long prompt silently, from the front,
where the instructions are.

**The address rule** is the history index's (ADR 0040 D-6, `history/address.ts`): loopback,
`localhost`, a private, link-local, shared or unique-local address, or a single-label name such as a
Compose service. A public name and a `.local` name are refused when the configuration is read, and
analysis stays off. Where a name resolves to is checked again on **every** request, and the request
goes to the address that was checked. ⚠️ **Never publish Ollama's port, or point the tunnel at
it**: its API has no authentication.

| You see | It means |
|---|---|
| `"event":"analysis-model","state":"on"` at start | the model connection is ready. The model's name is not logged |
| `"event":"analysis-model","state":"off","code":"not-set"` | no address is set: analysis is off, and nothing else changes |
| `…"code":"not-local"` | the address was refused; standard error has the sentence (`instance: analysis is off: …`) |
| `…"code":"no-model"` | an address is set and no model is named: name the model you pulled |
| `…"code":"not-a-url"`, `"not-base-url"`, `"bad-model"` | the setting is malformed; standard error says which |

What the agent sends the model and what it may read is in
[`docs/architecture.md`](architecture.md) §"The analysis agent on the instance".

## A hosted model key

Besides a model on the box, the instance may hold **one** key for a hosted, OpenAI-compatible model
service (#1097, ADR 0046's ruling 3). ⚠️ **Nothing uses it yet**: a hosted request must be masked
first (#1101), so until that lands a job that asks for the hosted source fails
`hosted_unavailable` and sends nothing. And it is used only for a job whose rider's device asked
for it — the consent is per job, never the instance's.

**Single rider only.** A key is held only on an instance with exactly one athlete — every account
counts, pending, refused or suspended — because the operator of a multi-rider instance could read
every rider's key and history; on a one-person box the operator and the rider are the same person.
`model-key set` is refused on an instance with any other number of athletes, and while a key is
held **a second rider's registration is refused** (`single_rider_instance`) until you clear it.
Erasing the account (`DELETE /v1/account`) erases the key with it. The account export says only
`"hostedModelKey": "a hosted model key is held"`.

**The secret.** The key is encrypted at rest with AES-256-GCM under `OYL_INSTANCE_SECRET_KEY`, 32
bytes of base64 that you make once and keep in the deployment's `.env`, beside nothing else:

```
openssl rand -base64 32
```

Every write draws a fresh nonce, and the URL and model are bound into the encryption, so an edited
URL in the database makes the key unreadable rather than sending it somewhere new. The server and
the operator's commands both read the variable; a value that is not 32 bytes of base64 stops the
server starting.

```
printf '%s' "$KEY" | node src/operator/cli.ts model-key set --url https://… --model <name>
node src/operator/cli.ts model-key status    # url, model, "a key is held", whether this secret opens it
node src/operator/cli.ts model-key clear
```

`set` reads the key from **standard input and nowhere else**: a key given as an argument is refused,
because `ps` and a shell's history would show it. The URL must be `https:`, with no user name,
query or fragment; it is the only host the hosted model may reach. The key is never logged, never
in `/metrics`, never in an error and never in `status`.

**What a backup holds.** `operator backup` copies the database with `VACUUM INTO`, so a snapshot
holds the key's **ciphertext only**. Keep the secret out of the backup's destination: a snapshot and
its secret together are the key. A snapshot restored onto a box with a different secret — or none —
leaves the key unreadable, and the instance says so and carries on with its local model, or none:

| You see | It means |
|---|---|
| `"event":"hosted-model-key","state":"none"` | no key is held |
| `…"state":"held"` | a key is held and this secret opens it |
| `…"state":"unreadable","reason":"the hosted key cannot be read with this secret"` | restored under another secret: set the key again, or put the old secret back |
| `…"state":"no-secret"` | a key is held and `OYL_INSTANCE_SECRET_KEY` is not set |

**Rotating the secret.** There is no re-encryption command, because the key itself is the thing to
re-enter: stop the instance, set the new `OYL_INSTANCE_SECRET_KEY`, run `model-key set` again with
the key (which seals it under the new secret), and start the instance. Snapshots taken before then
need the old secret to read their key; the rest of a snapshot needs no secret at all.

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
