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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeAudioBus, writeMasterMuted, readMusicAndMaster } from '../game/audio-mix';
import { fakeAudioContext, musicPath, type FakeAudio } from '../game/audio-testing';
import type { CueOutput } from '../game/audio-port';
import type { PreferenceStorage } from '../game/hud/announce-preference';
import {
  deviceAudioMix,
  MUSIC_DUCK_BACK_SECONDS,
  MUSIC_DUCK_DOWN_SECONDS,
  MUSIC_DUCK_LEVEL,
  MUSIC_FADE_MS,
  MUSIC_FADE_SECONDS,
  webAudioOutput,
} from '../game/web-audio';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { AppShell } from './AppShell';
import { HEADER_MUTE_NAME } from './HeaderMute';
import {
  createMenuMusic,
  OWN_LOOP_SETTLE_MS,
  type MenuMusic,
  type RiderPlayer,
} from './menu-music';
import { readMenuSoundPreference, writeMenuSoundPreference } from './menu-sound-preference';
import { createMenuSounds, type MenuSounds } from './menu-sounds';
import { OtherPlayer } from './other-player';
import { PAUSE_MUSIC_NAME } from './OtherPlayerControls';

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
  /**
   * Whether the header's *Mute all sound* was on the page, and could be
   * pressed, when the element first played: WCAG 1.4.2 for a loop that starts
   * by itself (#2357).
   */
  muteOnPageAtFirstPlay: boolean | undefined;
}

interface Rig {
  readonly fake: FakeAudio;
  readonly output: CueOutput;
  readonly music: MenuMusic;
  readonly made: FakeElement[];
  /** End every fade that is waiting, as the timer would. */
  readonly endFades: () => void;
  /** End every wait before the rider's player is asked again (#2253), as the timer would. */
  readonly endSettle: () => void;
  hidden: boolean;
}

