// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The live ride screen ([#49](https://github.com/openzigs/onyourleft/issues/49)).
 *
 * A projection of {@link RideSnapshot} onto markup, and nothing else: the state
 * machine is `ride/controller.ts` and the reasons it is not in here are at the
 * top of that file.
 *
 * ## Pairing is on Devices, and this screen says what is connected (#659)
 *
 * ⚠️ **The pairing buttons used to be here**, and a reviewer who remembers
 * them is reading the old file. The owner ruled (2026-09-27) that pairing
 * lives on the Devices screen, because Home and the More tab both sent a new
 * rider there and it had no control. The block moved to
 * `ride/SensorPairing.tsx` §`PairingPanel`, unchanged in what it drives: the
 * same controller, the same `pair(role)`, one gesture per device. This screen
 * renders §`ConnectedSensors` — each device and its state in words, and a link
 * to Devices. There is no quick-pair button here, on purpose: the controller is
 * above the router, so Devices and back is one tap with the connection intact,
 * and a second set of pairing buttons is a second pairing surface.
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

import { useEffect, useRef, useState, type JSX } from 'react';

import type { Watts } from '@onyourleft/domain';

import { Button } from '../design/Button';
import { formatDuration } from '../format';
import { deviceStorage, readAnnouncementPreference } from '../game/hud/announce-preference';
import { StatusMessage } from '../design/StatusMessage';
import { MetricGrid } from '../ride/MetricGrid';
import { isReadable } from '../ride/metrics';
import { TrainerPanel } from '../ride/TrainerPanel';
import { WorkoutPanel } from '../ride/WorkoutPanel';
import type { WorkoutPort } from '../workouts/store-port';
import type { AnalysisPort } from '../analysis/store-port';
import type { RecoverableRide } from '../recording/recovery';
import {
  canStartNewRide,
  KEEP_SCREEN_ON_LABEL,
  rideInProgress,
  RIDE_MAY_STOP_WITH_SCREEN_OFF,
  type RideController,
  type RideSnapshot,
} from '../ride/controller';
import { ConnectedSensors } from '../ride/SensorPairing';
import { useRideSnapshot } from '../ride/useRideController';
import { SideCameraOnRide } from '../ride/SideCameraOnRide';
import { useSideCamera } from '../ride/useSideCamera';
import type { SidePairingPort } from '../camera/side-pairing-port';
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
  /**
   * The tablet's side-camera pairing — #551. Its state is on this screen as
   * one line, its link going is said once, and it can be stopped from here.
   * `undefined` where there is no WebRTC, which is also no pairing.
   *
   * ⚠️ **Optional, so a shell that stops passing it is green in
   * `check:wiring`** (§Limits' third entry).
   * `ride/side-camera-ride-screen.a11y.test.tsx` drives it through the real
   * shell, which is what pins `AppShell`'s half.
   */
  readonly sidePairing?: SidePairingPort | undefined;
}

export function RideView({
  controller,
  workouts,
  analysis,
  sidePairing,
}: RideViewProps): JSX.Element {
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
  return (
    <LiveRide
      controller={controller}
      workouts={workouts}
      analysis={analysis}
      sidePairing={sidePairing}
    />
  );
}

