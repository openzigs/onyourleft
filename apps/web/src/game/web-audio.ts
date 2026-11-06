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
 * ## The short sounds, which are this project's own
 *
 * - **interval**: two short rising notes, a fifth apart — a change is coming
 *   and it is a change, not a warning;
 * - **distance**: one short low note — a mark passed.
 * - **select**, **confirm** and **back** (#946): the menus' sounds — one
 *   short high note; two rising; two falling. Each is over in 130 ms.
 *
 * Designed here, from nothing; ADR 0009 forbids deriving them from a product
 * and none was consulted. Each note has a 10 ms attack and a short release so
 * it does not click.
 *
 * ## The graph — #2055
 *
 * Built once, with the context, as epic #2033 draws it:
 *
 * ```text
 * music bus → duck → master → destination
 * effects bus ────────┘
 * cue bus ────────────┘
 * ```
 *
 * The menus' sounds go to the effects bus and the ride's cues and tone to the
 * cue bus, so each class has its own volume and mute (the Game Accessibility
 * Guidelines), and the master silences all of them. **The volume is applied
 * HERE, at the bus, and nowhere else**: `audio-cues.ts` and
 * `shell/menu-sounds.ts` play at their full level, and a second multiplication
 * there would square the rider's volume.
 *
 * The bus gains are set from the rider's mix (`audio-mix.ts`), read again at
 * every press that resumes the context and before every sound is scheduled, so
 * a choice made in Settings or on the ride's own controls is heard on the very
 * next sound, with nothing to subscribe to.
 *
 * ## The duck — #2059
 *
 * While the music plays, every short sound ducks it: the duck gain ramps down
 * to {@link MUSIC_DUCK_LEVEL} as the sound starts and back up to 1 once it has
 * ended, so an effect over full-volume music is heard and the music is never
 * cut. Ramps on the AudioParam (`setTargetAtTime`), no library, and a second
 * sound inside the first one's duck moves the way back up rather than letting
 * it land mid-sound. Music never plays during a ride, so in practice it is the
 * menus' effects that duck it; the ride's cues would reuse this unchanged.
 *
 * ## The music — #2058
 *
 * `shell/menu-music.ts` decides when the menus' loop plays, and hands its
 * `<audio>` element here ({@link CueOutput.attachMusic}): it is routed with
 * `createMediaElementSource` into the music bus, never decoded whole into an
 * `AudioBuffer` (a two-minute stereo loop decodes to tens of MB). The music
 * bus sits at 0 until {@link CueOutput.setMusicOn} brings it up to the rider's
 * music level, and goes back down over {@link MUSIC_FADE_SECONDS} — a ramp,
 * never a step — when a ride route opens.
 *
 * ## What only a person with headphones can check
 *
 * Everything this file does with the port's five calls. jsdom has no Web
 * Audio; `web-audio.test.ts` drives it against a fake context to check which
 * nodes it builds and that one tone is ever sounding, and nothing more — it
 * cannot hear anything.
 */

import { effectsBus, readMenuSoundPreference } from '../shell/menu-sound-preference';

import { readAudioMix, type AudioMix, type BusSetting } from './audio-mix';
import type { CueName, CueOutput } from './audio-port';
import { cueBus, readCuePreference } from './cue-preference';
import { deviceStorage, type PreferenceStorage } from './hud/announce-preference';

/** The half of `AudioContext` this file uses, so a test can hand in a fake. */
export type AudioContextLike = Pick<
  AudioContext,
  | 'currentTime'
  | 'destination'
  | 'state'
  | 'resume'
  | 'suspend'
  | 'createOscillator'
  | 'createGain'
  | 'createMediaElementSource'
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
  // #946: the menus' sounds. Each is over within MENU_CUE_SECONDS, from its
  // first note's start to its last note's end, so a press is never followed
  // by a sound longer than the press — UI-sound guidance puts these at about
  // 50 to 150 ms (#935's sources).
  select: [{ hz: 659.25, at: 0, seconds: 0.06 }],
  confirm: [
    { hz: 523.25, at: 0, seconds: 0.05 },
    { hz: 783.99, at: 0.06, seconds: 0.07 },
  ],
  back: [
    { hz: 587.33, at: 0, seconds: 0.05 },
    { hz: 440, at: 0.06, seconds: 0.06 },
  ],
};

