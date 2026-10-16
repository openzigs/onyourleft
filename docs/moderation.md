# Moderating an instance

This page is for the person who runs an On Your Left instance. Read it **before** you start one:
running an instance that other people can join makes you its moderator. This page covers what the
software lets you do about that, and what it does not.

The instance server is `apps/instance`. Everything below is the server's behaviour; the app on a
rider's device keeps its own copy of every ride and is not affected by anything here.

## Who moderates

An instance has **one moderator**: you, the **owner**. You may also name a **deputy**, but you do
not have to, and the software does not expect one. The owner of this project ruled on 2026-09-30
([#905](https://github.com/openzigs/onyourleft/issues/905)) that the project's own instance has one
moderator, the owner, and no deputy. That reverses the earlier answer to Q13 (#16, 2026-09-28),
"the owner plus a named deputy".

A moderator is named by a **device key**: the 64-character hex public key of their phone or
browser, which the app can show. The instance reads two settings:

| Setting | What it names |
|---|---|
| `OYL_INSTANCE_OWNER_KEY` | the moderator's device key: yours |
| `OYL_INSTANCE_DEPUTY_KEY` | optional, and usually **empty**: a second moderator's device key |

The athlete who holds the named key, and has not revoked it, holds the role. A key is named, not an
account, so you can name yourself before your account exists. Without that, with approval-required
registration, nobody could ever approve the first account. If you revoke the named key, you lose
the role until the setting names another key.

A moderator cannot act on a moderator. You cannot suspend yourself or hide your own name, and with a
deputy named neither of you can do that to the other. Each such attempt changes nothing, and it
**is** written to the moderation log, as `refused_suspend`, `refused_hide_display_name` and so on,
so you can see who tried.

### A report about the moderator

Riders can report you. What happens to that report depends on how many moderators are named:

- **You are the only moderator** (the usual case, and the project's instance). Nobody else could
  ever decide it, so you do. The Moderation screen marks it as being about you, and offers one
  choice: **Dismiss**. The reason you give is your **declaration of the conflict**: say that the
  report was about you, and why you dismissed it. The log records it as `dismiss_own_report`, never
  as an ordinary dismissal, so anyone reading the log sees that you decided a report about yourself.
  This is the owner's procedure for the project's instance
  ([notice-and-action](moderation/notice-and-action.md#a-notice-or-complaint-about-the-moderator)).
  If the report is about something you wrote, such as your display name, you can change it
  yourself.
- **A deputy is named.** You may not decide a report about yourself: the other moderator decides
  it. An attempt changes nothing and is logged as `refused_dismiss_report`. If the deputy has to go,
  empty the setting.

### When the only moderator is away

Nobody covers for you, and that is stated publicly: **a report may wait up to 7 days** for a
decision, the target the owner set for the project's instance (owner's ruling on #905, 2026-10-15;
[target times](moderation/notice-and-action.md#target-times)). If you will be away for longer than
that, switch public rooms off until you are back (public rooms are not built yet: #788). Reports wait in the queue and none is lost.

⚠️ **If you signed in before you set your key**, your account registered like anybody else's: with
approval-required registration it is waiting for approval, and nobody may approve a moderator. So
the next time a device holding a named key signs in to an account that is waiting, the instance
activates it and writes `activate_moderator_key` to the log. Set the setting, restart, and sign in
again.

⚠️ **That rescue covers an account that is waiting, and only that.** An account that was **refused**
or **suspended** before its key was named stays locked out after you name the key (#899). Only a
waiting account is activated at sign-in, and nobody may act on a moderator, so nobody can lift that
suspension once the key is named. To recover:

1. **Suspended, and some moderator can still act on it.** Empty the setting that names the key and
   restart. A moderator lifts the suspension, which is written to the log. Then name the key again
   and restart.
2. **Refused, or nobody else can act on it.** A refusal cannot be undone, so name a **different**
   device key instead: one from a device the instance has never seen. A key the instance has never
   seen registers active in every mode, so that device's new account holds the role. The old account
   stays as it was. A suspended rider can still export or delete it through the way-out session (see
   "What a suspension does not do").

## Who can join: the registration modes

`OYL_INSTANCE_REGISTRATION` sets how the instance takes new riders, in any case (`Closed` is
`closed`). **If it is not set, the mode is `approval`** (the owner's ruling on #775, 2026-10-15):
a new rider's account waits for you, and only the keys you name register active. Before that ruling
an unset mode was `closed`. The project's own image sets `approval` too (#16, Q5 and Q13).

| Mode | A device key the instance has never seen… |
|---|---|
| `approval` (the default, and the project's image) | registers an account that **waits** for a moderator. While it waits, the rider can see their own account, name themselves and confirm their age, and nothing else. Other riders cannot see them. |
| `invite` | registers only with a single-use invitation a moderator minted (`POST /v1/moderation/invites`, good for seven days). The invitation is spent in the same transaction that registers the account. |
| `open` | registers an active account at once. |
| `closed` | is refused. |

The key named in `OYL_INSTANCE_OWNER_KEY`, and in `OYL_INSTANCE_DEPUTY_KEY` if it names one,
registers active in every mode.

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

## Notices from anybody: the notice page

Every instance serves a **notice page** at `/report` (#907). Anybody can use it, with or without an
account and with or without the app, to tell you about content on your instance that they think is
illegal. The app links to it from *About*, on the instance the rider connected to. It is a plain
form that runs no script, so it works with a keyboard and a screen reader.

A notice carries what the EU Digital Services Act's Art. 16(2) asks a notice to be able to carry:

| Field | Required |
|---|---|
| Why they think it is illegal | yes |
| Which items: one identifier a line, which the app shows, or where it is in words | one of the two |
| Their name and email address | **no**, never, for a notice of illegal content |
| A statement that they believe in good faith it is accurate and complete | no |

An identifier is one line: `rider:<athlete id>` (a display name), `room:<room id>`, `route:<room id>`
(the route a room is ridden on), or `result:<room id>:<row>` (one row of a race's published result,
counted from 1). The app shows a race's route and rows under the result, as *References*.

The page also offers the UK Online Safety Act's **intimate image content report** (s.20A) as a
separate choice. That one needs all three of its statements and an email address, because s.20A(2)
says that is what such a report is. **Take the content down within 48 hours** of receiving it
(s.10(3A)). The Moderation screen says so on the notice.

**Read them on the Moderation screen**, under *Notices* (`GET /v1/moderation/notices`): every notice,
oldest first, with the time it arrived and the notifier's name and email address if they gave them.
**The instance sends no email.** Where a notice gives an address, write to it yourself to confirm you
received it, and again with what you decided (the owner's ruling of 2026-10-15 for the project's
instance). The wording is in [statements of reasons](moderation/statement-of-reasons.md).

A notice is kept as it was received. Like the moderation log, it is **append-only in the schema**,
and erasing an account does not delete a notice about it. `migrate … down` refuses to undo migration
0026 while a single notice is held.

**Record what you do about each notice** (#912). The instance sends no email, so it cannot know when
you confirmed receipt or told the notifier what you decided. Under each notice the Moderation screen
offers the next step, and records it with the time:

| Step | When it is offered |
|---|---|
| *I have confirmed receipt* | the notice gave an email address, and you have written to it (DSA Art. 16(4)) |
| *Record the decision* | always: what you decided, in the words you tell the notifier, and the number of the log entry of any action you took |
| *I have told them the decision* | the notice gave an address, and the decision is recorded (Art. 16(5)) |

Each step is recorded once and cannot be changed afterwards: like the log, the record is append-only
in the schema (`POST /v1/moderation/notices/{noticeId}/steps`). An appeal carries its own steps
(below).

**The record** (`GET /v1/moderation/record`, *Prepare the record* on the Moderation screen, saved as a
JSON file) lists every notice and appeal with when it was received, acknowledged, decided and told,
the decision, and the log entry of any action. It is your evidence of what you were told and what you
did (the UK Online Safety Act's s.23). **It holds no personal detail of a notifier**: not their name,
not their address, and not the words they typed, which may hold either. It says only whether they gave
a name and an address. Nor does it hold a rider's grounds for an appeal. A rider is named only by
account id, which after erasure resolves to nobody, as in the log.

**Limits, with no account and no stored address:** at most **5 notices an hour from one client
address**, counted in memory as the sign-in limits are, so a restart resets them; and at most **100 an
hour across the whole instance**, counted from the notices themselves, so a restart does not. A form
that has to be corrected is not counted. Behind a proxy, the per-address limit reads the address the
way registration does (see *Behind a proxy or a tunnel*, above). Nothing the notifier types is written
to the instance's log: the log records the route, the status and the time.

## What a moderator can do

Every action needs a **reason**. Each action is written to the **moderation log** in the same
database transaction that makes the change. So an action is either both applied and logged, or it
does not happen.

| Action | Route | Effect |
|---|---|---|
| Read the report queue | `GET /v1/moderation/reports` | Every report not yet decided, oldest first: who reported whom, why, and when, and `soleModerator`: whether this instance names one moderator only. |
| Dismiss a report | `POST /v1/moderation/reports/{id}/dismiss` | Removes it from the queue. A report about you is logged as `dismiss_own_report` when you are the only moderator, and refused when a deputy is named (see "A report about the moderator"). |
| Hide a display name | `POST /v1/moderation/athletes/{id}/hide-display-name` | Other riders see "Rider" instead of the name. The rider still sees their own name. The hide ends when the rider chooses a **different** name, because a new name is new content. Choosing the same name again keeps it hidden. |
| Suspend an account | `POST /v1/moderation/athletes/{id}/suspend` | Every device key the rider holds is refused at sign-in, every session they had ends at once, and other riders stop seeing them. **Nothing they own is deleted.** |
| Hide one item | `POST /v1/moderation/items/hide` | One room's listing (`room:<room id>`), the route shown in a room (`route:<room id>`), or one row of a race's result (`result:<room id>:<row>`), by the reference a notice names it by (#913). Needs a statement of reasons, which the item's owner is shown. **Nothing is deleted** and the rest is left alone. A hidden row is shown to everybody else as "a rider" with no figure, and to its own rider as before. A hidden route is shown to no member but the room's maker. A room whose listing is hidden takes nobody new by its code. An appeal that reverses it shows the item again. |
| Lift a suspension | `POST /v1/moderation/athletes/{id}/unsuspend` | The rider can sign in again and is visible again. |
| List suspended accounts | `GET /v1/moderation/suspended` | Every suspended account, most recently suspended first, a page at a time (`?limit=`, `?cursor=` from the page before). So you can lift a suspension without finding the id in the log (#961). |
| Read the log | `GET /v1/moderation/log` | Every action ever taken, **newest first**, a page at a time: `?limit=` (1–200, default 50) and `?cursor=` from the page before, which reaches further back. ⚠️ Until #961 it was every action in one answer, oldest first. |

An action on a person can name the report it decides (`reportId`). That closes the report, with the
action recorded as its outcome.

### Statements of reasons

**Suspending an account and hiding a display name each need a statement of reasons** (#910), which
the rider is shown. Without one the instance refuses the action, and nothing changes. It is what the
EU Digital Services Act's Art. 17(3) asks for, as `statement` in the action's body, and the Moderation
screen asks for it in the action's confirmation:

| Field | What to write |
|---|---|
| `facts` | what they did: the facts you relied on. Required, at most 2,000 characters |
| `decidedOn` | `report`, `notice` or `own_initiative` |
| `legalGround` | the law it breaks and why, if you decided it is illegal |
| `termsGround` | the terms it breaks and why, if you decided it breaks them. Give at least one of the two |
| `notifierNamed` | only if the rider cannot see why without it (DSA recital 54). Leave it out otherwise |
| `moderatorConflict` | `true` when the matter involves you: the statement declares the conflict |
| `endsAt` | when the restriction ends, if it does (Unix seconds). Leave it out for no end date |

**Never write a place or a coordinate into a statement.** A field that looks like one (two decimal
numbers with four or more places, or a degree sign) is refused. The reason you give for the log is
not shown to the rider: the statement is.

The statement is kept with the log entry, written in the same transaction, and, like the log, it is
**append-only in the schema**. The rider reads their own statements on the Instance screen
(`GET /v1/statements`). The statement says that no automated means were used, gives your contact
address (`OYL_INSTANCE_CONTACT_EMAIL`) as the way to ask for the decision to be looked at again, and
names a court as the other route. **A suspended rider reads theirs too**, through the way-out session
(below), which reaches their statements and nothing more. Nobody else's statements are shown, and a
report's or a notice's sender never is, unless you named them.

### Appeals

A rider can **appeal** a decision a statement explains (#911): on the Instance screen, beside the
statement, they say why it is wrong (`POST /v1/statements/{statementId}/appeal`, at most 2,000
characters). **A suspended rider can appeal too**, through the way-out session, which grants them
nothing else. Each decision can be appealed once. An appeal is kept with the statement it names.

Appeals wait in the Moderation screen's *Appeals* (`GET /v1/moderation/appeals`), oldest first, with
what the statement said. Decide each one (`POST /v1/moderation/appeals/{appealId}/decide`):

| Outcome | What happens |
|---|---|
| **Uphold** (`upheld`) | The restriction stands. |
| **Reverse** (`reversed`) | The suspension is lifted, or the display name is shown again, **in the same transaction** as the log entry. A restriction already lifted, or a name the rider has since replaced, stays as it is. |

Either way, your answer is shown to the rider and written to the log, as `uphold_appeal` or
`reverse_appeal`. An appeal is decided once: the schema refuses to change a decided appeal or to
delete one, and erasing the account keeps it, as it keeps the log.

**An appeal against your own decision.** With one moderator, every appeal is against a decision you
took. The owner ruled on 2026-09-30 that the moderator decides it, declares the conflict and logs it.
So you may decide it, the screen says it is a conflict, and the rider is told that the moderator who
decided the appeal took the decision appealed. The appeal records the conflict. A complaint that is
not an appeal against a decision, such as that the instance is not following its own procedure, comes
by the contact address on the legal page (`/legal`).

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

Erasure deletes a rider's own reports and blocks. **Blocks other riders made of them are kept**
(#899): a block is the blocker's row, and deleting it would shrink their list and tell them the id
they blocked had been a real account. A block of an id nobody ever held is kept for the same reason.
Reports other riders made **about** them stay in your queue, so you can still decide them.

⚠️ **Migrating the database back past migration 0007 would delete the log**, so `migrate … down`
refuses to undo 0007 while the log holds a single entry, and changes nothing.

## What a suspension does not do

- **It does not delete anything.** The rider's rides, keys and history stay on the instance and on
  their own device. Suspension must not become a way to destroy somebody's data (#83).
- **It does not reach the rider's device.** Their rides are on their phone. The app's own export
  (#35) reads the phone, not the instance, so a suspension cannot stop a rider taking their own data
  away.
- **It does not stop a rider leaving.** A suspended rider still cannot sign in (#775), but since
  #898 their app can open a **way-out session** (`POST /v1/auth/leave-session`, signed with one of
  their device keys). It lasts an hour and reaches exactly four things: the account export
  (`GET /v1/account/export`) and deleting the account (`DELETE /v1/account`, which needs one of their
  recovery codes or a fresh signature from one of their devices, like anyone's), and, since #910,
  the statements of reasons about their account (`GET /v1/statements`), and, since #911, an appeal
  against one of them. Everything else
  answers `account_suspended`. Lifting the suspension ends the way-out session; they then sign in as
  usual. ⚠️ This used to say lifting the suspension was the only way to give a suspended rider
  their data, and a moderator who remembers that is reading the old file. Deleting the account keeps
  the moderation log, as above.
- **It does not stop a new identity.** A device key costs nothing to make. What a new identity has
  to get past is your registration mode (above): with approval-required registration, a banned
  rider with a new key is back in your queue, not back on your instance.

## Moderation in a room

A room is a group ride or a race (#784, #785). Moderation reaches into rooms in five ways (#789):

| Who | Can | How | Written to the log as |
|---|---|---|---|
| A rider in the room | report another rider, by their seat, with one of three fixed reasons: an offensive display name, cheating, or something else about how they rode | `POST /v1/rooms/{roomId}/reports` | not logged: it is a report, and it reaches your queue with the room's id and the second of the ride it was made in. It counts toward the rider's 5 reports an hour. No screenshot and no position are ever sent |
| The room itself | file a **plausibility flag** as a report, once for each power ceiling a rider breaches (ADR 0028 D-2) | the room's worker, on its own | not logged: a report with **no reporter**, the ceiling's duration and W/kg in it, and never the power trace |
| The **host** of a private room (the rider who made it) | remove a rider from their own room | `POST /v1/rooms/{roomId}/remove`, by seat, with a reason | `host_remove_from_room`, with the room |
| **You**, the moderator | remove a rider from **any** room, deciding a report if you name it | `POST /v1/moderation/rooms/{roomId}/athletes/{athleteId}/remove` | `remove_from_room`, with the room |
| **You** | hide a display name across the instance, or suspend an account: every one of its keys is refused, in rooms as everywhere | the routes above | `hide_display_name`, `suspend` |

A removed rider's socket is closed at once. They cannot come back into that room: the room refuses
them, and the instance refuses them a ticket for it for as long as the room lasts. A race counts
them as not finishing. Nobody may remove a moderator, from any room. The attempt changes nothing and
is logged, as every attempt to act on a moderator is.

**Blocking holds in a room.** In a race, two riders with a block between them, whichever of them made
it, are never sent each other's name. Each sees the other as a rider with no name, and the race's
result shows them the same way. A block made during a ride holds from that rider's next join. A group
ride names nobody to anybody.

What a moderator **cannot** do in a room: watch it, see where anybody is on the road, read anybody's
power, move, pause or pace a rider, or change a room's route. A room has no leader. Its host can
start a race and remove a rider, and can do nothing else.

A rider reports from the ride itself (#789): *Follow* reaches another rider and puts their name on
the screen, *Report* beside it opens the three reasons, and one press of a reason files it. That is
two presses from the name. The app says whether it was sent; it never says what you did about it.

## What you cannot do, yet

- **Act on content other than a name, a room, a route shown in a room, or a race's result.** Since
  #913 each of those can be hidden alone, by its reference. Riders' rides are not shown to other
  riders, so there is no other item to act on.
- **Undo a block for somebody.** A block belongs to the rider who made it.
- **Take down a copy on another instance.** Instances do not talk to each other yet (#56). When they
  do, a moderator's action will reach only their own instance.

## Before you open your instance to the public

The owner ruled (#16, Q5) that **public rooms are 18 and over**. The age is self-declared, and no
date of birth is ever collected. Registration also needs approval. The UK Online Safety Act and EU
Digital Services Act assessments come before public rooms go live. If you run your own instance,
you owe your own.

### Drafts pending owner approval

These are drafts for the project's own instance, written on 2026-09-30 for #886 and #887. None of
them is approved yet, and none of them is legal advice. Public rooms stay off until the owner signs
them off.

- [Illegal content risk assessment](moderation/illegal-content-risk-assessment.md) (UK Online Safety
  Act)
- [Children's access assessment](moderation/childrens-access-assessment.md) (UK Online Safety Act)
- [Notice-and-action, content reports and complaints](moderation/notice-and-action.md) (EU DSA
  Art. 16, and the Act's ss.20–21)
- [Statements of reasons](moderation/statement-of-reasons.md) (EU DSA Art. 17)
- [The DSA's scope, Art. 13 and Art. 19](moderation/dsa-scope.md)
- [Terms of service](moderation/terms-of-service.md) for the project's instance (#909), served at
  `/terms` once approved and named in `OYL_INSTANCE_TERMS_FILE`
- The reading they rest on:
  [spike 0019](spikes/0019-online-safety-act-and-dsa-read-for-the-projects-instance.md)
