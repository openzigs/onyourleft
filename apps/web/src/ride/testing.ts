// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A {@link RideController} whose snapshot a test sets directly.
 *
 * ## Why a stub is the right double *here* and nowhere else
 *
 * `controller.test.ts` drives the real controller against the #44 simulator and
 * the real store, because that is where the behaviour lives. What the DOM tests
 * and the accessibility suite need is different: every branch of the screen,
 * including ones that take a dropped link or a full disk to reach, rendered on
 * demand. Reaching "the device is full" through a real store to assert that the
 * notice has an accessible name would be testing the store again and the notice
 * barely at all.
 *
 * So this stub carries **no logic**. It records the calls made on it and
 * returns the snapshot it was given. Anything asserted about what the
 * controller *does* belongs in `controller.test.ts`; anything asserted here is
 * about what the screen shows for a given state.
 *
 * ⚠️ Not exported from anywhere the app imports. It lives under `src/` because
 * the accessibility suite in `src/a11y/` needs it too, and a `__tests__`
 * directory would put it outside the tsconfig program that typechecks it.
 */

import { unixSeconds } from '@onyourleft/domain';
import { deviceId } from '@onyourleft/sensors';

import { RIDE_METRIC_IDS, type RideController, type RideSnapshot } from './controller';

/** Every call the screen made, in order, for a test to assert on. */
export interface RecordedCalls {
  readonly pair: string[];
  readonly unpair: string[];
  readonly setTargetPower: number[];
  /** Counts, because the interesting question is "how many times", not "with what". */
  start: number;
  pause: number;
  resume: number;
  armStop: number;
  cancelStop: number;
  confirmStop: number;
  requestControl: number;
  clearTarget: number;
  tick: number;
}

export interface StubRideController {
  readonly controller: RideController;
  readonly calls: RecordedCalls;
  /** Replace the snapshot and notify every subscriber, as a real change does. */
  set(next: Partial<RideSnapshot>): void;
}

/** A snapshot of a screen with nothing paired and nothing recording. */
export function idleSnapshot(): RideSnapshot {
  return {
    phase: 'idle',
    stopArmed: false,
    elapsedSeconds: 0,
    movingSeconds: 0,
    sampleCount: 0,
    metrics: RIDE_METRIC_IDS.map((id) => ({ id, state: { kind: 'unpaired' } })),
    sensors: [],
    trainer: {
      paired: false,
      controllable: false,
      canSetPower: false,
      powerRange: undefined,
      hasControl: false,
      target: { kind: 'none' },
      requested: undefined,
      lost: undefined,
      refusal: undefined,
    },
    storage: 'ok',
    pairingError: undefined,
    connectionsRemaining: 3,
  };
}

/** A screen mid-ride: a trainer in ERG, a strap, and every number live. */
export function ridingSnapshot(): RideSnapshot {
  const base = idleSnapshot();
  return {
    ...base,
    phase: 'recording',
    elapsedSeconds: 3_725,
    movingSeconds: 3_600,
    sampleCount: 3_725,
    metrics: [
      { id: 'power', state: { kind: 'live', value: 248, at: unixSeconds(1_800_000_000) } },
      { id: 'cadence', state: { kind: 'live', value: 91, at: unixSeconds(1_800_000_000) } },
      { id: 'heartRate', state: { kind: 'stale', silentForSeconds: 12 } },
      { id: 'speed', state: { kind: 'live', value: 9.4, at: unixSeconds(1_800_000_000) } },
    ],
    sensors: [
      {
        id: deviceId('kickr'),
        name: 'KICKR 1F2A',
        role: 'trainer',
        capabilities: ['power', 'cadence', 'speed'],
        state: 'connected',
      },
    ],
    trainer: {
      paired: true,
      controllable: true,
      canSetPower: true,
      powerRange: {
        minimum: 0,
        maximum: 2000,
        increment: 5,
      } as RideSnapshot['trainer']['powerRange'],
      hasControl: true,
      target: { kind: 'confirmed', target: 250 } as RideSnapshot['trainer']['target'],
      requested: undefined,
      lost: undefined,
      refusal: undefined,
    },
  };
}

export function stubRideController(initial: RideSnapshot = idleSnapshot()): StubRideController {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const calls: RecordedCalls = {
    pair: [],
    unpair: [],
    setTargetPower: [],
    start: 0,
    pause: 0,
    resume: 0,
    armStop: 0,
    cancelStop: 0,
    confirmStop: 0,
    requestControl: 0,
    clearTarget: 0,
    tick: 0,
  };

  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const controller: RideController = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    pair: async (role) => {
      calls.pair.push(role);
      return Promise.resolve();
    },
    unpair: async (id) => {
      calls.unpair.push(id);
      return Promise.resolve();
    },
    start: async () => {
      calls.start += 1;
      return Promise.resolve();
    },
    pause: async () => {
      calls.pause += 1;
      return Promise.resolve();
    },
    resume: async () => {
      calls.resume += 1;
      return Promise.resolve();
    },
    armStop: () => {
      calls.armStop += 1;
    },
    cancelStop: () => {
      calls.cancelStop += 1;
    },
    confirmStop: async () => {
      calls.confirmStop += 1;
      return Promise.resolve();
    },
    requestTrainerControl: async () => {
      calls.requestControl += 1;
      return Promise.resolve();
    },
    setTargetPower: async (target) => {
      calls.setTargetPower.push(target);
      return Promise.resolve();
    },
    clearTargetPower: async () => {
      calls.clearTarget += 1;
      return Promise.resolve();
    },
    tick: async () => {
      calls.tick += 1;
      return Promise.resolve();
    },
    tickNow: async () => {
      calls.tick += 1;
      return Promise.resolve();
    },
    dispose: () => {
      listeners.clear();
    },
  };

  return {
    controller,
    calls,
    set(next) {
      snapshot = { ...snapshot, ...next };
      notify();
    },
  };
}
