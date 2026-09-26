// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What the tablet's front camera sees while it reads the phone's pairing
 * code, and only then** — #557,
 * [ADR 0033](../../../../docs/adr/0033-side-camera-link.md)'s 2026-09-26
 * amendment.
 *
 * The owner's #527 ruling was *"the tablet shows state only"*, and on
 * 2026-09-26 the owner relaxed it for the seconds of pairing: a rider cannot
 * aim a camera at a code they cannot see, and the first attempt only worked
 * with the phone flat on a table and the tablet held flat above it. So this
 * is shown while `Offer` in `views/SideCameraControl.tsx` is scanning, and
 * never once the phone is paired — that component unmounts it the moment the
 * scan stops.
 *
 * ⚠️ **What it does with the picture: nothing**, exactly as
 * `FramingPreview.tsx`: the platform plays the camera's own stream into the
 * element (`session.ts` §`showPreview`), and no pixel is drawn into a canvas,
 * encoded, stored or read by this program. It is not a kept frame (ADR 0029
 * D-11), and it is gone when the element is. The reads the code comes from are
 * `session.ts` §`readPairingCode`'s, which this component does not touch.
 *
 * It is here, in `camera/`, because it names a `<video>` element, and
 * `boundary.test.ts` holds every camera platform name inside this directory.
 *
 * ⚠️ **Mirrored**, as every front-camera preview a rider has used is: moving
 * the phone left moves its picture left. The code is read from the camera's
 * own pixels, which are not mirrored, so this changes what the rider sees and
 * nothing the reader reads.
 */

import { useEffect, useRef, type JSX } from 'react';

import type { CameraController } from './session';

export interface ScanViewfinderProps {
  readonly controller: CameraController;
}

export function ScanViewfinder({ controller }: ScanViewfinderProps): JSX.Element {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = video.current;
    if (element === null) {
      return undefined;
    }
    return controller.showPreview(element);
  }, [controller]);

  return (
    <figure className="oyl-scan-viewfinder" data-oyl-scan-viewfinder="">
      {/* Muted and inline: a picture to aim by, not a film to watch. */}
      <video
        ref={video}
        className="oyl-scan-viewfinder__video"
        muted
        playsInline
        aria-hidden="true"
      />
      <figcaption>
        What this tablet’s front camera sees. Hold the phone’s code inside it. Nothing here is kept,
        and it goes away once the code is read.
      </figcaption>
    </figure>
  );
}
