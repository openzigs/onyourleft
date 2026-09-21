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
 * ## What is announced, and when — #394
 *
 * A workout fault and a library that could not be read are `live`: each is
 * absent until something goes wrong, which is exactly the case
 * `StatusMessage`'s `live` exists for, and a rider who cannot see the screen
 * must hear that the targets have stopped.
 *
 * ⚠️ **The block being ridden is announced when it CHANGES, never when it is
 * first rendered.** `Now: …` is on the screen for as long as a workout runs,
 * so a `live` on it would read the block out the moment the panel mounted and
 * then interrupt with it. So the visible line stays a plain `<p>`, and a
 * separate region — visually hidden by clip, never `display: none`, because a
 * hidden region announces nothing — is empty until the value differs from the
 * one the panel was first drawn with ({@link useAnnouncedChange}).
 *
 * ⚠️ **Nothing here pre-empts by politeness.** Every region is `role="status"`;
 * TalkBack treats all of them alike (assertive on one Android, polite on
 * another — Roselli, 2026-01-14), so ordering is decided before a sentence is
 * written, not by the role it is written into.
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
import { announce, INITIAL_ANNOUNCER, type AnnouncerState } from '../game/hud/announce';
import {
  deviceStorage,
  readAnnouncementPreference,
  type PreferenceStorage,
} from '../game/hud/announce-preference';
import { durationText, workoutRow } from '../workouts/library';

import { upcomingBlock } from './lookahead';
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
   * DEVICE's storage unless a test hands in a double.
   */
  readonly announcements?: PreferenceStorage | undefined;
}

export function WorkoutPanel({
  trainer,
  workout,
  port,
  thresholdPower,
  onStart,
  onEnd,
  announcements,
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
        <WorkoutAnnouncer workout={workout} storage={announcements} />
        <p>
          {workout.holdingWatts === undefined
            ? 'The trainer has not confirmed a target yet.'
            : `Holding ${String(workout.holdingWatts)} W.`}
        </p>
        {workout.fault === undefined ? null : (
          <StatusMessage tone="warning" live>
            {workout.fault}
          </StatusMessage>
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

/**
 * The workout's one announcement region — #394, #398.
 *
 * Empty until there is something to say; then the newest sentence. Visually
 * hidden by the CLIP technique (`oyl-visually-hidden`), which keeps it in the
 * accessibility tree — the three things that do not (`display: none`,
 * `hidden`, `aria-hidden`) would make it silent. Two things write into it:
 *
 * - **the block, when it changes** (#394) — always, because it is the plain
 *   line above made audible, and it is said as the change happens;
 * - **the block before it changes** (#398) — only for a rider who turned
 *   announcements on (off by default, #395), `lead` seconds ahead, once per
 *   boundary, and never while the workout is paused: its clock, the player's
 *   own `elapsedSeconds`, does not move then. Through the announcer core, so
 *   its throttle and its order are the same ones the ride HUD uses.
 */
function WorkoutAnnouncer({
  workout,
  storage,
}: {
  readonly workout: RideWorkoutSnapshot;
  readonly storage: PreferenceStorage | undefined;
}): JSX.Element {
  const [said, setSaid] = useState('');
  const changed = useAnnouncedChange(workout.nowRiding);
  useEffect(() => {
    if (changed !== undefined) setSaid(`Now: ${changed.value}`);
  }, [changed]);

  // Read once, when the workout panel appears: a preference is a setting, not
  // a live value, and a rider changes it on Settings rather than mid-interval.
  const [preference] = useState(() =>
    readAnnouncementPreference(storage === undefined ? deviceStorage() : storage),
  );
  const announcer = useRef<AnnouncerState>(INITIAL_ANNOUNCER);
  /** The boundary last offered, so one change is announced once. */
  const offered = useRef<number | undefined>(undefined);
  const lead = preference.intervalLeadSeconds;
  const { timeline, elapsedSeconds, status } = workout;
  useEffect(() => {
    if (!preference.enabled || lead === 'never') return;
    const ahead = status === 'running' ? upcomingBlock(timeline, elapsedSeconds, lead) : undefined;
    const fresh = ahead !== undefined && ahead.boundary !== offered.current;
    if (fresh) offered.current = ahead.boundary;
    const heard = announce(announcer.current, {
      now: elapsedSeconds,
      readings: [],
      events: fresh ? [{ kind: 'interval-ahead', text: ahead.sentence }] : [],
      preference: { ...preference, powerEverySeconds: 'never', distanceEvery: 'never' },
    });
    announcer.current = heard.state;
    if (heard.sentence !== undefined) setSaid(heard.sentence);
  }, [preference, lead, timeline, elapsedSeconds, status]);

  return (
    <p className="oyl-visually-hidden" role="status" data-oyl-announcer="workout">
      {said}
    </p>
  );
}

/**
 * A value, but only once it has CHANGED from the one first rendered — #394.
 *
 * The first render remembers the value and says nothing. Each later render
 * whose value differs says the new one. `undefined` until then.
 */
function useAnnouncedChange(value: string | undefined): { readonly value: string } | undefined {
  const previous = useRef(value);
  // A fresh object per change, so the effect that writes it into the region
  // fires for every change — including a block whose words were last said
  // before a lookahead sentence replaced them.
  const [said, setSaid] = useState<{ readonly value: string } | undefined>(undefined);
  useEffect(() => {
    if (value === previous.current) {
      return;
    }
    previous.current = value;
    if (value !== undefined) {
      setSaid({ value });
    }
  }, [value]);
  return said;
}
