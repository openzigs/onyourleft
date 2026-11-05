// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The three volumes on Settings, heard from the graph — #2056.
 *
 * Music, the menus' sounds and the ride's sounds each have a switch and a
 * slider on Settings. Each change here is read from the GRAPH `web-audio.ts`
 * built before it — a bus node found before the change and read after it,
 * with no sound played in between — so a write the graph only picks up at the
 * next sound, or a write to a key the graph never reads, is red.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { writeAudioBus } from '../game/audio-mix';
import type { CueOutput } from '../game/audio-port';
import { busOf, fakeAudioContext, musicPath, type FakeAudio } from '../game/audio-testing';
import { writeCuePreference } from '../game/cue-preference';
import type { PreferenceStorage } from '../game/hud/announce-preference';
import { deviceAudioMix, webAudioOutput } from '../game/web-audio';
import { writeMenuSoundPreference } from '../shell/menu-sound-preference';
import { mount, settle, type Mounted } from '../testing/mount';

import { SettingsView } from './SettingsView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function disk(): PreferenceStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** Settings over `store`, with the app's output over a fake context already playing. */
async function settings(
  store: PreferenceStorage,
): Promise<{ readonly fake: FakeAudio; readonly output: CueOutput }> {
  const fake = fakeAudioContext();
  const output = webAudioOutput(
    () => fake.context,
    deviceAudioMix(() => store),
  );
  // A press elsewhere has built the graph and started the menus' music
  // (#2058) before Settings is opened.
  output.resume();
  output.setMusicOn(true);
  mounted = await mount(
    <SettingsView
      units="metric"
      onUnitsChange={() => undefined}
      onRiderMassChange={() => undefined}
      announcements={store}
      soundOutput={output}
    />,
  );
  await settle();
  return { fake, output };
}

function slider(id: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`#${id}`);
  if (found === null) throw new Error(`no #${id}`);
  return found;
}

/** Move a range input, through the native setter React 19 needs. */
async function slide(input: HTMLInputElement, value: number): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  await act(async () => {
    descriptor?.set?.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

function switchIn(panel: string): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>(`${panel} input[role="switch"]`);
  if (found === null) throw new Error(`no switch in ${panel}`);
  return found;
}

describe('Settings — music, effects and cues, heard from the graph — #2056', () => {
  it('music: on by default, its volume at 0 sets the music bus to 0', async () => {
    const { fake } = await settings(disk());
    const { music } = musicPath(fake);
    expect(music.gain.value).toBe(0.5);
    expect(switchIn('.oyl-music').checked).toBe(true);
    expect(document.querySelector('label[for="oyl-music-volume"]')?.textContent).toBe(
      'Music volume',
    );

    await slide(slider('oyl-music-volume'), 0);
    expect(music.gain.value).toBe(0);
    await slide(slider('oyl-music-volume'), 70);
    expect(music.gain.value).toBe(0.7);
  });

  it('music: its switch is the music bus’s mute, and keeps the volume', async () => {
    const store = disk();
    writeAudioBus(store, 'music', { volume: 0.3, muted: false });
    const { fake } = await settings(store);
    const { music } = musicPath(fake);
    expect(music.gain.value).toBe(0.3);

    await act(async () => {
      switchIn('.oyl-music').click();
      await Promise.resolve();
    });
    expect(music.gain.value).toBe(0);
    expect(slider('oyl-music-volume').value).toBe('30');

    // Read back as the next start reads it: a graph rebuilt over the same storage.
    mounted?.unmount();
    mounted = undefined;
    const again = await settings(store);
    expect(musicPath(again.fake).music.gain.value).toBe(0);
    expect(switchIn('.oyl-music').checked).toBe(false);
  });

  it('effects: the menus’ volume reaches the effects bus at once', async () => {
    const store = disk();
    writeMenuSoundPreference(store, { enabled: true, volume: 0.5 });
    const { fake, output } = await settings(store);
    const effects = busOf(fake, output, 'select');
    expect(effects.gain.value).toBe(0.5);

    await slide(slider('oyl-menu-sounds-volume'), 20);
    expect(effects.gain.value).toBe(0.2);
    await act(async () => {
      switchIn('.oyl-menu-sounds').click();
      await Promise.resolve();
    });
    expect(effects.gain.value).toBe(0);
  });

  it('cues: the ride’s volume reaches the cue bus at once', async () => {
    const store = disk();
    writeCuePreference(store, { enabled: true, volume: 0.5, muted: false });
    const { fake, output } = await settings(store);
    const cues = busOf(fake, output, 'interval');
    expect(cues.gain.value).toBe(0.5);

    await slide(slider('oyl-sounds-volume'), 0);
    expect(cues.gain.value).toBe(0);
    await slide(slider('oyl-sounds-volume'), 80);
    expect(cues.gain.value).toBe(0.8);
    await act(async () => {
      switchIn('.oyl-sounds').click();
      await Promise.resolve();
    });
    expect(cues.gain.value).toBe(0);
  });
});
