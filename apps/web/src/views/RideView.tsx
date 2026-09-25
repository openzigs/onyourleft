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

import { useEffect, useState, type JSX } from 'react';

import type { Watts } from '@onyourleft/domain';

import { Button } from '../design/Button';
import { formatDuration } from '../format';
import { StatusMessage } from '../design/StatusMessage';
import { MetricGrid } from '../ride/MetricGrid';
import { isReadable } from '../ride/metrics';
import { TrainerPanel } from '../ride/TrainerPanel';
import { WorkoutPanel } from '../ride/WorkoutPanel';
import type { WorkoutPort } from '../workouts/store-port';
import type { AnalysisPort } from '../analysis/store-port';
import type { RecoverableRide } from '../recording/recovery';
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
  /**
   * The saved-workout library (#14), or `undefined` where this browser has no
   * local store.
   *
   * Optional like every other port in this shell, and for the same reason: the
   * accessibility suite renders every route with none of them.
   */
  readonly workouts?: WorkoutPort | undefined;
  /**
   * Where the rider's threshold power is read from (#14).
   *
   * ⚠️ **The analysis port, deliberately, and not a widened workout one.**
   * `analysis/store-port.ts` says `getAthlete` is *"here and nowhere else in
   * `apps/web`"*, and a `WorkoutStore` that grew an athlete read to serve this
   * screen would be the second place — reachable from the screen that writes
   * targets to a trainer, which is the last one that should be able to read an
   * athlete row.
   *
   * ⚠️ And a threshold that is absent stays absent. A workout's targets are
   * shares of it, so a substituted default would put a made-up number on a
   * trainer; `analysis/thresholds.ts` is the single place in this program that
   * supplies one, and this is not it.
   */
  readonly analysis?: AnalysisPort | undefined;
}

/** The pairing buttons, in the order the revision block asks for. */
const PAIRING_STEPS: readonly { readonly role: PairingRole; readonly label: string }[] = [
  { role: 'trainer', label: 'Pair a smart trainer' },
  { role: 'heart-rate', label: 'Pair a heart rate strap' },
  { role: 'power-meter', label: 'Pair a power meter' },
  { role: 'speed-cadence', label: 'Pair a speed or cadence sensor' },
];

export function RideView({ controller, workouts, analysis }: RideViewProps): JSX.Element {
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
  return <LiveRide controller={controller} workouts={workouts} analysis={analysis} />;
}

function LiveRide({
  controller,
  workouts,
  analysis,
}: {
  readonly controller: RideController;
  readonly workouts: WorkoutPort | undefined;
  readonly analysis: AnalysisPort | undefined;
}): JSX.Element {
  const snapshot = useRideSnapshot(controller);
  const thresholdPower = useThresholdPower(analysis);

  // ⚠️ On mount, because #212's whole point is that a rider who lost a tab is
  // *told* — the recording was always on the device and nothing looked for it.
  useEffect(() => {
    void controller.refreshRecoverable();
  }, [controller]);

  return (
    // ⚠️ **Three groups, laid out by `theme.css` §`.oyl-ride` — #422.** This was
    // one flat column under a prose reading measure, and on the owner's tablet
    // in landscape it was cut off at the ride controls: `WorkoutPanel` was
    // below the fold, so structured workouts were invisible. A rider who set
    // out to test whether ERG releases cleanly (#372) started a plain recording
    // instead, and the wire showed Request Control, 103 seconds of nothing, and
    // Stop. The groups are what let a wide screen put the trainer BESIDE the
    // live metrics instead of under them; `browser/rideview.browser.spec.ts`
    // measures that every control in all three is on screen with no scrolling.
    //
    // The ORDER in the document is unchanged — live, trainer, sensors — so a
    // screen reader and the tab key meet everything in the order they did.
    <div className="oyl-ride">
      <div className="oyl-ride__group oyl-ride__group--live">
        <h2>Live</h2>
        <MetricGrid metrics={snapshot.metrics} />

        {/*
          ⚠️ **The controls come BEFORE the clock, and until #436's review they
          came after it.** A reviewer who remembers the clock sitting between
          the metrics and Pause / Stop is reading the old file. The clock is
          one line on a wide column and two on a narrow one, in a font this
          repository does not choose, so everything beneath it moved with it —
          and what was beneath it was the one pair of controls that ends a
          recording. Measured in the pinned Chromium at 1280×720, which is
          about what a landscape tablet's WebView is left once the system bars
          are taken off the display's 800: Pause / Stop ended at y = 737, below
          the fold. `theme.css` §`.oyl-ride` has the table. Nothing focusable
          moved relative to anything else focusable, so the tab order is what
          it was.
        */}
        <RideControls controller={controller} snapshot={snapshot} />
        <p className="oyl-ride__clock">
          {formatDuration(snapshot.elapsedSeconds)} elapsed ·{' '}
          {formatDuration(snapshot.movingSeconds)} moving · {snapshot.sampleCount} seconds recorded
        </p>
        <StorageNotice snapshot={snapshot} />
        <RecoveryOffer controller={controller} snapshot={snapshot} />
      </div>

      <div className="oyl-ride__group oyl-ride__group--trainer">
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
        <WorkoutPanel
          trainer={snapshot.trainer}
          workout={snapshot.workout}
          // #400: the live power, or nothing — a stale or unpaired meter is
          // `undefined`, which silences the tone rather than sounding a floor.
          power={livePower(snapshot)}
          port={workouts}
          thresholdPower={thresholdPower}
          onStart={(record) => {
            // ⚠️ Guarded rather than defaulted. The panel does not render a Start
            // control without a threshold, so this is unreachable through the UI
            // — and a `?? watts(0)` here would make every target in the workout
            // zero watts, which is a silent wrong number reaching a trainer
            // rather than a refusal a rider can see.
            if (thresholdPower === undefined) {
              return;
            }
            controller.startWorkout(record, thresholdPower);
          }}
          onEnd={() => {
            controller.endWorkout();
          }}
        />
      </div>

      <div className="oyl-ride__group oyl-ride__group--sensors">
        <h2>Sensors</h2>
        <SensorList controller={controller} snapshot={snapshot} />
      </div>
    </div>
  );
}

