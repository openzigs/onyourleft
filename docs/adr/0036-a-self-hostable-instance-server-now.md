# ADR 0036: A full, self-hostable instance server now — owner decision D6 is lifted, and the device stays canonical

- **Status**: Accepted. The owner ruled on 2026-09-28 and the ruling is quoted verbatim in Context.
  **Nothing is built by this ADR.** It is the decision every code issue under
  [#7](https://github.com/openzigs/onyourleft/issues/7),
  [#6](https://github.com/openzigs/onyourleft/issues/6),
  [#16](https://github.com/openzigs/onyourleft/issues/16) and
  [#17](https://github.com/openzigs/onyourleft/issues/17) waits on, first of all
  [#767](https://github.com/openzigs/onyourleft/issues/767)
- **Date**: 2026-09-29
- **Deciders**: **the owner**, in ruling 2 of the
  [comment on #16 of 2026-09-28](https://github.com/openzigs/onyourleft/issues/16#issuecomment-5879636643),
  and in the answers to Q3, Q6 and Q12 in the
  [comment of the same evening](https://github.com/openzigs/onyourleft/issues/16#issuecomment-5880008335).
  The author wrote the wording and decided the engineering content: the list of what D6 touched, the
  invariants in D-3, and which follow-up changes which line. Each point the rulings do not settle is
  marked *the author's choice* where it is made
- **Issue**: [#762](https://github.com/openzigs/onyourleft/issues/762), in bundle
  [#825](https://github.com/openzigs/onyourleft/issues/825) with #763, #764 and #765
- **Number**: **0036**, read from [`docs/architecture.md`](../architecture.md)'s ownership table on
  2026-09-29. That table said the next free number was 0036, with **0034 reserved for
  [#673](https://github.com/openzigs/onyourleft/issues/673)** and 0035 written. This pull request
  reserves **0036 to 0039** for the four decisions of bundle #825 at once, so four branches cannot
  collide on "the next free number" (`CLAUDE.md` §7 records that this has happened twice). 0034 is
  left alone
- **Supersedes**: **owner decision D6** — *"Phase 1 has no server, no account and no network"* — as
  a rule about what may be built. D6 is an owner decision recorded in
  [#1](https://github.com/openzigs/onyourleft/issues/1) Revision 2 and cited by the ADRs below, not an
  ADR of its own, so nothing is superseded "in" a file: every place that restates it is listed in
  D-2 with who changes it. No existing ADR line is edited. [ADR 0002](0002-local-first-architecture.md)
  and [ADR 0028](0028-racing-fairness.md) each gain an appended amendment in the same pull request
  ([ADR 0013](0013-adr-amendments.md))
- **Relates to**: [ADR 0037](0037-instance-runtime-hosting-and-transport.md) (how the instance is built
  and hosted), [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md) (drafting),
  [ADR 0039](0039-racing-another-riders-ghost-on-consent.md) (the cross-rider ghost),
  [ADR 0001](0001-licence.md) (AGPL-3.0 §13), [ADR 0014](0014-portable-identity.md) D-9,
  [ADR 0025](0025-app-store-additional-permission.md) D-7

---

## Context

### What the owner decided, quoted so it is not argued again

Ruling 2 of 2026-09-28, verbatim:

> **Server scope:** a **full instance server now**. This lifts owner decision D6 (no server in
> Phase 1) and brings forward accounts and identity (#6), the sync API and activity ingestion (#7),
> and self-hosting (#17), with race rooms built on top. It needs a recorded superseding decision, and
> CLAUDE.md §1 must change with it.

Ruling 1, the same comment, which fixes the shape the server takes:

> **Hosting:** self-hostable first. One small open-source server anyone can run on a cheap Linux box.
> The same code may also deploy to a managed platform (for example Cloudflare Durable Objects) for the
> project's own public instance. Spikes 0007 and 0013 hold the measurements.

And from the answers the owner gave later that evening, verbatim:

> - **Q3 and Q6, hosting to start:** the project's instance **starts on the owner's local Windows
>   machine**, running Linux inside it (WSL or a **Docker container**), and is reached through a
>   **Cloudflare Tunnel**. There is no hosting bill to begin with. This makes a **Docker image** of
>   `apps/instance` the first deploy target. #790's managed deploy and a paid box come later. The
>   Durable Object adapter (#781) is still built, but is not deployed at first. Q7 (what the managed
>   platform hosts) is therefore moot for now.
> - **Q12, passwords:** none. Device keys and recovery codes only.

### What D6 was, and why lifting it is a decision rather than an edit

D6 said the first milestone is entirely local: no server, no account, no hosting bill. It was the
right first cut and it bought the repository what it has now — a client whose every feature works
with the network off, and a store whose canonical artefact is a signed file on the device. **This ADR
keeps everything D6 bought and removes only the prohibition.** That is why D-3 below is as long as
D-1: the invariants are the part of D6 that survives, and they are written as sentences a test can
hold.

D6 is not one sentence in one place. It is load-bearing in six places in the tree and one in the
tracker, and D-2 names each.

---

## Decision

### D-1 — An instance server is built now, inside this repository, as `apps/instance`

1. **One server workspace package, `apps/instance`**, under `apps/` and therefore
   `AGPL-3.0-or-later` by path (`CLAUDE.md` §3). The name is the owner's (Q15, accepted 2026-09-28).
   ⚠️ **Not `apps/api`**: every sentence in the tree that forbids `apps/api` forbids a name nobody is
   going to use, and #766 rewrites them to name the real package rather than deleting them.
2. **It does ADR 0002 C's four things and nothing else**: reachability, indexing, authority and
   enforcement. Accounts (#6), sync and ingestion (#7), self-hosting (#17) and race rooms (#16) are
   built on it, in the order #16's delivery queue of 2026-09-29 gives.
3. **Self-hostable is the deployment model, not a courtesy** (ADR 0002 A, unchanged). The same code
   may later also run on a managed platform; [ADR 0037](0037-instance-runtime-hosting-and-transport.md)
   decides how.
4. **No passwords** (Q12). An account is a device key with one-time recovery codes (Q1), which #772
   and #774 build against [ADR 0014](0014-portable-identity.md).

### D-2 — Every place D6 is load-bearing, and who changes it

| Where | What it says today | Changed by |
|---|---|---|
| `CLAUDE.md` §1 | *"There is no server in Phase 1. Do not add one, do not scaffold `apps/api`…"* | [#766](https://github.com/openzigs/onyourleft/issues/766), once `apps/instance` exists. ⚠️ **Not this pull request**, deliberately: a `CLAUDE.md` that describes a package the tree does not contain is the "documented command nobody has run" §4a warns about. Until #766 lands, §1's sentence is **overridden by this ADR** and a reader who meets it should read this one |
| `CLAUDE.md` §4b | *"`apps/api`, or anything else server-shaped. Not 'not yet' — not in Phase 1 at all."* | #766 |
| `pnpm-workspace.yaml` | *"There is deliberately no `apps/api` entry: Phase 1 has no server (owner decision D6)"* | [#767](https://github.com/openzigs/onyourleft/issues/767), which adds the `apps/instance` entry and replaces the comment |
| [ADR 0002](0002-local-first-architecture.md) B, and its header, Context, constraint 1 and Notes | *"Phase 1 is entirely local (owner decision D6)"* | **This pull request**, by an appended amendment. The decision in B — the device owns the data — is **not** changed; see D-3 |
| [ADR 0028](0028-racing-fairness.md) D-0 and its 2026-09-22 amendment | *"Only the first block stands: there is no server in Phase 1"* | **This pull request**, by an appended amendment. See D-4 |
| [ADR 0005](0005-tech-stack.md) F | *"Phase 3, the instance — deferred to #7"* | [ADR 0037](0037-instance-runtime-hosting-and-transport.md), which discharges the deferral, and an appended amendment to ADR 0005 in this pull request |
| [ADR 0005](0005-tech-stack.md) J | *"Real-time transport: deferred to #16"* | ADR 0037, the same way |
| [#1](https://github.com/openzigs/onyourleft/issues/1) Revision 2 | D6's row | A comment on #1 pointing here, posted with this pull request. #1's body is the owner's and is not edited by an agent |

**What is not in that table, and why.** ADR 0002's four other mentions of D6 (the header's Deciders
line, Context, constraint 1 and Notes) all restate the same fact and are covered by the one
amendment. [ADR 0014](0014-portable-identity.md)'s *"Nothing publishes a record. There is no
transport in Phase 1 (owner decision D6)"* is still **true** today — no transport exists yet — and
becomes false when #776 ships sync; D-5 records that trigger instead of amending a sentence before it
is wrong.

### D-3 — What does NOT change, as sentences a test can hold

The instance **adds** reachability, indexing, authority and enforcement. It does **not** take
ownership. Four invariants, each with what holds it:

**(a) No feature that works with no instance today may start to require one.** Recording, the store,
pairing, trainer control, the game, the library, analysis, routes, workouts, import and export all
work with the network off (ADR 0002's 2026-09-19 amendment, and the browser gate's offline spec,
`apps/web/browser/offline.browser.spec.ts`). A rider who never connects to an instance is a **fully
supported state and loses nothing** that works today.

- **What holds it**: `apps/web/src/privacy/no-network.test.ts` §`PERMITTED_NETWORK_CALLS` gains
  entries for **exactly one module** for instance traffic — the connection module
  [#777](https://github.com/openzigs/onyourleft/issues/777) builds — and nothing else. Its HTTP
  `fetch` and its WebSocket are both in that one module; [#782](https://github.com/openzigs/onyourleft/issues/782)'s
  net layer opens its room socket **through** it rather than naming a network primitive of its own.
  *The author's choice*: #762 names "#782 / #777", and one module for both is the narrower reading.
  A second module gaining an entry is a change to this ADR, not a review note.
- **What else must stay green**: `offline.browser.spec.ts` unchanged. A feature moving behind a
  network call makes that spec red, which is the point.

**(b) The device copy is never deleted on an instance's confirmation.**
[#47](https://github.com/openzigs/onyourleft/issues/47)'s upload queue removes a ride from its
**queue** when the instance confirms it, and never removes it from the **store**. ADR 0002 B's
sentence — *"The signed file plus its signed summary is the canonical artefact"* — is the reason: a
server acknowledging a copy does not make the server's copy the canonical one. #47 carries the test
(an upload confirmed, then the store read back on a fresh connection, and the ride still there).

**(c) The instance never becomes the only place a rider's data is.** An erase on the instance
(ADR 0002 C's *enforcement*) removes the instance's copy. It does not reach the device, and nothing
the instance sends may delete a device row. Leaving an instance costs a re-sync (ADR 0002 D), never
the history.

**(d) Nothing the client already refuses to send starts to leave through the instance.** ADR 0004's
strip-before-upload is the client-side layer and the instance's enforcement is the second (ADR 0002
constraint 2). Camera imagery stays on the device ([ADR 0029](0029-camera-imagery-as-a-data-class.md)),
and the rider's own analysis endpoint ([ADR 0035](0035-model-written-ride-write-ups.md)) is the
rider's computer, not this instance.

### D-4 — ADR 0028 D-0's last block is lifted by this ADR, and no other block is re-imposed

ADR 0028 D-0 had three blocks. Its 2026-09-22 amendment recorded the owner lifting the counsel block
(#488 Q6) and discharging the five-questions block, and ended: *"⚠️ **Only the first block stands**:
'there is no server in Phase 1'"*. **This ADR lifts that one**, because the block was D6 and D6 is
what this ADR supersedes.

- **Nothing else is re-imposed.** The counsel block stays lifted on the owner's #488 Q6 answer. The
  five questions stay answered.
- **What still binds a room is unchanged**: ADR 0028 D-1 to D-7 and its amendment's publication rule
  (*"a room publishes the power OR the power-to-weight, never both"*); D-6.4's block on a **public**
  room until moderation and identity exist ([#83](https://github.com/openzigs/onyourleft/issues/83);
  the owner's Q5 answer of 2026-09-28 adds 18+ self-declaration and approval-required registration);
  and D-7's patent constraints.
- **Drafting** is [ADR 0038](0038-drafting-in-the-first-multiplayer-release.md)'s, which supersedes
  D-5 alone. **Ghosts in a live room** stay forbidden: D-7.4 is not touched by this ADR or by
  [ADR 0039](0039-racing-another-riders-ghost-on-consent.md).

### D-5 — ADR 0014 D-9's "provisional" ends when sync ships

[ADR 0014](0014-portable-identity.md) D-9 says the record format is *"version 1 and provisional"*
while *"there are no records in the world"*, and that *"Once #56 breaks down and records exist beyond
one device, a change is a **migration**."* Two-way sync puts records on a second device and on an
instance before federation (#56) does, so **the trigger is sync, not federation.**
[#776](https://github.com/openzigs/onyourleft/issues/776) finalises the format, and from the day it
merges a change to the record is a migration with a tested down path, never an edit. *The author's
reading*: D-9's own reason ("records exist beyond one device") is what fires, and #56 was the
expected first cause of it rather than a condition of its own.

### D-6 — The licence consequence: a network server under AGPL-3.0 §13 offers its source

`apps/instance` is `AGPL-3.0-or-later` (D-1). AGPL-3.0 §13 requires that a modified version which
users interact with **remotely through a network** offers those users the Corresponding Source. The
client already discharges this for itself: `apps/web/src/privacy/policy.ts` §`SOURCE_CODE_URL` on the
About screen ([ADR 0025](0025-app-store-additional-permission.md) D-7).

- **The endpoint that discharges it is `GET /source`**, which returns the URL of the exact source of
  the running build, carrying the build's commit. [#767](https://github.com/openzigs/onyourleft/issues/767)
  builds it and its test asserts the commit is in the URL. *The author's choice* of the two options
  #767 offers ("`GET /source` (or a header on every response — the ADR decides)"): an endpoint can be
  linked from the app and fetched by a person, and a header is invisible to both.
- **A rider meets it through the app, not through `curl`.** #777's connect screen shows the connected
  instance's source link, read from `GET /source`, because the app is the interface through which a
  rider interacts with the instance.
- **Room traffic is the same program**, so a room needs no second offer.
- ⚠️ **An operator who modifies their instance owes the offer for their modification.** `GET /source`
  must therefore report what the operator configures, with this repository's URL only as the default
  for an unmodified build. #767 decides how the value is configured; the rule is that it is never
  hard-coded.

### D-7 — Where the first instance runs, and what is not implied

- **The project's first instance is the owner's home machine**, a Docker image of `apps/instance` in
  WSL or Docker on Windows, reached through a Cloudflare Tunnel
  ([#807](https://github.com/openzigs/onyourleft/issues/807)), per Q3 and Q6.
  [ADR 0037](0037-instance-runtime-hosting-and-transport.md) records what that tunnel constrains.
- **Lifting D6 implies no paid hosting.** The owner's words: *"There is no hosting bill to begin
  with."* A paid box and the managed deploy (#790) come later and each is the owner's call when it
  comes. No issue may take a paid service as a prerequisite.

---

## Consequences

### What this enables

- #767 can scaffold `apps/instance`, and every code issue in #6, #7, #16 and #17's multiplayer phase
  has a recorded decision to cite rather than an issue comment.
- Race rooms (ADR 0028) stop being blocked on a server. Of D-0's three blocks, none is left.
- The self-hosting targets ADR 0002 A wrote down as design targets now have a program to be measured
  against.

### What this costs, stated plainly

- **A second deployable, and a second threat model.** Until today this repository shipped a client
  and nothing that listened on a socket. An instance is reachable from the internet through the
  tunnel, holds other people's data, and receives input from devices it does not control. `SECURITY.md`'s
  classes — cross-athlete exposure, location in an error message, untrusted input — apply to it from
  its first line, and it inherits them rather than adding a new list.
- **No hosting bill is implied.** Lifting D6 commits the project to a server, not to paying for one:
  the first instance runs on the owner's own machine behind a Cloudflare Tunnel (D-7, #807), and any
  paid box or managed deploy is a later decision of the owner's.
- **The home machine is the first production host**, with a home connection's upload, a machine that
  sleeps and reboots, and no second site. #807 owns backups, sleep and reboot. A rider's data on the
  instance is a **copy** (D-3.b), so an outage costs reachability and never history.
- **The CI job grows.** `apps/instance` runs inside the one required `Repository rules` job
  (`CLAUDE.md` §4c), which already takes 933 s on its slower runner.
  [#771](https://github.com/openzigs/onyourleft/issues/771) decides how it fits.

### Constraints this places on other work

| Issue | Constraint |
|---|---|
| #766 | Rewrites `CLAUDE.md` §1, §2 and §4b to name `apps/instance`, and cites this ADR. It keeps a sentence saying that the device is canonical and that a rider without an instance loses nothing (D-3) |
| #767 | Replaces `pnpm-workspace.yaml`'s D6 comment; builds `GET /source` (D-6); lands inside every licence, wiring and notices gate |
| #777 | Is the one module D-3.a admits; shows the instance's source link (D-6) |
| #782 | Opens its socket through #777's module and names no network primitive itself |
| #47 | Never deletes a device row on confirmation (D-3.b), with the read-back test |
| #776 | Finalises ADR 0014's record format (D-5) |
| #807 | Runs the first instance on the owner's machine; takes no paid dependency (D-7) |

---

## What would make this ADR wrong

- **A feature that works offline today starts to need the instance.** Then D-3.a was written and
  ignored. `offline.browser.spec.ts` and `no-network.test.ts` are the two places that go red; a
  change that edits either to make room for a second instance module is the change to stop.
- **The instance becomes the canonical copy in practice** — a server-side edit a device cannot
  reproduce, or a "restore from instance" that overwrites a device row. Then ADR 0002 B no longer
  describes the program and needs a superseding ADR, not an amendment.
- **Hosting turns out to need a paid service after all** — for example the home upload cannot carry
  one room (ADR 0037 D-7 gives the arithmetic). Then D-7's "no bill" becomes the owner's decision
  again, and #790 moves earlier.
- **Nothing mechanical checks D-1, D-2, D-4, D-5 or D-7.** ADR 0007's *"Which of D1–D7 a machine
  checks: none of them"* applies to them. D-3.a and D-6 are the only decisions here with a test
  behind them: `no-network.test.ts`, and #767's commit-in-the-URL test.
