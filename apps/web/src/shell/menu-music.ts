// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The menus' music — #2058: a loop on by default in the menus, never during a
 * ride (owner ruling 2 of 2026-11-03, epic #2033), decided here and nowhere
 * else, as `menu-sounds.ts` decides the menus' short sounds.
 *
 * ## Only from the rider's first press — except in the Android app
 *
 * Nothing plays at load in a browser, the demo included: a browser refuses
 * audio that starts without a user gesture, and a web page cannot lift that.
 * So the loop starts inside {@link MenuMusic.press}, which `AppShell` calls
 * from its `click` handler — the audio context is resumed there, inside the
 * gesture. A
 * press on the header's *Mute all sound* ({@link HOLDS_THE_MUSIC}) never starts
 * it: a rider reaching for the mute first has said what they want. Nor does
 * any press on the rider's own player's controls ({@link THE_RIDERS_PLAYER}).
 *
 * In the Android app the loop also starts with no press — owner ruling of
 * 2026-11-08, #2357 — but only when the shell itself says its WebView lets
 * media start without a gesture ({@link MenuMusicDeps.autoplay}, read from the
 * WebView's own setting by `AutoplayPlugin.java`, never guessed from the user
 * agent). Capacitor 8.5.2 turns `mediaPlaybackRequiresUserGesture` off
 * (`Bridge.initWebView`) and `MainActivity` says so again, and under that
 * policy Chromium lets an audio context run without a gesture too. That start
 * is {@link MenuMusic.update}'s, on the first visible menu route it is told
 * of, and it keeps every rule below: never on a ride route, while immersive or
 * while hidden, never against the rider's mix, and never before the rider's
 * player has been asked — at launch the header has not read yet, so the loop
 * first waits {@link OWN_LOOP_SETTLE_MS}, as after its own silence.
 *
 * WCAG 2.2 SC 1.4.2 asks that audio playing by itself for more than 3 s can
 * be stopped from the page: the header's *Mute all sound* does that, and is
 * on the page before the loop can start, since the loop starts from an effect
 * `AppShell` runs after the header has rendered.
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
 * ## The rider's own player comes first
 *
 * Owner ruling 3 of 2026-11-05 on #2073: our loop stays silent while the
 * rider's own player (another app) is in use — #2253. {@link
 * MenuMusicDeps.riderPlayer} is asked before the loop starts or comes back,
 * and a "yes" keeps it silent.
 *
 * ⚠️ **Our own loop never counts as the rider's player.** The answer comes
 * from Android's `isMusicActive()` (spike 0034 §1.3), which is true while OUR
 * loop plays too, so a reading taken while the loop could be heard says
 * nothing about the rider. Two rules keep it out:
 *
 * - **While the loop plays, the question is not asked at all.** The loop is
 *   not stopped by a reading that is most likely itself.
 * - **After the loop falls silent, it is not asked for {@link
 *   OWN_LOOP_SETTLE_MS}**, counted again from each return to a visible menu
 *   route (the header reads only there): the answer may still be a reading
 *   of our own loop. A loop that would come back in that time waits, and
 *   comes back at its end only if the rider's player is not in use.
 *
 * So the loop yields when the rider starts their player in their own app —
 * the page is hidden, the loop pauses, and on the way back it stays silent.
 * A player started while our loop plays and the page is on screen (a
 * headset's button) reads the same as our own loop, and is not seen: that is
 * #2060's question, whether the WebView takes audio focus.
 *
 * ## The file
 *
 * An `<audio>` element made at the first press that starts the loop, with
 * `preload="none"`, so the file is fetched then and never at load, and is
 * never in the entry chunk's graph: it is a URL, not an import. Which file is
 * #2057's, an owner's choice: {@link MENU_MUSIC_FILE}. A `track` of
 * `undefined` still means nothing here does anything, which the tests use.
 */

import type { AudioMix } from '../game/audio-mix';
import type { CueOutput } from '../game/audio-port';
import { MUSIC_FADE_MS } from '../game/web-audio';

import { quiet, type PressContext } from './menu-sounds';

/**
 * The menus' loop, under `public/` — #2057: *Upbeat Game Loop - Aurora Ride*
 * by Venus17 (Freesound 841299, CC0), the owner's choice of 2026-11-06. Ogg
 * Opus, made from the original WAV by `tools/audio/encode-menu-music.sh`, with
 * its `ASSETS.toml` row (so Credits lists it as a courtesy). Chromium and
 * Android WebView decode it; Safari only from 18.4, and an older one refuses
 * the file, which {@link MenuMusic.press} already treats as silence.
 */
export const MENU_MUSIC_FILE = 'audio/upbeat-game-loop-aurora-ride.ogg';

/**
 * The loop's URL, from the app's own origin and under its base, as the
 * header's mark is (`AppShell.tsx` §`NAV_MARK_FILE`): never another host, and
 * a URL rather than an import, so it is in no chunk.
 */
export const MENU_MUSIC_TRACK = `${import.meta.env.BASE_URL}${MENU_MUSIC_FILE}`;

/**
 * The control whose press never STARTS the music: the header's *Mute all
 * sound* (`HeaderMute.tsx`, its class). A press there before the loop has
 * started is a rider reaching for silence.
 */
export const HOLDS_THE_MUSIC = '.oyl-header__mute';

/**
 * The rider's own player's controls in the header (#2073,
 * `OtherPlayerControls.tsx`, its class): a press there is never one of ours,
 * whether or not the loop has started. Its `onClick` runs before `AppShell`'s
 * press handler and `OtherPlayer` believes a *Pause* at once, so without this
 * the rider's own *Pause music* would start our loop on the same click — and
 * keep it playing over theirs when the key is refused (#2242's review).
 */
export const THE_RIDERS_PLAYER = '.oyl-other-player';

/**
 * How long the loop must have been silent, on a visible menu route, before the
 * rider's player is asked about — #2253. #2073's header reads `isMusicActive()`
 * every 4 s and gives a reading 2 s at most: by then a reading taken after the
 * loop fell silent has landed, and it cannot be the loop.
 */
export const OWN_LOOP_SETTLE_MS = 6_000;

/**
 * The one question the menus' music asks of the rider's own player — owner
 * ruling 3 of 2026-11-05 on #2073. The shape of `RiderPlayerInUse` in #2242's
 * `shell/other-player-port.ts`, so its `OtherPlayer` is one.
 */
export interface RiderPlayer {
  /** Whether the rider's own player is in use now. ⚠️ It may be reading our own loop. */
  riderPlayerInUse(): boolean;
}

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
  /**
   * The rider's own player, or `undefined` where none is offered (a browser):
   * in the Android shell, #2073's `OtherPlayer`.
   */
  readonly riderPlayer: RiderPlayer | undefined;
  /**
   * Whether the shell lets the loop start with no press — #2357: in the
   * Android shell, its WebView's own answer (`AutoplayPlugin.java`);
   * `undefined` in a browser and the demo, which keep the first-press rule.
   * Until it answers, and for any answer but `true`, only a press starts it.
   */
  readonly autoplay: Promise<boolean> | undefined;
}

