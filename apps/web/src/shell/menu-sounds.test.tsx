// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The menus' sounds — #946, through the real shell where the rule is about
 * the shell, and against a fake audio context where it is about the sound.
 *
 * ⚠️ None of this hears anything. How the sounds actually sound — soft, short,
 * not annoying — is `docs/validation/0003-screen-reader-and-assistive-technology.md`
 * Part I, with headphones, and its table is empty.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { RIDE_CUE_LEVEL, RideCues } from '../game/audio-cues';
import { recordingOutput, type RecordingOutput } from '../game/audio-testing';
import { CUES_STORAGE_KEY, readCuePreference, writeCuePreference } from '../game/cue-preference';
import type { PreferenceStorage } from '../game/hud/announce-preference';
import { webAudioOutput, type AudioContextLike } from '../game/web-audio';
import { ridingSnapshot, stubRideController } from '../ride/testing';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';
import { SettingsView } from '../views/SettingsView';

import { AppShell } from './AppShell';
import {
  DEFAULT_MENU_SOUNDS,
  MENU_SOUNDS_STORAGE_KEY,
  readMenuSoundPreference,
  writeMenuSoundPreference,
} from './menu-sound-preference';
import { createMenuSounds, MENU_CUE_LEVEL, menuCueFor, type PressContext } from './menu-sounds';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

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

function soundsOn(volume = 0.5): PreferenceStorage {
  const { store } = disk();
  writeMenuSoundPreference(store, { enabled: true, volume });
  return store;
}

/** Every control a press can land on, in the shell as it is now. */
function everyControl(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a[href], button')];
}

/** A click that reaches every handler and then navigates nowhere. */
function pressWithoutLeaving(element: HTMLElement): void {
  const stay = (event: Event): void => {
    event.preventDefault();
  };
  window.addEventListener('click', stay, { capture: true });
  try {
    element.click();
  } finally {
    window.removeEventListener('click', stay, { capture: true });
  }
}

let mounted: Mounted | undefined;

beforeEach(() => {
  window.location.hash = '#/';
  // jsdom lays nothing out and has no `scrollIntoView`; the skip link calls it.
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  window.location.hash = '';
});

describe('which sound a press answers with', () => {
  it('selects on a link, confirms a submit or a primary, and goes back where told', () => {
    document.body.innerHTML = `
      <a href="#/x" id="link"><span id="inside">Rides</span></a>
      <form><button type="submit" id="submit">Save</button></form>
      <button id="formless">Open</button>
      <button type="button" class="oyl-button--primary" id="primary">Go</button>
      <button type="button" id="plain">Open</button>
      <a href="#/" data-oyl-sound="back" id="back">All rides</a>
      <button type="button" disabled id="off">No</button>
      <button type="button" aria-disabled="true" id="refused">No</button>
      <p id="prose">Words</p>`;
    const at = (id: string): Element | null => document.getElementById(id);
    expect(menuCueFor(at('inside'))).toBe('select');
    expect(menuCueFor(at('plain'))).toBe('select');
    expect(menuCueFor(at('submit'))).toBe('confirm');
    expect(menuCueFor(at('formless'))).toBe('select');
    expect(menuCueFor(at('primary'))).toBe('confirm');
    expect(menuCueFor(at('back'))).toBe('back');
    expect(menuCueFor(at('off'))).toBeUndefined();
    expect(menuCueFor(at('refused'))).toBeUndefined();
    expect(menuCueFor(at('prose'))).toBeUndefined();
    expect(menuCueFor(null)).toBeUndefined();
    document.body.innerHTML = '';
  });
});

