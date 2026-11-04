// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The rider's mix — #2055: one stored preference for the music, effects and
 * cue buses and the master, read back from the graph `web-audio.ts` builds.
 *
 * ⚠️ Every level here is read from the GRAPH, through `audio-testing.ts`'s fake
 * context and the same `deviceAudioMix` the app builds its output over — never
 * from the object that wrote it. A write to a key the graph never reads would
 * pass any test that read the write back from its own module.
 */

import { describe, expect, it, vi } from 'vitest';

import { effectsBus, writeMenuSoundPreference } from '../shell/menu-sound-preference';

import { AUDIO_MIX_STORAGE_KEY, readAudioMix, writeAudioBus } from './audio-mix';
import type { CueOutput } from './audio-port';
import { busOf, fakeAudioContext, musicPath, type FakeAudio } from './audio-testing';
import { cueBus, writeCuePreference } from './cue-preference';
import type { PreferenceStorage } from './hud/announce-preference';
import { deviceAudioMix, webAudioOutput } from './web-audio';

/** A device's storage that outlives the module and the graph, as `localStorage` outlives a reload. */
function disk(): { readonly values: Map<string, string>; readonly store: PreferenceStorage } {
  const values = new Map<string, string>();
  return {
    values,
    store: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
    },
  };
}

/** The app at start: the shared output's composition over `store`, and the first press. */
function start(
  store: PreferenceStorage,
  build: typeof webAudioOutput = webAudioOutput,
  mixOf: typeof deviceAudioMix = deviceAudioMix,
): { readonly fake: FakeAudio; readonly output: CueOutput } {
  const fake = fakeAudioContext();
  const output = build(
    () => fake.context,
    mixOf(() => store),
  );
  output.resume();
  return { fake, output };
}

/** Every level a rider hears through, read from the graph. */
function levels(fake: FakeAudio, output: CueOutput) {
  const { master, duck, music } = musicPath(fake);
  return {
    master: master.gain.value,
    duck: duck.gain.value,
    music: music.gain.value,
    effects: busOf(fake, output, 'select').gain.value,
    cues: busOf(fake, output, 'distance').gain.value,
  };
}

describe('the graph — #2055', () => {
  it('builds master, duck, music, effects and cue gains as #2033 draws them', () => {
    const { store } = disk();
    const { fake, output } = start(store);
    const { master, duck, music } = musicPath(fake);
    expect(master.outputs).toEqual([fake.destination]);
    expect(duck.outputs).toEqual([master]);
    expect(music.outputs).toEqual([duck]);
    // The menus' sounds and the ride's cues each have their own bus, on the master.
    const effects = busOf(fake, output, 'select');
    const cues = busOf(fake, output, 'interval');
    expect(effects).not.toBe(cues);
    expect(effects.outputs).toEqual([master]);
    expect(cues.outputs).toEqual([master]);
    for (const menu of ['confirm', 'back'] as const)
      expect(busOf(fake, output, menu)).toBe(effects);
    expect(busOf(fake, output, 'distance')).toBe(cues);
    // And the continuous tone is a cue.
    output.startTone(440, 0.1);
    const tone = fake.oscillators.at(-1);
    expect(tone?.outputs[0]?.outputs).toEqual([cues]);
  });

  it('with nothing stored: music on, effects and cues muted, master on', () => {
    const { store } = disk();
    const { fake, output } = start(store);
    expect(levels(fake, output)).toEqual({ master: 1, duck: 1, music: 0.5, effects: 0, cues: 0 });
  });

  it('silences everything through the master mute', () => {
    const { store, values } = disk();
    start(store);
    const kept = JSON.parse(values.get(AUDIO_MIX_STORAGE_KEY) ?? '{}') as object;
    values.set(AUDIO_MIX_STORAGE_KEY, JSON.stringify({ ...kept, masterMuted: true }));
    const { fake, output } = start(store);
    expect(levels(fake, output).master).toBe(0);
  });
});

describe('the mix across a reload — #2055', () => {
  it('reads back music at 0.4 and muted effects from a REBUILT graph', async () => {
    const { store } = disk();
    // Effects on before, so that muting them is a change the graph must see.
    writeMenuSoundPreference(store, { enabled: true, volume: 0.5 });
    start(store);
    expect(writeAudioBus(store, 'music', { volume: 0.4, muted: false })).toBe(true);
    expect(writeAudioBus(store, 'effects', { volume: 0.5, muted: true })).toBe(true);

    // The module and the graph are discarded, and both are rebuilt as the app
    // does at start; only the device's storage survives.
    vi.resetModules();
    const again = await import('./web-audio');
    const { fake, output } = start(store, again.webAudioOutput, again.deviceAudioMix);
    const heard = levels(fake, output);
    expect(heard.music).toBe(0.4);
    expect(heard.effects).toBe(0);
  });

  it('takes effects and cues from the old keys the first time, and keeps them', () => {
    const { store, values } = disk();
    // A rider of an earlier build: menu sounds on at 0.7, ride sounds at 0.3.
    values.set('oyl.menuSounds.v1', JSON.stringify({ enabled: true, volume: 0.7 }));
    values.set('oyl.cues.v1', JSON.stringify({ enabled: true, volume: 0.3, muted: false }));
    expect(values.has(AUDIO_MIX_STORAGE_KEY)).toBe(false);

    const first = start(store);
    expect(levels(first.fake, first.output)).toMatchObject({ effects: 0.7, cues: 0.3, music: 0.5 });

    // Kept: what the old keys say now is no longer read for a stored bus.
    values.set('oyl.menuSounds.v1', JSON.stringify({ enabled: false, volume: 0.1 }));
    values.set('oyl.cues.v1', JSON.stringify({ enabled: false, volume: 0.1, muted: true }));
    const next = start(store);
    expect(levels(next.fake, next.output)).toMatchObject({ effects: 0.7, cues: 0.3 });
  });

  it('mutes a cue bus whose old key says muted, whatever its volume', () => {
    const { store, values } = disk();
    values.set('oyl.cues.v1', JSON.stringify({ enabled: true, volume: 0.8, muted: true }));
    const { fake, output } = start(store);
    expect(levels(fake, output).cues).toBe(0);
  });
});

