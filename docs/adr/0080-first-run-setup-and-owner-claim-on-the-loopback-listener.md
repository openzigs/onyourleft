# ADR 0080: First-run setup and the owner's claim, on the loopback listener

- **Status**: **Proposed**, 2026-11-17. It becomes **Accepted** only when the owner approves it, in
  words, on its pull request. Until then #2781, #2782, #2783 and #2784 stay blocked (the owner's
  ruling of 2026-11-17 on the epic #2779). Nothing is built by this ADR
- **Date**: 2026-11-17
- **Deciders**: **the owner**, who asked on 2026-11-17 for setup that a non-technical rider can
  manage and ruled *"Start phase 1 of easy setup"*. **The author** decided everything that ruling
  leaves open. Each such choice is marked *the author's choice*, and D-9 lists the ones the owner
  is asked to confirm or overrule. Two of them are the epic's open questions 1 and 2. They are
  recorded here as **Maintainer decisions**, with the reason for each, until the owner rules
- **Issue**: [#2780](https://github.com/openzigs/onyourleft/issues/2780), sub-issue 1 of the epic
  [#2779](https://github.com/openzigs/onyourleft/issues/2779)
- **Number**: **0080**, not the 0078 that #2780's title names. On 2026-11-17 the open pull request
  [#2793](https://github.com/openzigs/onyourleft/pull/2793) (#2777) writes
  `docs/adr/0078-a-floor-under-the-ai-pacers-intent.md`, and #2790's title claims 0079. #2780 says
  *"take the next free one if 0078 has gone"*. 0075, 0076 and 0077 are written in the open pull
  requests #2670, #2767 and #2762, and 0070 is ADR 0070 (#2694 merged on 2026-11-17). Wherever #2781 to #2784 say "ADR 0078"
  about first-run setup, they mean this ADR
- **Supersedes, in part** (D-8 lists each one and what stays):
  [ADR 0069](0069-the-instances-own-admin-pages-and-a-tls-only-admin-channel.md) D-5's *"serves
  `/admin`, its script and its stylesheet, and nothing else"* and its *"exactly one thing"*;
  ADR 0069 D-1's and [ADR 0046](0046-ai-analysis-on-the-riders-instance-as-a-tool-calling-agent.md)
  D-9 Q9's naming of `OYL_INSTANCE_OWNER_KEY` as the only place the owner's key comes from; and,
  for the setup wizard and the operator command only, the owner's ruling of 2026-11-14 on #2601
  that *"the registration mode is shown, not changed at runtime"* (ADR 0069 D-10). This is a new ADR
  and not a set of amendments, because each of these reverses a decision, and
  [ADR 0013](0013-adr-amendments.md) D-3 sends a reversed decision to a new ADR. ADR 0046, ADR 0047
  and ADR 0069 each gain one dated `## Amendments` entry pointing here. No ADR's body is edited
- **Leaves standing**: [ADR 0036](0036-a-self-hostable-instance-server-now.md) D-3's four invariants
  and D-7 (no paid service). [ADR 0047](0047-end-to-end-encryption-between-the-app-and-its-instance.md)
  D-6 (a pin comes only from a source Cloudflare cannot write, and the fingerprint is never
  truncated), D-8 (a sealed request is signed by a device key) and D-11. ADR 0069 D-1's code and
  passkey rules, D-3, D-4 and its amendment of 2026-11-15 on confirmation.
  [ADR 0004](0004-privacy-and-location.md) D. ADR 0046 D-9's rule that the deputy is not the
  operator
- **Relates to**: [ADR 0037](0037-instance-runtime-hosting-and-transport.md) D-2 (the Durable Object
  adapter gets none of this) and D-8 (the tunnel). #2790 (ADR 0079, remote access) decides what this
  ADR cannot: how the tablet reaches the instance at an `https://` origin without a domain

---

## Context

### What the owner asked for

On 2026-11-17 the owner wrote: *"Do we need to simplify or have a wizard to setup the server and make
the tablet easier to attach to the server. I am just concerned for non technical people it will be
difficult."* The epic #2779 was planned from that request, and the owner ruled the same day: *"Start
phase 1 of easy setup."* This ADR comes first. Every Phase 1 sub-issue that touches the server
builds one of its decisions.

### What exists today, read from `main` (8afb958e3) on 2026-11-17

- **The owner is whoever's device key is in `OYL_INSTANCE_OWNER_KEY`** (`apps/instance/src/config.ts`),
  read once at start-up. `auth/identity.ts` §`moderatorKey` compares a key with it, and a key it
  names registers as active even in `approval` mode. ADR 0046 D-9 Q9 makes the athlete of that key
  the operator, and ADR 0069 D-1 binds every admin session to it.
- **With no `OYL_INSTANCE_SECRET_KEY` there are no instance keys and no sealed routes**
  (`keys/instance-keys.ts`). The instance's private keys are stored in the database, wrapped under
  that secret (`keys/wrap.ts`). So **a backup plus the secret is the instance's identity**: whoever
  holds both can impersonate the instance to every device that pinned it.
- **`./secrets` is mounted read-only into `instance` alone** (`deploy/home/compose.yaml`, #2146). The
  `backup` service, which copies the `data` volume off the box, does not mount it.
- **The admin pages' loopback listener** (ADR 0069 D-5, #2643) is `127.0.0.1:8788` on the host. It
  is off unless `OYL_INSTANCE_ADMIN_PAGES=on` and `OYL_INSTANCE_ADMIN_LOOPBACK_PORT` are set, and it
  answers only on `Host: localhost:<port>`. ⚠️ **ADR 0069's amendment of 2026-11-15 records that it
  is not out of the edge's reach on Docker Desktop.** Any container, `cloudflared` included,
  reaches a port published on `127.0.0.1` through `host.docker.internal`, and arrives from Docker's
  gateway exactly as the host's own browser does. The tunnel's ingress rules are held in
  Cloudflare's dashboard, which can route a hostname to that address and set its `Host` header.
  Refusing `OYL_INSTANCE_TRUSTED_PROXIES` closes the direct path only.
- **`operator admin-code`** mints ADR 0069 D-1's code (`admin/code.ts`): `readableCode(16)`, 79 bits,
  ten minutes, single use, stored as a SHA-256, printed once by the command and never logged.
- **The card and a code as one QR** exist in the app (`apps/web/src/instance/instance-pin.ts`
  §`codeWithCard`). The loopback Keys page shows the card as text only.

### The problem

A fresh instance needs three things before it is any use: secrets made with `openssl rand`, an
owner key pasted from the app into `.env`, and a pinned card. Each is an expert step. Making them
easy must not hand any of them to the edge. ADR 0069 D-3 describes the edge as a party that sees
everything sent through the tunnel and can rewrite anything served through it. Each decision
below therefore states the threat it answers in D-3's terms: *what the edge can do* without the
decision, and *what it cannot do* with it. Since the edge can reach the loopback listener on
Docker Desktop, **the boundary here is not the listener. It is the host's file system**, which no
container but `instance` mounts and no route serves.

## Decision

### D-1 — Where setup is served: `/setup` on the loopback listener only, and only until setup is done

- **`/setup`, with its stylesheet and the admin pages' one script, is served on the loopback
  listener and on no other.** On the tunnel listener every `/setup` path is `not_found`, always, as
  a path with no route is. On the loopback listener it is `not_found` once the setup is **done**
  (D-7), and that is read from the database on every request, so a restart does not reopen it.
- **The address is `http://localhost:8788/setup`, not `127.0.0.1`.** ADR 0069 D-1 and D-4 serve the
  loopback pages on `localhost` only, because a passkey's RP ID cannot be an IP address and the
  `Host` check is exact. A request for `127.0.0.1:8788` gets D-4's page saying which address to
  open. The epic's sequence diagram and #2784's description say `127.0.0.1:8788/setup`; this
  corrects them.
- **While the setup is not done the loopback listener runs even with `OYL_INSTANCE_ADMIN_PAGES` off**, and
  serves `/setup` alone. *The author's choice*: the wizard exists so that nobody has to edit `.env`
  first. #2784 makes the home compose file's `OYL_INSTANCE_ADMIN_LOOPBACK_PORT` default `8788` to
  match the `ports:` line, which already defaults to it. "Not done" is D-7's state, which
  covers *unclaimed* and *claimed, setup open*, so the wizard's steps after the claim still run.
  An instance whose owner key is set in the environment starts in *done* (D-3). Once setup is
  done the listener serves `/admin` only when the admin pages are on, as today.
- **Not on the Durable Object adapter** (ADR 0037 D-2), which has no loopback listener and no
  operator command. There the owner is set by `OYL_INSTANCE_OWNER_KEY` alone.

**The threat, in D-3's terms.** Through the tunnel the edge serves whatever page it wants under the
instance's hostname. If `/setup` were served there, the edge could show the owner a wizard it wrote
and read every code typed into it (D-3, sees 5). With D-1 it **cannot**, because the tunnel
listener has no `/setup` route. The owner types `localhost` on the host, and that connection goes
from the host's browser to the container through Docker's port publishing, with no edge in the
path. On Docker Desktop the edge **can** reach `/setup` by routing a hostname to
`host.docker.internal:8788`. What it reaches there is the locked page, which carries no secret
(D-2). Everything else needs the setup code, which the edge cannot read (D-2).

### D-2 — The setup code: minted at start, kept in a file under `./secrets`, never printed

- **Shape and life**: exactly ADR 0069 D-1's code. That is `readableCode(16)`, 79 bits, typed in
  either case with or without its hyphens, stored only as the SHA-256 of its normalised form. It
  lives **ten minutes**, is **single use**, and minting one **voids every unused one**.
- **Minted only while the setup is not done** (D-7). It is minted **at every start of the
  instance**, so restarting Docker gives a fresh code, and by **`operator setup-code`** on the host.
  Nothing else mints one. *The author's choice*: a non-technical owner who takes longer than ten
  minutes restarts the app or the machine and does not need a terminal.
- **Where it goes**: the file `setup-code` in the `./secrets` directory, written atomically (a
  temporary file, then a rename) with owner-only permissions. It holds the code, when it expires,
  and one sentence saying which address to type it into. The file is deleted when the code is used
  and when the setup is done.
- **Standard output says where the code is, and never the code**, for example: `instance: first-run
  setup: open http://localhost:8788/setup and type the code in secrets/setup-code (valid until
  14:05)`. **Maintainer decision**, answering the epic's open question 1 (D-9 Q-1). The reason is
  ADR 0069 D-4's rule that no code appears in any log line. A container's standard output is not a
  private channel: Docker keeps it in `docker compose logs` and in Docker Desktop's dashboard, log
  drivers ship it, and operators paste it into help requests. Jenkins' `initialAdminPassword` in
  its log is the pattern being refused. `operator setup-code`, like `operator admin-code`, prints
  the code once on the terminal that ran it, because that terminal is the host and not a log.
- **Redeemed on the loopback `/setup` page only.** A redeemed code opens a **setup session**, with
  ADR 0069 D-4's cookie rules, CSRF layers, headers, `Host` check and limits (15 minutes idle,
  2 hours at most). Sign-in attempts are rate-limited as D-4 limits them. A refused code is answered
  with one sentence that does not say whether the code was unknown, used or expired, and never
  repeats what was typed.

**Why the edge cannot read or write the code.** `cloudflared` mounts no part of `./secrets`, no route
serves the file, and the file is not in the `data` volume, so no backup carries it off the box
(D-4). The edge cannot write it either: only `instance` mounts `./secrets`, and only the instance's
start and the operator command write the file. **What the edge can do** is try codes on the locked
page through `host.docker.internal`. At D-4's 30 attempts a minute over a code's ten minutes, a
guess at a 79-bit code succeeds with a chance of about 4 × 10^-22. **What other software on the
owner's machine can do** is take the setup session's cookie, because a `localhost` cookie is sent
to every port (ADR 0069 D-3, the loopback threat list). D-5 bounds what such software gains, and
D-7 says what the session may do.

**Refused, because the edge could reach or write it:**

- **A "send me a new code" button on the locked page.** The edge reaches that page on Docker
  Desktop and could void the owner's code at will. A restart, or the command, mints a new one.
- **The code in any page, response, log line or operator-log entry**, and printed to standard
  output.
- **Minting or redeeming a setup code from any route on the tunnel listener**, or through
  `/admin`.

### D-3 — The owner's claim: a single-use claim code from the loopback QR, redeemed on a sealed route

- **The claim code** is minted by the setup session on the wizard's claim step. It has the setup
  code's shape, life and storage (ten minutes, single use, SHA-256 only, one live at a time). It is
  shown **only** on that loopback page, as one QR holding `codeWithCard(card, claimCode)`, with the
  same text beside it (#2783). The card in it carries the full 52-character fingerprint, never
  truncated (ADR 0047 D-6).
- **The tablet scans it inside the app** (#2785) and never through the operating system's camera,
  because `oyl-instance:` is not a URL scheme (ADR 0047 D-6). The app **pins the fingerprint from
  the card first**. It then redeems the claim code on **a sealed, sessionless route**: a new path in
  `sealed/routes.ts` §`SESSIONLESS_PATHS`, whose inner statement is signed by the claiming device's
  key (ADR 0047 D-8), and which is `sealed: 'only'` like every route in that set. A plaintext
  request to it is refused before its body is read, and nothing is recorded.
- **Its effect**: the claim becomes **pending**, and becomes the owner only when the owner confirms
  it on the loopback page (D-5). The pending claim records the device key that signed. On
  confirmation the instance records that key as **the owner key, in the database**. The device then
  registers or signs in exactly as a device whose key is in `OYL_INSTANCE_OWNER_KEY` does today: it
  registers active, and it is the moderator. The claim refuses a key that is
  `OYL_INSTANCE_DEPUTY_KEY`, because ADR 0069 keeps the deputy out of the admin pages.
- **The owner key the instance uses** is `OYL_INSTANCE_OWNER_KEY` when it is set. Otherwise it is the
  claimed key in the database, and otherwise there is none. **Every owner check reads the claimed
  key from the database**, not from a copy made at start, so a claim takes effect without a restart
  and a reset (below) ends it at once. This is what #2782's round-trip test reads back.
- **Precedence: the environment wins, and a claim is refused while `OYL_INSTANCE_OWNER_KEY` is set.**
  **Maintainer decision**, answering the epic's open question 2 (D-9 Q-2). With the variable set,
  the instance is **claimed** and its setup **done** from its first start (D-7): no setup code is
  minted, `/setup` is `not_found`, and the claim route gives its one refusal. *Why the environment wins here, when
  #2609's analysis settings let the database win*: an owner key in `.env` is an expert's deliberate
  choice, and every existing install has one. If the database won, a claim could replace an owner
  that the operator had named, and no existing install would notice. If the environment wins, no
  existing install changes at all.
- **Unclaimed** means no `OYL_INSTANCE_OWNER_KEY` and no claimed key. **While an instance is unclaimed
  and holds no athlete, every registration but the owner's is refused**, whatever the registration
  mode is. *The author's choice*: a stranger who finds the tunnel's hostname before the owner
  finishes setup gets no account. An instance with athletes but no owner key, such as a test
  instance, keeps its registration mode exactly as today.
- **Reset**: `operator owner-claim reset`, on the host, clears the claimed key, ends every admin
  and setup session, reopens the setup (D-7), and writes the operator log. It is the recovery for
  an owner who lost the claimed device, and for a claim taken by the wrong device after the setup
  was done. Recovering the athlete with a recovery code gives the device a new key, so that owner
  resets and claims again, just as they would edit `.env` today. Nothing else reopens a claim.
- **The edge can starve the limiters, and this ADR accepts it.** On Docker Desktop the edge's
  traffic and the owner's browser can arrive from one gateway address, so the edge can use up ADR
  0069 D-4's per-address and instance-wide budgets and delay a sign-in, a setup-code redemption or
  a tunnel-carried claim redemption. It is a denial of availability only, with no disclosure, and
  the owner retries a minute later. D-2 refuses the "new code" button for the same kind of denial;
  this one is accepted in writing and not given a separate limiter.
- **Refusals are one sentence**: a used code, an expired code, an unknown code, and a claim when the
  instance is already claimed all get the same status and the same bytes (#2782). Redemptions are
  rate-limited as ADR 0069 D-4 limits sign-ins.

**The threat, in D-3's terms.** The claim route is reached through the tunnel, because the tablet
reaches the instance there, so the edge carries the redemption. **It cannot read the claim code or
substitute the key**: both are inside a sealed envelope encrypted to the key that the tablet pinned
from the loopback QR, and the inner statement is signed by the device key that becomes the owner.
**It cannot obtain a claim code** from any page it serves or reaches, because the code is shown
only on a loopback page behind a setup session (D-2). **It can delay or drop the redemption**,
which the owner sees as the tablet failing to connect, and **it can see that a sessionless sealed
request was made** (ADR 0047 D-11). **Refused**: making the first device to sign in the owner,
which is trust on first use. The edge could be that first device, and ADR 0047 D-14 Q1 already
refused pinning that way.

**Effect on ADR 0046 D-9 Q9 and ADR 0069 D-1.** Both name `OYL_INSTANCE_OWNER_KEY`. Under this ADR
both read **"the owner key"** as defined above. The operator is still the athlete of the owner
key, the deputy is still not the operator, an admin session is still bound to the owner key at
sign-in, and it still ends when that key changes, a reset included. With no owner key the admin
pages still answer `unavailable`, now naming both ways of setting one.

### D-4 — The secrets: generated into `./secrets`, never the data volume, and an emergency kit on loopback only

- **Generated at first start, when absent**: `OYL_INSTANCE_SECRET_KEY`, and
  `OYL_INSTANCE_METRICS_TOKEN` when metrics are on. Each is 32 random bytes from the platform's
  cryptographic generator, written atomically with owner-only permissions as one file per secret
  in `./secrets`. They are read from there on every later start, never generated again, and never
  in the `data` volume. **The environment wins**: when a variable is set, it is used and no file is
  written, so an existing install is unchanged (#2781).
- **Why never the data volume.** The `backup` service copies that volume off the box. A snapshot
  holds the instance's keys wrapped under the secret and any hosted model key encrypted under it.
  The secret beside them would make an off-box copy the instance's identity (Context).
- **The mount becomes writable** for `instance` alone, because the process that reads the secret
  must be the one that makes it, with no separate step for an owner to run. *The author's choice*
  (D-9 Q-5). It costs the defence that #2146's read-only mount gave the Discord bot token's file
  against a bug in the instance that overwrites it. It costs nothing against a compromised
  instance, which holds that token in memory anyway. `backup`, `migrate` and `tunnel` still do not
  mount it. #2781 may instead use a separate writable directory under `./secrets` if it keeps
  every property in this decision.
- ⚠️ **Not measured**: whether the permission check works on Docker Desktop for Windows. A bind
  mount from an NTFS folder may report every file as readable by everyone, and #2781's "refuse to
  start if world-readable" would then refuse every Windows install. #2781 measures it on the
  owner's Windows machine before choosing the check.
- **The emergency kit** is one downloaded text file. It holds each generated secret, the
  `OYL_INSTANCE_ORIGIN` they are bound to, the instance card (public), and a few lines on where to
  keep it and how to restore with it. It never holds a setup code, a claim code or any rider's data.
  It is **served on the loopback listener only**, with `Cache-Control: no-store`. It is offered
  **once from the setup session**, on the wizard's secrets step, and after setup is done only from
  an admin session with a fresh passkey assertion (ADR 0069 D-4). It is the off-machine copy that
  makes an off-box backup restorable after the machine is lost. Without it, a restore makes new
  instance keys and every device has to pin again.
- **Why the setup session may download it without a passkey.** Whoever redeemed the setup code read
  it from `./secrets`, beside the secret files, so the kit gives them nothing they did not already
  hold. The exception is software on the owner's machine that has taken the setup session's
  `localhost` cookie (D-2) and cannot read the folder. That residue is accepted and bounded: once
  per setup session, and on loopback only.

**The threat, in D-3's terms.** The edge **cannot** read a generated secret: it is not in any page,
in any log line or in the data volume, and the kit route is `not_found` on the tunnel listener.
Through `host.docker.internal` it reaches the kit route only with a session, which needs a code it
cannot read. **Refused**: the secret in any page but the kit, a kit through the tunnel, and a kit
in the form of a QR (a QR on screen is easier to photograph than a file is to copy).

### D-5 — Confirmation: a six-digit code shown on both screens before the claim completes

- **When the claim code is redeemed**, the instance and the tablet each compute a **six-digit
  comparison code** from the claim code and the claiming device's key. The exact derivation is
  #2782's, but it must include both values and a domain label of its own. The tablet shows its code
  with *"Check that the server shows the same number"*. The loopback page shows the pending claim's
  code and asks whether the tablet shows the same one. **Yes** makes the claim the owner. **No**
  discards the pending claim, voids the claim code and draws a new QR.
- **One pending claim at a time.** A second redemption while one is pending gets the one refusal
  sentence, and the pending claim lapses with its claim code's ten minutes.
- ⚠️ **Why six digits is enough when ADR 0047 D-6 forbids a short fingerprint.** A fingerprint pins a
  key against an adversary with unlimited time to search for a key that matches it. This code only
  tells the owner which of two screens' claims is in flight, and only one claim can be in flight.
  An attacker who redeems first does not have to match anything: the owner's tablet is then
  refused and shows no code at all, which is what the owner notices. Every pin still uses the
  full fingerprint.

**The threat it answers.** Anyone who sees the QR, by looking over the owner's shoulder,
photographing the screen, or using screen-recording or screen-sharing software, or local software
that has taken the setup session's cookie (D-2), holds a claim code for up to ten minutes. Without
confirmation, **the first device to redeem silently becomes the owner**. With it, a claim the owner
did not make waits on the loopback page, where the owner's own tablet shows a refusal instead of a
matching code. **The edge cannot write either screen**: the tablet computes its code itself, and
the loopback page reaches the host's browser with no edge in the path. **What remains, stated
plainly**: software on the owner's machine that holds the setup session can confirm a claim of its
own. That is *detected, not prevented*, because the owner's tablet is refused. The recovery is to
start again from the wizard while setup is not done, or `operator owner-claim reset` after it is.

### D-6 — The settings store: what moves from the environment to the database, and what stays

**The rule for a value that moves** (*the author's choice*, generalising #2608 and #2609): it is not
a secret, changing it needs no restart and no new bind mount, it binds no key, and a surface that
this ADR or a later one allows sets it. **While a database row holds it, the database wins** over
the environment. **Clearing the row returns to the environment**, so an install that never sets it
behaves exactly as today. The owner key is the one exception: D-3 lets the environment win, for
the reason given there.

| Value | Where it lives after this ADR | Set by | Why |
|---|---|---|---|
| Owner key | `OYL_INSTANCE_OWNER_KEY`, else the database | `.env`, or the claim (D-3) | Environment wins (D-3) |
| `OYL_INSTANCE_SECRET_KEY`, `OYL_INSTANCE_METRICS_TOKEN` | the environment, else a file in `./secrets` | `.env`, or the first start (D-4) | Secrets: never the database, which is backed up |
| Registration mode | the database, else `OYL_INSTANCE_REGISTRATION` | the wizard's step, and **`operator registration set \| clear`** | The wizard's step needs it. Database wins, because the compose file and the image always set the variable (`approval`), so "environment wins" would let the wizard set nothing. Operate and `/admin` still only show it (D-9 Q-3) |
| Analysis model, offered sources | the database, else the environment | Operate (#2609) | Unchanged: the precedent |
| Backup folders (`OYL_BACKUP_DIR`, `OYL_OFFBOX_DIR`) | the environment only | `.env` | **They are bind mounts on the `backup` service.** A container cannot choose a host folder, and changing one means re-creating that service. The wizard's backup step **checks and explains**: it shows whether both folders are mounted, distinct and writable, says in plain words what the off-box folder must be, and names the line to change. It does not choose a folder |
| `OYL_INSTANCE_ORIGIN` | the environment only | `.env` | Binds the instance keys and every tunnel passkey (ADR 0069 D-1). #2790 decides remote access |
| `CLOUDFLARE_TUNNEL_TOKEN` | the environment only | `.env` | A secret, and `cloudflared`'s rather than the instance's. #2791 decides how it is made |
| `OYL_INSTANCE_ADMIN_PAGES`, the loopback port, `OYL_INSTANCE_ADMIN_ADDRESSES`, `OYL_INSTANCE_TRUSTED_PROXIES` | the environment only | `.env` | Opening a login surface is the operator's choice (ADR 0069 D-2), and the network values must match the compose file |
| The legal and contact details, the terms file, public rooms | the environment only | `.env` | Not part of Phase 1. A later issue may move them under the rule above |
| Everything else in `.env.example` | the environment only | `.env` | Unchanged until an issue names it |

**The threat, in D-3's terms.** The edge **cannot** write any value in the database's column: the
owner key is written only through the sealed claim confirmed on loopback, and the registration
mode only through the loopback setup session or the host's command. Neither is reachable from
`/admin` or any plaintext route.

### D-7 — The wizard's states, and what a setup session may do

- **Three states, held in the database**: *unclaimed* (D-3), *claimed, setup open*, and *done*. A
  setup code can be minted and redeemed in the first two. `/setup` is `not_found` in the third.
  #2784's acceptance criterion *"`not_found` on loopback once the owner is claimed"* means
  **done**: the wizard's steps after the claim run while the owner is claimed and the setup is open.
  An instance started with `OYL_INSTANCE_OWNER_KEY` set begins in *done*.
- **What a setup session may change, and only while the setup is not done**: mint the claim code
  and confirm or discard a pending claim (D-3, D-5), download the emergency kit once (D-4), set the
  registration mode (D-6), mint **one** rider invite shown as a loopback QR (#2783), and finish.
  Each change writes the operator log. *The author's choice*, and D-9 Q-7 asks the owner. It is
  narrower than ADR 0069 Q-A's *"every change needs a fresh passkey"*, which governs `/admin`, and
  this is why: before setup is done there is no passkey to ask for, and whoever holds the session
  read the code from the host's file system. The residue, software on the machine that holds the
  cookie, is D-5's.
- **The passkey step is optional, and follows ADR 0069 exactly**, including its amendment of
  2026-11-15: a passkey enrolled in the wizard reads and changes nothing until it is confirmed on
  the host. D-9 Q-6 asks whether the owner's claimed device may confirm it instead, sealed, so that
  a non-technical owner needs no terminal.
- **Finishing** shows a summary of every change the setup session made, ends the session, deletes
  `setup-code`, and moves to *done*. Leaving and coming back resumes at the step the database
  records (#2784).
- **The operator log** gains entries for minting a setup code, a claim that is pending, confirmed,
  discarded or reset, generated secrets, a kit downloaded, a registration mode set, an invite
  minted, and setup done. Refusals are coalesced as ADR 0069 D-8 coalesces them. No entry names a
  code, a key, a secret or an address. #2781, #2782 and #2784 add the actions and their migration.

### D-8 — What this supersedes, and what it leaves standing

**Superseded in part, by name:**

1. **ADR 0069 D-5**, its *"serves `/admin`, its script and its stylesheet, and nothing else"* and
   *"What the loopback listener allows that the tunnel does not: exactly one thing"*. The loopback
   listener also serves `/setup` (D-1), the claim QR (D-3), an invite QR in setup (D-7) and the
   emergency kit (D-4). It runs on a fresh instance with the admin pages off (D-1). D-5's ban on an
   address or header check for locality stands. Nothing here relies on one.
2. **ADR 0069 D-1** and **ADR 0046 D-9 Q9**, where each names `OYL_INSTANCE_OWNER_KEY` as the owner's
   key. Read now as *the owner key* of D-3: the variable when it is set, otherwise the claimed key.
3. **The owner's ruling of 2026-11-14 on #2601**, *"the registration mode is shown, not changed at
   runtime"*, for the setup wizard and `operator registration` only (D-6). Operate and `/admin` still
   only show it.

**Left standing, by name:**

- **ADR 0036 D-3.** (a) Nothing that works with no instance needs one: setup changes nothing in the
  client except the Connect form's scanner (#2785), and `apps/web/src/privacy/no-network.test.ts`
  still admits one module. (b) and (c): no device copy is deleted, and no data is moved to the
  instance. (d) The claim carries a device key and a code and no rider's data. **D-7**: nothing here
  is paid. Phase 1's honest limit is the epic's: the tablet still needs an `https://` origin, which
  today means a domain (#2790).
- **ADR 0047 D-6**: the loopback QR is a source the edge cannot write, of the same kind as
  `operator instance-key show` and the loopback Keys page. The fingerprint is never truncated, and
  the card is scanned inside the app.
- **ADR 0047 D-8 and D-11**: the claim is a sealed, signed request, and its route is `sealed: 'only'`.
- **ADR 0069 D-1's codes and passkeys, D-3, D-4, and its amendment of 2026-11-15**: the setup code is
  an ADR 0069 code with a narrower place to redeem it, and a passkey enrolled in the wizard is
  unconfirmed until confirmed on the host.
- **ADR 0004 D, and ADR 0069 D-4's rule** that no secret, code or coordinate appears in a page, an
  error or a log line.
- **No trainer control** is reachable from any surface here (CLAUDE.md §6).

### D-9 — Questions for the owner

Each has the author's recommendation, which the ADR above already follows. The owner's answer on
the pull request decides it.

- **Q-1 (the epic's question 1) — May the setup code be printed to the container's standard output?**
  **Recommended, and recorded as a Maintainer decision: no.** It goes to `secrets/setup-code`, and
  standard output says where (D-2).
- **Q-2 (the epic's question 2) — If both a claimed owner and `OYL_INSTANCE_OWNER_KEY` exist, which
  wins?** **Recommended, and recorded as a Maintainer decision: the environment, and a claim is
  refused while it is set** (D-3).
- **Q-3 — May the wizard and the operator command set the registration mode, with the database
  winning over `.env`**, against the 2026-11-14 ruling that it is shown and not changed at runtime?
  **Recommended: yes**, and Operate and `/admin` still only show it (D-6).
- **Q-4 — Should a claim need the six-digit confirmation on both screens?** **Recommended: yes**
  (D-5). Without it, anyone who sees the QR in its ten minutes can become the owner unnoticed.
- **Q-5 — May `instance` mount `./secrets` read-write**, so that it can write the generated secrets
  and the setup code? **Recommended: yes**, with `backup`, `migrate` and `tunnel` still not mounting
  it (D-4).
- **Q-6 — May the owner's claimed device confirm a passkey enrolled in the wizard**, sealed, from the
  app, as an alternative to `operator admin-passkeys confirm`? **Recommended: yes, as a follow-up
  issue**, not part of Phase 1. Until then the wizard's passkey step says that it needs the
  command.
- **Q-7 — May a setup session make the wizard's changes without a passkey** (D-7), only while setup
  is not done and only on loopback? **Recommended: yes.** Otherwise the wizard can make no change
  before a passkey is enrolled and confirmed on the host, and the non-technical owner is back at the
  terminal.

## Consequences

### What this enables

- A fresh install with no `openssl`, no pasted owner key and no pasted fingerprint. The owner types
  one code from a file into one page on the host, scans one QR with the tablet, and compares six
  digits.
- An off-box backup that can be restored after the machine is lost, because of the emergency kit.
- No change to any existing install: with `OYL_INSTANCE_OWNER_KEY` and `OYL_INSTANCE_SECRET_KEY` set,
  nothing in this ADR runs.

### What this costs, stated plainly

- **A second page on the loopback listener that the edge can reach on Docker Desktop.** Everything on
  it rests on a file the edge cannot read (D-2). If that file is ever readable by a container other
  than `instance`, this ADR is wrong.
- **`./secrets` becomes writable by the instance** (D-4, Q-5).
- **Software on the owner's machine that takes the setup session's `localhost` cookie** can claim the
  instance and change the wizard's settings. That is detected rather than prevented (D-5, D-7). It is
  the threat ADR 0069 D-3 already lists for a code session, and it is bounded by the setup
  session's life.
- **A lost claimed device needs the terminal** (`operator owner-claim reset`), just as a lost owner
  device needs `.env` today.
- **The wizard cannot choose the backup folders** (D-6). It only checks and explains them. A
  launcher (#2788) may one day write them.

### Constraints this places on other work

- **#2781** builds D-4: generation, the writable mount, the permission check measured on Windows,
  and the kit. Its kit criterion's *"requires … step-up"* holds after setup is done. During setup the
  kit is offered once from the setup session (D-4).
- **#2782** builds D-3 and D-5: the sealed sessionless claim route, the pending claim and its
  confirmation, the comparison code's derivation, the database owner key read on every check, the
  refusal of registration while unclaimed with no athlete, and `operator owner-claim reset`.
- **#2783** builds D-3's claim QR and D-7's invite QR on loopback, as server-rendered SVG.
- **#2784** builds D-1, D-2, D-6's registration mode and backup check, and D-7. It needs a revision
  block before it is built, for three things: its address is `localhost`, not `127.0.0.1` (D-1); its
  *"once the owner is claimed"* means *done* (D-7); and its backup criterion, *"chooses a backup
  folder through the wizard … in the chosen folder"*, cannot be met, because the folders are bind
  mounts (D-6). The criterion becomes: the wizard reports the mounted folders, and "Back up now"
  writes into the mounted off-box folder.
- **#2785** is unaffected, except that the claim QR is one more payload its scanner reads.
- **`docs/operating-an-instance.md`** and **`docs/self-hosting/home-machine.md`** gain each of these in
  the sub-issue that builds it, not here.

## What would make this ADR wrong

- **A container other than `instance` that can read `./secrets`**: then the edge, through a container
  it can route to, could read the setup code, and D-1 to D-4 rest on nothing.
- **A Docker Desktop that publishes the loopback port to the network**, not only to the host's
  loopback, which would put `/setup` in front of the whole LAN.
- **A Windows bind mount on which owner-only permissions cannot be set or checked** (D-4), which
  #2781 measures.
- **The owner ruling Q-7 no**: then the wizard's later steps need a confirmed passkey, and Q-6 becomes
  part of Phase 1.
