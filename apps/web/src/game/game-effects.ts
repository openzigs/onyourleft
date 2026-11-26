// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The games' sounds through the port — #3012: Delivery's throw, delivery,
 * miss, crash, hazard warnings and a car's engine
 * (`delivery/delivery-sounds.ts` decides which), each on the **effects** bus
 * (`web-audio.ts` §`BUS_OF`), so the rider's effects volume and mute are
 * theirs (#2055, #2056) and the ride's cues and the music are not touched.
 *
 * ⚠️ **Played at one level, and the bus applies the volume**, as
 * `audio-cues.ts` and `shell/menu-sounds.ts` do: a second multiplication here
 * would square the rider's choice.
 *
 * ## The press, and the battery
 *
 * The context is made and resumed only inside a press (`web-audio.ts`
 * §"Where the context is created"), so {@link GameEffects.begin} is called
 * from the *Ride* press of a ride that runs a round. It resumes nothing where
 * the effects bus or the master is muted then: a rider who hears none of
 * these is not made to pay for a running audio thread (#447's reason), and a
 * sound asked for afterwards is dropped rather than scheduled on a suspended
 * context. {@link GameEffects.release} lets the platform stop the audio when
 * the ride ends, exactly as `RideCues.release` does, and only for effects that
 * began.
 */

import type { AudioMix } from './audio-mix';
import type { CueOutput, GameEffectName } from './audio-port';
import { RIDE_CUE_LEVEL } from './audio-cues';

/**
 * The level the games' sounds are scheduled at, before the effects bus's
 * volume: the ride's cues' own (`audio-cues.ts` §`RIDE_CUE_LEVEL`), so a game
 * sound is never louder than a cue a rider needs mid-ride.
 */
export const GAME_EFFECT_LEVEL = RIDE_CUE_LEVEL;

/** One ride's game sounds. */
export class GameEffects {
  readonly #output: CueOutput;
  readonly #mix: () => AudioMix;
  #begun = false;

  constructor(output: CueOutput, mix: () => AudioMix) {
    this.#output = output;
    this.#mix = mix;
  }

  /** Inside the *Ride* press, and only there. @see the module note */
  begin(): void {
    const mix = this.#mix();
    if (mix.masterMuted || mix.effects.muted) return;
    this.#begun = true;
    this.#output.resume();
  }

  /** One game sound, on the effects bus. Nothing before {@link begin}, or after {@link release}. */
  play(name: GameEffectName): void {
    if (!this.#begun) return;
    this.#output.playCue(name, GAME_EFFECT_LEVEL);
  }

  /**
   * The ride is over and no workout holds the audio: let the platform stop
   * running it, if these sounds began it. @see CueOutput.suspend
   */
  release(): void {
    const began = this.#begun;
    this.#begun = false;
    if (began) this.#output.suspend();
  }

  /** The ride ended while a workout still holds the audio: play no more, and suspend nothing. */
  end(): void {
    this.#begun = false;
  }
}
