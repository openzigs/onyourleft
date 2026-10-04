// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The menus' sounds — #946: a soft *select*, a *confirm* and a *back*, played
 * through the same `game/audio-port.ts` the ride's sounds use, and decided
 * here and nowhere else.
 *
 * ## The mute is HERE, at the port, not in the callers
 *
 * `AppShell` hands every press to {@link MenuSounds.press} and asks nothing
 * first. Whether a sound plays — the rider's switch, a ride under way, the
 * stage holding the screen, a press on nothing that is a control — is decided
 * inside, so a caller cannot forget a check: there is no check for a caller to
 * make. #400's mute is placed the same way, in `game/audio-cues.ts`.
 *
 * ## Only after a press
 *
 * `press` is called from a `click` handler and from nowhere else. A hover, a
 * focus, a hash changed by hand, a page load and a route the app moves to on
 * its own all dispatch no `click`, so none of them can sound. The audio
 * context is made (lazily, `web-audio.ts`) inside that same handler, which is
 * a user gesture; a context made outside one is suspended and silent. Enter on
 * a link or Space on a button is a press too — the browser fires `click` for
 * both — so a keyboard rider hears what a pointer rider hears.
 *
 * ## Never during a ride
 *
 * While the ride controller is recording or paused, while the shell is
 * immersive (a game ride has the screen), and on the two ride routes at all
 * (`route-motion.ts` §`RIDE_ROUTE_IDS`), nothing plays: a rider in a ride
 * hears the ride's sounds or nothing. The ride routes are silent even before a
 * ride starts, because the press that starts one is on them, and a menu sound
 * on *Start recording* would be a menu sound at the start of a ride.
 *
 * ## ⚠️ What this leaves running
 *
 * A menu sound resumes the shared context and does not suspend it again. The
 * ride's `release()` (#447) suspends only a context a RIDE began, and a delayed
 * suspend here could land on a ride a rider started inside its delay, which
 * would silence the ride's tone. So an idle context runs on after a menu sound
 * until the page goes or a ride ends: the cost of a feature a rider turned on.
 *
 * ## A sound is never the only carrier
 *
 * Each press has its own visible result — a page, a dialog, a ticked box — and
 * the sound only answers it, so a rider with sounds off, or who cannot hear
 * them, misses nothing (the Game Accessibility Guidelines' "no essential
 * information by sound alone").
 */

import { RIDE_CUE_LEVEL } from '../game/audio-cues';
import type { CueOutput, MenuCueName } from '../game/audio-port';
import { rideInProgress, type RidePhase } from '../ride/controller';

import type { MenuSoundPreference } from './menu-sound-preference';
import { isRideRoute } from './route-motion';
import type { RouteId } from './routes';

/**
 * The menus' level at full volume: below the ride's short sounds
 * ({@link RIDE_CUE_LEVEL}) at every volume, because a sound that answers a
 * press is never louder than one a rider needs mid-ride.
 */
export const MENU_CUE_LEVEL = RIDE_CUE_LEVEL * 0.6;

/** What `AppShell` knows at the moment of a press. */
export interface PressContext {
  /** Whether a ride has the screen — `AppShell` §`immersive`. */
  readonly immersive: boolean;
  /** The route on screen when the press landed. */
  readonly routeId: RouteId;
  /** The ride controller's phase, or `undefined` where there is no controller. */
  readonly ridePhase: RidePhase | undefined;
}

export interface MenuSounds {
  /**
   * A press — a `click` — landed on `target`. Plays at most one sound, and
   * decides on its own whether to play any.
   */
  press(target: EventTarget | null, context: PressContext): void;
}

/** The attribute a control carries to name its sound outright. */
export const SOUND_ATTRIBUTE = 'data-oyl-sound';

/** What counts as a control a press can land on. */
const CONTROL_SELECTOR = [
  'a[href]',
  'button',
  'summary',
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[role="button"]',
  '[role="tab"]',
].join(', ');

function isMenuCue(value: string | null): value is MenuCueName {
  return value === 'select' || value === 'confirm' || value === 'back';
}

/**
 * The sound a press on `target` answers with, or `undefined` when the press
 * landed on no control — on a paragraph, a heading, the page — or on one that
 * is disabled.
 *
 * - a control carrying {@link SOUND_ATTRIBUTE} gets the sound it names (the
 *   list–detail back link says `back`);
 * - a form's submit button, and a primary button, CONFIRM;
 * - every other link, button, switch, box or tab SELECTS.
 */
export function menuCueFor(target: EventTarget | null): MenuCueName | undefined {
  if (!(target instanceof Element)) return undefined;
  const control = target.closest(CONTROL_SELECTOR);
  if (control === null) return undefined;
  if (control.matches(':disabled') || control.getAttribute('aria-disabled') === 'true') {
    return undefined;
  }
  const declared = control.getAttribute(SOUND_ATTRIBUTE);
  if (isMenuCue(declared)) return declared;
  if (
    // A submit that submits something: a `<button>` outside any form is
    // `type="submit"` by default and submits nothing.
    (control instanceof HTMLButtonElement && control.type === 'submit' && control.form !== null) ||
    control.classList.contains('oyl-button--primary')
  ) {
    return 'confirm';
  }
  return 'select';
}

/** Whether a menu sound may play at all, for this press. */
function quiet(context: PressContext): boolean {
  return (
    context.immersive ||
    isRideRoute(context.routeId) ||
    (context.ridePhase !== undefined && rideInProgress(context.ridePhase))
  );
}

/**
 * The menus' sounds over `output`, reading the rider's choice through
 * `preference` at each press — so a switch turned on in Settings is heard on
 * the very next press, with nothing to subscribe to.
 */
export function createMenuSounds(
  output: CueOutput,
  preference: () => MenuSoundPreference,
): MenuSounds {
  return {
    press(target, context) {
      const chosen = preference();
      if (!chosen.enabled || chosen.volume <= 0 || quiet(context)) return;
      const cue = menuCueFor(target);
      if (cue === undefined) return;
      // Inside the press: the one place a context may be made and resumed.
      output.resume();
      output.playCue(cue, MENU_CUE_LEVEL * chosen.volume);
    },
  };
}