export interface MenuMusic {
  /** A press — a `click` — landed on `target`. The one place the loop can start. */
  press(target: EventTarget | null, context: PressContext): void;
  /**
   * The route, the ride, immersion or the page's visibility changed. Never a
   * start, except where the shell allows one with no press ({@link
   * MenuMusicDeps.autoplay}), and then only of a loop that has not yet played.
   */
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
  /**
   * Whether an answer about the rider's player cannot be our own loop, read
   * only while the loop is silent: true until the loop first plays, then false
   * from each pause and each return to a visible menu route until {@link
   * OWN_LOOP_SETTLE_MS} has passed.
   */
  let settled = true;
  let cancelSettle: (() => void) | undefined;
  /** Whether the last {@link MenuMusic.update} was on a visible menu route. */
  let onMenu: boolean | undefined;
  let lastContext: PressContext | undefined;
  /** Whether the shell has said the loop may start with no press (#2357). */
  let autoplay = false;
  /** Whether the launch's wait for the header's first reading has been set (#2357). */
  let launchWaited = false;

  /** The loop is silent from now: wait before believing the rider's player again. */
  const unsettle = (): void => {
    if (deps.riderPlayer === undefined) return;
    cancelSettle?.();
    settled = false;
    cancelSettle = deps.schedule(() => {
      cancelSettle = undefined;
      settled = true;
      // What the loop would have done had it not had to wait.
      if (lastContext !== undefined) music.update(lastContext);
    }, OWN_LOOP_SETTLE_MS);
  };

  /** Whether the loop may start or come back: the rider's player is not in use, as far as can be told. */
  const mayStart = (): boolean =>
    deps.riderPlayer === undefined || (settled && !deps.riderPlayer.riderPlayerInUse());

  const pause = (into: HTMLMediaElement): void => {
    into.pause();
    unsettle();
  };

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
        pause(into);
      }, MUSIC_FADE_MS);
    } else {
      cancelPause = undefined;
      pause(into);
    }
  };

  /** Make the element if need be and play it: a press's start, and #2357's. */
  const start = (track: string): void => {
    deps.output.resume();
    if (element === undefined) {
      const made = deps.createElement();
      made.loop = true;
      made.preload = 'none';
      made.src = track;
      deps.output.attachMusic(made);
      element = made;
    }
    if (!playing) play(element);
  };

  const music: MenuMusic = {
    press(target, context) {
      lastContext = context;
      if (deps.track === undefined || quiet(context)) return;
      if (target instanceof Element && target.closest(THE_RIDERS_PLAYER) !== null) return;
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
      // The rider's player is in use, or our loop was heard too lately to tell.
      if (!playing && !mayStart()) return;
      // Inside the press: in a browser, the one place a context may be made
      // and resumed.
      start(deps.track);
    },
    update(context) {
      lastContext = context;
      const nowOnMenu = !deps.hidden() && !quiet(context);
      const cameBack = onMenu === false && nowOnMenu;
      onMenu = nowOnMenu;
      if (element === undefined) {
        // Never played, but the header did not read while the rider was away
        // either: a press now would ask a reading from before they left, when
        // they may have started their own player (#2242's review).
        if (cameBack) unsettle();
        // #2357: the shell lets it start with no press, and this is a visible
        // menu route. At launch the header has not read the rider's player
        // yet: wait for a reading first, then start only if it is not in use.
        if (autoplay && nowOnMenu && deps.track !== undefined && wanted(deps.mix())) {
          if (!launchWaited) {
            launchWaited = true;
            unsettle();
          }
          if (mayStart()) start(deps.track);
        }
        return;
      }
      if (deps.hidden()) {
        stop(element, false);
      } else if (quiet(context)) {
        stop(element, true);
      } else if (!playing) {
        // Back before the fade ended: the loop never fell silent, so there is
        // no new answer to wait for.
        const fading = cancelPause !== undefined;
        // The header did not read while the rider was away (#2073 reads on a
        // visible menu route only): its answer may be our loop, from before.
        if (cameBack && !fading) unsettle();
        if (wanted(deps.mix()) && (fading || mayStart())) play(element);
      }
    },
  };
  void deps.autoplay?.then(
    (allowed) => {
      autoplay = allowed === true;
      // Answered after the first route was told of: tell it again.
      if (autoplay && lastContext !== undefined) music.update(lastContext);
    },
    () => undefined,
  );
  return music;
}
