// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #390 through the camera's own state machine: the one port, the one consent,
 * the indicator, the ladder, and what a presence check does NOT do.
 */

import { describe, expect, it, vi } from 'vitest';

import type { LuminanceGrid } from './camera-port';
import {
  PRESENCE_ABSENCE_MILLISECONDS,
  PRESENCE_CHECK_MILLISECONDS,
  PRESENCE_PAIR_GAP_MILLISECONDS,
  PRESENCE_STALE_MILLISECONDS,
} from './presence';
import { CameraController } from './session';
import { manualSchedule, scriptedCamera, stillRoom } from './testing';

const AGREED = { acknowledgedBystanders: true, allowLocal: true, allowHosted: false } as const;

/** Lets every pending promise run: a macrotask, so the whole chain has settled. */
async function settle(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

interface Rig {
  readonly controller: CameraController;
  readonly camera: ReturnType<typeof scriptedCamera>;
  readonly timers: ReturnType<typeof manualSchedule>;
  readonly waits: number[];
  readonly sunk: unknown[];
  /** Advances the clock by one check and runs it. */
  check(): Promise<void>;
  at(): number;
}

function rig(luminance?: (sample: number) => LuminanceGrid, sampleFails = false): Rig {
  const camera = scriptedCamera({
    ...(luminance === undefined ? {} : { luminance }),
    ...(sampleFails ? { sampleFails: 'unavailable' as const } : {}),
  });
  const timers = manualSchedule();
  const waits: number[] = [];
  const sunk: unknown[] = [];
  let now = 1_000_000;
  const controller = new CameraController({
    port: camera.port,
    schedule: timers.schedule,
    clock: () => now,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    },
    sink: {
      accept: async (frame) => {
        sunk.push(frame);
        return Promise.resolve(false);
      },
    },
  });
  return {
    controller,
    camera,
    timers,
    waits,
    sunk,
    check: async () => {
      now += PRESENCE_CHECK_MILLISECONDS;
      timers.fire();
      await settle();
    },
    at: () => now,
  };
}

/** A room in which the rider's legs move between every pair of samples. */
const PEDALLING = (sample: number): LuminanceGrid =>
  stillRoom({ moved: sample % 2 === 0 ? 0 : 12 });
/** An empty room: identical grids for ever. */
const EMPTY = (): LuminanceGrid => stillRoom();

async function watching(r: Rig): Promise<void> {
  r.controller.agree(AGREED);
  await r.controller.turnOn();
  r.controller.watchPresence(true);
}

describe('presence goes through the one camera, under the one consent', () => {
  it('is unknown, and samples nothing, before the rider has agreed to anything', async () => {
    const r = rig(EMPTY);
    r.controller.watchPresence(true);
    await r.check();
    expect(r.controller.riderPresence()).toBe('unknown');
    expect(r.camera.calls).toStrictEqual([]);
  });

  it('cannot be turned on while the camera is off', async () => {
    const r = rig(EMPTY);
    r.controller.agree(AGREED);
    r.controller.watchPresence(true);
    expect(r.controller.state().watchingPresence).toBe(false);
    await r.check();
    expect(r.camera.calls).not.toContain('sample');
  });

  it('samples through the session the camera screen opened — no second pipeline', async () => {
    const r = rig(PEDALLING);
    await watching(r);
    await r.check();
    // `availability`, `request` and `start` once each, from `turnOn` — and then
    // two samples. No second start, no second request.
    expect(r.camera.calls).toStrictEqual(['availability', 'request', 'start', 'sample', 'sample']);
    expect(r.waits).toStrictEqual([PRESENCE_PAIR_GAP_MILLISECONDS]);
    expect(r.controller.riderPresence()).toBe('present');
  });

  it('is off every time the camera is turned on', async () => {
    const r = rig(PEDALLING);
    await watching(r);
    r.controller.turnOff();
    await r.controller.turnOn();
    expect(r.controller.state().watchingPresence).toBe(false);
    await r.check();
    expect(r.camera.calls.filter((call) => call === 'sample')).toStrictEqual([]);
  });
});

describe('consent for presence is not consent for anything else', () => {
  it('leaves the hosted answer off and hands the frame sink nothing', async () => {
    const r = rig(PEDALLING);
    await watching(r);
    for (let check = 0; check < 5; check += 1) {
      await r.check();
    }
    expect(r.controller.riderPresence()).toBe('present');
    // Not the hosted opt-in: the consent is exactly what the rider gave.
    expect(r.controller.state().consent).toStrictEqual({ local: true, hosted: false });
    // Not the analysis path, nor the keep: no frame was taken, none reached a
    // sink, and nothing was counted as a picture.
    expect(r.camera.calls).not.toContain('capture');
    expect(r.sunk).toStrictEqual([]);
    expect(r.controller.state().captured).toBe(0);
    expect(r.controller.state().keptThisSession).toBe(0);
  });
});

