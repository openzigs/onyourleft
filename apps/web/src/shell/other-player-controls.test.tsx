// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The rider's own music player's controls in the real `AppShell` — #2073.
 *
 * Every press is driven through the plugin port as `main.tsx` composes it:
 * `@onyourleft/mobile`'s bounded {@link capacitorOtherPlayer} over a scripted
 * `OtherPlayerPlugin`, so what is asserted is the key the plugin was asked to
 * send. Whether the rider's app then obeys is spike 0034 §7's device rows.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  capacitorOtherPlayer,
  type OtherPlayerKey,
  type OtherPlayerPlugin,
} from '@onyourleft/mobile';

import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { AppShell } from './AppShell';
import { OTHER_PLAYER_POLL_MILLISECONDS, OtherPlayer } from './other-player';
import { manualOtherPlayerClock, type ManualOtherPlayerClock } from './other-player-testing';
import {
  NEXT_TRACK_NAME,
  OTHER_PLAYER_GROUP_NAME,
  PAUSE_MUSIC_NAME,
  PLAY_MUSIC_NAME,
  PREVIOUS_TRACK_NAME,
} from './OtherPlayerControls';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

/** A ride route's view is the largest to load the first time, under coverage most of all. */
const RIDE_ROUTE = { timeout: 20_000 } as const;

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

/** The Android plugin, scripted: what it was asked to send, and what it answers. */
function scriptedPlugin(active: boolean) {
  const keys: OtherPlayerKey[] = [];
  const state = { active, readings: 0 };
  const plugin: OtherPlayerPlugin = {
    sendKey: ({ key }) => {
      keys.push(key);
      return Promise.resolve();
    },
    otherAudioActive: () => {
      state.readings += 1;
      return Promise.resolve({ active: state.active });
    },
  };
  return { plugin, keys, state };
}

interface Shell {
  readonly keys: OtherPlayerKey[];
  readonly state: { active: boolean; readings: number };
  readonly time: ManualOtherPlayerClock;
}

async function open(path: string, active: boolean, withPlayer = true): Promise<Shell> {
  const scripted = scriptedPlugin(active);
  const time = manualOtherPlayerClock();
  const player = withPlayer
    ? new OtherPlayer(capacitorOtherPlayer(scripted.plugin), time.clock)
    : undefined;
  globalThis.location.hash = `#${path}`;
  mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} otherPlayer={player} />);
  await settle();
  return { keys: scripted.keys, state: scripted.state, time };
}

/** One poll interval, and the reading it asks for settled. */
async function onePoll(time: ManualOtherPlayerClock): Promise<void> {
  await act(async () => {
    time.advance(OTHER_PLAYER_POLL_MILLISECONDS);
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  });
}

function group(): HTMLElement | null {
  return document.querySelector(`header [role="group"][aria-label="${OTHER_PLAYER_GROUP_NAME}"]`);
}

function button(name: string): HTMLButtonElement {
  const found = [...(group()?.querySelectorAll('button') ?? [])].find(
    (each) => each.textContent?.trim() === name,
  );
  if (found === undefined) throw new Error(`no ${name} in the header`);
  return found;
}

async function press(name: string): Promise<void> {
  await act(async () => {
    button(name).click();
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
  });
}

describe('the rider’s own music player in the header — #2073', () => {
  it('is not in a browser build, which has no player to hand the shell', async () => {
    await open('/', true, false);
    expect(document.querySelector('header.oyl-header')).not.toBeNull();
    expect(group()).toBeNull();
  });

  it('is not there while nothing is playing', async () => {
    const shell = await open('/', false);
    await onePoll(shell.time);
    await onePoll(shell.time);
    expect(shell.state.readings).toBeGreaterThanOrEqual(2);
    expect(group()).toBeNull();
  });

  it('appears once other audio is heard twice in a row, with its three controls', async () => {
    const shell = await open('/', true);
    expect(group()).toBeNull();
    await onePoll(shell.time);
    expect(group()).not.toBeNull();
    const names = [...(group()?.querySelectorAll('button') ?? [])].map((each) =>
      each.textContent?.trim(),
    );
    expect(names).toStrictEqual([PREVIOUS_TRACK_NAME, PAUSE_MUSIC_NAME, NEXT_TRACK_NAME]);
  });

  it('sends each key through the plugin port', async () => {
    const shell = await open('/', true);
    await onePoll(shell.time);
    await press(PREVIOUS_TRACK_NAME);
    await press(NEXT_TRACK_NAME);
    await press(PAUSE_MUSIC_NAME);
    await press(PLAY_MUSIC_NAME);
    expect(shell.keys).toStrictEqual(['previous', 'next', 'pause', 'play']);
  });

  it('stays once the rider has paused, so Play is there to press — owner ruling 2', async () => {
    const shell = await open('/', true);
    await onePoll(shell.time);
    await press(PAUSE_MUSIC_NAME);
    shell.state.active = false;
    await onePoll(shell.time);
    await onePoll(shell.time);
    expect(group()).not.toBeNull();
    expect(button(PLAY_MUSIC_NAME)).toBeDefined();
  });

  it.each(['/ride', '/game'])(
    'is never on the ride route %s, and is not asked there either',
    RIDE_ROUTE,
    async (path) => {
      const shell = await open(path, true);
      await onePoll(shell.time);
      await onePoll(shell.time);
      expect(shell.state.readings).toBe(0);
      expect(group()).toBeNull();
    },
  );

  it('leaves when a ride route opens, though it was seen on a menu route', RIDE_ROUTE, async () => {
    const shell = await open('/', true);
    await onePoll(shell.time);
    expect(group()).not.toBeNull();
    await act(async () => {
      globalThis.location.hash = '#/ride';
      globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
      await Promise.resolve();
    });
    await settle();
    const asked = shell.state.readings;
    await onePoll(shell.time);
    expect(group()).toBeNull();
    expect(shell.state.readings).toBe(asked);
  });
});
