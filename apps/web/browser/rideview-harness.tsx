// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The page the RIDE SCREEN half of the browser gate drives — #422.
 *
 * ⚠️ Not `ride.html`. That page is the trainer GAME's stage; this is
 * `views/RideView.tsx`, the screen at `#/` where a ride is recorded, a trainer
 * is given control and a structured workout is started. The two are different
 * routes, and #422's comment is that the defect everybody had measured on the
 * first was worse on the second.
 *
 * It renders the **real** `shell/AppShell.tsx` at the **real** ride route,
 * under the **real** `design/theme.css`, and hands it the repository's own test
 * doubles for the three things that screen reads — a ride controller, the
 * workout library and the athlete's threshold. Nothing about the geometry is
 * this file's.
 *
 * ## What it exists to catch
 *
 * Measured on the owner's Pixel Tablet in landscape on 2026-09-20: the Ride
 * screen was cut off at `RideControls`, with **`WorkoutPanel` entirely below
 * the fold** — so structured workouts were invisible. The owner, trying to
 * answer #372's open safety question (does ERG release when a workout ends?),
 * started a recording believing it was a workout. The wire showed Request
 * Control, 103 seconds of nothing, then Stop: zero ERG targets. **A layout
 * defect produced a false answer to a safety question**, and it looked like a
 * clean pass.
 *
 * The cause was `.oyl-main`'s `max-width: var(--oyl-measure)` — a prose reading
 * measure applied to a control surface — and no gate measured any ride screen
 * at a landscape-tablet viewport.
 *
 * ## The fixture is the state with the MOST on the screen
 *
 * Mid-ride, with a trainer that has granted control and holds a target (so
 * `TrainerPanel` shows its whole form), a saved workout and a threshold (so
 * `WorkoutPanel` lists it **with the control that starts it**, which is the
 * control the owner could not see), and a paired sensor. A page that fits idle
 * and overflows mid-ride is the failure this would otherwise miss.
 *
 * ## The control
 *
 * ⚠️ `window.__oylRideView.constrain()` puts the page back the way #422 found
 * it — it swaps `oyl-main--instruments` for `oyl-main--prose` on the live
 * `main`, and takes `oyl-ride` off the wrapper so the three groups are one
 * column again. Those two classes are the whole of what #422 changed — and the spec
 * requires the control that starts a workout to be **below the fold again** at the
 * tablet viewport. Without it, "every control is on screen" is equally true of
 * a page that rendered no controls.
 *
 * ## What this page does NOT prove
 *
 * That the screen looks right, or that a thumb on a real tablet reaches any of
 * it. And nothing about Bluetooth: the controller is a stub, so *pressing* a
 * control here does nothing at all.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { seconds, thresholdShare, unixSeconds, watts } from '@onyourleft/domain';
import { athleteId, workoutId, type AthleteRecord, type WorkoutRecord } from '@onyourleft/store';

import { stubAnalysis } from '../src/analysis/testing';
import { ridingSnapshot, stubRideController } from '../src/ride/testing';
import { AppShell } from '../src/shell/AppShell';
import type { CapabilityProbe } from '../src/support/bluetooth-support';
import { workoutStub } from '../src/workouts/testing';

// The shipping stylesheet, which is the whole point — see this file's header.
import '../src/design/theme.css';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };
const ATHLETE = athleteId('harness');
const PATIENCE_MS = 10_000;

const RIDER: AthleteRecord = {
  id: ATHLETE,
  displayName: 'Harness',
  createdAt: unixSeconds(1),
  thresholdPower: watts(250),
};

const WORKOUT: WorkoutRecord = {
  id: workoutId('sweet-spot'),
  createdBy: ATHLETE,
  name: 'Sweet spot, three by twelve',
  workout: {
    name: 'Sweet spot, three by twelve',
    blocks: [{ kind: 'steady', seconds: seconds(720), target: thresholdShare(0.9) }],
  },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
};

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** One control a rider has to be able to press. */
export interface RideViewControl {
  /** Which of the screen's three groups it is in. */
  readonly group: 'live' | 'trainer' | 'sensors';
  /** Its accessible text, for a failure message a person can act on. */
  readonly name: string;
  readonly box: Box;
  /** Whether it is the topmost thing at its own centre. @see ride-harness.tsx */
  readonly onTop: boolean;
}

