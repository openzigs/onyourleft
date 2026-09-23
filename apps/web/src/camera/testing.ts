// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A scripted camera, for the tests that cannot have a real one.
 *
 * jsdom implements no `getUserMedia`, no media playback and no 2D canvas
 * context, so every state this feature has — a granted camera, a refused one, a
 * device that has none, a track that ends by itself — is reachable only through
 * a double. That is not a limitation of the tests: it is the reason
 * `camera-port.ts` is a port at all, and it is the same relationship
 * `packages/sensors/web-bluetooth/testing` has to a real adapter.
 *
 * ⚠️ **What a double cannot say is whether a real camera behaves like this**,
 * and the one thing that matters most — the re-encode from raw pixels that
 * ADR 0029 D-9 rests on — is measured in a real Chromium instead:
 * `browser/shell.browser.spec.ts` §"the camera, in a real engine". A fake that
 * returned bytes the test author chose would be proving nothing about a JPEG
 * the browser actually wrote.
 */

import type {
  CameraAvailability,
  CameraPermission,
  CameraPort,
  CameraProblemKind,
  CameraSession,
  CapturedFrame,
} from './camera-port';
import { CameraCaptureError } from './camera-port';
import { capturedFrame } from './frame';
import { cameraProblemMessage } from './notice';

/** What the scripted camera should do. Every member has a usable default. */
export interface ScriptedCameraOptions {
  readonly availability?: CameraAvailability['kind'];
  readonly permission?: CameraPermission['kind'];
  /** Thrown from `startCamera()`. */
  readonly startFails?: CameraProblemKind;
  /** Thrown from `captureFrame()`. */
  readonly captureFails?: CameraProblemKind;
  /** The bytes a capture yields. Clean by default; see {@link cleanFrameBytes}. */
  readonly bytes?: Uint8Array;
}

/** What a scripted camera recorded about how it was used. */
export interface ScriptedCamera {
  readonly port: CameraPort;
  /** Every method call, in order, so a test can assert one never happened. */
  readonly calls: string[];
  /** The live session, if one was started. */
  session(): CameraSession | undefined;
  /** Ends the track from outside, as an operating system or another app would. */
  endTheTrack(): void;
}

/**
 * Bytes shaped like a re-encoded JPEG: a JFIF header and no metadata.
 *
 * ⚠️ Not random noise, because `frame.ts` scans the first few kilobytes for
 * signatures and random bytes would produce a flaky refusal roughly one run in
 * some millions. A fixed, structured buffer has no such tail.
 */
export function cleanFrameBytes(length = 1024): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00], 0);
  for (let index = 32; index < length; index += 1) {
    bytes[index] = (index * 37) % 251;
  }
  return bytes;
}

/** A {@link CameraPort} that does what it is told and records what it was asked. */
export function scriptedCamera(options: ScriptedCameraOptions = {}): ScriptedCamera {
  const calls: string[] = [];
  let live = false;
  let session: CameraSession | undefined;

  const port: CameraPort = {
    cameraAvailability: async () => {
      calls.push('availability');
      return Promise.resolve({ kind: options.availability ?? 'available' });
    },
    requestCameraAccess: async () => {
      calls.push('request');
      return Promise.resolve({ kind: options.permission ?? 'granted' });
    },
    startCamera: async () => {
      calls.push('start');
      if (options.startFails !== undefined) {
        throw new CameraCaptureError(options.startFails, cameraProblemMessage(options.startFails));
      }
      live = true;
      session = {
        get live(): boolean {
          return live;
        },
        captureFrame: async (): Promise<CapturedFrame> => {
          calls.push('capture');
          if (options.captureFails !== undefined) {
            throw new CameraCaptureError(
              options.captureFails,
              cameraProblemMessage(options.captureFails),
            );
          }
          return Promise.resolve(
            capturedFrame({
              bytes: options.bytes ?? cleanFrameBytes(),
              mediaType: 'image/jpeg',
              width: 640,
              height: 480,
            }),
          );
        },
        stopCamera: () => {
          calls.push('stop');
          live = false;
        },
      };
      return Promise.resolve(session);
    },
  };

  return {
    port,
    calls,
    session: () => session,
    endTheTrack: () => {
      live = false;
    },
  };
}

/** A scheduler a test drives by hand. @see CameraControllerOptions.schedule */
export interface ManualSchedule {
  readonly schedule: (tick: () => void, everyMilliseconds: number) => () => void;
  /** Runs every live tick once. */
  fire(): void;
  /** How many schedules are outstanding. */
  readonly running: number;
}

export function manualSchedule(): ManualSchedule {
  const ticks = new Set<() => void>();
  return {
    schedule: (tick) => {
      ticks.add(tick);
      return () => {
        ticks.delete(tick);
      };
    },
    fire: () => {
      for (const tick of [...ticks]) {
        tick();
      }
    },
    get running(): number {
      return ticks.size;
    },
  };
}
