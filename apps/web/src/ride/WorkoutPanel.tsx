// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Riding a saved workout, on the ride screen — #14's last piece.
 *
 * A panel of its own rather than a section of `TrainerPanel.tsx`, because the
 * two answer different questions. That one is the **manual** setpoint: a rider
 * choosing a number and this app writing it. This one hands the setpoint over
 * to a plan, and while it is running the rider is not choosing the number at
 * all — so a screen that mixed them would be offering two things that write to
 * the same control point without saying which is in charge.
 *
 * ## What it will not offer
 *
 * ⚠️ **No Start button until control has been granted.** `startWorkout` refuses
 * without it — a trainer that has not granted control answers every setpoint
 * `0x05 Control Not Permitted`, so a workout started there would run its clock
 * and control nothing, which is #14's revision block's named silent failure.
 * The panel says so in a sentence instead of rendering a control that would
 * fail, which is `TrainerPanel.tsx`'s rule about disabled buttons applied here.
 *
 * ## What is announced, and when — #394, #445
 *
 * ⚠️ **Through ONE region since #445, and this panel is where it lives**
 * (`RideAnnouncer.tsx`). A reviewer who remembers a `live` workout fault and
 * a `WorkoutAnnouncer` here writing the block change straight into its region
 * is reading the old file: those were two voices beside the announcer's
 * throttle, and the region also carries the trainer's *Control lost* and *Not
 * released* now, which `TrainerPanel` used to speak itself.
 *
 * ⚠️ **Why here and not in `RideView`**: the interval sound (#400) plays on
 * the sentence it belongs to, and the sounds are this panel's. And **why it
 * is rendered in every state, first, in a fragment**: *Control lost* can make
 * the trainer uncontrollable, which is the state this panel used to render
 * nothing in — and a region that unmounted or moved to a different parent in
 * that instant would forget what it had seen and say nothing. Being the first
 * child of a fragment is what keeps it the same element whichever branch
 * below it renders.
 *
 * The fault stays on the screen, as a plain `StatusMessage`, for a rider who
 * can see it; only its announcement moved. A library that could not be read
 * stays `live`: it is not something that happens while riding.
 *
 * ⚠️ **Nothing here pre-empts by politeness.** TalkBack treats every region
 * alike (assertive on one Android, polite on another — Roselli, 2026-01-14),
 * so ordering is decided before a sentence is written, not by the role it is
 * written into.
 *
 * ## The sounds — #400
 *
 * For a rider who turned them on (off by default): a tone tracking power
 * against the target the trainer ACKNOWLEDGED (`holdingWatts`, never a target
 * only asked for), and two short rising notes as a block changes — played with
 * the *"Now: …"* sentence above, so the sound is never the only carrier. The
 * audio context is resumed inside the rider's press on a workout's *Ride*
 * button and nowhere earlier; a dropped power reading, a paused workout and
 * the end of the workout all silence the tone. `game/audio-cues.ts` holds every
 * one of those rules; this panel only feeds it.
 *
 * ## Colour carries nothing
 *
 * The status is a word and the block is a sentence, for `AnalysisView.tsx`'s
 * reason. A progress bar may sit beside them later; it may not replace them.
 */

import { useEffect, useRef, useState, type JSX } from 'react';

import type { Watts } from '@onyourleft/domain';
import type { WorkoutRecord } from '@onyourleft/store';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { deviceStorage, type PreferenceStorage } from '../game/hud/announce-preference';
import { RideCues } from '../game/audio-cues';
import type { CueOutput } from '../game/audio-port';
import { readCuePreference, writeCuePreference, type CuePreference } from '../game/cue-preference';
import { SoundControls } from '../game/SoundControls';
import { sharedCueOutput } from '../game/web-audio';
import { durationText, workoutRow } from '../workouts/library';

import { RideAnnouncer } from './RideAnnouncer';
import { WORKOUT_LIST_LIMIT, type WorkoutPort } from '../workouts/store-port';

import type { RideWorkoutSnapshot, TrainerSnapshot } from './controller';

/** What each player status says to a rider. */
const STATUS_TEXT: Readonly<Record<RideWorkoutSnapshot['status'], string>> = {
  idle: 'Ready',
  running: 'Riding',
  // ⚠️ Not "Stopped". A paused workout keeps every offset and resumes where it
  // left off, and telling a rider it stopped would invite them to restart a
  // session they have not lost.
  paused: 'Paused — it will pick up where you left off',
  finished: 'Finished',
};

export interface WorkoutPanelProps {
  readonly trainer: TrainerSnapshot;
  readonly workout: RideWorkoutSnapshot | undefined;
  /** `undefined` where this browser has no local store. */
  readonly port?: WorkoutPort | undefined;
  /** The rider's threshold, or `undefined` when they have not set one. */
  readonly thresholdPower?: Watts | undefined;
  readonly onStart: (record: WorkoutRecord) => void;
  readonly onEnd: () => void;
  /**
   * Where the rider's announcement choice is read from (#397, #398) — this
   * DEVICE's storage unless a test hands in a double. The sound choice (#400)
   * is read from the same place.
   */
  readonly announcements?: PreferenceStorage | undefined;
  /**
   * The rider's live power in watts, or `undefined` when the reading is not
   * live — a dropped meter, none paired. #400's tone reads it, and an
   * `undefined` here SILENCES the tone rather than sounding a floor.
   */
  readonly power?: number | undefined;
  /** Where the sounds go (#400); the platform's Web Audio unless a test hands in a double. */
  readonly sounds?: CueOutput | undefined;
  /** The announcer's clock, in seconds (#445); the wall clock unless a test hands one in. */
  readonly announcerClock?: (() => number) | undefined;
}

export function WorkoutPanel({
  trainer,
  workout,
  port,
  thresholdPower,
  onStart,
  onEnd,
  announcements,
  power,
  sounds,
  announcerClock,
}: WorkoutPanelProps): JSX.Element {
  const [saved, setSaved] = useState<readonly WorkoutRecord[]>([]);
  const [loadFault, setLoadFault] = useState<string | undefined>(undefined);
  const storage = announcements ?? deviceStorage();
  const [sound, setSound] = useState<CuePreference>(() => readCuePreference(storage));
  /** This panel's sounds — made once, fed on every render. @see game/audio-cues.ts */
  const cuesRef = useRef<RideCues | undefined>(undefined);
  cuesRef.current ??= new RideCues(sounds ?? sharedCueOutput(), sound);
  const cues = cuesRef.current;

  // ⚠️ #400's review: the workout outlives this panel — `RideSession` is above
  // the router — so a rider who leaves the Ride screen mid-workout and comes
  // back mounts a FRESH `RideCues`, which used to stay silent for the rest of
  // the workout until they touched a sound control. `rejoin` carries on with a
  // context an earlier press left running, and resumes nothing: a mount is not
  // a gesture. Where the platform suspended the audio meanwhile, the tone stays
  // silent and *Mute sounds* and the volume — shown whenever a workout is — are
  // the press that brings it back (validation 0003, I12). Before the tone
  // effect, so the first render after a return already sounds.
  useEffect(() => {
    cues.rejoin();
  }, [cues]);

  // The tone: power against the ACKNOWLEDGED target, while the workout runs.
  // Anything else — paused, finished, no workout, a dropped reading — is
  // silence, which `RideCues.tone` decides.
  const running = workout?.status === 'running';
  const holding = workout?.holdingWatts;
  useEffect(() => {
    cues.tone({ watts: power, target: running ? holding : undefined });
  }, [cues, power, running, holding]);
  // ⚠️ Leaving the screen ends the sounds: a tone left playing after the panel
  // has gone is #372's shape — a trainer holding the last gradient — in a new
  // place. (The END of a workout needs no line of its own: the effect above
  // then has no running workout and silences the tone.)
  useEffect(() => () => cues.end(), [cues]);

  function changeSound(next: CuePreference): void {
    setSound(next);
    writeCuePreference(storage, next);
    cues.set(next);
    // Inside the press: resumes a context the platform suspended.
    cues.begin();
  }

  useEffect(() => {
    if (port === undefined) {
      return;
    }
    let live = true;
    void port.store
      .listWorkouts(port.athleteId, WORKOUT_LIST_LIMIT)
      .then((list) => {
        if (live) setSaved(list);
      })
      .catch(() => {
        if (live) {
          setLoadFault(
            'Your saved workouts could not be read on this device. You can still ride without ' +
              'one.',
          );
        }
      });
    return () => {
      live = false;
    };
  }, [port]);

  // #445: the ride's one region, in every state and always first. @see the
  // module note §"What is announced, and when".
  const region = (
    <RideAnnouncer
      trainer={trainer}
      workout={workout}
      storage={announcements}
      clock={announcerClock}
      // #400: the interval sound, on the change that is SAID — never alone.
      onSaid={(kind) => {
        if (kind === 'interval-now') cues.cue('interval');
      }}
    />
  );
  return (
    <>
      {region}
      {trainer.controllable ? panelBody() : null}
    </>
  );

  function panelBody(): JSX.Element {
    return workout === undefined ? chooser() : riding(workout);
  }

  function riding(workout: RideWorkoutSnapshot): JSX.Element {
    return (
      <section>
        <h3>Workout: {workout.name}</h3>
        <p>
          {STATUS_TEXT[workout.status]} — {durationText(workout.elapsedSeconds)} of{' '}
          {durationText(workout.totalSeconds)}
        </p>
        {workout.nowRiding === undefined ? null : <p>Now: {workout.nowRiding}</p>}
        <p>
          {workout.holdingWatts === undefined
            ? 'The trainer has not confirmed a target yet.'
            : `Holding ${String(workout.holdingWatts)} W.`}
        </p>
        {workout.fault === undefined ? null : (
          // Not `live` since #445: `RideAnnouncer` speaks it, in order.
          <StatusMessage tone="warning">{workout.fault}</StatusMessage>
        )}
        {sound.enabled ? <SoundControls preference={sound} onChange={changeSound} /> : null}
        <Button type="button" onClick={onEnd}>
          End workout
        </Button>
      </section>
    );
  }

  function chooser(): JSX.Element {
    return (
      <section>
        <h3>Ride a workout</h3>
        {loadFault === undefined ? null : (
          <StatusMessage tone="warning" live>
            {loadFault}
          </StatusMessage>
        )}
        {!trainer.hasControl ? (
          <p>
            Ask the trainer for control first. A workout sets targets on the trainer, and it will
            refuse every one until control is granted.
          </p>
        ) : thresholdPower === undefined ? (
          // ⚠️ Refused rather than defaulted. A workout's targets are shares of
          // threshold, so a substituted threshold would put a made-up number on a
          // trainer — and `analysis/thresholds.ts` is the one place in this
          // program that supplies a default, deliberately.
          <p>
            Set your threshold power on the Analysis screen first. A workout&rsquo;s targets are a
            share of it, so there is no number to send without one.
          </p>
        ) : saved.length === 0 ? (
          <p>No workouts saved on this device yet. Build one on the Workouts screen.</p>
        ) : (
          <ul>
            {saved.map((record) => {
              const row = workoutRow(record);
              return (
                <li key={record.id}>
                  {row.name} — {row.duration}, {row.shape}{' '}
                  <Button
                    type="button"
                    onClick={() => {
                      // ⚠️ #400: inside the press and before anything else — the
                      // one place the audio context may be resumed. The choice is
                      // re-read so one made on Settings since this panel mounted
                      // is the one this workout sounds with.
                      const choice = readCuePreference(storage);
                      setSound(choice);
                      cues.set(choice);
                      cues.begin();
                      onStart(record);
                    }}
                  >
                    Ride {row.name}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    );
  }
}
