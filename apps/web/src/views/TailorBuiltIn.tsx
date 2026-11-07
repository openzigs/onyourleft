// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useId, useMemo, useState, type JSX } from 'react';

import { expandWorkout, workoutShapeText, type Workout } from '@onyourleft/domain';

import type { OwnThresholds } from '../analysis/own-thresholds';
import { Button, ButtonLink } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { Stepper } from '../design/Stepper';
import { SELECTED_HEADING_ID } from '../shell/ListDetail';
import { hrefFor, hrefForSelection, routeById } from '../shell/routes';
import { BlockChart } from '../workouts/BlockChart';
import type { BuiltInCard } from '../workouts/built-in';
import { hrefForRidingBuiltIn } from '../workouts/built-in-ride';
import { durationText, hardestShare, percentOf } from '../workouts/library';
import {
  copyName,
  EMPTY_TAILOR_DRAFT,
  lengthOptionText,
  previewRows,
  TAILOR_LENGTHS,
  tailorFromDraft,
  tailorOffer,
  withChoice,
  type TailorControl,
  type TailorDraft,
} from '../workouts/tailor';

/**
 * A built-in, tailored — #2305, under the library epic #2295.
 *
 * The rider sets the length, the intensity and, where the template offers
 * them, the repeats and the recovery between them, and sees the result at once
 * as a graph and in words; with their threshold set, in watts too, and every
 * block by its power zone. *Save a copy* keeps it as one of their own.
 *
 * ## Every value comes from `tailorWorkout`
 *
 * `workouts/tailor.ts` hands the choices to the domain and nothing here
 * computes a target. A refusal is shown inside the form beside the control
 * that caused it (#1165) and the preview keeps the last workout that was
 * valid: the rider sees what they asked for refused, and still sees a workout
 * they could ride.
 *
 * ## What is saved
 *
 * The preview, exactly: the workout `tailorWorkout` returned for the last
 * valid choices, as an ordinary `WorkoutRecord` through the workouts store
 * port (`WorkoutsView.tsx` §`onSaveCopy`). No field is added and nothing is
 * migrated; the copy syncs like any workout and the built-in stays as it was.
 */
export interface TailorBuiltInProps {
  readonly card: BuiltInCard;
  /** The rider's own thresholds; each `undefined` when not set. */
  readonly thresholds: OwnThresholds;
  /**
   * Save the tailored workout as one of the rider's own, under `name`, and
   * resolve to its id. `WorkoutsView` writes it through the store port.
   */
  readonly onSaveCopy: (name: string, workout: Workout) => Promise<string>;
}

/** The last choices that made a workout, and that workout. */
interface Valid {
  readonly draft: TailorDraft;
  readonly workout: Workout;
}

/** A refusal and the control it belongs beside. */
interface Refusal {
  readonly control: TailorControl;
  readonly message: string;
}

/** `-25` → `"−25%"`, `10` → `"+10%"`. */
function signed(percent: number): string {
  if (percent > 0) return `+${String(percent)}%`;
  return percent < 0 ? `−${String(-percent)}%` : '0%';
}