function rig(
  store: PreferenceStorage,
  {
    track,
    riderPlayer,
    autoplay,
  }: {
    track: string | undefined;
    riderPlayer?: RiderPlayer | undefined;
    autoplay?: Promise<boolean> | undefined;
  } = {
    track: TRACK,
  },
): Rig {
  const fake = fakeAudioContext();
  const output = webAudioOutput(
    () => fake.context,
    deviceAudioMix(() => store),
  );
  const made: FakeElement[] = [];
  /** Each timer waiting, with the time it was set for. */
  const waiting = new Map<() => void, number>();
  const run = (ms: number): void => {
    for (const [callback, after] of [...waiting]) {
      if (after !== ms) continue;
      waiting.delete(callback);
      callback();
    }
  };
  const built: Rig = {
    fake,
    output,
    made,
    hidden: false,
    endFades: () => {
      run(MUSIC_FADE_MS);
    },
    endSettle: () => {
      run(OWN_LOOP_SETTLE_MS);
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
          muteOnPageAtFirstPlay: undefined,
          play: () => {
            element.muteOnPageAtFirstPlay ??= headerMute()?.disabled === false;
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
      schedule: (callback, ms) => {
        waiting.set(callback, ms);
        return () => {
          waiting.delete(callback);
        };
      },
      hidden: () => built.hidden,
      riderPlayer,
      autoplay,
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
  menuSounds?: MenuSounds,
): Promise<void> {
  mounted = await mount(
    <AppShell
      capabilities={NO_BLUETOOTH}
      menuMusic={music.music}
      soundOutput={music.output}
      {...(rideController === undefined ? {} : { rideController })}
      {...(menuSounds === undefined ? {} : { menuSounds })}
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

/**
 * These cases open the Ride screen and the game, whose views are lazy chunks
 * jsdom loads and transforms on first use: 0.7 s alone, and past the 5 s
 * default on a loaded machine, where a case that timed out left its hash
 * change to the next one. A stop on a hung load, not a budget — the
 * `DemoPage.test.tsx` §`RIDE_TIMEOUT_MS` reasoning; the assertions are unchanged.
 */
const RIDE_VIEWS_TIMEOUT_MS = 15_000;

describe(
  'the menus’ music is never heard on a ride — #2058',
  { timeout: RIDE_VIEWS_TIMEOUT_MS },
  () => {
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
  },
);

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

  it('a mute the device refused to keep leaves it playing, and the button unpressed — #2240', async () => {
    const music = rig(localStorage);
    await shell(music);
    await pressWithoutLeaving(homeControl());
    const [element] = music.made;
    expect(element?.paused).toBe(false);

    // The device refuses every write from here on (a full quota, a private
    // window), so the master stays unmuted where the music reads it.
    const refuse = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      await pressWithoutLeaving(headerMute() ?? null);
      expect(refuse, 'the mute never tried to keep its choice').toHaveBeenCalled();
      expect(headerMute()?.getAttribute('aria-pressed')).toBe('false');
      expect(element?.paused, 'paused under a mute that was never kept').toBe(false);
      expect(musicPath(music.fake).master.gain.value).toBe(1);
      expect(musicBus(music)).toBe(0.5);
    } finally {
      refuse.mockRestore();
    }
  });
});

describe(
  'the music under the menus’ effects, and out when a ride route opens — #2059',
  { timeout: RIDE_VIEWS_TIMEOUT_MS },
  () => {
    it('a menu effect while the music plays ducks it, by ramps, and brings it back after', async () => {
      const store = disk();
      writeMenuSoundPreference(store, { enabled: true, volume: 0.5 });
      const music = rig(store);
      await shell(
        music,
        undefined,
        createMenuSounds(music.output, () => readMenuSoundPreference(store)),
      );
      // The first press starts the music; its own sound was before the music.
      await pressWithoutLeaving(homeControl());
      const { duck } = musicPath(music.fake);
      expect(duck.automation.filter((event) => event.method !== 'value')).toEqual([]);

      (music.fake.context as { currentTime: number }).currentTime = 4;
      await pressWithoutLeaving(homeControl());
      // A press on a link selects (one note, 60 ms); a button may confirm (130 ms).
      const plan = duck.automation.filter((event) => event.method !== 'value');
      expect(plan).toHaveLength(2);
      expect(plan[0]).toEqual({
        method: 'setTargetAtTime',
        value: MUSIC_DUCK_LEVEL,
        at: 4,
        constant: MUSIC_DUCK_DOWN_SECONDS,
      });
      expect(plan[1]).toMatchObject({
        method: 'setTargetAtTime',
        value: 1,
        constant: MUSIC_DUCK_BACK_SECONDS,
      });
      expect(plan[1] !== undefined && 'at' in plan[1] ? plan[1].at : 0).toBeGreaterThan(4);
    });

    it('opening a ride route schedules a ramp of the music bus to 0, and no step change', async () => {
      const music = rig(disk());
      await shell(music);
      await pressWithoutLeaving(homeControl());
      const bus = musicPath(music.fake).music;
      const before = bus.automation.length;
      (music.fake.context as { currentTime: number }).currentTime = 7;

      await go('#/ride');
      const after = bus.automation.slice(before);
      expect(after).toEqual([
        { method: 'setTargetAtTime', value: 0, at: 7, constant: MUSIC_FADE_SECONDS },
      ]);
      // Nothing on the bus since the music started has been a step.
      expect(
        bus.automation.filter((event) => event.method === 'setValueAtTime'),
        'a set value is a cut',
      ).toEqual([]);
      expect(
        bus.automation.filter((event) => event.method === 'value'),
        'only the level the bus was made at',
      ).toHaveLength(1);
    });
  },
);

/**
 * The phone as #2073's header sees it — owner ruling 3 of 2026-11-05, #2253.
 * Android's `isMusicActive()` is true while the rider's own player plays OR
 * our loop does (spike 0034 §1.3), and the header keeps its latest reading
 * (`OtherPlayer.riderPlayerInUse`, #2242). A reading is taken only when a
 * case calls {@link Phone.read}, as the header's 4 s poll would — and never on
 * a ride route or behind a hidden page, where it does not poll.
 */
interface Phone {
  /** The rider's own player is playing, in another app. */
  riderPlaying: boolean;
  /** The header's latest reading. */
  readonly reading: boolean;
  /** One reading, of everything playing: theirs, and ours. */
  read(): void;
  readonly player: RiderPlayer;
}

function phone(): Phone & { hear(made: readonly FakeElement[]): void } {
  let ours: readonly FakeElement[] = [];
  let reading = false;
  const built = {
    riderPlaying: false,
    get reading() {
      return reading;
    },
    read() {
      reading = built.riderPlaying || ours.some((element) => !element.paused);
    },
    player: { riderPlayerInUse: () => reading },
    hear(made: readonly FakeElement[]) {
      ours = made;
    },
  };
  return built;
}

/** A rig whose music asks `device` about the rider's player. */
function rigWith(device: ReturnType<typeof phone>, store: PreferenceStorage = disk()): Rig {
  const music = rig(store, { track: TRACK, riderPlayer: device.player });
  device.hear(music.made);
  return music;
}

async function setHidden(music: Rig, hidden: boolean): Promise<void> {
  music.hidden = hidden;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
  });
}

