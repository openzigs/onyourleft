# Running the instance on a home Windows machine

The project's first instance runs on the owner's own Windows machine, in Docker, reached from the
internet **only** through a Cloudflare Tunnel
([#807](https://github.com/openzigs/onyourleft/issues/807), ADR 0037 D-8). This guide is written so
that **somebody who has never seen this repository** can follow it on their own Windows machine.
Everything after setup is in [`operating-an-instance.md`](../operating-an-instance.md).

```mermaid
graph LR
    R[Riders: web + Android] -->|wss / https| CF[Cloudflare edge]
    CF <-->|outbound tunnel| CD[cloudflared container]
    subgraph Home["The Windows machine: WSL 2 / Docker Desktop"]
        CD --> I[instance container]
        I --> V[(volume: SQLite + blobs)]
        V -.->|every 6 h| B[(OYL_BACKUP_DIR)]
    end
    B -.->|copied| O[(OYL_OFFBOX_DIR: a USB drive or a share)]
```

**What you need**: Windows 10 22H2 or 11 with virtualisation enabled; about 4 GB of memory to spare;
a Cloudflare account (free) with a domain on it; and — for the off-box backup — a USB drive or a
network share. **The router opens no port**: `cloudflared` dials out.

## 1. Install Docker Desktop, with the WSL 2 backend

1. Install **WSL**: in an administrator PowerShell, `wsl --install`, and restart when it asks.
2. Install **Docker Desktop** from docker.com. In *Settings → General*, tick **Use the WSL 2 based
   engine** and **Start Docker Desktop when you sign in to your computer**.
3. Install **Git for Windows** (it brings Git Bash, which `deploy.sh` runs in).
4. In Git Bash: `docker version` answers with a client and a server, and
   `docker compose version` with a version.

⚠️ **Docker Desktop starts when you SIGN IN, not when Windows boots.** After a reboot the instance
comes back only once somebody has signed in — set Windows to sign in automatically
(`netplwiz`), or accept that a reboot at night leaves the instance down until morning.

## 2. Get the code

```bash
git clone https://github.com/openzigs/onyourleft.git
cd onyourleft
```

## 3. Create the tunnel and its public hostname

1. In the Cloudflare dashboard: **Zero Trust → Networks → Tunnels → Create a tunnel**, type
   **Cloudflared**. Name it (`onyourleft`).
2. It shows an install command containing a long token after `--token`. **Copy only the token.** Do
   not run the command: the tunnel runs as a container here.
3. **Public hostname**: a subdomain on your domain (`rides.example.org`), service type **HTTP**, URL
   **`instance:8787`** — the instance's name on the deployment's own Docker network.
4. Nothing else. WebSockets go through a tunnel with no extra setting.

⚠️ **The token is a secret.** It goes in `.env` in step 4 and nowhere else — not a commit, not a
chat, not a screenshot. Anybody holding it can serve your hostname.

## 4. Fill in `.env`

```bash
cd apps/instance/deploy/home
cp instance.env.example .env
```

Edit `.env`:

| Variable | Set it to |
|---|---|
| `OYL_INSTANCE_ORIGIN` | `https://` and the public hostname from step 3 |
| `OYL_INSTANCE_REGISTRATION` | `approval` (you or your deputy approve each new account), `invite`, `open`, or `closed`. Left empty here it is `closed` — see [`docs/moderation.md`](../moderation.md) |
| `OYL_INSTANCE_OWNER_KEY`, `OYL_INSTANCE_DEPUTY_KEY` | the device keys of the two moderators, which the app shows; empty names nobody |
| `CLOUDFLARE_TUNNEL_TOKEN` | the token from step 3 |
| `OYL_BACKUP_DIR` | a folder on this machine for snapshots, e.g. `C:/onyourleft/backups` |
| `OYL_OFFBOX_DIR` | a folder on a drive that is **not** this machine — the USB drive, `E:/onyourleft-backups` |
| `OYL_INSTANCE_WS_COMPRESSION` | `off` unless your upload is the limit — see [Compression](#compression-and-your-upload) |

`.env` is ignored by git, so `git pull` never overwrites it and never uploads it.

**The rider's address, and why `compose.yaml` fixes the tunnel's.** Every connection reaches the
instance from `cloudflared`, so the per-address rate limits read the rider's own address from the
`cf-connecting-ip` header Cloudflare writes (`OYL_INSTANCE_CLIENT_ADDRESS_HEADER`). The instance
believes that header only from a proxy it trusts — loopback, or an address in
`OYL_INSTANCE_TRUSTED_PROXIES` — so `compose.yaml` gives `cloudflared` the fixed address
`172.30.87.10` on the project's own network and names exactly that address. You do not set either in
`.env`. If `172.30.87.0/24` is already in use on this machine, change the subnet, the tunnel's
address and `OYL_INSTANCE_TRUSTED_PROXIES` in `compose.yaml` together. Anything else on that network,
or a port published for local debugging, is counted as itself, whatever header it sends.

## 5. Deploy — one command

```bash
bash apps/instance/deploy/home/deploy.sh
```

It builds the image from this checkout (tagged with the commit), runs the database's migrate step,
starts the instance, waits until `/ready` says ready, then starts the tunnel and the scheduled
backup. It prints how long it took. If the new build never becomes ready it puts the previous one
back by itself, with the data as it was — see
[`operating-an-instance.md` → Upgrading](../operating-an-instance.md#upgrading).

**Check it from outside**: `https://rides.example.org/health` answers `{"status":"ok",…}` and
`/ready` answers `{"status":"ready",…}`.

## 6. A room to ride in

Until riders can make rooms in the app ([#784](https://github.com/openzigs/onyourleft/issues/784),
[#785](https://github.com/openzigs/onyourleft/issues/785)), the operator opens one:

```bash
cd apps/instance/deploy/home
docker compose run --rm --no-deps --entrypoint node migrate \
  src/operator/cli.ts room-open saturday-ride --kind ride --length 40000
```

## Compression and your upload

A home connection's **upload** is the first thing a room runs out of — before the CPU and before
memory ([ADR 0037](../adr/0037-instance-runtime-hosting-and-transport.md) D-8.3). One 50-rider room
sends:

| | Upload per 50-rider room | Rooms on a 10 Mbit/s upload |
|---|--:|--:|
| Compression **off** (the default) | ≈ 0.36 Mbit/s | about 27 |
| Compression **on** | ≈ 0.18 Mbit/s | about 55 |

That is arithmetic from spike 0013 §5, before headroom and before the tunnel's own framing — not a
measurement of your line ([#792](https://github.com/openzigs/onyourleft/issues/792) measures it).
Compression roughly **doubles the memory** each rider costs, so turn it on
(`OYL_INSTANCE_WS_COMPRESSION=on`, then `docker compose up -d instance`) only when the upload binds
first. Measure your upload with any speed test.

## Sleep, updates and reboots

**While rooms are open, stop Windows sleeping**: *Settings → System → Power → Screen and sleep →
When plugged in, put my device to sleep after: Never*. A sleeping machine answers nothing.

What happens when it sleeps, reboots, or loses its connection anyway:

| Event | What a rider sees | What survives |
|---|---|---|
| **Asleep** | their app cannot reach the instance, and must say *"The instance is not reachable"* in words — the client's half, [#782](https://github.com/openzigs/onyourleft/issues/782), not built yet; **their ride goes on recording on their own device** | everything on the instance, untouched |
| **A Windows update reboots it mid-ride** | the room closes; on reconnecting, a **race** says `room-closed` — it does not resume — and a **group ride** opens again, empty | every result already final (a rider who had crossed the line); the database and blobs; nothing about the race in progress |
| **Back on**, after sign-in (step 1) | the instance is back by itself: Docker restarts every container (`restart: unless-stopped`) | — |
| **Cloudflare restarts its servers** (it says it may, daily) | a dropped socket; the app rejoins at once, into the same seat and place (ADR 0028 D-2 rule 1) | the room: the rider was coasted at 0 W while they were away |

To keep a Windows update from rebooting during an evening's rides, set **active hours**
(*Settings → Windows Update → Advanced options*) to cover them.

Stopping it on purpose: `cd apps/instance/deploy/home && docker compose stop`. Riders are told the
server is stopping (close code 1001) and results already final are written first.

## Updating

```bash
git pull
bash apps/instance/deploy/home/deploy.sh
```

A snapshot is taken first; the database is migrated as its own step before the new build starts;
and a build that does not become ready is replaced by the previous one, with the snapshot restored.
To go back by hand: `bash apps/instance/deploy/home/deploy.sh --rollback`.

## Backups

The `backup` service takes an online snapshot every six hours into `OYL_BACKUP_DIR`, copies it to
`OYL_OFFBOX_DIR`, and keeps the newest fourteen of each (`OYL_BACKUP_INTERVAL_SECONDS`,
`OYL_BACKUP_KEEP`). **Take the USB drive away from the machine between copies**, or it shares the
machine's fate — and plug it back in before the next one, or that copy fails (and says so in
`docker compose logs backup`).

**Restoring on another machine** — the drill worth doing once, before it is needed:

1. On the second machine, steps 1, 2 and 4 of this guide.
2. Copy one `snapshot-…` folder from the off-box drive to it.
3. `cd apps/instance/deploy/home`, then restore into the deployment's volume and check it:

   ```bash
   docker build --build-arg OYL_INSTANCE_COMMIT="$(git rev-parse HEAD)" -f ../../Dockerfile -t onyourleft-instance:local ../../../..
   docker compose run --rm --no-deps -v "/path/to/snapshot-…:/restore:ro" --entrypoint node migrate \
     src/operator/cli.ts restore /restore
   docker compose run --rm --no-deps --entrypoint node migrate src/operator/cli.ts verify
   ```

4. Compare `verify`'s row and blob counts with the `manifest.json` in the snapshot folder, and time
   it.

## Measuring the tunnel

[#807](https://github.com/openzigs/onyourleft/issues/807) asks for a measurement, not a number from a
forum. From a **different** machine (a laptop on a phone's hotspot is ideal), with the repository and
Node 24:

```bash
cd apps/instance
# 1. The tunnel's idle timeout: open a race lobby, and turn the instance's own ping off for it.
#    (In .env on the box: OYL_INSTANCE_PING_INTERVAL_MS=0, then `docker compose up -d instance`.)
node tools/tunnel-soak.ts --url https://rides.example.org --room lobby-probe --idle-probe --minutes 5
#    Then remove OYL_INSTANCE_PING_INTERVAL_MS from .env and `docker compose up -d instance` again.

# 2. Thirty minutes, two riders, one room, rejoining whenever a socket drops.
node tools/tunnel-soak.ts --url https://rides.example.org --room tunnel-soak --minutes 30
```

The rooms first: `room-open lobby-probe --kind race --length 1000` and
`room-open tunnel-soak --kind ride --length 100000 --countdown 0`, and `OYL_INSTANCE_REGISTRATION=open`
while it runs (it signs its riders up). The first prints how long an idle socket lived; the second
the disconnects, each rejoin's time and the longest silence. The ride's keepalive (30 s, ADR 0037
D-8.1) and the instance's ping (25 s) must both be shorter than the idle timeout the first printed.

## What is not here

- **Metrics for the public.** `OYL_INSTANCE_METRICS` is off; turned on, `/metrics` answers only a
  request carrying `OYL_INSTANCE_METRICS_TOKEN`, which stays in the box's `.env`.
- **A second instance while one updates.** One box, one instance: an update closes rooms for the
  seconds it takes. A managed deploy with no gap is [#790](https://github.com/openzigs/onyourleft/issues/790).
- **The Durable Object adapter.** Built and not deployed (the owner's Q3/Q6).
