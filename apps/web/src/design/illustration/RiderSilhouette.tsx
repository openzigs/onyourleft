// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from 'react';

import {
  BICYCLE_FRONT_METRES,
  BICYCLE_LENGTH_METRES,
  CRANK_AXIS_Y,
  CRANK_AXIS_Z,
  emptyRiderJoints,
  LIMB_RADIUS_METRES,
  RIDER_BODY_PARTS,
  RIDER_CRANK_PARTS,
  RIDER_HEIGHT_METRES,
  riderJoints,
  type JointPoint,
  type RiderPart,
} from '../../game/bicycle';
import { paint } from './paint';
import { coordinate, IllustrationSvg, type IllustrationProps } from './svg';

/**
 * The rider, drawn flat from the side — #938.
 *
 * ⚠️ **Every length here is `game/bicycle.ts`'s**, which is #938's rule and
 * the reason this file holds no proportion of its own: the wheels, the frame,
 * the bar, the saddle, the torso and the helmet are that file's parts list
 * (`RIDER_BODY_PARTS`) seen from the rider's left, and the legs are its
 * two-bone solve (`riderJoints`) at one crank angle. Change the saddle height
 * there and this drawing follows. The bicycle's own frame has `+Z` forward and
 * `+Y` up; the drawing's `x` is `z` and its `y` is the height turned upside
 * down, in metres, so the viewBox is the bicycle's own size.
 *
 * Only what reads from the side is drawn: a part laid ACROSS the bicycle (the
 * bar tops, the axles) is a point from here and is left out. Tubes are lines as
 * thick as the tube; boxes are rectangles as deep and as tall as the box,
 * turned by its pitch.
 */

/** The pose: one pedal forward, which reads as riding rather than standing. */
const CRANK_ANGLE = Math.PI / 2;
/** The thinnest line drawn, so a stay a few millimetres thick still shows. */
const MINIMUM_LINE_METRES = 0.03;
/** Room round the bicycle, so a round line cap is not cut by the viewBox. */
const MARGIN_METRES = 0.06;

const REAR = BICYCLE_FRONT_METRES - BICYCLE_LENGTH_METRES;

const x = (z: number): string => coordinate(z);
const y = (height: number): string => coordinate(RIDER_HEIGHT_METRES - height);

function line(
  key: string,
  from: { readonly y: number; readonly z: number },
  to: { readonly y: number; readonly z: number },
  width: number,
): JSX.Element {
  return (
    <line
      key={key}
      className={paint('figureLine')}
      strokeLinecap="round"
      strokeWidth={coordinate(Math.max(MINIMUM_LINE_METRES, width))}
      x1={x(from.z)}
      x2={x(to.z)}
      y1={y(from.y)}
      y2={y(to.y)}
    />
  );
}

