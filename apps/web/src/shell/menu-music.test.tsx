// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The menus' music — #2058, through the real `AppShell` and the real
 * `game/web-audio.ts` graph over `audio-testing.ts`'s fake context.
 *
 * ⚠️ Every level is read from the GRAPH — the music bus the element's source
 * is connected to — and every "playing" from the ELEMENT the page made, never
 * from `menu-music.ts`'s own flags. A player that only set a flag when it
 * left for a ride would pass any test that read the flag back.
 *
 * jsdom has no media playback: the element is a double that records `play`
 * and `pause` as a real one changes `paused`. That it SOUNDS is
 * `browser/shell.browser.spec.ts` §"#2058", in Chromium.
 */

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeAudioBus, writeMasterMuted, readMusicAndMaster } from '../game/audio-mix';
import { fakeAudioContext, musicPath, type FakeAudio } from '../game/audio-testing';
import type { CueOutput } from '../game/audio-port';
import type { PreferenceStorage } from '../game/hud/announce-preference';
import { deviceAudioMix, webAudioOutput } from '../game/web-audio';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { AppShell } from './AppShell';
import { HEADER_MUTE_NAME } from './HeaderMute';
import { createMenuMusic, type MenuMusic } from './menu-music';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

/** The loop, as #2057 will serve it: a URL on this origin, never an import. */
const TRACK = '/audio/menu-loop.test.ogg';

function disk(): PreferenceStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

/** An `<audio>` element as far as the player uses one. */
interface FakeElement {
  loop: boolean;
  preload: string;
  src: string;
  paused: boolean;
  plays: number;
}

interface Rig {
  readonly fake: FakeAudio;
  readonly output: CueOutput;
  readonly music: MenuMusic;
  readonly made: FakeElement[];
  /** End every fade that is waiting, as the timer would. */
  readonly endFades: () => void;
  hidden: boolean;
}

function rig(
  store: PreferenceStorage,
  { track }: { track: string | undefined } = { track: TRACK },
): Rig {
  const fake = fakeAudioContext();
  const output = webAudioOutput(
    () => fake.context,
    deviceAudioMix(() => store),
  );
  const made: FakeElement[] = [];
  const waiting = new Set<() => void>();
  const built: Rig = {
    fake,
    output,
    made,
    hidden: false,
    endFades: () => {
      for (const callback of [...waiting]) {
        waiting.delete(callback);
        callback();
      }
    },
    music: createMenuMusic({
      output,
      track,
      mix: () => readMusicAndMaster(store),
      createElement: () => {
        const element: FakeElement & {
          play: () => Promise<void>;
          pause: () => void;
        } = {
          loop: false,
          preload: 'auto',
          src: '',
          paused: true,
          plays: 0,
          play: () => {
            element.paused = false;
            element.plays += 1;
            return Promise.resolve();
          },
          pause: () => {
            element.paused = true;
          },
        };
        made.push(element);
        return element as unknown as HTMLMediaElement;
      },
      schedule: (callback) => {
        waiting.add(callback);
        return () => {
          waiting.delete(callback);
        };
      },
      hidden: () => built.hidden,
    }),
  };
  return built;
}

let mounted: Mounted | undefined;

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/';
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  window.location.hash = '';
});

async function shell(
  music: Rig,
  rideController?: ReturnType<typeof stubRideController>['controller'],
): Promise<void> {
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      menuMusic={music.music}
      soundOutput={music.output}
      {...(rideController === undefined ? {} : { rideController })}
    />,
  );
  await settle();
}

/** A click that reaches every handler and then navigates nowhere. */
async function pressWithoutLeaving(element: Element | null): Promise<void> {
  if (!(element instanceof HTMLElement)) throw new Error('nothing to press');
  const stay = (event: Event): void => {
    event.preventDefault();
  };
  window.addEventListener('click', stay, { capture: true });
  try {
    await act(async () => {
      element.click();
      await Promise.resolve();
    });
  } finally {
    window.removeEventListener('click', stay, { capture: true });
  }
}

/** A control on Home that is not the header's mute. */
function homeControl(): Element | null {
  return document.querySelector('main a[href], main button');
}

function headerMute(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('header button')].find(
    (button) => button.textContent?.trim() === HEADER_MUTE_NAME,
  );
}

async function go(hash: string): Promise<void> {
  await act(async () => {
    window.location.hash = hash;
    await Promise.resolve();
  });
  await settle();
}

/** The music bus — the gain the element's source is connected to — read from the graph. */
function musicBus(music: Rig): number {
  const source = music.fake.media[0];
  const { music: bus } = musicPath(music.fake);
  expect(source?.outputs, 'the element is not routed into the music bus').toEqual([bus]);
  return bus.gain.value;
}

