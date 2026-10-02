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

import { TREND_WINDOW, watts, type Watts } from '@onyourleft/domain';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';

import { hrefFor, routeById } from '../shell/routes';
import { MANUAL_ERG_DURING_WORKOUT, type TrainerSnapshot } from './controller';
import type { ManualErgRescue } from './manual-erg';

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
  /**
   * A workout is loaded and owns the trainer's target — #605. The ERG form is
   * then not offered: every *Set target* would be refused
   * ({@link MANUAL_ERG_DURING_WORKOUT}) and *End ERG* would end the workout,
   * which *End workout* already does. "Offering a control the trainer will
   * refuse is worse than not offering it" (the *No ERG* branch below) applies
   * as much to a control THIS app will refuse.
   *
   * ⚠️ **Measured, and it is why this is here rather than a tidy-up.** With a
   * workout running the form was 248 px of the trainer column, and with the
   * workout eased it put *End workout* 233 px under the fold at 1280×800
   * inside the Android shell — a stalled rider could not see the control that
   * ends what is holding them. Without a rescue it cleared the fold by 24 px,
   * under §4f's 50. `rideview.browser.spec.ts` §"#605".
   *
   * Required rather than optional, so a screen that forgets it is a compile
   * error rather than a form that comes back (CLAUDE.md §4j's §Limits: an
   * optional prop nobody supplies is invisible to the wiring gate).
   */
  readonly workoutOwnsTarget: boolean;
  /**
   * Whether the rider turned announcements on — #655. It decides WHICH voice
   * answers a *Set* the stall rescue held ({@link HELD_LABEL}): on, the ride's
   * one region (`RideAnnouncer.tsx`, `erg-held`), in its order; off, this
   * panel's own message, `live`, as *Refused* is. One of the two and never
   * both, so a screen reader hears the answer once. Read from the same place,
   * at mount, as `RideAnnouncer` reads it.
   *
   * Required, for {@link workoutOwnsTarget}'s reason.
   */
  readonly announcementsOn: boolean;
}

/** The word a held *Set* is answered with — #655. Shown and spoken. */
export const HELD_LABEL = 'Held';