function LiveRide({
  controller,
  workouts,
  analysis,
  sidePairing,
}: {
  readonly controller: RideController;
  readonly workouts: WorkoutPort | undefined;
  readonly analysis: AnalysisPort | undefined;
  readonly sidePairing: SidePairingPort | undefined;
}): JSX.Element {
  const snapshot = useRideSnapshot(controller);
  const thresholdPower = useThresholdPower(analysis);
  const sideCamera = useSideCamera(sidePairing);
  // #655: which of two voices answers a held *Set* — the ERG form's, or the
  // ride's one region. ⚠️ Read ONCE, here, and the same object handed to
  // both (#740): until then `RideAnnouncer` read it again for itself, and the
  // two agreed only because both read this device's storage in one mount pass.
  const [announcements] = useState(() => readAnnouncementPreference(deviceStorage()));

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
        <div className="oyl-ride__heading">
          <h2>Live</h2>
          {snapshot.keepAliveFailed && rideInProgress(snapshot.phase) ? (
            // #647: the platform would not keep this ride alive, so it may be
            // stopped with the screen off. BESIDE the heading rather than under
            // Pause / Stop — #693's review measured the notice there ending
            // 15.7 px above the fold on the owner's tablet in the shell and
            // 3.7 px at 1024×720, and above them it put Pause under the fold;
            // `theme.css` §`.oyl-ride__heading` has the table. Never put away:
            // it is a safety sentence (the owner's ruling on #654's
            // re-review), so it is the whole message and there is no
            // disclosure. Not `live`: the ride's one region says it
            // (`RideAnnouncer.tsx`). Gone the moment a later ask succeeds.
            <StatusMessage tone="warning" label={KEEP_SCREEN_ON_LABEL}>
              {RIDE_MAY_STOP_WITH_SCREEN_OFF}
            </StatusMessage>
          ) : null}
        </div>
        {/*
          ⚠️ **The controls come FIRST — before the metrics since #692, and
          before the clock since #436's review.** A reviewer who remembers
          *Pause* / *Stop* under the four metric cards is reading the old file.

          The rule is one sentence: nothing whose height changes during a ride
          sits above a ride control in its column. The clock is one line on a
          wide column and two on a narrow one (#436). A standing notice is
          three to five lines: #526's *No notification* stood ABOVE *Pause* and
          put it 77.9 px under the fold on the owner's tablet in the Android
          shell; #551's side camera and a storage notice stood after the clock,
          where *Stop side camera* and *Device full* themselves ran 150 px and
          164 px under that fold, and upright each came off the workout's
          *Ride*. Now the metric cards are what a notice moves — readings, not
          controls. With any one notice they are still on the screen in the
          pinned Chromium (2.1 px above that fold at the least, on a Mac); with
          every notice this screen can stand at once they are not, and neither
          is the last notice. `rideview.browser.spec.ts` §"#692" publishes both,
          and `theme.css` §`.oyl-ride` has the table.

          The side camera comes straight after the controls because it is one:
          *Stop side camera*. The notices come after it, then the numbers.
          Nothing focusable changed its order relative to anything else
          focusable, so the tab order is what it was; a screen reader now meets
          Pause / Stop before the numbers, as it met the keep-the-screen-on
          notice before them since #647.
        */}
        <RideControls controller={controller} snapshot={snapshot} />
        <SideCameraOnRide state={sideCamera.state} onStop={sideCamera.stop} />
        {snapshot.notificationNotice !== undefined && rideInProgress(snapshot.phase) ? (
          // #526: set once, on the ride where the rider refused the permission,
          // and it stands for the rest of that ride. ⚠️ AFTER every ride
          // control since #692 — the side camera's *Stop side camera* too —
          // and a reviewer who remembers it above *Pause*, inside
          // `RideControls`, is reading the old file: there, on the owner's
          // tablet in the Android shell, its 156 px put *Pause* / *Stop*
          // 77.9 px UNDER the fold — the controls that end a recording, off
          // the screen, on the one platform that shows this sentence.
          // `rideInProgress` is the branch of `RideControls` it rendered in.
          <StatusMessage tone="info" label="No notification" live>
            {snapshot.notificationNotice}
          </StatusMessage>
        ) : null}
        <StorageNotice snapshot={snapshot} />
        <MetricGrid metrics={snapshot.metrics} />
        <p className="oyl-ride__clock">
          {formatDuration(snapshot.elapsedSeconds)} elapsed ·{' '}
          {formatDuration(snapshot.movingSeconds)} moving · {snapshot.sampleCount} seconds recorded
        </p>
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
          // #605: while a workout is loaded it owns the target, finished or not
          // — `controller.ts` §`setTargetPower` refuses on exactly this.
          workoutOwnsTarget={snapshot.workout !== undefined}
          // #655: which voice answers a held *Set* — the form's, or the
          // ride's one region. Read where `RideAnnouncer` reads it.
          announcementsOn={announcements.enabled}
        />
        <WorkoutPanel
          trainer={snapshot.trainer}
          workout={snapshot.workout}
          // #400: the live power, or nothing — a stale or unpaired meter is
          // `undefined`, which silences the tone rather than sounding a floor.
          power={livePower(snapshot)}
          port={workouts}
          thresholdPower={thresholdPower}
          // #551: the ride's one region says the side camera's link going.
          sideCamera={sideCamera.state}
          // #647: …and, once, that the ride may stop if the screen goes off.
          keepAliveFailed={snapshot.keepAliveFailed}
          // #740: the choice read above, so the region and the ERG form agree.
          announcementPreference={announcements}
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
        <ConnectedSensors snapshot={snapshot} />
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
                variant="secondary"
                onClick={() => {
                  void controller.continueRecovered(ride.id);
                }}
              >
                Continue this ride
              </Button>
            ) : null}
            {ride.alreadySaved ? null : (
              <Button
                variant="secondary"
                onClick={() => {
                  void controller.saveRecovered(ride.id);
                }}
              >
                Save this ride
              </Button>
            )}
            <Button
              variant="secondary"
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
  // #548, WCAG 2.2 SC 2.4.3: pressing *Start a new ride* unmounts it, and
  // without somewhere to go focus falls to `<body>` — a keyboard or TalkBack
  // rider loses their place on the screen they are about to ride from. It is
  // handed to *Start recording*, the control that replaces it, once the idle
  // screen has actually rendered, whichever of the render and the controller's
  // answer lands first.
  const startRecording = useRef<HTMLButtonElement>(null);
  const focusStartWhenIdle = useRef(false);
  // A press the controller refused. Unreachable from the button while the rule
  // it renders under is the controller's own, and said anyway: a control that
  // does nothing when pressed reads as a broken one.
  const [newRideRefused, setNewRideRefused] = useState(false);
  // A refusal describes the moment it happened; once the ride's state moves
  // on (the save lands, a new ride starts) it is stale and must not sit beside
  // "Saved" (#565's second review).
  useEffect(() => {
    setNewRideRefused(false);
  }, [snapshot.phase, snapshot.saveState, snapshot.stopping]);
  useEffect(() => {
    if (snapshot.phase === 'idle' && focusStartWhenIdle.current) {
      focusStartWhenIdle.current = false;
      startRecording.current?.focus();
    }
  }, [snapshot.phase]);

  if (snapshot.phase === 'idle') {
    return (
      <>
        <Button
          ref={startRecording}
          size="ride"
          onClick={() => {
            void controller.start();
          }}
        >
          Start recording
        </Button>
        {snapshot.sensors.length === 0 ? (
          <StatusMessage tone="info" label="No sensors">
            A ride with no sensors records elapsed time and nothing else.{' '}
            <a href={hrefFor(routeById('devices'))}>Pair something on Devices</a> first.
          </StatusMessage>
        ) : null}
      </>
    );
  }

  if (snapshot.phase === 'stopped') {
    // #548: until this existed a stopped ride was a dead end. `RideSession` is
    // mounted above the router for the app's lifetime, so neither navigating
    // away nor anything else reset the controller, and in the Android shell a
    // rider had to kill the app to record a second ride. Offered after the
    // notice, and only where `canStartNewRide` says the stopped ride is safe to
    // put away — never while it exists only in this tab, so the warnings above
    // are never followed by a control that would discard what they protect.
    return (
      <>
        <StoppedNotice snapshot={snapshot} />
        {canStartNewRide(snapshot) ? (
          <Button
            onClick={() => {
              setNewRideRefused(false);
              focusStartWhenIdle.current = true;
              void controller.startNewRide().then((started) => {
                if (!started) {
                  focusStartWhenIdle.current = false;
                  setNewRideRefused(true);
                }
              });
            }}
          >
            Start a new ride
          </Button>
        ) : null}
        {newRideRefused ? (
          <StatusMessage tone="warning" label="Not started" live>
            A new ride could not be started yet, because the ride that stopped is not finished
            saving. It is still on this screen; try again once it says it is saved.
          </StatusMessage>
        ) : null}
      </>
    );
  }

  return (
    <>
      {/*
        #669: the ride-time controls side by side are a ROW with a gap, so two
        of them are never closer than 8 px (Android's 8 dp between targets).
        Until then Pause and Stop — and Yes, stop the ride and Keep riding —
        were inline buttons with nothing between their boxes: 0 px, measured
        by `browser/ride-targets.browser.spec.ts`. A wrapper rather than a
        margin, so a row that wraps on a narrow phone keeps the gap between
        its lines too. The document order is unchanged.
      */}
      <div className="oyl-ride__actions">
        {snapshot.phase === 'recording' ? (
          <Button
            variant="secondary"
            size="ride"
            onClick={() => {
              void controller.pause();
            }}
          >
            Pause
          </Button>
        ) : (
          // #668: the ride screen's one primary is the step that moves the
          // ride on. While a stop is armed that is the confirmation, so a
          // paused rider's Resume steps down beside it rather than being a
          // second heaviest control.
          <Button
            variant={snapshot.stopArmed ? 'secondary' : 'primary'}
            size="ride"
            onClick={() => {
              void controller.resume();
            }}
          >
            Resume
          </Button>
        )}
        {snapshot.stopArmed ? null : (
          <Button
            variant="secondary"
            size="ride"
            onClick={() => {
              controller.armStop();
            }}
          >
            Stop
          </Button>
        )}
      </div>

      {snapshot.stopArmed ? (
        <>
          <StatusMessage tone="warning" label="Confirm" live>
            Stopping ends this ride. It stays on this device either way.
          </StatusMessage>
          <div className="oyl-ride__actions">
            <Button
              size="ride"
              onClick={() => {
                void controller.confirmStop();
              }}
            >
              Yes, stop the ride
            </Button>
            <Button
              variant="secondary"
              size="ride"
              onClick={() => {
                controller.cancelStop();
              }}
            >
              Keep riding
            </Button>
          </div>
        </>
      ) : null}
    </>
  );
}

