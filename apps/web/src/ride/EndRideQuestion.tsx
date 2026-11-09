// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The end-of-ride question** — [#2349](https://github.com/openzigs/onyourleft/issues/2349),
 * the owner's request of 2026-11-07: *"When a user quits a ride we should make
 * sure they really want to quit and ask to save or discard."*
 *
 * One component for every place a ride can be ended: the Ride screen's *Stop*
 * (`views/RideView.tsx`) and the game's *End ride* (`game/GameView.tsx`, drawn
 * in the HUD's actions panel). Each owns WHEN it is open and what each answer
 * does; this owns what the question says and how it behaves, so the two
 * surfaces cannot drift apart.
 *
 * ## What it asks
 *
 * - **`ask`** — *Keep riding*, *Save ride* and *Discard ride*. A ride with
 *   nothing recorded (`canSave` false: under `recording/finish.ts`'s minimum,
 *   one sample) is offered *Keep riding* and *Discard ride* only.
 * - **`discard`** — asked once more, because discarding is the one answer that
 *   deletes the device copy (ADR 0036 D-3): *Keep riding* and *Discard ride*.
 * - **Nothing recorded under the ride at all** (`recorded` false, #2381: a
 *   simulated ride, a preview, a ride whose recording could not start) —
 *   *Keep riding* and *End ride*, ONE step. There is nothing to save and
 *   nothing to delete, so neither answer is offered and nothing is asked
 *   twice; the one question stays, so a stray press or back does not end the
 *   ride.
 *
 * ## Keep riding is the default, and that is behaviour rather than a style
 *
 * - It is the filled button, the first answer of the `ask` step, and focus
 *   moves to it when the question opens after a press and again when the
 *   discard step replaces the first (WCAG 2.2 SC 2.4.3, `Button.tsx`
 *   §`focusOnMount`). So a key pressed twice, or Enter held, keeps riding.
 * - **Escape is Keep riding**, from anywhere on the page while the question
 *   is open. Android's back is too (`shell/ride-back.ts`).
 * - The second *Discard ride* never stands where the first did: the first is
 *   the LAST answer of the `ask` step, the confirmation the FIRST of the
 *   `discard` step's two. A double tap on *Discard ride* lands on *Keep
 *   riding* or on nothing.
 *
 * ## In place, and never a modal
 *
 * `design/ConfirmDialog.tsx` records the rule: nothing may make a ride screen
 * inert, and the Ride screen's stop confirmation has always been in-place
 * buttons. This is that pattern, widened to three answers. Nothing here is a
 * `danger` button, because that variant is for a modal only
 * (`a11y/button-hierarchy.ts`).
 *
 * ## What asking changes: nothing
 *
 * Opening the question writes nothing to the trainer and stops nothing: the
 * ride carries on as it was, paused or not, until an answer is pressed. That
 * is the surfaces' to keep true and `controller.test.ts` §"#2349" asserts it
 * against the simulated trainer.
 *
 * ## The touch lock
 *
 * In the HUD every answer is exempt (`touch-lock.ts`), as the *End ride* that
 * opens it is (#1482): a rider who pressed *End ride* through the lock must be
 * able to answer it, and it is a release of the trainer's resistance. On the
 * Ride screen none is: *Stop* is not exempt there, and the lock's own sentence
 * says taps do nothing but *End ERG* and *End workout* (#1432), so a question
 * opened before the lock went on is answered with a key, as the confirmation
 * it replaced was.
 */

import { useEffect, useEffectEvent, type JSX } from 'react';

import { Button } from '../design/Button';
import { StatusMessage } from '../design/StatusMessage';

/** Which question is on screen. */
export type EndRideStep = 'ask' | 'discard';

/** Every word the question says. ⚠️ Draft wording for the owner (#2349). */
export const END_RIDE_TEXT = {
  save: 'Save ride',
  discard: 'Discard ride',
  keep: 'Keep riding',
  /** The label of the `ask` step's message. */
  askLabel: 'End this ride?',
  /** The `ask` step, with something recorded. */
  ask: 'Save it to your activities, or discard it. Keep riding carries on as you were.',
  /** The `ask` step, with nothing recorded (#2349, item 6). */
  askNothingRecorded:
    'Nothing has been recorded yet, so there is no ride to save. Discard it, or keep riding.',
  /**
   * The HUD's `ask` step with nothing recorded, after the label — #2349. The
   * HUD shows the label alone otherwise: its panel has no room for the Ride
   * screen's sentence on a phone (`ride-hud-layout.browser.spec.ts`
   * §"#2349"), and the HUD's one region says the whole of it.
   */
  hudNothingRecorded: 'Nothing is recorded to save.',
  /** The label of the `discard` step's message. */
  discardLabel: 'Discard this ride?',
  /** The `discard` step — the owner's sentence (#2349, item 2). */
  discardWarning: 'This ride will be deleted from this device. It can’t be undone.',
  /**
   * The `ask` step's sentence for a ride with NO recording under it (#2381,
   * the owner's 2026-11-08 comment): a simulated ride, a preview, a ride whose
   * recording could not start. Nothing is saved or deleted, so neither *Save
   * ride* nor the deletion warning would be true. On both surfaces, after
   * {@link END_RIDE_TEXT.askLabel}. ⚠️ Draft wording for the owner.
   */
  askNotRecorded: 'Nothing is being recorded, so nothing is saved or deleted.',
  /** That step's one answer that ends the ride (#2381). */
  end: 'End ride',
} as const;

export interface EndRideQuestionProps {
  readonly step: EndRideStep;
  /** Whether *Save ride* is offered: something is recorded to save. */
  readonly canSave: boolean;
  /**
   * Whether anything is recorded under the ride, so that *Discard ride*
   * deletes something. False (#2381): the question is one step, *Keep
   * riding* and *End ride*, which calls {@link onConfirmDiscard} — there is
   * no deletion to warn of or confirm. Absent is true, which is every
   * Ride-screen use.
   */
  readonly recorded?: boolean;
  readonly onSave: () => void;
  /** The `ask` step's *Discard ride*: asks once more. */
  readonly onDiscard: () => void;
  /**
   * The `discard` step's *Discard ride*: ends the ride and deletes it. With
   * nothing recorded, the `ask` step's *End ride*, which deletes nothing.
   */
  readonly onConfirmDiscard: () => void;
  /** *Keep riding*, Escape, and back: closes the question and changes nothing else. */
  readonly onKeepRiding: () => void;
  /**
   * Whether the question was opened by a press on this screen, so focus moves
   * into it. A screen mounted with the question already open (the rider went
   * to another screen and back) leaves focus where it is (`Button.tsx`
   * §`focusOnMount`: never move focus without a press).
   */
  readonly focusOnOpen: boolean;
  /**
   * Where it is drawn. `ride-screen`: the message is a `StatusMessage` and its
   * own live region, as the stop confirmation always was. `hud`: one short
   * line in the HUD's actions panel and NO live region, because the HUD has
   * ONE (#445) and `GameView` says the question through it — the label alone
   * for the `ask` step, and the owner's warning for the `discard` step, which
   * is the one sentence a rider must read before the answer that deletes.
   * Measured, not chosen: the Ride screen's message made the panel 307 px tall
   * and ran it off a phone on its side (`ride-hud-layout.browser.spec.ts`
   * §"#2349").
   */
  readonly surface: 'ride-screen' | 'hud';
  /** A class for the surface's own layout. */
  readonly className: string;
}

/** The question. @see EndRideQuestionProps */
export function EndRideQuestion(props: EndRideQuestionProps): JSX.Element {
  const keepRiding = useEffectEvent(() => {
    props.onKeepRiding();
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        keepRiding();
      }
    };
    globalThis.document.addEventListener('keydown', onKey);
    return () => {
      globalThis.document.removeEventListener('keydown', onKey);
    };
  }, []);

  const discarding = props.step === 'discard';
  const hud = props.surface === 'hud';
  // #2381: nothing under the ride to save or delete — one step, see above.
  const unrecorded = props.recorded === false;
  const label = discarding ? END_RIDE_TEXT.discardLabel : END_RIDE_TEXT.askLabel;
  const sentence = discarding
    ? END_RIDE_TEXT.discardWarning
    : unrecorded
      ? END_RIDE_TEXT.askNotRecorded
      : props.canSave
        ? END_RIDE_TEXT.ask
        : END_RIDE_TEXT.askNothingRecorded;
  const hudSentence = discarding
    ? END_RIDE_TEXT.discardWarning
    : unrecorded
      ? END_RIDE_TEXT.askNotRecorded
      : props.canSave
        ? undefined
        : END_RIDE_TEXT.hudNothingRecorded;
  return (
    <div className={props.className} role="group" aria-label={label} data-oyl-end-ride={props.step}>
      {props.surface === 'ride-screen' ? (
        // "Confirm", the stop confirmation's own label: the question itself
        // ends in a question mark, and a label is followed by a colon.
        <StatusMessage tone="warning" label="Confirm" live>
          {label} {sentence}
        </StatusMessage>
      ) : (
        <p className="oyl-end-ride__question">
          <strong>{label}</strong>
          {hudSentence === undefined ? null : ` ${hudSentence}`}
        </p>
      )}
      <div className="oyl-end-ride__answers">
        {discarding ? (
          // FIRST of two, so it never stands where the first *Discard ride*
          // did (the last answer of the `ask` step): see the module note.
          <Button
            variant="secondary"
            size="ride"
            touchLockExempt={hud}
            onClick={props.onConfirmDiscard}
          >
            {END_RIDE_TEXT.discard}
          </Button>
        ) : null}
        <Button
          // Keyed on the step, so the discard step mounts a NEW Keep riding
          // and `focusOnMount` moves focus to it: the press that revealed the
          // step was on a control that is gone. ⚠️ Not described by the
          // sentence: on the Ride screen that is a live region already, and a
          // description would have it read a second time (#1430).
          key={props.step}
          size="ride"
          focusOnMount={discarding || props.focusOnOpen}
          touchLockExempt={hud}
          onClick={props.onKeepRiding}
        >
          {END_RIDE_TEXT.keep}
        </Button>
        {discarding ? null : unrecorded ? (
          <Button
            variant="secondary"
            size="ride"
            touchLockExempt={hud}
            onClick={props.onConfirmDiscard}
          >
            {END_RIDE_TEXT.end}
          </Button>
        ) : (
          <>
            {props.canSave ? (
              <Button variant="secondary" size="ride" touchLockExempt={hud} onClick={props.onSave}>
                {END_RIDE_TEXT.save}
              </Button>
            ) : null}
            <Button variant="secondary" size="ride" touchLockExempt={hud} onClick={props.onDiscard}>
              {END_RIDE_TEXT.discard}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
