// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The browser adapter, over a scripted `navigator.mediaDevices`.
 *
 * ⚠️ **The re-encode is NOT under test here and cannot be**: jsdom implements
 * no media playback and no 2D canvas context, so `canvasFrameGrabber` is
 * unreachable from this file. `browser/shell.browser.spec.ts` §"the camera, in
 * a real engine" is where a real `getUserMedia` → canvas → `toBlob` round trip
 * happens, against Chromium's synthetic camera. What is here instead is
 * everything *around* the grabber: which platform errors mean what, what
 * `requestCameraAccess()` does with the stream it opens, and whether a platform message can
 * reach a rider.
 */

import { describe, expect, it, vi } from 'vitest';

import { CameraCaptureError } from './camera-port';
import {
  browserCameraPort,
  type FrameGrabber,
  type MediaDevicesLike,
  type MediaStreamLike,
  type VideoTrackLike,
} from './browser-camera';
import { cleanFrameBytes } from './testing';
import { frameLeaksIn } from './notice';

function track(): VideoTrackLike & { stopped: boolean } {
  return {
    stopped: false,
    readyState: 'live',
    stop(): void {
      (this as { stopped: boolean; readyState: string }).stopped = true;
      (this as { readyState: string }).readyState = 'ended';
    },
  };
}

function streamOf(tracks: VideoTrackLike[]): MediaStreamLike {
  return { getVideoTracks: () => tracks };
}

const GRABBER: FrameGrabber = {
  grab: async () =>
    Promise.resolve({
      bytes: cleanFrameBytes(),
      mediaType: 'image/jpeg',
      width: 1920,
      height: 1080,
    }),
};

function devices(
  getUserMedia: MediaDevicesLike['getUserMedia'],
  enumerate?: MediaDevicesLike['enumerateDevices'],
): MediaDevicesLike {
  return enumerate === undefined ? { getUserMedia } : { getUserMedia, enumerateDevices: enumerate };
}

describe('availability', () => {
  it('is unsupported outside a secure context', async () => {
    const port = browserCameraPort({
      devices: devices(() => Promise.reject(new Error('never'))),
      grabber: GRABBER,
      secureContext: false,
    });
    await expect(port.cameraAvailability()).resolves.toStrictEqual({ kind: 'unsupported' });
  });

  it('reports no camera when the browser lists no video input', async () => {
    const port = browserCameraPort({
      devices: devices(
        () => Promise.reject(new Error('never')),
        () => Promise.resolve([{ kind: 'audioinput' }]),
      ),
      grabber: GRABBER,
      secureContext: true,
    });
    await expect(port.cameraAvailability()).resolves.toStrictEqual({ kind: 'no-camera' });
  });

  it('reports available where the browser cannot be asked in advance', async () => {
    // No `enumerateDevices`: nothing has been learned, so the rider must still
    // be able to reach `startCamera()`, which is the call that actually knows.
    const port = browserCameraPort({
      devices: devices(() => Promise.reject(new Error('never'))),
      grabber: GRABBER,
      secureContext: true,
    });
    await expect(port.cameraAvailability()).resolves.toStrictEqual({ kind: 'available' });
  });

  it('reports available when enumeration itself fails', async () => {
    const port = browserCameraPort({
      devices: devices(
        () => Promise.reject(new Error('never')),
        () => Promise.reject(new Error('refused')),
      ),
      grabber: GRABBER,
      secureContext: true,
    });
    await expect(port.cameraAvailability()).resolves.toStrictEqual({ kind: 'available' });
  });
});

