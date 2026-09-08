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
 * ## Colour carries nothing
 *
 * The status is a word and the block is a sentence, for `AnalysisView.tsx`'s
 * reason. A progress bar may sit beside them later; it may not replace them.
 */

import { useEffect, useState, type JSX } from 'react';

import type { Watts } from '@onyourleft/domain';
import type { WorkoutRecord } from '@onyourleft/store';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { durationText, workoutRow } from '../workouts/library';
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
}

export function WorkoutPanel({
  trainer,
  workout,
  port,
  thresholdPower,
  onStart,
  onEnd,
}: WorkoutPanelProps): JSX.Element | null {
  const [saved, setSaved] = useState<readonly WorkoutRecord[]>([]);
  const [loadFault, setLoadFault] = useState<string | undefined>(undefined);

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

  // Nothing to say on a screen with no controllable trainer: the rider has not
  // reached the question yet, and a panel explaining workouts to somebody
  // pairing a heart rate strap is noise.
  if (!trainer.controllable) {
    return null;
  }

  if (workout !== undefined) {
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
          <StatusMessage tone="warning">{workout.fault}</StatusMessage>
        )}
        <Button type="button" onClick={onEnd}>
          End workout
        </Button>
      </section>
    );
  }

  return (
    <section>
      <h3>Ride a workout</h3>
      {loadFault === undefined ? null : <StatusMessage tone="warning">{loadFault}</StatusMessage>}
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
