// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What Android's back gesture or button does inside the shell — #1512.
 *
 * Until #1512 nothing handled it, so `BridgeActivity` took Android's default
 * and left the app from every screen. `MainActivity.java` now takes every back
 * press and asks the page, by calling {@link ANDROID_BACK_GLOBAL} with the one
 * fact only the WebView knows — whether its own history has an entry to go
 * back to. The page answers `true` when it handled the press and `false` when
 * the app should leave; anything else (no page yet, a page that threw) is
 * read as `false` there, so a broken page can never trap a rider in the app.
 *
 * ## The decision ({@link answerBack})
 *
 * 1. **A ride is on: nothing happens.** A recording or a paused one
 *    (`ride/controller.ts` §`rideInProgress`), or the trainer game's stage
 *    with the screen (`AppShell`'s `immersive`). Back must never end, pause or
 *    leave a ride, and what it SHOULD do there is rider-facing behaviour the
 *    owner has not ruled on yet (#1512's lane scope, 2026-10-21) — so until
 *    then the press is consumed and nothing else. ⚠️ On every screen, not only
 *    the ride's: back from another screen mid-ride could otherwise reach Home
 *    and then leave, and leaving finishes the activity that holds the recorder.
 * 2. **Home is the top level: the app leaves.** Android's own default
 *    (the launcher), as on any other app.
 * 3. **Anywhere else, back goes back** through the WebView's history, which is
 *    what #670's list–detail already answers: a selection is a URL, so going
 *    back from a selected item lands on the list with that item focused.
 * 4. **Anywhere else with no history to go back to** — a cold start restored
 *    to a deep screen — goes Home, replacing the entry, so the next back leaves.
 */

import { useEffect, useEffectEvent } from 'react';

import { hrefFor, routeById, type RouteId } from './routes';

/**
 * The name of the function `MainActivity.java` calls on the page's `window`.
 * `apps/mobile/src/android/back-source.test.ts` holds the Java to this name.
 */
export const ANDROID_BACK_GLOBAL = '__oylAndroidBack';

/** What one back press does. */
export type BackAnswer =
  /** Consumed, and nothing else: a ride is on. */
  | 'stay'
  /** `history.back()`. */
  | 'back'
  /** Replace this entry with Home. */
  | 'home'
  /** Not handled: the app leaves, as Android's default. */
  | 'leave';

/** What the page knows at the moment of a press. */
export interface BackState {
  readonly routeId: RouteId;
  /** A recording or a paused ride, or a ride that has the screen. */
  readonly rideOn: boolean;
  /** The WebView's own `canGoBack()`, passed in by `MainActivity`. */
  readonly canGoBack: boolean;
}

/** The decision, as the header describes it. Pure, so every branch is a unit test. */
export function answerBack(state: BackState): BackAnswer {
  if (state.rideOn) {
    return 'stay';
  }
  if (state.routeId === 'home') {
    return 'leave';
  }
  return state.canGoBack ? 'back' : 'home';
}

/** The parts of `window` a press acts on. A parameter so a test can hand in its own. */
export interface BackWindow {
  readonly history: Pick<History, 'back'>;
  readonly location: Pick<Location, 'replace'>;
}

/**
 * Carry out one press. @returns whether it was handled — `false` only for
 * {@link BackAnswer} `'leave'`, which is the one answer `MainActivity` acts on.
 */
export function pressBack(state: BackState, target: BackWindow): boolean {
  const answer = answerBack(state);
  switch (answer) {
    case 'stay':
      return true;
    case 'back':
      target.history.back();
      return true;
    case 'home':
      target.location.replace(hrefFor(routeById('home')));
      return true;
    case 'leave':
      return false;
  }
}

type BackGlobal = Record<typeof ANDROID_BACK_GLOBAL, ((canGoBack: unknown) => boolean) | undefined>;

/**
 * Answer `MainActivity`'s back presses while `enabled` — inside the shell only
 * (`AppShellProps.nativeShell`); a browser has its own back button and
 * nothing would call this. `read` is asked at each press, never captured, so a
 * ride started after mounting is seen at the next press.
 */
export function useAndroidBack(enabled: boolean, read: () => Omit<BackState, 'canGoBack'>): void {
  const answer = useEffectEvent((canGoBack: unknown): boolean =>
    // Only a literal `true` from the activity counts: anything else is "no history".
    pressBack({ ...read(), canGoBack: canGoBack === true }, globalThis),
  );
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const target = globalThis as unknown as BackGlobal;
    const handler = (canGoBack: unknown): boolean => answer(canGoBack);
    target[ANDROID_BACK_GLOBAL] = handler;
    return () => {
      if (target[ANDROID_BACK_GLOBAL] === handler) {
        target[ANDROID_BACK_GLOBAL] = undefined;
      }
    };
  }, [enabled]);
}