export interface RideViewMeasurement {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly controls: readonly RideViewControl[];
  /** Each group's own box, so a failure says which column moved. */
  readonly groups: Readonly<Record<'live' | 'trainer' | 'sensors', Box | undefined>>;
  /** `main`'s box and class, so a failure says whether the measure is on. */
  readonly main: Box | undefined;
  readonly mainClass: string;
  /** How wide the content is allowed to be: `main`'s resolved `max-width`. */
  readonly mainMaxWidth: string;
  readonly scrollY: number;
  /** What `theme.css` resolved a metric card's background to, as a load check. */
  readonly cardBackground: string;
}

declare global {
  interface Window {
    __oylRideView?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly measure: () => RideViewMeasurement;
      /** The control. @see this file's header */
      readonly constrain: () => void;
    };
  }
}

const errors: string[] = [];

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

function textOf(element: Element): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function nameOf(element: Element): string {
  if (element instanceof HTMLSelectElement || element instanceof HTMLInputElement) {
    return textOf(element.closest('label') ?? element) || element.tagName.toLowerCase();
  }
  return textOf(element);
}

function measure(): RideViewMeasurement {
  const controls: RideViewControl[] = [];
  const groups: Record<'live' | 'trainer' | 'sensors', Box | undefined> = {
    live: undefined,
    trainer: undefined,
    sensors: undefined,
  };
  for (const group of ['live', 'trainer', 'sensors'] as const) {
    const root = document.querySelector(`.oyl-ride__group--${group}`);
    if (root === null) {
      continue;
    }
    groups[group] = boxOf(root);
    for (const control of root.querySelectorAll('button, select, input')) {
      const box = boxOf(control);
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      controls.push({
        group,
        name: nameOf(control),
        box,
        onTop: hit !== null && (hit === control || control.contains(hit)),
      });
    }
  }
  const main = document.querySelector('main');
  const card = document.querySelector('.oyl-metric');
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    controls,
    groups,
    main: main === null ? undefined : boxOf(main),
    mainClass: main?.className ?? '',
    mainMaxWidth: main === null ? '' : window.getComputedStyle(main).maxWidth,
    scrollY: window.scrollY,
    cardBackground: card === null ? '' : window.getComputedStyle(card).backgroundColor,
  };
}

function constrain(): void {
  const main = document.querySelector('main');
  const ride = document.querySelector('.oyl-ride');
  if (main === null || !main.classList.contains('oyl-main--instruments') || ride === null) {
    throw new Error(
      'rideview harness: the page does not carry the two classes the control removes',
    );
  }
  // Both halves of #422, because the defect was both: a reading measure on the
  // container, and one column inside it. Putting back only the measure leaves
  // two columns in 653 px, which at 1024×768 still fits — measured, and it is
  // why the first version of this control passed over nothing at that viewport.
  main.classList.replace('oyl-main--instruments', 'oyl-main--prose');
  ride.classList.remove('oyl-ride');
}

async function until<T>(what: string, look: () => T | undefined | null): Promise<T> {
  const deadline = performance.now() + PATIENCE_MS;
  for (;;) {
    const found = look();
    if (found !== undefined && found !== null) {
      return found;
    }
    if (performance.now() > deadline) {
      throw new Error(`rideview harness: gave up waiting for ${what}`);
    }
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  }
}

async function run(): Promise<void> {
  const host = document.querySelector('#shell');
  if (host === null) {
    throw new Error('rideview harness: #shell is missing from rideview.html');
  }
  window.location.hash = '#/';

  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell
          capabilities={NO_BLUETOOTH}
          rideController={stubRideController(ridingSnapshot()).controller}
          workouts={workoutStub(ATHLETE, [WORKOUT])}
          analysis={stubAnalysis(ATHLETE, [], RIDER)}
        />
      </StrictMode>,
    );
  });

  // ⚠️ The control the owner could not see. It appears only once the workout
  // list AND the threshold have both been read, so waiting for it is what
  // makes the fixture "the state with the most on the screen" rather than
  // whichever state the page happened to be in when the spec looked.
  await until('the control that starts a workout', () =>
    [...document.querySelectorAll('.oyl-ride__group--trainer button')].find(
      (each) => textOf(each) === `Ride ${WORKOUT.name}`,
    ),
  );
  await document.fonts.ready;

  window.__oylRideView = { ready: true, errors, measure, constrain };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylRideView = { ready: false, errors, measure, constrain };
});
