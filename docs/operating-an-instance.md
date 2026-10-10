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
#1096). The agent runs from the job engine, #1095 ("Analysis jobs", below).

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
| `…"code":"tls-by-name"` | an `https:` address by a name was refused: each request goes to the checked address, so a certificate issued to the name cannot verify. Use `http:` on the private network, or `https:` at the address itself |
| `…"code":"no-model"` | an address is set and no model is named: name the model you pulled |
| `…"code":"not-a-url"`, `"not-base-url"`, `"bad-model"` | the setting is malformed; standard error says which |

What the agent sends the model and what it may read is in
[`docs/architecture.md`](architecture.md) §"The analysis agent on the instance".

## Analysis jobs

A rider's device asks the instance to write a ride up as a **job** (#1095,
[ADR 0046](adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md) D-11): the
request answers at once, the instance's one worker runs the agent over the model, and the device
follows the job's progress on a stream it can reconnect to. Every job route is reached only sealed
(ADR 0047 D-7), so on an instance without `OYL_INSTANCE_SECRET_KEY` they answer in plaintext, and
through the tunnel that means readable at Cloudflare's edge: set the secret before you let other
riders analyse.

**Off unless there is a model.** With no analysis model and no hosted key held, every start answers
`analysis_off` (503) and nothing else changes; the instance starts and serves as usual.

**What is kept, and for how long.**

