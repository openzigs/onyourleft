# ADR 0075: The ride controls fade slower than the menus' motion cap — superseding in part ADR 0041 D-3 and D-5 and ADR 0063 D-7, for the ride controls that hide until touched

- **Status**: **Accepted, 2026-11-17**, by the owner on #2670 (D-5). Proposed the same day, on the
  owner's report from the tablet on
  [#2600](https://github.com/openzigs/onyourleft/issues/2600#issuecomment-6946037944) (*"menu does
  disappear on touch. Not a fade just a pop."*) and the maintainer's reading of it in the same
  comment (*"out over about 0.8 s, back in over about 0.25 s. Use dedicated tokens, not the shared
  motion-medium"*). The pull request still merges only after the tablet check #2600 requires
- **Date**: 2026-11-17
- **Deciders**: **the owner**, whose rulings of 2026-11-16 (*"Fade out is better"*) and report of
  2026-11-17 asked for a fade a rider can see. **The maintainer** set the two numbers in the
  comment above. **The author** chose the rest, marked *the author's choice* where it is made
- **Issue**: [#2600](https://github.com/openzigs/onyourleft/issues/2600), in pull request
  [#2670](https://github.com/openzigs/onyourleft/pull/2670)
- **Number**: **0075**. It was written on 2026-11-17 while 0074 was still unmerged, and
  [#2710](https://github.com/openzigs/onyourleft/issues/2710)'s pull request
  [#2724](https://github.com/openzigs/onyourleft/pull/2724) then merged
  `docs/adr/0074-a-sprint-instinct-behind-the-models-moves.md` to `main` first, so **0074 is
  taken** and this is the next number after it. **0057 and 0058 stay claimed** by
  [#1748](https://github.com/openzigs/onyourleft/issues/1748) and
  [#1752](https://github.com/openzigs/onyourleft/issues/1752), 0070 by
  [#2684](https://github.com/openzigs/onyourleft/issues/2684) and 0072 by
  [#2712](https://github.com/openzigs/onyourleft/issues/2712). The next free number is 0076
- **Supersedes, in part**, for **the ride controls that hide until touched and nothing else**
  (`apps/web/src/game/hud/controls-reveal.ts`, `theme.css` §"#2600"):
  [ADR 0041](0041-motion-for-menu-animation.md) **D-5** (*"nothing runs longer than 200 ms"*) and
  **D-3** (no motion on the game route once a ride has started, nor on or around a ride-time
  control), and [ADR 0063](0063-the-design-system-direction-hi-vis.md) **D-7** (*"the 200 ms cap
  stays"*). Every other part of each is unchanged, by name: the menus' two durations and one curve,
  the reduced-motion and `update: slow` collapse, D-3's ban on every other ride-time animation and
  on any animation while a transition's snapshot could swallow a press, and D-6 (motion is
  decoration). ADR 0041 and ADR 0063 each gain an appended amendment pointing here
  ([ADR 0013](0013-adr-amendments.md)); neither body is edited

## Context

#2600 hides *Pause*, *End ride*, *Use item* and the rest of the ride's controls after five seconds
with no input, and brings them back on any touch, key or controller press. On 2026-11-16 the owner
ruled that they fade rather than clip away (*"Fade out is better"*), and ADR 0063's amendment of that
day admitted `opacity: 0` in the HUD for it. The fade ran on `--oyl-motion-medium`, 200 ms, because
ADR 0041 D-5 and ADR 0063 D-7 cap every duration in the stylesheet there.

On 2026-11-17 the owner, on the tablet, reported *"Not a fade just a pop"*. Measured on the device,
two things made it one:

1. **200 ms is a menu's change of place, not a fade a rider sees go.** The menus' cap exists so a
   menu never makes a reader wait for it (epic #935, principle 4). A control that fades out is not
   in anyone's way: nobody waits for it, and the fade is the only thing telling the rider where the
   control went and that a touch brings it back.
2. **The lined actions panel did not fade at all.** With the trainer's line in it (the tablet
   always shows one), the panel was held whole for the length of the fade and then clipped to the
   line in one step, so its emptied surface vanished at once.

ADR 0041 D-3 also bars motion on the game route once a ride has started and on or around a ride-time
control. Its reason is that *"a rider in motion must not wait for an animation, and while a
transition's snapshot is drawn a press does not reach the control underneath"*. Neither holds for this
fade: it is a CSS animation of `opacity` on the controls themselves, no snapshot is drawn, and a press
during it reaches what it always does (`controls-reveal.ts` §"What the first touch does": the tap
that began while they were hiding only shows them).

## Decision

### D-1 — Two tokens of the ride's own, above the cap

`theme.css` declares `--oyl-motion-hud-fade-out: 800ms` and `--oyl-motion-hud-fade-in: 250ms`,
written once in `apps/web/src/design/tokens.ts` §`HUD_CONTROLS_FADE_MS` and §`MOTION_TOKENS`. They
are the only durations above `MOTION_DURATION_MS.medium` in the stylesheet. They are **not** in
`MOTION_DURATION_MS` or `MOTION_FOR_SCRIPT`, so no script animation, and nothing in the menus, can
take them.

### D-2 — Read only by the hiding controls

They are read only under `.oyl-hud[data-oyl-controls='hidden']` and
`.oyl-hud[data-oyl-controls-returned]`. `theme.a11y.test.ts` §"no motion runs longer than 200 ms"
holds both halves: each token is held to its own number, not to the cap, and a rule reading either
under any other selector fails. Every other duration in the stylesheet is still held to 200 ms.

### D-3 — The fade first, then the clip closes

The controls fade out over `--oyl-motion-hud-fade-out`, and the actions panel stays drawn whole
until they have. Only then is it clipped to the trainer's line, and the clip **closes** over
`--oyl-motion-medium` instead of arriving in one step (*the author's choice*: the menus' own
duration, because the closing is a change of place). They fade back in over
`--oyl-motion-hud-fade-in`. `ride-chrome.browser.spec.ts` samples the fade and the closing at the
owner's 1280×800 tablet and at 1024×600, and fails on a step in either.

### D-4 — Reduced motion and slow screens still get none

A rider who asked for less motion, or whose screen cannot repaint, sees no fade and no closing. The
stylesheet-wide collapse shortens a duration but leaves a delay in place, so the closing would still
wait out the fade. For that reason `theme.css` §"#2600" removes every one of these animations under
`prefers-reduced-motion: reduce` and `update: slow`, and the controls and the clip go at once.

### D-5 — The owner's answers

**Owner ruling, 2026-11-17:** asked *"Approve ADR 0075? It allows the 0.8 s fade on the ride
controls only"* and *"Keep the whole panel up while you hold an item in a lap race?"*, the owner
answered *"1 approve"* and *"2 yes"*. So ADR 0075 is accepted, and while the rider holds an item in a
lap race the whole actions panel stays drawn (Pause and End ride with Use item), as `HudCore.tsx`
§`controlsHeld` does.

## Consequences

- The ride's controls take 0.8 s to fade out and 0.25 s to come back. A tap during the fade-out is
  the tap that only shows them, as a tap after it is (`controls-reveal.ts`). The fade is visible,
  so the rider can see they are going.
- The menus' cap is unchanged everywhere else, and the gate that holds it now names its one
  exception, so a second exception has to come through an ADR as this one did.
- ADR 0063's amendment of 2026-11-16 named `--oyl-motion-medium` as the length of the fade. That
  is no longer true, and ADR 0063 gains a dated amendment saying so.

## What would make this ADR wrong

- **The owner finds 0.8 s too slow**, or that the fade draws the eye away from the road. The tokens
  then change, and D-2's gate still holds whatever numbers they take.
- **A rider waits on the fade**: if a ride-time control could be pressed only once its fade-in had
  run, ADR 0041 D-3's reason would apply after all. Today a control takes a press at every point of
  its fade, and a jsdom test (`HudPanel.controls-hide.test.tsx`) presses each one as soon as it is
  shown.

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-11-18** — D-3's closing also carries the panel down, where a race's standings are drawn
  ([#2837](https://github.com/openzigs/onyourleft/issues/2837), on the owner's report of that day
  from the tablet: *"the position menu should get bigger when the other one reduces … Can only see
  3 people"*). D-3 clips the hidden actions panel to the trainer's line and leaves the line where
  the panel begins, so the room under it was nobody's. On a tablet, in a ride whose HUD draws a
  race's standings, the panel is now also moved down by what the clip takes off it, so the line is
  drawn at the stage's bottom edge and the standings grow into the room above it
  (`theme.css` §"#2837", `standings-room.ts`). **No duration and no token is added**: the move is
  part of the same closing, over `--oyl-motion-medium`, after the fade has run, and the panel keeps
  its own place for as long as its controls are fading. D-1, D-2, D-4 and D-5 are unchanged: under
  `prefers-reduced-motion: reduce` and `update: slow` there is no closing and the line is at the
  bottom edge at once. A ride with no standings moves nothing, and nor does a phone, whose stage draws none. *The author's choice*, for the
  owner to look at with #2837's screenshots; `lap-race-hud.browser.spec.ts` §"#2837" samples the
  move and fails on the panel leaving its place before the fade has run.
