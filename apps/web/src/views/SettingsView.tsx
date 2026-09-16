// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a rider says whether they ride in kilometres or in miles (#238), and
 * what they weigh (#325).
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
 * ## Why the weight is here and not on the game screen
 *
 * #325's sixth acceptance criterion is that there *be* a way for a rider to
 * enter their mass. The physics reads it, so the game is where its effect is
 * felt — and a setting belongs where a rider would look for it rather than
 * where it is consumed, which is the same argument this file already makes
 * about units against the thresholds on the analysis screen. It is also the
 * screen that already knows which units the rider reads in, and a weight is the
 * fourth quantity ADR 0020 D-1 put inside that switch.
 *
 * ⚠️ **Two ports, not one.** `athlete/store-port.ts` says why: a display
 * preference and an input to the physics are not the same kind of thing, and a
 * screen offering one is not thereby entitled to the other.
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

import { kilograms, type Kilograms } from '@onyourleft/domain';
import { UNIT_SYSTEMS, type UnitSystem } from '@onyourleft/store';

import { DEFAULT_RIDER_MASS_KILOGRAMS, massToSave, riderMassFor } from '../athlete/mass';
import type { AthleteMassPort } from '../athlete/store-port';
import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';
import { formatMass, massIn, massUnit, measurementText } from '../units/format';
import type { UnitsPort } from '../units/store-port';

/**
 * What a panel is currently telling the rider, or `undefined` for nothing.
 *
 * Named because it crosses a component boundary — see {@link WeightPanel} for
 * why the weight panel's message is held a level above the field that sets it.
 */
type PanelMessage = { readonly tone: 'success' | 'danger'; readonly text: string };

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

/** Said when the weight has been written and read back. */
export const MASS_SAVED = 'Saved. The trainer game now rides you at this weight.';

/** Said when the weight has been cleared and the default is back. */
export const MASS_CLEARED = 'Cleared. The trainer game rides you at the assumed weight again.';

/** Said when there is nothing to write a weight to. */
export const MASS_NO_STORE =
  'This browser has no local store, so a weight entered here would be forgotten as soon as the ' +
  'page reloaded.';

/** Said when the write failed. Names the failure rather than swallowing it. */
export function massSaveFailure(reason: string): string {
  return `That could not be saved, so the trainer game is still using the weight it was: ${reason}`;
}

/**
 * Why a weight write can land nowhere without throwing.
 *
 * `setAthleteMass` answers `undefined` for *"there is no such athlete"* for
 * {@link UNITS_NO_ATHLETE}'s reason, and it is reachable here for the same
 * reason. Discarding it would tell a rider the game was riding them at a weight
 * that had never been written down.
 *
 * ⚠️ **The same sentence as {@link UNITS_NO_ATHLETE}, written out rather than
 * shared.** They say the same thing today because the store's two narrow writes
 * fail the same way; they are two panels' copy, and one may be reworded without
 * the other. A shared constant would make "these read alike" a constraint
 * instead of a coincidence, which is not something either panel needs.
 */
export const MASS_NO_ATHLETE =
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
  /** `undefined` where this browser has no local store — see {@link MASS_NO_STORE}. */
  readonly mass?: AthleteMassPort | undefined;
  /**
   * What the rider currently weighs, or `undefined` where they have never said.
   *
   * ⚠️ **Not defaulted on the way in.** The one place a default is substituted
   * is `athlete/mass.ts` §`riderMassFor`, and this screen has to be able to tell
   * "assumed" from "entered" in order to say which it is showing — a prop that
   * arrived pre-defaulted could not.
   */
  readonly riderMass?: Kilograms | undefined;
  /**
   * Told when the weight write succeeded, so the rest of the client follows.
   *
   * ⚠️ **Called only after the store has answered with a written row**, never
   * optimistically and never on the store's `undefined`, for
   * {@link SettingsViewProps.onUnitsChange}'s reason — and here the
   * disagreement would be a rider being ridden up a hill at a weight the disk
   * does not hold.
   */
  readonly onRiderMassChange: (mass: Kilograms | undefined) => void;
}

