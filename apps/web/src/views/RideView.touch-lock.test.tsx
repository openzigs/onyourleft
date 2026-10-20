// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1432 — the Ride screen's touch lock, driven through the REAL controller
 * over a store harness wherever the claim is about the ride: what is asserted
 * is what the controller says of the ride after a tap, not which stub method
 * was counted. The trainer's releases need a trainer under control, which the
 * stub's riding snapshot has and a simulator with no devices does not, so
 * those cases use the stub.
 */

import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { expandWorkout, seconds, thresholdShare } from '@onyourleft/domain';
import { createSimulator } from '@onyourleft/sensors/simulator';
import { recordingSessionId } from '@onyourleft/store';
import {
  ATHLETE_A,
  createStoreHarness,
  seedAthletes,
  type StoreHarness,
} from '@onyourleft/store/testing';

import { hold, tap } from '../design/touch-lock-testing';
import { TOUCH_LOCK_NAME } from '../design/TouchLockButton';
import type { RecordingCheckpointStore } from '../recording/recorder';
import { createRideController, type RideController } from '../ride/controller';
import { ridingSnapshot, stubRideController } from '../ride/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { RideView, TOUCH_LOCK_ON_LABEL, TOUCH_LOCK_ON_TEXT } from './RideView';

let mounted: Mounted | undefined;
let harness: StoreHarness | undefined;
let controller: RideController | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  controller?.dispose();
  controller = undefined;
  await harness?.destroy();
  harness = undefined;
  vi.useRealTimers();
});

function buttonNamed(label: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document, 'button').find(
    (button) => button.textContent?.trim() === label,
  );
  if (found === undefined) {
    throw new Error(
      `no button labelled "${label}". Present: ${queryAll<HTMLButtonElement>(document, 'button')
        .map((button) => button.textContent?.trim())
        .join(', ')}`,
    );
  }
  return found;
}

const lock = (): HTMLButtonElement => buttonNamed(TOUCH_LOCK_NAME);

/** The recorder's store, over the harness, as `RideView.test.tsx` §"#1430" builds it. */
function checkpoints(store: StoreHarness): RecordingCheckpointStore {
  return {
    putRecordingSession: async (record) =>
      store.write(async (inner) => inner.putRecordingSession(record)),
    appendRecordingChunk: async (chunk) =>
      store.write(async (inner) => inner.appendRecordingChunk(chunk)),
    readRecordingSessions: async (owner) =>
      store.write(async (inner) => inner.readRecordingSessions(owner)),
    recoverRecording: async (owner, id) =>
      store.write(async (inner) => inner.recoverRecording(owner, id)),
    deleteRecordingSession: async (owner, id) =>
      store.write(async (inner) => inner.deleteRecordingSession(owner, id)),
  };
}

/** A recording ride on the real controller, its screen mounted. */
async function riding(): Promise<RideController> {
  harness = createStoreHarness();
  await seedAthletes(harness);
  const { transport, bench } = createSimulator({ devices: [] });
  const built = createRideController({
    transport,
    store: checkpoints(harness),
    athleteId: ATHLETE_A,
    newSessionId: () => recordingSessionId('ride-1432'),
    now: () => bench.now,
  });
  controller = built;
  mounted = await mount(<RideView controller={built} />);
  await settle();
  await activateWithKeyboard(buttonNamed('Start recording'));
  for (let second = 0; second < 3; second += 1) {
    bench.advance(seconds(1));
    await built.tick(bench.now);
  }
  await settle();
  return built;
}

async function tapAndSettle(element: Element): Promise<void> {
  tap(element);
  await settle();
}