describe('the menus’ music yields to the rider’s own player — #2253', () => {
  it('a press while the rider’s player plays starts nothing; a press once it stops starts the loop', async () => {
    const device = phone();
    const music = rigWith(device);
    device.riderPlaying = true;
    device.read();
    await shell(music);

    await pressWithoutLeaving(homeControl());
    expect(music.made, 'the loop started over the rider’s own player').toEqual([]);
    expect(music.fake.gains, 'a graph was built for a loop that yielded').toEqual([]);

    device.riderPlaying = false;
    device.read();
    await pressWithoutLeaving(homeControl());
    expect(music.made[0]?.paused).toBe(false);
    expect(musicBus(music)).toBe(0.5);
  });

  it('the rider starts their player in their own app: our loop pauses, and shown again it stays silent', async () => {
    const device = phone();
    const music = rigWith(device);
    device.read();
    await shell(music);
    await pressWithoutLeaving(homeControl());
    const [element] = music.made;
    expect(element?.paused).toBe(false);

    // The rider leaves for their player and starts it. Nothing is read while
    // the page is hidden: the header's last reading is from before our loop.
    await setHidden(music, true);
    expect(element?.paused).toBe(true);
    device.riderPlaying = true;
    await setHidden(music, false);
    expect(element?.paused, 'came back over the rider’s player on a stale reading').toBe(true);

    device.read();
    music.endSettle();
    expect(element?.paused, 'played over the rider’s own player').toBe(true);

    // Their player stops, and the next press brings ours back.
    device.riderPlaying = false;
    device.read();
    await pressWithoutLeaving(homeControl());
    expect(element?.paused).toBe(false);
    expect(musicBus(music)).toBe(0.5);
  });
});

