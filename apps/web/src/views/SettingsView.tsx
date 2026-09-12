// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a rider says whether they ride in kilometres or in miles (#238).
 *
 * ## Why this is its own screen
 *
 * It changes what **every** other screen says, so it belongs to none of them.
 * The thresholds on the analysis screen are inputs to the numbers beside them
 * and are rightly there; this is not — a rider looking for "how do I get
 * miles" would not think to look under Analysis, and a preference that is hard
 * to find is one that gets reported as a missing feature.
 *
 * It is also a route, which means the accessibility gate reaches it without
 * anyone remembering to add a case: `routes.a11y.test.tsx` iterates the table
 * in `shell/routes.ts`.
 *
 * ⚠️ **The route being in the table is not enough, and a review caught this.**
 * With no `settings` port the shell renders {@link UNITS_NO_STORE} — a
 * paragraph with nothing interactive in it — so the gate audited a route on
 * which the radio group had never rendered, and reported it clean. What makes
 * the control audited is `routes.a11y.test.tsx` §`settingsPort`, which hands
 * the shell a port that answers. Removing it turns a control with no
 * accessible name back into a green run.
 *
 * ## The current choice is visible, never implied
 *
 * #238 is explicit that the default must not be a silent guess from the
 * locale. So the control is a radio group whose selected option *is* the
 * current setting, each option names the units it means in the words a rider
 * would use, and the panel says what the choice does and does not affect. A
 * rider who has never chosen sees `metric` selected and can see that it is
 * selected, which is the difference between a default and a guess.
 *
 * ## What it changes, and what it does not
 *
 * The write is one call on {@link UnitsPort}, and it lands on the athlete row
 * (ADR 0020 D-2). Nothing else in the database moves: the conversion happens
 * at the formatting boundary and `packages/store`'s
 * `activity-store.units.test.ts` reads a ride back either side of a change to
 * prove it. An exported FIT, GPX or TCX file is likewise unaffected, and the
 * panel says so — a rider about to send a file to a coach should not have to
 * guess.
 */

import { useState, type JSX } from 'react';

import { UNIT_SYSTEMS, type UnitSystem } from '@onyourleft/store';

import { StatusMessage } from '../design/StatusMessage';
import type { UnitsPort } from '../units/store-port';

/** What each choice is called, and the units it actually means. */
const CHOICES: Readonly<Record<UnitSystem, { readonly label: string; readonly detail: string }>> = {
  metric: {
    label: 'Kilometres',
    detail: 'Distance in km, speed in km/h, climbing in m.',
  },
  imperial: {
    label: 'Miles',
    detail: 'Distance in mi, speed in mph, climbing in ft.',
  },
};

/** Said when the preference has been written and read back. */
export const UNITS_SAVED = 'Saved. Every screen now reads in these units.';

/** Said when there is nothing to write to. */
export const UNITS_NO_STORE =
  'This browser has no local store, so a choice made here would be forgotten as soon as the ' +
  'page reloaded. Everything is shown in kilometres.';

/** Said when the write failed. Names the failure rather than swallowing it. */
export function unitsSaveFailure(reason: string): string {
  return `That could not be saved, so this device is still reading in the units it was: ${reason}`;
}

/**
 * Why a write can land nowhere without throwing.
 *
 * ⚠️ `setAthleteUnits` answers `undefined` for *"there is no such athlete"* —
 * it does **not** throw, because a missing row is an ordinary state rather than
 * an error. Reachable here: `main.tsx` builds the port unconditionally while
 * `local-athlete.ts` §`renderAfterAthlete` deliberately swallows a failure from
 * `ensureLocalAthlete`, so a start-up where the row could not be created still
 * renders this screen over a store that answers. Discarding that return is
 * CLAUDE.md §5's *"a write that reports success while the read cannot see it"*:
 * every screen would flip to miles, the panel would say `UNITS_SAVED`, and the
 * next reload would be back in kilometres with nothing having said so.
 */
