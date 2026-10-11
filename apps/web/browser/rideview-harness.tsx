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
  beatsPerMinute,
  expandWorkout,
  metres,
  seconds,
  thresholdShare,
  unixSeconds,
  watts,
  type WorkoutRescue,
} from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  workoutId,
  type AthleteRecord,
  type WorkoutRecord,
} from '@onyourleft/store';

import { stubAnalysis } from '../src/analysis/testing';
import { scriptedSidePairing } from '../src/camera/testing';
import { RIDE_NOTIFICATION_REFUSED, type RideSnapshot } from '../src/ride/controller';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../src/ride/testing';
import { AppShell } from '../src/shell/AppShell';
import { viewGroupsLoaded } from './views-loaded';
import type { CapabilityProbe } from '../src/support/bluetooth-support';
import { workoutRescueText } from '../src/workout/rescue-text';
import type { WorkoutHold } from '../src/workout/hold-text';
import { workoutStub } from '../src/workouts/testing';

// The shipping stylesheet, which is the whole point — see this file's header.
import '../src/design/theme.css';
import '../src/design/tailwind.css';

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

/**
 * `rideview.html?workout=hold` — #1240: a workout running a heart-rate hold,
 * so its notice (the range, the target and one sentence) stands in the
 * running workout's section. Through the stub's snapshot, for
 * {@link WORKOUT_STATE}'s reason: `ride/controller.test.ts` §"#1240" drives
 * the real controller; this page measures where the notice lands.
 *
 * ⚠️ **The longest sentence `workout/hold-text.ts` can produce** — a range
 * above the rider's threshold heart rate — because the one that binds a fold
 * is the one that wraps furthest.
 */
const HOLD: WorkoutHold = {
  reason: 'ineligible',
  off: 'range',
  range: { low: beatsPerMinute(130), high: beatsPerMinute(140) },
  target: 125,
};

const HOLD_WORKOUT = {
  name: 'Endurance hold',
  workout: {
    name: 'Endurance hold',
    blocks: [
      {
        kind: 'heart-rate-hold' as const,
        seconds: seconds(1800),
        range: HOLD.range,
        startShare: thresholdShare(0.5),
        ceilingShare: thresholdShare(0.8),
      },
    ],
  },
};

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

/**
 * #692 — the standing notices this screen can hold during a ride, each on
 * its own query so a case can stand one alone or every one at once:
 *
 *   `?notification=refused`  #526's *No notification* — Android only, for the
 *                            rest of the ride, and until #692 ABOVE *Pause*
 *   `?storage=full`          the recorder's *Device full*, the longer of its
 *                            two sentences
 *   `?side=lost`             #551's lost side-camera link, with its own
 *                            control, *Stop side camera*, through the
 *                            scripted pairing the unit tests use
 *
 * Through the stub's snapshot for the reason {@link WORKOUT_STATE} is: this
 * page measures where the sentences land, not who raises them.
 */
const QUERY = new URLSearchParams(window.location.search);
const NOTIFICATION_REFUSED = QUERY.get('notification') === 'refused';
const STORAGE_FULL = QUERY.get('storage') === 'full';
const SIDE = QUERY.get('side');
const SIDE_PAIRING =
  SIDE === 'filming' || SIDE === 'lost' ? scriptedSidePairing({ phone: SIDE }) : undefined;

/**
 * `rideview.html?erg=held` — #740 (#655's review, N1): a HAND-SET target the
 * stall rescue has eased to the floor, with the rider's next *Set* held — the
 * *Eased* notice and the *Held* line both standing in the trainer group, above
 * the ERG form whose *End ERG* the Eased sentence itself names. No fixture
 * rendered a manual rescue before: `?workout=eased` is a workout's, where this
 * form is absent. The words are the real `rescueSentence` and `heldSentence`,
 * rendered by `TrainerPanel` from the snapshot as the real controller fills
 * it (`controller.test.ts` §"#655" asserts that half).
 */
