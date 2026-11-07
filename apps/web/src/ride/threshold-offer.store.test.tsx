// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A threshold test's estimate, offered after the ride and read back the next
 * day — #2307.
 *
 * The test is ridden as #2306 rides a built-in: from *Ride it*'s address,
 * through the real controller against the simulated trainer
 * (`simulated-trainer-testing.ts`), saved through the real store. The offer
 * is pressed on the real Ride screen, over an analysis port on that store.
 * Then the store is closed and opened again on a connection nothing wrote on,
 * and the answer is read back through the screens a rider would read it on —
 * the Analysis screen's threshold, and the watts in the next built-in's
 * preview — never from the object the offer wrote.
 */

import {
  BUILT_IN_WORKOUTS,
  beatsPerMinute,
  seconds,
  watts,
  type WorkoutTemplate,
} from '@onyourleft/domain';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import {
  activityId,
  lapId,
  openActivityStore,
  recordingSessionId,
  type ActivityStore,
} from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { matchHash } from '../shell/routes';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { AnalysisView } from '../views/AnalysisView';
import { RideView } from '../views/RideView';
import { WorkoutsView } from '../views/WorkoutsView';
import {
  builtInRideFromQuery,
  hrefForRidingBuiltIn,
  offeredWorkout,
} from '../workouts/built-in-ride';
import { EMPTY_TAILOR_DRAFT } from '../workouts/tailor';
import { createRideController, type RideController } from './controller';
import { simulatedOpenTrainer } from './simulated-trainer-testing';
import { THRESHOLD_OFFER_TEXT } from './ThresholdOffer';

const THRESHOLD_NOW = 230;

let harness: StoreHarness;
let mounted: Mounted | undefined;
const opened: ActivityStore[] = [];

beforeEach(async () => {
  harness = createStoreHarness();
  await seedAthletes(harness);
  await harness.write((store) =>
    store.setAthleteThresholds(ATHLETE_A, {
      thresholdPower: watts(THRESHOLD_NOW),
      thresholdHeartRate: beatsPerMinute(170),
    }),
  );
});

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  for (const store of opened.splice(0)) store.close();
  await harness.destroy();
});

function template(id: string): WorkoutTemplate {
  const found = BUILT_IN_WORKOUTS.find((each) => each.id === id);
  if (found === undefined) throw new Error(`no built-in ${id}`);
  return found;
}

/** A store on a connection of its own, as a page opens one. */
function freshStore(): ActivityStore {
  const store = openActivityStore(harness.databaseName);
  opened.push(store);
  return store;
}

/** The controller over the simulated trainer, saving through the real store. */
function rig(): { readonly controller: RideController; readonly advance: () => Promise<void> } {
  const { transport, bench } = createSimulator({
    devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
  });
  let laps = 0;
  const controller = createRideController({
    transport,
    store: {
      putRecordingSession: async (record) =>
        harness.write(async (store) => store.putRecordingSession(record)),
      appendRecordingChunk: async (chunk) =>
        harness.write(async (store) => store.appendRecordingChunk(chunk)),
      readRecordingSessions: async (owner) =>
        harness.write(async (store) => store.readRecordingSessions(owner)),
      recoverRecording: async (owner, id) =>
        harness.write(async (store) => store.recoverRecording(owner, id)),
      deleteRecordingSession: async (owner, id) =>
        harness.write(async (store) => store.deleteRecordingSession(owner, id)),
    },
    athleteId: ATHLETE_A,
    newSessionId: () => recordingSessionId('test-session'),
    now: () => bench.now,
    openTrainer: simulatedOpenTrainer(bench, { written: [] }),
    rideSave: {
      newActivityId: () => activityId('the-test'),
      newLapId: () => lapId(`lap-${String((laps += 1))}`),
      timeZone: 'Europe/London',
      store: {
        putFinishedRide: (ride) => harness.write(async (store) => store.putFinishedRide(ride)),
      },
    },
  });
  return {
    controller,
    advance: async () => {
      bench.advance(seconds(1));
      await controller.tick(bench.now);
    },
  };
}

/**
 * Ride a built-in from *Ride it*'s address for `forSeconds` of its workout,
 * then end the workout and the ride and save it.
 */
