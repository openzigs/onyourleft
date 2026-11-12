# ADR 0068: A Delivery round holds the realistic world's floor — superseding the step out of realism in ADR 0026 D-3, while a round runs

- **Status**: **Proposed, 2026-11-12.** Nothing here is the owner's ruling yet: it is the author's
  recommendation, to be accepted or changed on this ADR's pull request before the change merges
- **Date**: 2026-11-12
- **Deciders**: the owner, on the pull request. The author recommends
- **Issue**: [#2513](https://github.com/openzigs/onyourleft/issues/2513)
- **Number**: **0068**. On 2026-11-12 `docs/adr/` holds no file numbered 0068 and
  `docs/agents/conventions.md` §7 gives 0068 as the next free number
- **Supersedes**: [ADR 0026](0026-realistic-game-world.md) D-3, **only** its step from the
  realistic ladder's floor to the stylised ladder's top, **and only while a Delivery round runs**.
  Every other part of D-3 and of ADR 0026 is unchanged, by name: the rungs, the settling window, the
  frame-time rule of the 2026-11-06 amendment, the whole-world rule, and the step out for an ordinary
  ride and for a ride whose round is over. ADR 0026 gains an appended amendment pointing here
  ([ADR 0013](0013-adr-amendments.md)); its body is not edited
- **Rests on**: [ADR 0059](0059-delivery-a-parcel-round-game-mode.md) D-3.1 (Delivery runs in the
  realistic world) and D-3.4 (more dropped frames are accepted for it)

## Context

ADR 0026 D-3 says that when the realistic world's lowest rung is still too slow, the ride leaves
realism for the rest of the ride and draws the stylised world. A Delivery round's houses are the
town's mapped buildings, and only the realistic world draws a mapped building. A round that left
realism went on counting houses the rider could not see, with a marker standing by an empty verge.
This was reproduced on the shipped build under SwiftShader and on a forced step-down.

**What is not shown.** It was not reproduced on the owner's tablet. The tablet's own record
(*Settings › Game world*, `oyl.game.realisticReport.v1`, read over `adb` on 2026-11-12 from the
combination build installed on 2026-11-11) holds `"steps":[]` for every recent ride: none of them
stepped down or left realism. So the ladder leaving realism is **not** shown to be what the owner
saw on the tablet, and this ADR is a hardening that the tablet has not yet needed. #2513 stays open
on the tablet for its cause.

## Decision

**D-1. While a Delivery round is running, the realistic ladder holds its floor rung** instead of
stepping to the stylised world. A round is running from its start until it has an outcome. Within
realism the ladder steps down and climbs back exactly as before; an ordinary ride and a ride whose
round is over leave realism exactly as before. (`quality.ts` §`nextWorldQuality`, its `holdRealism`
argument; `GameView.tsx` passes it.)

**D-2. The hold has no bound** (the author's recommendation, for the owner to rule on). A device too
slow for the realistic floor stays in realism for the whole round and drops frames, because ADR 0059
D-3.4 already accepts that for Delivery and a round in the stylised world is a round with no houses.
The alternative is an escape on an extreme frame time (for example the frame time of the 2026-11-08
measurement, about 5 fps on `main`); it would need a number the owner chooses, and a moving-ride
tablet frame check either way. Neither is built.

## Consequences

- A Delivery round on a slow device stays in realism, so its houses stay drawn; it may run at a low
  frame rate for the round instead of leaving.
- A step past the floor while held changes no ladder state, so the *Settings › Game world* report
  records nothing for it. A device too slow for realism leaves no step in the report during a round.

## What would make this ADR wrong

- The owner's tablet moving-ride check showing a held round at a frame rate the rider cannot ride.
- The tablet's report showing the cause of #2513 is elsewhere (see Context).