const ERG_HELD = QUERY.get('erg') === 'held';

/**
 * `rideview.html?sensors=none` — #1012: a ride RECORDING with nothing paired,
 * so the Live group shows the one sensor banner where the readings go. The
 * trainer is unpaired too — a paired trainer IS a paired sensor — so the
 * trainer group says so and offers no control. With `&ride=idle` it is the
 * same screen before a ride (#1029).
 */
const NO_SENSORS = QUERY.get('sensors') === 'none';

/**
 * `rideview.html?readings=widest` — #1012: every reading live at the widest it
 * can plausibly be — four digits of power, three of cadence and heart rate,
 * and a speed just under 100 km/h — so "every reading fits its card" is about
 * the numbers a sprint produces rather than the fixture's 248 W.
 */
const WIDEST_READINGS = QUERY.get('readings') === 'widest';

/**
 * `rideview.html?ride=saved` — #1042: a ride stopped and SAVED, with its
 * result card at its fullest — a heart rate as well as power, hours of
 * elapsed time, and the longest of the game's outcome sentences — so "the
 * card fits above the fold" is about the tallest card there is.
 *
 * ⚠️ The elapsed time is `10:23:45` since #1083, the widest duration a fact
 * shows short of a day: it was `3:25:45` (12 345 s), and the card's facts
 * were sized from a Mac's `10:23:45` that nothing here had ever drawn.
 */
const SAVED_RIDE = {
  activityId: activityId('harness-ride'),
  elapsedTime: seconds(37_425),
  distance: metres(123_456),
  averagePower: watts(1_234),
  averageHeartRate: beatsPerMinute(188),
  gameOutcome: 'not-beaten' as const,
};

