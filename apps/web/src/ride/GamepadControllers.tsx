// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Devices screen's Controllers section — #2358: each gamepad the page can
 * see, and a readout that says which button or stick moved.
 *
 * A gamepad pairs with the operating system, not with the app (#1821, DL12),
 * so this section pairs nothing and has no control: it lists what the
 * Gamepad API lists, through `game/gamepad-port.ts`, the same port the HUD
 * polls. It is not a new input path, and nothing here reaches a trainer.
 *
 * ## Silent until a press
 *
 * A browser lists a pad only after one of its buttons has been pressed while
 * the page could see it, so the section's empty state says to press one.
 *
 * ## Polled while a pad is there, as the HUD is
 *
 * The first poll is at mount; a poll that finds no connected pad schedules
 * no next one, and a connect or disconnect wakes it
 * (`GamepadIntents.tsx`'s pattern). The list is set only when it changes,
 * and the readout only when something moved, so a held pad does not render
 * once a frame.
 *
 * ## Words, never colour alone (SC 1.4.1)
 *
 * Each pad's state is a word, and the readout names the button or stick in
 * text. A pad coming or going is said in a live region rendered empty and
 * filled on the change, so the pads already there when the screen opens are
 * read with the page and not announced again. The readout is a polite
 * `role="status"` of its own: a rider pressing to test wants to hear it.
 *
 * ## A card like a sensor's, but not one of theirs
 *
 * Each row is drawn as the pairing cards are, under its own class
 * (`oyl-gamepads__row` beside `oyl-pairing__row` in `theme.css`), because
 * the screen's tests and the browser gate count `.oyl-pairing__row` as the
 * trainer's and sensors' rows, and a gamepad is neither.
 *
 * ⚠️ **The wording is proposed, for the owner to approve in #2358's PR.**
 */

import { Gamepad2 } from 'lucide-react';
import { useEffect, useRef, useState, type JSX } from 'react';

import { navigatorGamepads, type GamepadPort } from '../game/gamepad-port';
import { isNativeShell, platformCapacitor } from '../support/capacitor';

import {
  connectionChange,
  listedPads,
  movedSince,
  NOTHING_HELD,
  type ListedPad,
} from './gamepad-readout';

export const GAMEPADS_HEADING = 'Controllers';

export const GAMEPADS_WHAT_THEY_DO = 'Steers and throws in Delivery.';

/** A listed pad's state. */
export const GAMEPAD_CONNECTED = 'Connected';

/** The empty state: a browser lists no pad before a press. */
export const PRESS_SO_THE_APP_SEES_IT = 'Press any button so the app can see it.';

export const TEST_HEADING = 'Press a button to test';

/** The readout before anything has moved. */
export const NOTHING_MOVED_YET = 'Nothing has moved yet.';

/** The readout once something has. */
export function lastMovedWords(moved: string): string {
  return `Last moved: ${moved}.`;
}

export interface GamepadControllersProps {
  /** The pads to list. Absent is the platform's, through `window`, as the HUD's. */
  readonly pads?: GamepadPort | undefined;
}

const sameList = (a: readonly ListedPad[], b: readonly ListedPad[]): boolean =>
  a.length === b.length &&
  a.every((pad, index) => pad.slot === b[index]?.slot && pad.name === b[index].name);

/** @see the module header */
export function GamepadControllers({ pads }: GamepadControllersProps): JSX.Element {
  const [listed, setListed] = useState<readonly ListedPad[]>([]);
  const [moved, setMoved] = useState<string | undefined>(undefined);
  const [announcement, setAnnouncement] = useState('');
  const padsRef = useRef(pads);
  useEffect(() => {
    padsRef.current = pads;
  });
  useEffect(() => {
    const platform = navigatorGamepads(window, isNativeShell(platformCapacitor()));
    let frame: number | undefined;
    let held = NOTHING_HELD;
    let shown: readonly ListedPad[] | undefined;
    const poll = (): void => {
      frame = undefined;
      const now = (padsRef.current ?? platform).pads();
      const list = listedPads(now);
      if (shown === undefined || !sameList(shown, list)) {
        // The first read is the page's own content, not a change to announce.
        const said = shown === undefined ? undefined : connectionChange(shown, list);
        if (said !== undefined) setAnnouncement(said);
        shown = list;
        setListed(list);
      }
      const read = movedSince(held, now);
      held = read.state;
      if (read.moved !== undefined) setMoved(read.moved);
      if (now.some((pad) => pad?.connected === true)) frame = window.requestAnimationFrame(poll);
    };
    const wake = (): void => {
      if (frame === undefined) frame = window.requestAnimationFrame(poll);
    };
    poll();
    const stop = (padsRef.current ?? platform).onConnectionChange(wake);
    return () => {
      stop();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <>
      <h2>{GAMEPADS_HEADING}</h2>
      <p>{GAMEPADS_WHAT_THEY_DO}</p>
      <ul className="oyl-sensor-list tw:mt-0" data-oyl-gamepads="">
        {(listed.length === 0 ? [undefined] : listed).map((pad) => (
          <li
            key={pad === undefined ? 'none' : `${String(pad.slot)}:${pad.name}`}
            className="oyl-gamepads__row tw:bg-surface-raised tw:rounded-card"
          >
            {/* Lucide's artwork, not ours (ADR 0034 D-3), and decoration
                beside the words, which name the row (D-4). */}
            <Gamepad2
              className="oyl-pairing__glyph oyl-pairing__icon"
              color="currentColor"
              strokeWidth={1.8}
              aria-hidden="true"
              focusable="false"
            />
            <div className="oyl-pairing__body">
              <p className="tw:m-0">
                {pad === undefined ? PRESS_SO_THE_APP_SEES_IT : `${pad.name}: ${GAMEPAD_CONNECTED}`}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <h3>{TEST_HEADING}</h3>
      <p role="status" data-oyl-gamepad-readout="">
        {moved === undefined ? NOTHING_MOVED_YET : lastMovedWords(moved)}
      </p>
      <p className="oyl-visually-hidden" role="status" data-oyl-gamepad-announcer="">
        {announcement}
      </p>
    </>
  );
}
