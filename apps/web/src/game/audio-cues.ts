// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's non-speech sounds — #400. Every decision about them is here, made
 * against `audio-port.ts`, so that each can be asserted without a browser.
 *
 * ## ⚠️ What this does NOT claim
 *
 * That a sound is better than a visual display. The research does not
 * establish that for cycling — heart-rate sonification for indoor cycling
 * (J. Multimodal User Interfaces, 2016, 16 subjects, explicitly a pilot) found
 * no supremacy of multimodal over purely visual feedback. The argument for
 * these sounds is narrower: **for a rider with no visual channel, that
 * comparison does not arise**. And nothing here says the sounds are usable at
 * ride intensity — that is `docs/validation/0003-screen-reader-and-assistive-technology.md`
 * Part I, and its table is empty.
 *
 * ## The three sounds, and whose design they are
 *
 * This project's own, derived from no product (ADR 0009 L1, R1), and no
 * product is named in any file, label or string:
 *
 * - **the power tone** — continuous, only where there is a target the trainer
 *   has ACKNOWLEDGED (a workout in ERG). A steady {@link TONE_CENTRE_HZ} when
 *   power is within {@link TONE_DEAD_BAND} of the target; higher when over,
 *   lower when under, a semitone per step, one octave at
 *   {@link TONE_FULL_SCALE} off. Quantised to semitones so the port is told
 *   only when the pitch a rider could hear changes.
 * - **the interval sound** and **the distance sound** — short, played by
 *   {@link RideCues.cue}; their notes are `web-audio.ts`'s.
 * - **the group ride's cue sounds** (#3306, ADR 0101 D-5) — short, one per
 *   event kind and one shared by every correction
 *   ({@link GROUP_RIDE_CUE_SOUND}), played by {@link RideCues.cue} like the two
 *   above, at {@link RIDE_CUE_LEVEL} on the cue bus. The pull's countdown has
 *   none.
 *
 * ## ⚠️ Silence is the answer to every "I do not know"
 *
 * - **A dropped power reading silences the tone** — never plays it at its
 *   lowest pitch. `fields.ts` §`NO_READING` renders a dash and never a zero for
 *   the same reason: a floor tone says "you are far under target", and a rider
 *   would push harder against a sensor that has gone away. This is the single
 *   most dangerous confusion available here.
 * - No target, a muted rider, a rider who never turned sounds on, and a ride
 *   that has not started: silence, and zero calls to the port.
 *
 * ## ⚠️ A sound is never the only carrier
 *
 * Every event with a sound also has its sentence, and the two rules for WHEN
 * are different on purpose:
 *
 * - **The interval sound plays on the block change**, and the *"Now: …"*
 *   sentence is handed to the announcer in the same event
 *   (`ride/RideAnnouncer.tsx` §`onEvent`). The sentence may then wait for the
 *   3 s window or be dropped by a higher-ranked one; the sound is not. ⚠️ Until
 *   #448's review this read *"plays with the region"*, and since #445 put
 *   `interval-now` behind the window that meant a beep held or lost with its
 *   sentence — a loss for a sighted rider with announcements off, too. What is
 *   true now: the sound is never the only thing OFFERED, and the change is
 *   always on the panel, but it is not always SPOKEN.
 * - **The distance sound plays only on the frame `announce.ts` SAID the
 *   distance-tick sentence** — unchanged by #448, whose finding was about the
 *   interval sound only.
 * - **A group ride cue's sound plays on the frame the cue is selected**, as
 *   the interval sound does (#3306, ADR 0101 D-5.5): `GameView` plays it where
 *   it hands the cue's sentence to the announcer, so a sentence a higher-ranked
 *   one takes the window from is dropped and its sound is not. The sentence is
 *   on the HUD's cue line for its shown time either way (#3305). A correction
 *   past its limit comes back as a quiet mark, which is no cue, so it has
 *   neither sentence nor sound; and with no power reading no cue is selected.
 *
 * A rider with the sound off loses nothing.
 *
 * ## No audio without a gesture
 *
 * {@link RideCues.begin} is the only path to `resume()`, and it is called from
 * inside a press — *Ride* in the game, a workout's *Ride*, or a sound control.
 * Until then every other method is a no-op — except that {@link RideCues.rejoin}
 * lets a panel that remounts mid-workout carry on with a context an EARLIER
 * press left running, and does nothing at all to one that is not.
 */

import type { CueKind } from '@onyourleft/domain';

import type { CueName, CueOutput, GroupRideCueName } from './audio-port';
import type { CuePreference } from './cue-preference';

/** The tone's pitch on target: A4. */
export const TONE_CENTRE_HZ = 440;
/** Within this share of the target, the pitch is steady. */
export const TONE_DEAD_BAND = 0.03;
/** This share off the target is a whole octave from the centre, and the most it moves. */
export const TONE_FULL_SCALE = 0.25;
/**
 * The tone's level at full volume — quiet under the short sounds, on purpose.
 * ⚠️ The rider's volume is NOT multiplied in here or below since #2055: it is
 * the cue bus's gain in `web-audio.ts`, and a second multiplication would
 * square it.
 */
const TONE_LEVEL = 0.12;
/**
 * The short sounds' level at full volume. Exported because the menus' sounds
 * (#946, `shell/menu-sounds.ts`) are set BELOW it: a sound answering a press
 * is never louder than one a rider needs mid-ride.
 */
export const RIDE_CUE_LEVEL = 0.3;

/**
 * The sound each group ride cue kind plays — #3306, ADR 0101 D-5.2: one of
 * its own for every event, and **one shared by all five corrections**, so a
 * rider hears "you are out of the band" and reads which on the cue line. The
 * record's type makes a kind without a sound a type error, and
 * `group-ride/cue-sounds.test.ts` walks every kind and every sound's notes.
 */
export const GROUP_RIDE_CUE_SOUND: Readonly<Record<CueKind, GroupRideCueName>> = {
  'next-up': 'group-next-up',
  'your-pull': 'group-your-pull',
  'pull-off': 'group-pull-off',
  ease: 'group-ease',
  'last-wheel': 'group-last-wheel',
  'back-in-line': 'group-back-in-line',
  climb: 'group-climb',
  regroup: 'group-regroup',
  'close-gap': 'group-correction',
  surging: 'group-correction',
  'past-front': 'group-correction',
  'eased-too-much': 'group-correction',
  'shorter-pull': 'group-correction',
};

/**
 * The tone's pitch for a power against a target, in whole semitones from
 * {@link TONE_CENTRE_HZ} — positive over, negative under, 0 in the dead band,
 * and never beyond ±12.
 */
export function toneStep(watts: number, target: number): number {
  const off = watts / target - 1;
  if (Math.abs(off) <= TONE_DEAD_BAND) return 0;
  const clamped = Math.max(-TONE_FULL_SCALE, Math.min(TONE_FULL_SCALE, off));
  return Math.round((clamped / TONE_FULL_SCALE) * 12);
}

/** A step, as a frequency. */
function hertz(step: number): number {
  return TONE_CENTRE_HZ * 2 ** (step / 12);
}

/** What a tone is fed on each update. `undefined` power is a dropped reading. */
export interface ToneInput {
  readonly watts: number | undefined;
  /** The target the trainer ACKNOWLEDGED holding, or `undefined` where there is none. */
  readonly target: number | undefined;
}

/**
 * One ride's sounds. Holds what it has told the port, so it tells it only what
 * changed — and so a second `begin` cannot layer a second tone.
 */
export class RideCues {
  readonly #output: CueOutput;
  #preference: CuePreference;
  #begun = false;
  /** The step the tone was last set to, or `undefined` when none is sounding. */
  #tone: number | undefined;

  constructor(output: CueOutput, preference: CuePreference) {
    this.#output = output;
    this.#preference = preference;
  }

  /** Inside a press, and only there. @see the module note */
  begin(): void {
    if (!this.#preference.enabled) return;
    this.#begun = true;
    this.#output.resume();
  }

  /**
   * The screen came back while the audio a PRESS started is still running — a
   * rider who left the Ride screen mid-workout and returned (#400's review).
   * Carries on without a press, because there is nothing left to unlock.
   *
   * ⚠️ **Not a path to `resume()`.** This runs from a mount, outside any
   * gesture, so it only ASKS: where the context is suspended — the platform
   * took the audio while the rider was away — or was never made, the sounds
   * stay silent until the rider's next press of *Mute sounds* or the volume,
   * which `begin` then handles. Those controls are on screen whenever a workout
   * is, so the remedy is always in reach.
   */
  rejoin(): void {
    if (!this.#preference.enabled) return;
    if (this.#output.isRunning()) this.#begun = true;
  }

  /**
   * The rider moved the mute or the volume.
   *
   * ⚠️ A new volume must reach a tone that is ALREADY sounding, not wait for
   * the next power reading — a steady rider on target sends the same step for
   * minutes, and "I moved the slider and nothing happened" is SC 1.4.2 failing
   * in the one case it exists for (found by `sounds.a11y.test.tsx`). Since
   * #2055 the volume is the cue bus's gain, which `writeCuePreference` keeps
   * stored and `web-audio.ts` sets at the {@link begin} every caller makes in
   * the same press — so nothing here touches the tone for it.
   */
  set(preference: CuePreference): void {
    this.#preference = preference;
    if (!this.#audible()) this.#silence();
  }

  /** Track power against target. Call as often as readings arrive. */
  tone(input: ToneInput): void {
    const { watts, target } = input;
    if (
      !this.#audible() ||
      watts === undefined ||
      !Number.isFinite(watts) ||
      target === undefined ||
      !(target > 0)
    ) {
      this.#silence();
      return;
    }
    const step = toneStep(watts, target);
    if (this.#tone === undefined) {
      this.#output.startTone(hertz(step), TONE_LEVEL);
    } else if (this.#tone !== step) {
      this.#output.setTone(hertz(step), TONE_LEVEL);
    } else {
      return;
    }
    this.#tone = step;
  }

  /** One short sound — only alongside its sentence. @see the module note */
  cue(name: CueName): void {
    if (!this.#audible()) return;
    this.#output.playCue(name, RIDE_CUE_LEVEL);
  }

  /** The ride ended, or the screen went away: nothing is left sounding. */
  end(): void {
    this.#silence();
    this.#begun = false;
  }

  /**
   * {@link end}, and then let the platform stop running the audio — #447.
   *
   * ⚠️ **Only when no ride and no workout is running**, which the CALLER
   * knows and this class does not: `WorkoutPanel` when its workout ends, and
   * `GameView` when a ride ends with no workout holding the trainer. A panel
   * that merely unmounts mid-workout calls {@link end}, never this — the
   * workout is still running and {@link rejoin} relies on the context still
   * being awake when the rider comes back. @see CueOutput.suspend
   *
   * Only for a ride that BEGAN its sounds: a rider who never turned them on
   * gets no call on the port at all, which #400 pins.
   */
  release(): void {
    const began = this.#begun;
    this.end();
    if (began) this.#output.suspend();
  }

  #audible(): boolean {
    return this.#begun && this.#preference.enabled && !this.#preference.muted;
  }

  #silence(): void {
    if (this.#tone === undefined) return;
    this.#output.stopTone();
    this.#tone = undefined;
  }
}