describe(
  'the menus’ own loop never counts as the rider’s player — #2253',
  { timeout: RIDE_VIEWS_TIMEOUT_MS },
  () => {
    it('a reading while our loop plays is ours: the loop carries on across presses and menu routes', async () => {
      const device = phone();
      const music = rigWith(device);
      await shell(music);
      await pressWithoutLeaving(homeControl());
      device.read();
      // The model is faithful: Android reads our own loop as music playing.
      expect(device.reading).toBe(true);

      await pressWithoutLeaving(homeControl());
      await go('#/settings');
      await pressWithoutLeaving(document.querySelector('main button, main a[href]'));
      expect(music.made).toHaveLength(1);
      expect(music.made[0]?.paused, 'our loop stopped for itself').toBe(false);
      expect(musicBus(music)).toBe(0.5);
    });

    it('after a ride, a reading of our loop from before it is not the rider’s: the loop comes back once the header has read again', async () => {
      const device = phone();
      const music = rigWith(device);
      await shell(music);
      await pressWithoutLeaving(homeControl());
      const [element] = music.made;
      device.read();

      await go('#/ride');
      music.endFades();
      // A long ride: every wait set on the ride screen is long over.
      music.endSettle();
      expect(element?.paused).toBe(true);

      await go('#/');
      expect(element?.paused, 'came back before the header could read again').toBe(true);
      device.read();
      expect(device.reading).toBe(false);
      music.endSettle();
      expect(element?.paused, 'our own loop was read as the rider’s player').toBe(false);
      expect(musicBus(music)).toBe(0.5);
    });

    it('unmuted soon after it was muted, the loop waits for a reading that cannot be its own', async () => {
      const device = phone();
      const music = rigWith(device, localStorage);
      await shell(music);
      await pressWithoutLeaving(homeControl());
      const [element] = music.made;
      device.read();

      await pressWithoutLeaving(headerMute() ?? null);
      expect(element?.paused).toBe(true);
      await pressWithoutLeaving(headerMute() ?? null);
      expect(element?.paused, 'asked while the answer was still our own loop').toBe(true);

      device.read();
      music.endSettle();
      expect(element?.paused).toBe(false);
      expect(musicPath(music.fake).master.gain.value).toBe(1);
    });

    it('back on a menu before the fade ends, the loop carries on at once: it never fell silent', async () => {
      const device = phone();
      const music = rigWith(device);
      await shell(music);
      await pressWithoutLeaving(homeControl());
      const [element] = music.made;
      device.read();

      await go('#/ride');
      await go('#/');
      expect(element?.paused).toBe(false);
      music.endFades();
      expect(element?.paused).toBe(false);
      expect(musicBus(music)).toBe(0.5);
    });
  },
);

/**
 * #2073 meets #2253: `main.tsx` hands the Android shell's one `OtherPlayer`
 * to the header (`otherPlayer`) and to the menus' music (`riderPlayer`). Here
 * the same composition, with the real `OtherPlayer` over a port that answers
 * as `OtherPlayerPlugin.java` would: what the header's own poll heard is what
 * the loop yields to.
 */
describe('the header’s OtherPlayer is the player the menus’ music yields to — #2073, #2253', () => {
  it('reported in use, a press starts nothing; once it reads silent, a press starts the loop', async () => {
    let active = true;
    const player = new OtherPlayer(
      {
        sendKey: () => Promise.resolve(),
        otherAudioActive: () => Promise.resolve(active),
      },
      // No timer: the readings are the mount's and the ones asked for below.
      { now: () => 0, every: () => () => undefined },
    );
    const music = rig(disk(), { track: TRACK, riderPlayer: player });
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        menuMusic={music.music}
        soundOutput={music.output}
        otherPlayer={player}
      />,
    );
    await settle();

    await pressWithoutLeaving(homeControl());
    expect(music.made, 'the loop started over the rider’s own player').toEqual([]);
    expect(music.fake.gains, 'a graph was built for a loop that yielded').toEqual([]);
    // Non-vacuity: the header's poll on mount is what heard the rider's player.
    expect(player.getSnapshot().playing).toBe(true);

    active = false;
    await act(async () => {
      await player.poll();
    });
    await pressWithoutLeaving(homeControl());
    expect(music.made[0]?.paused).toBe(false);
    expect(musicBus(music)).toBe(0.5);
  });
});

/**
 * #2242's review: the header's *Pause music* runs its `onClick` before
 * `AppShell`'s bubbling press handler, and `OtherPlayer.press` believes the
 * pause at once. Unless the loop ignores a press inside the rider's player's
 * controls, that same click starts our loop over theirs: for good when the key
 * is refused, since the loop asks nothing while it plays.
 */
