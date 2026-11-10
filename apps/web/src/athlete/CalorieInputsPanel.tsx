// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Settings panel for the two optional inputs a heart-rate calorie estimate
 * needs — the sex and the year of birth (#2432), beside the weight panel.
 *
 * ## Why it reads the store itself
 *
 * `calorie-inputs-port.ts` says: nothing else in the client holds these, so
 * the panel reads the row on mount and shows what came back from each save,
 * never what was typed, as `MaskedWordsPanel` does.
 *
 * ## What it says
 *
 * {@link CALORIE_INPUTS_LEAD} is what they are for, where they are kept and
 * what happens without them. It is kept on the screen rather than behind the
 * section's ⓘ (#666), because it is about what leaves the device. The line
 * under the form says whether a heart-rate ride gets a figure today, from the
 * stored row: with either unset, {@link CALORIE_INPUTS_UNSET}.
 */

import { useEffect, useId, useState, type JSX } from 'react';

import type { CalorieSex } from '@onyourleft/store';

import { Button } from '../design/Button';
import { KeptVisible } from '../design/KeptVisible';
import { SectionHeading } from '../design/SectionHelp';
import { StatusMessage } from '../design/StatusMessage';
import { calorieInputsToSave } from './calorie-inputs';
import type { CalorieInputsPort } from './calorie-inputs-port';

export const CALORIE_INPUTS_HEADING = 'Calorie estimate from heart rate';

/** What the two are for, where they are kept, and what happens without them. */
export const CALORIE_INPUTS_LEAD =
  'Used only to estimate calories from heart rate on a ride with no power. They are kept on this ' +
  'device, are never sent to an instance or a model, and go only into your own account export. ' +
  'Leave them unset and such a ride shows no calorie figure.';

/** Said under the form when the stored row has both. */
export const CALORIE_INPUTS_SET =
  'A ride with heart rate and no power gets a calorie estimate from these and your weight.';

/** Said under the form when the stored row lacks either. */
export const CALORIE_INPUTS_UNSET =
  'With either unset, a ride with heart rate and no power shows no calorie figure.';

export const CALORIE_INPUTS_SAVED = 'Saved. Rides you save from now on use these.';

export const CALORIE_INPUTS_NO_STORE =
  'This browser has no local store, so anything entered here would be forgotten as soon as the ' +
  'page reloaded.';

export const CALORIE_INPUTS_NOT_READ = 'These could not be read on this device.';

export const CALORIE_INPUTS_READING = 'Reading…';

/** Written out rather than shared, for `SettingsView.tsx` §`MASS_NO_ATHLETE`'s reason. */
export const CALORIE_INPUTS_NO_ATHLETE =
  'there is no athlete row on this device to save it against, so nothing was written';

export function calorieInputsSaveFailure(reason: string): string {
  return `That could not be saved, so these are as they were: ${reason}`;
}

/** The choice's options, *Not set* first: its value is the empty string. */
export const CALORIE_SEX_OPTIONS: readonly {
  readonly value: '' | CalorieSex;
  readonly label: string;
}[] = [
  { value: '', label: 'Not set' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

type Message = { readonly tone: 'success' | 'danger'; readonly text: string };

interface Stored {
  readonly calorieSex: CalorieSex | undefined;
  readonly birthYear: number | undefined;
}

export function CalorieInputsPanel({
  port,
  currentYear = new Date().getFullYear(),
}: {
  readonly port?: CalorieInputsPort | undefined;
  /** The year it is now, which bounds the year of birth. A test hands one in. */
  readonly currentYear?: number;
}): JSX.Element {
  const [stored, setStored] = useState<Stored | undefined>(undefined);
  const [unreadable, setUnreadable] = useState(false);
  const [sex, setSex] = useState<string>('');
  const [year, setYear] = useState('');
  const [message, setMessage] = useState<Message | undefined>(undefined);
  const sexId = useId();
  const yearId = useId();
  const yearHintId = useId();

  function show(row: Stored): void {
    setStored(row);
    setSex(row.calorieSex ?? '');
    setYear(row.birthYear === undefined ? '' : String(row.birthYear));
  }

  useEffect(() => {
    if (port === undefined) {
      return undefined;
    }
    let current = true;
    port.store.getAthlete(port.athleteId).then(
      (row) => {
        if (current) {
          show({ calorieSex: row?.calorieSex, birthYear: row?.birthYear });
        }
      },
      () => {
        if (current) {
          setUnreadable(true);
        }
      },
    );
    return () => {
      current = false;
    };
  }, [port]);

  async function save(): Promise<void> {
    if (port === undefined) {
      return;
    }
    const decision = calorieInputsToSave(sex, year, currentYear);
    if (decision.kind === 'refused') {
      setMessage({ tone: 'danger', text: decision.reason });
      return;
    }
    try {
      const saved = await port.store.setAthleteCalorieInputs(port.athleteId, {
        calorieSex: decision.calorieSex,
        birthYear: decision.birthYear,
      });
      if (saved === undefined) {
        setMessage({ tone: 'danger', text: calorieInputsSaveFailure(CALORIE_INPUTS_NO_ATHLETE) });
        return;
      }
      // What landed, not what was asked for.
      show({ calorieSex: saved.calorieSex, birthYear: saved.birthYear });
      setMessage({ tone: 'success', text: CALORIE_INPUTS_SAVED });
    } catch (error: unknown) {
      setMessage({
        tone: 'danger',
        text: calorieInputsSaveFailure(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  return (
    <section className="oyl-panel oyl-calorie-inputs" aria-labelledby="oyl-calorie-inputs-heading">
      <SectionHeading
        level={3}
        id="oyl-calorie-inputs-heading"
        help={
          <p className="oyl-muted">
            The heart-rate estimate is an equation fitted for men and for women separately, and it
            uses your age and weight. A ride with power is estimated from the work you did and needs
            neither.
          </p>
        }
      >
        {CALORIE_INPUTS_HEADING}
      </SectionHeading>
      <KeptVisible>
        <p className="oyl-muted">{CALORIE_INPUTS_LEAD}</p>
      </KeptVisible>

      {port === undefined ? (
        <StatusMessage tone="warning" label="No local store">
          {CALORIE_INPUTS_NO_STORE}
        </StatusMessage>
      ) : unreadable ? (
        <StatusMessage tone="danger">{CALORIE_INPUTS_NOT_READ}</StatusMessage>
      ) : stored === undefined ? (
        <p className="oyl-muted">{CALORIE_INPUTS_READING}</p>
      ) : (
        <form
          className="oyl-trainer__form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <p>
            <label htmlFor={sexId}>Sex</label>{' '}
            <select
              className="oyl-input"
              id={sexId}
              value={sex}
              onChange={(event) => {
                setSex(event.target.value);
                setMessage(undefined);
              }}
            >
              {CALORIE_SEX_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </p>
          <p>
            <label htmlFor={yearId}>Year of birth</label>{' '}
            <input
              className="oyl-input"
              id={yearId}
              inputMode="numeric"
              autoComplete="bday-year"
              value={year}
              placeholder="not set"
              aria-describedby={yearHintId}
              onChange={(event) => {
                setYear(event.target.value);
                setMessage(undefined);
              }}
            />
          </p>
          <p id={yearHintId} className="oyl-muted oyl-field-hint">
            Leave it blank to unset it.
          </p>
          <Button variant="secondary" type="submit">
            Save sex and year of birth
          </Button>
        </form>
      )}

      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}

      {stored === undefined ? null : (
        <p className="oyl-muted">
          {stored.calorieSex !== undefined && stored.birthYear !== undefined
            ? CALORIE_INPUTS_SET
            : CALORIE_INPUTS_UNSET}
        </p>
      )}
    </section>
  );
}