async function rideBuiltIn(id: string, forSeconds: number): Promise<RideController> {
  const ride = builtInRideFromQuery(
    matchHash(hrefForRidingBuiltIn(template(id), EMPTY_TAILOR_DRAFT)).query,
  );
  if (ride === undefined) throw new Error('the address asks for no built-in');
  const offered = offeredWorkout(ride, ATHLETE_A, undefined, 1_800_000_000);
  if (offered.status !== 'offered') throw new Error(offered.message);
  const { controller, advance } = rig();
  await controller.pair('trainer');
  await controller.requestTrainerControl();
  await controller.start();
  expect(controller.startWorkout(offered.record, watts(THRESHOLD_NOW))).toBe(true);
  for (let guard = 0; (controller.getSnapshot().workout?.elapsedSeconds ?? 0) < forSeconds;) {
    if ((guard += 1) > forSeconds * 3) throw new Error('the workout did not move on');
    await advance();
  }
  controller.endWorkout();
  await advance();
  controller.armStop();
  await controller.confirmStop();
  return controller;
}

/** The Ride screen after the ride, over an analysis port on a store of its own. */
async function rideScreen(controller: RideController): Promise<void> {
  mounted = await mount(
    <RideView controller={controller} analysis={{ athleteId: ATHLETE_A, store: freshStore() }} />,
  );
  // The offer, and the rider's threshold now, which is read after it appears.
  await untilSettled(() =>
    (document.body.textContent ?? '').includes(`it is ${String(THRESHOLD_NOW)} W now`),
  );
}

async function untilSettled(done: () => boolean): Promise<void> {
  for (let turn = 0; !done(); turn += 1) {
    if (turn > 200) throw new Error('the screen never settled');
    await settle();
  }
}

function buttonSaying(text: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document, 'button').find(
    (each) => each.textContent === text,
  );
  if (found === undefined) throw new Error(`no button “${text}”`);
  return found;
}

/** Close everything, as a reload does, and open the Analysis screen on a fresh store. */
async function analysisThresholdAfterReload(): Promise<string> {
  mounted?.unmount();
  for (const store of opened.splice(0)) store.close();
  await harness.discard();
  mounted = await mount(<AnalysisView port={{ athleteId: ATHLETE_A, store: freshStore() }} />);
  const field = (): HTMLInputElement | null =>
    document.querySelector<HTMLInputElement>('#oyl-threshold-power');
  await untilSettled(() => (field()?.value ?? '') !== '');
  return field()?.value ?? '';
}

/** The next built-in's preview, on a fresh store: the watts line. */
async function previewWattsLine(): Promise<string> {
  mounted?.unmount();
  mounted = await mount(
    <WorkoutsView
      port={{ athleteId: ATHLETE_A, store: freshStore() }}
      analysis={{ athleteId: ATHLETE_A, store: freshStore() }}
      selected="built-in:sweet-spot-3x12"
    />,
  );
  await untilSettled(() => (document.body.textContent ?? '').includes('In watts from'));
  const line = queryAll(document, '[data-oyl-tailor-preview] p').find((each) =>
    (each.textContent ?? '').startsWith('In watts from'),
  );
  return line?.textContent ?? '';
}

