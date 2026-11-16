// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **An owner ending a room touches nobody's trainer** — #2612, epic #2601's
 * "no trainer control from anywhere in this area". When the instance's owner
 * ends a room from Operate, every socket in it is sent `refuse room-closed`
 * and closed `4005` (`apps/instance` §`RoomHost.end`). A rider in that room
 * may be in an ERG workout, with the trainer holding a target power under
 * their legs: they go on riding solo, and their device goes on recording
 * (ADR 0036 D-3). Nothing on the close may set, ease or release resistance.
 *
 * The run is the real `GameView`, the real ride controller `main.tsx` builds,
 * its real `createTrainerControl`, and the #44 simulator's FTMS trainer, read
 * back as the OCTETS on its control point (`ride/simulated-trainer-testing.ts`)
 * — as `draft-cannot-reach-trainer.test.tsx` reads them — with the room's half
 * of the wire scripted (`net/testing.ts`). The workout is one long steady
 * block, so after its first target nothing on the wire is the workout's: any
 * write after the close is the close's.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, seconds, thresholdShare, unixSeconds, watts } from '@onyourleft/domain';
import { createSimulator, ftmsTrainer } from '@onyourleft/sensors/simulator';
import { recordingSessionId, workoutId, type WorkoutRecord } from '@onyourleft/store';
import { ATHLETE_A } from '@onyourleft/store/testing';

import { roomPortOver } from '../net/room-port';
import { ManualClock, ScriptedRoom } from '../net/testing';
import type { RecordingCheckpointStore } from '../recording/recorder';
import { createRideController, type RideController } from '../ride/controller';
import { simulatedOpenTrainer } from '../ride/simulated-trainer-testing';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { GameView, type GamePort } from './GameView';
import type { GameRenderer } from './port';
import { ROOM_REFUSED_TEXT } from './room-ride';
import { rollingRoute } from './route-fixtures-testing';
import { gameTrainerPortOver } from './trainer-port';

const FRAME_MS = 250;
const THRESHOLD = watts(250);

const CHECKPOINTS: RecordingCheckpointStore = {
  putRecordingSession: (record) => Promise.resolve(record.id),
  appendRecordingChunk: () => Promise.resolve(1),
  readRecordingSessions: () => Promise.resolve({ sessions: [], unreadable: [] }),
  recoverRecording: () => Promise.resolve(undefined),
  deleteRecordingSession: () => Promise.resolve(true),
};

/** One steady block for the whole ride: the workout writes its target once. */
const steady: WorkoutRecord = {
  id: workoutId('w2612-steady'),
  createdBy: ATHLETE_A,
  name: 'Steady',
  workout: {
    name: 'Steady',
    blocks: [{ kind: 'steady', seconds: seconds(3600), target: thresholdShare(0.8) }],
  },
  createdAt: unixSeconds(1),
  updatedAt: unixSeconds(1),
};

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;
let controller: RideController | undefined;
let clock: ManualClock;

beforeEach(() => {
  pending = [];
  nowMs = 1_000_000;
  clock = new ManualClock();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  controller?.dispose();
  controller = undefined;
  vi.unstubAllGlobals();
});

function pedalling(): GamePort {
  return {
    listRoutes: () =>
      Promise.resolve([
        { id: 'route-rolling', name: 'Rolling', profile: rollingRoute(), attempts: 0 },
      ]),
    loadGhost: () => Promise.resolve(undefined),
    readSensors: () => ({
      rider: { power: watts(200), live: true, paired: true },
      cadence: { value: 88, live: true, paired: true },
      heartRate: { value: 140, live: true, paired: true },
    }),
  };
}

function blankRenderer(): GameRenderer {
  return {
    loadRealisticWorld: () => Promise.reject(new Error('no realistic world was chosen')),
    create: () => ({
      hasContext: false,
      prepare: () => Promise.resolve(),
      render: () => undefined,
      setQuality: () => undefined,
      setRiderKit: () => undefined,
      setSeason: () => undefined,
      resize: () => undefined,
      destroy: () => undefined,
    }),
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await settle();
}

describe('an owner ending a room sends nothing to a rider’s trainer — #2612', () => {
  it('delivers the 4005 close to a rider in an ERG workout, who rides on alone with no trainer command', async () => {
    const { transport, bench } = createSimulator({
      devices: [ftmsTrainer({ id: 'kickr', name: 'KICKR 1F2A' })],
    });
    const written: number[][] = [];
    const own = createRideController({
      transport,
      store: CHECKPOINTS,
      athleteId: ATHLETE_A,
      newSessionId: () => recordingSessionId('ride-2612'),
      now: () => bench.now,
      openTrainer: simulatedOpenTrainer(bench, { written }),
    });
    controller = own;
    await own.pair('trainer');
    await own.requestTrainerControl();
    await own.start();
    expect(own.startWorkout(steady, THRESHOLD)).toBe(true);

    const room = new ScriptedRoom();
    mounted = await mount(
      <GameView
        port={pedalling()}
        trainer={gameTrainerPortOver(own)}
        renderer={() => Promise.resolve(blankRenderer())}
        now={() => nowMs}
        riderMass={kilograms(72)}
        room={roomPortOver((mass) => room.link(mass), { timers: clock, now: () => nowMs })}
        roomId="room-1"
      />,
    );
    await settle();
    const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    await act(async () => {
      ride?.click();
      await Promise.resolve();
    });
    await flush();
    room.accept();
    room.welcome(0);

    async function frames(count: number): Promise<void> {
      for (let index = 0; index < count; index += 1) {
        const next = pending.shift();
        if (next === undefined) throw new Error('the ride stopped asking for frames');
        nowMs += FRAME_MS;
        await clock.advance(FRAME_MS);
        await act(async () => {
          if (Math.floor(nowMs / 1000) > Math.floor((nowMs - FRAME_MS) / 1000)) {
            bench.advance(seconds(1));
            await own.tick(bench.now);
          }
          next(nowMs);
          await Promise.resolve();
        });
        await settle();
      }
    }

    // Riding in the room, the workout's one target set.
    await frames(12);
    expect(written.length).toBeGreaterThan(0);
    const beforeTheClose = written.length;
    await frames(8);
    // The control: the workout writes nothing more on its own in a span this long.
    expect(written.length).toBe(beforeTheClose);

    // The owner ends the room: the instance's refusal, then its close.
    room.send({ type: 'refuse', reason: 'room-closed' });
    room.closeFromServer(4005, 'room-closed');
    await frames(8);

    expect(mounted.container.textContent).toContain(ROOM_REFUSED_TEXT['room-closed']);
    // Nothing reached the trainer's control point on or after the close.
    expect(written.slice(beforeTheClose)).toEqual([]);
    // The ride goes on: the view still asks for frames, the device is still
    // recording (ADR 0036 D-3), and the workout still holds the trainer.
    expect(pending.length).toBeGreaterThan(0);
    const after = own.getSnapshot();
    expect(after.phase).toBe('recording');
    expect(after.workout).toBeDefined();
    const samples = after.sampleCount;
    await frames(8);
    expect(own.getSnapshot().sampleCount).toBeGreaterThan(samples);
    expect(written.slice(beforeTheClose)).toEqual([]);
  });
});