describe('the live indicator is on whenever presence is running', () => {
  it('never samples a camera the indicator is not showing', async () => {
    const r = rig(EMPTY);
    await watching(r);
    const liveAtEverySample: boolean[] = [];
    const session = r.camera.session();
    if (session === undefined) {
      throw new Error('no session');
    }
    const sample = session.sampleLuminance.bind(session);
    session.sampleLuminance = async () => {
      liveAtEverySample.push(r.controller.state().live);
      return sample();
    };
    await r.check();
    await r.check();
    r.camera.endTheTrack();
    await r.check();
    expect(liveAtEverySample.length).toBeGreaterThan(0);
    expect(liveAtEverySample.every(Boolean)).toBe(true);
  });
});

describe('absence is decided on the camera’s side and read on the ride’s', () => {
  it('reads an empty room as absent only after the stated interval', async () => {
    const r = rig(EMPTY);
    await watching(r);
    await r.check();
    const firstStill = r.at();
    while (r.at() - firstStill < PRESENCE_ABSENCE_MILLISECONDS - PRESENCE_CHECK_MILLISECONDS) {
      await r.check();
      expect(r.controller.riderPresence()).not.toBe('absent');
    }
    await r.check();
    expect(r.controller.riderPresence()).toBe('absent');
    expect(r.controller.state().presence).toBe('absent');
  });

  it('is unknown when the samples fail, never absent', async () => {
    const r = rig(EMPTY, true);
    await watching(r);
    for (let check = 0; check < 20; check += 1) {
      await r.check();
    }
    expect(r.controller.riderPresence()).toBe('unknown');
  });

  it('goes back to unknown when the watch is turned off', async () => {
    const r = rig(EMPTY);
    await watching(r);
    for (let check = 0; check < 12; check += 1) {
      await r.check();
    }
    expect(r.controller.riderPresence()).toBe('absent');
    r.controller.watchPresence(false);
    expect(r.controller.riderPresence()).toBe('unknown');
  });

  it('goes back to unknown when the camera goes away', async () => {
    const r = rig(EMPTY);
    await watching(r);
    for (let check = 0; check < 12; check += 1) {
      await r.check();
    }
    expect(r.controller.riderPresence()).toBe('absent');
    r.controller.turnOff();
    expect(r.controller.riderPresence()).toBe('unknown');
  });

  it('goes stale rather than holding an old absent', async () => {
    let now = 0;
    const camera = scriptedCamera({ luminance: EMPTY });
    const timers = manualSchedule();
    const controller = new CameraController({
      port: camera.port,
      schedule: timers.schedule,
      clock: () => now,
      wait: async () => Promise.resolve(),
    });
    controller.agree(AGREED);
    await controller.turnOn();
    controller.watchPresence(true);
    for (let check = 0; check < 12; check += 1) {
      now += PRESENCE_CHECK_MILLISECONDS;
      timers.fire();
      await settle();
    }
    expect(controller.riderPresence()).toBe('absent');
    // The timer stops firing — a backgrounded tab — and the clock moves on.
    now += PRESENCE_STALE_MILLISECONDS + 1;
    expect(controller.riderPresence()).toBe('unknown');
  });
});

describe('a source that stops delivering frames — #516', () => {
  // A muted track, a stalled webcam, a hidden tab: the <video> draws its last
  // frame again, so every pair is one picture of a lit room. The grids carry
  // where the source had got (`LuminanceGrid.frame`), and here it never moves.
  const FROZEN = (): LuminanceGrid => ({ ...stillRoom(), frame: 7 });
  /** The same room with frames arriving: a genuinely empty one. */
  const DELIVERING = (sample: number): LuminanceGrid => ({ ...stillRoom(), frame: sample });

  it('ends unknown, never absent, however long it stays frozen', async () => {
    const r = rig(FROZEN);
    await watching(r);
    for (let check = 0; check < 20; check += 1) {
      await r.check();
      expect(r.controller.riderPresence()).toBe('unknown');
    }
  });

  it('the control: the same picture with frames arriving is an empty room', async () => {
    const r = rig(DELIVERING);
    await watching(r);
    for (let check = 0; check < 20; check += 1) {
      await r.check();
    }
    expect(r.controller.riderPresence()).toBe('absent');
  });

  it('breaks an absence that was building when the picture froze', async () => {
    let frozen = false;
    const r = rig((sample) => (frozen ? FROZEN() : DELIVERING(sample)));
    await watching(r);
    for (let check = 0; check < 5; check += 1) {
      await r.check();
    }
    frozen = true;
    for (let check = 0; check < 20; check += 1) {
      await r.check();
    }
    expect(r.controller.riderPresence()).toBe('unknown');
  });
});

