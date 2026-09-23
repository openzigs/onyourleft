// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The trainer control, which is the part of this screen that can hurt someone.
 *
 * ## Requested is not confirmed, and the words are different
 *
 * #49's first acceptance criterion: the screen shows **requested versus
 * confirmed** and *"never displays a setpoint as active before #43 has
 * confirmed it"*. So there are three sentences and they do not share a
 * template:
 *
 * | Client state | What this renders |
 * |---|---|
 * | `requested` set | "Asked for 250 W — waiting for the trainer to confirm" |
 * | `target.kind === 'confirmed'` | "Holding 250 W" |
 * | `target.kind === 'unknown'` | "The trainer may still be holding 250 W — this app can no longer tell" |
 * | `target.kind === 'none'` | "No target set" |
 *
 * `RideView.test.tsx` asserts the word **Holding** never appears while a
 * procedure is outstanding. That is a string assertion and it is deliberately
 * brittle: the word is the guarantee.
 *
 * ## Ending ERG is a release, and a release is not a loss — #372
 *
 * *End ERG* releases the trainer through the controller's one release, an FTMS
 * Stop, and control is kept — so this panel does not show the "Control lost"
 * warning below, and does not ask the rider to take control again. ⚠️ PR #442
 * first made it a Reset, which revoked control and put *Ask the trainer for
 * control* here after every ride; a reviewer who remembers that is reading the
 * old file. A release the trainer did not acknowledge is the one thing said
 * about it, as *Not released*.
 *
 * ## Control is its own step, and ERG is one thing to do with it — #503
 *
 * ⚠️ **Until #503 control lived inside ERG, and a reviewer who remembers this
 * panel opening with *"Pair a smart trainer to set an ERG target"* is reading
 * the old file.** The only *Ask the trainer for control* in the app was here,
 * under an ERG framing, and the form it opened was ERG's — so on the owner's
 * tablet (2026-09-23) the trainer game looked as though it needed an ERG set
 * before the hills would reach the trainer. It never did: control alone is
 * what the game needs, and since #503 the game asks for it itself when the
 * rider presses *Ride*.
 *
 * So the panel is now two things in order: **control**, with its own sentence
 * ({@link controlSentence}) and its own button, and then **ERG**, labelled
 * *optional*, as one of the things control is for — beside the workout below
 * and the game elsewhere. A trainer whose Feature bits refuse a power target used
 * to get no control step at all, because the ERG early-return came first; it
 * gets one now, because the game and a workout may still want control of it.
 *
 * ## Control loss is a notice, not a disabled button
 *
 * `design/Button.tsx` records why a disabled control is not how this shell says
 * "you cannot do this": it leaves the tab order, so a keyboard user never
 * reaches it and never hears why. When control is lost the ERG form is replaced
 * by a `StatusMessage` and a button that asks for control again — which is the
 * *"offer to re-request it"* the issue asks for.
 */

import { useState, type FormEvent, type JSX } from 'react';

import { watts, type Watts } from '@onyourleft/domain';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';

import type { TrainerSnapshot } from './controller';

/**
 * Human words for why control went. Each is a different thing to do next.
 *
 * Exported because `RideAnnouncer.tsx` SPEAKS these words (#445): the rider
 * who hears "Control lost" hears the sentence a sighted rider reads here, and
 * two copies of it would drift.
 */
export const LOSS_REASON: Readonly<Record<'permission-lost' | 'reset' | 'link-lost', string>> = {
  'permission-lost':
    'The trainer took control back — another app may have asked for it. Ask for control again to keep using ERG.',
  reset: 'The trainer was reset, which ends control by design. Ask for control again to continue.',
  'link-lost':
    'The connection to the trainer dropped, and control does not survive one. Reconnect the trainer, then ask for control again.',
};

/**
 * Why this trainer is not being driven — one sentence per state (#370).
 *
 * ⚠️ **There used to be one sentence for all three, and it was wrong for the
 * middle one.** `vendor-not-implemented` is a real trainer with a real control
 * point that this program has decided not to write to, and it was told
 * *"this trainer does not offer a Fitness Machine control point, or did not
 * report the power range"* — a sentence whose first half is true, whose second
 * half is a guess, and which reads as *"your trainer is not a trainer"*. The
 * rider's next action is different in each case: buy nothing and ride on;
 * check for a firmware update that adds FTMS; or find out why the machine will
 * not report its range.
 *
 * ⚠️ **What the vendor sentence must NOT say is "yet".** ADR-free scope, and
 * `fitness-machine-control.ts` §"What is deliberately not implemented" is why:
 * two independent open-source implementations of the Wahoo characteristic
 * disagree by a factor of ten on the rolling-resistance scaling, and writing an
 * unverifiable scaling to a brake is the safety question CLAUDE.md §6 puts this
 * whole path in. This is a message, not a roadmap.
 */
