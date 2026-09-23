// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **"Keep the pictures from this ride" — the one switch that makes a frame
 * durable** ([#384](https://github.com/openzigs/onyourleft/issues/384),
 * [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-2).
 *
 * D-2, which the owner ratified on 2026-09-23 (#495 Q2):
 *
 * > The default is that a frame is destroyed as soon as the analysis that
 * > consumed it has produced its result, and never written to durable storage
 * > at all. A rider may turn on *"keep the frames from this ride"* for **one
 * > ride at a time**; the switch does not persist across rides, and there is no
 * > global "always keep".
 *
 * ## The three properties that make it D-2 rather than a setting
 *
 * 1. **Off every time.** {@link keepThisRide} is constructed off, and
 *    `session.ts` §`CameraController.turnOn` sets it off again on every start.
 *    A rider who kept last time is not keeping this time.
 * 2. **Nothing persists the switch.** There is no store write for the flag and
 *    no `localStorage` key — the only durable thing this module produces is a
 *    `CameraFrameRecord`. `keep.test.ts` asserts that a fresh controller over
 *    the same store keeps nothing, which is the assertion a flag written
 *    anywhere would fail.
 * 3. **There is no global "always".** Nothing in the client offers one, and
 *    `no-always-keep.test.ts` — the source scan at the bottom of
 *    `keep.test.ts` — is what says so rather than a reviewer.
 *
 * ⚠️ **Why per-ride rather than a setting, in D-2's own words**, because it is
 * the cost this design accepts rather than a detail: *"the useful version of
 * this feature — compare this week's position with last month's — needs frames
 * kept … A setting turned on once in March is consent given once for every ride
 * since. A per-ride control is the rider deciding each time, which is what the
 * sensitivity buys."*
 *
 * ## ⚠️ Why "this ride" is the camera session here
 *
 * D-2 says *one ride at a time*, and this milestone has no link between a
 * camera and a ride: an `ActivityRecord` exists only once a ride is finished
 * and saved (`recording/finish.ts`), and a frame is taken while the rider is
 * pedalling. `packages/store`'s `CameraFrameRecord` records that gap and names
 * [#388](https://github.com/openzigs/onyourleft/issues/388) as the issue that
 * closes it.
 *
 * So the unit here is **the camera being on**: the rider switches the camera on
 * when they start and off when they finish, the keep is off at every switch-on,
 * and it cannot outlive the session. That is narrower than "a ride" in every
 * direction that matters — it cannot be on for a ride the rider did not turn it
 * on for, and it cannot survive one — which is the direction D-2's own
 * §"Why not a timer" argues to be wrong in.
 */

import { cameraFrameId } from '@onyourleft/store';
import type { CameraFrameRecord } from '@onyourleft/store';

import type { CapturedFrame } from './camera-port';
import type { CameraStorePort } from './store-port';
import type { FrameSink } from './session';

/**
 * The sink that keeps, and the switch that decides whether it does.
 *
 * ⚠️ **One object, because the flag and the write must not be able to
 * disagree.** Two — a boolean in the view and a sink in the controller — is the
 * arrangement where a rider turns the switch off and the next frame is written
 * anyway, and it is the arrangement a component naturally reaches for.
 */
export interface FrameKeep extends FrameSink {
  /** Whether the next picture will be kept. `false` on construction. */
  readonly keeping: boolean;
  /** Turn it on or off for this camera session. */
  setKeeping(on: boolean): void;
  /** How many pictures this device is holding. @see CameraFrameStore.countCameraFrames */
  count(): Promise<number>;
  /** Deletes every one of them. @see CameraFrameStore.deleteCameraFrames */
  forget(): Promise<number>;
}

/**
 * A {@link FrameKeep} over the local store.
 *
 * ⚠️ **`accept` writes nothing while {@link FrameKeep.keeping} is false, and
 * that is the whole of D-2's default.** It is a branch rather than an absent
 * sink because the rider may turn the switch on mid-session; what makes the
 * *default* structural rather than a branch is one layer up —
 * `session.ts`'s `discardTheFrame`, which a controller built with no keep at
 * all uses and which has no store in it to write to.
 */
export function keepThisRide(port: CameraStorePort): FrameKeep {
  let keeping = false;
  return {
    get keeping(): boolean {
      return keeping;
    },
    setKeeping(on: boolean): void {
      keeping = on;
    },
    async accept(frame: CapturedFrame): Promise<boolean> {
      if (!keeping) {
        // ADR 0029 D-2's default. Nothing is written, nothing is counted, and
        // the bytes are held by nothing once this returns —
        // `session.ts` §`discardTheFrame` records why this file does not
        // pretend to wipe them.
        return false;
      }
      await port.store.putCameraFrame(recordFor(port, frame));
      // ⚠️ **After the write, never before.** `true` here is what the Camera
      // screen turns into "this device is holding one of them", so returning it
      // on the way in would make the sentence a statement about an intention.
      // A rejected write returns nothing at all and `session.ts` catches it.
      return true;
    },
    async count(): Promise<number> {
      return port.store.countCameraFrames(port.athleteId);
    },
    async forget(): Promise<number> {
      return port.store.deleteCameraFrames(port.athleteId);
    },
  };
}

/**
 * What the Camera screen says about the pictures taken since switch-on.
 *
 * ⚠️ **A function rather than a ternary in the view, because the ternary was
 * wrong.** The screen read the present-tense keep switch and said *"None of
 * them was kept."* whenever it was off — including after a rider had kept three
 * pictures and turned it off again, which this module explicitly supports. Two
 * numbers decide this sentence and neither of them is the switch.
 *
 * ⚠️ **A count, and never a picture** — ADR 0029 D-11 keeps a kept frame off
 * every screen, and D-8's permitted column is *"a count, a byte size, a format
 * name"*.
 *
 * @param captured how many were taken since the camera was turned on
 * @param kept how many of those are on this device
 */
export function keptSummarySentence(captured: number, kept: number): string {
  if (captured === 0) {
    return 'No pictures have been taken since the camera was turned on.';
  }
  const taken = `Pictures taken since the camera was turned on: ${String(captured)}.`;
  if (kept <= 0) {
    return `${taken} None of them was kept.`;
  }
  if (kept >= captured) {
    return captured === 1
      ? `${taken} It is on this device.`
      : `${taken} All of them are on this device.`;
  }
  return kept === 1
    ? `${taken} One of them is on this device; the rest were thrown away.`
    : `${taken} ${String(kept)} of them are on this device; the rest were thrown away.`;
}

/**
 * A captured frame as the row that keeps it.
 *
 * ⚠️ **The bytes are passed through, not copied and not re-encoded.** They were
 * stripped of every scrap of metadata at capture (D-9, `frame.ts`), and a
 * second producer of image bytes in this program is exactly what that decision
 * exists to prevent — `packages/store`'s own `toPersistedCameraFrame` says the
 * same thing one layer down, and `assertCameraFrameRoundTrip` compares byte for
 * byte because of it.
 *
 * ⚠️ **No name, no activity, no position.** `CameraFrameRecord` has nowhere to
 * put any of them and `records.ts` argues each absence; what matters here is
 * that this function does not invent one — a `name` derived from a ride, say,
 * would be a place name in a field ADR 0004 decision D binds.
 */
function recordFor(port: CameraStorePort, frame: CapturedFrame): CameraFrameRecord {
  return {
    id: cameraFrameId(port.newFrameId()),
    athleteId: port.athleteId,
    capturedAt: port.now(),
    mediaType: frame.mediaType,
    width: frame.width,
    height: frame.height,
    bytes: frame.bytes,
  };
}
