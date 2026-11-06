// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  capacitorOtherPlayer,
  OTHER_PLAYER_CALL_DEADLINE_MILLISECONDS,
  type OtherPlayerKey,
  type OtherPlayerPlugin,
} from './other-player';

afterEach(() => {
  vi.useRealTimers();
});

function scripted(reply: unknown = { active: true }): {
  readonly plugin: OtherPlayerPlugin;
  readonly keys: OtherPlayerKey[];
} {
  const keys: OtherPlayerKey[] = [];
  return {
    keys,
    plugin: {
      sendKey: ({ key }) => {
        keys.push(key);
        return Promise.resolve();
      },
      otherAudioActive: () => Promise.resolve(reply as { active: boolean }),
    },
  };
}

/** A call that never settles, as a plugin wedged on the binder would. */
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

describe('the rider’s own music player through the shell’s plugin — #2073', () => {
  it.each(['play', 'pause', 'next', 'previous'] as const)('sends %s as that key', async (key) => {
    const { plugin, keys } = scripted();
    await capacitorOtherPlayer(plugin).sendKey(key);
    expect(keys).toStrictEqual([key]);
  });

  it('passes a refused or missing plugin on, for the web side to swallow', async () => {
    const missing: OtherPlayerPlugin = {
      sendKey: () => Promise.reject(new Error('not implemented')),
      otherAudioActive: () => Promise.reject(new Error('not implemented')),
    };
    await expect(capacitorOtherPlayer(missing).sendKey('play')).rejects.toThrow('not implemented');
    await expect(capacitorOtherPlayer(missing).otherAudioActive()).resolves.toBe(false);
  });

  it('reads other audio as playing only when the plugin says exactly that', async () => {
    await expect(
      capacitorOtherPlayer(scripted({ active: true }).plugin).otherAudioActive(),
    ).resolves.toBe(true);
    for (const reply of [{ active: false }, { active: 'true' }, { active: 1 }, {}, null]) {
      await expect(capacitorOtherPlayer(scripted(reply).plugin).otherAudioActive()).resolves.toBe(
        false,
      );
    }
  });

  it('hands the client one boolean, whatever else a reply carries (spike 0034 §4)', async () => {
    const hostile = scripted({
      active: true,
      title: 'Synthetic Song',
      artist: 'Synthetic Artist',
      packageName: 'com.example.player',
    });
    const answer: unknown = await capacitorOtherPlayer(hostile.plugin).otherAudioActive();
    expect(answer).toBe(true);
    expect(typeof answer).toBe('boolean');
  });

  it('gives up a key that is never sent, at the deadline', async () => {
    vi.useFakeTimers();
    const wedged: OtherPlayerPlugin = { sendKey: never, otherAudioActive: never };
    const sent = capacitorOtherPlayer(wedged).sendKey('next');
    const settled = expect(sent).rejects.toThrow('took too long');
    await vi.advanceTimersByTimeAsync(OTHER_PLAYER_CALL_DEADLINE_MILLISECONDS - 1);
    let early = false;
    void sent.catch(() => {
      early = true;
    });
    await Promise.resolve();
    expect(early).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
  });

  it('reads a reading that never comes as nothing playing, at the deadline', async () => {
    vi.useFakeTimers();
    const wedged: OtherPlayerPlugin = { sendKey: never, otherAudioActive: never };
    const reading = capacitorOtherPlayer(wedged).otherAudioActive();
    await vi.advanceTimersByTimeAsync(OTHER_PLAYER_CALL_DEADLINE_MILLISECONDS);
    await expect(reading).resolves.toBe(false);
  });
});
