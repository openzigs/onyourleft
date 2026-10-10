// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The workout goals screen (#1237, ADR 0048 D-10): the rider's typed goals,
 * which bound what a heart-rate hold — and later a re-plan during the ride —
 * may do. A section of Settings, under its own card, beside #836's goals in
 * words, which never set a number.
 *
 * ## What renders comes from the store
 *
 * The form is filled from `getWorkoutGoals` when the screen opens, and from
 * what the store WROTE after a save — never from what was typed. So a reload
 * shows exactly what a heart-rate hold will read, and goals a sync brought
 * from another device are what the rider sees.
 *
 * ## Controls first, the rest behind the ⓘ
 *
 * One sentence of what they are and one of where they go (the latter a
 * disclosure, so `KeptVisible`), then the fields — each with its description
 * under it (WCAG 2.2 SC 3.3.2) — then *Save* and *Clear*. A refusal names
 * its box, is that box's error (`aria-invalid` and `aria-errormessage`), and
 * moves focus to it.
 */

import { useEffect, useId, useState, type JSX } from 'react';

import { WORKOUT_SESSION_TYPES } from '@onyourleft/domain';

import { Button } from '../design/Button';
import { KeptVisible } from '../design/KeptVisible';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import {
  EMPTY_GOALS_FORM,
  formFromGoals,
  goalsFromForm,
  isNoGoal,
  type WorkoutGoalsForm,
} from './form';
import type { WorkoutGoalsPort } from './workout-goals-port';
import {
  CLEAR_GOALS,
  FIELD_WORDS,
  GOALS_CLEARED,
  GOALS_NO_STORE,
  GOALS_NOT_READ,
  GOALS_READING,
  GOALS_SAVED,
  goalsSaveFailure,
  NO_SESSION_TYPE,
  SAVE_GOALS,
  SESSION_TYPE_NAMES,
  WORKOUT_GOALS_HEADING,
  WORKOUT_GOALS_HELP,
  WORKOUT_GOALS_LEAD,
  WORKOUT_GOALS_SYNC_TEXT,
  type GoalField,
} from './wording';

type Message = { readonly tone: 'success' | 'warning' | 'danger'; readonly text: string };

/** The number boxes, in the order they are laid out. */
const NUMBER_FIELDS: readonly (Exclude<GoalField, 'sessionType' | 'effortCheckIns'> &
  keyof WorkoutGoalsForm)[] = [
  'durationMinutes',
  'holdLow',
  'holdHigh',
  'heartRateAbove',
  'powerCeiling',
  'timeInRangeMinutes',
];

