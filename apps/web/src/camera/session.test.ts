// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The camera's state machine, and the two assertions #382 asks for by name.
 *
 * ⚠️ **"The camera is off by default" is asserted as "the port was never
 * called", not as "a control was disabled".** #382's own wording is *"not a
 * disabled button, no capture"*, and a test that read a flag would pass against
 * a controller that opened a camera and then reported itself off.
 */

import { describe, expect, it } from 'vitest';

import { CameraController } from './session';
import { cleanFrameBytes, manualSchedule, scriptedCamera } from './testing';
import type { CapturedFrame } from './camera-port';

const AGREED = { acknowledgedBystanders: true, allowLocal: true, allowHosted: false } as const;

function controllerFor(camera: ReturnType<typeof scriptedCamera>, sink?: CapturedFrame[]) {
  const timers = manualSchedule();
  const controller = new CameraController({
    port: camera.port,
    schedule: timers.schedule,
    ...(sink === undefined
      ? {}
      : {
          sink: {
            accept: async (frame) => {
              sink.push(frame);
              // `true`: this double stands for a sink that KEPT the frame, so
              // the session's `keptThisSession` counts it.
              return Promise.resolve(true);
            },
          },
        }),
  });
  return { controller, timers };
}

describe('the camera is off by default', () => {
  it('reports no consent before anything has happened', () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    expect(controller.state().live).toBe(false);
    expect(controller.state().consent).toStrictEqual({ local: false, hosted: false });
    expect(controller.state().problem).toBe('no-consent');
  });

  it('refuses to turn on WITHOUT TOUCHING THE PORT', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    await expect(controller.turnOn()).resolves.toBe('no-consent');
    // The whole assertion. Deleting the consent guard in `turnOn` leaves
    // `calls` holding `availability`, `request` and `start`, and this line is
    // the only one in the suite that notices.
    expect(camera.calls).toStrictEqual([]);
  });

  it('refuses to capture WITHOUT TOUCHING THE PORT', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    const outcome = await controller.captureOne();
    expect(outcome.taken).toBe(false);
    expect(outcome.problem).toBe('no-consent');
    expect(camera.calls).toStrictEqual([]);
  });
});

describe('turning it on', () => {
  it('opens the camera once the rider has agreed', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await expect(controller.turnOn()).resolves.toBeUndefined();
    expect(controller.state().live).toBe(true);
    expect(camera.calls).toStrictEqual(['availability', 'request', 'start']);
  });

  it('stops at availability when the device has no camera', async () => {
    const camera = scriptedCamera({ availability: 'no-camera' });
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await expect(controller.turnOn()).resolves.toBe('no-camera');
    // Not asked for permission for a camera that is not there: a prompt in
    // that state is a prompt the rider can only answer wrongly.
    expect(camera.calls).toStrictEqual(['availability']);
    expect(controller.notice()?.title).toBe('This device has no camera');
  });

  it('reports a refused permission as an explanation rather than a dead control', async () => {
    const camera = scriptedCamera({ permission: 'not-permitted' });
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await expect(controller.turnOn()).resolves.toBe('not-permitted');
    const notice = controller.notice();
    expect(notice?.recoverable).toBe(true);
    expect(notice?.instruction).toContain('settings');
  });

  it('turns a failure to start into the kind and nothing of the platform’s own words', async () => {
    const camera = scriptedCamera({ startFails: 'unavailable' });
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await expect(controller.turnOn()).resolves.toBe('unavailable');
    expect(controller.state().live).toBe(false);
  });

  it('is idempotent while it is already running', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();
    await controller.turnOn();
    expect(camera.calls.filter((call) => call === 'start')).toHaveLength(1);
  });
});