const NOT_CONTROLLABLE: Readonly<
  Record<
    TrainerSnapshot['controlChoice']['kind'],
    { readonly label: string; readonly text: string }
  >
> = {
  'fitness-machine': {
    label: 'No power range',
    text:
      'This trainer offers a Fitness Machine control point but did not report the power range a ' +
      'target has to be bounded by, so this app will not set one. It still records power and cadence.',
  },
  'vendor-not-implemented': {
    label: 'Records, but cannot be controlled',
    text:
      'This trainer records fine but cannot be controlled from here. Its only control point is its ' +
      "manufacturer's own, which this app does not write to — the published descriptions of it " +
      'disagree about how hard it would brake, and guessing is not something to do to a brake. ' +
      'Power, cadence and speed are unaffected.',
  },
  none: {
    label: 'Not controllable',
    text:
      'This trainer does not offer a control point this app recognises, or did not report the power ' +
      'range a target has to be bounded by. It still records power and cadence.',
  },
};

export interface TrainerPanelProps {
  readonly trainer: TrainerSnapshot;
  readonly onRequestControl: () => void;
  readonly onSetTargetPower: (target: Watts) => void;
  readonly onClearTarget: () => void;
}

export function TrainerPanel({
  trainer,
  onRequestControl,
  onSetTargetPower,
  onClearTarget,
}: TrainerPanelProps): JSX.Element {
  const [draft, setDraft] = useState('150');
  /** A target this app refused before writing it. See {@link submit}. */
  const [problem, setProblem] = useState<string | undefined>(undefined);

  if (!trainer.paired) {
    return (
      <StatusMessage tone="info" label="No trainer">
        Pair a smart trainer to control it from here.
      </StatusMessage>
    );
  }

  if (!trainer.controllable) {
    return (
      <StatusMessage tone="info" label={NOT_CONTROLLABLE[trainer.controlChoice.kind].label}>
        {NOT_CONTROLLABLE[trainer.controlChoice.kind].text}
      </StatusMessage>
    );
  }

  const range = trainer.powerRange;

  /**
   * The one input the browser's own validation lets through and `watts()` will
   * not: **nothing at all**.
   *
   * A `type="number"` field with `min` refuses a negative before the form is
   * submitted, so the interesting hole is the other one — an empty box parses
   * as `Number('') === 0`, and pressing Set would quietly write a 0 W target to
   * a trainer. Zero watts is a legal ERG setpoint, which is exactly why it must
   * not be what an empty field means: the rider intended to type a number, and
   * a trainer that suddenly free-wheels mid-interval is a surprise on the panel
   * that applies physical resistance.
   *
   * The check is on the string rather than on the parsed number, because
   * `Number` maps `''`, `' '` and `'\\n'` all to zero.
   */
  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(parsed) || parsed < 0) {
      setProblem('Enter a target in watts — a number, at least 0 — before setting it.');
      return;
    }
    setProblem(undefined);
    // The guard above is what makes `watts()` total here; it throws on a
    // negative or non-finite value, and an exception out of a React event
    // handler is one no error boundary can reach.
    //
    // An **in-range** check is deliberately not done: the refusal belongs to
    // #43's client, against the range the device reported, and a screen that
    // silently clamped would be telling the rider they asked for something they
    // did not.
    onSetTargetPower(watts(parsed));
  }

  /**
   * ERG, as one thing to do with control — #503. Shown while control is held,
   * and also after it went while a target may still be on the machine, so the
   * "may still be holding" sentence is never hidden by a lost link.
   */
  const ergShown =
    trainer.hasControl || trainer.requested !== undefined || trainer.target.kind !== 'none';

  return (
    <>
      <p className="oyl-trainer__state">{controlSentence(trainer)}</p>

      {/*
        ⚠️ The observable half of the precedence rule (#370).

        `chooseTrainerControl` gives the standard control point priority
        outright, and until it had a caller that priority was applied by
        accident — nothing looked for the vendor's characteristic, so nothing
        could report passing it over. This is the sentence a bug report about a
        trainer that behaves differently under two apps would want to quote, and
        the reason `TrainerControlChoice` carries `vendorAlsoPresent` at all
        rather than dropping it.
      */}
      {trainer.controlChoice.kind === 'fitness-machine' &&
      trainer.controlChoice.vendorAlsoPresent ? (
        <p className="oyl-muted">
          This trainer also carries its manufacturer&rsquo;s own control point. The standard one is
          being used.
        </p>
      ) : null}

      {/*
        ⚠️ Not `live`, since #445: the ONE ride region (`RideAnnouncer.tsx`)
        speaks it, in the announcer's order. A `live` here too would say it
        twice, and could say it in the same second as a lower item. The message
        is still here, unchanged, for a rider who can see it.
      */}
      {trainer.lost === undefined ? null : (
        <StatusMessage tone="warning" label="Control lost">
          {LOSS_REASON[trainer.lost]}
        </StatusMessage>
      )}

      {/*
        #372: a release the trainer did not acknowledge. Rendered whether or
        not control is still held — after a refused Stop it may be either — and
        before the refusal, because it is about the machine under the rider
        rather than about a number they typed.
      */}
      {trainer.releaseFault === undefined ? null : (
        // Not `live` since #445, for the reason *Control lost* above is not.
        <StatusMessage tone="danger" label="Not released">
          {trainer.releaseFault}
        </StatusMessage>
      )}

      {/*
        ⚠️ **These two stay `live`, and that is decided rather than missed
        (#445).** Each is the answer to the rider's OWN press — *Set target*, or
        *Ask the trainer for control* — on the form their focus is in, so it is
        the one moment they are waiting to hear something and no reading is
        competing for it. The announcer's throttle exists for sentences the
        rider did not ask for; putting an answer they did ask for behind a
        routine sentence's window would delay it for no one's benefit.
      */}
      {trainer.refusal === undefined ? null : (
        <StatusMessage tone="danger" label="Refused" live>
          {trainer.refusal}
        </StatusMessage>
      )}

      {problem === undefined ? null : (
        <StatusMessage tone="danger" label="Not sent" live>
          {problem}
        </StatusMessage>
      )}

      {trainer.hasControl ? null : (
        <Button onClick={onRequestControl}>Ask the trainer for control</Button>
      )}

      {!ergShown ? null : !trainer.canSetPower ? (
        // Target Setting bit 3 is clear. Offering a control the trainer will
        // refuse is worse than not offering it — the revision block says so in
        // as many words — so the form is not rendered at all. ⚠️ Since #503
        // this no longer hides the control step above: a trainer with no ERG
        // may still be driven by the game.
        <StatusMessage tone="info" label="No ERG">
          This trainer reports that it does not accept a power target, so there is no ERG control to
          offer.
        </StatusMessage>
      ) : (
        // ⚠️ A label on the sentence rather than an `h3`, and that is MEASURED:
        // an ERG heading and the longer control sentence above it put the
        // workout's *Ride* 174 px lower at 1280×800 and under the fold inside
        // the Android shell (`rideview.browser.spec.ts` §"clears the fold"). The
        // label says the same thing — ERG is optional, one thing control is
        // for — in the line the target sentence already took.
        <div>
          <p className="oyl-trainer__erg">
            <strong>ERG, optional:</strong> {targetSentence(trainer)}
          </p>
          {trainer.hasControl ? (
            <form className="oyl-trainer__form" onSubmit={submit}>
              <label htmlFor="oyl-erg-target">ERG target (W)</label>
              <input
                id="oyl-erg-target"
                className="oyl-input"
                type="number"
                inputMode="numeric"
                min={range?.minimum}
                max={range?.maximum}
                step={range?.increment}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Button type="submit">Set target</Button>
              <Button variant="secondary" onClick={onClearTarget}>
                End ERG
              </Button>
              {range === undefined ? null : (
                <p className="oyl-muted">
                  This trainer accepts {range.minimum} W to {range.maximum} W in steps of{' '}
                  {range.increment} W. A target is quantised to that step before it is written.
                </p>
              )}
            </form>
          ) : null}
        </div>
      )}
    </>
  );
}

