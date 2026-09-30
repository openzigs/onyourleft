# Moderating an instance

This page is for the person who runs an On Your Left instance. Read it **before** you start one:
running an instance that other people can join makes you its moderator. This page covers what the
software lets you do about that, and what it does not.

The instance server is `apps/instance`. Everything below is the server's behaviour; the app on a
rider's device keeps its own copy of every ride and is not affected by anything here.

## Who moderates

An instance has two moderator roles: the **owner** and one named **deputy**. The owner of this
project ruled on 2026-09-28 (#16, Q13) that the project's own instance is moderated by those two
people and no one else.

A moderator is named by a **device key**: the 64-character hex public key of their phone or
browser, which the app can show. The instance reads two settings:

| Setting | What it names |
|---|---|
| `OYL_INSTANCE_OWNER_KEY` | the owner's device key |
| `OYL_INSTANCE_DEPUTY_KEY` | the deputy's device key |

The athlete who holds the named key, and has not revoked it, holds the role. A key is named, not an
account, so you can name yourself before your account exists. Without that, with approval-required
registration, nobody could ever approve the first account. If you revoke the named key, you lose
the role until the setting names another key.

A moderator cannot act on a moderator. The owner and the deputy cannot suspend each other or hide
each other's names, and neither can act on themselves. Neither can dismiss a report **about
themselves**: the other moderator decides it. Each such attempt changes nothing, and it **is** written
to the moderation log, as `refused_suspend`, `refused_dismiss_report` and so on, so you can see who
tried. If the deputy has to go, change the setting.

⚠️ **If you signed in before you set your key**, your account registered like anybody else's: with
approval-required registration it is waiting for approval, and nobody may approve a moderator. So
the next time a device holding a named key signs in to an account that is waiting, the instance
activates it and writes `activate_moderator_key` to the log. Set the setting, restart, and sign in
again.

## Who can join: the registration modes

`OYL_INSTANCE_REGISTRATION` sets how the instance takes new riders, in any case (`Closed` is
`closed`). **If it is not set, the mode is `closed`**: an instance someone starts without reading
this page registers nobody new. The project's own image sets `approval`, the owner's ruling for this
project's instance (#16, Q5 and Q13).

| Mode | A device key the instance has never seen… |
|---|---|
| `approval` (the project's image) | registers an account that **waits** for the owner or the deputy. While it waits, the rider can see their own account, name themselves and confirm their age, and nothing else. Other riders cannot see them. |
| `invite` | registers only with a single-use invitation a moderator minted (`POST /v1/moderation/invites`, good for seven days). The invitation is spent in the same transaction that registers the account. |
| `open` | registers an active account at once. |
| `closed` (the default) | is refused. |

The keys named in `OYL_INSTANCE_OWNER_KEY` and `OYL_INSTANCE_DEPUTY_KEY` register active in every
mode.

| Approval action | Route | Effect |
|---|---|---|
| Read the queue | `GET /v1/moderation/registrations` | Every account awaiting a decision, oldest first, and whether each rider confirmed they are 18 or over. |
| Approve | `POST /v1/moderation/registrations/{id}/approve` | The account becomes active. |
| Refuse | `POST /v1/moderation/registrations/{id}/refuse` | The account's session ends, and every key it holds is refused at sign-in from then on. |

Both decisions need a reason and are written to the moderation log, like every other action.

**New accounts are limited per client address:** at most 3 an hour. An IPv6 address counts by its
first 64 bits, because one home connection is usually given a whole /64 range. ⚠️ **The limit can
be varied.** Someone with many IPv4 addresses, or a larger IPv6 range, gets an allowance for each.
What makes a new identity cost something is the approval queue. The limit only slows how fast one
address can fill that queue.

⚠️ **This limit, and the sign-in limits, are kept in memory, so restarting the instance resets
them.** Counting them in the database would mean storing each rider's address beside their account,
and the instance never stores or logs an address. The report limit is different: it is counted from
the reports in the database, so a restart does not reset it.

### Behind a proxy or a tunnel

Behind a Cloudflare Tunnel, or any proxy on your machine, every request comes from the proxy. A
per-address limit would then be **one shared bucket for everybody**: one busy client could stop
everyone else from signing up. Set `OYL_INSTANCE_CLIENT_ADDRESS_HEADER` to the header your proxy
puts the rider's address in. For Cloudflare that is `cf-connecting-ip`, and the project's Docker
image already sets it. The instance reads that header only when the connection comes from a proxy
you trust. From anywhere else it ignores the header, because anybody could have typed it.

A proxy you trust is **loopback** (`127.0.0.1`, `::1`) or an address you list in
`OYL_INSTANCE_TRUSTED_PROXIES`, separated by commas, written as the connection reports it. If you
list nothing, only loopback is trusted. That is **one rule** (#903 item 4): the header is read only
when you named it **and** the connection comes from a trusted proxy. Naming the header alone never
makes a stranger's copy of it believed.

**The home deployment** (`apps/instance/deploy/home/compose.yaml`) does this for you: `cloudflared`
runs on the project's own compose network at the fixed address `172.30.87.10`, and the instance is
given `OYL_INSTANCE_CLIENT_ADDRESS_HEADER=cf-connecting-ip` and
`OYL_INSTANCE_TRUSTED_PROXIES=172.30.87.10`. Any other container on that network, and a port
published for local debugging, arrives from another address and is counted as itself
([`docs/self-hosting/home-machine.md`](self-hosting/home-machine.md)).

⚠️ **In Docker, publish the port on `127.0.0.1` only**, as in
`docker run -p 127.0.0.1:8787:8787 …`. A port Docker publishes reaches the container from the bridge
gateway, usually `172.17.0.1`, whoever sent it. On Docker Desktop every published connection does.
If `cloudflared` runs on the host, that gateway is the address to list:
`OYL_INSTANCE_TRUSTED_PROXIES=172.17.0.1`. That is safe only when the port is published on
`127.0.0.1`, so that nothing but a process on your machine can arrive from it. Published on every
interface, anybody on the internet would arrive from the gateway and choose their own rate-limit
bucket.

## Public rooms: who may join

A public room needs an account that meets **every** one of these rules (`GET /v1/auth/account` tells
a rider which ones they meet):

- it is approved, and not suspended;
- the rider has confirmed they are **18 or over** (ruling Q5). Only the confirmation and its date
  are stored. **No date of birth is ever asked for or kept**;
- it has been **active** for at least `OYL_INSTANCE_PUBLIC_ROOM_MIN_ACCOUNT_DAYS` days (7 if you
  set nothing). The days count from when it was approved, or from when it registered if it
  registered active. Days spent waiting for approval do not count;
- it has synced at least `OYL_INSTANCE_PUBLIC_ROOM_MIN_RIDES` rides (3 if you set nothing).

## What a rider can do

| Action | What happens |
|---|---|
| **Block** a rider | Neither rider can see or reach the other, whoever blocked whom. The blocked rider is not told: every request they make about the blocker gets exactly the answer a request about nobody gets. A block is kept for any well-formed id, whether or not anybody holds it, so a rider's own list of blocks says nothing about who exists. A rider can hold at most 1,000 blocks. |
| **Unblock** | Removes the rider's own block. It cannot remove a block the other rider made. |
| **Report** a rider | Sends the rider's id and a reason (up to 1,000 characters) to your queue. A rider can make at most **5 reports an hour**, and a report about an id nobody holds counts toward the 5 like any other. It is kept, closed as `no_such_athlete`, and never reaches your queue. A rider can report someone they have blocked. The answer is the same whether or not that rider exists. |

## What a moderator can do

Every action needs a **reason**. Each action is written to the **moderation log** in the same
database transaction that makes the change. So an action is either both applied and logged, or it
does not happen.

| Action | Route | Effect |
|---|---|---|
| Read the report queue | `GET /v1/moderation/reports` | Every report not yet decided, oldest first: who reported whom, why, and when. |
| Dismiss a report | `POST /v1/moderation/reports/{id}/dismiss` | Removes it from the queue. |
| Hide a display name | `POST /v1/moderation/athletes/{id}/hide-display-name` | Other riders see "Rider" instead of the name. The rider still sees their own name. The hide ends when the rider chooses a **different** name, because a new name is new content. Choosing the same name again keeps it hidden. |
| Suspend an account | `POST /v1/moderation/athletes/{id}/suspend` | Every device key the rider holds is refused at sign-in, every session they had ends at once, and other riders stop seeing them. **Nothing they own is deleted.** |
| Lift a suspension | `POST /v1/moderation/athletes/{id}/unsuspend` | The rider can sign in again and is visible again. |
| Read the log | `GET /v1/moderation/log` | Every action ever taken, oldest first. |

An action on a person can name the report it decides (`reportId`). That closes the report, with the
action recorded as its outcome.

To anyone who is not a moderator, every moderation route answers as though it does not exist.

## What the log is, and what erasure does to it

The moderation log is **append-only in the database schema**. Two SQLite triggers refuse any
`UPDATE` or `DELETE` of an entry, whoever sends it: this server, a script, or you in a `sqlite3`
shell. An entry records the moderator, the action, the rider it was taken on, the report it decided,
the reason and the time.

⚠️ **When a rider erases their account, the log keeps the entries about them.** The entries name the
rider's account id, which no longer resolves to anyone. The reasons you wrote stay as you wrote them.
This is deliberate: an audit trail that a suspended rider could delete would not be an audit trail.
It also means **do not write a rider's personal details into a reason**. Write what they did.

Erasure deletes a rider's own reports and blocks, and every block that other riders made of them.
Reports other riders made **about** them stay in your queue, so you can still decide them.

⚠️ **Migrating the database back past migration 0007 would delete the log**, so `migrate … down`
refuses to undo 0007 while the log holds a single entry, and changes nothing.

## What a suspension does not do

- **It does not delete anything.** The rider's rides, keys and history stay on the instance and on
  their own device. Suspension must not become a way to destroy somebody's data (#83).
- **It does not reach the rider's device.** Their rides are on their phone. The app's own export
  (#35) reads the phone, not the instance, so a suspension cannot stop a rider taking their own data
  away.
- ⚠️ **A suspended rider cannot sign in, so they cannot use an instance-side export while they are
  suspended.** #775 requires every one of their keys to be refused at sign-in. Their device still
  holds their rides. If they ask for a copy of what only the instance holds, lifting the suspension
  is the one way to give it to them today.
- **It does not stop a new identity.** A device key costs nothing to make. What a new identity has
  to get past is your registration mode (above): with approval-required registration, a banned
  rider with a new key is back in your queue, not back on your instance.

## What you cannot do, yet

- **Moderate inside a room.** Blocking and reporting a rider in the middle of a ride, room hosts,
  and room bans are #789.
- **Act on content other than a display name.** Riders' rides are not shown to other riders on the
  instance yet, so the only content another rider can see is a name.
- **Undo a block for somebody.** A block belongs to the rider who made it.
- **Take down a copy on another instance.** Instances do not talk to each other yet (#56). When they
  do, a moderator's action will reach only their own instance.

## Before you open your instance to the public

The owner ruled (#16, Q5) that **public rooms are 18 and over**. The age is self-declared, and no
date of birth is ever collected. Registration also needs approval. The UK Online Safety Act and EU
Digital Services Act assessments come before public rooms go live. If you run your own instance,
you owe your own.