export function WorkoutGoalsPanel({
  port,
}: {
  readonly port?: WorkoutGoalsPort | undefined;
}): JSX.Element {
  const [form, setForm] = useState<WorkoutGoalsForm | undefined>(undefined);
  const [unreadable, setUnreadable] = useState(false);
  const [message, setMessage] = useState<Message | undefined>(undefined);
  const [invalid, setInvalid] = useState<GoalField | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const headingId = `${id}-heading`;
  const fieldId = (field: GoalField): string => `${id}-${field}`;
  const errorId = `${id}-error`;

  useEffect(() => {
    if (port === undefined) return undefined;
    let current = true;
    port.store.getWorkoutGoals(port.athleteId).then(
      (read) => {
        if (!current) return;
        if (read.status === 'fault') setUnreadable(true);
        setForm(read.status === 'kept' ? formFromGoals(read.record.goals) : EMPTY_GOALS_FORM);
      },
      () => {
        if (!current) return;
        setUnreadable(true);
        setForm(EMPTY_GOALS_FORM);
      },
    );
    return () => {
      current = false;
    };
  }, [port]);

  const edit = (next: Partial<WorkoutGoalsForm>): void => {
    setForm((was) => ({ ...(was ?? EMPTY_GOALS_FORM), ...next }));
    setMessage(undefined);
    setInvalid(undefined);
  };

  async function clear(): Promise<void> {
    if (port === undefined || busy) return;
    setBusy(true);
    try {
      await port.store.deleteWorkoutGoals(port.athleteId);
      setForm(EMPTY_GOALS_FORM);
      setUnreadable(false);
      setInvalid(undefined);
      setMessage({ tone: 'success', text: GOALS_CLEARED });
    } catch (error) {
      setMessage({ tone: 'danger', text: goalsSaveFailure(reasonOf(error)) });
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (port === undefined || form === undefined || busy) return;
    const outcome = goalsFromForm(form);
    if (!outcome.ok) {
      setInvalid(outcome.field);
      setMessage({ tone: 'danger', text: outcome.message });
      document.getElementById(fieldId(outcome.field))?.focus();
      return;
    }
    // A form with no goal in it is the goals cleared, not an empty set kept.
    if (isNoGoal(outcome.goals)) {
      await clear();
      return;
    }
    setBusy(true);
    try {
      const written = await port.store.putWorkoutGoals({
        athleteId: port.athleteId,
        goals: outcome.goals,
        savedAt: port.now(),
      });
      setForm(formFromGoals(written.goals));
      setUnreadable(false);
      setInvalid(undefined);
      setMessage({ tone: 'success', text: GOALS_SAVED });
    } catch (error) {
      setMessage({ tone: 'danger', text: goalsSaveFailure(reasonOf(error)) });
    } finally {
      setBusy(false);
    }
  }

  const describedBy = (field: GoalField): string =>
    invalid === field ? `${fieldId(field)}-hint ${errorId}` : `${fieldId(field)}-hint`;
  const invalidProps = (field: GoalField) =>
    invalid === field ? { 'aria-invalid': true, 'aria-errormessage': errorId } : {};

  return (
    <section className="oyl-workout-goals" aria-labelledby={headingId}>
      <SectionHeading
        level={3}
        id={headingId}
        help={WORKOUT_GOALS_HELP.map((sentence) => (
          <p key={sentence} className="oyl-muted">
            {sentence}
          </p>
        ))}
      >
        {WORKOUT_GOALS_HEADING}
      </SectionHeading>
      <p className="oyl-muted">{WORKOUT_GOALS_LEAD}</p>
      <KeptVisible>
        <p className="oyl-muted">{WORKOUT_GOALS_SYNC_TEXT}</p>
      </KeptVisible>

      {port === undefined ? (
        <StatusMessage tone="warning" label="No local store">
          {GOALS_NO_STORE}
        </StatusMessage>
      ) : form === undefined ? (
        <p className="oyl-muted">{GOALS_READING}</p>
      ) : (
        <form
          className="oyl-workout-goals__form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {unreadable ? <StatusMessage tone="warning">{GOALS_NOT_READ}</StatusMessage> : null}
          {/* The boxes side by side where the card is wide enough — a column
            on a phone — each its label, its box and its description. */}
          <div className="oyl-workout-goals__fields">
            <div className="oyl-workout-goals__field">
              <label htmlFor={fieldId('sessionType')}>{FIELD_WORDS.sessionType.label}</label>
              <select
                id={fieldId('sessionType')}
                value={form.sessionType}
                aria-describedby={describedBy('sessionType')}
                {...invalidProps('sessionType')}
                onChange={(event) => {
                  const chosen = WORKOUT_SESSION_TYPES.find((each) => each === event.target.value);
                  edit({ sessionType: chosen ?? '' });
                }}
              >
                <option value="">{NO_SESSION_TYPE}</option>
                {WORKOUT_SESSION_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {SESSION_TYPE_NAMES[type]}
                  </option>
                ))}
              </select>
              <p id={`${fieldId('sessionType')}-hint`} className="oyl-muted oyl-field-hint">
                {FIELD_WORDS.sessionType.hint}
              </p>
            </div>

            {NUMBER_FIELDS.map((field) => (
              <div key={field} className="oyl-workout-goals__field">
                <label htmlFor={fieldId(field)}>{FIELD_WORDS[field].label}</label>
                <input
                  className="oyl-input"
                  id={fieldId(field)}
                  inputMode={field === 'powerCeiling' ? 'decimal' : 'numeric'}
                  value={form[field]}
                  placeholder="no goal"
                  aria-describedby={describedBy(field)}
                  {...invalidProps(field)}
                  onChange={(event) => {
                    edit({ [field]: event.target.value });
                  }}
                />
                <p id={`${fieldId(field)}-hint`} className="oyl-muted oyl-field-hint">
                  {FIELD_WORDS[field].hint}
                </p>
              </div>
            ))}

            <div className="oyl-workout-goals__field oyl-workout-goals__field--wide">
              <label>
                <input
                  type="checkbox"
                  id={fieldId('effortCheckIns')}
                  checked={form.effortCheckIns}
                  aria-describedby={describedBy('effortCheckIns')}
                  onChange={(event) => {
                    edit({ effortCheckIns: event.currentTarget.checked });
                  }}
                />{' '}
                {FIELD_WORDS.effortCheckIns.label}
              </label>
              <p id={`${fieldId('effortCheckIns')}-hint`} className="oyl-muted oyl-field-hint">
                {FIELD_WORDS.effortCheckIns.hint}
              </p>
            </div>
          </div>

          <div className="oyl-workout-goals__actions">
            <Button variant="secondary" type="submit">
              {SAVE_GOALS}
            </Button>
            <Button
              variant="tertiary"
              onClick={() => {
                void clear();
              }}
            >
              {CLEAR_GOALS}
            </Button>
          </div>
        </form>
      )}
      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live id={errorId}>
          {message.text}
        </StatusMessage>
      )}
    </section>
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : 'the store refused it';
}
