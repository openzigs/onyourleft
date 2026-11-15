// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a ride's page may read of its side-camera snapshots, and only once
 * the rider opens their section** —
 * [#1063](https://github.com/openzigs/onyourleft/issues/1063),
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-5, D-6 and D-12.
 *
 * A port of its own rather than three more members on `store-port.ts`
 * §`DetailStore`, so that the one read of a picture a screen may make is
 * reachable from exactly one component — `RideSnapshotsSection.tsx` — and is
 * not a member every other part of the detail view is handed.
 *
 * ⚠️ **A `*-port.ts`, so `check:wiring`'s `WIRE003` watches every method**
 * (docs/agents/wiring-gate.md §4j).
 */

import type { ActivityId, AthleteId, CameraFrameId, CameraFrameRecord } from '@onyourleft/store';

/** The three store calls, each owner first — `packages/store` §`listRideSnapshots` and its neighbours. */
export interface RideSnapshotsStore {
  /** How many — what the closed section says, with no picture read. */
  countRideSnapshots(owner: AthleteId, activity: ActivityId): Promise<number>;
  /** The pictures — read only once the rider has opened the section. */
  listRideSnapshots(owner: AthleteId, activity: ActivityId): Promise<CameraFrameRecord[]>;
  /** Delete one — the rider's own delete (D-3). */
  deleteRideSnapshot(owner: AthleteId, activity: ActivityId, id: CameraFrameId): Promise<boolean>;
}

/** Turning a picture's bytes into an image source and letting it go again (D-1's table). */
export interface ObjectUrls {
  create(bytes: Uint8Array, mediaType: string): string;
  revoke(url: string): void;
}

export interface RideSnapshotsPort {
  readonly athleteId: AthleteId;
  readonly store: RideSnapshotsStore;
  /**
   * `URL.createObjectURL` and `revokeObjectURL` in production, made only while
   * the section is open and revoked when it closes or unmounts (ADR 0044
   * D-1). `undefined` where the platform has none, and then no picture is
   * shown and the section says so.
   */
  readonly objectUrls: ObjectUrls | undefined;
  /**
   * Android's secure window flag while a snapshot is on screen (D-12) —
   * `camera/session.ts` §`holdSecureWindow` in production. Returns the
   * give-back.
   */
  holdSecureWindow(): () => void;
}
