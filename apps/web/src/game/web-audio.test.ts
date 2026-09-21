// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `web-audio.ts` against a FAKE audio context — #400.
 *
 * ⚠️ What this can say is which nodes are built and when — that no context
 * exists before the first `resume()`, that one tone is ever sounding, that a
 * stop stops it. It cannot hear anything, and it says nothing about whether
 * the sounds are distinguishable, loud enough or annoying: that is
 * `docs/validation/0003-screen-reader-and-assistive-technology.md` Part I, with
 * headphones, and its table is empty.
 */

import { describe, expect, it } from 'vitest';

import { webAudioOutput, type AudioContextLike } from './web-audio';

interface FakeOscillator {
  type: string;
  started: number;
  stopped: number;
  frequency: { value: number; setTargetAtTime: (value: number) => void };
  connect: (to: unknown) => unknown;
  start: () => void;
  stop: () => void;
}

function fakeContext(state: 'suspended' | 'running' = 'suspended') {
  const oscillators: FakeOscillator[] = [];
  let resumed = 0;
  const param = () => ({
    value: 0,
    setValueAtTime: () => undefined,
    setTargetAtTime: () => undefined,
    linearRampToValueAtTime: () => undefined,
  });
  const context = {
    currentTime: 0,
    destination: {},
    state,
    resume: () => {
      resumed += 1;
      return Promise.resolve();
    },
    createOscillator: () => {
      const oscillator: FakeOscillator = {
        type: '',
        started: 0,
        stopped: 0,
        frequency: {
          value: 0,
          setTargetAtTime: (value: number) => {
            oscillator.frequency.value = value;
          },
        },
        connect: (to) => to,
        start: () => {
          oscillator.started += 1;
        },
        stop: () => {
          oscillator.stopped += 1;
        },
      };
      oscillators.push(oscillator);
      return oscillator;
    },
    createGain: () => ({ gain: param(), connect: (to: unknown) => to }),
  };
  return {
    context: context as unknown as AudioContextLike,
    oscillators,
    resumed: () => resumed,
  };
}

describe('the Web Audio output', () => {
  it('makes no context before the first resume(), and does nothing without one', () => {
    let made = 0;
    const fake = fakeContext();
    const output = webAudioOutput(() => {
      made += 1;
      return fake.context;
    });
    output.startTone(440, 0.1);
    output.playCue('interval', 0.3);
    output.stopTone();
    expect(made).toBe(0);
    expect(fake.oscillators).toHaveLength(0);

    output.resume();
    output.resume();
    expect(made).toBe(1);
    expect(fake.resumed()).toBe(2);
  });

  it('keeps ONE tone: a second start moves it rather than layering another', () => {
    const fake = fakeContext('running');
    const output = webAudioOutput(() => fake.context);
    output.resume();
    output.startTone(440, 0.1);
    output.startTone(494, 0.1);
    expect(fake.oscillators).toHaveLength(1);
    expect(fake.oscillators[0]?.frequency.value).toBe(494);
    expect(fake.resumed()).toBe(0);
  });

  it('stops the tone it started, and a new one afterwards is a new oscillator', () => {
    const fake = fakeContext('running');
    const output = webAudioOutput(() => fake.context);
    output.resume();
    output.startTone(440, 0.1);
    output.stopTone();
    output.stopTone();
    expect(fake.oscillators[0]?.stopped).toBe(1);
    output.startTone(440, 0.1);
    expect(fake.oscillators).toHaveLength(2);
  });

  it('plays the two short sounds as different numbers of notes', () => {
    const fake = fakeContext('running');
    const output = webAudioOutput(() => fake.context);
    output.resume();
    output.playCue('interval', 0.3);
    expect(fake.oscillators).toHaveLength(2);
    output.playCue('distance', 0.3);
    expect(fake.oscillators).toHaveLength(3);
    // Each note is started and stopped: nothing is left sounding.
    expect(fake.oscillators.every((note) => note.started === 1 && note.stopped === 1)).toBe(true);
  });

  it('is a silent no-op where the platform has no Web Audio at all', () => {
    const output = webAudioOutput(undefined);
    expect(() => {
      output.resume();
      output.startTone(440, 0.1);
      output.setTone(440, 0.1);
      output.playCue('distance', 0.3);
      output.stopTone();
    }).not.toThrow();
  });
});
