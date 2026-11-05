// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The header's one-press mute — #2056.
 *
 * ⚠️ Every level here is read from the GRAPH `game/web-audio.ts` builds, over
 * `audio-testing.ts`'s fake context and the same `deviceAudioMix` the app
 * builds its output over — never from the button's own state. A mute that only
 * flipped `aria-pressed` would pass any test that read the button back.
 *
 * The tab-order walk is over the route table itself (`ALL_ROUTES`), split by
 * `route-motion.ts` §`isRideRoute`, so a route added later is walked unasked.
 * jsdom performs no layout; that the button is 44 px is measured in
 * `browser/shell.browser.spec.ts` §"#2056".
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tabbableElements } from '../a11y/audit';
import { AUDIO_MIX_STORAGE_KEY } from '../game/audio-mix';
import {
  fakeAudioContext,
  musicPath,
  recordingOutput,
  type FakeAudio,
} from '../game/audio-testing';
import type { CueOutput } from '../game/audio-port';
import { deviceStorage, type PreferenceStorage } from '../game/hud/announce-preference';
import { deviceAudioMix, webAudioOutput } from '../game/web-audio';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { AppShell } from './AppShell';
import { HEADER_MUTE_NAME, HeaderMute } from './HeaderMute';
import { isRideRoute } from './route-motion';
import { ALL_ROUTES } from './routes';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;

beforeEach(() => {
  localStorage.clear();
  window.location.hash = '#/';
  // jsdom lays nothing out and has no `scrollIntoView`; the skip link calls it.
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  localStorage.clear();
  window.location.hash = '';
});

/** The app's output over a fake context and this device's storage, as `main.tsx` builds it. */
function appOutput(): { readonly fake: FakeAudio; readonly output: CueOutput; made: number } {
  const fake = fakeAudioContext();
  const built = {
    fake,
    made: 0,
    output: webAudioOutput(() => {
      built.made += 1;
      return fake.context;
    }, deviceAudioMix(deviceStorage)),
  };
  return built;
}

async function shell(output: CueOutput, path = '/'): Promise<Mounted> {
  window.location.hash = `#${path}`;
  mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} soundOutput={output} />);
  await settle();
  return mounted;
}

function headerMute(): HTMLButtonElement | null {
  const header = document.querySelector('header.oyl-header');
  return (
    [...(header?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
      (button) => button.textContent?.trim() === HEADER_MUTE_NAME,
    ) ?? null
  );
}

describe('the header mute silences the master, across a reload — #2056', () => {
  it('sets the master gain to 0 on a graph already playing, and keeps it', async () => {
    const first = appOutput();
    // A press elsewhere has built the graph (a menu sound, the music).
    first.output.resume();
    expect(musicPath(first.fake).master.gain.value).toBe(1);

    await shell(first.output);
    const mute = headerMute();
    expect(mute?.getAttribute('aria-pressed')).toBe('false');
    mute?.click();
    await settle();
    expect(musicPath(first.fake).master.gain.value).toBe(0);
    expect(headerMute()?.getAttribute('aria-pressed')).toBe('true');

    // A reload: the shell and the graph are discarded and rebuilt; only the
    // device's storage survives.
    mounted?.unmount();
    mounted = undefined;
    const again = appOutput();
    await shell(again.output);
    expect(headerMute()?.getAttribute('aria-pressed')).toBe('true');
    again.output.resume();
    expect(musicPath(again.fake).master.gain.value).toBe(0);

    // And a second press brings the sound back.
    headerMute()?.click();
    await settle();
    expect(musicPath(again.fake).master.gain.value).toBe(1);
    expect(headerMute()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('starts no audio when nothing has played yet', async () => {
    const quiet = appOutput();
    await shell(quiet.output);
    headerMute()?.click();
    await settle();
    expect(quiet.made, 'a mute pressed first made an audio context').toBe(0);
    expect(localStorage.getItem(AUDIO_MIX_STORAGE_KEY)).toContain('"masterMuted":true');
  });

  it('does not claim a mute the device refused to keep', async () => {
    // The master is read back from storage by the output, so a refused write
    // mutes nothing: the button must not say it did.
    const refusing: PreferenceStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    };
    const fake = fakeAudioContext();
    const output = webAudioOutput(
      () => fake.context,
      deviceAudioMix(() => refusing),
    );
    output.resume();
    mounted = await mount(<HeaderMute storage={refusing} output={output} />);
    await settle();
    const button = document.querySelector('button');
    button?.click();
    await settle();
    expect(musicPath(fake).master.gain.value).toBe(1);
    expect(button?.getAttribute('aria-pressed')).toBe('false');
  });

  it('asks the output to apply the mix inside the press', async () => {
    const output = recordingOutput();
    await shell(output);
    headerMute()?.click();
    expect(output.count('applyMix')).toBe(1);
    expect(output.count('resume')).toBe(0);
  });
});

describe('the header mute is near the top of the tab order on every menu route — #2056', () => {
  const menu = ALL_ROUTES.filter((route) => !isRideRoute(route.id));
  const ride = ALL_ROUTES.filter((route) => isRideRoute(route.id));

  it('walks a route table with both kinds in it', () => {
    expect(menu.length).toBeGreaterThan(1);
    expect(ride.length).toBeGreaterThan(0);
  });

  for (const route of menu) {
    it(`${route.id}: among the first three stops after the skip link`, async () => {
      await shell(recordingOutput(), route.path);
      const stops = tabbableElements(document);
      const skip = stops.findIndex((stop) => stop.classList.contains('oyl-skip-link'));
      expect(skip, 'no skip link').toBeGreaterThanOrEqual(0);
      const mute = headerMute();
      expect(mute, 'no header mute').not.toBeNull();
      const at = stops.indexOf(mute as HTMLElement);
      expect(
        at - skip,
        `the mute is stop ${String(at - skip)} after the skip link`,
      ).toBeGreaterThan(0);
      expect(at - skip).toBeLessThanOrEqual(3);
    });
  }

  for (const route of ride) {
    it(`${route.id}: a ride route, where the ride's own controls stay as they are`, async () => {
      await shell(recordingOutput(), route.path);
      expect(document.querySelector('header.oyl-header')).not.toBeNull();
      expect(headerMute()).toBeNull();
    });
  }
});
