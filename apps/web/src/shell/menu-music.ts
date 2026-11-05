// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The menus' music — #2058: a loop on by default in the menus, never during a
 * ride (owner ruling 2 of 2026-11-03, epic #2033), decided here and nowhere
 * else, as `menu-sounds.ts` decides the menus' short sounds.
 *
 * ## Only from the rider's first press
 *
 * Nothing plays at load: a browser refuses audio that starts without a user
 * gesture, Android WebView's `mediaPlaybackRequiresUserGesture` is on, and WCAG
 * 2.2 SC 1.4.2 is about audio that starts by itself. So the loop starts inside
 * {@link MenuMusic.press}, which `AppShell` calls from its `click` handler and
 * nowhere else — the audio context is resumed there, inside the gesture. A
 * press on the header's *Mute all sound* ({@link HOLDS_THE_MUSIC}) never starts
 * it: a rider reaching for the mute first has said what they want.
 *
 * ## Never during a ride
 *
 * The same rule as the menus' sounds (`menu-sounds.ts` §`quiet`): not on the
 * two ride routes, not while the ride controller is recording or paused, not
 * while immersive. {@link MenuMusic.update} is told whenever any of those, or
 * the page's visibility, changes — it is not a press, so it never STARTS the
 * loop, only resumes one the rider already started (a page with a press
 * behind it may play, which every engine allows).
 *
 * Leaving for a ride route fades the music bus to 0 (`web-audio.ts`
 * §`setMusicOn`, a ramp) and pauses the element once the fade is over. A page
 * that is hidden pauses at once: nobody hears a fade on a screen that is off.
 *
 * ## The rider's mix
 *
 * Music that is muted, at volume 0, or under the header's master mute starts
 * nothing, and a press that finds it so pauses a loop already playing — the
 * bus would be silent anyway, and a paused element costs nothing. The levels
 * themselves are the graph's, from `game/audio-mix.ts`.
 *
 * ## The file
 *
 * An `<audio>` element made at the first press that starts the loop, with
 * `preload="none"`, so the file is fetched then and never at load, and is
 * never in the entry chunk's graph: it is a URL, not an import. Which file is
 * #2057's, an owner's choice; until it is committed {@link MENU_MUSIC_TRACK}
 * is `undefined` and nothing here does anything.
 */

import type { AudioMix } from '../game/audio-mix';
import type { CueOutput } from '../game/audio-port';
import { MUSIC_FADE_MS } from '../game/web-audio';

import { quiet, type PressContext } from './menu-sounds';

/**
 * The menus' loop, served from the app's own origin — #2057 commits it, with
 * its `ASSETS.toml` row and its credit. ⚠️ `undefined` until then, and the music
 * is then silent by design: no file has been chosen (ADR 0023; the owner
 * hears the shortlist first).
 */
export const MENU_MUSIC_TRACK: string | undefined = undefined;

/**
 * The control whose press never STARTS the music: the header's *Mute all
 * sound* (`HeaderMute.tsx`, its class). A press there before the loop has
 * started is a rider reaching for silence.
 */
export const HOLDS_THE_MUSIC = '.oyl-header__mute';

/** What `menu-music.ts` needs from the page, so a test can hand in its own. */
export interface MenuMusicDeps {
  /** The app's one audio output. */
  readonly output: CueOutput;
  /** The loop's URL, or `undefined` for none. */
  readonly track: string | undefined;
  /** The music bus and the master mute, as stored now. */
  readonly mix: () => Pick<AudioMix, 'music' | 'masterMuted'>;
  /** Make the element: a fresh `<audio>`, not yet given a source. */
  readonly createElement: () => HTMLMediaElement;
  /** Run `callback` after `ms`; the returned function cancels it. */
  readonly schedule: (callback: () => void, ms: number) => () => void;
  /** Whether the page is hidden now (`document.hidden`). */
  readonly hidden: () => boolean;
}

export interface MenuMusic {
  /** A press — a `click` — landed on `target`. The one place the loop can start. */
  press(target: EventTarget | null, context: PressContext): void;
  /** The route, the ride, immersion or the page's visibility changed. Never a start. */
  update(context: PressContext): void;
}

/** Whether the rider's mix lets the music be heard at all. */
function wanted(mix: Pick<AudioMix, 'music' | 'masterMuted'>): boolean {
  return !mix.masterMuted && !mix.music.muted && mix.music.volume > 0;
}

export function createMenuMusic(deps: MenuMusicDeps): MenuMusic {
  let element: HTMLMediaElement | undefined;
  /** Whether the loop is meant to be sounding — what `update` keeps in step. */
  let playing = false;
  /** The pause waiting for a fade to end, to cancel when the rider comes back. */
  let cancelPause: (() => void) | undefined;

  const play = (into: HTMLMediaElement): void => {
    cancelPause?.();
    cancelPause = undefined;
    playing = true;
    deps.output.setMusicOn(true);
    // Refused by the platform or a file that will not load: there is nothing a
    // rider could be told that the visible mute does not already give them.
    into.play().catch(() => undefined);
  };

  const stop = (into: HTMLMediaElement, fade: boolean): void => {
    if (!playing) return;
    playing = false;
    deps.output.setMusicOn(false);
    cancelPause?.();
    if (fade) {
      cancelPause = deps.schedule(() => {
        cancelPause = undefined;
        into.pause();
      }, MUSIC_FADE_MS);
    } else {
      cancelPause = undefined;
      into.pause();
    }
  };

  return {
    press(target, context) {
      if (deps.track === undefined || quiet(context)) return;
      if (
        element === undefined &&
        target instanceof Element &&
        target.closest(HOLDS_THE_MUSIC) !== null
      ) {
        return;
      }
      if (!wanted(deps.mix())) {
        if (element !== undefined) stop(element, false);
        return;
      }
      // Inside the press: the one place a context may be made and resumed.
      deps.output.resume();
      if (element === undefined) {
        const made = deps.createElement();
        made.loop = true;
        made.preload = 'none';
        made.src = deps.track;
        deps.output.attachMusic(made);
        element = made;
      }
      if (!playing) play(element);
    },
    update(context) {
      if (element === undefined) return;
      if (deps.hidden()) {
        stop(element, false);
      } else if (quiet(context)) {
        stop(element, true);
      } else if (!playing && wanted(deps.mix())) {
        play(element);
      }
    },
  };
}