describe('a check in flight when the watch is reset — #516', () => {
  /** A rig whose pair gap is held open until the test lets it go. */
  function heldGap(): {
    readonly controller: CameraController;
    readonly timers: ReturnType<typeof manualSchedule>;
    release(): void;
    readonly held: () => boolean;
  } {
    const camera = scriptedCamera({ luminance: PEDALLING });
    const timers = manualSchedule();
    let letGo: (() => void) | undefined;
    const controller = new CameraController({
      port: camera.port,
      schedule: timers.schedule,
      clock: () => 1_000_000,
      wait: async () =>
        new Promise<void>((resolve) => {
          letGo = resolve;
        }),
    });
    return {
      controller,
      timers,
      release: () => {
        letGo?.();
        letGo = undefined;
      },
      held: () => letGo !== undefined,
    };
  }

  async function inTheGap(
    reset: (controller: CameraController) => void,
  ): Promise<CameraController> {
    const h = heldGap();
    h.controller.agree(AGREED);
    await h.controller.turnOn();
    h.controller.watchPresence(true);
    h.timers.fire();
    await settle();
    // The first sample is taken and the check is waiting out the pair gap.
    expect(h.held()).toBe(true);
    reset(h.controller);
    h.release();
    await settle();
    return h.controller;
  }

  it('writes nothing into the tracker a watch off-and-on just reset', async () => {
    // The pedalling room moves between the two samples, so an observation that
    // leaked would make the answer `present` at once.
    const controller = await inTheGap((c) => {
      c.watchPresence(false);
      c.watchPresence(true);
    });
    expect(controller.state().watchingPresence).toBe(true);
    expect(controller.riderPresence()).toBe('unknown');
  });

  it('nor into the one the ladder reset by taking presence away and giving it back', async () => {
    const controller = await inTheGap((c) => {
      c.throttlePresence(false);
      c.throttlePresence(true);
    });
    expect(controller.riderPresence()).toBe('unknown');
  });

  it('the control: a check nobody reset does land', async () => {
    const controller = await inTheGap(() => undefined);
    expect(controller.riderPresence()).toBe('present');
  });
});

describe('the quality ladder', () => {
  it('makes the answer unknown at once when the rung takes presence away', async () => {
    const r = rig(EMPTY);
    await watching(r);
    for (let check = 0; check < 12; check += 1) {
      await r.check();
    }
    expect(r.controller.riderPresence()).toBe('absent');
    r.controller.throttlePresence(false);
    expect(r.controller.riderPresence()).toBe('unknown');
    expect(r.controller.state().presenceAllowed).toBe(false);
    // And stops sampling, rather than sampling and ignoring the answer.
    const before = r.camera.calls.length;
    await r.check();
    expect(r.camera.calls.length).toBe(before);
    // Without turning the camera off — the indicator goes on telling the truth.
    expect(r.controller.state().live).toBe(true);
  });

  it('lets presence back once the device has cooled', async () => {
    const r = rig(PEDALLING);
    await watching(r);
    r.controller.throttlePresence(false);
    r.controller.throttlePresence(true);
    await r.check();
    expect(r.controller.riderPresence()).toBe('present');
  });
});

describe('no frame reaches storage, a log or a message — ADR 0029 D-8', () => {
  it('writes nothing to the console and carries nothing of a failed sample into its state', async () => {
    const said = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const r = rig(EMPTY, true);
      await watching(r);
      for (let check = 0; check < 4; check += 1) {
        await r.check();
      }
      expect(said).not.toHaveBeenCalled();
      expect(warned).not.toHaveBeenCalled();
      expect(logged).not.toHaveBeenCalled();
      // Every field of the state is a primitive the table above names — no
      // error, no grid, no bytes.
      for (const [key, value] of Object.entries(r.controller.state())) {
        if (key === 'consent') {
          continue;
        }
        expect(['string', 'number', 'boolean', 'undefined'], key).toContain(typeof value);
      }
      expect(r.controller.notice()).toBeNull();
      expect(r.sunk).toStrictEqual([]);
    } finally {
      said.mockRestore();
      warned.mockRestore();
      logged.mockRestore();
    }
  });
});
