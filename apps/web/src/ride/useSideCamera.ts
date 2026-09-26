// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The tablet's side-camera pairing, as a ride screen reads it — #551.
 *
 * ⚠️ **Read from the port on every render, never held.** The pairing is held
 * by `camera/side-pairing-port.ts` §`currentSideCamera` so that it outlives
 * the Camera screen (#550); a ride screen that copied it into state would be
 * a second holder, and would go on showing a pairing the rider replaced on
 * the Camera screen. The subscription follows whichever pairing is current.
 */

import { useCallback, useSyncExternalStore } from 'react';

import type {
  SideCameraControlPort,
  SideControlState,
  SidePairingPort,
} from '../camera/side-pairing-port';

/** What a ride needs of the side camera: where it is, and a way to stop it. */
export interface SideCameraOnRideState {
  /** The state, or `undefined` with no pairing on this tablet. */
  readonly state: SideControlState | undefined;
  /** Tell the phone to stop filming — the Camera screen's *Stop filming*. */
  readonly stop: () => void;
}

const NOTHING = (): undefined => undefined;
const NO_SUBSCRIPTION = (): (() => void) => () => undefined;

export function useSideCamera(pairing: SidePairingPort | undefined): SideCameraOnRideState {
  const control: SideCameraControlPort | undefined = pairing?.currentSideCamera()?.control;
  const subscribe = useCallback(
    (listener: () => void) =>
      control === undefined ? NO_SUBSCRIPTION() : control.onSideControlChange(listener),
    [control],
  );
  const read = control === undefined ? NOTHING : () => control.sideControlState();
  const state = useSyncExternalStore(subscribe, read, read);
  const stop = useCallback(() => {
    control?.commandSideCamera('stop');
  }, [control]);
  return { state, stop };
}