describe('a press on the rider’s own player’s controls never starts the loop — #2073', () => {
  async function shellWithPlayer(sendKey: () => Promise<void>): Promise<{
    music: Rig;
    player: OtherPlayer;
    sent: string[];
  }> {
    const sent: string[] = [];
    const player = new OtherPlayer(
      {
        sendKey: (key) => {
          sent.push(key);
          return sendKey();
        },
        otherAudioActive: () => Promise.resolve(true),
      },
      { now: () => 0, every: () => () => undefined },
    );
    const music = rig(disk(), { track: TRACK, riderPlayer: player });
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        menuMusic={music.music}
        soundOutput={music.output}
        otherPlayer={player}
      />,
    );
    await settle();
    // The mount's reading was one; a second in a row is a sighting, and the controls show.
    await act(async () => {
      await player.poll();
    });
    await settle();
    return { music, player, sent };
  }

  function pauseMusic(): HTMLButtonElement | undefined {
    return [...document.querySelectorAll<HTMLButtonElement>('header button')].find(
      (button) => button.textContent?.trim() === PAUSE_MUSIC_NAME,
    );
  }

  it('*Pause music* sends the pause, and makes no music element', async () => {
    const { music, player, sent } = await shellWithPlayer(() => Promise.resolve());
    await pressWithoutLeaving(pauseMusic() ?? null);
    await settle();

    expect(sent).toEqual(['pause']);
    // Non-vacuity: the press was believed, so the loop was free to start.
    expect(player.riderPlayerInUse()).toBe(false);
    expect(music.made, 'our loop started on the rider’s own Pause').toEqual([]);
    expect(music.fake.gains, 'a graph was built for a press on the rider’s player').toEqual([]);
  });

  it('a pause the device refused leaves the loop unmade, and the rider’s player in use', async () => {
    const { music, player, sent } = await shellWithPlayer(() =>
      Promise.reject(new Error('no media session')),
    );
    await pressWithoutLeaving(pauseMusic() ?? null);
    await settle();

    expect(sent).toEqual(['pause']);
    expect(player.riderPlayerInUse()).toBe(true);
    expect(music.made, 'our loop is playing over the rider’s player').toEqual([]);
    // And it does not come over it on the next press either.
    await pressWithoutLeaving(homeControl());
    expect(music.made).toEqual([]);
  });
});

describe('a press on the rider’s own player’s controls, after our loop has played — #2073', () => {
  it('*Pause music* does not bring back a loop that yielded to the rider’s player', async () => {
    let active = false;
    const player = new OtherPlayer(
      { sendKey: () => Promise.resolve(), otherAudioActive: () => Promise.resolve(active) },
      { now: () => 0, every: () => () => undefined },
    );
    const music = rig(disk(), { track: TRACK, riderPlayer: player });
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        menuMusic={music.music}
        soundOutput={music.output}
        otherPlayer={player}
      />,
    );
    await settle();
    await pressWithoutLeaving(homeControl());
    const [element] = music.made;
    expect(element?.paused).toBe(false);

    // The rider leaves, starts their player, and comes back: our loop yields.
    await setHidden(music, true);
    active = true;
    await setHidden(music, false);
    await act(async () => {
      await player.poll();
      await player.poll();
    });
    music.endSettle();
    await settle();
    expect(element?.paused).toBe(true);

    const pause = [...document.querySelectorAll<HTMLButtonElement>('header button')].find(
      (button) => button.textContent?.trim() === PAUSE_MUSIC_NAME,
    );
    await pressWithoutLeaving(pause ?? null);
    // Non-vacuity: the press was believed, so the loop was free to come back.
    expect(player.riderPlayerInUse()).toBe(false);
    expect(element?.paused, 'our loop came back on the rider’s own Pause').toBe(true);
    expect(music.made).toHaveLength(1);
  });
});

