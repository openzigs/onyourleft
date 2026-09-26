// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side camera on the Ride screen — #551: one line, and *Stop side camera*
 * while there is something to stop.
 *
 * ⚠️ **Not a live region.** The Ride screen's one region is
 * `RideAnnouncer.tsx`, and it is what says *"Side camera link lost"* — once,
 * when it happens. A second `role="status"` here would be the second voice
 * #445 removed. The line is for a rider who can see it; a lost link is a
 * `StatusMessage` so it carries the warning's own token pair and a label.
 *
 * ⚠️ **No picture of the phone's** (ADR 0033, the owner's ruling on #527):
 * everything here is `ride/side-camera.ts`, which reads words about a phone.
 */

import type { JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import type { SideControlState } from '../camera/side-pairing-port';

import {
  SIDE_CAMERA_LABEL,
  SIDE_CAMERA_ON_RIDE_TEXT,
  sideCameraLine,
  sideCameraOnRide,
  sideCameraStoppable,
} from './side-camera';

export interface SideCameraOnRideProps {
  readonly state: SideControlState | undefined;
  readonly onStop: () => void;
}

export function SideCameraOnRide({ state, onStop }: SideCameraOnRideProps): JSX.Element | null {
  const line = sideCameraOnRide(state);
  if (line === undefined) {
    return null;
  }
  return (
    <div className="oyl-ride__side-camera" data-oyl-side-camera={line}>
      {line === 'lost' ? (
        <StatusMessage tone="warning" label={SIDE_CAMERA_LABEL}>
          {SIDE_CAMERA_ON_RIDE_TEXT.lost}
        </StatusMessage>
      ) : (
        <p>{sideCameraLine(line)}</p>
      )}
      {sideCameraStoppable(state) ? (
        <Button variant="secondary" onClick={onStop}>
          Stop side camera
        </Button>
      ) : null}
    </div>
  );
}