export function SettingsView({
  port,
  units,
  onUnitsChange,
  mass,
  riderMass,
  onRiderMassChange,
}: SettingsViewProps): JSX.Element {
  const [message, setMessage] = useState<PanelMessage | undefined>(undefined);

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
    <>
      <section className="oyl-panel" aria-labelledby="oyl-units-heading">
        <h2 id="oyl-units-heading">Units</h2>
        <p className="oyl-muted">
          One choice covers distance, speed, climbing and weight. A rider who wants miles for
          distance and metres for climbing cannot have that — the whole app follows one setting, and
          splitting it later is something we can add without taking anything away.
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

      {/*
        ⚠️ A **sibling section**, not a second fieldset inside the units one.
        `a11y/audit.ts` checks heading order, and a rider looking for "where do
        I put my weight" is looking for a heading rather than for a control
        inside a panel about kilometres and miles. The two do interact — the box
        below is in whichever unit the panel above selects — and that is a
        reason to put them on one screen rather than in one panel.
      */}
      {/*
        ⚠️ **Keyed on the units, and on nothing else.** The panel is what a
        units switch invalidates: the box below it has to be re-seeded in the
        new unit, and a confirmation about the old one has stopped describing
        what is on screen. It is deliberately **not** keyed on `riderMass` —
        that value moves on every successful save, and a remount there threw
        the confirmation away. See {@link WeightPanel}.
      */}
      <WeightPanel
        key={units}
        {...(mass === undefined ? {} : { port: mass })}
        units={units}
        {...(riderMass === undefined ? {} : { riderMass })}
        onRiderMassChange={onRiderMassChange}
      />
    </>
  );
}

/**
 * What the rider weighs (#325).
 *
 * ## Why this control exists at all
 *
 * `AthleteRecord.mass` had been on the athlete row since schema 6, was read by
 * the segment matcher and by the account export — and **nothing in the program
 * ever wrote one**, so the trainer game rode every athlete at a hard-coded
 * 80 kg. Adding the read without adding this box would have left the fix
 * unreachable: a field with a consumer and no writer is the same defect seen
 * from the other end, and it is the one `check:wiring` cannot see because
 * nothing is dead.
 *
 * ## The box is in the rider's own units, and the store's is not
 *
 * A rider reading in miles types pounds, and what is stored is kilograms —
 * every time, in both systems, because `packages/domain`'s canonical unit does
 * not move for a display preference (ADR 0020). The conversion happens once, in
 * `athlete/mass.ts` §`massToSave`, and the reverse happens once, in
 * `units/format.ts` §`massIn`.
 *
 * ## Two keys, at two levels, and the defect that put them there
 *
 * A remount is the React idiom for *"this input's identity changed"*; the
 * alternative is an effect that writes state during render and is harder to be
 * sure of. Two different things can change that identity, and they are keyed
 * separately because **they invalidate different amounts of state**:
 *
 * - **The units** key this panel, at the call site. Switching to miles has to
 *   re-seed the box with pounds rather than leave a kilogram figure sitting
 *   under a `lb` label — a reading that is wrong by a factor of 2.2 and looks
 *   entirely plausible — and it also retires any confirmation about the weight
 *   in the units it was saved in.
 * - **The stored value** keys {@link WeightField} alone, so that a save
 *   normalises what the rider typed (`64` → `64.0`) and an external write is
 *   not left stale underneath them.
 *
 * ⚠️ **The message is held here, ABOVE the second key, and a review found out
 * why the hard way.** Both keys used to be on `WeightField`, so a successful
 * save — which calls `onRiderMassChange(saved.mass)` and *then* sets the
 * message — moved the key, remounted the field, and landed its own
 * confirmation on the instance it had just destroyed. Nothing was ever
 * announced. The inversion is the tell: re-saving the *same* weight left the
 * key still and the confirmation appeared, so it showed up exactly when
 * nothing had changed.
 *
 * It is not cosmetic. {@link MASS_SAVED} and {@link MASS_CLEARED} are rendered
 * in a `StatusMessage live`, which is the only announcement a screen-reader
 * user gets that the write landed at all.
 *
 * ⚠️ **No view-level test could see it**, because every case in
 * `SettingsView.test.tsx` passes `onRiderMassChange={() => undefined}` — the
 * prop never moves, so the key never moves. That is CLAUDE.md §5's *wrong
 * harness*: the double is inert in exactly the dimension the defect lives in.
 * `shell/AppShell.test.tsx` §`what the rider weighs (#325)` is where the
 * regression is held, because the shell is the one place that supplies a real
 * setter.
 */