/** A part as seen from the side, or nothing when it is a point from there. */
function sideView(
  part: RiderPart,
  offset: { readonly y: number; readonly z: number },
): JSX.Element | null {
  const key = part.name;
  const centre = { y: part.y + offset.y, z: part.z + offset.z };
  const { solid } = part;
  // Laid across the bicycle (the bar tops, an axle): a point from the side.
  if (part.roll !== 0) {
    return null;
  }
  // Only the one side of a pair: the far stay is behind the near one.
  if (part.x < 0) {
    return null;
  }
  switch (solid.shape) {
    case 'ring':
      return (
        <circle
          key={key}
          className={paint('figureLine')}
          cx={x(centre.z)}
          cy={y(centre.y)}
          r={coordinate(solid.radius)}
          strokeWidth={coordinate(Math.max(MINIMUM_LINE_METRES, 2 * solid.thickness))}
        />
      );
    case 'ball':
      return (
        <circle
          key={key}
          className={paint('figure')}
          cx={x(centre.z)}
          cy={y(centre.y)}
          r={coordinate(solid.radius)}
        />
      );
    case 'tube': {
      // A tube stands along `+Y` and is tipped by `pitch` toward `+Z`.
      const half = solid.length / 2;
      const along = { y: Math.cos(part.pitch) * half, z: Math.sin(part.pitch) * half };
      return line(
        key,
        { y: centre.y - along.y, z: centre.z - along.z },
        { y: centre.y + along.y, z: centre.z + along.z },
        2 * solid.radius,
      );
    }
    case 'bend': {
      // A torus stood in the bicycle's plane by a quarter yaw: its own angle
      // `t` lands at height `r·sin t` and `−r·cos t` forward of its centre.
      const at = (t: number): { y: number; z: number } => ({
        y: centre.y + solid.radius * Math.sin(t),
        z: centre.z - solid.radius * Math.cos(t),
      });
      const start = at(solid.start);
      const end = at(solid.start + solid.sweep);
      const turn = solid.sweep > Math.PI ? 1 : 0;
      return (
        <path
          key={key}
          className={paint('figureLine')}
          d={`M${x(start.z)} ${y(start.y)} A${coordinate(solid.radius)} ${coordinate(
            solid.radius,
          )} 0 ${String(turn)} 1 ${x(end.z)} ${y(end.y)}`}
          strokeLinecap="round"
          strokeWidth={coordinate(Math.max(MINIMUM_LINE_METRES, 2 * solid.thickness))}
        />
      );
    }
    case 'box': {
      // Seen from the side a box is its depth along `z` by its height along
      // `y`, turned by its pitch about its centre.
      const halfDepth = solid.depth / 2;
      const halfHeight = solid.height / 2;
      const cos = Math.cos(part.pitch);
      const sin = Math.sin(part.pitch);
      const corner = (dz: number, dy: number): string =>
        `${x(centre.z + dz * cos + dy * sin)} ${y(centre.y - dz * sin + dy * cos)}`;
      return (
        <path
          key={key}
          className={paint('figure')}
          d={`M${corner(-halfDepth, -halfHeight)} L${corner(halfDepth, -halfHeight)} L${corner(
            halfDepth,
            halfHeight,
          )} L${corner(-halfDepth, halfHeight)} Z`}
        />
      );
    }
  }
}

function legs(joints: ReturnType<typeof emptyRiderJoints>): JSX.Element[] {
  const width = 2 * LIMB_RADIUS_METRES;
  const crank = { y: CRANK_AXIS_Y, z: CRANK_AXIS_Z };
  const near = (point: JointPoint): { y: number; z: number } => ({ y: point.y, z: point.z });
  return [0, 1].flatMap((index) => {
    const knee = joints.knee[index as 0 | 1];
    const foot = joints.foot[index as 0 | 1];
    return [
      line(`thigh ${String(index)}`, near(joints.hips), near(knee), width),
      line(`shin ${String(index)}`, near(knee), near(foot), width),
      line(`crank ${String(index)}`, crank, near(foot), MINIMUM_LINE_METRES),
    ];
  });
}

const VIEW_BOX = [
  REAR - MARGIN_METRES,
  -MARGIN_METRES,
  BICYCLE_LENGTH_METRES + 2 * MARGIN_METRES,
  RIDER_HEIGHT_METRES + 2 * MARGIN_METRES,
]
  .map(coordinate)
  .join(' ');

/** A cyclist on a road bicycle, from the side, facing right. */
export function RiderSilhouette({ className }: IllustrationProps): JSX.Element {
  const joints = riderJoints(CRANK_ANGLE, emptyRiderJoints(), 0);
  const crank = { y: CRANK_AXIS_Y, z: CRANK_AXIS_Z };
  return (
    <IllustrationSvg aspect="xMidYMid meet" className={className} viewBox={VIEW_BOX}>
      {RIDER_BODY_PARTS.map((part) => sideView(part, { y: 0, z: 0 }))}
      {RIDER_CRANK_PARTS.filter((part) => part.solid.shape === 'ring').map((part) =>
        sideView(part, crank),
      )}
      {legs(joints)}
    </IllustrationSvg>
  );
}
