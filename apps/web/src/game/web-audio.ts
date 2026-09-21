// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's sounds through the platform's own Web Audio — #400. The ONE file
 * in the client that names `AudioContext`.
 *
 * ## Where the context is created, and when
 *
 * **Lazily, inside {@link CueOutput.resume}**, which `audio-cues.ts` calls only
 * from a press. Constructing an `AudioContext` outside a user gesture gives a
 * SUSPENDED one in every current engine, and one that stays suspended without
 * saying so; so until a rider has pressed *Ride* or a sound control there is no
 * context at all, and every other method here is a no-op.
 *
 * ## ⚠️ What happens when it is suspended
 *
 * Android suspends audio when the screen goes off or another app takes it, and
 * a browser can suspend an idle context. Nothing scheduled on a suspended
 * context is heard, and nothing here reports that — there is no event a rider
 * could act on. The next press of *Ride* or of a sound control calls `resume()`
 * again, which resumes it. A Ride screen that comes back mid-workout asks
 * {@link CueOutput.isRunning} instead and resumes nothing, because a mount is
 * not a press (`audio-cues.ts` §`rejoin`). Whether that is enough on a real phone is
 * `docs/validation/0003-screen-reader-and-assistive-technology.md` Part I,
 * step I7, and its table is empty.
 *
 * ## The two short sounds, which are this project's own
 *
 * - **interval**: two short rising notes, a fifth apart — a change is coming
 *   and it is a change, not a warning;
 * - **distance**: one short low note — a mark passed.
 *
 * Designed here, from nothing; ADR 0009 forbids deriving them from a product
 * and none was consulted. Each note has a 10 ms attack and a short release so
 * it does not click.
 *
 * ## What only a person with headphones can check
 *
 * Everything this file does with the port's five calls. jsdom has no Web
 * Audio; `web-audio.test.ts` drives it against a fake context to check which
 * nodes it builds and that one tone is ever sounding, and nothing more — it
 * cannot hear anything.
 */

import type { CueName, CueOutput } from './audio-port';

/** The half of `AudioContext` this file uses, so a test can hand in a fake. */
export type AudioContextLike = Pick<
  AudioContext,
  'currentTime' | 'destination' | 'state' | 'resume' | 'suspend' | 'createOscillator' | 'createGain'
>;

/** One note of a short sound: its pitch, when it starts, how long it lasts. */
interface Note {
  readonly hz: number;
  readonly at: number;
  readonly seconds: number;
}

const SOUNDS: Readonly<Record<CueName, readonly Note[]>> = {
  interval: [
    { hz: 587.33, at: 0, seconds: 0.12 },
    { hz: 880, at: 0.15, seconds: 0.16 },
  ],
  distance: [{ hz: 330, at: 0, seconds: 0.2 }],
};

/** How quickly a tone follows a new pitch or level, in seconds (a time constant). */
const GLIDE_SECONDS = 0.04;

/**
 * The output, over a context made by `create` the first time `resume()` is
 * called. `create` is `undefined` where the platform has no Web Audio, and
 * then every call is a no-op rather than an error.
 */
export function webAudioOutput(create: (() => AudioContextLike) | undefined): CueOutput {
  let context: AudioContextLike | undefined;
  let tone: { readonly oscillator: OscillatorNode; readonly gain: GainNode } | undefined;
  /**
   * A `suspend()` has been ASKED for — #447. ⚠️ `state` does not change until
   * the platform has done it, so a rider who ends a workout and presses *Ride*
   * on the next one in the same breath would find `state` still `running`, be
   * resumed by nothing, and ride in silence once the suspension landed. The
   * flag is what makes that `resume()` ask anyway; the platform applies the two
   * in the order they were asked.
   */
  let asleep = false;
  /**
   * How many `resume()` calls the platform has not answered yet — #455.
   *
   * ⚠️ **The other half of the race {@link asleep} closes, and #448's review
   * found it.** `state` stays `suspended` until a resume has LANDED, so a
   * `suspend()` asked for in between — a ride ended in the same breath as the
   * press that started it — read `suspended`, did nothing, and the resume then
   * landed and left the audio running with nobody riding. So a suspend is also
   * honoured while a resume is in flight. The platform applies the two in the
   * order they were asked (Web Audio queues both as control messages), so
   * asking for the suspend after the resume is enough: nothing here has to
   * await anything, and a press is never delayed by a microtask it did not
   * need.
   *
   * A count rather than a flag, because two presses can each put a resume in
   * flight and the first to land must not clear the second.
   */
  let waking = 0;

  const setTone = (frequencyHz: number, level: number): void => {
    if (context === undefined || tone === undefined) return;
    tone.oscillator.frequency.setTargetAtTime(frequencyHz, context.currentTime, GLIDE_SECONDS);
    tone.gain.gain.setTargetAtTime(level, context.currentTime, GLIDE_SECONDS);
  };

  return {
    resume() {
      if (create === undefined) return;
      context ??= create();
      if (context.state === 'suspended' || asleep) {
        asleep = false;
        waking += 1;
        // Refused outside a gesture, or by the platform; either way there is
        // nothing a rider can be told that the next press will not fix.
        context
          .resume()
          .catch(() => undefined)
          .finally(() => {
            waking -= 1;
          });
      }
    },
    isRunning() {
      return context?.state === 'running' && !asleep;
    },
    suspend() {
      // ⚠️ `waking > 0` is #455: a resume in flight has not moved `state` yet,
      // and it WILL land — so `suspended` here is not a reason to do nothing.
      if (context === undefined || asleep || (context.state !== 'running' && waking === 0)) return;
      asleep = true;
      // Refused by nothing a rider can act on; the next press resumes it anyway.
      context.suspend().catch(() => undefined);
    },
    startTone(frequencyHz, level) {
      if (context === undefined) return;
      if (tone !== undefined) {
        // One tone, ever: a second start moves it rather than layering.
        setTone(frequencyHz, level);
        return;
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequencyHz;
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.setTargetAtTime(level, context.currentTime, GLIDE_SECONDS);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      tone = { oscillator, gain };
    },
    setTone,
    stopTone() {
      if (context === undefined || tone === undefined) return;
      const now = context.currentTime;
      tone.gain.gain.setTargetAtTime(0, now, GLIDE_SECONDS / 2);
      tone.oscillator.stop(now + GLIDE_SECONDS * 4);
      tone = undefined;
    },
    playCue(name, level) {
      if (context === undefined) return;
      const start = context.currentTime;
      for (const note of SOUNDS[name]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const from = start + note.at;
        const until = from + note.seconds;
        oscillator.type = 'sine';
        oscillator.frequency.value = note.hz;
        gain.gain.setValueAtTime(0, from);
        gain.gain.linearRampToValueAtTime(level, from + 0.01);
        gain.gain.linearRampToValueAtTime(0, until);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(from);
        oscillator.stop(until + 0.02);
      }
    },
  };
}

/** The platform's `AudioContext` constructor, or `undefined` where there is none. */
function platformAudioContext(): (() => AudioContextLike) | undefined {
  const Context = (globalThis as { AudioContext?: new () => AudioContext }).AudioContext;
  return Context === undefined ? undefined : () => new Context();
}

let shared: CueOutput | undefined;

/**
 * The one output this client uses — one context for the whole app, because a
 * browser caps how many it will create and each holds an audio thread.
 * Nothing is constructed here: the context waits for the first `resume()`.
 */
export function sharedCueOutput(): CueOutput {
  shared ??= webAudioOutput(platformAudioContext());
  return shared;
}