function snapshot(): RideSnapshot {
  const riding = {
    ...ridingSnapshot(),
    keepAliveFailed: KEEP_ALIVE_FAILED,
    notificationNotice: NOTIFICATION_REFUSED ? RIDE_NOTIFICATION_REFUSED : undefined,
    storage: STORAGE_FULL ? ('quota-exceeded' as const) : ('ok' as const),
  };
  if (WIDEST_READINGS) {
    const at = unixSeconds(1_800_000_000);
    return {
      ...riding,
      metrics: [
        { id: 'power', state: { kind: 'live', value: 1888, at } },
        { id: 'cadence', state: { kind: 'live', value: 188, at } },
        { id: 'heartRate', state: { kind: 'live', value: 188, at } },
        { id: 'speed', state: { kind: 'live', value: 27.7, at } },
      ],
    };
  }
  if (NO_SENSORS) {
    const nothing = idleSnapshot();
    // #1029: `&ride=idle` is the same screen before a ride — the one where the
    // other ways to ride are offered under the Live and Sensors groups.
    return RIDE_STATE === 'idle'
      ? nothing
      : { ...riding, sensors: [], metrics: nothing.metrics, trainer: nothing.trainer };
  }
  if (ERG_HELD) {
    return {
      ...riding,
      trainer: {
        ...riding.trainer,
        ergRescue: {
          target: watts(250),
          holding: 'floor',
          reason: 'Pedalling has stopped, so the target has been dropped to the trainer’s lowest.',
          pending: watts(180),
        },
        ergHeld: { target: watts(180), press: 1 },
      },
    };
  }
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
  if (RIDE_STATE === 'saved') {
    return {
      ...riding,
      phase: 'stopped',
      saveState: 'saved',
      savedActivityId: SAVED_RIDE.activityId,
      savedRide: SAVED_RIDE,
    };
  }
  if (RIDE_STATE === 'armed') {
    return { ...riding, phase: 'paused', stopArmed: true };
  }
  if (WORKOUT_STATE === 'hold') {
    return {
      ...riding,
      workout: {
        name: HOLD_WORKOUT.name,
        status: 'running',
        elapsedSeconds: 312,
        totalSeconds: 1800,
        holdingWatts: HOLD.target,
        nowRiding: '30 min holding 130–140 bpm',
        fault: undefined,
        rescue: undefined,
        hold: HOLD,
        timeline: expandWorkout(HOLD_WORKOUT.workout),
      },
    };
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
  /**
   * #692: every standing notice in the live and trainer groups — its label
   * (the words a rider reads first), its box, and whether it is the topmost
   * thing at its own centre. Found by `.oyl-status`, so a notice this page
   * was not written to expect is measured too.
   */
  readonly notices: readonly RideViewNotice[];
  /** #692: the four metric cards' list, which is what moves now instead. */
  readonly metrics: Box | undefined;
  /**
   * #740: the cards on the list's FIRST row — whatever the grid put there —
   * as one box, so the readings a rider looks at first can be held on the
   * screen while a notice stands, which the whole list cannot be.
   */
  readonly metricsTopRow: Box | undefined;
  /** #1012: how many rows the readings are laid out in. */
  readonly metricRows: number;
  /**
   * #1012: every reading's card, the reading inside it, and whether anything
   * in the card is wider than the card — a reading spilling onto the one
   * beside it is #259's failure on this screen.
   */
  readonly readings: readonly RideViewReading[];
  /**
   * #1042: the result card, if one stands — its box, its one link (a link is
   * not in {@link controls}' live group, whose fold assertions predate it),
   * and whether anything inside a fact spills out of it.
   */
  readonly resultCard:
    | {
        readonly box: Box;
        readonly link: { readonly name: string; readonly box: Box; readonly onTop: boolean };
        readonly spill: number;
        /** #1083: each fact's reading, as drawn — `10:23:45` among them. */
        readonly readings: readonly string[];
        /** #1083: the most lines any fact's reading is laid out on. */
        readonly mostReadingLines: number;
        /**
         * #1083: how far the furthest reading's right edge passes its own
         * fact's `dd` — `reflow-harness.tsx` §`readingFit`'s measure.
         */
        readonly readingSpill: number;
      }
    | undefined;
  /** #1012: the sensor banner, if one stands, and its one link. */
  readonly sensorBanner:
    | {
        readonly box: Box;
        readonly link: { readonly name: string; readonly box: Box; readonly onTop: boolean };
        readonly links: number;
      }
    | undefined;
}

/** One reading on the Ride screen. @see RideViewMeasurement.readings */
export interface RideViewReading {
  readonly label: string;
  readonly card: Box;
  /** The card's right edge less its border and padding: where a reading must end. */
  readonly contentRight: number;
  readonly reading: Box;
  /** `scrollWidth − clientWidth` of the card: above zero, something spilled. */
  readonly spill: number;
}

/** One standing notice. @see RideViewMeasurement.notices */
export interface RideViewNotice {
  readonly group: 'live' | 'trainer';
  readonly label: string;
  readonly box: Box;
  readonly onTop: boolean;
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
      /** #692's control: the screen as it was laid out before #692. @see asBefore692 */
      readonly asBefore692: () => void;
      /** #740's control: the Held line back above the ERG form. @see heldAboveTheForm */
      readonly heldAboveTheForm: () => void;
      /** #1012's control: four readings to a row at any width. @see crammedReadings */
      readonly crammedReadings: () => void;
      /** #1042's control: the card after the clock. @see cardAfterTheReadings */
      readonly cardAfterTheReadings: () => void;
      /** #1083's control: the card's facts on 7rem tracks. @see narrowResultFacts */
      readonly narrowResultFacts: () => void;
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
  const metricGrid = document.querySelector('.oyl-ride__group--live .oyl-metric-grid');
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
    notices: standingNotices(),
    metrics: metricGrid === null ? undefined : boxOf(metricGrid),
    metricsTopRow: topRowOf(metricGrid),
    metricRows:
      metricGrid === null
        ? 0
        : new Set(
            [...metricGrid.querySelectorAll(':scope > .oyl-metric')].map((card) =>
              Math.round(card.getBoundingClientRect().top),
            ),
          ).size,
    readings: readingsOf(metricGrid),
    sensorBanner: sensorBannerOf(),
    resultCard: resultCardOf(),
  };
}

