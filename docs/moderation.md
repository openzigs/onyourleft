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
each other's names, and neither can act on themselves. If the deputy has to go, change the setting.

## What a rider can do

| Action | What happens |
|---|---|
| **Block** a rider | Neither rider can see or reach the other, whoever blocked whom. The blocked rider is not told: every request they make about the blocker gets exactly the answer a request about nobody gets. |
| **Unblock** | Removes the rider's own block. It cannot remove a block the other rider made. |
| **Report** a rider | Sends the rider's id and a reason (up to 1,000 characters) to your queue. A rider can make at most **5 reports an hour**. A rider can report someone they have blocked. The answer is the same whether or not that rider exists. |

## What a moderator can do

Every action needs a **reason**. Each action is written to the **moderation log** in the same
database transaction that makes the change. So an action is either both applied and logged, or it
does not happen.

| Action | Route | Effect |
|---|---|---|
| Read the report queue | `GET /v1/moderation/reports` | Every report not yet decided, oldest first: who reported whom, why, and when. |
| Dismiss a report | `POST /v1/moderation/reports/{id}/dismiss` | Removes it from the queue. |
| Hide a display name | `POST /v1/moderation/athletes/{id}/hide-display-name` | Other riders see "Rider" instead of the name. The rider still sees their own name. The hide ends when the rider chooses a new name, because a new name is new content. |
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
  to get past is your registration mode (below): with approval-required registration, a banned
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
