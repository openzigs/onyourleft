// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A `CueOutput` that records every call and makes no sound — #400's double —
 * and a fake audio context for what `web-audio.ts` builds (#2055).
 *
 * jsdom has no Web Audio, so every assertion about the sounds is an assertion
 * about what the port was TOLD. That is the right layer for the rules
 * `audio-cues.ts` holds — a mute that only set a flag while the tone kept
 * sounding would show here as a `setTone` after the mute, which is §5's
 * "wrong layer" cause exactly — and the wrong layer for what the sound is like,
 * which only a person with headphones can check
 * (`docs/validation/0003-screen-reader-and-assistive-technology.md` Part I).
 *
 * `-testing.ts`, so `check:wiring` treats it as test support rather than as
 * product code nothing imports.
 */

import type { AudioMix } from './audio-mix';
import type { CueName, CueOutput } from './audio-port';
import type { AudioContextLike } from './web-audio';

export type RecordedCall =
  | { readonly kind: 'resume' }
  | { readonly kind: 'suspend' }
  | { readonly kind: 'startTone'; readonly hz: number; readonly gain: number }
  | { readonly kind: 'setTone'; readonly hz: number; readonly gain: number }
  | { readonly kind: 'stopTone' }
  | { readonly kind: 'playCue'; readonly cue: CueName; readonly gain: number };

export interface RecordingOutput extends CueOutput {
  readonly calls: RecordedCall[];
  /** How many tones are sounding now, by the port's own count. Never above one. */
  sounding: number;
  /**
   * What {@link CueOutput.isRunning} answers. A `resume()` sets it, as a
   * gesture does to a real context; a test sets it `false` to stand for a
   * context the platform suspended. Not recorded in `calls`: it is a question,
   * not something the port was told.
   */
  running: boolean;
  /** The most tones ever sounding at once. */
  mostSounding: number;
  count: (kind: RecordedCall['kind']) => number;
}

export function recordingOutput(): RecordingOutput {
  const output: RecordingOutput = {
    calls: [],
    sounding: 0,
    running: false,
    mostSounding: 0,
    count: (kind) => output.calls.filter((call) => call.kind === kind).length,
    resume: () => {
      output.calls.push({ kind: 'resume' });
      output.running = true;
    },
    isRunning: () => output.running,
    suspend: () => {
      output.calls.push({ kind: 'suspend' });
      output.running = false;
    },
    startTone: (hz, gain) => {
      output.calls.push({ kind: 'startTone', hz, gain });
      output.sounding += 1;
      output.mostSounding = Math.max(output.mostSounding, output.sounding);
    },
    setTone: (hz, gain) => {
      output.calls.push({ kind: 'setTone', hz, gain });
    },
    stopTone: () => {
      output.calls.push({ kind: 'stopTone' });
      output.sounding = Math.max(0, output.sounding - 1);
    },
    playCue: (cue, gain) => {
      output.calls.push({ kind: 'playCue', cue, gain });
    },
  };
  return output;
}

// --- a fake audio context, for what `web-audio.ts` builds — #2055 ----------

/** A mix with every bus on at full volume, for a test about something else. */
export const EVERY_BUS_ON = (): AudioMix => ({
  masterMuted: false,
  music: { volume: 1, muted: false },
  effects: { volume: 1, muted: false },
  cues: { volume: 1, muted: false },
});

/** A node of {@link fakeAudioContext}'s graph, and where it is connected. */
export interface FakeNode {
  readonly kind: 'destination' | 'gain' | 'oscillator';
  readonly outputs: FakeNode[];
}

/** A gain node. Its `value` is the level it was last told to reach. */
export interface FakeGain extends FakeNode {
  readonly kind: 'gain';
  readonly gain: { readonly value: number };
  /** How many automation calls it has been given, after it was made. */
  readonly scheduled: number;
}

export interface FakeAudio {
  readonly context: AudioContextLike;
  readonly destination: FakeNode;
  /** Every gain made, in the order it was made. */
  readonly gains: FakeGain[];
  readonly oscillators: FakeNode[];
}

/**
 * A running context that builds a graph of plain objects and makes no sound.
 * Every automation call moves a gain's `value` straight to the level asked
 * for — where the real one would glide there — so a test reads the level a
 * node is heading to.
 */
export function fakeAudioContext(): FakeAudio {
  const destination: FakeNode = { kind: 'destination', outputs: [] };
  const gains: FakeGain[] = [];
  const oscillators: FakeNode[] = [];
  const connect =
    (from: FakeNode) =>
    (to: FakeNode): FakeNode => {
      from.outputs.push(to);
      return to;
    };
  const context = {
    currentTime: 0,
    destination,
    state: 'running',
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    createGain: () => {
      const gain = { value: 1 };
      const node = {
        kind: 'gain' as const,
        outputs: [],
        scheduled: 0,
        gain: Object.assign(gain, {
          setValueAtTime: (value: number) => reach(value),
          setTargetAtTime: (value: number) => reach(value),
          linearRampToValueAtTime: (value: number) => reach(value),
        }),
      };
      function reach(value: number): void {
        gain.value = value;
        node.scheduled += 1;
      }
      gains.push(node);
      return Object.assign(node, { connect: connect(node) });
    },
    createOscillator: () => {
      const node: FakeNode = { kind: 'oscillator', outputs: [] };
      oscillators.push(node);
      return Object.assign(node, {
        type: 'sine',
        frequency: { value: 0, setTargetAtTime: () => undefined },
        connect: connect(node),
        start: () => undefined,
        stop: () => undefined,
      });
    },
  };
  return { context: context as unknown as AudioContextLike, destination, gains, oscillators };
}

/** Every gain and oscillator made so far that connects INTO `node`. */
function inputsOf(fake: FakeAudio, node: FakeNode): FakeNode[] {
  return [...fake.gains, ...fake.oscillators].filter((from) => from.outputs.includes(node));
}

function onlyOne<T>(found: readonly T[], what: string): T {
  const [one] = found;
  if (found.length !== 1 || one === undefined) {
    throw new Error(`${what}: expected one node, found ${String(found.length)}`);
  }
  return one;
}

/**
 * The master gain, the duck and the music bus, found by how they are
 * connected and never by the order they were made: the master is the one gain
 * on the destination, the duck the gain on the master fed by a gain that no
 * note feeds (the effects and cue buses are fed by notes, each a gain on an
 * oscillator), and the music bus the gain feeding the duck.
 */
export function musicPath(fake: FakeAudio): {
  readonly master: FakeGain;
  readonly duck: FakeGain;
  readonly music: FakeGain;
} {
  const master = onlyOne(
    fake.gains.filter((gain) => gain.outputs.includes(fake.destination)),
    'master',
  );
  const duck = onlyOne(
    fake.gains.filter(
      (gain) =>
        gain.outputs.includes(master) &&
        inputsOf(fake, gain).some(
          (from) =>
            from.kind === 'gain' &&
            !inputsOf(fake, from).some((source) => source.kind === 'oscillator'),
        ),
    ),
    'duck',
  );
  const music = onlyOne(
    fake.gains.filter((gain) => gain.outputs.includes(duck)),
    'music',
  );
  return { master, duck, music };
}

/**
 * The bus a short sound is heard through: plays `cue` on `output` and follows
 * its last note's gain to the node it feeds, which is where a rider hears it.
 */
export function busOf(fake: FakeAudio, output: CueOutput, cue: CueName): FakeGain {
  const before = fake.gains.length;
  output.playCue(cue, 0.1);
  const note = fake.gains.at(-1);
  if (note === undefined || fake.gains.length === before) {
    throw new Error(`${cue}: no note was made — is there a context yet?`);
  }
  const bus = onlyOne(note.outputs, `${cue}'s bus`);
  const asGain = fake.gains.find((gain) => gain === bus);
  if (asGain === undefined) throw new Error(`${cue}: its note feeds no bus`);
  return asGain;
}
