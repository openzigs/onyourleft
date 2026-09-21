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
  let suspended = 0;
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
    // ⚠️ `state` is left alone, as the platform leaves it until the
    // suspension has actually happened — which is the race `asleep` is for.
    suspend: () => {
      suspended += 1;
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
    suspended: () => suspended,
  };
}

/** Lets every promise the output chained on a platform call run to its end. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('answers isRunning() without ever making or resuming a context', () => {
    let made = 0;
    const suspended = fakeContext('suspended');
    const output = webAudioOutput(() => {
      made += 1;
      return suspended.context;
    });
    // No context yet: not running, and asking does not make one.
    expect(output.isRunning()).toBe(false);
    expect(made).toBe(0);
    output.resume();
    // Suspended: still not running, and asking resumed nothing further.
    expect(output.isRunning()).toBe(false);
    expect(suspended.resumed()).toBe(1);

    const running = fakeContext('running');
    const other = webAudioOutput(() => running.context);
    other.resume();
    expect(other.isRunning()).toBe(true);
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

describe('letting the audio stop after a ride — #447', () => {
  it('suspends a running context, and does nothing without one', () => {
    const none = webAudioOutput(() => fakeContext('running').context);
    none.suspend();
    expect(none.isRunning()).toBe(false);

    const fake = fakeContext('running');
    const output = webAudioOutput(() => fake.context);
    output.resume();
    expect(output.isRunning()).toBe(true);
    output.suspend();
    output.suspend();
    expect(fake.suspended(), 'asked twice').toBe(1);
    expect(output.isRunning(), 'a context asked to sleep still reports running').toBe(false);
  });

  it('does not suspend a context that is not running', async () => {
    const fake = fakeContext('suspended');
    const output = webAudioOutput(() => fake.context);
    output.resume();
    // ⚠️ Once the resume has been ANSWERED — #455. Before that it is a resume
    // in flight, which a suspend must follow; the case below is that one. The
    // fake leaves `state` suspended, which is a platform that refused it.
    await settled();
    output.suspend();
    expect(fake.suspended()).toBe(0);
  });

  it('honours a suspend asked for while a resume is still in flight — #455', async () => {
    // ⚠️ The race #448's review found. `state` is still `suspended` until the
    // platform has resumed, so a suspend in that window used to read
    // "not running", do nothing — and the resume then landed and left the
    // audio running after the ride had ended.
    const fake = fakeContext('suspended');
    let land: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      land = () => {
        (fake.context as { state: string }).state = 'running';
        resolve();
      };
    });
    const context = fake.context as unknown as { resume: () => Promise<void> };
    const resumeOnce = context.resume;
    context.resume = () => {
      void resumeOnce();
      return pending;
    };
    const output = webAudioOutput(() => fake.context);
    output.resume();
    output.suspend();
    expect(fake.suspended(), 'asked for, in the order the platform applies them').toBe(1);
    expect(output.isRunning()).toBe(false);
    land();
    await settled();
    // The platform now says running — the resume landed first, and the
    // suspend asked after it is still ahead of it in the platform's queue.
    expect(output.isRunning(), 'asleep, whatever the platform says in between').toBe(false);
    // And the next press wakes it, exactly as after any other suspend.
    output.resume();
    expect(fake.resumed()).toBe(2);
    expect(output.isRunning()).toBe(true);
  });

  it('resumes on the next press even while the platform still says running', () => {
    // ⚠️ The race: `state` changes only once the platform has suspended, so a
    // press in the same breath as the end of a workout finds `running` — and a
    // `resume()` that trusted it would ask for nothing, and ride in silence.
    const fake = fakeContext('running');
    const output = webAudioOutput(() => fake.context);
    output.resume();
    expect(fake.resumed()).toBe(0);
    output.suspend();
    output.resume();
    expect(fake.resumed()).toBe(1);
    expect(output.isRunning()).toBe(true);
  });
});