describe('back from another app before the loop ever played — #2242 review', () => {
  it('a press within a poll of coming back waits for a reading taken after it', async () => {
    const device = phone();
    const music = rigWith(device);
    device.read();
    await shell(music);

    // No press yet. The rider leaves, starts their player, and comes back.
    await setHidden(music, true);
    device.riderPlaying = true;
    await setHidden(music, false);
    await pressWithoutLeaving(homeControl());
    expect(music.made, 'the loop started on the reading from before they left').toEqual([]);

    // The header reads again: their player is in use, and still nothing starts.
    device.read();
    music.endSettle();
    await pressWithoutLeaving(homeControl());
    expect(music.made).toEqual([]);

    // Their player stops, and the next press starts ours.
    device.riderPlaying = false;
    device.read();
    await pressWithoutLeaving(homeControl());
    expect(music.made[0]?.paused).toBe(false);
  });
});

/**
 * #2357, the owner's ruling of 2026-11-08: in the Android app the loop starts
 * with no press, where the shell says its WebView allows it; a browser and the
 * demo keep the first press. Every "playing" is the element's and every level
 * the graph's, as above.
 */
describe('in the Android app the menus’ music starts with no press — #2357', () => {
  it('the shell says yes: the loop starts on Home with no press, at the default level', async () => {
    const music = rig(disk(), { track: TRACK, autoplay: Promise.resolve(true) });
    await shell(music);
    expect(music.made).toHaveLength(1);
    const [element] = music.made;
    expect(element).toMatchObject({ paused: false, loop: true, preload: 'none', src: TRACK });
    expect(musicBus(music)).toBe(0.5);
    // Nothing plays it again: a press finds it playing.
    await pressWithoutLeaving(homeControl());
    expect(element?.plays).toBe(1);
  });

  it('the header’s mute is on the page before it starts, and stops it — WCAG 1.4.2', async () => {
    // This device's own storage: the header's mute writes there, as in the app.
    const music = rig(localStorage, { track: TRACK, autoplay: Promise.resolve(true) });
    await shell(music);
    const [element] = music.made;
    expect(element?.muteOnPageAtFirstPlay, 'it started before the mute could be reached').toBe(
      true,
    );
    await pressWithoutLeaving(headerMute() ?? null);
    expect(element?.paused).toBe(true);
    expect(musicPath(music.fake).master.gain.value).toBe(0);
    // Muted, it stays stopped across menu routes: nothing starts it by itself again.
    await go('#/settings');
    expect(element?.paused).toBe(true);
    expect(music.made).toHaveLength(1);
  });

  it('a browser, the demo, or a shell that says no never starts it without a press', async () => {
    // Made one at a time, so the refusal is not a rejection nothing is waiting on yet.
    const answers: (() => Promise<boolean> | undefined)[] = [
      () => undefined,
      () => Promise.resolve(false),
      () => Promise.reject(new Error('not implemented')),
    ];
    for (const answer of answers) {
      const music = rig(disk(), { track: TRACK, autoplay: answer() });
      await shell(music);
      await go('#/settings');
      await go('#/');
      music.endSettle();
      expect(music.made, 'it started with no press').toEqual([]);
      expect(music.fake.gains, 'a graph was built with no press').toEqual([]);
      // The first press still starts it, as before.
      await pressWithoutLeaving(homeControl());
      expect(music.made[0]?.paused).toBe(false);
      mounted?.unmount();
      mounted = undefined;
      window.location.hash = '#/';
    }
  });

  it('a shell that answers after the first route has painted starts it then', async () => {
    let answer: (allowed: boolean) => void = () => undefined;
    const music = rig(disk(), {
      track: TRACK,
      autoplay: new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
    });
    await shell(music);
    expect(music.made).toEqual([]);
    await act(async () => {
      answer(true);
      await Promise.resolve();
    });
    expect(music.made[0]?.paused).toBe(false);
  });

  it('under the master mute, or with music muted, it does not start', async () => {
    const master = disk();
    writeMasterMuted(master, true);
    const first = rig(master, { track: TRACK, autoplay: Promise.resolve(true) });
    await shell(first);
    expect(first.made).toEqual([]);
    mounted?.unmount();

    const muted = disk();
    writeAudioBus(muted, 'music', { volume: 0.5, muted: true });
    const second = rig(muted, { track: TRACK, autoplay: Promise.resolve(true) });
    await shell(second);
    expect(second.made).toEqual([]);
  });

  it('a page that opens hidden starts nothing, and starts once it is shown', async () => {
    const music = rig(disk(), { track: TRACK, autoplay: Promise.resolve(true) });
    music.hidden = true;
    await shell(music);
    expect(music.made).toEqual([]);
    await setHidden(music, false);
    expect(music.made[0]?.paused).toBe(false);
  });

  it(
    'an app that opens on a ride route starts nothing there, and starts on the first menu route',
    { timeout: RIDE_VIEWS_TIMEOUT_MS },
    async () => {
      for (const ride of ['#/ride', '#/game']) {
        const music = rig(disk(), { track: TRACK, autoplay: Promise.resolve(true) });
        window.location.hash = ride;
        await shell(music);
        expect(music.made, ride).toEqual([]);
        expect(music.fake.gains, ride).toEqual([]);
        await go('#/');
        expect(music.made[0]?.paused, `on Home after ${ride}`).toBe(false);
        mounted?.unmount();
        mounted = undefined;
      }
    },
  );

  it('a ride in progress on a menu route starts nothing until it is over', async () => {
    const stub = stubRideController(ridingSnapshot());
    const music = rig(disk(), { track: TRACK, autoplay: Promise.resolve(true) });
    await shell(music, stub.controller);
    expect(music.made).toEqual([]);
    await act(async () => {
      stub.set({ phase: 'idle' });
      await Promise.resolve();
    });
    expect(music.made[0]?.paused).toBe(false);
  });

  it('the rider’s own player already playing at launch wins: the loop waits for a reading, and stays silent', async () => {
    const device = phone();
    const music = rig(disk(), {
      track: TRACK,
      riderPlayer: device.player,
      autoplay: Promise.resolve(true),
    });
    device.hear(music.made);
    await shell(music);
    // Before the header's first reading has landed: nothing.
    expect(music.made, 'it started before the rider’s player was asked').toEqual([]);
    device.riderPlaying = true;
    device.read();
    music.endSettle();
    expect(music.made, 'the loop talked over the rider’s own player').toEqual([]);
    expect(music.fake.gains).toEqual([]);
  });

  it('with the rider’s player silent at launch, the loop starts once the header has read', async () => {
    const device = phone();
    const music = rig(disk(), {
      track: TRACK,
      riderPlayer: device.player,
      autoplay: Promise.resolve(true),
    });
    device.hear(music.made);
    await shell(music);
    expect(music.made).toEqual([]);
    device.read();
    music.endSettle();
    expect(music.made[0]?.paused).toBe(false);
    expect(musicBus(music)).toBe(0.5);
  });

  it('through the header’s real OtherPlayer: a rider’s player heard on mount keeps the loop silent', async () => {
    const player = new OtherPlayer(
      {
        sendKey: () => Promise.resolve(),
        otherAudioActive: () => Promise.resolve(true),
      },
      { now: () => 0, every: () => () => undefined },
    );
    const music = rig(disk(), {
      track: TRACK,
      riderPlayer: player,
      autoplay: Promise.resolve(true),
    });
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        menuMusic={music.music}
        soundOutput={music.output}
        otherPlayer={player}
      />,
    );
    await settle();
    // Non-vacuity: the header's poll on mount is what heard the rider's player.
    expect(player.getSnapshot().playing).toBe(true);
    music.endSettle();
    expect(music.made, 'the loop talked over the rider’s own player').toEqual([]);
  });
});
