// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the ride-layout half of the browser gate drives — #373.
 *
 * It renders the **real** `shell/AppShell.tsx` at the **real** game route, and
 * puts the **real** `game/hud/HudPanel.tsx` inside the `section.oyl-game`
 * `GameView` gives it, under the **real** `design/theme.css`. Nothing about the
 * geometry is this file's.
 *
 * ## What it exists to catch, and why no other gate could
 *
 * `GameView` renders `Trainer: simulating −0.4% (352 sent)` — the **only**
 * rider-visible evidence that a gradient is reaching the trainer, and the thing
 * `docs/validation/0002-android-shell-and-game.md` Part L's steps are built
 * around reading. Observed on a tablet on 2026-09-19: in **portrait** it is
 * visible; in **landscape** the page ends at the elevation strip and the line
 * is outside the viewport with no indication it exists. A rider running Part L
 * in the orientation a handlebar-mounted phone is most likely to be in cannot
 * perform the step.
 *
 * Every gate here was green:
 *
 * - `trainer-wiring.test.tsx` asserts the sentence is in the container, in
 *   **jsdom**, which performs no layout at all (CLAUDE.md §4e). A string in the
 *   DOM and a string on the screen are the same observation there.
 * - `shell.browser.spec.ts` measures persistent chrome at 320×256 and
 *   `hud.browser.spec.ts` measures the HUD's own grid tracks in both
 *   orientations — and **neither renders this line**, because it was
 *   `GameView`'s and those harnesses mount `AppShell` and `HudPanel`.
 *
 * ## Why `.oyl-main`'s view child is replaced
 *
 * ⚠️ The measurement is *where something is in the viewport*, so everything
 * above it has to be the product's: the sticky-or-not header, the route's `h1`,
 * the route's summary paragraph. `AppShell` renders all three and then renders
 * a view — and handed no `game` port that view is `GameView`'s route picker,
 * which is **not** what is being measured and whose height would push the panel
 * down by an amount the product never has.
 *
 * So the shell is rendered at `#/game`, its view child is **hidden**, and the
 * ride content is mounted after it. What is laid out inside `main` is then
 * exactly what the product's game route puts there: the `h1`, the summary, and
 * one `section.oyl-game`.
 *
 * ⚠️ **Hidden, not removed, and that is a measured distinction rather than a
 * preference.** `region.lastElementChild?.remove()` was the first version:
 * React owns that node, and the next commit threw
 * `NotFoundError: Failed to execute 'removeChild' on 'Node'` — which unmounted
 * the entire shell, leaving `<div id="shell"></div>`, a document 0 px tall,
 * and {@link READY_ATTRIBUTE} set on it all the same. That is precisely the
 * vacuous harness this file's control exists to catch, and it is why the spec
 * asserts what it found before it measures any of it. Setting an attribute
 * touches no child list, and nothing here re-renders — there is no state change
 * and the spec changes no route — so React never reconciles it away.
 *
 * ## The control, and why a green run would otherwise mean nothing
 *
 * ⚠️ A **second** copy of the line is rendered in its pre-#373 position — a
 * `<p className="oyl-muted">` after the panel, inside `.oyl-game`, on the page
 * background. The spec requires the shipped one to be inside the viewport in
 * both orientations **and the control to be outside it in landscape**. Without
 * that second requirement a viewport taller than the whole page, a stylesheet
 * that failed to load and a panel that rendered nothing would all report "the
 * line is visible", and the gate would be green over a measurement it never
 * made.
 *
 * ## What this page does NOT prove
 *
 * That the ride screen looks right — there is no reference image and ADR 0009
 * forbids deriving one from another product. It renders **no WebGL**: the
 * canvas is the shipping `.oyl-game__world` element with the shipping
 * `aspect-ratio` and `max-height`, and those are what decide the layout, so the
 * scene inside it is irrelevant here and `game.html` owns it. And it says
 * nothing about a real phone: a 844×390 viewport in a headless Chromium is not
 * a handlebar in the rain.
 */

import { StrictMode, type JSX } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  gradeAt,
  metres,
  metresPerSecond,
  routeProfile,
  seconds,
  watts,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';

