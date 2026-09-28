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
 * ⚠️ **"The most" is about which panels are open, not about how long a list
 * is, and this header used to read as though it were both.** The library here
 * holds ONE saved workout. `WorkoutPanel` lists the whole library, so a rider
 * with ten has nine more start controls below wherever this one landed. That
 * is a list that scrolls, by design — what the gate covers is that the panel,
 * and the **first** control in it, are on the screen, which is what tells a
 * rider structured workouts exist at all. Do not read a green run as "every
 * workout is reachable without scrolling".
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

import {
  expandWorkout,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type WorkoutRescue,
} from '@onyourleft/domain';
import { athleteId, workoutId, type AthleteRecord, type WorkoutRecord } from '@onyourleft/store';

import { stubAnalysis } from '../src/analysis/testing';
import type { RideSnapshot } from '../src/ride/controller';
import { ridingSnapshot, stubRideController } from '../src/ride/testing';
import { AppShell } from '../src/shell/AppShell';
import type { CapabilityProbe } from '../src/support/bluetooth-support';
import { workoutRescueText } from '../src/workout/rescue-text';
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

/**
 * `rideview.html?workout=eased` — #605: a workout RUNNING, with the stall
 * rescue holding its target at the trainer's floor. `?workout=running` is the
 * same workout with no rescue, which is the apparatus's control: the notice
 * this page is asked to measure must be ABSENT there.
 *
 * ⚠️ **Through the stub controller's snapshot, not the real controller**, for
 * the reason the rest of this page is: the geometry is what is measured, and
 * `WorkoutPanel` renders the notice from `RideWorkoutSnapshot.rescue` exactly
 * as it does from the real one (`controller.ts` §`rescue`). What the real
 * player puts there is `ride-announcer.a11y.test.tsx`'s and
 * `workout/session.test.ts`'s to assert, not a layout gate's.
 *
 * ⚠️ **The floor, with "Pedalling has stopped"**, because of the rescue's
 * producible sentences it is the longest WHOLE one — only the floor adds the
 * two-step way back — and the whole one is what a rider who opens *How the
 * target comes back* reads. The longest HEADLINE is the spiralling relief's
 * (84 characters against 78), which is six characters on a line that wraps
 * at about 60, so it is the whole sentence that binds.
 */
const WORKOUT_STATE = new URLSearchParams(window.location.search).get('workout');

const FLOOR: WorkoutRescue = {
  kind: 'floor',
  reason: 'Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
};

/**
 * `rideview.html?keepalive=failed` — #647: the platform refused to keep the
 * ride alive, so `RideView` shows *"Keep the screen on: your ride may stop
 * without it."* beside the Live group's heading. Through the stub's
 * snapshot for the reason {@link WORKOUT_STATE} is: this page measures where
 * the sentence lands; `ride/keep-alive-notice.a11y.test.tsx` §"the Ride
 * screen — #647" drives the real controller with a refusing port and reads the
 * same sentence off the screen.
 */
const KEEP_ALIVE_FAILED = new URLSearchParams(window.location.search).get('keepalive') === 'failed';

/**
 * `rideview.html?ride=idle` and `?ride=armed` — #669. The ride-time controls
 * that the fullest state does not render: *Start recording* and *Ask the
 * trainer for control* before a ride (a trainer paired, control not yet
 * granted), and *Resume*, *Yes, stop the ride* and *Keep riding* on a paused
 * ride with its stop armed. `ride-targets.browser.spec.ts` measures them; the
 * geometry cases in `rideview.browser.spec.ts` never ask for either.
 */
const RIDE_STATE = new URLSearchParams(window.location.search).get('ride');

function snapshot(): RideSnapshot {
  const riding = { ...ridingSnapshot(), keepAliveFailed: KEEP_ALIVE_FAILED };
  if (RIDE_STATE === 'idle') {
    return {
      ...riding,
      phase: 'idle',
      elapsedSeconds: 0,
      movingSeconds: 0,
      sampleCount: 0,
      trainer: { ...riding.trainer, hasControl: false, target: { kind: 'none' } },
    };
  }
  if (RIDE_STATE === 'armed') {
    return { ...riding, phase: 'paused', stopArmed: true };
  }
  if (WORKOUT_STATE !== 'eased' && WORKOUT_STATE !== 'running') {
    return riding;
  }
  return {
    ...riding,
    workout: {
      name: WORKOUT.name,
      status: 'running',
      elapsedSeconds: 312,
      totalSeconds: 720,
      holdingWatts: WORKOUT_STATE === 'eased' ? 0 : 225,
      nowRiding: '12 min at 90%',
      fault: undefined,
      rescue: WORKOUT_STATE === 'eased' ? FLOOR : undefined,
      timeline: expandWorkout(WORKOUT.workout),
    },
  };
}

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
  /** The route's `h1`, and the one-line summary the shell puts after it. */
  readonly title: Box | undefined;
  readonly summary: Box | undefined;
  /** `main`'s box and class, so a failure says whether the measure is on. */
  readonly main: Box | undefined;
  /** The primary navigation's box — the rail, on a tablet, since #427. */
  readonly primaryNav: Box | undefined;
  readonly mainClass: string;
  /** How wide the content is allowed to be: `main`'s resolved `max-width`. */
  readonly mainMaxWidth: string;
  readonly scrollY: number;
  /** How far the document COULD scroll: `scrollHeight − innerHeight` (#439). */
  readonly pageOverflow: number;
  /** What `theme.css` resolved a metric card's background to, as a load check. */
  readonly cardBackground: string;
  /** #605: the workout's Eased notice, disclosure included, if there is one. */
  readonly eased: { readonly box: Box; readonly text: string; readonly open: boolean } | undefined;
  /**
   * #647: the keep-the-screen-on notice, if there is one — its box, its
   * words, whether any `<details>` holds it, and whether it is the topmost
   * thing at its own centre.
   */
  readonly keepScreenOn:
    | {
        readonly box: Box;
        readonly text: string;
        readonly inDisclosure: boolean;
        readonly onTop: boolean;
      }
    | undefined;
}