describe('the menus’ sounds — #946', () => {
  it('are off by default: no press on Home makes an audio context at all', async () => {
    let made = 0;
    const output = webAudioOutput(() => {
      made += 1;
      return fakeContext().context;
    });
    const { store } = disk();
    expect(readMenuSoundPreference(store)).toEqual(DEFAULT_MENU_SOUNDS);
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        rideController={stubRideController().controller}
        menuSounds={createMenuSounds(output, () => readMenuSoundPreference(store))}
      />,
    );
    const controls = everyControl(mounted.container);
    // Every card and every destination: Home's ride cards and the navigation.
    expect(controls.length).toBeGreaterThan(8);
    expect(mounted.container.querySelectorAll('.oyl-ride-card a').length).toBeGreaterThan(0);
    for (const control of controls) pressWithoutLeaving(control);
    expect(made).toBe(0);
  });

  it('play only after a press: focus, hover and a hash changed by hand are silent', async () => {
    const output = recordingOutput();
    const storage = soundsOn();
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        rideController={stubRideController().controller}
        menuSounds={createMenuSounds(output, () => readMenuSoundPreference(storage))}
      />,
    );
    const link = mounted.container.querySelector<HTMLAnchorElement>('nav a[href]');
    if (link === null) throw new Error('no navigation link');
    link.focus();
    for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'focusin']) {
      link.dispatchEvent(new Event(type, { bubbles: true }));
    }
    window.location.hash = '#/settings';
    await settle();
    window.location.hash = '#/';
    await settle();
    expect(output.count('playCue')).toBe(0);
    expect(output.count('resume')).toBe(0);

    const again = mounted.container.querySelector<HTMLAnchorElement>('nav a[href]');
    if (again === null) throw new Error('no navigation link');
    pressWithoutLeaving(again);
    expect(output.count('playCue')).toBe(1);
    expect(output.calls.at(-1)).toEqual({
      kind: 'playCue',
      cue: 'select',
      gain: MENU_CUE_LEVEL * 0.5,
    });
  });

  it('are silent while a ride is recording, and while it is paused', async () => {
    for (const phase of ['recording', 'paused'] as const) {
      const output = recordingOutput();
      const storage = soundsOn();
      const controller = stubRideController({ ...ridingSnapshot(), phase }).controller;
      mounted = await mount(
        <AppShell
          capabilities={NO_BLUETOOTH}
          rideController={controller}
          menuSounds={createMenuSounds(output, () => readMenuSoundPreference(storage))}
        />,
      );
      const link = mounted.container.querySelector<HTMLAnchorElement>('nav a[href]');
      if (link === null) throw new Error('no navigation link');
      pressWithoutLeaving(link);
      expect(output.count('playCue'), phase).toBe(0);
      expect(output.count('resume'), phase).toBe(0);
      mounted.unmount();
      mounted = undefined;
    }
  });

  it('are silent while a ride has the screen, and on the two ride routes', () => {
    const output = recordingOutput();
    const sounds = createMenuSounds(output, () => ({ enabled: true, volume: 1 }));
    const button = document.createElement('button');
    const menu: PressContext = { immersive: false, routeId: 'home', ridePhase: 'idle' };
    sounds.press(button, { ...menu, immersive: true });
    sounds.press(button, { ...menu, routeId: 'ride' });
    sounds.press(button, { ...menu, routeId: 'game' });
    expect(output.count('playCue')).toBe(0);
    // The control: the same press on a menu route plays.
    sounds.press(button, menu);
    expect(output.count('playCue')).toBe(1);
  });

  it('are separate from the ride’s sounds: each switch and each volume is its own', () => {
    const { store, values } = disk();
    writeMenuSoundPreference(store, { enabled: true, volume: 0.3 });
    // Turning menu sounds on turned no ride sound on, and wrote nothing of its.
    expect(values.has(CUES_STORAGE_KEY)).toBe(false);
    expect(readCuePreference(store).enabled).toBe(false);

    writeCuePreference(store, { enabled: true, volume: 0.8, muted: false });
    expect(readMenuSoundPreference(store)).toEqual({ enabled: true, volume: 0.3 });
    writeMenuSoundPreference(store, { enabled: false, volume: 0.3 });
    // Turning menu sounds OFF turned the ride's sounds off neither.
    expect(readCuePreference(store)).toEqual({ enabled: true, volume: 0.8, muted: false });
    expect(values.has(MENU_SOUNDS_STORAGE_KEY)).toBe(true);

    // And the gains: each is set by its own volume and nothing else.
    const output: RecordingOutput = recordingOutput();
    const ride = new RideCues(output, readCuePreference(store));
    ride.begin();
    ride.cue('interval');
    writeMenuSoundPreference(store, { enabled: true, volume: 0.3 });
    createMenuSounds(output, () => readMenuSoundPreference(store)).press(
      document.createElement('button'),
      { immersive: false, routeId: 'home', ridePhase: 'idle' },
    );
    ride.cue('interval');
    const gains = output.calls.flatMap((call) =>
      call.kind === 'playCue' ? [{ cue: call.cue, gain: call.gain }] : [],
    );
    expect(gains).toEqual([
      { cue: 'interval', gain: RIDE_CUE_LEVEL * 0.8 },
      { cue: 'select', gain: MENU_CUE_LEVEL * 0.3 },
      { cue: 'interval', gain: RIDE_CUE_LEVEL * 0.8 },
    ]);
  });

  it('are short and soft: ≤ 150 ms, an attack of at least 5 ms, under the ride’s peak', () => {
    const fake = fakeContext();
    const output = webAudioOutput(() => fake.context);
    output.resume();
    for (const cue of ['select', 'confirm', 'back'] as const) {
      fake.events.length = 0;
      output.playCue(cue, MENU_CUE_LEVEL);
      const notes = envelopes(fake.events);
      expect(notes.length, cue).toBeGreaterThan(0);
      const start = Math.min(...notes.map((note) => note.start));
      const end = Math.max(...notes.map((note) => note.end));
      expect(end - start, cue).toBeLessThanOrEqual(0.15);
      for (const note of notes) {
        expect(note.attack, cue).toBeGreaterThanOrEqual(0.005);
        expect(note.peak, cue).toBeLessThanOrEqual(RIDE_CUE_LEVEL);
      }
    }
    // At full volume the menus' peak is under the ride's at full volume.
    expect(MENU_CUE_LEVEL).toBeLessThan(RIDE_CUE_LEVEL);
  });
});