function resultCardOf(): RideViewMeasurement['resultCard'] {
  const card = document.querySelector('[data-oyl-result-card]');
  const link = card?.querySelector('a[href]');
  if (card === null || card === undefined || link === null || link === undefined) return undefined;
  const box = boxOf(link);
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  const spill = Math.max(
    0,
    ...[...card.querySelectorAll('.oyl-result__facts > div')].map(
      (fact) => fact.scrollWidth - fact.clientWidth,
    ),
  );
  const values = [...card.querySelectorAll('.oyl-result__facts .oyl-reading__value')];
  const lines = values.map((value) => value.getClientRects().length);
  const spills = values.map((value) => {
    const fact = value.closest('dd');
    return fact === null
      ? 0
      : value.getBoundingClientRect().right - fact.getBoundingClientRect().right;
  });
  return {
    box: boxOf(card),
    link: { name: textOf(link), box, onTop: hit !== null && (hit === link || link.contains(hit)) },
    spill,
    readings: values.map((value) => (value.textContent ?? '').trim()),
    mostReadingLines: lines.length === 0 ? 0 : Math.max(...lines),
    readingSpill: spills.length === 0 ? 0 : Math.max(...spills),
  };
}

/**
 * #1042's control: the result card where a naive placement would put it —
 * after the readings and the clock, at the END of the Live group — which the
 * spec requires to put *Done* under the floor at the owner's tablet in the
 * shell. Without it, "the card clears the fold" is as true of a card that
 * could go anywhere.
 */
function cardAfterTheReadings(): void {
  const live = document.querySelector('.oyl-ride__group--live');
  const card = live?.querySelector('[data-oyl-result-card]');
  const clock = live?.querySelector('.oyl-ride__clock');
  if (!live || !card || !clock) {
    throw new Error('rideview harness: ?ride=saved did not render its result card and clock');
  }
  clock.after(card);
}

/**
 * #1083's control: the result card's facts on 7rem tracks, narrower than a
 * `10:23:45` in the reading's `xxl` on any font measured — which the spec
 * requires to wrap or spill. Without it, "the card's readings fit" is as true
 * of a card whose facts were never measured at a ten-hour ride.
 */
function narrowResultFacts(): void {
  const facts = document.querySelector<HTMLElement>('[data-oyl-result-card] .oyl-result__facts');
  if (facts === null) {
    throw new Error('rideview harness: ?ride=saved did not render its result card’s facts');
  }
  facts.style.gridTemplateColumns = 'repeat(auto-fit, minmax(7rem, 1fr))';
}

/** @see RideViewMeasurement.readings */
function readingsOf(grid: Element | null): RideViewReading[] {
  if (grid === null) return [];
  return [...grid.querySelectorAll(':scope > .oyl-metric')].map((card) => {
    const reading = card.querySelector('.oyl-reading');
    const style = window.getComputedStyle(card);
    const box = boxOf(card);
    return {
      label: textOf(card.querySelector('.oyl-metric__label') ?? card),
      card: box,
      contentRight: box.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth),
      reading: reading === null ? boxOf(card) : boxOf(reading),
      spill: card.scrollWidth - card.clientWidth,
    };
  });
}

/** @see RideViewMeasurement.sensorBanner */
function sensorBannerOf(): RideViewMeasurement['sensorBanner'] {
  const banner = document.querySelector('[data-oyl-sensor-banner]');
  const links = banner === null ? [] : [...banner.querySelectorAll('a[href]')];
  const link = links[0];
  if (banner === null || link === undefined) return undefined;
  const box = boxOf(link);
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return {
    box: boxOf(banner),
    link: { name: textOf(link), box, onTop: hit !== null && (hit === link || link.contains(hit)) },
    links: links.length,
  };
}

