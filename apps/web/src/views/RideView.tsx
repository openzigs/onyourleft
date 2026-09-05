// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The live ride screen ([#49](https://github.com/openzigs/onyourleft/issues/49)).
 *
 * A projection of {@link RideSnapshot} onto markup, and nothing else: the state
 * machine is `ride/controller.ts` and the reasons it is not in here are at the
 * top of that file.
 *
 * ## Pairing is a sequence of gestures, and the screen says so
 *
 * `requestDevice()` requires a user activation and cannot be called
 * programmatically, so a trainer plus a heart rate strap is **two clicks** and
 * there is no arrangement of this component that makes it one. Rather than
 * hiding that, the pairing block names each device separately and the note
 * under it says why. The trainer button comes first and asks for power, cadence
 * and speed together, because #49's revision block asks for the trainer's own
 * FTMS stream to be the path of least resistance rather than an expert option —
 * one connection of about three, instead of three.
 *
 * ## The clock and the unload guard are **not** here
 *
 * They are mounted by `AppShell` from `ride/RideSession.tsx`, above the router.
 * A recording belongs to the app rather than to the page being looked at, and a
 * hook owned by this component stops the moment an athlete taps Activities —
 * which stops the recorder checkpointing and lets the tab close without asking.
 * Do not move them back down here.
 *
 * ## Nothing here is disabled to say "not now"
 *
 * `design/Button.tsx` records the rule: a disabled control leaves the tab order,
 * so a keyboard user never reaches it and never hears why. Every control on
 * this screen is either rendered and operable, or not rendered with a
 * `StatusMessage` in its place.
 *
 * ## Stop takes two presses and that is the point
 *
 * #49: *"Stop is confirmed before it destroys a session; a test asserts a single
 * click cannot discard a ride."* The first press arms; the second, in a
 * different control with a different label, stops. The controller refuses
 * `confirmStop` unless the arm happened, so the guarantee does not rest on this
 * component rendering the two buttons in the right order.
 */

import type { JSX } from 'react';

import type { Watts } from '@onyourleft/domain';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { MetricGrid } from '../ride/MetricGrid';
import { TrainerPanel } from '../ride/TrainerPanel';
import type { PairingRole, RideController, RideSnapshot } from '../ride/controller';
import { useRideSnapshot } from '../ride/useRideController';
import { hrefFor, routeById } from '../shell/routes';

export interface RideViewProps {
  /**
   * The controller, built by whoever owns the transport and the store.
   *
   * `undefined` when this browser cannot pair at all — Safari, Firefox, plain
   * HTTP. The screen then explains rather than rendering controls that cannot
   * work, which is #48's first criterion applied to this route.
   */
  readonly controller: RideController | undefined;
}

/** The pairing buttons, in the order the revision block asks for. */
const PAIRING_STEPS: readonly { readonly role: PairingRole; readonly label: string }[] = [
  { role: 'trainer', label: 'Pair a smart trainer' },
  { role: 'heart-rate', label: 'Pair a heart rate strap' },
  { role: 'power-meter', label: 'Pair a power meter' },
  { role: 'speed-cadence', label: 'Pair a speed or cadence sensor' },
];

export function RideView({ controller }: RideViewProps): JSX.Element {
  if (controller === undefined) {
    return (
      <>
        <StatusMessage tone="danger" label="Not available">
          This browser cannot pair Bluetooth sensors, so a ride cannot be recorded here.
        </StatusMessage>
        <p>
          <a href={hrefFor(routeById('devices'))}>What this browser can do</a>
        </p>
      </>
    );
  }
  return <LiveRide controller={controller} />;
}

function LiveRide({ controller }: { readonly controller: RideController }): JSX.Element {
  const snapshot = useRideSnapshot(controller);

  return (
    <>
      <h2>Live</h2>
      <MetricGrid metrics={snapshot.metrics} />
      <p className="oyl-ride__clock">
        {formatDuration(snapshot.elapsedSeconds)} elapsed · {formatDuration(snapshot.movingSeconds)}{' '}
        moving · {snapshot.sampleCount} seconds recorded
      </p>

      <RideControls controller={controller} snapshot={snapshot} />
      <StorageNotice snapshot={snapshot} />

      <h2>Trainer</h2>
      <TrainerPanel
        trainer={snapshot.trainer}
        onRequestControl={() => {
          void controller.requestTrainerControl();
        }}
        onSetTargetPower={(target: Watts) => {
          void controller.setTargetPower(target);
        }}
        onClearTarget={() => {
          void controller.clearTargetPower();
        }}
      />

      <h2>Sensors</h2>
      <SensorList controller={controller} snapshot={snapshot} />
    </>
  );
}