/**
 * Whether this app holds the trainer, and what that is for — #503.
 *
 * ⚠️ **Names all three things control is for**, ERG last, because until #503
 * the panel spoke of nothing but ERG and a rider read control as ERG's.
 */
function controlSentence(trainer: TrainerSnapshot): string {
  // ⚠️ Short when control is held, because that is the state the Ride screen
  // is measured in (`rideview.browser.spec.ts`): the longer sentence cost the
  // workout's *Ride* its place above the fold on a tablet. What control is FOR
  // is said by what follows it — *ERG, optional* and *Ride a workout*.
  return trainer.hasControl
    ? 'This app has control of the trainer.'
    : 'This app does not have control of the trainer. Ask for it here to ride a workout or hold a fixed power — the trainer game asks for it itself when you press Ride.';
}

/**
 * The one sentence that says what the trainer is doing.
 *
 * Exported so `RideView.test.tsx` can assert on it directly as well as through
 * the DOM — the four branches are the acceptance criterion, and a test that
 * only ever saw two of them would pass while the other two said the wrong
 * thing.
 */
export function targetSentence(trainer: TrainerSnapshot): string {
  if (trainer.requested !== undefined) {
    return `Asked for ${String(trainer.requested)} W — waiting for the trainer to confirm.`;
  }
  switch (trainer.target.kind) {
    case 'confirmed':
      return `Holding ${String(trainer.target.target)} W.`;
    case 'unknown':
      return `The trainer may still be holding ${String(trainer.target.attempted)} W — this app can no longer tell.`;
    case 'none':
      // #503: control has its own sentence now (`controlSentence`), so this
      // one speaks only of ERG.
      return trainer.hasControl
        ? 'No target set. The trainer is following your effort.'
        : 'No target set.';
  }
}
