// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The games' sounds on the effects bus — #3012, read off the GRAPH
 * `web-audio.ts` builds over a fake context (`audio-testing.ts`), never off a
 * mock of `playCue`: each sound's notes are found by what they connect to.
 */

import { describe, expect, it } from 'vitest';

import type { AudioMix } from './audio-mix';
import type { GameEffectName } from './audio-port';
import {
  busOf,
  fakeAudioContext,
  musicPath,
  recordingOutput,
  type FakeAudio,
} from './audio-testing';
import { GAME_EFFECT_LEVEL, GameEffects } from './game-effects';
import { webAudioOutput } from './web-audio';

const EVERY_EFFECT: readonly GameEffectName[] = [
  'delivery-throw',
  'delivery-delivered',
  'delivery-missed',
  'delivery-crash',
  'hazard-dog',
  'hazard-car',
  'hazard-rider',
  'car-engine',
];

/** A mix with the effects at `effects`, the cues at 0.6, and the music at 0.4. */
function mixWith(effects: AudioMix['effects'], masterMuted = false): () => AudioMix {
  return () => ({
    masterMuted,
    music: { volume: 0.4, muted: false },
    effects,
    cues: { volume: 0.6, muted: false },
  });
}

/** The gains `name`'s notes were made with, played through `effects`, and each one's bus. */
function played(fake: FakeAudio, effects: GameEffects, name: GameEffectName) {
  const before = fake.gains.length;
  effects.play(name);
  return fake.gains.slice(before).map((note) => note.outputs);
}

describe('the games’ sounds — #3012', () => {
  it('plays every one on the effects bus, at the rider’s effects volume, never on the cues', () => {
    const fake = fakeAudioContext();
    const mix = mixWith({ volume: 0.5, muted: false });
    const output = webAudioOutput(() => fake.context, mix);
    const effects = new GameEffects(output, mix);
    effects.begin();
    const effectsBus = busOf(fake, output, 'select');
    const cueBus = busOf(fake, output, 'interval');
    expect(effectsBus).not.toBe(cueBus);
    expect(effectsBus.gain.value).toBe(0.5);
    for (const name of EVERY_EFFECT) {
      const buses = played(fake, effects, name);
      expect(buses.length, name).toBeGreaterThan(0);
      for (const bus of buses) expect(bus, name).toStrictEqual([effectsBus]);
    }
    expect(cueBus.gain.value).toBe(0.6);
  });

  it('plays each at one level, the ride cues’ own, so the bus alone sets the volume', () => {
    const output = recordingOutput();
    const effects = new GameEffects(output, mixWith({ volume: 0.3, muted: false }));
    effects.begin();
    for (const name of EVERY_EFFECT) effects.play(name);
    const cues = output.calls.filter((call) => call.kind === 'playCue');
    expect(cues.map((call) => call.cue)).toStrictEqual(EVERY_EFFECT);
    for (const call of cues) expect(call.gain).toBe(GAME_EFFECT_LEVEL);
  });

  it('is silenced by the effects mute, with the cues and the music left as they were', () => {
    const fake = fakeAudioContext();
    let muted = false;
    const mix = (): AudioMix => mixWith({ volume: 0.5, muted })();
    const output = webAudioOutput(() => fake.context, mix);
    const effects = new GameEffects(output, mix);
    effects.begin();
    output.setMusicOn(true);
    const effectsBus = busOf(fake, output, 'delivery-crash');
    expect(effectsBus.gain.value).toBe(0.5);
    // Muted mid-ride, as Settings' switch does: the bus goes to nought at once.
    muted = true;
    output.applyMix();
    expect(effectsBus.gain.value).toBe(0);
    expect(busOf(fake, output, 'interval').gain.value).toBe(0.6);
    expect(musicPath(fake).music.gain.value).toBe(0.4);
  });

  it('resumes nothing and plays nothing where the effects or the master are muted at the press', () => {
    for (const mix of [
      mixWith({ volume: 0.5, muted: true }),
      mixWith({ volume: 0.5, muted: false }, true),
    ]) {
      const output = recordingOutput();
      const effects = new GameEffects(output, mix);
      effects.begin();
      for (const name of EVERY_EFFECT) effects.play(name);
      effects.release();
      expect(output.calls).toStrictEqual([]);
    }
  });

  it('plays nothing before the press or after the ride, and lets the audio go only on a release', () => {
    const output = recordingOutput();
    const effects = new GameEffects(output, mixWith({ volume: 0.5, muted: false }));
    effects.play('delivery-throw');
    expect(output.calls).toStrictEqual([]);
    effects.begin();
    effects.end();
    effects.play('delivery-throw');
    expect(output.calls.map((call) => call.kind)).toStrictEqual(['resume']);
    effects.begin();
    effects.release();
    effects.play('delivery-throw');
    expect(output.calls.map((call) => call.kind)).toStrictEqual(['resume', 'resume', 'suspend']);
  });
});