| What | Kept until |
|---|---|
| The job row: whose it is, its source, its status, when it was made and ended, and why it failed | seven days after the job ended (the owner's Q5 ruling), deleted by the hourly sweep, **unless it holds a write-up**: that row stays with it |
| The ride input the device sent: numbers and the input's own words, never a coordinate, date, name or picture | with the job row |
| The job's events: progress (a step, or a tool by name), each screened section, withdrawals, the result | the device acknowledges the write-up, or seven days after the job ended. A job that did not succeed keeps no section's text from the moment it ends |
| The write-up itself | kept (ADR 0046 D-12, the owner's ruling 8) so another device can read it, erased with the account, and included in the account export as `analysisResults` |

A job that is still queued or running when the instance stops — a restart, an upgrade, a power cut —
is ended `failed` with the failure `interrupted` at the next start, and is **never run again**: the
rider asks again if they still want it. Each athlete may have one job queued or running at a time,
and may start twelve an hour. There is one worker for the whole instance, so a job waits behind
another athlete's, for up to the agent's run budget.

**What the log says.** One line per change of status, `"event":"analysis-job"` with `state` (and
`code`, the failure, when it failed). Never a job's id, its input, a tool name or any of the
write-up.

**How it is erased.** Erasing an account (`DELETE /v1/account`) deletes every job and event of the
athlete with everything else of theirs. Rolling the database back past migration 0020 drops both
tables, rows and all.

**The heartbeat.** A quiet stream writes a comment every 25 s so Cloudflare's tunnel (which cuts a
response it has seen nothing of for 100–125 s) keeps it open. `OYL_INSTANCE_ANALYSIS_HEARTBEAT_MS`
changes it — up to 60000; `0` sends none, **only** to measure the tunnel cutting a stream that has
none (#1105), never to run with.

## A hosted model key

Besides a model on the box, the instance may hold **one** key for a hosted, OpenAI-compatible model
service (#1097, [ADR 0046](adr/0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
D-9). ⚠️ **Nothing uses it yet, for anyone — you included.** A hosted job runs only for an athlete
whose own consent, naming the endpoint, is recorded on the instance (ADR 0046 Q10), and is refused
before the key is read; and a hosted request must be masked first (#1101). Neither is built, so a job
that asks for the hosted source fails `hosted_unavailable`, the key is not opened, and nothing is
sent. And it is used only for a job whose rider's device asked for it — the source is chosen per
job, never by the instance.

**Held for you, the operator, and for nobody else yet.** The instance also hosts group rides and
races, so it has other riders, and holding a key changes nothing about them: they register and ride
as before. The owner's ruling 5 on #1092 *"REPLACES ruling 3's 'single-rider only'"*. The key is
held for the operator, who is, in the owner's Q9 ruling, *"the athlete whose device holds
`OYL_INSTANCE_OWNER_KEY`, the key that already makes them moderator"*: `model-key set` looks that
athlete up, and is refused when the variable is unset or your device has not signed in to this
instance yet. **No job can use it yet, yours included.** ADR 0046 Q10 binds you as it binds every
rider: a hosted job runs only for an athlete whose own consent, recorded on the instance and naming
the endpoint, is there, and recording that consent is not built yet — for you or anyone. Another
rider's job is refused for a second reason as well: your switch for other riders (Q13: *"Other
riders get no analysis until the operator turns it on, whichever key they use"*) is not built
either. What remains of #1097 — the switch, a rider's own key, the consent, and where a pasted key
may be typed — is #1199.

**The key stays with the athlete it was set for.** It is stored against your athlete, not against
the variable. If you change `OYL_INSTANCE_OWNER_KEY` to another athlete's device key, or your device
key is revoked, the key does not move: run `model-key clear`, then `model-key set` again as the new
operator. Erasing your account (`DELETE /v1/account`) erases the key with it. Your
account export says only `"hostedModelKey": "a hosted model key is held"`; another rider's says
`null`.

**The secret.** The key is encrypted at rest with AES-256-GCM under `OYL_INSTANCE_SECRET_KEY`, 32
bytes of base64 that you make once and keep in the deployment's `.env`, beside nothing else:

```
openssl rand -base64 32
```

Every write draws a fresh nonce, and the athlete, the URL and the model are bound into the
encryption, so an edited URL in the database makes the key unreadable rather than sending it
somewhere new, and an edited athlete makes it unreadable rather than somebody else's. The server and
the operator's commands both read the variable; a value that is not 32 bytes of base64 stops the
server starting.

```
printf '%s' "$KEY" | node src/operator/cli.ts model-key set --url https://… --model <name>
node src/operator/cli.ts model-key status    # url, model, "a key is held", whether this secret opens it
node src/operator/cli.ts model-key clear
```

On the home deployment (#807) the variable goes in the `.env` beside `compose.yaml`
(`instance.env.example` lists it), and `compose.yaml` hands it to the `instance` service and to no
other: the `backup` service never sees it. Run the commands in that service, with `-T` so the key
reaches standard input through the pipe:

```
printf '%s' "$KEY" | docker compose run --rm --no-deps -T instance node src/operator/cli.ts model-key set --url https://… --model <name>
docker compose run --rm --no-deps -T instance node src/operator/cli.ts model-key status
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
| `…"state":"unreadable","hostedKeyProblem":"the hosted key cannot be read with this secret"` | restored under another secret: set the key again, or put the old secret back |
| `…"state":"no-secret"` | a key is held and `OYL_INSTANCE_SECRET_KEY` is not set |

**What clearing leaves.** `model-key clear`, replacing a key with `set`, and erasing the account all
run with SQLite's `secure_delete` on, so the old ciphertext is overwritten with zeros in the
database file rather than left in a free page, and then checkpoint and truncate the write-ahead log,
which held copies of the old pages. ⚠️ Two copies are beyond that: **a snapshot taken while the key
was held** still holds its ciphertext, and opens with the secret, so delete those snapshots or
rotate the secret; and if another connection (the running server, when the command is run beside it) is reading at
that moment, the truncation does not happen and the log's old pages stay until SQLite next writes
the log over from its start. Neither is the key in clear.

**Rotating the secret.** There is no re-encryption command, because the key itself is the thing to
re-enter: stop the instance, set the new `OYL_INSTANCE_SECRET_KEY`, run `model-key set` again with
the key (which seals it under the new secret), and start the instance. Snapshots taken before then
need the old secret to read their key; the rest of a snapshot needs no secret at all.

## The instance's keys

An instance holds two long-term keys of its own (#1189,
[ADR 0047](adr/0047-end-to-end-encryption-between-the-app-and-its-instance.md) D-4, D-5): an
**identity** key (Ed25519), which riders' devices pin and which only signs, and an **encryption**
key (X25519), which devices seal requests to. The encryption key is published only inside a
statement the identity key signs, at `GET /v1/instance/keys`. Devices seal requests to it at
`POST /v1/sealed` (#1191, below); the app's pin is #1190.

**They need `OYL_INSTANCE_SECRET_KEY`**, the same secret a hosted model key uses (above) — never a
second one — and `OYL_INSTANCE_ORIGIN`, which they are bound to. Both private halves are stored in
the database wrapped with AES-256-GCM under a key derived from the secret, so a backup holds them as
ciphertext only, and a restore keeps every device's pin. **With no secret the instance makes no
keys**: `/v1/instance/keys` and `POST /v1/sealed` answer `unavailable`, naming the variable, and
every route is served in plaintext as before — including the ones a keyed instance serves only
sealed (below, #1192). With a secret, the keys are made on the first start.

**The numbers, ruled by the owner (ADR 0047 D-14 Q3)**, all on the box's own clock:

| | |
|---|---|
| a new encryption key | every **30 days**, made by the running server |
| a statement for the current key | lives **48 hours**, and is signed again once fewer than 24 hours are left — about daily |
| an old key's private half | kept **7 days** after its successor is made, then **deleted** — gone from the database and from every backup taken afterwards |
| a key's serial | `max(now, the highest serial ever issued + 1)` |

At start, before it serves its keys, the instance rotates if the current key is past its 30 days and
signs a fresh statement if none is in date — so a box that was off for days comes back serving
statements that verify. It logs what it did:

| You see | It means |
|---|---|
| `"event":"instance-keys","state":"ready",…` | the keys are in date; `made`, `rotated`, `signed` and `deleted` say what this pass did |
| `…"state":"no-secret"` | `OYL_INSTANCE_SECRET_KEY` is not set: no keys, no sealed routes |
| `…"state":"no-origin"` | `OYL_INSTANCE_ORIGIN` is not set |
| `…"state":"unreadable"` | this secret does not open the keys held — restored under another secret, or the origin changed |
| `…"state":"busy"` | an `instance-key` command is changing the keys this moment; the instance tries again in five seconds |

⚠️ **The box's clock must be set by NTP** (ADR 0047 D-9). A statement's `notAfter` is the box's
time, so a clock running ahead lengthens how long a superseded key's statement is still believed. A
home machine running Docker already keeps its clock this way; check it does.

**The commands**, run where the secret and the origin are set (on the home deployment, in the
`instance` service, as for `model-key`):

```
node src/operator/cli.ts instance-key init                     # make the keys now, if there are none
node src/operator/cli.ts instance-key show                     # the fingerprint and the instance card
node src/operator/cli.ts instance-key rotate [--drop-old] [--serial-above <n>]
node src/operator/cli.ts instance-key rotate-identity [--compromised]
node src/operator/cli.ts instance-key reset
```

- **Every command is safe on a running instance.** `init`, `rotate`, `rotate-identity` and `reset`
  write from a second process, so each first takes the database's **key lease** — the same one the
  instance's own maintenance pass takes — and gives it back when it is done (ADR 0047 D-5 has one
  writer at a time). While the instance is in the middle of a pass, a command is refused, writing
  nothing, with *"Another process is changing this instance’s keys right now: run the command again
  in a moment."* — run it again. While a command holds the lease the instance logs
  `"event":"instance-keys","state":"busy"` and tries again five seconds later. A lease whose holder
  died is free after 60 seconds. `show` only reads, and takes no lease.
- `show` prints the identity key's full fingerprint and the **instance card**,
  `oyl-instance:<origin>#<52 characters>` — what the first device pins from (ADR 0047 D-6). It holds
  nothing secret, and is never truncated.
- `rotate` makes a new encryption key now. `--drop-old` also deletes every older one at once: the
  answer to a suspected leak of the encryption key. `--serial-above <n>` issues a key whose serial is
  above `n` — the number a rider's app names when it was offered an older key than it has seen (a
  restore from before a key the box made while its clock ran ahead).
- `rotate-identity` makes a new identity key and deletes the old one. Planned, the old key signs an
  endorsement of the new one; `--compromised`, nothing does. **Either way every device pins again
  from the new card** (D-14 Q8).
- `reset` deletes every key and makes new ones. **Every device pins again.**

⚠️ **A lost operator secret loses the keys.** Without it neither private half can be unwrapped: the
instance logs `unreadable` and serves no keys. The remedy is a new secret and `instance-key reset`,
after which **every device must pin again from the new card**, and every hosted model key must be
set again. Keep the secret somewhere other than the backups, and somewhere you will not lose it.

**A restore rotates the encryption key** as its last step, once the data is checked and in place:
a snapshot from before the latest rotation would otherwise bring back a key older than one every
device has already seen. The identity key comes back unchanged, so every pin holds. `restore`
reports what it did under `keys`; with no secret set it says so and restores the data all the same.

## Sealed requests

`POST /v1/sealed` (#1191, [ADR 0047](adr/0047-end-to-end-encryption-between-the-app-and-its-instance.md)
D-8, D-9) is the one endpoint a sealed request arrives at: the inner method, path and body travel
inside the ciphertext, signed by the device's key, and the answer goes back sealed. It needs the
accounts (`OYL_INSTANCE_ORIGIN`) and the keys (`OYL_INSTANCE_SECRET_KEY`); without either it answers
`unavailable`. Three things about it are the operator's:

- ⚠️ **The box's clock must be set by NTP, and right to within two minutes.** A sealed request signed
  more than **120 seconds** from the box's clock is refused `stale_request`, and nothing runs. The
  app re-signs once with the box's time and remembers the difference, so a phone a few minutes off
  costs one extra round trip; but a box whose own clock wanders makes **every** sealed request fail,
  revoking a device and recovering an account included, and the app then tells the rider *"Your
  instance's clock looks wrong; ask its operator to check it."* A home machine running Docker keeps
  its clock by NTP already; check it does.
- **The clock rule, stated once.** Each request carries its signing time (`issuedAt`), checked
  against the box's clock with **120 s** either way; and the SHA-256 of each request's ephemeral key
  is kept in the database for **10 minutes**, so the same request sent again is refused `replayed`
  without running — across a restart too, because the record is a table (`sealed_replay`, migration
  0017), not memory. Its rows name no athlete, and rows older than ten minutes are deleted as new
  ones arrive.
- ⚠️ **The per-client limit needs `OYL_INSTANCE_CLIENT_ADDRESS_HEADER` and a trusted proxy, or it is
  one shared bucket.** A sealed request with no session (registering, linking, recovering) is
  counted against the client's address before the instance does any cryptography — 30 a minute.
  Behind `cloudflared` every request arrives from the tunnel's address, so the limit is per rider
  only when the instance is told to read `cf-connecting-ip` and the tunnel's address is loopback or
  in `OYL_INSTANCE_TRUSTED_PROXIES` (the home deployment's `compose.yaml` sets both). Without them,
  one busy client uses up registration, linking and recovery for every rider. A signed-in rider's
  sealed requests are counted against their session instead — 120 a minute — and are not affected.

**A sealed body over the instance's body limit is refused only after it is opened**, as a sealed
`payload_too_large` sent with 200, not as a plaintext 413. Padding (ADR 0047 D-9) hides how large
the inner body is, so the envelope's own limit has room for it, and the instance learns the size
only once it has decrypted the request. A plaintext 413 means the envelope itself was too large.

### Which routes are sealed, and what an instance without the secret exposes

**Since #1192, on an instance that holds keys, every route ADR 0047 D-7 puts in phase 1 is reached
ONLY sealed**, and a plaintext request to one is refused `sealed_required` before its session is
read or anything is run: minting a link code, linking, recovering and asking for a recovery mail,
giving, confirming and clearing a recovery address, the full reset, the device list and revoking a device, the account
export and deleting the account, **every** moderator route (the queues and the log included),
**every** sync route, and history search. Registering a new rider is sealed too: a key the
instance has never seen is refused `sealed_required` in plaintext, while a key it already holds
still signs in in plaintext until phase 2. `apps/instance/src/sealed/phase-one.ts` is the list, and
`GET /openapi.json` marks each route `x-oyl-sealed`. The rider's app offers these features only
with the instance's card, and only in the Android app or a copy opened from the rider's own
device — never in a copy a website served (D-11).

⚠️ **An instance with no `OYL_INSTANCE_SECRET_KEY` has no sealed routes.** It registers riders and
serves every one of the routes above in plaintext, as it did before #1191, so whatever sits between
the rider and the box — Cloudflare's edge, for the home deployment's tunnel — reads them: new
riders' recovery codes, link codes, moderators' actions and reads, and every synced ride, write-up
and note, and it holds the bearer token that would let it call them as the rider. The app cannot
seal to such an instance, so the features above are not offered on it. Set the secret.

**A pasted hosted-model key** (#1199) is accepted only sealed, signed by a device whose pin came from
a card, from any address — ADR 0047 D-13 lifted the home-network-only rule when phase 1 shipped. No
plaintext key route exists. `model-key set`, the operator command, is unchanged.

## Email recovery

Email recovery is off unless the operator hands the instance a mailer; `apps/instance/src/instance.ts`
hands none today, so every email-recovery route answers `not_found` on a running instance. Whoever
writes one, read this first (#1194, ADR 0047 D-8).

**A mailer sends the text the instance gives it, as it is.** `RecoveryMailer.send` and `.confirm`
(`apps/instance/src/auth/identity.ts`) receive the address, the token, and a subject and a plain-text
body the instance wrote (`apps/instance/src/auth/recovery-mail.ts`). The token is a **code the rider
types into the app**. The mail must hold **no link of any kind**: no `https:` URL on the instance's
origin or any other, no custom URL scheme, no Android App Link. A link opened in a browser sends the
code through whatever sits between the rider and the box (Cloudflare's edge, behind the tunnel) in
plaintext, and that edge could redeem it in a sealed `recover` signed with a key of its own: an
account takeover. Any app on a phone can claim a custom scheme (RFC 8252), and an App Link opens in a
browser wherever the app is not installed or the link is not verified. So do not add a "click here",
do not wrap the code in a URL, and do not let a mail template turn the code into a link.

⚠️ **Do not route the instance's mail through Cloudflare Email Routing** — on your sending domain or
any other. Mail is outside the instance's sealing: whoever carries it reads the code, and a code
Cloudflare reads is a code its edge can redeem. Tell riders the same: a rider whose own address domain
uses Cloudflare Email Routing should not rely on email recovery against an edge they do not trust, and
should keep their recovery codes on paper. Nothing in the app can see how a mail travelled.

What riders meet: an account holds at most **two** recovery addresses. A newly confirmed address is
**held for a week**, in which it recovers nothing and steps nothing up, and revoking the device that
gave it clears it; after that it is established. A recovery code is mailed only to an established
address, and a mailed code is refused `address_unbound` at redemption if its address has since been
cleared. Clearing an established address (`POST /v1/auth/recovery-email/clear`) and the full reset
(`POST /v1/auth/recovery/reset`) each need a recovery code or a code mailed to an established address.

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

It then **rotates the instance's encryption key** ("The instance's keys", above), which needs
`OYL_INSTANCE_SECRET_KEY` and `OYL_INSTANCE_ORIGIN`. `deploy.sh`'s rollback restores in the
`backup` service, which holds no secret, and so rotates afterwards in the `instance` service.

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
