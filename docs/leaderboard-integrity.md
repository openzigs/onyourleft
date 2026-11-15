# Leaderboard integrity

How an instance keeps a segment's leaderboard worth trusting
([#69](https://github.com/openzigs/onyourleft/issues/69)). It does this in two separate ways. The
**automatic rule** removes efforts that are physically impossible. The **community flag** handles
what the rule cannot see. Neither one deletes anybody's ride.

The rule lives in code at `packages/domain/src/segment/integrity.ts`, and the instance applies it
in `apps/instance/src/segments/segments.ts`. A test, `apps/instance/src/segments/integrity.test.ts`,
fails whenever this page and the code disagree.

## The automatic rule

An effort's **implied speed** is the segment's own length divided by the effort's elapsed time. The
instance measures the length from the segment's path; it never takes a length the publisher
claimed. If the implied speed is above the ceiling for the sport, the effort is **excluded**:

| Sport | Ceiling | Why there |
| --- | --- | --- |
| Ride | **27.8 m/s** (100 km/h), averaged over the whole segment | Professional descents peak near 100 km/h, but they do not average it over even 400 m, the shortest a segment may be. A car on a main road, a train and a GPS jump all go faster than this |
| Run | **10.5 m/s** (37.8 km/h) | This is faster than the average speed of the men's 100 m world record (10.44 m/s), and it would have to be held for at least 400 m. No runner can do that; a bicycle, a car or a GPS jump can |

The rule is applied in two places:

- **On the rider's device**, when it matches a ride. An impossible time is never the rider's own
  personal best.
- **On the instance**, when the effort is shared. A device is not trusted to decide what goes on a
  board.

An excluded effort **stays**. Its rider still sees it on their own board, with the reason and no
rank. Every exclusion is written to the integrity log (below).

### What it catches, measured

The rule was run against a labelled set of synthetic efforts, each written from what it is: a car
on a motorway, a GPS jump, a time edited by hand. The set is in
`packages/domain/src/segment/integrity.test.ts`.

**It catches 8 of the 13 impossible efforts (61.5%), and wrongly excludes 0 of the 12 genuine
ones.**

### Its ceiling, stated

The rule catches only what is **impossible**, never what is merely unlikely. These are **not**
caught:

- a car on a dual carriageway at 97 km/h;
- a car in town;
- a 40 km/h effort with its time halved by hand, which reads as a fast descent;
- a motorbike up a climb;
- a bicycle ride recorded as a run at 32 km/h.

The incumbent leaderboard service reports removing about a third of impossible cycling efforts
automatically, after a decade of work on it (`stories.strava.com`, read 2026-09-02). This rule
claims no more than its fixtures show. The rest is left to the community flag.

## The community flag

A rider can flag **another rider's effort** on a segment, or flag **the segment itself as
hazardous**. Each flag carries a reason from a closed list:

- effort reasons: `vehicle`, `gps-error`, `wrong-sport`, `impossible-time`, `other`;
- hazard reasons: `traffic`, `junction`, `unsuitable-path`, `other`.

| Brake | How it is held |
| --- | --- |
| You may flag only on a segment **you have an effort of your own on** | Checked in the same transaction as the flag. Anyone else is refused. This is the brake the incumbent uses against drive-by flagging |
| **10 flags a day** per rider, of either kind | Counted from the flags themselves, so restarting the instance does not reset it. An unlimited flag button would be a harassment tool |
| An effort the instance itself excluded as impossible gives no standing | Only an effort that is counted lets you flag |
| You cannot flag your own effort, an effort on another segment, or an effort by a rider who blocked you or whom you blocked | Each is answered `not_found`, the same answer as for an effort that does not exist |

**What a flag on an effort does.** The effort comes off every shared board at once, and so does every other effort of that rider on that segment from the same ride: the flag names the ride, so sharing it again with a different start, or withdrawing it and sharing it, does not shed it. A different ride of theirs is unaffected. Its rider still
sees it on their own board, with a sentence saying it was flagged. **The ride itself is unchanged**:
the ride's own pages answer exactly what they answered before.

**What a hazard flag does.** Once 3 different riders have flagged a segment hazardous, nothing on it is ranked any more, for anybody. One rider's flag, however often repeated, does nothing to the board, because nothing yet reverses it and a single account must not be able to switch a board off. There is no
board, no first place and no personal best on it. This is for a segment down a stairwell or through
a junction.

## The integrity log

Every exclusion and every flag is recorded in `segment_integrity_log` (migration 0039). Each entry
holds:

- the action;
- who did it, or nobody when it was the instance's own rule or the flagger has since erased their
  account;
- whose effort it was, or nobody once that rider has erased their account;
- the segment and the effort;
- the reason;
- the time.

The log is **append-only in the schema**: two triggers abort any `DELETE` and every `UPDATE` but
erasure's. When an account is erased, the record of what was done stays, and the account's id is
taken out of it: out of every entry the rider raised as a flagger, and out of every entry about
their efforts. Nothing else in an entry changes, so the log keeps the event (what was flagged or
excluded, why and when) and never names an erased rider (the owner's rulings on #69, 2026-11-06). Undoing migration 0039 is refused while the
log holds any entry. The instance's moderators read the log at `GET /v1/moderation/segment-log`.
To anyone else, that address answers as though it did not exist.

## What is not built yet

- **Clearing a flag.** A moderator cannot yet clear a flag or lift a hazard. The log records every
  flag, so a flag can be judged, but nothing yet reverses one. When a flagger erases their account,
  their flags go with it, and the efforts they flagged come back on the board.