/** Which bus each short sound plays on: the menus' on effects, the ride's on cues. */
const BUS_OF: Readonly<Record<CueName, 'effects' | 'cues'>> = {
  interval: 'cues',
  distance: 'cues',
  select: 'effects',
  confirm: 'effects',
  back: 'effects',
};

/**
 * How long a note takes to reach its level, in seconds. A note that starts at
 * full level clicks; 10 ms is soft without blurring a 50 ms note.
 */
const NOTE_ATTACK_SECONDS = 0.01;

/** How quickly a tone follows a new pitch or level, in seconds (a time constant). */
const GLIDE_SECONDS = 0.04;

/**
 * How long the music takes to come up or go down when it starts or a ride
 * route opens — #2058 — in seconds: the time constant of the music bus's ramp.
 * Five of them is under 1 % of where it began, which is when
 * `shell/menu-music.ts` pauses the element ({@link MUSIC_FADE_MS}).
 */
export const MUSIC_FADE_SECONDS = 0.2;

/** Five time constants of {@link MUSIC_FADE_SECONDS}, in ms: the fade is over. */
export const MUSIC_FADE_MS = MUSIC_FADE_SECONDS * 5 * 1000;

/**
 * Where the music sits under a short sound — #2059: 0.35 of its level, about
 * 9 dB down. Enough for a 60 ms note to be heard over it; not a cut.
 */
export const MUSIC_DUCK_LEVEL = 0.35;

/**
 * How quickly the duck goes down and comes back, in seconds (time constants).
 * Down fast, so the sound's attack is not masked; back slower, so the music
 * returns rather than jumps.
 */
export const MUSIC_DUCK_DOWN_SECONDS = 0.015;
export const MUSIC_DUCK_BACK_SECONDS = 0.12;

/** How long a short sound lasts, from its first note's start to its last note's end. */
function soundSeconds(name: CueName): number {
  return Math.max(...SOUNDS[name].map((note) => note.at + note.seconds));
}

/** The graph's gains — built once, with the context. @see the module note */
interface Graph {
  readonly master: GainNode;
  readonly music: GainNode;
  /** On music only: at 1, and ramped down under each short sound while music plays (#2059). */
  readonly duck: GainNode;
  readonly effects: GainNode;
  readonly cues: GainNode;
}

/** The gains the rider's mix sets, and the level each is heading to. */
type MixLevels = Readonly<Record<'master' | 'music' | 'effects' | 'cues', number>>;

/** A bus's gain: its volume, or 0 when it is muted. */
function busLevel(bus: BusSetting): number {
  return bus.muted ? 0 : bus.volume;
}

/** The levels the mix asks for, with music at 0 while it is not playing (#2058). */
function mixLevels(mix: AudioMix, musicOn: boolean): MixLevels {
  return {
    master: mix.masterMuted ? 0 : 1,
    music: musicOn ? busLevel(mix.music) : 0,
    effects: busLevel(mix.effects),
    cues: busLevel(mix.cues),
  };
}

/**
 * The output, over a context made by `create` the first time `resume()` is
 * called, its buses set from `mix`. `create` is `undefined` where the platform
 * has no Web Audio, and then every call is a no-op rather than an error.
 */