function RideControls({
  controller,
  snapshot,
}: {
  readonly controller: RideController;
  readonly snapshot: RideSnapshot;
}): JSX.Element {
  if (snapshot.phase === 'idle') {
    return (
      <>
        <Button
          onClick={() => {
            void controller.start();
          }}
        >
          Start recording
        </Button>
        {snapshot.sensors.length === 0 ? (
          <StatusMessage tone="info" label="No sensors">
            A ride with no sensors records elapsed time and nothing else. Pair something below
            first.
          </StatusMessage>
        ) : null}
      </>
    );
  }

  if (snapshot.phase === 'stopped') {
    // ⚠️ Only when the last checkpoint landed. The final flush happens inside
    // `confirmStop`, and it can be refused — a full device, an aborted
    // transaction — which leaves the last seconds of the ride in this tab and
    // nowhere else. Gated on the phase alone, this claimed "every second of it
    // is saved … Closing the tab is safe now" directly above `StorageNotice`
    // saying the device had no room left. The rider believes the reassuring one
    // and closes the tab.
    if (snapshot.storage !== 'ok') {
      return (
        <StatusMessage tone="warning" label="Stopped" live>
          The ride is stopped, but the last checkpoint did not save, so its final seconds are only
          in this tab. Do not close it yet.
        </StatusMessage>
      );
    }
    // Deliberately not "see it in your activities". What is on disk is a
    // finished *recording* — #46's checkpointed session — and turning one into
    // a listed activity is #51's work, not this screen's. Saying otherwise
    // would send the rider to a page their ride is not on yet, which reads as a
    // lost ride rather than as an unbuilt feature.
    return (
      <StatusMessage tone="success" label="Saved" live>
        The ride is stopped, and every second of it is saved on this device. Closing the tab is safe
        now.
      </StatusMessage>
    );
  }

  return (
    <>
      {snapshot.phase === 'recording' ? (
        <Button
          variant="secondary"
          onClick={() => {
            void controller.pause();
          }}
        >
          Pause
        </Button>
      ) : (
        <Button
          onClick={() => {
            void controller.resume();
          }}
        >
          Resume
        </Button>
      )}

      {snapshot.stopArmed ? (
        <>
          <StatusMessage tone="warning" label="Confirm" live>
            Stopping ends this ride. It stays on this device either way.
          </StatusMessage>
          <Button
            onClick={() => {
              void controller.confirmStop();
            }}
          >
            Yes, stop the ride
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              controller.cancelStop();
            }}
          >
            Keep riding
          </Button>
        </>
      ) : (
        <Button
          variant="secondary"
          onClick={() => {
            controller.armStop();
          }}
        >
          Stop
        </Button>
      )}
    </>
  );
}

function StorageNotice({ snapshot }: { readonly snapshot: RideSnapshot }): JSX.Element | null {
  if (snapshot.storage === 'ok') {
    return null;
  }
  if (snapshot.storage === 'quota-exceeded') {
    return (
      <StatusMessage tone="danger" label="Device full" live>
        This device has no room left, so the ride is no longer being saved as it goes. The part
        already saved is safe and the rest is still in this tab — free some space, and do not close
        it.
      </StatusMessage>
    );
  }
  return (
    <StatusMessage tone="warning" label="Save failed" live>
      The last checkpoint did not save. The ride is still being recorded and the next checkpoint
      will try again.
    </StatusMessage>
  );
}

function SensorList({
  controller,
  snapshot,
}: {
  readonly controller: RideController;
  readonly snapshot: RideSnapshot;
}): JSX.Element {
  return (
    <>
      {snapshot.pairingError === undefined ? null : (
        <StatusMessage tone="warning" label="Pairing" live>
          {snapshot.pairingError}
        </StatusMessage>
      )}

      {snapshot.sensors.length === 0 ? (
        <p className="oyl-muted">Nothing is paired yet.</p>
      ) : (
        <ul className="oyl-sensor-list">
          {snapshot.sensors.map((sensor) => (
            <li key={sensor.id}>
              <span>
                {sensor.name} — {connectionWords(sensor.state)}
              </span>{' '}
              <Button
                variant="secondary"
                onClick={() => {
                  void controller.unpair(sensor.id);
                }}
              >
                Forget {sensor.name}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ul className="oyl-pairing-steps">
        {PAIRING_STEPS.map((step) => (
          <li key={step.role}>
            <Button
              variant="secondary"
              onClick={() => {
                void controller.pair(step.role);
              }}
            >
              {step.label}
            </Button>
          </li>
        ))}
      </ul>
      <p className="oyl-muted">
        Bluetooth asks for one device at a time, so each sensor is its own button and its own prompt
        — there is no way to pair them all at once. This browser will hold about{' '}
        {snapshot.connectionsRemaining} more connection
        {snapshot.connectionsRemaining === 1 ? '' : 's'}. A trainer usually reports power and
        cadence itself, so pairing one is often all you need.
      </p>
    </>
  );
}

/** What a connection state means to somebody on a bike. */
function connectionWords(state: string): string {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'unavailable':
      return 'unavailable — Bluetooth is off or blocked';
    default:
      return 'disconnected — reconnecting needs a tap, this browser cannot do it silently';
  }
}

/** `3725` → `1:02:05`. Hours only when there are some. */
export function formatDuration(totalSeconds: number): string {
  const whole = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0
    ? `${String(hours)}:${pad(minutes)}:${pad(secs)}`
    : `${String(minutes)}:${pad(secs)}`;
}
