// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The routes screen's decisions, as pure functions — #73 criteria 2, 3 and 5.
 *
 * Everything here takes what it needs and returns what it decided. Nothing
 * opens a store, reads a clock or touches the DOM, for `segments/create.ts`'s
 * reason: the interesting parts of this screen are *refusals*, and a refusal
 * asserted through a rendered component is asserted through three layers of
 * things that could also be wrong.
 *
 * ## The edit decision, made here rather than left open
 *
 * #73's second criterion says to decide and test it: *"Editing a saved route
 * creates a new version or updates in place — decide which in this PR — and
 * either way a route that is currently open elsewhere is not silently
 * overwritten."*
 *
 * **It updates in place.** A route's identity is the line; renaming one or
 * changing who can see it does not make it a different route, and versioning
 * every rename would fill a rider's list with near-duplicates they never asked
 * for and would have to prune. The cost of that choice is the second half of
 * the criterion, and it is paid explicitly: {@link editRoute} takes the
 * `updatedAt` the editor **read**, compares it with the stored one, and refuses
 * when they differ. With no server there is no lock to take, so this is the
 * whole of the concurrency story and it is why `RouteRecord.updatedAt` exists.
 *
 * ⚠️ **The guard is on the value read, not on a timestamp comparison.** "Is the
 * stored one newer" would let two saves inside the same second overwrite each
 * other, and #73's failure is a second tab, which is exactly the case that
 * happens fast.
 */

import { ActivityXmlError, decodeGpxRoute, type DecodedRoute } from '@onyourleft/fit';
import { altitudeMetres, routeProfile, RouteError, type RouteProfile } from '@onyourleft/domain';
import { unixSeconds, type UnixSeconds } from '@onyourleft/domain';
import type {
  PrivacyZoneRecord,
  RouteElevationRecord,
  RouteId,
  RouteRecord,
  Visibility,
} from '@onyourleft/store';

import { unresolvedLegs, type RouteDraft } from '../routing/draft';
import { plannedShape, type PlannedElevation } from '../routing/elevation';
import { routeShare, ROUTE_SHARE_FAULT_TEXT } from './share';

/** The longest name a route may carry. Long enough for a real one, short enough for a list row. */
export const MAXIMUM_ROUTE_NAME_LENGTH = 120;

/** What the rider is told, and why nothing was saved. */
export interface SaveRefusal {
  readonly code:
    | 'name-required'
    | 'name-too-long'
    | 'unreadable-file'
    | 'not-a-route'
    | 'not-a-loop'
    | 'edited-elsewhere'
    | 'cannot-be-shared'
    | 'legs-without-a-line';
  readonly message: string;
}

export type SaveOutcome =
  | { readonly status: 'saved'; readonly record: RouteRecord }
  | { readonly status: 'refused'; readonly refusal: SaveRefusal };

function refuse(code: SaveRefusal['code'], message: string): SaveOutcome {
  return { status: 'refused', refusal: { code, message } };
}

/**
 * The name a newly imported route gets before the rider renames it.
 *
 * The file's own `<name>` when it has one, then the file name with its
 * extension removed, and only then a generic. The order is deliberate: a
 * planner writes a name a rider recognises, and a file name is the next best
 * thing they chose themselves. The generic is last because a list of things all
 * called "Imported route" is a list nobody can use.
 */
export function importedRouteName(decodedName: string | undefined, fileName: string): string {
  const fromFile = fileName.replace(/\.[^.]*$/, '').trim();
  const chosen = decodedName?.trim() ?? '';
  const name = chosen.length > 0 ? chosen : fromFile;
  return (name.length > 0 ? name : 'Imported route').slice(0, MAXIMUM_ROUTE_NAME_LENGTH);
}

/** Trims and checks a name a rider typed. */
export function checkName(name: string): SaveRefusal | undefined {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { code: 'name-required', message: 'Give this route a name before saving it.' };
  }
  if (trimmed.length > MAXIMUM_ROUTE_NAME_LENGTH) {
    return {
      code: 'name-too-long',
      message: `A route's name can be up to ${String(MAXIMUM_ROUTE_NAME_LENGTH)} characters.`,
    };
  }
  return undefined;
}