/** What a stopped ride ends on — where it got to, and whether the tab is safe to close. */
function StoppedNotice({ snapshot }: { readonly snapshot: RideSnapshot }): JSX.Element {
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
        The ride is stopped, but the last checkpoint did not save, so its final seconds are only in
        this tab. Do not close it yet.
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
  //
  // #565's review: the phase says `stopped` before the trainer is released,
  // the final checkpoint flushed and the save begun, and all that time
  // `saveState` can still say the PREVIOUS ride's `unavailable` — whose
  // sentence below is "Closing the tab is safe now". Not yet it is not.
  if (snapshot.stopping) {
    return (
      <StatusMessage tone="info" label="Stopping" live>
        The ride is stopped. Letting the trainer go and writing its last seconds to this device… Do
        not close the tab yet.
      </StatusMessage>
    );
  }
  if (snapshot.saveState === 'saving') {
    return (
      <StatusMessage tone="info" label="Stopped" live>
        The ride is stopped and every second of it is on this device. Adding it to your activities…
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
        Nothing was recorded, so there is no ride to save. Pair a sensor, then start a new ride to
        record one.
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
        The ride is stopped and saved to your activities. The working copy on this device could not
        be removed, so it will be offered back next time — discarding it changes nothing about the
        saved ride.
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