function WeightPanel({
  port,
  units,
  riderMass,
  onRiderMassChange,
}: {
  readonly port?: AthleteMassPort | undefined;
  readonly units: UnitSystem;
  readonly riderMass?: Kilograms | undefined;
  readonly onRiderMassChange: (mass: Kilograms | undefined) => void;
}): JSX.Element {
  const current = riderMassFor(riderMass);
  // ⚠️ Here rather than in `WeightField`, which is remounted by a save. See the
  // note above: this is the state the field's own key used to discard.
  const [message, setMessage] = useState<PanelMessage | undefined>(undefined);
  return (
    <section className="oyl-panel" aria-labelledby="oyl-weight-heading">
      <h2 id="oyl-weight-heading">Your weight</h2>
      <p className="oyl-muted">
        The trainer game works out how fast you are going from how hard you are pedalling, and what
        you weigh is most of the answer on a climb. Nothing is sent anywhere — it is stored on this
        device with your rides.
      </p>
      <p className="oyl-muted">
        {current.assumed ? 'You have not entered one, so rides use an assumed ' : 'Rides use '}
        {measurementText(formatMass(current.mass, units))}
        {current.assumed
          ? '. That is a stand-in and not a measurement, and it is wrong for almost everybody.'
          : '.'}{' '}
        A bicycle is added to it — the game rides a rider and a bike, not a rider.
      </p>

      {port === undefined ? (
        <StatusMessage tone="warning" label="No local store">
          {MASS_NO_STORE}
        </StatusMessage>
      ) : (
        // ⚠️ Remounted when the stored value changes, so the box shows what
        // landed rather than what was typed. The units are the panel's key, one
        // level up, because they invalidate the message too. See the note above.
        <WeightField
          key={String(riderMass ?? '')}
          port={port}
          units={units}
          {...(riderMass === undefined ? {} : { riderMass })}
          onRiderMassChange={onRiderMassChange}
          {...(message === undefined ? {} : { message })}
          onMessage={setMessage}
        />
      )}
    </section>
  );
}

/**
 * The box, the button and what they are told.
 *
 * ⚠️ **`message` is a prop and not state.** A successful save moves
 * `riderMass`, which is this component's key, so anything held here is
 * discarded before it can be rendered — see {@link WeightPanel}.
 *
 * @see WeightPanel
 */
function WeightField({
  port,
  units,
  riderMass,
  onRiderMassChange,
  message,
  onMessage,
}: {
  readonly port: AthleteMassPort;
  readonly units: UnitSystem;
  readonly riderMass?: Kilograms | undefined;
  readonly onRiderMassChange: (mass: Kilograms | undefined) => void;
  readonly message?: PanelMessage | undefined;
  readonly onMessage: (message: PanelMessage | undefined) => void;
}): JSX.Element {
  // ⚠️ Seeded to one decimal place, which makes a re-save in imperial a
  // slightly lossy round trip: 69.853 kg shows as `154.0` lb and saves back as
  // 69.85322 kg. Raised in review and left as it is. The error is bounded by
  // half a tenth of a pound — 0.05 × 0.45359237 = **22.7 g at worst**, and
  // 0.2 g in that example — on a rider-plus-bicycle of about eighty kilograms,
  // which is three orders of magnitude below what a bathroom scale reports and
  // far below anything `packages/physics` could express as a speed. Keeping the
  // original kilograms for an unedited box would need a second piece of state
  // whose only job is to be invisible.
  const [typed, setTyped] = useState(
    riderMass === undefined ? '' : massIn(riderMass, units).toFixed(1),
  );
  async function save(): Promise<void> {
    const decision = massToSave(typed, units);
    if (decision.kind === 'refused') {
      onMessage({ tone: 'danger', text: decision.reason });
      return;
    }
    try {
      // ⚠️ The return is read, not discarded. `undefined` means the store found
      // no such athlete and wrote nothing — see {@link MASS_NO_ATHLETE}.
      const saved = await port.store.setAthleteMass(port.athleteId, decision.mass);
      if (saved === undefined) {
        onMessage({ tone: 'danger', text: massSaveFailure(MASS_NO_ATHLETE) });
        return;
      }
      // ⚠️ `saved.mass` rather than `decision.mass`: what the rest of the
      // client is told is what came back off the row, so a store that stored
      // something else cannot be papered over by the value we sent it.
      //
      // ⚠️ **This is what remounts the component the line below it is setting
      // a message on**, which is why that message is the panel's state rather
      // than this one's. See {@link WeightPanel}.
      onRiderMassChange(saved.mass);
      onMessage({
        tone: 'success',
        text: decision.mass === undefined ? MASS_CLEARED : MASS_SAVED,
      });
    } catch (error: unknown) {
      onMessage({
        tone: 'danger',
        text: massSaveFailure(error instanceof Error ? error.message : String(error)),
      });
    }
  }

  return (
    <div className="oyl-trainer__form">
      <p>
        <label htmlFor="oyl-rider-mass">Your weight ({massUnit(units)})</label>{' '}
        <input
          className="oyl-input"
          id="oyl-rider-mass"
          inputMode="decimal"
          value={typed}
          placeholder="not set"
          onChange={(event) => {
            setTyped(event.target.value);
            onMessage(undefined);
          }}
        />
      </p>
      <p className="oyl-muted">
        Leave it blank to go back to the assumed{' '}
        {measurementText(formatMass(kilograms(DEFAULT_RIDER_MASS_KILOGRAMS), units))}.
      </p>
      <Button
        onClick={() => {
          void save();
        }}
      >
        Save weight
      </Button>

      {message === undefined ? null : (
        <StatusMessage tone={message.tone} live>
          {message.text}
        </StatusMessage>
      )}
    </div>
  );
}
