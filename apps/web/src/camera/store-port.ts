// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the camera may ask of the store, which is three things and not four**
 * ([#384](https://github.com/openzigs/onyourleft/issues/384),
 * [ADR 0029](../../../../docs/adr/0029-camera-imagery-as-a-data-class.md) D-2
 * and D-11).
 *
 * Narrowed to three methods rather than taking `ActivityStore`, for
 * `transfer/store-port.ts`'s reason: a test then hands the same code the
 * round-trip harness's store, so an assertion reads back on **a connection this
 * process never wrote through**. CLAUDE.md §5 calls that the fourth cause of a
 * write that reports success while the read cannot see it, and it is the one a
 * naive test cannot detect.
 *
 * ## ⚠️ There is no read that returns a picture, and that is D-11
 *
 * The obvious fourth method is `listCameraFrames`, and it is deliberately
 * **not** here. ADR 0029 D-11:
 *
 * > No frame, thumbnail, crop or filmstrip appears on the activity library row,
 * > in the ride detail view's default render, in the workout or route screens,
 * > in a share sheet's preview, or in any list. A kept frame is reached from the
 * > report the rider opens deliberately, and from nowhere else.
 *
 * A port that could hand a picture to a screen is a screen somebody builds. So
 * the camera's own port can **write** one, **count** them and **delete** them,
 * and the only thing in this client that reads one back is the account export
 * (`transfer/store-port.ts` §`AccountStore.listCameraFrames`) — which writes it
 * to a file the rider asked for rather than to a screen.
 *
 * ⚠️ **A `*-port.ts`, so `check:wiring`'s `WIRE003` watches every method**
 * (CLAUDE.md §4j). All three have a production caller: `keep.ts` writes,
 * `views/CameraView.tsx` counts and deletes. Delete any one of them and the
 * gate goes red naming it — the mutation list in this pull request records the
 * run.
 */

import type { AthleteId, CameraFrameId, CameraFrameRecord } from '@onyourleft/store';

/** The store calls the camera makes. @see the module note for the one it cannot */
export interface CameraFrameStore {
  /**
   * Keeps one picture.
   *
   * ⚠️ **Reached only when the rider turned this ride's keep on.** ADR 0029
   * D-2's default is that a frame never reaches durable storage at all;
   * `keep.ts` is what decides, and `session.ts`'s default sink — which drops
   * the frame and has no store in it — is what makes the default the *absence*
   * of a code path rather than a branch.
   */
  putCameraFrame(record: CameraFrameRecord): Promise<CameraFrameId>;
  /**
   * How many this device is holding.
   *
   * A count, because a count is the only thing a screen may show: D-8's
   * permitted column is *"a count, a byte size, a format name"*, and D-11
   * forbids the picture.
   */
  countCameraFrames(owner: AthleteId): Promise<number>;
  /**
   * Deletes every picture this athlete kept.
   *
   * All of them rather than one, and `packages/store`'s own
   * `deleteCameraFrames` says why: of D-2's three expiries — the rider, the
   * activity, the device — this is the one that works today, and a per-picture
   * delete would need the list D-11 forbids.
   */
  deleteCameraFrames(owner: AthleteId): Promise<number>;
}

/** Everything the camera's retention needs from outside itself. */
export interface CameraStorePort {
  readonly store: CameraFrameStore;
  readonly athleteId: AthleteId;
  /** A fresh id per kept picture. `crypto.randomUUID()` in production. */
  newFrameId(): CameraFrameId;
  /** When the picture was taken. `browserClock` in production. */
  now(): import('@onyourleft/domain').UnixSeconds;
}