describe('the menus’ music starts at the first press, never at load — #2058', () => {
  it('nothing plays before a press; a press on Home starts the loop at the default level', async () => {
    const music = rig(disk());
    await shell(music);
    expect(music.made, 'an element was made before any press').toEqual([]);
    expect(music.fake.gains, 'a graph was built before any press').toEqual([]);

    await pressWithoutLeaving(homeControl());
    expect(music.made).toHaveLength(1);
    const [element] = music.made;
    expect(element?.paused).toBe(false);
    // Fetched on first play, and only then: the source is set at the press, and
    // nothing is fetched before the element is asked to play.
    expect(element).toMatchObject({ loop: true, preload: 'none', src: TRACK });
    expect(musicBus(music)).toBe(0.5);
  });

  it('a first press on the header’s mute starts nothing', async () => {
    const store = disk();
    const music = rig(store);
    await shell(music);
    await pressWithoutLeaving(headerMute() ?? null);
    expect(music.made).toEqual([]);
    // Pressed again to unmute: still the mute, still nothing.
    await pressWithoutLeaving(headerMute() ?? null);
    expect(music.made).toEqual([]);
    // A press anywhere else starts it.
    await pressWithoutLeaving(homeControl());
    expect(music.made[0]?.paused).toBe(false);
  });

  it('with music muted, or under the master mute, a press starts nothing', async () => {
    const muted = disk();
    writeAudioBus(muted, 'music', { volume: 0.5, muted: true });
    const first = rig(muted);
    await shell(first);
    await pressWithoutLeaving(homeControl());
    expect(first.made).toEqual([]);
    mounted?.unmount();

    const silent = disk();
    writeAudioBus(silent, 'music', { volume: 0, muted: false });
    const second = rig(silent);
    await shell(second);
    await pressWithoutLeaving(homeControl());
    expect(second.made).toEqual([]);
    mounted?.unmount();

    const master = disk();
    writeMasterMuted(master, true);
    const third = rig(master);
    await shell(third);
    await pressWithoutLeaving(homeControl());
    expect(third.made).toEqual([]);
  });

  it('with no loop committed yet (#2057), nothing at all happens', async () => {
    const music = rig(disk(), { track: undefined });
    await shell(music);
    await pressWithoutLeaving(homeControl());
    expect(music.made).toEqual([]);
    expect(music.fake.gains).toEqual([]);
  });
});

describe('the menus’ music is never heard on a ride — #2058', () => {
  it('pauses with its bus at 0 on the Ride screen and the game, and comes back on a menu', async () => {
    const music = rig(disk());
    await shell(music);
    await pressWithoutLeaving(homeControl());
    const [element] = music.made;

    for (const ride of ['#/ride', '#/game']) {
      await go(ride);
      // The fade first — a ramp on the bus — and the pause once it is over.
      expect(musicBus(music), ride).toBe(0);
      music.endFades();
      expect(element?.paused, ride).toBe(true);

      await go('#/');
      expect(element?.paused, `back on Home from ${ride}`).toBe(false);
      expect(musicBus(music)).toBe(0.5);
    }
    // One element and one source for the whole visit.
    expect(music.made).toHaveLength(1);
    expect(music.fake.media).toHaveLength(1);
  });

  it('pauses while a ride is recording, on a menu route too', async () => {
    const stub = stubRideController(idleSnapshot());
    const music = rig(disk());
    await shell(music, stub.controller);
    await pressWithoutLeaving(homeControl());
    const [element] = music.made;
    expect(element?.paused).toBe(false);

    await act(async () => {
      stub.set({ phase: ridingSnapshot().phase });
      await Promise.resolve();
    });
    expect(musicBus(music)).toBe(0);
    music.endFades();
    expect(element?.paused).toBe(true);

    await act(async () => {
      stub.set({ phase: 'idle' });
      await Promise.resolve();
    });
    expect(element?.paused).toBe(false);
  });

  it('a press on a ride route starts nothing', async () => {
    const music = rig(disk());
    window.location.hash = '#/ride';
    await shell(music);
    await pressWithoutLeaving(document.querySelector('main button, main a[href]'));
    expect(music.made).toEqual([]);
  });

  it('a rider back on a menu before the fade ends hears it carry on, and it is not paused late', async () => {
    const music = rig(disk());
    await shell(music);
    await pressWithoutLeaving(homeControl());
    const [element] = music.made;
    await go('#/ride');
    await go('#/');
    music.endFades();
    expect(element?.paused).toBe(false);
    expect(musicBus(music)).toBe(0.5);
  });
});

describe('the menus’ music and the page’s visibility — #2058', () => {
  it('pauses when the page is hidden, and resumes when it is shown on a menu route', async () => {
    const music = rig(disk());
    await shell(music);
    await pressWithoutLeaving(homeControl());
    const [element] = music.made;

    music.hidden = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    // At once: nobody hears a fade on a screen that is off.
    expect(element?.paused).toBe(true);

    music.hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    expect(element?.paused).toBe(false);
    expect(musicBus(music)).toBe(0.5);
  });

  it('shown again on a ride route, it stays paused', async () => {
    const music = rig(disk());
    await shell(music);
    await pressWithoutLeaving(homeControl());
    const [element] = music.made;
    music.hidden = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    await go('#/ride');
    music.hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();
    });
    music.endFades();
    expect(element?.paused).toBe(true);
  });
});

describe('the rider’s mix while the loop plays — #2058', () => {
  it('the header’s mute pauses it, and a second press brings it back', async () => {
    // This device's own storage: the header's mute writes there, as in the app.
    const music = rig(localStorage);
    await shell(music);
    await pressWithoutLeaving(homeControl());
    const [element] = music.made;
    await pressWithoutLeaving(headerMute() ?? null);
    expect(element?.paused).toBe(true);
    expect(musicPath(music.fake).master.gain.value).toBe(0);
    await pressWithoutLeaving(headerMute() ?? null);
    expect(element?.paused).toBe(false);
    expect(musicPath(music.fake).master.gain.value).toBe(1);
  });
});