/**
 * Read the athlete's threshold once, for the workout panel.
 *
 * `undefined` while it is being read and `undefined` when it is not set, and
 * the two are deliberately the same value: the panel's answer to both is the
 * same sentence, and a screen that distinguished "loading" from "not set" would
 * be offering a rider a state they cannot act on.
 */
function useThresholdPower(analysis: AnalysisPort | undefined): Watts | undefined {
  const [threshold, setThreshold] = useState<Watts | undefined>(undefined);
  useEffect(() => {
    if (analysis === undefined) {
      return;
    }
    let live = true;
    void analysis.store
      .getAthlete(analysis.athleteId)
      .then((athlete) => {
        if (live) setThreshold(athlete?.thresholdPower);
      })
      .catch(() => {
        // A store that cannot be read leaves the threshold absent, which the
        // panel already explains. There is nothing else this screen can say
        // that a rider could act on.
      });
    return () => {
      live = false;
    };
  }, [analysis]);
  return threshold;
}

/**
 * The rides this device is still holding — #212.
 *
 * ⚠️ **Renders nothing when there is nothing**, which is the normal case and
 * the reason this is a section rather than a permanent panel: a heading that
 * says "no interrupted rides" on every visit trains a rider to stop reading the
 * one place that will ever matter to them.
 *
 * The two kinds are offered different controls — `recording/recovery.ts` says
 * why a ride the rider already stopped is not offered "continue".
 */
/**
 * What one leftover recording is, in a sentence.
 *
 * ⚠️ **The third case is the one review found missing.** A finished ride whose
 * checkpoint survived because the *delete* failed is already in the athlete's
 * activities; calling it "could not be saved" and offering Save writes a
 * duplicate. It is offered discard alone, and the wording says the ride is
 * safe so a rider is not talked into rescuing something that needs no rescue.
 */
function offerText(ride: RecoverableRide): string {
  if (ride.kind === 'interrupted') {
    return `An interrupted ride, up to ${ride.spanned} long.`;
  }
  if (ride.kind === 'already-saved') {
    return `A finished ride, up to ${ride.spanned} long. It is already in your activities — this is the working copy, and discarding it changes nothing about the ride.`;
  }
  return `A finished ride, up to ${ride.spanned} long, that could not be saved.`;
}