describe('the old switches keep their bus in step until #2056', () => {
  it('a menu-sounds switch turned on in Settings reaches the graph on the next press', () => {
    const { store } = disk();
    const { fake, output } = start(store);
    const effects = busOf(fake, output, 'select');
    expect(effects.gain.value).toBe(0);

    writeMenuSoundPreference(store, { enabled: true, volume: 0.6 });
    output.resume();
    expect(effects.gain.value).toBe(0.6);
  });

  it('the ride’s volume and mute reach the cue bus', () => {
    const { store } = disk();
    const { fake, output } = start(store);
    const cues = busOf(fake, output, 'interval');

    writeCuePreference(store, { enabled: true, volume: 0.9, muted: false });
    output.resume();
    expect(cues.gain.value).toBe(0.9);
    writeCuePreference(store, { enabled: true, volume: 0.9, muted: true });
    output.resume();
    expect(cues.gain.value).toBe(0);
  });

  it('schedules nothing on a bus whose level has not moved', () => {
    const { store } = disk();
    writeCuePreference(store, { enabled: true, volume: 0.9, muted: false });
    const { fake, output } = start(store);
    const cues = busOf(fake, output, 'interval');
    const { master } = musicPath(fake);
    for (let press = 0; press < 5; press += 1) {
      output.resume();
      output.playCue('distance', 0.1);
    }
    expect(cues.scheduled).toBe(0);
    expect(master.scheduled).toBe(0);
    writeCuePreference(store, { enabled: true, volume: 0.4, muted: false });
    output.resume();
    output.resume();
    expect(cues.scheduled).toBe(1);
  });

  it('a write before the first read leaves the other bus to its old key', () => {
    const { store, values } = disk();
    values.set('oyl.menuSounds.v1', JSON.stringify({ enabled: true, volume: 0.7 }));
    writeCuePreference(store, { enabled: true, volume: 0.2, muted: false });
    const { fake, output } = start(store);
    expect(levels(fake, output)).toMatchObject({ effects: 0.7, cues: 0.2 });
  });
});

describe('what a device stores, read field by field', () => {
  const legacy = () => ({
    effects: effectsBus({ enabled: true, volume: 0.7 }),
    cues: cueBus({ enabled: false, volume: 0.5, muted: false }),
  });

  it('takes a bus it cannot read from its old key, and keeps the rest', () => {
    const { store, values } = disk();
    values.set(
      AUDIO_MIX_STORAGE_KEY,
      JSON.stringify({
        masterMuted: false,
        music: { volume: 0.3, muted: false },
        effects: { volume: 'loud', muted: false },
        cues: { volume: 0.4, muted: 'no' },
      }),
    );
    expect(readAudioMix(store, legacy)).toEqual({
      masterMuted: false,
      music: { volume: 0.3, muted: false },
      effects: { volume: 0.7, muted: false },
      cues: { volume: 0.5, muted: true },
    });
  });

  it('reads junk, an array and a blocked store as nothing stored, and never throws', () => {
    const blocked: PreferenceStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    const fresh = {
      masterMuted: false,
      music: { volume: 0.5, muted: false },
      ...legacy(),
    };
    expect(readAudioMix(blocked, legacy)).toEqual(fresh);
    expect(readAudioMix(undefined, legacy)).toEqual(fresh);
    expect(writeAudioBus(blocked, 'music', { volume: 0.1, muted: false })).toBe(false);
    expect(writeAudioBus(undefined, 'music', { volume: 0.1, muted: false })).toBe(false);
    for (const junk of ['{', '[1,2]', 'null', '7']) {
      const { store, values } = disk();
      values.set(AUDIO_MIX_STORAGE_KEY, junk);
      expect(readAudioMix(store, legacy), junk).toEqual(fresh);
      // And what replaced it is the mix and nothing of the junk.
      expect(JSON.parse(values.get(AUDIO_MIX_STORAGE_KEY) ?? 'null'), junk).toEqual(fresh);
    }
  });

  it('reads the old keys only when a bus needs them', () => {
    const { store } = disk();
    const asked = vi.fn(legacy);
    readAudioMix(store, asked);
    readAudioMix(store, asked);
    expect(asked).toHaveBeenCalledTimes(1);
  });

  it('keeps a volume in tenths, and refuses one outside 0 to 1', () => {
    const { store, values } = disk();
    values.set(
      AUDIO_MIX_STORAGE_KEY,
      JSON.stringify({
        music: { volume: 0.44, muted: false },
        effects: { volume: 1.5, muted: false },
        cues: { volume: -0.1, muted: false },
      }),
    );
    const mix = readAudioMix(store, legacy);
    expect(mix.music.volume).toBe(0.4);
    expect(mix.effects).toEqual(legacy().effects);
    expect(mix.cues).toEqual(legacy().cues);
  });
});
