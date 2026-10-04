// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The side camera's latest picture on the tablet, with the outline of where
 * the model found the rider in it** —
 * [#1061](https://github.com/openzigs/onyourleft/issues/1061),
 * [ADR 0044](../../../../docs/adr/0044-side-camera-live-view-and-snapshot.md)
 * D-1, D-6, D-7, D-9 and D-12.
 *
 * Shown on the Camera screen while the rider sets the side camera up, so they
 * can line the tripod up from the bike: the phone that shows its own picture
 * stands 2–3 m away and side-on.
 *
 * ## What it draws, and how each line is told apart (#48's non-colour rule)
 *
 * - **The picture**, drawn from the decoded bitmap the model looked at onto a
 *   `<canvas>`. No object URL is made (D-1), and no pixel is read back, stored
 *   or sent by this component.
 * - **The guide** — where to stand the bike — SOLID, as on the phone
 *   (`FramingPreview.tsx`).
 * - **The ghost** of the last session, DASHED, when one is stored and was
 *   taken in this picture's shape.
 * - **The outline** of where the model found the rider in THIS picture —
 *   DOTTED, with a dot at each point. It is drawn only from the landmarks of
 *   the picture it is drawn on (`side-analysis.ts` §`#show`), and a picture the
 *   model found nobody in is drawn with none. One person only (D-7): the model
 *   runs with `numPoses: 1`, so a second person in frame is in the picture
 *   with no outline.
 *
 * ## What it says
 *
 * Nothing about the body (D-9). The framing check stays the primary signal, in
 * words, above it (`views/SideCameraControl.tsx`). The picture's text
 * alternative says what it is, not what it shows, and the caption names the
 * three lines.
 *
 * ## The secure window (D-12)
 *
 * While the picture is mounted it holds Android's secure window flag through
 * the controller (`secure-window.ts`); removing it gives the hold back.
 *
 * It is here, in `camera/`, because it names a `<canvas>`, and
 * `boundary.test.ts` holds every camera platform name inside this directory.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type JSX,
} from 'react';

import {
  FRAMING_GUIDE,
  guideScaleFor,
  MAXIMUM_ASPECT_CHANGE,
  referenceOutline,
  type FramingReference,
} from './framing';
import { liveOutline } from './live-outline';
import type { CameraController } from './session';
import type { SideLivePicture, SideLiveViewPort } from './side-live-view-port';

/** What the picture is — its text alternative, which says what it is and not what it shows. */
export const SIDE_LIVE_PICTURE_LABEL = 'The side camera’s latest picture';

/** The caption's first sentence: what the picture is, and that it is not kept. */
export const SIDE_LIVE_CAPTION =
  'The side camera’s latest picture, shown until the next one arrives and not kept.';

export interface SideLiveViewProps {
  readonly view: SideLiveViewPort;
  /** Whose secure window hold the picture takes (ADR 0044 D-12). */
  readonly controller: CameraController;
}

/**
 * The live view, or nothing at all: before the first picture, and once the
 * link is lost or the session has ended, the element is ABSENT rather than
 * hidden, and the phone's state above says why in words.
 */
export function SideLiveView({ view, controller }: SideLiveViewProps): JSX.Element | null {
  // ⚠️ One subscription for as long as `view` is the same: a new function on
  // every render would make React unsubscribe and subscribe again each time,
  // and the last viewer leaving drops the picture (`side-analysis.ts`).
  const subscribe = useCallback((listener: () => void) => view.onSideLiveView(listener), [view]);
  const read = useCallback(() => view.sideLiveView(), [view]);
  const live = useSyncExternalStore(subscribe, read, read);
  if (live.picture === undefined) {
    return null;
  }
  return <LivePicture picture={live.picture} reference={live.reference} controller={controller} />;
}

function LivePicture({
  picture,
  reference,
  controller,
}: {
  readonly picture: SideLivePicture;
  readonly reference: FramingReference | undefined;
  readonly controller: CameraController;
}): JSX.Element {
  const canvas = useRef<HTMLCanvasElement>(null);

  // D-12: a camera picture is on the screen for as long as this is mounted.
  useEffect(() => controller.holdSecureWindow(), [controller]);

  // Drawn before the browser paints, so a picture and its outline reach the
  // screen in the same frame.
  useLayoutEffect(() => {
    const element = canvas.current;
    if (element === null) {
      return;
    }
    const { pixels } = picture;
    element.width = pixels.width;
    element.height = pixels.height;
    try {
      element.getContext('2d')?.drawImage(pixels, 0, 0);
    } catch {
      // A picture replaced and closed before this ran: the next render draws
      // its successor. Nothing of the error is read (ADR 0029 D-8).
    }
  }, [picture]);

  const { pixels, pose, sequence } = picture;
  const aspect = pixels.width > 0 && pixels.height > 0 ? pixels.width / pixels.height : 16 / 9;
  const centre = aspect / 2;
  // The reference is drawn in ITS OWN picture's shape, and only when that is
  // this picture's shape (`FramingPreview.tsx` says why).
  const ghost =
    reference !== undefined && Math.abs(reference.aspect / aspect - 1) <= MAXIMUM_ASPECT_CHANGE
      ? referenceOutline(reference)
      : [];
  const outline = pose === undefined ? undefined : liveOutline(pose, aspect);

  return (
    <figure className="oyl-framing oyl-side-live" data-oyl-side-live="">
      <div
        className="oyl-framing__picture"
        style={{ aspectRatio: String(aspect) }}
        role="img"
        aria-label={SIDE_LIVE_PICTURE_LABEL}
        data-oyl-live-sequence={sequence}
      >
        <canvas ref={canvas} className="oyl-framing__video" aria-hidden="true" />
        <svg
          className="oyl-framing__overlay"
          viewBox={`0 0 ${String(aspect)} 1`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
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
          {outline === undefined ? null : (
            <g className="oyl-framing__outline" data-oyl-live-outline-sequence={sequence}>
              {outline.bones.map((bone) => (
                <line
                  key={`${String(bone.x1)},${String(bone.y1)},${String(bone.x2)},${String(bone.y2)}`}
                  x1={bone.x1}
                  y1={bone.y1}
                  x2={bone.x2}
                  y2={bone.y2}
                />
              ))}
              {outline.joints.map((joint) => (
                <circle
                  key={joint.name}
                  className="oyl-framing__joint"
                  data-oyl-live-joint={joint.name}
                  cx={joint.x}
                  cy={joint.y}
                  r={0.008}
                />
              ))}
            </g>
          )}
        </svg>
      </div>
      <figcaption>
        {SIDE_LIVE_CAPTION} The solid outline is where to stand the bike.
        {outline === undefined
          ? ' The tablet did not find you in this picture, so there is no dotted line.'
          : ' The dotted line, with a dot at each point, is where the tablet found you in this picture.'}
        {ghost.length > 0 ? ' The dashed outline is where you were last time.' : ''}
      </figcaption>
    </figure>
  );
}