export interface ImportOptions {
  readonly id: RouteId;
  readonly owner: RouteRecord['createdBy'];
  readonly fileName: string;
  /** Passed in rather than read: this module may not consult a clock. */
  readonly now: UnixSeconds;
  /**
   * Whether the rider said this file comes back to where it started.
   *
   * ⚠️ **A claim, checked against the geometry and refused when it is wrong** —
   * `routeProfile` compares the two ends against `LOOP_CLOSURE_METRES` and
   * raises `RouteError('not-a-loop')`, which arrives at the rider as
   * {@link loopRefusalText} below rather than as a saved point-to-point route.
   * `import-form.ts` is where the claim is read, and why it is declared rather
   * than inferred.
   */
  readonly loop?: boolean;
}

/**
 * The words beside the loop switch (a checkbox until #994), quoted back in the refusal below.
 *
 * One constant, so the control a rider is told to turn off is named the way the
 * control they are looking at is actually labelled.
 */
export const LOOP_CHECKBOX_LABEL = 'This route is a loop';

/**
 * What a rider is told when the file they ticked the loop box for does not
 * close, given the importer's own sentence about why.
 *
 * ⚠️ **The domain's message is passed through rather than replaced**, and the
 * reason is that it carries the two numbers this refusal exists to report: how
 * far apart the ends actually are, and how close they had to be. Both are
 * distances, which ADR 0004 decision D keeps in a message; *where* the two ends
 * are is a coordinate and appears nowhere. What this adds is the half a
 * validation failure leaves out — which file, and what to do next.
 */
export function loopRefusalText(fileName: string, because: string): string {
  return (
    `${fileName} was not saved: ${because}. Import it again without “${LOOP_CHECKBOX_LABEL}” ` +
    'turned on to save it as a point-to-point route.'
  );
}

/**
 * Turn a GPX file's text into a route ready to save.
 *
 * ⚠️ **Private, always.** ADR 0004 decision A, and #73's fourth criterion:
 * *"A test asserts a newly saved route's visibility without the user having
 * chosen anything."* There is no option here to make it anything else, which
 * is the strongest form that criterion can take — a default that cannot be
 * overridden at the point of creation cannot be got wrong by a caller.
 */
export function routeFromGpx(text: string, options: ImportOptions): SaveOutcome {
  let decoded: DecodedRoute;
  try {
    decoded = decodeGpxRoute(text, options.loop === undefined ? {} : { loop: options.loop });
  } catch (error: unknown) {
    if (error instanceof RouteError) {
      if (error.code === 'not-a-loop') {
        // ⚠️ Its own code, rather than `not-a-route`. This file *is* a route —
        // the rider's claim about its shape is what failed — and telling them
        // their route file is not a route would send them to check the file
        // instead of the tick box. #296's second criterion is that they can act
        // on it, and acting on it means knowing which of the two was wrong.
        return refuse('not-a-loop', loopRefusalText(options.fileName, error.message));
      }
      // The importer's own messages already name the problem — "no route points",
      // "no elevation anywhere" — so they are passed through rather than
      // replaced with something vaguer.
      return refuse('not-a-route', error.message);
    }
    if (error instanceof ActivityXmlError) {
      return refuse(
        'unreadable-file',
        `${options.fileName} is not a GPX file this app can read: ${error.message}`,
      );
    }
    throw error;
  }

  return {
    status: 'saved',
    record: {
      id: options.id,
      createdBy: options.owner,
      name: importedRouteName(decoded.name, options.fileName),
      profile: decoded.profile,
      visibility: 'private',
      createdAt: options.now,
      updatedAt: options.now,
    },
  };
}

export interface DraftSaveOptions {
  readonly id: RouteId;
  readonly owner: RouteRecord['createdBy'];
  /** What the rider typed. Checked by {@link checkName}. */
  readonly name: string;
  /** Passed in rather than read: this module may not consult a clock. */
  readonly now: UnixSeconds;
  /**
   * The planner's profile, when a routing service gave it heights — and only
   * when it was worked out for THIS draft. The caller holds that pairing:
   * a profile from before the last edit describes a different line.
   */
  readonly elevation?: PlannedElevation | undefined;
}

/**
 * What a rider is told about the heights of a route saved from the planner
 * with no elevation service — the case with no instance (#2006).
 */
export const FLAT_DRAWN_ROUTE_TEXT =
  'No heights are known for a route drawn here yet, so it is saved flat: its climb reads 0 m.';