export const UNITS_NO_ATHLETE =
  'there is no athlete row on this device to save it against, so nothing was written';

export interface SettingsViewProps {
  /** `undefined` where this browser has no local store — see {@link UNITS_NO_STORE}. */
  readonly port?: UnitsPort | undefined;
  /** The current choice, from the athlete row `main.tsx` read at start-up. */
  readonly units: UnitSystem;
  /**
   * Told when the write succeeded, so the rest of the client re-renders.
   *
   * ⚠️ **Called only after the store has answered with a written row**, never
   * optimistically and never on the store's `undefined`. A screen that
   * switched to miles and then failed to persist would show a rider miles
   * until they reloaded and kilometres afterwards, with nothing saying which
   * is real — the same class of defect as a write that reports success while
   * the read cannot see it, moved up into the UI. "Answered" is not enough:
   * `undefined` *is* an answer, and it means nothing was written.
   */
  readonly onUnitsChange: (units: UnitSystem) => void;
}

export function SettingsView({ port, units, onUnitsChange }: SettingsViewProps): JSX.Element {
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | undefined>(
    undefined,
  );

  async function choose(chosen: UnitSystem): Promise<void> {
    if (port === undefined || chosen === units) {
      return;
    }
    try {
      // ⚠️ The return is read, not discarded. `undefined` means the store found
      // no such athlete and wrote nothing — see {@link UNITS_NO_ATHLETE}.
      const saved = await port.store.setAthleteUnits(port.athleteId, chosen);
      if (saved === undefined) {
        setMessage({ tone: 'danger', text: unitsSaveFailure(UNITS_NO_ATHLETE) });
        return;
      }
      onUnitsChange(chosen);
      setMessage({ tone: 'success', text: UNITS_SAVED });
    } catch (error: unknown) {
      setMessage({
        tone: 'danger',
        text: unitsSaveFailure(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  return (
    <section className="oyl-panel" aria-labelledby="oyl-units-heading">
      <h2 id="oyl-units-heading">Units</h2>
      <p className="oyl-muted">
        One choice covers distance, speed, climbing and weight. A rider who wants miles for distance
        and metres for climbing cannot have that — the whole app follows one setting, and splitting
        it later is something we can add without taking anything away.
      </p>

      {/*
        A radio group rather than a select, because there are two options and
        both should be readable without opening anything: #238 asks for the
        current unit to be visible rather than implied, and a collapsed select
        shows one option and hides the other. `fieldset`/`legend` is the
        grouping HTML already has, so no ARIA is needed to associate the label
        with the group — the same argument `HudPanel.tsx` makes for `dl`.
      */}
      {/*
        ⚠️ **Absent rather than disabled where there is nothing to write to.**
        `design/Button.tsx` states the rule and #48's first criterion is behind
        it: a disabled control leaves the tab order, so a keyboard user never
        reaches it and never hears why. The explanation takes its place.
      */}
      {port === undefined ? (
        <StatusMessage tone="warning" label="No local store">
          {UNITS_NO_STORE}
        </StatusMessage>
      ) : (
        <fieldset className="oyl-fieldset">
          <legend>Which units do you ride in?</legend>
          {UNIT_SYSTEMS.map((option) => (
            <p key={option}>
              <label htmlFor={`oyl-units-${option}`}>
                <input
                  type="radio"
                  id={`oyl-units-${option}`}
                  name="oyl-units"
                  value={option}
                  checked={units === option}
                  onChange={() => {
                    void choose(option);
                  }}
                />{' '}
                {CHOICES[option].label} — {CHOICES[option].detail}
              </label>
            </p>
          ))}
        </fieldset>
      )}

      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}

      <p className="oyl-muted">
        This changes how numbers are <strong>shown</strong> and nothing else. Every ride stays
        recorded exactly as it was, and a FIT, GPX or TCX file you export is unaffected — those
        formats have their own unit rules and another program reads them.
      </p>
    </section>
  );
}
