// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What a frame the owner's page drew holds of a village — #1559.
 *
 * Validation 0002 AE2 asks for a row "in a village, with the church and the
 * shops in frame", and phase A of #1533 (#1534's cleared ground, #1535's
 * pavements, #1536's street furniture) changes villages only. So the page
 * publishes, for the frame it last handed the renderer, how many of each
 * structure, each street and each piece of furniture that frame carries, and
 * how many of them stand inside the camera's view — the same frame object
 * `view.render` drew, never one rebuilt beside it.
 *
 * ⚠️ **"In view" is the camera's frustum, not visibility.** A house behind a
 * tree or a rise is still counted: the frustum says the hold points the camera
 * at the church and the shops, and the owner's eye on the tablet says the rest.
 * It is the frustum the renderer builds — `camera.ts` §`cameraRig` for where
 * it stands and looks, §`verticalHalfTangent` and §`horizontalSpread` for the
 * lens at the canvas's aspect, §`NEAR_PLANE_METRES` for its near plane — read
 * at each item's anchor, which is on the ground.
 */

import {
  cameraRig,
  horizontalSpread,
  NEAR_PLANE_METRES,
  verticalHalfTangent,
} from '../../src/game/camera';
import type { SceneFrame } from '../../src/game/port';
import { STRUCTURE_KINDS, type StructureKind } from '../../src/game/scatter';
import { FURNITURE_KINDS, type FurnitureKind } from '../../src/game/streets';

/** A count, in the frame and inside the camera's view. */
export interface Counted {
  readonly carried: number;
  readonly inView: number;
}

/** What {@link frameCensus} reads off one frame. */
export interface FrameCensus {
  /** Each structure kind the frame carries (`settlements.ts`), and how many are in view. */
  readonly structures: Readonly<Record<StructureKind, Counted>>;
  /** The village streets the frame carries (#1535), and their pavements' triangles. */
  readonly streets: number;
  readonly pavementTriangles: number;
  /** Each kind of street furniture on those streets (#1536), and how many are in view. */
  readonly furniture: Readonly<Record<FurnitureKind, Counted>>;
}

/** A point in the corridor's local metres. */
interface Point {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Whether `point` is inside the chase camera's frustum for `frame`, on a
 * canvas `aspect` wide for its height — the far plane aside, which at 2 km is
 * past anything a frame carries.
 */
export function inView(frame: SceneFrame, aspect: number, point: Point): boolean {
  const { eye, target } = cameraRig(frame.camera);
  const forward = unit({ x: target.x - eye.x, y: target.y - eye.y, z: target.z - eye.z });
  // three's camera: up is world +y, right is forward × up.
  const right = unit(cross(forward, { x: 0, y: 1, z: 0 }));
  const up = cross(right, forward);
  const offset = { x: point.x - eye.x, y: point.y - eye.y, z: point.z - eye.z };
  const depth = dot(offset, forward);
  if (depth <= NEAR_PLANE_METRES) return false;
  return (
    Math.abs(dot(offset, right)) <= depth * horizontalSpread(aspect) &&
    Math.abs(dot(offset, up)) <= depth * verticalHalfTangent(aspect)
  );
}

/** What `frame` carries of a village, and how much of it `aspect`'s view holds. */
export function frameCensus(frame: SceneFrame, aspect: number): FrameCensus {
  const counted = <K extends string>(
    kinds: readonly K[],
    items: readonly (Point & { readonly kind: string })[],
  ): Record<K, Counted> => {
    const out = {} as Record<K, Counted>;
    for (const kind of kinds) {
      const mine = items.filter((item) => item.kind === kind);
      out[kind] = {
        carried: mine.length,
        inView: mine.filter((item) => inView(frame, aspect, item)).length,
      };
    }
    return out;
  };
  return {
    structures: counted(STRUCTURE_KINDS, frame.scatter),
    streets: frame.streets.length,
    pavementTriangles: frame.streets.reduce(
      (sum, street) => sum + street.pavement.indices.length / 3,
      0,
    ),
    furniture: counted(
      FURNITURE_KINDS,
      frame.streets.flatMap((street) => street.furniture),
    ),
  };
}

function dot(a: Point, b: Point): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Point, b: Point): Point {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function unit(a: Point): Point {
  const length = Math.hypot(a.x, a.y, a.z);
  return { x: a.x / length, y: a.y / length, z: a.z / length };
}