/**
 * Turn the route a rider drew into a saved route — #2006.
 *
 * The same `RouteRecord` an import writes, so a drawn route sits in the same
 * list, rides the same way and leaves through the same downloads (#74). And
 * private, for {@link routeFromGpx}'s reason: there is no option here to make
 * it anything else.
 *
 * ⚠️ **Its line is the drawn line, end to end, and every leg must have one.**
 * A leg still being routed, or one whose routing failed, has no line, and
 * joining its neighbours with a straight stroke would save a stretch the rider
 * never drew as ridden road. So that is a refusal naming the legs — the
 * planner's own {@link plannedShape} stops at the same hole.
 *
 * ⚠️ **With no elevation service the profile is flat, and says so.** A
 * `RouteProfile` needs heights and a drawn line has none until something is
 * asked; zero everywhere is the honest floor, `elevation` is left absent so
 * the record does not claim a dataset (`RouteRecord.elevation`'s rule), and
 * the rider is told ({@link FLAT_DRAWN_ROUTE_TEXT}).
 */
export function routeFromDraft(draft: RouteDraft, options: DraftSaveOptions): SaveOutcome {
  const nameFault = checkName(options.name);
  if (nameFault !== undefined) return { status: 'refused', refusal: nameFault };

  if (draft.waypoints.length < 2) {
    return refuse('not-a-route', 'A route needs two waypoints before it can be saved.');
  }
  const missing = unresolvedLegs(draft);
  if (missing.length > 0) {
    const names = missing.map((leg) => String(leg + 1));
    const which =
      names.length === 1
        ? `Leg ${names[0]!} has`
        : `Legs ${names.slice(0, -1).join(', ')} and ${names.at(-1)!} have`;
    return refuse(
      'legs-without-a-line',
      `${which} no line yet, so the route was not saved. Draw ${names.length === 1 ? 'it' : 'them'} freehand, or wait for ${names.length === 1 ? 'it' : 'them'} to be routed.`,
    );
  }

  let profile: RouteProfile;
  let elevation: RouteElevationRecord | undefined;
  try {
    if (options.elevation === undefined) {
      profile = routeProfile(
        plannedShape(draft).map((position) => ({ position, elevation: altitudeMetres(0) })),
      );
    } else {
      profile = options.elevation.profile;
      elevation = {
        dataset: options.elevation.dataset.name,
        resolution: options.elevation.dataset.resolution,
        interval: options.elevation.interval,
        missing: options.elevation.coverage.missing,
      };
    }
  } catch (error: unknown) {
    // `no-distance`: every waypoint in one place. The domain's message names
    // the problem and no coordinate (ADR 0004 decision D).
    if (error instanceof RouteError) return refuse('not-a-route', `${error.message}.`);
    throw error;
  }

  return {
    status: 'saved',
    record: {
      id: options.id,
      createdBy: options.owner,
      name: options.name.trim(),
      profile,
      ...(elevation === undefined ? {} : { elevation }),
      visibility: 'private',
      createdAt: options.now,
      updatedAt: options.now,
    },
  };
}

/** What an edit may change. Everything else about a route is its geometry. */
export interface RouteEdit {
  readonly name: string;
  readonly visibility: Visibility;
  /** The `updatedAt` the editor read. The optimistic-concurrency token. */
  readonly readAt: UnixSeconds;
}

/**
 * Apply an edit to the stored route, or say why not.
 *
 * @param stored what a **fresh** read returned, not what the form was opened
 * with. Handing this the editor's own copy would compare a value with itself
 * and the guard would never fire.
 */
export function editRoute(
  stored: RouteRecord,
  edit: RouteEdit,
  now: UnixSeconds,
  zones: readonly PrivacyZoneRecord[] = [],
): SaveOutcome {
  const nameFault = checkName(edit.name);
  if (nameFault !== undefined) return { status: 'refused', refusal: nameFault };

  if (stored.updatedAt !== edit.readAt) {
    return refuse(
      'edited-elsewhere',
      'This route was changed somewhere else since you opened it — another tab, or another ' +
        'device. Reopen it to see the current version; nothing here has been saved.',
    );
  }

  if (edit.visibility !== 'private' && stored.visibility === 'private') {
    // Checked at the moment of *widening*, not on every save: a route that is
    // already shared and is being renamed does not need the question asked
    // again, and asking it would train a rider to click past it.
    const share = routeShare(stored, zones);
    const fault = share.faults[0];
    if (fault !== undefined) {
      return refuse('cannot-be-shared', ROUTE_SHARE_FAULT_TEXT[fault]);
    }
  }

  return {
    status: 'saved',
    record: {
      ...stored,
      name: edit.name.trim(),
      visibility: edit.visibility,
      updatedAt: now === stored.updatedAt ? unixSeconds(now + 1) : now,
    },
  };
}