declare global {
  interface Window {
    __oylRideView?: {
      readonly ready: boolean;
      readonly errors: readonly string[];
      readonly measure: () => RideViewMeasurement;
      /** The control. @see this file's header */
      readonly constrain: () => void;
      /** #439's control. @see ride-harness.tsx §restoreFullHeightShell */
      readonly restoreFullHeightShell: () => void;
      /** #605: open *How the target comes back*, as a rider's press does. */
      readonly openEasedDetail: () => void;
      /** #605's control: the running workout as #585 shipped it. @see restoreAsShipped */
      readonly restoreAsShipped: () => void;
      /** #647's control: the notice moved above Pause / Stop. @see noticeAboveControls */
      readonly noticeAboveControls: () => void;
      /** #647's control: the notice moved under Pause / Stop. @see noticeUnderControls */
      readonly noticeUnderControls: () => void;
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
    // `summary` since #605: *How the target comes back* is a control a rider
    // presses, so it is held to being on the screen like any other.
    // ⚠️ Since #659 the sensors group's one control is a LINK — pairing
    // moved to Devices and this group says what is connected and links there.
    // Links are counted in that group alone, so the fold assertions on the
    // other two measure exactly what they measured before.
    const selector =
      group === 'sensors'
        ? 'button, select, input, summary, a[href]'
        : 'button, select, input, summary';
    for (const control of root.querySelectorAll(selector)) {
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
  const nav = document.querySelector('nav[aria-label="Primary"]');
  const card = document.querySelector('.oyl-metric');
  const title = document.querySelector('main > h1');
  const summary = document.querySelector('main > h1 + p');
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    controls,
    groups,
    title: title === null ? undefined : boxOf(title),
    summary: summary === null ? undefined : boxOf(summary),
    main: main === null ? undefined : boxOf(main),
    primaryNav: nav === null ? undefined : boxOf(nav),
    mainClass: main?.className ?? '',
    mainMaxWidth: main === null ? '' : window.getComputedStyle(main).maxWidth,
    scrollY: window.scrollY,
    pageOverflow: document.documentElement.scrollHeight - window.innerHeight,
    cardBackground: card === null ? '' : window.getComputedStyle(card).backgroundColor,
    eased: easedNotice(),
    keepScreenOn: keepScreenOnNotice(),
  };
}

/** #647's notice, found by its label — the words a rider reads first. */
function keepScreenOnElement(): Element | undefined {
  return [...document.querySelectorAll('.oyl-ride__group--live .oyl-status')].find(
    (each) => textOf(each.querySelector('.oyl-status__label') ?? each) === 'Keep the screen on:',
  );
}

function keepScreenOnNotice(): RideViewMeasurement['keepScreenOn'] {
  const notice = keepScreenOnElement();
  if (notice === undefined) {
    return undefined;
  }
  const box = boxOf(notice);
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return {
    box,
    text: textOf(notice),
    inDisclosure: notice.closest('details') !== null || notice.querySelector('details') !== null,
    onTop: hit !== null && (hit === notice || notice.contains(hit)),
  };
}

/**
 * #647's first control: the notice where `notificationNotice` sits — ABOVE
 * *Pause* / *Stop* — on the live element. #436's review measured what a line
 * there costs those two on a tablet; this is that cost, for this sentence.
 */
function noticeAboveControls(): void {
  const { notice, pause } = keepScreenOnParts();
  // #669: Pause and Stop are one row (`.oyl-ride__actions`); the notice goes
  // above the row, where it went above the two buttons before.
  (pause.closest('.oyl-ride__actions') ?? pause).before(notice);
}

/**
 * #647's second control — #693's review: the notice as that pull request
 * first shipped it, UNDER *Pause* / *Stop*. Moved out of
 * `.oyl-ride__heading` it is an ordinary status again, padding and all, and
 * its own margin to the fold is the one the review found under 50 px.
 */
function noticeUnderControls(): void {
  const { notice, stop } = keepScreenOnParts();
  (stop.closest('.oyl-ride__actions') ?? stop).after(notice);
}

function keepScreenOnParts(): {
  readonly notice: Element;
  readonly pause: Element;
  readonly stop: Element;
} {
  const notice = keepScreenOnElement();
  const buttons = [...document.querySelectorAll('.oyl-ride__group--live button')];
  const pause = buttons.find((each) => textOf(each) === 'Pause');
  const stop = buttons.find((each) => textOf(each) === 'Stop');
  if (notice === undefined || pause === undefined || stop === undefined) {
    throw new Error('rideview harness: there is no keep-the-screen-on notice, Pause and Stop');
  }
  return { notice, pause, stop };
}

/** The Eased notice's surface: the status with its disclosure, as laid out. */
function easedElement(): Element | undefined {
  return [...document.querySelectorAll('.oyl-ride__group--trainer .oyl-status')].find(
    (each) => textOf(each.querySelector('.oyl-status__label') ?? each) === 'Eased:',
  );
}

function easedNotice(): RideViewMeasurement['eased'] {
  const notice = easedElement();
  if (notice === undefined) {
    return undefined;
  }
  return {
    box: boxOf(notice),
    text: textOf(notice),
    open: notice.querySelector('details')?.open ?? false,
  };
}

function openEasedDetail(): void {
  const summary = easedElement()?.querySelector('summary');
  if (!(summary instanceof HTMLElement)) {
    throw new Error('rideview harness: the Eased notice has no disclosure to open');
  }
  summary.click();
}

/**
 * #605's control: the running workout's section as #585 shipped it — the
 * WHOLE Eased sentence on the screen, four sentences and no disclosure, and
 * *End workout* LAST, after the three lines of reading. Rewritten on the live
 * elements rather than rendered from a second component, so it is the same
 * surface, in the same column, under the same stylesheet.
 *
 * ⚠️ **What it does NOT put back is the ERG form**, which #605 stopped
 * offering while a workout runs (`TrainerPanel.tsx` §`workoutOwnsTarget`): a
 * form is state a harness cannot fake honestly. That half is proven by the
 * mutation recorded in the pull request — the prop forced to `false` — and by
 * `TrainerPanel.test.tsx` §"#605".
 */
function restoreAsShipped(): void {
  const notice = easedElement();
  const section = notice?.closest('section');
  const end = [...(section?.querySelectorAll('button') ?? [])].find(
    (each) => textOf(each) === 'End workout',
  );
  const glyph = notice?.querySelector('.oyl-status__glyph')?.cloneNode(true);
  const label = notice?.querySelector('.oyl-status__label')?.cloneNode(true);
  if (notice === undefined || !section || !end || !glyph || !label) {
    throw new Error('rideview harness: there is no running workout with an Eased notice');
  }
  const long = document.createElement('p');
  long.className = notice.className;
  const body = document.createElement('span');
  body.append(label, workoutRescueText(FLOOR, 'ride-screen'));
  long.append(glyph, body);
  notice.replaceWith(long);
  section.append(end);
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

/** #439's control. @see ride-harness.tsx §restoreFullHeightShell */
function restoreFullHeightShell(): void {
  const style = document.createElement('style');
  style.textContent = '.oyl-shell { min-height: 100vh; }';
  document.head.append(style);
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
  window.location.hash = '#/ride';

  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell
          capabilities={NO_BLUETOOTH}
          rideController={stubRideController(snapshot()).controller}
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
  //
  // #605: with a workout running there is no such control — `WorkoutPanel`
  // shows the running workout instead, so the wait is for *End workout* and,
  // when this page was asked for one, the Eased notice.
  if (RIDE_STATE === 'idle' || RIDE_STATE === 'armed') {
    const awaited = RIDE_STATE === 'idle' ? 'Start recording' : 'Keep riding';
    await until(awaited, () =>
      [...document.querySelectorAll('.oyl-ride__group--live button')].find(
        (each) => textOf(each) === awaited,
      ),
    );
  } else if (WORKOUT_STATE === 'eased' || WORKOUT_STATE === 'running') {
    await until('the running workout', () =>
      [...document.querySelectorAll('.oyl-ride__group--trainer button')].find(
        (each) => textOf(each) === 'End workout',
      ),
    );
    if (WORKOUT_STATE === 'eased') {
      await until('the Eased notice', easedElement);
    }
  } else {
    await until('the control that starts a workout', () =>
      [...document.querySelectorAll('.oyl-ride__group--trainer button')].find(
        (each) => textOf(each) === `Ride ${WORKOUT.name}`,
      ),
    );
  }
  if (KEEP_ALIVE_FAILED) {
    await until('the keep-the-screen-on notice', keepScreenOnElement);
  }
  await document.fonts.ready;

  window.__oylRideView = {
    ready: true,
    errors,
    measure,
    constrain,
    restoreFullHeightShell,
    openEasedDetail,
    restoreAsShipped,
    noticeAboveControls,
    noticeUnderControls,
  };
}

run().catch((error: unknown) => {
  errors.push(error instanceof Error ? error.message : String(error));
  window.__oylRideView = {
    ready: false,
    errors,
    measure,
    constrain,
    restoreFullHeightShell,
    openEasedDetail,
    restoreAsShipped,
    noticeAboveControls,
    noticeUnderControls,
  };
});
