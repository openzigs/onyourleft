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
  LuminanceGrid,
} from './camera-port';
import { CameraCaptureError } from './camera-port';
import type {
  PhoneReport,
  SideCameraLinkPort,
  SideLinkCondition,
  SideLinkEvent,
} from './side-camera-link-port';
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
  /**
   * What each presence sample returns, in turn — #390. A function so a test
   * can change the room mid-ride; the default is one fixed, readable grid,
   * which reads as "nothing moved".
   */
  readonly luminance?: (sample: number) => LuminanceGrid;
  /** Thrown from `sampleLuminance()`. */
  readonly sampleFails?: CameraProblemKind;
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
  let samples = 0;

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
        sampleLuminance: async (): Promise<LuminanceGrid> => {
          calls.push('sample');
          if (options.sampleFails !== undefined) {
            throw new CameraCaptureError(
              options.sampleFails,
              cameraProblemMessage(options.sampleFails),
            );
          }
          const index = samples;
          samples += 1;
          return Promise.resolve((options.luminance ?? (() => stillRoom()))(index));
        },
        attachCameraPreview: () => {
          calls.push('preview');
          return () => {
            calls.push('preview-detached');
          };
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

/**
 * A readable room in which nothing moves: a left-to-right ramp of brightness,
 * well inside `presence.ts`' dark, bright and flat limits — #390.
 *
 * `shift` moves the whole picture brighter or darker, and `moved` changes that
 * many cells by a large step, which is the smallest fixture that is "a thing
 * moved" rather than "the light changed".
 */
export function stillRoom(
  options: { readonly shift?: number; readonly moved?: number } = {},
): LuminanceGrid {
  const columns = 32;
  const rows = 24;
  const values = new Uint8Array(columns * rows);
  for (let cell = 0; cell < values.length; cell += 1) {
    values[cell] = 60 + (cell % columns) * 4 + (options.shift ?? 0);
  }
  for (let cell = 0; cell < (options.moved ?? 0); cell += 1) {
    values[cell * 7] = (values[cell * 7] ?? 0) + 60;
  }
  return { columns, rows, values };
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

/** A clock and two timers a test moves by hand, in milliseconds. */
export function virtualTime(): {
  readonly clock: () => number;
  readonly after: (task: () => void, milliseconds: number) => () => void;
  readonly every: (task: () => void, milliseconds: number) => () => void;
  advance(milliseconds: number): void;
} {
  let now = 0;
  interface Timer {
    due: number;
    readonly task: () => void;
    readonly period: number | undefined;
    cancelled: boolean;
  }
  const timers: Timer[] = [];
  const add = (
    task: () => void,
    milliseconds: number,
    period: number | undefined,
  ): (() => void) => {
    const timer: Timer = { due: now + milliseconds, task, period, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  return {
    clock: () => now,
    after: (task, milliseconds) => add(task, milliseconds, undefined),
    every: (task, milliseconds) => add(task, milliseconds, milliseconds),
    advance(milliseconds: number): void {
      const until = now + milliseconds;
      for (;;) {
        const next = timers
          .filter((timer) => !timer.cancelled && timer.due <= until)
          .sort((a, b) => a.due - b.due)[0];
        if (next === undefined) {
          break;
        }
        now = next.due;
        if (next.period === undefined) {
          next.cancelled = true;
        } else {
          next.due += next.period;
        }
        next.task();
      }
      now = until;
    },
  };
}

/** A link the test drives, recording what the phone told the tablet. */
export function scriptedLink(initial: SideLinkCondition = 'connected'): SideCameraLinkPort & {
  readonly reports: PhoneReport[];
  ended: number;
  emit(event: SideLinkEvent): void;
} {
  const listeners = new Set<(event: SideLinkEvent) => void>();
  let condition = initial;
  const link = {
    reports: [] as PhoneReport[],
    ended: 0,
    sideLinkCondition: () => condition,
    onSideLinkEvent: (listener: (event: SideLinkEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reportToTablet: (report: PhoneReport) => {
      link.reports.push(report);
    },
    endSideLink: () => {
      link.ended += 1;
    },
    emit: (event: SideLinkEvent) => {
      if (event.kind === 'condition') {
        condition = event.condition;
      }
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
  };
  return link;
}