export function TailorBuiltIn({ card, thresholds, onSaveCopy }: TailorBuiltInProps): JSX.Element {
  const offer = useMemo(() => tailorOffer(card.template), [card.template]);
  const [draft, setDraft] = useState<TailorDraft>(EMPTY_TAILOR_DRAFT);
  const [valid, setValid] = useState<Valid>({ draft: EMPTY_TAILOR_DRAFT, workout: card.workout });
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
  const [saved, setSaved] = useState<{ readonly name: string; readonly id: string } | undefined>(
    undefined,
  );
  const ids = {
    length: useId(),
    intensity: useId(),
    repeats: useId(),
    recovery: useId(),
  };

  /*
   * The rider's threshold heart rate arrives after the first render (it is
   * read from the store), and turns each heart-rate zone hold into a range in
   * beats per minute. The preview is made again from the last valid choices
   * when it does, so a hold is never shown as its steady fallback once the
   * rider's own number is known.
   */
  useEffect(() => {
    if (thresholds.heartRate === undefined) return;
    setValid((current) => {
      const outcome = tailorFromDraft(card.template, current.draft, thresholds.heartRate);
      return outcome.status === 'tailored' ? { ...current, workout: outcome.workout } : current;
    });
  }, [card.template, thresholds.heartRate]);

  function change(control: TailorControl, value: string): void {
    const next = withChoice(draft, control, value);
    setDraft(next);
    setSaved(undefined);
    const outcome = tailorFromDraft(card.template, next, thresholds.heartRate);
    if (outcome.status === 'tailored') {
      setValid({ draft: next, workout: outcome.workout });
      setRefusal(undefined);
    } else {
      setRefusal({ control, message: outcome.message });
    }
  }

  async function save(): Promise<void> {
    const timeline = expandWorkout(valid.workout);
    const name = copyName(card.template, timeline.totalSeconds, valid.draft);
    const id = await onSaveCopy(name, valid.workout);
    setSaved({ name, id });
  }

  const timeline = useMemo(() => expandWorkout(valid.workout), [valid.workout]);
  const rows = useMemo(
    () => previewRows(valid.workout, thresholds.power),
    [valid.workout, thresholds.power],
  );
  const hardest = hardestShare(valid.workout);

  const refused = (control: TailorControl): JSX.Element | null =>
    refusal?.control === control ? (
      <StatusMessage tone="warning" live>
        {refusal.message}
      </StatusMessage>
    ) : null;

  return (
    <div className="oyl-selected" data-oyl-built-in-detail={card.template.id}>
      <h2 id={SELECTED_HEADING_ID} tabIndex={-1}>
        {card.name}
      </h2>
      <p>{card.summary}</p>

      <form
        aria-label={`Tailor ${card.name}`}
        className="oyl-tailor"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        {offer.length ? (
          <div data-oyl-tailor="length">
            <p>
              <label htmlFor={ids.length}>Length</label>
              <select
                id={ids.length}
                name="length"
                value={draft.length}
                onChange={(event) => {
                  change('length', event.target.value);
                }}
              >
                <option value="">As written ({card.duration})</option>
                {TAILOR_LENGTHS.map((minutes) => (
                  <option key={minutes} value={String(minutes)}>
                    {lengthOptionText(minutes)}
                  </option>
                ))}
              </select>
            </p>
            {refused('length')}
          </div>
        ) : (
          <p>This workout is ridden as written: its length and intensity cannot be changed.</p>
        )}
        {offer.intensity === undefined ? null : (
          <div data-oyl-tailor="intensity">
            <p>
              <label htmlFor={ids.intensity}>Intensity, % easier or harder</label>
              <Stepper
                name="intensity"
                step={1}
                min={offer.intensity.minimum}
                max={offer.intensity.maximum}
              >
                <input
                  id={ids.intensity}
                  name="intensity"
                  type="text"
                  inputMode="numeric"
                  value={draft.intensity}
                  onChange={(event) => {
                    change('intensity', event.target.value);
                  }}
                />
              </Stepper>
            </p>
            <p className="oyl-muted">
              From {signed(offer.intensity.minimum)} to {signed(offer.intensity.maximum)}, in 1%
              steps. The warm-up and cool-down stay as written.
            </p>
            {refused('intensity')}
          </div>
        )}
        {offer.repeats === undefined ? null : (
          <div data-oyl-tailor="repeats">
            <p>
              <label htmlFor={ids.repeats}>Repeats</label>
              <Stepper
                name="repeats"
                step={1}
                min={offer.repeats.minimum}
                max={offer.repeats.maximum}
                start={offer.repeats.default}
              >
                <input
                  id={ids.repeats}
                  name="repeats"
                  type="text"
                  inputMode="numeric"
                  value={draft.repeats}
                  placeholder={String(offer.repeats.default)}
                  onChange={(event) => {
                    change('repeats', event.target.value);
                  }}
                />
              </Stepper>
            </p>
            <p className="oyl-muted">
              {String(offer.repeats.minimum)} to {String(offer.repeats.maximum)}. Choosing a length
              chooses the repeats for you.
            </p>
            {refused('repeats')}
          </div>
        )}
        {offer.recovery === undefined ? null : (
          <div data-oyl-tailor="recovery">
            <p>
              <label htmlFor={ids.recovery}>Recovery between repeats, seconds</label>
              <Stepper
                name="recovery seconds"
                step={15}
                min={offer.recovery.minimum}
                max={offer.recovery.maximum}
                start={offer.recovery.default}
              >
                <input
                  id={ids.recovery}
                  name="recovery"
                  type="text"
                  inputMode="numeric"
                  value={draft.recovery}
                  placeholder={String(offer.recovery.default)}
                  onChange={(event) => {
                    change('recovery', event.target.value);
                  }}
                />
              </Stepper>
            </p>
            <p className="oyl-muted">
              {String(offer.recovery.minimum)} to {String(offer.recovery.maximum)} seconds.
            </p>
            {refused('recovery')}
          </div>
        )}
      </form>

      <section aria-label="Preview" data-oyl-tailor-preview="">
        <h3>Preview</h3>
        <dl className="oyl-activity-card__facts">
          <div>
            <dt>Length</dt>
            <dd>{durationText(timeline.totalSeconds)}</dd>
          </div>
          <div>
            <dt>Hardest</dt>
            <dd>
              {hardest === undefined ? 'No target' : `${String(percentOf(hardest))}% of threshold`}
            </dd>
          </div>
          <div>
            <dt>Shape</dt>
            <dd>{workoutShapeText(valid.workout)}</dd>
          </div>
        </dl>
        {thresholds.power === undefined ? (
          <p>
            Targets are a share of your threshold power. Set it on{' '}
            <a href={hrefFor(routeById('analysis'))}>Analysis</a> to see them in watts.
          </p>
        ) : (
          <p>In watts from your threshold power of {String(thresholds.power)} W.</p>
        )}
        <ol>
          {rows.map((row, index) => (
            // A block's place is its identity: the list is redrawn whole.
            <li key={index}>
              {row.text}
              {row.power === undefined ? '' : ` — ${row.power}`}
              {row.zone === undefined || row.zone === '' ? '' : `, ${row.zone}`}
              {row.note === undefined ? '' : `. ${row.note}`}
            </li>
          ))}
        </ol>
        <BlockChart segments={timeline.segments} />
      </section>

      {/*
        #2306: *Ride it* without saving, the owner's ruling 3 on #2295 — a
        link to the Ride screen carrying the last valid choices, where the
        workout is made again and offered beside the saved ones. *Save a
        copy* beside it, secondary: riding is what a rider came for.
      */}
      <p className="oyl-tailor__save">
        <ButtonLink href={hrefForRidingBuiltIn(card.template, valid.draft)}>Ride it</ButtonLink>{' '}
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            void save();
          }}
        >
          Save a copy
        </Button>
      </p>
      {saved === undefined ? null : (
        <StatusMessage tone="success" live>
          Saved “{saved.name}” to your workouts.{' '}
          <a href={hrefForSelection(routeById('workouts'), saved.id)}>Open it</a>
        </StatusMessage>
      )}
      <p className="oyl-muted">
        Built into the app: it is not saved on this device, and it cannot be changed or deleted.
        Save a copy to make one your own.
      </p>
    </div>
  );
}