/**
 * #1012's control: all four readings in one row however narrow the Live group
 * is — what the grid would be with the container query's two-to-a-row step
 * taken out. The spec requires a reading to spill out of its card then at a
 * phone; without that, "nothing spills" is as true of a grid that never got
 * narrow.
 */
function crammedReadings(): void {
  const style = document.createElement('style');
  style.textContent =
    '.oyl-metric-grid--live { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }';
  document.head.append(style);
}

/** The union of the cards whose top is the grid's first row. @see RideViewMeasurement */
function topRowOf(grid: Element | null): Box | undefined {
  const cards = grid === null ? [] : [...grid.querySelectorAll(':scope > .oyl-metric')].map(boxOf);
  if (cards.length === 0) return undefined;
  const top = Math.min(...cards.map((card) => card.top));
  const row = cards.filter((card) => card.top < top + 1);
  const left = Math.min(...row.map((card) => card.left));
  const right = Math.max(...row.map((card) => card.right));
  const bottom = Math.max(...row.map((card) => card.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function standingNotices(): RideViewNotice[] {
  const notices: RideViewNotice[] = [];
  for (const group of ['live', 'trainer'] as const) {
    for (const notice of document.querySelectorAll(`.oyl-ride__group--${group} .oyl-status`)) {
      const box = boxOf(notice);
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      notices.push({
        group,
        label: textOf(notice.querySelector('.oyl-status__label') ?? notice),
        box,
        onTop: hit !== null && (hit === notice || notice.contains(hit)),
      });
    }
  }
  return notices;
}

/**
 * #692's control: the screen as it was laid out before #692, rewritten on the
 * live elements under the same stylesheet — every part of the change, because
 * each is what one orientation or one notice needed:
 *
 *   - in the Live group, the metric cards back ABOVE the ride controls, *No
 *     notification* back above *Pause*, and the clock, the storage notice and
 *     the side camera back in their old order after the controls;
 *   - on a tablet held upright, ONE column again, the trainer group under the
 *     live one, which is what the width-only rule gave an 800 px screen; and
 *   - the metric cards at their old size under a standing notice.
 *
 * The spec requires the lowest ride control to fall under the floor with a
 * standing notice on the page; without that, "every control clears the fold"
 * is just as true of a page that measured nothing.
 */
/**
 * #740's control: the *Held* line back where #655 put it — straight after the
 * *Eased* notice, above the ERG form — on the live elements. The spec requires
 * *End ERG* under the floor then; without it "End ERG clears the fold" is as
 * true of a page whose Held line was never rendered.
 */
function heldAboveTheForm(): void {
  const trainer = document.querySelector('.oyl-ride__group--trainer');
  const labelled = (label: string): Element | undefined =>
    [...(trainer?.querySelectorAll('.oyl-status') ?? [])].find(
      (each) => textOf(each.querySelector('.oyl-status__label') ?? each) === label,
    );
  const eased = labelled('Eased:');
  const held = labelled('Held:');
  if (eased === undefined || held === undefined) {
    throw new Error('rideview harness: ?erg=held did not render its Eased and Held notices');
  }
  eased.after(held);
}

function asBefore692(): void {
  const live = document.querySelector('.oyl-ride__group--live');
  const heading = live?.querySelector('.oyl-ride__heading');
  const grid = live?.querySelector('.oyl-metric-grid');
  const actions = live?.querySelector('.oyl-ride__actions');
  const clock = live?.querySelector('.oyl-ride__clock');
  if (!live || !heading || !grid || !actions || !clock) {
    throw new Error('rideview harness: the Live group is not laid out as #692 left it');
  }
  heading.after(grid);
  const statusLabelled = (label: string): Element | undefined =>
    [...live.querySelectorAll('.oyl-status')].find(
      (each) => textOf(each.querySelector('.oyl-status__label') ?? each) === label,
    );
  const noNotification = statusLabelled('No notification:');
  if (noNotification !== undefined) {
    actions.before(noNotification);
  }
  // Before #692: the controls, the clock, the storage notice, the side camera.
  const storage = statusLabelled('Device full:') ?? statusLabelled('Save failed:');
  const side = live.querySelector('.oyl-ride__side-camera');
  const last = [...live.querySelectorAll('.oyl-ride__actions')].at(-1) ?? actions;
  last.after(clock);
  if (storage !== undefined) {
    clock.after(storage);
  }
  if (side !== null) {
    (storage ?? clock).after(side);
  }
  const style = document.createElement('style');
  // One column upright, and the metric cards at the size they always had —
  // the tightening under a standing notice is #692's too.
  style.textContent = [
    '@media (max-width: 59.99rem) { .oyl-ride { grid-template-columns: minmax(0, 1fr); } }',
    '.oyl-ride__group--live > .oyl-metric-grid { gap: var(--oyl-space-md) !important;',
    '  margin-top: var(--oyl-space-lg) !important; }',
    '.oyl-ride__group--live .oyl-metric { padding: var(--oyl-space-md) !important; }',
    // ⚠️ And the readings as they were before #1012, which is how they were
    // before #692 too: the Live group one column of three on a landscape
    // tablet, the cards `auto-fit` at 10rem (so ONE to a row upright), and
    // the unit on a line of its own under the number. Without this the
    // control measured #1012's one row of readings and stopped failing.
    '@media (min-width: 76rem) { .oyl-ride { grid-template-areas: none !important;',
    '  grid-template-rows: none !important; }',
    '  .oyl-ride > .oyl-ride__group { grid-area: auto !important; } }',
    '.oyl-metric-grid--live { grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)) !important; }',
    '.oyl-metric .oyl-reading__unit { display: block; }',
  ].join('\n');
  document.head.append(style);
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

  // #674: the view groups first, so every view renders on the render that asks.
  await viewGroupsLoaded();
  flushSync(() => {
    createRoot(host).render(
      <StrictMode>
        <AppShell
          capabilities={NO_BLUETOOTH}
          rideController={stubRideController(snapshot()).controller}
          workouts={workoutStub(ATHLETE, [WORKOUT])}
          analysis={stubAnalysis(ATHLETE, [], RIDER)}
          {...(SIDE_PAIRING === undefined ? {} : { sidePairing: SIDE_PAIRING })}
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
  if (NO_SENSORS) {
    await until('the sensor banner', () => document.querySelector('[data-oyl-sensor-banner]'));
  } else if (RIDE_STATE === 'saved') {
    await until('the result card', () => document.querySelector('[data-oyl-result-card]'));
  } else if (RIDE_STATE === 'idle' || RIDE_STATE === 'armed') {
    const awaited = RIDE_STATE === 'idle' ? 'Start recording' : 'Keep riding';
    await until(awaited, () =>
      [...document.querySelectorAll('.oyl-ride__group--live button')].find(
        (each) => textOf(each) === awaited,
      ),
    );
  } else if (WORKOUT_STATE === 'hold') {
    await until('the heart-rate hold', () =>
      [...document.querySelectorAll('.oyl-ride__group--trainer .oyl-status')].find(
        (each) => textOf(each.querySelector('.oyl-status__label') ?? each) === 'Heart-rate hold:',
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
  // #692: each standing notice this page was asked for, before anything is
  // measured — a margin taken before the side camera's line arrives is a
  // margin over a screen without it.
  if (SIDE_PAIRING !== undefined) {
    await until('the side camera on the Ride screen', () =>
      document.querySelector('.oyl-ride__group--live .oyl-ride__side-camera'),
    );
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
    asBefore692,
    heldAboveTheForm,
    crammedReadings,
    cardAfterTheReadings,
    narrowResultFacts,
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
    asBefore692,
    heldAboveTheForm,
    crammedReadings,
    cardAfterTheReadings,
    narrowResultFacts,
  };
});
