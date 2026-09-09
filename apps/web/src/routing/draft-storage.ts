// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Keeping a half-drawn route across a reload —
 * [#71](https://github.com/openzigs/onyourleft/issues/71).
 *
 * #71's seventh criterion: *"in-progress route state survives a page reload —
 * persisted locally, per #46's approach — and a test reloads mid-draw and
 * asserts the waypoints are still there."*
 *
 * ⚠️ **`localStorage`, not the IndexedDB checkpoint machinery #46 built**, and
 * the difference is what is at stake. A recording checkpoint is *the only copy
 * of a ride that happened* — `packages/store`'s README states an eight-second
 * loss bound and the recorder is built around it. A route draft is a plan that
 * has not happened yet; losing one costs a few minutes of clicking, and the
 * rider is at their desk with the map still on screen. Putting a draft through
 * the checkpoint store would mean a schema version, a migration pair and a
 * fifth store fake for something that is not measurements.
 *
 * ⚠️ **Every read and write is wrapped, and a failure is silent.** A private
 * window, cleared site data or a browser set to refuse storage all throw on
 * *access*, not merely return nothing. A builder that crashed because it could
 * not remember a draft would be worse than one that forgets.
 *
 * ⚠️ **The serialisation is a pure pair of functions and the storage is a thin
 * shell around them**, so the round trip is testable without a DOM — and so a
 * saved draft written by an older build is *refused* rather than half-read.
 * Same posture as ADR 0017 D-4: an unrecognised shape is not something to do
 * one's best with when the result is a route a rider then saves.
 */

import {
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  type GeographicPosition,
} from '@onyourleft/domain';

import { legFor, type LegMode, type RouteDraft } from './draft';

/** The key the draft is kept under. Namespaced, because the origin is shared. */
export const DRAFT_STORAGE_KEY = 'oyl.route-draft.v1';

/**
 * One key that is both the identity and the version, exactly as ADR 0017 D-3
 * argues for the workout file: a `format` string beside a `version` number can
 * disagree with itself and one key cannot.
 */
const VERSION_KEY = 'onYourLeftRouteDraft';
const VERSION = 1;

/**
 * Serialise a draft.
 *
 * ⚠️ **Geometry is dropped, waypoints are kept.** A restored draft re-routes
 * its legs rather than restoring their shapes, and that is deliberate: the
 * shapes are the large part by two orders of magnitude, `localStorage` is
 * typically a 5 MB budget shared with everything else this origin stores, and a
 * leg's geometry is exactly the part an engine will hand back for free. What
 * cannot be recovered by asking again is where the rider put the pins.
 */
export function serialiseDraft(draft: RouteDraft): string {
  return JSON.stringify({
    [VERSION_KEY]: VERSION,
    nextId: draft.nextId,
    waypoints: draft.waypoints.map((waypoint) => ({
      id: waypoint.id,
      latitude: waypoint.position.latitude,
      longitude: waypoint.position.longitude,
    })),
    modes: draft.legs.map((leg) => leg.mode),
  });
}

/**
 * Read one back, or `undefined` for anything this build does not recognise.
 *
 * Never throws. A draft that cannot be read is a draft the rider redraws, and
 * a builder that refused to open because of a bad key in `localStorage` would
 * be unrecoverable without developer tools.
 */
export function deserialiseDraft(text: string | null): RouteDraft | undefined {
  if (text === null || text === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const row = parsed as Record<string, unknown>;
  if (row[VERSION_KEY] !== VERSION) return undefined;
  const waypoints = positionsFrom(row['waypoints']);
  if (waypoints === undefined) return undefined;
  const modes = modesFrom(row['modes'], Math.max(0, waypoints.length - 1));
  if (modes === undefined) return undefined;
  const nextId = row['nextId'];
  if (typeof nextId !== 'number' || !Number.isInteger(nextId) || nextId < 1) return undefined;
  return {
    waypoints,
    // ⚠️ **A snapped leg comes back unrouted and a freehand one comes back
    // whole**, and the difference is the bug review found: the screen's restore
    // resolves only snapped legs, because a freehand leg never had an engine to
    // ask. Marking both `pending` left a restored freehand leg reading "Being
    // routed" for ever, excluded from the total distance, and — worst —
    // truncating `plannedShape`, which stops at the first leg with no geometry,
    // so the whole elevation profile ended at the reloaded freehand leg.
    //
    // `legFor` already draws that distinction, and using it here is what keeps
    // the two paths from having separate opinions about what a freehand leg is.
    legs: modes.map((mode, index) => legFor(mode, waypoints[index]!, waypoints[index + 1]!)),
    nextId,
  };
}

export interface DraftStorage {
  read(): RouteDraft | undefined;
  write(draft: RouteDraft): void;
  forget(): void;
}

/** The real one. Every access is wrapped; see this module's header. */
export function browserDraftStorage(store: Storage | undefined): DraftStorage {
  return {
    read: () => {
      try {
        return deserialiseDraft(store?.getItem(DRAFT_STORAGE_KEY) ?? null);
      } catch {
        return undefined;
      }
    },
    write: (draft) => {
      try {
        store?.setItem(DRAFT_STORAGE_KEY, serialiseDraft(draft));
      } catch {
        // A full or refusing store loses the draft and nothing else.
      }
    },
    forget: () => {
      try {
        store?.removeItem(DRAFT_STORAGE_KEY);
      } catch {
        // As above.
      }
    },
  };
}

function positionsFrom(value: unknown): RouteDraft['waypoints'] | undefined {
  if (!Array.isArray(value)) return undefined;
  const waypoints: { id: string; position: GeographicPosition }[] = [];
  for (const entry of value as readonly unknown[]) {
    if (typeof entry !== 'object' || entry === null) return undefined;
    const row = entry as Record<string, unknown>;
    const { id, latitude, longitude } = row;
    if (typeof id !== 'string' || typeof latitude !== 'number' || typeof longitude !== 'number') {
      return undefined;
    }
    try {
      waypoints.push({
        id,
        position: geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude)),
      });
    } catch {
      // A stored coordinate off the Earth is a corrupt draft, not one to repair.
      return undefined;
    }
  }
  return waypoints;
}

function modesFrom(value: unknown, expected: number): LegMode[] | undefined {
  if (!Array.isArray(value) || value.length !== expected) return undefined;
  const modes: LegMode[] = [];
  for (const entry of value as readonly unknown[]) {
    if (entry !== 'snapped' && entry !== 'freehand') return undefined;
    modes.push(entry);
  }
  return modes;
}