import { trainerLine, type TrainerLine } from '../src/game/hud/fields';
import { HudPanel } from '../src/game/hud/HudPanel';
import type { GameState } from '../src/game/simulation';
import { AppShell } from '../src/shell/AppShell';
import type { CapabilityProbe } from '../src/support/bluetooth-support';

// The shipping stylesheet, which is the whole point — see this file's header.
import '../src/design/theme.css';

/** A browser with no Bluetooth, which is what a headless Chromium is. */
const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

/** The attribute the spec waits on. @see shell-harness.tsx */
const READY_ATTRIBUTE = 'data-oyl-ride-ready';

/**
 * What the trainer line says, at its widest.
 *
 * A negative gradient — the minus sign is a glyph — and a four-digit count,
 * which is about what an hour at this driver's rate limit produces. A narrow
 * fixture would measure a line nobody rides.
 */
const TRAINER: TrainerLine = { gradePercent: -12.4, writes: 1284 };

/** A rolling route, so the gradient field has a real number with a sign. */
function route(): RouteProfile {
  const points: RoutePoint[] = [];
  const spacing = 100;
  const count = 400;
  for (let index = 0; index <= count; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * spacing) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(60 + 40 * Math.sin((index / count) * 6 * Math.PI)),
    });
  }
  return routeProfile(points);
}

const PROFILE = route();
const RIDDEN = metres(5_000);

/** Mid-ride, with every channel reporting. @see hud-harness.tsx */
const STATE: GameState = {
  ride: { speed: metresPerSecond(12.5), distance: RIDDEN },
  elapsed: seconds(1_200),
  ridden: seconds(1_200),
  grade: gradeAt(PROFILE, RIDDEN),
  input: { power: watts(342), live: true },
};

/**
 * The ride screen's own markup, as `GameView` renders it.
 *
 * ⚠️ The canvas carries the shipping class and `aria-hidden`, exactly as
 * `GameView` writes it, and is never given a context. Its box comes from
 * `.oyl-game__world`'s `aspect-ratio` and `max-height`, which is the half of
 * this layout that decides how much room the HUD gets.
 */
function Ride(): JSX.Element {
  return (
    <section className="oyl-game" aria-label="Trainer game">
      <canvas className="oyl-game__world" aria-hidden="true" />
      <HudPanel
        profile={PROFILE}
        state={STATE}
        cadence={{ value: 92, live: true }}
        heartRate={{ value: 168, live: true }}
        chases={[]}
        paused={false}
        trainer={TRAINER}
        onPause={() => undefined}
        onEnd={() => undefined}
      />
      {/*
        ⚠️ The control. This is where the line was before #373 — after the
        panel, on the page background — and the spec requires it to be OUT of
        the viewport in landscape. See this file's header for what a green
        control would mean.
      */}
      <p className="oyl-muted" data-oyl-trainer-control="true">
        {trainerLine(TRAINER)}
      </p>
    </section>
  );
}

function main(): void {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('ride harness: #shell is missing from ride.html');
  }

  // The real route, so the `h1` and the summary above the panel are the ones a
  // rider actually has above it.
  window.location.hash = '#/game';

  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell capabilities={NO_BLUETOOTH} />
      </StrictMode>,
    );
  });

  const region = document.querySelector('.oyl-main');
  if (region === null) {
    throw new Error('ride harness: AppShell rendered no .oyl-main');
  }
  // See the header: the view the shell rendered is not what is being measured,
  // and its height is not one the product's game route has. ⚠️ Hidden rather
  // than removed — removing it threw inside React and unmounted the shell.
  const view = region.lastElementChild;
  if (view === null) {
    throw new Error('ride harness: AppShell rendered no view inside .oyl-main');
  }
  view.setAttribute('hidden', '');

  const mountPoint = document.createElement('div');
  region.append(mountPoint);
  flushSync(() => {
    createRoot(mountPoint).render(
      <StrictMode>
        <Ride />
      </StrictMode>,
    );
  });

  document.documentElement.setAttribute(READY_ATTRIBUTE, 'true');
}

main();
