# ADR 0041: Motion animates the menus — lazily loaded, menu routes only, never during a ride, and reduced motion honoured

- **Status**: Accepted
- **Date**: 2026-09-30
- **Deciders**: **the owner, on adopting Motion** — D-2 on
  [#935](https://github.com/openzigs/onyourleft/issues/935), 2026-09-30, and the ruling on
  [#936](https://github.com/openzigs/onyourleft/issues/936) of the same day, both quoted in Context.
  The author wrote the engineering rules (D-2 to D-6) from those rulings
- **Issue**: [#936](https://github.com/openzigs/onyourleft/issues/936), parent epic
  [#935](https://github.com/openzigs/onyourleft/issues/935). The dependency is installed by
  [#945](https://github.com/openzigs/onyourleft/issues/945), not here
- **Number**: **0041**, read from [`docs/architecture.md`](../architecture.md)'s ownership table —
  the check `CLAUDE.md` §7 asks for — on 2026-09-30, and checked against every open pull request's
  files: none adds an ADR above 0040
- **Required by**: [ADR 0034](0034-lucide-icons.md) D-5, which admits `lucide-react` and **no other
  runtime UI dependency**, and says another needs its own ADR and must arrive in a lazily loaded
  chunk. This is that ADR for one package
- **Supersedes**: nothing. ADR 0034 D-5 is not reversed: it admits one package and still does

## Context

### What the owner ruled

> **D-2, animation:** **use Motion**, lazily loaded (the owner: "I would prefer motion since it is
> more professional"). Motion 13.4.6 is MIT. With `LazyMotion` it measured 28.0 kB gzip, loaded only
> on menu routes and never on the ride or game routes. It needs a short ADR under ADR 0034 D-5, and a
> `prefers-reduced-motion` rule.

— owner decision on #935, 2026-09-30.

> **Animation is Motion, lazily loaded.** This issue's motion tokens (durations and easings) must be
> ones Motion can read, as well as CSS. Include the short ADR admitting Motion under ADR 0034 D-5
> […]. It sets the rules: lazy-loaded, menu routes only, never on `ride` or `game` or while
> immersive, and `prefers-reduced-motion` honoured. Add no dependency in this issue; #945 installs it.

— owner, on #936, 2026-09-30.

The epic's research recommended the opposite (no dependency: CSS transitions and React 19.3's
`<ViewTransition>`). The owner chose Motion. This ADR admits Motion and nothing else. The owner
has also chosen Tailwind CSS v4 and Radix Primitives for the menus, built over the existing tokens
([#950](https://github.com/openzigs/onyourleft/issues/950)); admitting them is #950's own ADR, not
this one.

### What was measured, and read

From epic #935's research, 2026-09-30 (`npm view`; esbuild 0.28.2 in a scratch directory outside the
repository, React external, gzip -9). It was not re-measured for this ADR, because nothing is
installed yet; #945 re-measures it against the installed tree:

- **`motion` 13.4.6**, MIT, published 2026-09-29. Its dependencies are `framer-motion`,
  `motion-dom`, `motion-utils` and `tslib`, all MIT. MIT is in ADR 0015's permissive row, so
  `DEP001` and `DEP002` admit it in `apps/web`'s distributed closure.
- **Cost**: `motion.div` 41.7 kB gzip; `LazyMotion` + `m` + `domAnimation` **28.0 kB gzip**;
  `motion/mini`'s `animate()` 3.9 kB gzip.
- **Reduced motion**: `MotionConfig reducedMotion="user"` turns off transform and layout animation
  when the reader asks for less motion, and keeps opacity and colour changes (motion.dev,
  "Accessibility", read through Context7 for #935).
- **Units**: Motion reads a `transition`'s `duration` in **seconds** and its `ease` as a cubic
  Bézier's four numbers. CSS reads milliseconds and `cubic-bezier()`.

## Decision

### D-1 — `motion` is admitted for animating the menus, and for nothing else

`motion` is admitted as a runtime dependency of `apps/web`, pinned exactly to a version at least 24
hours old (CLAUDE.md §8). #945 installs it and runs `check:licences`, regenerates `check:notices`
and reads the diff. A bump is a dependency change like any other.

This admits **one package**. ADR 0034 D-5 stands for every other runtime UI dependency.

### D-2 — Lazily loaded, never in the entry chunk

Motion is reached only through a dynamic `import()` from a menu route's own chunk (#674's
per-route split), and through `LazyMotion` with the `m` component — never `motion.div`, which
bundles every feature. **Nothing in the entry chunk may import it.** #945 records the entry chunk's
gzip size before and after, and it must not move by Motion's weight.

### D-3 — Menu routes only: never on a ride-time route, never while immersive

Motion may animate the menus that epic #935 names: Home, the Ride screen **before** a ride, the
Activities, Workouts and Routes screens, Devices, Settings, the game's pre-ride picker, and the
navigation. It may **not** run:

- on the Ride screen while a ride is recording or paused;
- on the game route once a ride has started, or anywhere while the shell is immersive
  (`AppShell` §`immersive`);
- on or around any control in `design/ride-time-controls.ts` §`RIDE_TIME_CONTROLS`.

A rider in motion must not wait for an animation, and while a transition's snapshot is drawn a press
does not reach the control underneath.

### D-4 — The reader's preference is honoured, twice

The app is wrapped in `MotionConfig reducedMotion="user"`, and the stylesheet's
`prefers-reduced-motion: reduce` and `update: slow` blocks keep collapsing every CSS transition.
A script animation must not be the one thing that still moves when the reader asked for less.
**Nothing loops** and nothing auto-plays for more than five seconds (WCAG 2.2 SC 2.2.2).

### D-5 — Durations and easing come from the tokens, never from a call site

A Motion `transition` is one of `design/tokens.ts` §`MOTION_FOR_SCRIPT` — `short` (120 ms) or
`medium` (200 ms), on the one standard easing curve — and never a number written where it is used.
`tokens.test.ts` holds `MOTION_FOR_SCRIPT` equal to the same `MOTION_DURATION_MS` and
`MOTION_EASING` that `theme.css`'s `--oyl-motion-*` tokens are held to, so a script animation and a
CSS transition cannot be two speeds, and **nothing runs longer than 200 ms** (epic #935, principle
4). `theme.a11y.test.ts` refuses a duration literal above that in the stylesheet.

### D-6 — Motion is decoration

An animation explains a change of place. It never carries information the words and the final state
do not, so a reader who sees none of it misses nothing. It animates `transform` and `opacity` where
it can, which the compositor draws without a layout.

## Consequences

- **#936** adds the tokens D-5 names and no dependency. **#945** installs Motion under D-1 and D-2,
  wraps the app in `MotionConfig` (D-4), and owes a browser-gate case with a control for each of D-3
  and D-4.
- **`check:licences` and `check:notices`** change with #945 and only then: the notices document
  gains `motion`, `framer-motion`, `motion-dom`, `motion-utils` and `tslib` if `tslib` is not already
  in it.
- **The precache** is derived from the build (#406), so Motion's chunk is precached like any other
  lazily loaded route chunk. It is not in the first paint.
- **`<ViewTransition>`** (React 19.3) may still carry a route change if #945 finds it simpler. It is
  a platform API and needs no ADR, and D-3 and D-4 bind it all the same.

## What would make this ADR wrong

- **Motion's weight grows** past what #945 measures, or a release stops tree-shaking under
  `LazyMotion`. Then it is re-measured, and this ADR is re-opened rather than the entry-chunk check
  loosened.
- **Motion changes its licence**, or a dependency arrives under terms outside ADR 0015's tables.
  `check:licences` stops the build, and this ADR is re-opened.
- **An animation becomes necessary** to understand a screen. D-6 would then be false, and a reader
  with reduced motion would be missing something.

---

## Amendments

Appended under [ADR 0013](0013-adr-amendments.md). Nothing above this line has been edited.

- **2026-10-03** — [#945](https://github.com/openzigs/onyourleft/issues/945) did **not** install
  Motion, so the header's *"The dependency is installed by #945"* and §Consequences' *"#945 installs
  Motion under D-1 and D-2, wraps the app in `MotionConfig`"* are no longer true. #945 carried the
  route cross-fade with React 19.3's `<ViewTransition>` and no dependency, which §Consequences
  allowed, and its own acceptance criteria required `apps/web/package.json`'s `dependencies`
  unchanged; a Motion install with no caller would have been a dependency nothing used. Installing
  Motion, `MotionConfig reducedMotion="user"`, and the card carried into its detail move to
  [#1072](https://github.com/openzigs/onyourleft/issues/1072). No decision here changes: D-3's rule
  (no motion on `ride` or `game`, nor while immersive) binds #945's cross-fade, which
  `apps/web/src/shell/route-motion.ts` enforces.
- **2026-10-04** — [#1072](https://github.com/openzigs/onyourleft/issues/1072) installed Motion,
  and three facts above have moved. **The version is `motion` 13.5.1**, not the 13.4.6 §Context
  measured (with `framer-motion` and `motion-dom` 13.5.1, `motion-utils` 13.5.0 and `tslib`, all MIT;
  `check:licences` passes and `check:notices` lists the four new packages). **The features are
  `domAnimation`, not `domMax`**: a card is carried into its detail by transforms animated from
  keyframes (`apps/web/src/shell/ListDetail.tsx` §"Carrying a card into its detail"), because a
  shared `layoutId` crossfades two mounted elements and at two panes the card stays on screen.
  **The weight, measured on the built tree** (gzip -9): the entry chunk holds no Motion module —
  `tools/bundle/entry-graph.ts` now fails the build if `motion`, `framer-motion`, `motion-dom` or
  `motion-utils` reaches it (the entry went from 168.2 kB to 170.8 kB with #946 and #947's code,
  none of it Motion's) — and Motion arrives in two lazily loaded chunks: `ListDetail`, shared by the
  history and routes groups, which grew from 14.4 kB to 28.4 kB with `LazyMotion`, `m` and
  `MotionConfig`, and `motion-features` (14.5 kB, `import()`ed once a list–detail route mounts) —
  28.5 kB of Motion in all, where §Context estimated 28.0. `MotionConfig
  reducedMotion="user"` wraps the one place Motion animates, the list–detail layout, rather than the
  app: wrapping the app would put Motion in the entry, which D-2 forbids. ⚠️ Motion reads the
  reader's preference when an element MOUNTS, so a preference changed while a list is on screen
  takes effect the next time a list is opened; the browser gate's reduced-motion case says so.
  Any new Motion surface must therefore carry its own `MotionConfig reducedMotion="user"`, because
  the app root cannot hold one without putting Motion in the entry chunk.