export function webAudioOutput(
  create: (() => AudioContextLike) | undefined,
  mix: () => AudioMix,
): CueOutput {
  let context: AudioContextLike | undefined;
  let graph: Graph | undefined;
  /**
   * What each bus was last set to. ⚠️ Not `gain.value`: during a glide that
   * reads the level on the way, which never equals the target, so every sound
   * would schedule the same glide again.
   */
  let applied: MixLevels | undefined;
  let tone: { readonly oscillator: OscillatorNode; readonly gain: GainNode } | undefined;
  /** Whether the menus' music is meant to be heard — #2058. The bus is 0 otherwise. */
  let musicOn = false;
  /**
   * The element routed into the music bus. ⚠️ `createMediaElementSource` may be
   * called ONCE per element — a second call throws — so it is remembered.
   */
  let music: HTMLMediaElement | undefined;
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

  /**
   * The graph over `into`: made the first time, and set from the rider's mix
   * as it is stored NOW every time. A bus that moved glides to its new level,
   * as the tone does, so a volume moved mid-tone does not click; one that did
   * not is left alone, so a sound at the same mix schedules nothing on it.
   */
  const buses = (into: AudioContextLike): Graph => {
    const levels = mixLevels(mix(), musicOn);
    if (graph === undefined) {
      const gain = (to: AudioNode, value: number): GainNode => {
        const node = into.createGain();
        node.gain.value = value;
        node.connect(to);
        return node;
      };
      const master = gain(into.destination, levels.master);
      const duck = gain(master, 1);
      graph = {
        master,
        duck,
        music: gain(duck, levels.music),
        effects: gain(master, levels.effects),
        cues: gain(master, levels.cues),
      };
    } else {
      for (const bus of ['master', 'music', 'effects', 'cues'] as const) {
        if (applied?.[bus] !== levels[bus]) {
          graph[bus].gain.setTargetAtTime(levels[bus], into.currentTime, GLIDE_SECONDS / 2);
        }
      }
    }
    applied = levels;
    return graph;
  };

  const setTone = (frequencyHz: number, level: number): void => {
    if (context === undefined || tone === undefined) return;
    buses(context);
    tone.oscillator.frequency.setTargetAtTime(frequencyHz, context.currentTime, GLIDE_SECONDS);
    tone.gain.gain.setTargetAtTime(level, context.currentTime, GLIDE_SECONDS);
  };

  return {
    resume() {
      if (create === undefined) return;
      context ??= create();
      // Inside the press: a choice made since the last sound is applied now.
      buses(context);
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
    applyMix() {
      // No context, no graph: the mix is read when the first press builds it.
      if (context === undefined) return;
      buses(context);
    },
    attachMusic(element) {
      if (context === undefined || music === element) return;
      const bus = buses(context).music;
      context.createMediaElementSource(element).connect(bus);
      music = element;
    },
    setMusicOn(on) {
      musicOn = on;
      if (context === undefined || graph === undefined) return;
      const level = mixLevels(mix(), on).music;
      if (applied?.music === level) return;
      // A ramp over the fade, never a step: a cut is jarring (#2059's reason).
      graph.music.gain.setTargetAtTime(level, context.currentTime, MUSIC_FADE_SECONDS);
      applied = { ...(applied ?? mixLevels(mix(), on)), music: level };
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
      const bus = buses(context).cues;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequencyHz;
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.setTargetAtTime(level, context.currentTime, GLIDE_SECONDS);
      oscillator.connect(gain);
      gain.connect(bus);
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
      const graph = buses(context);
      const bus = graph[BUS_OF[name]];
      const start = context.currentTime;
      if (musicOn) {
        // #2059: under the music's ramp, never a cut. Anything scheduled from
        // now on — an earlier sound's way back up — gives way to this sound's.
        const duck = graph.duck.gain;
        duck.cancelScheduledValues(start);
        duck.setTargetAtTime(MUSIC_DUCK_LEVEL, start, MUSIC_DUCK_DOWN_SECONDS);
        duck.setTargetAtTime(1, start + soundSeconds(name), MUSIC_DUCK_BACK_SECONDS);
      }
      for (const note of SOUNDS[name]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const from = start + note.at;
        const until = from + note.seconds;
        oscillator.type = 'sine';
        oscillator.frequency.value = note.hz;
        gain.gain.setValueAtTime(0, from);
        gain.gain.linearRampToValueAtTime(level, from + NOTE_ATTACK_SECONDS);
        gain.gain.linearRampToValueAtTime(0, until);
        oscillator.connect(gain);
        gain.connect(bus);
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

/**
 * The rider's mix as this device holds it — #2055: `audio-mix.ts` over
 * `storage()`, with the effects and cue buses taken from their old keys
 * (`oyl.menuSounds.v1`, `oyl.cues.v1`) the first time and kept. What
 * {@link sharedCueOutput} sets its buses from.
 */
export function deviceAudioMix(storage: () => PreferenceStorage | undefined): () => AudioMix {
  return () => {
    const store = storage();
    return readAudioMix(store, () => ({
      effects: effectsBus(readMenuSoundPreference(store)),
      cues: cueBus(readCuePreference(store)),
    }));
  };
}

let shared: CueOutput | undefined;

/**
 * The one output this client uses — one context for the whole app, because a
 * browser caps how many it will create and each holds an audio thread.
 * Nothing is constructed here: the context, and the graph with it, wait for
 * the first `resume()`.
 */
export function sharedCueOutput(): CueOutput {
  shared ??= webAudioOutput(platformAudioContext(), deviceAudioMix(deviceStorage));
  return shared;
}
