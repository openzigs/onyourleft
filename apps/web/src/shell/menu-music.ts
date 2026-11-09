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
 * is {@link MenuMusic.update}'s, and it keeps every rule below: never on a
 * ride route, while immersive or while hidden, never against the rider's mix,
 * and never before the rider's player has been asked. It comes {@link
 * AUTOPLAY_WAIT_MS} (3 s, the owner's ruling of 2026-11-08 on #2369) after one
 * of two moments:
 *
 * - **The launch**, from its first visible menu route (a launch on a ride
 *   route counts from its first menu route).
 * - **The rider coming back to the app** — the page shown again on a menu
 *   route, whether or not the loop had played before. Our loop paused at once
 *   when the page was hidden, and our audio context was suspended with it, so
 *   a reading taken after the return is not of us; one is asked for at the
 *   return ({@link RiderPlayer.poll}) rather than left to the header's next
 *   4 s poll, which a hidden page may also have held back.
 *
 * At the end of either wait a reading is asked for again, and the loop starts
 * only once it has landed and said the rider's player is not in use (#2253):
 * a player the rider started inside the wait is still seen.
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
 * the page's visibility, changes — it is not a press, so outside the Android
 * app it never STARTS the loop, only resumes one the rider already started (a
 * page with a press behind it may play, which every engine allows).
 *
 * Leaving for a ride route fades the music bus to 0 (`web-audio.ts`
 * §`setMusicOn`, a ramp) and pauses the element once the fade is over. A page
 * that is hidden pauses at once: nobody hears a fade on a screen that is off.
 * In the Android app a page hidden on a menu route, with no ride in progress
 * and no workout running, also suspends our audio context (#2357): its open
 * stream would otherwise read as the rider's player. Nor does the loop start
 * or come back by itself over a workout that is running or paused: only a
 * press brings it over one.
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
 * ⚠️ **Our own sound never counts as the rider's player.** The answer comes
 * from Android's `isMusicActive()` (spike 0034 §1.3), and on the tablet it is
 * true for as long as our audio context RUNS, even with every sound paused
 * (2026-11-08): one menu sound was enough for the header to show *Your music
 * app* with no other app playing, and for a press to leave the loop silent
 * for seconds. Three rules keep us out:
 *
 * - **A reading is believed only if our stream was shut throughout it**
 *   (`OtherPlayer`, over `CueOutput.quietToken`). Any other reading changes
 *   nothing, the header's included. So while the loop plays nothing is
 *   believed, and the loop is never stopped by itself.
 * - **On a quiet menu route our context is suspended** ({@link
 *   OWN_STREAM_QUIET_MS} after our last sound), so the header's readings
 *   there are believed. Only in the Android shell, where the context can be
 *   woken outside a press, and only where `quieten` may: never on a ride
 *   route, while immersive, during a ride, over a running or paused workout,
 *   or while the loop plays or fades. A ride route keeps its context: a
 *   *Ride* press inside the loop's fade has its cues (#2369's item 4), and
 *   the suspension waits for the next menu route instead.
 * - **After the loop falls silent, and after each return to a visible menu
 *   route** (the header reads only there), the loop waits for a believed
 *   reading taken since: the one before may be minutes old, from before our
 *   loop played. One is asked for once the suspension has landed ({@link
 *   OWN_STREAM_CLOSE_MS}), and a loop that would have come back in the wait
 *   comes back when it lands, if the rider's player is not in use.
 *
 * So the loop yields when the rider starts their player in their own app —
 * the page is hidden, the loop pauses, and on the way back it stays silent.
 * A player started while our loop plays (a headset's button, or a player
 * that starts just after ours) reads the same as our own loop, and is not
 * seen: no reading can be believed while our stream is open, and the AOSP
 * playback list that could tell the two apart is anonymised for an app like
 * this one. That is #2060's question, whether the WebView takes audio focus.
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
import type { RideWorkoutSnapshot } from '../ride/controller';

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
 * How long our own output must have made no sound, on a quiet menu route in
 * the Android shell, before our audio context is suspended — #2253. Over the
 * menus' longest sound (130 ms, `web-audio.ts`) many times, so a rider tapping
 * through the menus does not open and shut the platform's stream at each tap.
 */
export const OWN_STREAM_QUIET_MS = 1_000;

/**
 * How long after that suspension a reading of the rider's player is asked for
 * — #2253. Measured on the tablet (#2369): a suspend landed in 36 ms, and
 * `isMusicActive()` read false from then on. A reading asked before it has
 * landed is not believed, and the header's next poll is the one that counts.
 */
export const OWN_STREAM_CLOSE_MS = 250;

/**
 * How long the loop waits before it starts with no press — #2357, the owner's
 * ruling of 2026-11-08: 3 s after the launch's first visible menu route, and
 * 3 s after each return to the app on a menu route. The header asks the
 * rider's player at each of those moments (on mount, and {@link
 * RiderPlayer.poll} on a return), and `OtherPlayerPlugin.java` answers in a
 * fraction of that, so the reading the loop goes by was taken in the wait.
 */
export const AUTOPLAY_WAIT_MS = 3_000;

/**
 * The one question the menus' music asks of the rider's own player — owner
 * ruling 3 of 2026-11-05 on #2073. The shape of `RiderPlayerInUse` in #2242's
 * `shell/other-player-port.ts`, so its `OtherPlayer` is one.
 */
export interface RiderPlayer {
  /**
   * Whether the rider's own player is in use, by the latest reading that
   * cannot have been our own sound (#2253). ⚠️ That reading may be old.
   */
  riderPlayerInUse(): boolean;
  /** Call `listener` after each reading that is believed. @returns the unsubscribe. */
  onReading(listener: () => void): () => void;
  /**
   * Take a reading now, rather than at the header's next poll — asked when the
   * rider comes back to the app (#2357). `OtherPlayer.poll`.
   */
  poll(): Promise<void>;
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

/**
 * Whether a workout is loaded and not finished — #2357, from the ride
 * controller's snapshot. `quiet` reads the ride's phase, which stays `idle`
 * for a workout begun before a recording (#1319), so this is asked as well
 * before the context is suspended or the loop starts or comes back by itself.
 * A paused workout counts: its tone comes back on resume, by `rejoin()`.
 */
export function workoutRunning(workout: Pick<RideWorkoutSnapshot, 'status'> | undefined): boolean {
  return workout !== undefined && workout.status !== 'finished';
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
   * Whether a reading of the rider's player that cannot have been our own
   * sound has landed since the last moment it could have changed unseen — the
   * launch, the loop falling silent, a return to a visible menu route, the end
   * of a 3 s wait (#2253). Always so where there is no rider's player.
   */
  let fresh = deps.riderPlayer === undefined;
  /** The return's {@link AUTOPLAY_WAIT_MS}: no start or return with no press until it is over. */
  let held = false;
  let cancelHold: (() => void) | undefined;
  /** The suspension of our context waiting on a quiet menu route (#2253). */
  let cancelHush: (() => void) | undefined;
  /** Whether the last {@link MenuMusic.update} was on a visible menu route. */
  let onMenu: boolean | undefined;
  let lastContext: PressContext | undefined;
  /** Whether the shell has said the loop may start with no press (#2357). */
  let autoplay = false;
  /** Whether the launch's wait for the header's first reading has been set (#2357). */
  let launchWaited = false;
  /**
   * Whether the launch's {@link AUTOPLAY_WAIT_MS} is over, so a start with no
   * press may go by the header's reading (#2357). Nothing to wait for where
   * there is no rider's player.
   */
  let launchWaitOver = deps.riderPlayer === undefined;
  /** Whether the page was hidden at the last {@link MenuMusic.update}. */
  let wasHidden = false;

  /** A reading from before now is not enough: wait for a believed one (#2253). */
  const stale = (): void => {
    if (deps.riderPlayer !== undefined) fresh = false;
  };

  /** Ask for a reading now, rather than at the header's next poll. */
  const ask = (): void => {
    void deps.riderPlayer?.poll().catch(() => undefined);
  };

  /** No start or return with no press for `ms`; then a reading is asked for. */
  const holdFor = (ms: number): void => {
    cancelHold?.();
    held = true;
    cancelHold = deps.schedule(() => {
      cancelHold = undefined;
      held = false;
      // The reading the loop goes by is taken at the end of the wait, so a
      // player the rider started inside it is seen.
      stale();
      ask();
    }, ms);
  };

  /**
   * The rider is back in the app, on a menu route (#2357): our loop paused
   * when the page was hidden, so a reading taken now cannot be it. Ask for one,
   * and wait {@link AUTOPLAY_WAIT_MS} before a start or a return with no press.
   */
  const backInTheApp = (): void => {
    if (deps.riderPlayer === undefined) return;
    stale();
    ask();
    holdFor(AUTOPLAY_WAIT_MS);
  };

  /** Whether the loop may start or come back: the rider's player is not in use, as far as can be told. */
  const mayStart = (): boolean =>
    deps.riderPlayer === undefined || (fresh && !deps.riderPlayer.riderPlayerInUse());

  /**
   * Whether our context may be suspended now, on a visible menu route — #2253.
   * The same rules as `quieten`, and our loop neither playing nor fading:
   * never over a ride, a ride route, the stage, or a running or paused workout.
   */
  const mayHush = (): boolean =>
    deps.riderPlayer !== undefined &&
    lastContext !== undefined &&
    !deps.hidden() &&
    !quiet(lastContext) &&
    lastContext.workoutRunning !== true &&
    !playing &&
    cancelPause === undefined;

  /**
   * Suspend our context {@link OWN_STREAM_QUIET_MS} after our last sound on a
   * quiet menu route — #2253: a running context reads as the rider's player
   * for as long as it runs. `restart` is a press, which may have just made a
   * sound; anything else leaves a wait already set alone, so a ride
   * controller that tells the shell of every sample cannot put it off for
   * good. Asked again when it falls due, so it never lands on a ride begun in
   * the wait.
   */
  const hushLater = (restart: boolean): void => {
    if (!mayHush()) {
      cancelHush?.();
      cancelHush = undefined;
      return;
    }
    if (cancelHush !== undefined && !restart) return;
    cancelHush?.();
    cancelHush = deps.schedule(() => {
      cancelHush = undefined;
      if (!mayHush()) return;
      deps.output.suspend();
      // Once it has landed, a reading cannot be us.
      if (!fresh) deps.schedule(ask, OWN_STREAM_CLOSE_MS);
    }, OWN_STREAM_QUIET_MS);
  };

  const pause = (into: HTMLMediaElement): void => {
    into.pause();
    // The rider may have started their player while ours was heard.
    stale();
  };

  const play = (into: HTMLMediaElement): void => {
    // A context suspended behind a hidden page (`quieten`) or on a quiet menu
    // route (`hushLater`) is woken first. Only where those run: in a browser
    // `resume()` stays inside a press.
    if (deps.riderPlayer !== undefined) deps.output.resume();
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

  /**
   * Behind a hidden menu route, close our own output stream — #2357. A running
   * audio context keeps an output stream open even with every sound stopped,
   * and Android's `isMusicActive()` counts it: measured on the tablet, a
   * silent running context answered `true`, and `false` again as soon as it
   * was suspended. Left running, it is the reading a return goes by, and the
   * loop would yield to itself for good. Only where there is a rider's player
   * to read (the Android shell, whose WebView lets the context be woken again
   * outside a press), and never while a ride may need it (`quiet`) or a
   * workout runs ({@link workoutRunning}): those keep their own context, and
   * suspend it themselves (#447).
   */
  const quieten = (): void => {
    if (deps.riderPlayer === undefined) return;
    deps.output.suspend();
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

  /** What a press does to the loop, before the quiet route's suspension is set again. */
  const pressed = (target: EventTarget | null, context: PressContext): void => {
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
    // The rider's player is in use, or no reading since our loop was heard says otherwise.
    if (!playing && !mayStart()) return;
    // Inside the press: in a browser, the one place a context may be made
    // and resumed.
    start(deps.track);
  };

  const music: MenuMusic = {
    press(target, context) {
      lastContext = context;
      pressed(target, context);
      // The press may have made a menu sound: our stream is open again.
      hushLater(true);
    },
    update(context) {
      lastContext = context;
      const hidden = deps.hidden();
      const nowOnMenu = !hidden && !quiet(context);
      const cameBack = onMenu === false && nowOnMenu;
      // Shown again, not merely back from a ride route: back in the app.
      const returned = cameBack && wasHidden;
      onMenu = nowOnMenu;
      wasHidden = hidden;
      // Hidden on a menu route: our context's stream would read as the
      // rider's player until the return (#2357, measured on the tablet).
      // Nor over a workout, whose tone `RideCues.rejoin()` finds by the
      // context still running (`CueOutput.suspend`'s contract).
      const workout = context.workoutRunning === true;
      if (hidden && !quiet(context) && !workout) quieten();
      if (element === undefined) {
        // Never played, but the header did not read while the rider was away
        // either: a press now would go by a reading from before they left,
        // when they may have started their own player (#2242's review).
        if (returned) backInTheApp();
        else if (cameBack) stale();
        // #2357: the launch's wait, from the first visible menu route. At its
        // end a reading is asked for, and the start goes by that one.
        if (!launchWaited && nowOnMenu && deps.riderPlayer !== undefined) {
          launchWaited = true;
          deps.schedule(() => {
            launchWaitOver = true;
            stale();
            ask();
          }, AUTOPLAY_WAIT_MS);
        }
        // The shell lets it start with no press, this is a visible menu route,
        // and the rider's player is not in use.
        if (
          autoplay &&
          nowOnMenu &&
          !workout &&
          launchWaitOver &&
          !held &&
          deps.track !== undefined &&
          wanted(deps.mix()) &&
          mayStart()
        ) {
          start(deps.track);
        }
      } else if (hidden) {
        stop(element, false);
      } else if (quiet(context)) {
        stop(element, true);
      } else if (!playing) {
        // Back before the fade ended: the loop never fell silent, so there is
        // no new answer to wait for.
        const fading = cancelPause !== undefined;
        // The header did not read while the rider was away (#2073 reads on a
        // visible menu route only). Back in the app, our loop paused as the
        // page was hidden, so a reading asked for now is not it (#2357).
        if (returned && !fading) backInTheApp();
        else if (cameBack && !fading) stale();
        // Never back by itself over a running or paused workout (#2357):
        // only a press brings the loop over one.
        if (wanted(deps.mix()) && !workout && (fading || (!held && mayStart()))) play(element);
      }
      hushLater(false);
    },
  };
  // The first believed reading after a wait: what the loop would have done
  // had it not had to wait. Later ones change nothing by themselves — the loop
  // never starts on its own because the rider's player stopped.
  deps.riderPlayer?.onReading(() => {
    if (fresh) return;
    fresh = true;
    if (lastContext !== undefined) music.update(lastContext);
  });
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
