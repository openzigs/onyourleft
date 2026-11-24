// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The HUD's junction prompt — #2898, under ADR 0088 D-1.2, D-1.5, D-3 and
 * D-3.1.
 *
 * On an open-world ride, from `JUNCTION_PROMPT_METRES` (250 m) before the next
 * junction, the HUD draws every way on from it, from the furthest left to the
 * furthest right, each as a button with an arrow that points **the way's own
 * direction** (its turn from the rider's heading: the owner's ruling of
 * 2026-11-20 recorded on ADR 0088), its name, whether it is the default and
 * whether it is chosen, and the key and pad button that take it. Over them,
 * how far until the choice is final, or that it is (D-1.5). A U-turn button
 * stands with the ride controls for the whole ride (D-1.6, D-3):
 * {@link JunctionUTurn}.
 *
 * ## A pop-up of its own, which no fade reaches — #3053
 *
 * The owner's report and ruling of 2026-11-22 (ADR 0088's amendment of that
 * date): the ways were drawn in the ride controls' panel, which fades and is
 * then clipped with no touch (`controls-reveal.ts`, ADR 0075), so a rider not
 * touching the screen did not see the junction coming. {@link
 * JunctionChoicePrompt} is now a pop-up in the upper middle of the view,
 * `HudCore`'s own child rather than the actions panel's, and carries no
 * `HIDES_ATTRIBUTE`: it is drawn from the prompt's 250 m until the choice is
 * final and {@link JUNCTION_LOCKED_SHOWN_MILLISECONDS} after, showing the
 * chosen way alone once it is. The first tap on a way is that way's press,
 * hidden controls or not: `controls-reveal.ts` swallows only a tap on a
 * control that hides. Where it is drawn is `theme.css` §"#3053", and
 * `junction-prompt.browser.spec.ts` measures it clear of the rider. The
 * U-turn, which is not a junction's, stays with the controls and fades with
 * them, so a first tap on it while they are hidden only shows them.
 *
 * ## Which press takes which way comes from the choice, not from here
 *
 * Since the owner's inward-step ruling, which press takes a way is not its
 * position: at ways leaving at −90°, −30° and 0°, the right press takes −30°.
 * So every label, and every tap, is read from `junction-choice.ts`
 * §`pressesOfWays`, which is built from the same rule a press applies (the
 * review of #2964). A tap is that press, through `turn-input.ts`
 * §`turnOfSymbol` (D-3.1.1): one discrete press through the one path the keys
 * take. With more than three ways on, a way no single press reaches shows no
 * key, and a tap on it is one step toward it (D-1.3's stepping, D-3.1).
 *
 * ## Keys
 *
 * While {@link JunctionUTurn} is mounted, which is the whole of an open-world
 * ride, a turn key (`turn-input.ts` §`TURN_KEYS`: the arrows,
 * Page Up and Page Down) is a press, read with the ride keys' discipline
 * (`lanes.ts` §`intentOfKeyIn`), as `ThrowControl.tsx` reads the throw keys.
 * A pad's turn buttons reach the same press through `GamepadIntents.tsx`.
 * Every button is also in the tab order and works with Enter, so the prompt
 * is operable by keyboard alone either way (SC 2.1.1).
 *
 * ## The touch lock stays whole (D-3.1.3, ADR 0059 D-5)
 *
 * Rendered inside the HUD's locked region, and **none of it carries
 * `TOUCH_LOCK_EXEMPT`**: while the lock is on the ways still show the choice
 * and take no tap, a key or a pad still chooses, and the prompt says so in
 * words. ⚠️ The buttons are never `disabled`, for `ThrowControl.tsx`'s reason:
 * a disabled button cannot be focused or pressed with Enter either. Once the
 * choice is final they carry `aria-disabled`, and a press then does nothing
 * because the rolling route refuses it (`RollingRoute.choose`), not because
 * this module decides so.
 *
 * ## Said, not only shown
 *
 * Nothing here is a live region: the HUD's one region is the announcer's
 * (#445). What the prompt says aloud as it appears, as the choice changes and
 * as it locks is `junction-text.ts` §`junctionEvent`, which the ride feeds to
 * `announce.ts`.
 *
 * ## Nothing here can reach the trainer
 *
 * It imports the choice's types and its press mapping, the turn keys, and the
 * HUD's sizes. A press changes only which branch the rolling route appends
 * (D-5.1); `open-world-cannot-reach-trainer.test.ts` walks this module as a
 * root (D-5.2), and `JunctionChoicePrompt.test.tsx` rides the behavioural ride
 * once more with the turn taken by a tap (D-5.3).
 *
 * Mounted only on a ride that hands the HUD a junction: an open-world ride,
 * which `GameView` hands it (#3013).
 */

import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react';

import type { UnitSystem } from '@onyourleft/store';

import { RIDE_SIZE_CLASS } from '../../design/Button';
import { VisuallyHidden } from '../../design/VisuallyHidden';
import {
  pressesOfWays,
  type JunctionPrompt,
  type TurnNotice,
  type TurnPress,
} from '../open-world/junction-choice';
import { turnOfKey, turnOfSymbol, type TurnSymbol } from '../open-world/turn-input';
import { HIDES_ATTRIBUTE } from './controls-reveal';
import { CONTROL_MINIMUM_PIXELS } from './HudCore';
import {
  JUNCTION_BY_KEY_SENTENCE,
  JUNCTION_CHOSEN_WORD,
  JUNCTION_DEFAULT_WORD,
  JUNCTION_LOCKED_LINE,
  JUNCTION_PROMPT_TITLE,
  lockLine,
  TURN_NOTICE_WORDS,
  U_TURN_NAME,
  wayStreetLine,
  wayWord,
} from './junction-text';

/** What the HUD is handed for an open-world ride's junctions. */
export interface JunctionInput {
  /**
   * The prompt for the next junction as the rider stands now
   * (`JunctionChoice.prompt`), or `undefined` while none is within
   * `JUNCTION_PROMPT_METRES`.
   */
  readonly prompt: JunctionPrompt | undefined;
  /** One press, from the screen, a key or a pad: `JunctionChoice.press` at the rider's distance. */
  readonly press: (press: TurnPress) => void;
  /**
   * The turn notice standing (`JunctionChoice.notice`), drawn in the pop-up
   * in place of the junction for as long as it stands (#3058).
   */
  readonly notice?: TurnNotice | undefined;
}

export interface JunctionChoicePromptProps {
  readonly junction: JunctionInput;
  /** The HUD's touch lock is on. */
  readonly touchLocked: boolean;
  readonly units: UnitSystem;
}

/**
 * How long the pop-up stays once the choice is final, showing the chosen way
 * alone, before it goes — #3053's *"shows the chosen way briefly and then goes
 * away"*. Two seconds: long enough to read one word at a glance, and gone
 * well before a rider at 13 mph reaches the junction 100 m on (about 17 s).
 * The maintainer's number, open to the owner on the tablet.
 */
export const JUNCTION_LOCKED_SHOWN_MILLISECONDS = 2_000;

/**
 * The key and the pad button that make each press, as the prompt shows them:
 * the first key of `turn-input.ts` §`TURN_KEYS` for it, and its face button of
 * §`TURN_PAD_BUTTONS` by where it sits on a standard pad, because what the
 * button is called is its maker's (#1892).
 */
export const TURN_HINTS: Readonly<
  Record<
    TurnPress,
    {
      readonly key: string;
      readonly glyph: string;
      readonly spokenKey: string;
      readonly padButton: number;
    }
  >
> = Object.freeze({
  left: { key: 'ArrowLeft', glyph: '←', spokenKey: 'left arrow', padButton: 2 },
  straight: { key: 'ArrowUp', glyph: '↑', spokenKey: 'up arrow', padButton: 0 },
  right: { key: 'ArrowRight', glyph: '→', spokenKey: 'right arrow', padButton: 1 },
  'u-turn': { key: 'ArrowDown', glyph: '↓', spokenKey: 'down arrow', padButton: 3 },
});

/** Where each standard face button sits, as the pad hint draws and says it. */
const PAD_PLACES: Readonly<
  Record<number, { readonly x: number; readonly y: number; readonly word: string }>
> = {
  0: { x: 0, y: 6, word: 'bottom' },
  1: { x: 6, y: 0, word: 'right' },
  2: { x: -6, y: 0, word: 'left' },
  3: { x: 0, y: -6, word: 'top' },
};

const SYMBOLS: Readonly<Record<TurnPress, TurnSymbol>> = {
  left: 'turn-left',
  straight: 'turn-straight',
  right: 'turn-right',
  'u-turn': 'turn-u-turn',
};

/**
 * The ids the buttons' `aria-describedby` and the group's label name. One HUD
 * per page. The pop-up's ways and the U-turn are in different places since
 * #3053, so each says the touch lock's sentence where it is drawn.
 */
const TITLE_ID = 'oyl-hud-junction-title';
const NOTE_ID = 'oyl-hud-junction-note';
const U_TURN_NOTE_ID = 'oyl-hud-junction-u-turn-note';

/** An arrow pointing `turnDegrees` from straight up: the way's own direction. */
function WayArrow(props: { readonly turnDegrees: number }): JSX.Element {
  return (
    <svg
      className="oyl-hud__junction-arrow"
      viewBox="-12 -12 24 24"
      width="32"
      height="32"
      aria-hidden="true"
      focusable="false"
    >
      <g transform={`rotate(${String(Math.round(props.turnDegrees))})`}>
        <path d="M0 -11 L7 -3 L2.5 -3 L2.5 11 L-2.5 11 L-2.5 -3 L-7 -3 Z" fill="currentColor" />
      </g>
    </svg>
  );
}

/** The four face buttons, the one that makes `button` filled. */
function PadGlyph(props: { readonly button: number }): JSX.Element {
  return (
    <svg
      className="oyl-hud__junction-pad"
      viewBox="-10 -10 20 20"
      width="20"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      {Object.entries(PAD_PLACES).map(([at, place]) => (
        <circle
          key={at}
          cx={place.x}
          cy={place.y}
          r="2.6"
          fill={Number(at) === props.button ? 'currentColor' : 'none'}
          stroke="currentColor"
          strokeWidth="1"
        />
      ))}
    </svg>
  );
}

/** The key and pad hints for `presses`, drawn, and said in words beside them. */
function Hints(props: { readonly presses: readonly TurnPress[] }): ReactNode {
  if (props.presses.length === 0) return null;
  const hints = props.presses.map((press) => TURN_HINTS[press]);
  return (
    <span className="oyl-hud__junction-hints">
      {hints.map((hint) => (
        <span key={hint.key} className="oyl-hud__junction-hint" aria-hidden="true">
          <kbd>{hint.glyph}</kbd>
          <PadGlyph button={hint.padButton} />
        </span>
      ))}
      <VisuallyHidden>
        {`, key ${hints.map((hint) => hint.spokenKey).join(' or ')}, pad ${hints
          .map((hint) => `${PAD_PLACES[hint.padButton]?.word ?? ''} button`)
          .join(' or ')}`}
      </VisuallyHidden>
    </span>
  );
}

/** A way's tap: one discrete press through the keys' path (D-3.1.1). */
function tapOf(junction: JunctionInput): (turn: TurnPress) => void {
  return (turn) => {
    junction.press(turnOfSymbol(SYMBOLS[turn]));
  };
}

/**
 * Each control's ride-time size. A function, read as each renders: `HudCore`
 * imports this module and this module reads its floor, so at this module's
 * first evaluation `CONTROL_MINIMUM_PIXELS` is not yet defined.
 */
function size(): { readonly minWidth: number; readonly minHeight: number } {
  return { minWidth: CONTROL_MINIMUM_PIXELS, minHeight: CONTROL_MINIMUM_PIXELS };
}

/**
 * The junction's pop-up — #3053. @see the module header
 *
 * Nothing at all while no junction is within the prompt's reach, and nothing
 * once the choice has been final for {@link JUNCTION_LOCKED_SHOWN_MILLISECONDS}.
 * While a turn notice stands (#3058) it is that notice's words alone:
 * *Turning round*, *Dead end: turning round* or *No junction yet*.
 */
export function JunctionChoicePrompt(props: JunctionChoicePromptProps): JSX.Element | null {
  const { junction, touchLocked, units } = props;
  const shown = junction.prompt;
  // The junction whose pop-up has gone, after its brief look at the way chosen.
  // By its ride distance: a junction is the one at that distance on this ride.
  const [goneFor, setGoneFor] = useState<number | undefined>(undefined);
  const lockedAt = shown?.locked === true ? shown.distance : undefined;
  useEffect(() => {
    if (lockedAt === undefined) return undefined;
    const timer = setTimeout(() => {
      setGoneFor(lockedAt);
    }, JUNCTION_LOCKED_SHOWN_MILLISECONDS);
    return () => {
      clearTimeout(timer);
    };
  }, [lockedAt]);
  // #3058: a U-turn, a dead end's turn-round or a press with no junction
  // near, said in words where the junction's ways stand, for as long as it
  // stands. The region says it too (`junction-text.ts` §`junctionEvent`).
  const notice = junction.notice;
  if (notice !== undefined) {
    return (
      <div className="oyl-hud__junction-popup">
        <div className="oyl-hud__junction-prompt">
          <div className="oyl-hud__junction-head">
            <p className="oyl-hud__junction-title" data-oyl-notice={notice.kind}>
              {TURN_NOTICE_WORDS[notice.kind].shown}
            </p>
          </div>
        </div>
      </div>
    );
  }
  if (shown === undefined || goneFor === shown.distance) return null;

  const described = touchLocked ? NOTE_ID : undefined;
  const tap = tapOf(junction);
  const presses = pressesOfWays(shown);
  const chosenAt = shown.ways.findIndex((way) => way.edge.id === shown.chosen);
  return (
    <div className="oyl-hud__junction-popup">
      <div role="group" aria-labelledby={TITLE_ID} className="oyl-hud__junction-prompt">
        <div className="oyl-hud__junction-head">
          <p id={TITLE_ID} className="oyl-hud__junction-title">
            {JUNCTION_PROMPT_TITLE}
          </p>
          <p className="oyl-hud__junction-lock">
            {shown.locked ? JUNCTION_LOCKED_LINE : lockLine(shown.toLock, units)}
          </p>
        </div>
        <ul className="oyl-hud__junction-ways">
          {shown.ways.map((way, index) => {
            const id = way.edge.id;
            const isChosen = id === shown.chosen;
            // Once the choice is final, the way chosen alone (#3053).
            if (shown.locked && !isChosen) return null;
            const own = presses.get(id) ?? [];
            const isDefault = id === shown.defaultWay;
            const street = wayStreetLine(way);
            // A way with a press of its own takes that press; with more than
            // three ways on, one with none is a step toward it; the chosen way
            // with none is already where the ride goes.
            const turn: TurnPress | undefined =
              own[0] ?? (isChosen ? undefined : index < chosenAt ? 'left' : 'right');
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`oyl-hud__control oyl-hud__junction-way ${RIDE_SIZE_CLASS}${
                    isChosen ? ' oyl-hud__junction-way--chosen' : ''
                  }`}
                  data-oyl-way={id}
                  aria-disabled={shown.locked ? 'true' : undefined}
                  aria-describedby={described}
                  style={size()}
                  onClick={() => {
                    if (turn !== undefined) tap(turn);
                  }}
                >
                  <WayArrow turnDegrees={way.turnDegrees} />
                  <span className="oyl-hud__junction-word">{wayWord(way.turnDegrees)}</span>
                  {/* #3052: the street, as mapped, under its turn; none where the map names none. */}
                  {street === undefined ? null : (
                    // A leading space, as the marks have, so the accessible name reads
                    // "Right onto Third Avenue" and never "Rightonto".
                    <span className="oyl-hud__junction-street">{` ${street}`}</span>
                  )}
                  {isDefault || isChosen ? (
                    <span className="oyl-hud__junction-marks">
                      {isDefault ? ` ${JUNCTION_DEFAULT_WORD}` : null}
                      {isChosen ? ` ${JUNCTION_CHOSEN_WORD}` : null}
                    </span>
                  ) : null}
                  <Hints presses={own} />
                </button>
              </li>
            );
          })}
        </ul>
        {touchLocked ? (
          <p id={NOTE_ID} className="oyl-hud__junction-note">
            {JUNCTION_BY_KEY_SENTENCE}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** What {@link JunctionUTurn} is handed. */
export interface JunctionUTurnProps {
  readonly junction: JunctionInput;
  /** The HUD's touch lock is on. */
  readonly touchLocked: boolean;
}

/**
 * The U-turn (D-1.6), with the ride controls for the whole ride, and the turn
 * keys' listener, which a U-turn key needs with no junction ahead.
 *
 * ⚠️ **It hides with the controls, as Pause does** (#3053): the actions panel
 * it is drawn in fades and is clipped with no touch, and a control there that
 * did not carry {@link HIDES_ATTRIBUTE} took the first tap that only showed
 * them: before #3053, `HudPanel.controls-hide.test.tsx` §"keeps the U-turn
 * with the controls" saw that first tap turn the rider round. A first tap on
 * it while they are hidden now only shows them.
 */
export function JunctionUTurn(props: JunctionUTurnProps): JSX.Element {
  const { junction, touchLocked } = props;
  // Read through a ref: the ride hands in a new press each frame, and the
  // keys' listener should not be torn down and added again at 60 fps.
  const press = useRef(junction.press);
  useEffect(() => {
    press.current = junction.press;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const turn = turnOfKey(event);
      if (turn === undefined) return;
      // The key is the turn's now: the arrows and Page Up or Down would
      // otherwise also scroll the ride screen.
      event.preventDefault();
      press.current(turn);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const tap = tapOf(junction);
  return (
    <div className="oyl-hud__junction" {...{ [HIDES_ATTRIBUTE]: '' }}>
      <button
        type="button"
        className={`oyl-hud__control oyl-hud__junction-u-turn ${RIDE_SIZE_CLASS}`}
        aria-describedby={touchLocked ? U_TURN_NOTE_ID : undefined}
        style={size()}
        onClick={() => {
          tap('u-turn');
        }}
      >
        {U_TURN_NAME}
        <Hints presses={['u-turn']} />
      </button>
      {touchLocked ? (
        <p id={U_TURN_NOTE_ID} className="oyl-hud__junction-note">
          {JUNCTION_BY_KEY_SENTENCE}
        </p>
      ) : null}
    </div>
  );
}