describe('after a ramp test, the estimate is offered — #2307', () => {
  it('Accept: the Analysis screen and the next built-in’s preview read it from a fresh store, and heart rate is kept', async () => {
    // The warm-up and ten one-minute steps.
    const controller = await rideBuiltIn('ramp-test', 480 + 600);
    const offer = controller.getSnapshot().savedRide?.thresholdTest;
    if (offer?.estimate.kind !== 'estimate') throw new Error('no estimate was made');
    const estimate = offer.estimate.thresholdPower;
    expect(estimate).toBeGreaterThan(0);
    expect(estimate).not.toBe(THRESHOLD_NOW);

    await rideScreen(controller);
    const said = document.querySelector('[data-oyl-threshold-offer]')?.textContent ?? '';
    expect(said).toContain(
      `Your ramp test suggests a threshold of ${String(estimate)} W (it is ${String(THRESHOLD_NOW)} W now).`,
    );
    expect(said).toContain('0.75 of your best minute');
    await activateWithKeyboard(buttonSaying(THRESHOLD_OFFER_TEXT.accept(estimate)));
    await untilSettled(() =>
      (document.body.textContent ?? '').includes(THRESHOLD_OFFER_TEXT.accepted(estimate)),
    );
    controller.dispose();

    expect(await analysisThresholdAfterReload()).toBe(String(estimate));
    expect(await previewWattsLine()).toBe(
      `In watts from your threshold power of ${String(estimate)} W.`,
    );
    // Only the power changed: the threshold heart rate is the one set before.
    const athlete = await harness.read((store) => store.getAthlete(ATHLETE_A));
    expect(athlete?.thresholdHeartRate).toBe(170);
  });

  it('Accept: the same Ride screen reads the new threshold at once, for the next workout', async () => {
    // The rider has no threshold power yet, so the workout panel cannot start anything.
    await harness.write((store) =>
      store.setAthleteThresholds(ATHLETE_A, {
        thresholdPower: undefined,
        thresholdHeartRate: beatsPerMinute(170),
      }),
    );
    const controller = await rideBuiltIn('ramp-test', 480 + 600);
    const offer = controller.getSnapshot().savedRide?.thresholdTest;
    if (offer?.estimate.kind !== 'estimate') throw new Error('no estimate was made');
    const estimate = offer.estimate.thresholdPower;
    mounted = await mount(
      <RideView controller={controller} analysis={{ athleteId: ATHLETE_A, store: freshStore() }} />,
    );
    const said = (): string => document.body.textContent ?? '';
    await untilSettled(() => said().includes('Set your threshold power on the Analysis screen'));

    await activateWithKeyboard(buttonSaying(THRESHOLD_OFFER_TEXT.accept(estimate)));
    await untilSettled(() => said().includes(THRESHOLD_OFFER_TEXT.accepted(estimate)));
    // Without leaving the screen: the workout panel now has a threshold to ride at.
    await untilSettled(() => !said().includes('Set your threshold power on the Analysis screen'));
    expect(said()).toContain('No workouts saved on this device yet');
    controller.dispose();
  });

  it('Keep: the threshold is unchanged after a reload, read the same way', async () => {
    const controller = await rideBuiltIn('ramp-test', 480 + 600);
    await rideScreen(controller);
    await activateWithKeyboard(buttonSaying(THRESHOLD_OFFER_TEXT.keep));
    await settle();
    expect(document.body.textContent).toContain(THRESHOLD_OFFER_TEXT.kept);
    controller.dispose();

    expect(await analysisThresholdAfterReload()).toBe(String(THRESHOLD_NOW));
    expect(await previewWattsLine()).toBe(
      `In watts from your threshold power of ${String(THRESHOLD_NOW)} W.`,
    );
  });

  it('a ramp given up in its warm-up says why, and offers nothing to accept', async () => {
    const controller = await rideBuiltIn('ramp-test', 120);
    const offer = controller.getSnapshot().savedRide?.thresholdTest;
    expect(offer?.estimate.kind).toBe('refused');
    mounted = await mount(
      <RideView controller={controller} analysis={{ athleteId: ATHLETE_A, store: freshStore() }} />,
    );
    await untilSettled(() => (document.body.textContent ?? '').includes('made no threshold'));
    const shown = document.querySelector('[data-oyl-threshold-offer]');
    expect(shown?.textContent).toContain('Your ramp test made no threshold estimate.');
    expect(shown?.querySelectorAll('button')).toHaveLength(0);
    controller.dispose();
  });
});

describe('a ride that was not a test shows no estimate — #2307', () => {
  it('saves no threshold test, and the Ride screen offers none', async () => {
    const controller = await rideBuiltIn('recovery-easy-spin', 120);
    expect(controller.getSnapshot().savedRide).toBeDefined();
    expect(controller.getSnapshot().savedRide?.thresholdTest).toBeUndefined();
    mounted = await mount(
      <RideView controller={controller} analysis={{ athleteId: ATHLETE_A, store: freshStore() }} />,
    );
    await settle();
    expect(document.querySelector('[data-oyl-threshold-offer]')).toBeNull();
    expect(document.body.textContent).not.toContain('threshold estimate');
    controller.dispose();
  });
});
