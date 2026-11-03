// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Devices screen's steering controller block (#1826): pair one, see that
 * it is connected, forget it.
 *
 * Its own heading, beneath the trainer and sensors, so the first Pair button
 * on the screen stays the trainer's (#942) and every control of the sensors'
 * block stays above that block's disclosure. The state is words, never only
 * colour (SC 1.4.1), as `SensorPairing.tsx` §"State is words" says.
 *
 * ⚠️ **The wording is proposed, for the owner to approve in #1826's PR.** The
 * protocol's name is not shown: the screen says "steering controller", which
 * needs no ADR 0009 R3 "works with" line.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';

import { connectionWords, NOT_PAIRED } from './SensorPairing';
import type { SteeringController, SteeringPairingFailure } from './steering-controller';

export const CONTROLLER_HEADING = 'Steering controller';

export const CONTROLLER_WHAT_IT_DOES =
  'Optional. A handlebar controller steers and throws in Delivery. It never changes the trainer’s resistance.';

export const PAIR_CONTROLLER = 'Pair a steering controller';

export const CONTROLLER_LOOKING =
  'Looking for a controller. Choose it in the list that opens, and press one of its buttons if it is asleep.';

export const CONTROLLER_DROPPED =
  'The controller disconnected, so it is no longer listed. Pair it again to steer with it.';

/** What each failure says. Every one ends with nothing paired, and says so. */
export const CONTROLLER_FAILURE_WORDS: Readonly<Record<SteeringPairingFailure, string>> = {
  'not-chosen': 'No controller was chosen, so nothing was paired.',
  'not-a-controller': 'That device is not a steering controller, so nothing was paired.',
  'no-answer':
    'The controller did not answer in time, so nothing was paired. Press one of its buttons to wake it, then try again.',
  refused: 'Pairing the controller was refused, so nothing was paired.',
};

/** Stable, so React does not unsubscribe and resubscribe on every render. */
function subscribeTo(controller: SteeringController): (listener: () => void) => () => void {
  return (listener) => controller.subscribe(listener);
}

export function ControllerPairing({
  controller,
}: {
  readonly controller: SteeringController;
}): JSX.Element {
  const subscribe = useMemo(() => subscribeTo(controller), [controller]);
  const state = useSyncExternalStore(subscribe, () => controller.state);
  const button = useRef<HTMLButtonElement>(null);
  const wasConnected = useRef(state.kind === 'connected');
  const connected = state.kind === 'connected';
  // Pair and Forget are different buttons, so the one the rider pressed is
  // unmounted and focus falls to <body>. Hand it to the button that replaced
  // it, only when it fell (never taking it from somewhere the rider moved to).
  useEffect(() => {
    if (wasConnected.current === connected) return;
    wasConnected.current = connected;
    if (document.activeElement === document.body) button.current?.focus();
  }, [connected]);
  return (
    <>
      <h2>{CONTROLLER_HEADING}</h2>
      <p>{CONTROLLER_WHAT_IT_DOES}</p>
      {state.kind === 'failed' ? (
        <StatusMessage tone="warning" label="Pairing" live>
          {CONTROLLER_FAILURE_WORDS[state.reason]}
        </StatusMessage>
      ) : null}
      {state.kind === 'none' && state.dropped ? (
        <StatusMessage tone="warning" label="Disconnected" live>
          {CONTROLLER_DROPPED}
        </StatusMessage>
      ) : null}
      {state.kind === 'pairing' ? (
        <StatusMessage tone="info" label="Pairing" live>
          {CONTROLLER_LOOKING}
        </StatusMessage>
      ) : null}
      <ul className="oyl-pairing tw:mt-0">
        <li className="oyl-pairing__row tw:bg-surface-raised tw:rounded-card">
          <div className="oyl-pairing__body">
            <h3 className="oyl-pairing__kind">Controller</h3>
            {state.kind === 'connected' ? (
              <ul className="oyl-sensor-list">
                <li>
                  <p className="oyl-pairing__state">
                    {state.name}: {connectionWords('connected')}
                  </p>
                  <Button
                    ref={button}
                    variant="secondary"
                    onClick={() => {
                      controller.forget();
                    }}
                  >
                    Forget {state.name}
                  </Button>
                </li>
              </ul>
            ) : (
              <>
                <p className="oyl-pairing__state">{NOT_PAIRED}</p>
                {/* Kept while pairing, so focus is not lost under the rider's
                    press; a second press while pairing does nothing. */}
                <Button
                  ref={button}
                  variant="secondary"
                  onClick={() => {
                    void controller.pair();
                  }}
                >
                  {PAIR_CONTROLLER}
                </Button>
              </>
            )}
          </div>
        </li>
      </ul>
    </>
  );
}
