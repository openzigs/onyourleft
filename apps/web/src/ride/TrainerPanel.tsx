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

/** Human words for why control went. Each is a different thing to do next. */
const LOSS_REASON: Readonly<Record<'permission-lost' | 'reset' | 'link-lost', string>> = {
  'permission-lost':
    'The trainer took control back — another app may have asked for it. Ask for control again to keep using ERG.',
  reset: 'The trainer was reset, which ends control by design. Ask for control again to continue.',
  'link-lost':
    'The connection to the trainer dropped, and control does not survive one. Reconnect the trainer, then ask for control again.',
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
        Pair a smart trainer to set an ERG target from here.
      </StatusMessage>
    );
  }

  if (!trainer.controllable) {
    return (
      <StatusMessage tone="info" label="Not controllable">
        This trainer does not offer a Fitness Machine control point, or did not report the power
        range a target has to be bounded by. It still records power and cadence.
      </StatusMessage>
    );
  }

  if (!trainer.canSetPower) {
    // Target Setting bit 3 is clear. Offering a control the trainer will refuse
    // is worse than not offering it — the revision block says so in as many
    // words — so the form is not rendered at all.
    return (
      <StatusMessage tone="info" label="No ERG">
        This trainer reports that it does not accept a power target, so there is no ERG control to
        offer.
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

  return (
    <>
      <p className="oyl-trainer__state">{targetSentence(trainer)}</p>

      {trainer.lost === undefined ? null : (
        <StatusMessage tone="warning" label="Control lost" live>
          {LOSS_REASON[trainer.lost]}
        </StatusMessage>
      )}

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
      ) : (
        <Button onClick={onRequestControl}>Ask the trainer for control</Button>
      )}
    </>
  );
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
      return trainer.hasControl
        ? 'No target set. The trainer is following your effort.'
        : 'This app does not have control of the trainer.';
  }
}