describe('capturing', () => {
  it('takes a frame and keeps nothing', async () => {
    const kept: CapturedFrame[] = [];
    const camera = scriptedCamera();
    // No sink at all — the default is `discardTheFrame`, which is ADR 0029
    // D-2's default expressed as an absence rather than as a branch.
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();
    const outcome = await controller.captureOne();
    expect(outcome.taken).toBe(true);
    expect(outcome.width).toBe(640);
    expect(outcome.bytes).toBe(cleanFrameBytes().length);
    expect(kept).toStrictEqual([]);
    expect(controller.state().captured).toBe(1);
  });

  it('hands the frame to a sink when one is supplied', async () => {
    const kept: CapturedFrame[] = [];
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera, kept);
    controller.agree(AGREED);
    await controller.turnOn();
    await controller.captureOne();
    expect(kept).toHaveLength(1);
  });

  it('reports no picture rather than throwing when the camera is off', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    const outcome = await controller.captureOne();
    expect(outcome).toStrictEqual({
      taken: false,
      problem: 'unavailable',
      kept: false,
      keepFailed: false,
      bytes: 0,
      width: 0,
      height: 0,
    });
  });

  it('counts what the sink kept, not what the switch said', async () => {
    // ⚠️ `CameraState.keeping` is what the NEXT frame will do; this is what the
    // ones already taken did, and the two disagree the moment a rider turns the
    // switch off mid-session. `views/CameraView.tsx` shows the second.
    const camera = scriptedCamera();
    let keeping = false;
    const { controller } = new (class {
      readonly controller = new CameraController({
        port: camera.port,
        schedule: manualSchedule().schedule,
        sink: { accept: async () => Promise.resolve(keeping) },
      });
    })();
    controller.agree(AGREED);
    await controller.turnOn();

    await controller.captureOne();
    keeping = true;
    await controller.captureOne();
    await controller.captureOne();
    keeping = false;
    await controller.captureOne();

    expect(controller.state().captured).toBe(4);
    expect(controller.state().keptThisSession).toBe(2);
  });

  it('starts the kept count again at every switch-on', async () => {
    const camera = scriptedCamera();
    const { controller } = new (class {
      readonly controller = new CameraController({
        port: camera.port,
        schedule: manualSchedule().schedule,
        sink: { accept: async () => Promise.resolve(true) },
      });
    })();
    controller.agree(AGREED);
    await controller.turnOn();
    await controller.captureOne();
    expect(controller.state().keptThisSession).toBe(1);

    controller.turnOff();
    await controller.turnOn();

    expect(controller.state().captured).toBe(0);
    expect(controller.state().keptThisSession).toBe(0);
  });

  it('reports a sink that rejects rather than letting the rejection escape', async () => {
    // ⚠️ In production the sink writes a whole JPEG to IndexedDB, so
    // `QuotaExceededError` on a full device is the ORDINARY failure. Uncaught
    // it escaped `captureOne`'s promise into a view with no `catch`: an
    // unhandled rejection, no notice on the screen, and a counter that did not
    // move. The picture WAS taken, so it is counted.
    const camera = scriptedCamera();
    const { controller } = new (class {
      readonly controller = new CameraController({
        port: camera.port,
        schedule: manualSchedule().schedule,
        sink: {
          accept: async () =>
            Promise.reject(new Error('QuotaExceededError: key camera-frame-abc123')),
        },
      });
    })();
    controller.agree(AGREED);
    await controller.turnOn();

    const outcome = await controller.captureOne();

    expect(outcome.taken).toBe(true);
    expect(outcome.kept).toBe(false);
    expect(outcome.keepFailed).toBe(true);
    expect(controller.state().captured).toBe(1);
    expect(controller.state().keptThisSession).toBe(0);
    // ADR 0029 D-8: nothing of the error survives — not its message, and not
    // the key it names, which is a locator for a stored picture.
    expect(JSON.stringify(outcome)).not.toContain('camera-frame-abc123');
  });

  it('carries no part of the picture in what it reports', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();
    const outcome = await controller.captureOne();
    // ADR 0029 D-8's permitted column is a count, a byte size and a format
    // name. Anything that could be a picture — a `Uint8Array`, a string long
    // enough to be base64 — would be a member somebody logs.
    for (const value of Object.values(outcome)) {
      expect(typeof value === 'number' || typeof value === 'boolean' || value === undefined).toBe(
        true,
      );
    }
  });
});