export function TrainerPanel({
  trainer,
  onRequestControl,
  onSetTargetPower,
  onClearTarget,
  workoutOwnsTarget,
  announcementsOn,
}: TrainerPanelProps): JSX.Element {
  const [draft, setDraft] = useState('150');
  /**
   * The held answer standing when this panel appeared, which is not said — a
   * screen a rider comes back to answers no press they made on it (#394's
   * rule). A press made here has a new number and is.
   */
  const [heldAtMount] = useState(() => trainer.ergHeld?.press);
  /** A target this app refused before writing it. See {@link submit}. */
  const [problem, setProblem] = useState<string | undefined>(undefined);

  if (!trainer.paired) {
    return (
      <StatusMessage tone="info" label="No trainer">
        Pair a smart trainer to control it from here — pairing is on{' '}
        {/* #659: the Pair buttons moved to Devices; this sentence says where. */}
        <a href={hrefFor(routeById('devices'))}>Devices</a>.
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

  /** #605: a workout owns the target while control is held, so no form. */
  const refuseByHand = workoutOwnsTarget && trainer.hasControl;

  return (
    <>
      {/* #1013: trainer-control text is kept on the screen, never tucked behind
        a section's help, and the mark says so to the gates that read it. A mark
        on the paragraph rather than a wrapper, so the layout the Ride screen's
        fold is measured against does not move. */}
      <p className="oyl-trainer__state" data-oyl-kept-visible="">
        {controlSentence(trainer)}
      </p>

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
        #567: a hand-set target the stall rescue has eased. Says the rider's
        own number, why it is not on the machine, and that it comes back by
        itself — the decision #567 asked to be stated. Not `live`, for the
        reason *Control lost* above is not: the ONE ride region speaks, and
        this is not the answer to a press. Since #598 it does speak it —
        `RideAnnouncer.tsx` says this sentence when it appears or its reason
        changes; until then only a sighted rider was told.
      */}
      {trainer.ergRescue === undefined ? null : (
        <StatusMessage tone="warning" label="Eased">
          {rescueSentence(trainer.ergRescue)}
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
        <Button variant="secondary" size="ride" onClick={onRequestControl}>
          Ask the trainer for control
        </Button>
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
          {/*
            ⚠️ #605's review (B1): a loaded workout replaces the FORM and
            nothing else. The target sentence stays in every state it was shown
            in before — above all "may still be holding N W — this app can no
            longer tell", which is what a workout whose link dropped leaves on
            the machine (`controller.ts` §`onControlLost` keeps the workout).
            The refusal is said only while control is held, because with the
            link gone the workout is setting nothing and it would be false.
            It rides in the same paragraph rather than its own, which is
            measured: a paragraph of its own cost the Eased notice 41 px of its
            margin to the fold at 1280×800 in the shell. Since #605's re-review
            it is short enough to cost NO line upright, where the paragraph is
            above the notice in one column — `controller.ts`
            §`MANUAL_ERG_DURING_WORKOUT`, held by `rideview.browser.spec.ts`.
          */}
          <p className="oyl-trainer__erg" data-oyl-kept-visible="">
            <strong>ERG, optional:</strong> {targetSentence(trainer)}
            {refuseByHand ? ` ${MANUAL_ERG_DURING_WORKOUT}` : null}
          </p>
          {!trainer.hasControl || refuseByHand ? null : (
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
              <Button variant="secondary" size="ride" type="submit">
                Set target
              </Button>
              <Button variant="secondary" onClick={onClearTarget}>
                End ERG
              </Button>
              {range === undefined ? null : (
                <p className="oyl-muted" data-oyl-kept-visible="">
                  This trainer accepts {range.minimum} W to {range.maximum} W in steps of{' '}
                  {range.increment} W. A target is quantised to that step before it is written.
                </p>
              )}
            </form>
          )}
          {/*
            #655: a *Set* the stall rescue held — the answer to the rider's own
            press. Keyed on the press, so a second *Set* of the same number is
            a new message rather than no change. `live` only with announcements
            off: on, the ride's one region says it (`RideAnnouncer.tsx`), and a
            second voice would say it twice. The rescue notice above names the
            pending target too; this line is what answers the press.

            ⚠️ **UNDER the form since #740, and a reviewer who remembers it
            above, in the slot *Refused* takes, is reading the old file.**
            There it pushed *End ERG* — the control the Eased sentence itself
            names — 11.7 px UNDER the fold on the owner's tablet in the Android
            shell and to 20.5 px at 1024×720 (`rideview.html?erg=held`, the
            first fixture to render a manual rescue). #692's rule: nothing
            whose height changes during a ride sits above a ride control in its
            column. Right after *Set target*, it is still where the eye is.
          */}
          {trainer.ergHeld === undefined ? null : (
            <StatusMessage
              key={trainer.ergHeld.press}
              tone="info"
              label={HELD_LABEL}
              live={!announcementsOn && trainer.ergHeld.press !== heldAtMount}
            >
              {heldSentence(trainer.ergHeld.target)}
            </StatusMessage>
          )}
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
  // #509: shortened. It used to run on "…here to ride a workout or hold a
  // fixed power — the trainer game asks for it itself when you press Ride."
  return trainer.hasControl
    ? 'This app has control of the trainer.'
    : 'This app does not have control of the trainer. Ask for it to ride a workout or set ERG; the trainer game asks when you press Ride.';
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

/** How long cadence must hold before a rescue hands back, in words. */
const STEADY = `your cadence has held steady for ${String(TREND_WINDOW)} seconds`;

/**
 * What the panel says while a hand-set target is eased — #567.
 *
 * ⚠️ **It states the decision**: the rider's target is put back by itself once
 * cadence has held steady, which is what a workout does (`manual-erg.ts` §"After
 * the rider recovers"). *End ERG*, beside it, is the way to keep it off.
 *
 * The window is read off {@link TREND_WINDOW} rather than typed, so the
 * sentence cannot go quietly wrong when #137 recalibrates it (PR #582's review).
 *
 * Exported because `RideAnnouncer.tsx` SPEAKS it (#598): a rider who cannot see
 * the panel hears the words it shows, not a second wording of them.
 */
export function rescueSentence(rescue: ManualErgRescue): string {
  // PR #582's third review: the number named is only ever one the machine
  // ACCEPTED. A target the rider set during the rescue is not written until it
  // ends — the rescue is the only writer — and is said as that, separately.
  //
  // PR #582's fourth review: from the floor the way back is two steps — a
  // lighter target as soon as the rider is pedalling again, and theirs only
  // once a whole window of that has held — so the floor says both. A rescue
  // always has an accepted target to name: a trainer that has none is never
  // rescued (`manual-erg.ts` rule 6).
  const lighterFirst =
    rescue.holding === 'floor'
      ? ' Once you are pedalling again it steps up to a lighter target first.'
      : '';
  const back =
    rescue.pending !== undefined
      ? `${lighterFirst} ${heldSentence(rescue.pending)}`
      : `${lighterFirst} Your ${String(rescue.target)} W comes back by itself once ${STEADY}.`;
  return `${rescue.reason}${back} Press End ERG to leave it off.`;
}

/**
 * The answer to a *Set* the stall rescue held — #655. ONE sentence, and the
 * same one {@link rescueSentence} carries while a target is pending, so the
 * press answer and the notice cannot drift apart: the answer is that sentence
 * alone, not the whole rescue said again.
 *
 * Exported because `RideAnnouncer.tsx` speaks it, after {@link HELD_LABEL}.
 */
export function heldSentence(target: Watts): string {
  return `Your new target of ${String(target)} W will be set once ${STEADY}.`;
}