describe('Settings — the menus’ own switch and volume', () => {
  it('is off, and turning it on writes the menus’ key and not the ride’s', async () => {
    const { store, values } = disk();
    mounted = await mount(
      <SettingsView
        units="metric"
        onUnitsChange={() => undefined}
        onRiderMassChange={() => undefined}
        announcements={store}
      />,
    );
    const toggle = mounted.container.querySelector<HTMLInputElement>(
      '.oyl-menu-sounds input[role="switch"]',
    );
    expect(toggle?.checked).toBe(false);
    expect(toggle?.closest('label')?.textContent).toContain('Play sounds in the menus');
    // No volume for sounds that cannot play: it arrives with the switch.
    expect(mounted.container.querySelector('#oyl-menu-sounds-volume')).toBeNull();
    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });
    expect(readMenuSoundPreference(store).enabled).toBe(true);
    expect(
      mounted.container.querySelector('label[for="oyl-menu-sounds-volume"]')?.textContent,
    ).toBe('Menu sound volume');
    expect(
      mounted.container.querySelector<HTMLInputElement>('#oyl-menu-sounds-volume')?.value,
    ).toBe('50');
    expect(values.has(CUES_STORAGE_KEY)).toBe(false);
  });
});

// --- a fake context that records each note's envelope ----------------------

interface GainEvent {
  readonly note: number;
  readonly kind: 'set' | 'ramp';
  readonly value: number;
  readonly at: number;
}

function fakeContext(): {
  readonly context: AudioContextLike;
  readonly events: GainEvent[];
} {
  const events: GainEvent[] = [];
  let notes = 0;
  const context = {
    currentTime: 0,
    destination: {},
    state: 'running',
    resume: () => Promise.resolve(),
    suspend: () => Promise.resolve(),
    createOscillator: () => ({
      type: '',
      frequency: { value: 0, setTargetAtTime: () => undefined },
      connect: (to: unknown) => to,
      start: () => undefined,
      stop: () => undefined,
    }),
    createGain: () => {
      const note = notes;
      notes += 1;
      return {
        gain: {
          value: 0,
          setValueAtTime: (value: number, at: number) => {
            events.push({ note, kind: 'set', value, at });
          },
          setTargetAtTime: () => undefined,
          linearRampToValueAtTime: (value: number, at: number) => {
            events.push({ note, kind: 'ramp', value, at });
          },
        },
        connect: (to: unknown) => to,
      };
    },
  };
  return { context: context as unknown as AudioContextLike, events };
}

/** Each note's start, end, attack and peak, from the gain automation it scheduled. */
function envelopes(
  events: readonly GainEvent[],
): { start: number; end: number; attack: number; peak: number }[] {
  const byNote = new Map<number, GainEvent[]>();
  for (const event of events) byNote.set(event.note, [...(byNote.get(event.note) ?? []), event]);
  return [...byNote.values()].map((note) => {
    const start = Math.min(...note.map((event) => event.at));
    const end = Math.max(...note.map((event) => event.at));
    const peak = Math.max(...note.map((event) => event.value));
    const reached = note.find((event) => event.kind === 'ramp' && event.value === peak);
    return { start, end, attack: (reached?.at ?? start) - start, peak };
  });
}