describe('the Ride screen’s touch lock — #1432', () => {
  it('is offered only while a ride is in progress, and the controller refuses it before', async () => {
    harness = createStoreHarness();
    await seedAthletes(harness);
    const { transport, bench } = createSimulator({ devices: [] });
    const idle = createRideController({
      transport,
      store: checkpoints(harness),
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('idle-1432'),
      now: () => bench.now,
    });
    controller = idle;
    mounted = await mount(<RideView controller={idle} />);
    await settle();
    expect(queryAll(document, 'button').map((each) => each.textContent)).not.toContain(
      TOUCH_LOCK_NAME,
    );
    idle.lockTouch();
    expect(idle.getSnapshot().touchLocked).toBe(false);
  });

  it('turns on with a tap, and says so on the screen and to a screen reader', async () => {
    const ride = await riding();
    expect(lock().getAttribute('aria-pressed')).toBe('false');
    expect(document.body.textContent).not.toContain(TOUCH_LOCK_ON_TEXT);

    await tapAndSettle(lock());

    expect(ride.getSnapshot().touchLocked).toBe(true);
    expect(lock().getAttribute('aria-pressed')).toBe('true');
    expect(document.body.textContent).toContain(TOUCH_LOCK_ON_LABEL);
    expect(document.body.textContent).toContain(TOUCH_LOCK_ON_TEXT);
    // The sentence is the control's description, so it is read with it.
    const described = lock().getAttribute('aria-describedby');
    expect(described).not.toBeNull();
    expect(document.getElementById(described ?? '')?.textContent).toContain(TOUCH_LOCK_ON_TEXT);
  });

  it('ignores taps on Pause and Stop while it is on', async () => {
    const ride = await riding();
    await tapAndSettle(lock());

    await tapAndSettle(buttonNamed('Pause'));
    await tapAndSettle(buttonNamed('Stop'));

    const after = ride.getSnapshot();
    expect(after.phase).toBe('recording');
    expect(after.stopArmed).toBe(false);
  });

  it('lets the same taps through while it is off — the control for the case above', async () => {
    const ride = await riding();

    await tapAndSettle(buttonNamed('Stop'));
    expect(ride.getSnapshot().stopArmed).toBe(true);
    await tapAndSettle(buttonNamed('Keep riding'));
    await tapAndSettle(buttonNamed('Pause'));
    for (let turn = 0; turn < 5 && ride.getSnapshot().phase !== 'paused'; turn += 1) {
      await settle();
    }
    expect(ride.getSnapshot().phase).toBe('paused');
  });

  it.each([
    ['on', true, 0],
    ['off', false, 1],
  ] as const)(
    'with the lock %s, a tap on Lap reaches the controller only when the lock is off',
    async (_, locked, taken) => {
      const stub = stubRideController({
        ...ridingSnapshot(),
        touchLocked: locked,
        manualLap: { available: true, last: undefined },
      });
      mounted = await mount(<RideView controller={stub.controller} />);
      await settle();

      tap(buttonNamed('Lap'));
      expect(stub.calls.markLap).toBe(taken);
    },
  );

  it('lets a keyboard or screen reader pause the ride while it is on', async () => {
    const ride = await riding();
    await tapAndSettle(lock());

    await activateWithKeyboard(buttonNamed('Pause'));
    for (let turn = 0; turn < 5 && ride.getSnapshot().phase !== 'paused'; turn += 1) {
      await settle();
    }

    expect(ride.getSnapshot().phase).toBe('paused');
  });

  it('turns off with a press held for a second, and the next tap works', async () => {
    const ride = await riding();
    await tapAndSettle(lock());
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    hold(lock(), (ms) => vi.advanceTimersByTime(ms));
    vi.useRealTimers();
    await settle();

    expect(ride.getSnapshot().touchLocked).toBe(false);
    expect(lock().getAttribute('aria-pressed')).toBe('false');
    expect(document.body.textContent).not.toContain(TOUCH_LOCK_ON_TEXT);
    await tapAndSettle(buttonNamed('Stop'));
    expect(ride.getSnapshot().stopArmed).toBe(true);
  });

  it('is still on when the rider comes back to the screen', async () => {
    const ride = await riding();
    await tapAndSettle(lock());
    mounted?.unmount();

    mounted = await mount(<RideView controller={ride} />);
    await settle();

    expect(lock().getAttribute('aria-pressed')).toBe('true');
    await tapAndSettle(buttonNamed('Stop'));
    expect(ride.getSnapshot().stopArmed).toBe(false);
  });

  it('goes off when the ride is stopped', async () => {
    const ride = await riding();
    await tapAndSettle(lock());

    await activateWithKeyboard(buttonNamed('Stop'));
    await activateWithKeyboard(buttonNamed('Yes, stop the ride'));
    await act(async () => {
      await Promise.resolve();
    });
    await settle();

    expect(ride.getSnapshot().phase).toBe('stopped');
    expect(ride.getSnapshot().touchLocked).toBe(false);
  });
});

describe('what the touch lock never stops — #1432', () => {
  it('leaves End ERG working, and the ERG form’s Set target locked', async () => {
    const stub = stubRideController({ ...ridingSnapshot(), touchLocked: true });
    mounted = await mount(<RideView controller={stub.controller} />);
    await settle();

    tap(buttonNamed('Set target'));
    expect(stub.calls.setTargetPower).toEqual([]);
    tap(buttonNamed('End ERG'));
    expect(stub.calls.clearTarget).toBe(1);
  });

  it('leaves End workout working', async () => {
    const blocks = [
      { kind: 'steady' as const, seconds: seconds(600), target: thresholdShare(0.6) },
    ];
    const stub = stubRideController({
      ...ridingSnapshot(),
      touchLocked: true,
      workout: {
        name: 'Sweet spot',
        status: 'running',
        elapsedSeconds: 120,
        totalSeconds: 600,
        holdingWatts: 150,
        nowRiding: '10 min at 60%',
        fault: undefined,
        rescue: undefined,
        timeline: expandWorkout({ name: 'Sweet spot', blocks }),
      },
    });
    mounted = await mount(<RideView controller={stub.controller} />);
    await settle();

    tap(buttonNamed('End workout'));
    expect(stub.calls.endWorkout).toBe(1);
  });
});
