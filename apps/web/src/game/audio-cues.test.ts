// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The ride's sounds, against a port double — #400. Every rule the module holds,
 * asserted as what the port was TOLD, because that is the layer a mute can
 * fail at while a flag says it worked.
 *
 * What none of this can establish: that anything is audible, distinguishable
 * or usable at ride intensity. `docs/validation/0003-screen-reader-and-assistive-technology.md`
 * Part I, with headphones, and its table is empty.
 */

import { describe, expect, it } from 'vitest';

import { RideCues, TONE_CENTRE_HZ, TONE_DEAD_BAND, TONE_FULL_SCALE, toneStep } from './audio-cues';
import { recordingOutput } from './audio-testing';
import { DEFAULT_CUES, type CuePreference } from './cue-preference';

const ON: CuePreference = { ...DEFAULT_CUES, enabled: true };

function begun(preference: CuePreference = ON) {
  const output = recordingOutput();
  const cues = new RideCues(output, preference);
  cues.begin();
  return { output, cues };
}

describe('off by default', () => {
  it('makes no call at all for a rider who has set nothing', () => {
    expect(DEFAULT_CUES.enabled).toBe(false);
    const { output, cues } = begun(DEFAULT_CUES);
    cues.tone({ watts: 200, target: 200 });
    cues.cue('interval');
    cues.cue('distance');
    cues.end();
    expect(output.calls).toEqual([]);
  });
});

describe('no audio without a gesture', () => {
  it('does not resume, start or play anything before begin()', () => {
    const output = recordingOutput();
    const cues = new RideCues(output, ON);
    for (let second = 0; second < 30; second += 1) {
      cues.tone({ watts: 150 + second, target: 200 });
    }
    cues.cue('interval');
    expect(output.calls).toEqual([]);
  });

  it('resumes the context in begin(), which is the only path to it', () => {
    const { output } = begun();
    expect(output.calls).toEqual([{ kind: 'resume' }]);
  });
});

describe('the mute actually silences — the wrong-layer test', () => {
  it('stops the tone, then makes ZERO oscillator starts and ZERO gain changes', () => {
    const { output, cues } = begun();
    cues.tone({ watts: 200, target: 200 });
    expect(output.count('startTone')).toBe(1);

    cues.set({ ...ON, muted: true });
    expect(output.count('stopTone')).toBe(1);
    const before = output.calls.length;
    for (let second = 0; second < 60; second += 1) {
      cues.tone({ watts: 100 + second * 5, target: 200 });
      cues.cue('interval');
      cues.cue('distance');
    }
    expect(output.calls.slice(before)).toEqual([]);
    expect(output.sounding).toBe(0);
  });

  it('sounds again once unmuted', () => {
    const { output, cues } = begun({ ...ON, muted: true });
    cues.tone({ watts: 200, target: 200 });
    expect(output.count('startTone')).toBe(0);
    cues.set(ON);
    cues.tone({ watts: 200, target: 200 });
    expect(output.count('startTone')).toBe(1);
  });
});

describe('a volume independent of the system’s', () => {
  it('scales the tone and the short sounds by the rider’s own volume, mid-ride', () => {
    const { output, cues } = begun({ ...ON, volume: 1 });
    cues.tone({ watts: 200, target: 200 });
    cues.cue('interval');
    const full = output.calls.filter((call) => call.kind !== 'resume');

    cues.set({ ...ON, volume: 0.2 });
    cues.tone({ watts: 200, target: 200 });
    cues.cue('interval');
    const quiet = output.calls.slice(full.length + 1);

    const gain = (call: (typeof output.calls)[number] | undefined): number =>
      call !== undefined && 'gain' in call ? call.gain : Number.NaN;
    // Same pitch, a fifth of the level: the tone was MOVED, not restarted.
    expect(quiet[0]?.kind).toBe('setTone');
    expect(gain(quiet[0]) / gain(full[0])).toBeCloseTo(0.2);
    expect(gain(quiet[1]) / gain(full[1])).toBeCloseTo(0.2);
  });
});

describe('a dropped sensor is silence, never a floor tone', () => {
  it('stops the tone for a missing reading, and never sounds the lowest pitch', () => {
    const { output, cues } = begun();
    cues.tone({ watts: 200, target: 200 });
    cues.tone({ watts: undefined, target: 200 });
    cues.tone({ watts: Number.NaN, target: 200 });
    expect(output.count('stopTone')).toBe(1);
    expect(output.sounding).toBe(0);
    const lowest = TONE_CENTRE_HZ / 2;
    const pitches = output.calls.flatMap((call) =>
      call.kind === 'startTone' || call.kind === 'setTone' ? [call.hz] : [],
    );
    expect(pitches.every((hz) => hz > lowest + 1)).toBe(true);
  });

  it('is silent with no target — a gradient ride has none to be off', () => {
    const { output, cues } = begun();
    cues.tone({ watts: 200, target: undefined });
    cues.tone({ watts: 200, target: 0 });
    expect(output.count('startTone')).toBe(0);
  });
});

describe('a tone stops when the ride does', () => {
  it('is told to stop at end(), and a second ride does not layer a second tone', () => {
    const { output, cues } = begun();
    cues.tone({ watts: 180, target: 200 });
    cues.end();
    expect(output.count('stopTone')).toBe(1);
    expect(output.sounding).toBe(0);

    // After end() nothing sounds until the next press.
    cues.tone({ watts: 180, target: 200 });
    expect(output.count('startTone')).toBe(1);

    cues.begin();
    cues.tone({ watts: 180, target: 200 });
    cues.begin();
    cues.tone({ watts: 190, target: 200 });
    expect(output.mostSounding).toBe(1);
  });
});

describe('the pitch', () => {
  it('is steady inside the dead band, higher over the target, lower under it', () => {
    expect(toneStep(200 * (1 + TONE_DEAD_BAND * 0.99), 200)).toBe(0);
    expect(toneStep(200 * (1 - TONE_DEAD_BAND * 0.99), 200)).toBe(0);
    expect(toneStep(230, 200)).toBeGreaterThan(0);
    expect(toneStep(170, 200)).toBeLessThan(0);
  });

  it('is an octave at full scale and moves no further', () => {
    expect(toneStep(200 * (1 + TONE_FULL_SCALE), 200)).toBe(12);
    expect(toneStep(1000, 200)).toBe(12);
    expect(toneStep(200 * (1 - TONE_FULL_SCALE), 200)).toBe(-12);
    expect(toneStep(0, 200)).toBe(-12);
  });

  it('tells the port only when the pitch a rider could hear changes', () => {
    const { output, cues } = begun();
    for (let frame = 0; frame < 60; frame += 1) {
      cues.tone({ watts: 200 + (frame % 3), target: 200 });
    }
    expect(output.count('startTone')).toBe(1);
    expect(output.count('setTone')).toBe(0);
    cues.tone({ watts: 240, target: 200 });
    expect(output.count('setTone')).toBe(1);
    const last = output.calls.at(-1);
    expect(last?.kind === 'setTone' ? last.hz : 0).toBeGreaterThan(TONE_CENTRE_HZ);
  });
});
