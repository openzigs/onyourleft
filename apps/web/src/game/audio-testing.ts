// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A `CueOutput` that records every call and makes no sound — #400's double.
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

import type { CueName, CueOutput } from './audio-port';

export type RecordedCall =
  | { readonly kind: 'resume' }
  | { readonly kind: 'startTone'; readonly hz: number; readonly gain: number }
  | { readonly kind: 'setTone'; readonly hz: number; readonly gain: number }
  | { readonly kind: 'stopTone' }
  | { readonly kind: 'playCue'; readonly cue: CueName; readonly gain: number };

export interface RecordingOutput extends CueOutput {
  readonly calls: RecordedCall[];
  /** How many tones are sounding now, by the port's own count. Never above one. */
  sounding: number;
  /** The most tones ever sounding at once. */
  mostSounding: number;
  count: (kind: RecordedCall['kind']) => number;
}

export function recordingOutput(): RecordingOutput {
  const output: RecordingOutput = {
    calls: [],
    sounding: 0,
    mostSounding: 0,
    count: (kind) => output.calls.filter((call) => call.kind === kind).length,
    resume: () => {
      output.calls.push({ kind: 'resume' });
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