describe('asking for permission', () => {
  it('opens a stream and stops it again at once', async () => {
    const live = track();
    const getUserMedia = vi.fn(async () => Promise.resolve(streamOf([live])));
    const port = browserCameraPort({
      devices: devices(getUserMedia),
      grabber: GRABBER,
      secureContext: true,
    });

    await expect(port.requestCameraAccess()).resolves.toStrictEqual({ kind: 'granted' });

    // The whole point of the method. Leaving it running would light the camera
    // from the moment consent was given, which is exactly what the live
    // indicator is supposed to mean something about.
    expect(live.stopped).toBe(true);
  });

  it('maps a refusal to not-permitted', async () => {
    const refusal = new Error('Permission denied');
    refusal.name = 'NotAllowedError';
    const port = browserCameraPort({
      devices: devices(() => Promise.reject(refusal)),
      grabber: GRABBER,
      secureContext: true,
    });
    await expect(port.requestCameraAccess()).resolves.toStrictEqual({ kind: 'not-permitted' });
  });

  it('maps a missing device to no-camera', async () => {
    const missing = new Error('Requested device not found');
    missing.name = 'NotFoundError';
    const port = browserCameraPort({
      devices: devices(() => Promise.reject(missing)),
      grabber: GRABBER,
      secureContext: true,
    });
    await expect(port.requestCameraAccess()).resolves.toStrictEqual({ kind: 'no-camera' });
  });

  it('maps anything else to unavailable rather than guessing', async () => {
    const busy = new Error('Could not start video source');
    busy.name = 'NotReadableError';
    const port = browserCameraPort({
      devices: devices(() => Promise.reject(busy)),
      grabber: GRABBER,
      secureContext: true,
    });
    await expect(port.requestCameraAccess()).resolves.toStrictEqual({ kind: 'unavailable' });
  });
});

describe('a running camera', () => {
  it('captures a frame through the grabber', async () => {
    const port = browserCameraPort({
      devices: devices(async () => Promise.resolve(streamOf([track()]))),
      grabber: GRABBER,
      secureContext: true,
    });
    const session = await port.startCamera();
    const frame = await session.captureFrame();
    expect(frame.width).toBe(1920);
    expect(frame.mediaType).toBe('image/jpeg');
  });

  it('reads liveness from the track rather than from its own flag', async () => {
    const one = track();
    const port = browserCameraPort({
      devices: devices(async () => Promise.resolve(streamOf([one]))),
      grabber: GRABBER,
      secureContext: true,
    });
    const session = await port.startCamera();
    expect(session.live).toBe(true);

    // The operating system, or another application, ended it. Nothing went
    // through this object, so only reading the track can notice.
    (one as { readyState: string }).readyState = 'ended';
    expect(session.live).toBe(false);
  });

  it('stops every track when it is stopped', async () => {
    const tracks = [track(), track()];
    const port = browserCameraPort({
      devices: devices(async () => Promise.resolve(streamOf(tracks))),
      grabber: GRABBER,
      secureContext: true,
    });
    const session = await port.startCamera();
    session.stopCamera();
    expect(tracks.every((each) => each.stopped)).toBe(true);
    expect(session.live).toBe(false);
  });

  it('refuses to capture after it has been stopped', async () => {
    const port = browserCameraPort({
      devices: devices(async () => Promise.resolve(streamOf([track()]))),
      grabber: GRABBER,
      secureContext: true,
    });
    const session = await port.startCamera();
    session.stopCamera();
    await expect(session.captureFrame()).rejects.toBeInstanceOf(CameraCaptureError);
  });
});

describe('what a rider can be shown', () => {
  it('never carries the platform’s own message', async () => {
    // The failure this prevents: a `DOMException` whose text names a device,
    // or an encoder rejection carrying a data URL, travelling into whatever a
    // caller logs. ADR 0029 D-8's scope is "every layer that formats one", and
    // this is the layer where a platform string would enter the program.
    const chatty = new Error('Could not start video source blob:http://x/9 for /dev/video0');
    chatty.name = 'NotReadableError';
    const port = browserCameraPort({
      devices: devices(() => Promise.reject(chatty)),
      grabber: GRABBER,
      secureContext: true,
    });

    await expect(port.startCamera()).rejects.toSatisfy((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('/dev/video0');
      expect(frameLeaksIn(message)).toStrictEqual([]);
      return error instanceof CameraCaptureError;
    });
  });

  it('replaces a grabber’s own failure with the fixed wording', async () => {
    const port = browserCameraPort({
      devices: devices(async () => Promise.resolve(streamOf([track()]))),
      grabber: { grab: () => Promise.reject(new Error('canvas said data:image/png;base64,QQ==')) },
      secureContext: true,
    });
    const session = await port.startCamera();
    await expect(session.captureFrame()).rejects.toSatisfy((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      expect(frameLeaksIn(message)).toStrictEqual([]);
      return true;
    });
  });

  it('refuses to start outside a secure context without asking the browser', async () => {
    const getUserMedia = vi.fn(async () => Promise.resolve(streamOf([track()])));
    const port = browserCameraPort({
      devices: devices(getUserMedia),
      grabber: GRABBER,
      secureContext: false,
    });
    await expect(port.startCamera()).rejects.toBeInstanceOf(CameraCaptureError);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
