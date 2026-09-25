// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The live picture on the tripod phone, with the outline to stand the bike
 * in and the ghost of last time over it** — #528,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md) D-7.
 *
 * The owner's ruling on #527: *"framing is set up on this phone only. The
 * tablet shows state and no preview."* So this is the one place in the client
 * a camera's picture is on a screen, and it is here, in `camera/`, because it
 * is the one component that names a `<video>` element — `boundary.test.ts`
 * holds every camera platform name inside this directory.
 *
 * ⚠️ **What it does with the picture: nothing.** The camera's stream is played
 * by the platform into the element (`session.ts` §`showPreview`); no pixel is
 * drawn into a canvas, encoded, stored or read by this program. It is not a
 * kept frame (ADR 0029 D-11 is about those) and it is gone when the element
 * is.
 *
 * ## The two outlines, and why neither is colour alone
 *
 * - **The guide** — where a bicycle and rider should stand — is a SOLID line.
 * - **The ghost** of the last session is a DASHED line.
 *
 * They also differ in colour, but the dash is what tells them apart
 * (#48's sixth criterion), and the caption under the picture names both in
 * words.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

import {
  FRAMING_GUIDE,
  guideScaleFor,
  MAXIMUM_ASPECT_CHANGE,
  referenceOutline,
  type FramingReference,
} from './framing';
import type { CameraController } from './session';

export interface FramingPreviewProps {
  readonly controller: CameraController;
  /** The last session's framing, when the tablet sent one. */
  readonly reference: FramingReference | undefined;
}

/**
 * The shape the picture is assumed to be until the platform says: 16 : 9, the
 * shape `browser-camera.ts` §`CAMERA_CONSTRAINTS` does not ask for and most
 * phone cameras give in landscape.
 */
const ASSUMED_ASPECT = 16 / 9;

export function FramingPreview({ controller, reference }: FramingPreviewProps): JSX.Element {
  const video = useRef<HTMLVideoElement>(null);
  const [aspect, setAspect] = useState(ASSUMED_ASPECT);

  useEffect(() => {
    const element = video.current;
    if (element === null) {
      return undefined;
    }
    const detach = controller.showPreview(element);
    const measure = (): void => {
      if (element.videoWidth > 0 && element.videoHeight > 0) {
        setAspect(element.videoWidth / element.videoHeight);
      }
    };
    element.addEventListener('loadedmetadata', measure);
    element.addEventListener('resize', measure);
    return () => {
      element.removeEventListener('loadedmetadata', measure);
      element.removeEventListener('resize', measure);
      detach();
    };
  }, [controller]);

  // ⚠️ The reference is drawn in ITS OWN picture's shape. A reference taken
  // in a different shape is not comparable at all (`framing.ts`
  // §`MAXIMUM_ASPECT_CHANGE`), and stretching it to fit would draw a ghost in
  // a place the rider never stood — so it is left out and the caption says why.
  const ghost =
    reference !== undefined && Math.abs(reference.aspect / aspect - 1) <= MAXIMUM_ASPECT_CHANGE
      ? referenceOutline(reference)
      : [];
  const centre = aspect / 2;

  return (
    <figure className="oyl-framing">
      <div className="oyl-framing__picture" style={{ aspectRatio: String(aspect) }}>
        {/* Muted and inline: a picture to line up by, not a film to watch. */}
        <video ref={video} className="oyl-framing__video" muted playsInline aria-hidden="true" />
        <svg
          className="oyl-framing__overlay"
          viewBox={`0 0 ${String(aspect)} 1`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {/*
            Shrunk about the bottom-centre — the floor the wheels stand on —
            when the picture is too narrow for a bicycle at full size.
          */}
          <g
            className="oyl-framing__guide"
            transform={`translate(${String(centre)} 1) scale(${String(guideScaleFor(aspect))}) translate(${String(-centre)} -1)`}
          >
            {FRAMING_GUIDE.wheels.map((wheel) => (
              <circle
                key={`wheel-${String(wheel.dx)}`}
                cx={centre + wheel.dx}
                cy={wheel.y}
                r={wheel.r}
              />
            ))}
            <circle
              cx={centre + FRAMING_GUIDE.head.dx}
              cy={FRAMING_GUIDE.head.y}
              r={FRAMING_GUIDE.head.r}
            />
            {FRAMING_GUIDE.lines.map((line) => (
              <line
                key={`${String(line.dx1)},${String(line.y1)},${String(line.dx2)},${String(line.y2)}`}
                x1={centre + line.dx1}
                y1={line.y1}
                x2={centre + line.dx2}
                y2={line.y2}
              />
            ))}
          </g>
          <g
            className="oyl-framing__ghost"
            data-oyl-framing-ghost={ghost.length > 0 ? 'shown' : 'none'}
          >
            {ghost.map((segment) => (
              <line
                key={`${String(segment.x1)},${String(segment.y1)},${String(segment.x2)},${String(segment.y2)}`}
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
              />
            ))}
          </g>
        </svg>
      </div>
      <figcaption>
        {ghost.length > 0
          ? 'The solid outline is where to stand the bike. The dashed outline is where you were last time.'
          : reference === undefined
            ? 'The solid outline is where to stand the bike.'
            : 'The solid outline is where to stand the bike. Last time the picture was a different shape — the phone turned the other way, or a different camera — so there is no outline of last time to line up with.'}
      </figcaption>
    </figure>
  );
}