describe('the live preview — #528', () => {
  const surface = (): {
    srcObject: unknown;
    muted: boolean;
    playsInline: boolean;
    play: () => Promise<void>;
  } => ({
    srcObject: null,
    muted: false,
    playsInline: false,
    play: async () => Promise.resolve(),
  });

  it('attaches nothing, and opens nothing, when no camera is running', () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    const detach = controller.showPreview(surface());
    detach();
    expect(camera.calls).toStrictEqual([]);
  });

  it('plays the running camera, and detaches on request', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();
    const detach = controller.showPreview(surface());
    expect(camera.calls).toContain('preview');
    detach();
    expect(camera.calls).toContain('preview-detached');
  });

  it('attaches nothing to a camera that has gone out', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();
    camera.endTheTrack();
    controller.showPreview(surface());
    expect(camera.calls).not.toContain('preview');
  });
});

describe('revoking', () => {
  it('stops a running camera, not just the flag', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();
    expect(controller.state().live).toBe(true);

    controller.revoke();

    // Both halves. Deleting the `turnOff()` from `revoke` leaves the flag
    // right and the hardware running — the worst of both, because the rider
    // has withdrawn and the camera has not heard.
    expect(camera.calls).toContain('stop');
    expect(controller.state().live).toBe(false);
    expect(controller.state().consent.local).toBe(false);
  });

  it('refuses to turn on again afterwards, without touching the port', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();
    controller.revoke();
    const before = camera.calls.length;
    await expect(controller.turnOn()).resolves.toBe('no-consent');
    expect(camera.calls).toHaveLength(before);
  });
});

describe('the camera going away by itself', () => {
  it('follows the hardware rather than our last intention', async () => {
    const camera = scriptedCamera();
    const { controller, timers } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();
    expect(timers.running).toBe(1);

    // The rider revoked the permission from the operating system's own
    // indicator, or something else took the device. Neither goes through this
    // client, so only the poll can notice.
    camera.endTheTrack();
    expect(controller.state().live).toBe(false);
    timers.fire();

    expect(timers.running).toBe(0);
  });

  it('stops polling once the camera is off', async () => {
    const camera = scriptedCamera();
    const { controller, timers } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();
    controller.turnOff();
    expect(timers.running).toBe(0);
  });
});

describe('the quality ladder', () => {
  it('refuses a capture when the rung has taken it away', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();
    const before = camera.calls.length;

    controller.throttle(false);
    const outcome = await controller.captureOne();

    expect(outcome.taken).toBe(false);
    // The port was not asked: a rung that only made the button sad would still
    // be encoding a JPEG on a phone with no headroom.
    expect(camera.calls).toHaveLength(before);
    expect(controller.state().captureAllowed).toBe(false);
  });

  it('does NOT turn the camera off, so the indicator goes on telling the truth', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();

    controller.throttle(false);

    expect(controller.state().live).toBe(true);
    expect(camera.calls).not.toContain('stop');
  });

  it('lets capture back once the device has cooled', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    controller.agree(AGREED);
    await controller.turnOn();
    controller.throttle(false);
    controller.throttle(true);
    await expect(controller.captureOne().then((outcome) => outcome.taken)).resolves.toBe(true);
  });
});

describe('subscribers', () => {
  it('hear about every change and stop when they unsubscribe', async () => {
    const camera = scriptedCamera();
    const { controller } = controllerFor(camera);
    let heard = 0;
    const stop = controller.subscribe(() => {
      heard += 1;
    });
    controller.agree(AGREED);
    await controller.turnOn();
    expect(heard).toBeGreaterThan(0);
    const before = heard;
    stop();
    controller.turnOff();
    expect(heard).toBe(before);
  });
});