function RecoveryOffer({
  controller,
  snapshot,
}: {
  readonly controller: RideController;
  readonly snapshot: RideSnapshot;
}): JSX.Element | null {
  if (snapshot.recoverable.length === 0) {
    return null;
  }
  return (
    <section>
      <h3>Rides still on this device</h3>
      <p>
        A ride is written to this device as it happens, so a closed tab does not lose it. These are
        the ones that were never added to your activities.
      </p>
      <ul>
        {snapshot.recoverable.map((ride) => (
          <li key={ride.id}>
            <p>{offerText(ride)}</p>
            {ride.canContinue ? (
              <Button
                onClick={() => {
                  void controller.continueRecovered(ride.id);
                }}
              >
                Continue this ride
              </Button>
            ) : null}
            {ride.alreadySaved ? null : (
              <Button
                onClick={() => {
                  void controller.saveRecovered(ride.id);
                }}
              >
                Save this ride
              </Button>
            )}
            <Button
              onClick={() => {
                void controller.discardRecovered(ride.id);
              }}
            >
              Discard this ride
            </Button>
          </li>
        ))}
      </ul>
    </section>
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
    // ⚠️ This block used to say "every second of it is saved on this device"
    // and nothing else, with a comment attributing the missing half to #51.
    // That attribution was wrong — #51 is file import and export — and the
    // effect was that a rider was told their ride was safe while it existed
    // only as a *checkpoint*: absent from their activities, and offered back on
    // next open as an interrupted ride. `recording/finish.ts` is the step that
    // was missing; these branches are what the rider is now told about it.
    if (snapshot.saveState === 'saving') {
      return (
        <StatusMessage tone="info" label="Stopped" live>
          The ride is stopped and every second of it is on this device. Adding it to your
          activities…
        </StatusMessage>
      );
    }
    if (snapshot.saveState === 'failed') {
      // The ride is NOT lost, and saying so first is the point: the checkpoint
      // is deliberately left in place when a save fails, so the recovery path
      // still has it. A message that led with the failure would read as a lost
      // ride.
      return (
        <StatusMessage tone="warning" label="Stopped" live>
          The ride is stopped and every second of it is on this device, but it could not be added to
          your activities{snapshot.saveError === undefined ? '' : `: ${snapshot.saveError}`}. It is
          still here and will be offered back next time you open On Your Left.
        </StatusMessage>
      );
    }
    if (snapshot.saveState === 'empty') {
      return (
        <StatusMessage tone="info" label="Stopped" live>
          Nothing was recorded, so there is no ride to save. Pair a sensor and press Start to record
          one.
        </StatusMessage>
      );
    }
    if (snapshot.saveState === 'saved') {
      // ⚠️ The leftover case is still a SUCCESS: the ride is in the athlete's
      // activities and that is the sentence that matters. What it adds is the
      // one thing a rider would otherwise misread — the working copy will be
      // offered back on the next visit, and it is a copy rather than a rescue.
      return snapshot.leftover ? (
        <StatusMessage tone="warning" label="Saved, with a working copy left behind" live>
          The ride is stopped and saved to your activities. The working copy on this device could
          not be removed, so it will be offered back next time — discarding it changes nothing about
          the saved ride.
        </StatusMessage>
      ) : (
        <StatusMessage tone="success" label="Saved" live>
          The ride is stopped and saved to your activities. Closing the tab is safe now.
        </StatusMessage>
      );
    }
    // `unavailable` — this build has no activity store, which is the
    // accessibility suite's case. The old wording, which is still true: the
    // recording is on the device, and nothing claims more than that.
    return (
      <StatusMessage tone="success" label="Saved" live>
        The ride is stopped, and every second of it is saved on this device. Closing the tab is safe
        now.
      </StatusMessage>
    );
  }

  return (
    <>
      {snapshot.notificationNotice === undefined ? null : (
        // #526: set once, on the ride where the rider refused the permission.
        <StatusMessage tone="info" label="No notification" live>
          {snapshot.notificationNotice}
        </StatusMessage>
      )}
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

/**
 * The power a rider is producing right now, or `undefined` — #400.
 *
 * ⚠️ `undefined` for a stale reading as well as a missing one, on
 * `ride/metrics.ts`'s own rule: a stale state carries no value at all, because
 * the last number a sensor sent is not what the rider is doing now.
 */
function livePower(snapshot: RideSnapshot): number | undefined {
  const state = snapshot.metrics.find((metric) => metric.id === 'power')?.state;
  return state !== undefined && isReadable(state) ? state.value : undefined;
}
