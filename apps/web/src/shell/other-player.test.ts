// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CapacitorGlobal } from '../support/capacitor';

import {
  OTHER_PLAYER_POLL_MILLISECONDS,
  OtherPlayer,
  otherPlayerOffered,
  PRESS_SETTLE_MILLISECONDS,
} from './other-player';
import type { OtherPlayerPort } from './other-player-port';
import { manualOtherPlayerClock, scriptedOtherPlayerPort } from './other-player-testing';

/** Let the readings already asked for settle. */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve();
}

/** A player that has seen other audio: two readings in a row. */
async function seenPlayer() {
  const scripted = scriptedOtherPlayerPort(true);
  const time = manualOtherPlayerClock();
  const player = new OtherPlayer(scripted.port, time.clock);
  await player.poll();
  await player.poll();
  expect(player.getSnapshot()).toStrictEqual({ seen: true, playing: true });
  return { scripted, time, player };
}

describe('where the rider’s own player is offered — #2073, spike 0034 §3', () => {
  it('is offered inside the Android shell', () => {
    expect(otherPlayerOffered({ isNativePlatform: () => true, getPlatform: () => 'android' })).toBe(
      true,
    );
  });

  const notAndroid: readonly (readonly [string, CapacitorGlobal | undefined])[] = [
    ['a browser', undefined],
    [
      'the same bundle served as a web page',
      { isNativePlatform: () => false, getPlatform: () => 'web' },
    ],
    [
      'a native shell that is not Android',
      { isNativePlatform: () => true, getPlatform: () => 'ios' },
    ],
    ['a shell that names no platform', { isNativePlatform: () => true }],
  ];
  it.each(notAndroid)('is not offered in %s', (_name, capacitor) => {
    expect(otherPlayerOffered(capacitor)).toBe(false);
  });
});

describe('when the control shows — owner ruling 2 of 2026-11-05', () => {
  it('shows nothing before any music is heard', async () => {
    const scripted = scriptedOtherPlayerPort(false);
    const player = new OtherPlayer(scripted.port, manualOtherPlayerClock().clock);
    await player.poll();
    await player.poll();
    expect(player.getSnapshot()).toStrictEqual({ seen: false, playing: false });
  });

  it('needs two readings in a row, so one of our own menu sounds is not a player', async () => {
    const scripted = scriptedOtherPlayerPort(true);
    const player = new OtherPlayer(scripted.port, manualOtherPlayerClock().clock);
    await player.poll();
    expect(player.getSnapshot().seen).toBe(false);
    scripted.setActive(false);
    await player.poll();
    scripted.setActive(true);
    await player.poll();
    expect(player.getSnapshot().seen).toBe(false);
    await player.poll();
    expect(player.getSnapshot().seen).toBe(true);
  });

  it('stays for the rest of the visit once seen, though the player is paused', async () => {
    const { scripted, player } = await seenPlayer();
    scripted.setActive(false);
    await player.poll();
    await player.poll();
    expect(player.getSnapshot()).toStrictEqual({ seen: true, playing: false });
  });

  it('reads a reading that fails as nothing playing', async () => {
    const failing: OtherPlayerPort = {
      sendKey: () => Promise.resolve(),
      otherAudioActive: () => Promise.reject(new Error('not implemented')),
    };
    const player = new OtherPlayer(failing, manualOtherPlayerClock().clock);
    await player.poll();
    await player.poll();
    expect(player.getSnapshot()).toStrictEqual({ seen: false, playing: false });
  });

  it('asks now and every poll interval while watched, and not once stopped', async () => {
    const scripted = scriptedOtherPlayerPort(false);
    const time = manualOtherPlayerClock();
    const player = new OtherPlayer(scripted.port, time.clock);
    const stop = player.watch();
    await flush();
    expect(scripted.readings()).toBe(1);
    time.advance(OTHER_PLAYER_POLL_MILLISECONDS);
    await flush();
    time.advance(OTHER_PLAYER_POLL_MILLISECONDS);
    await flush();
    expect(scripted.readings()).toBe(3);
    stop();
    expect(time.running()).toBe(0);
    time.advance(OTHER_PLAYER_POLL_MILLISECONDS * 3);
    await flush();
    expect(scripted.readings()).toBe(3);
  });

  it('does not count readings either side of a stop as two in a row', async () => {
    const scripted = scriptedOtherPlayerPort(true);
    const player = new OtherPlayer(scripted.port, manualOtherPlayerClock().clock);
    const stop = player.watch();
    await flush();
    stop();
    player.watch();
    await flush();
    expect(player.getSnapshot().seen).toBe(false);
  });

  it('does not ask again while a reading is in flight', async () => {
    let asked = 0;
    let answer: (active: boolean) => void = () => undefined;
    const slow: OtherPlayerPort = {
      sendKey: () => Promise.resolve(),
      otherAudioActive: () => {
        asked += 1;
        return new Promise<boolean>((resolve) => {
          answer = resolve;
        });
      },
    };
    const player = new OtherPlayer(slow, manualOtherPlayerClock().clock);
    const first = player.poll();
    await player.poll();
    expect(asked).toBe(1);
    answer(false);
    await first;
    // Settled: the next poll asks again (and is left in flight).
    void player.poll();
    expect(asked).toBe(2);
  });

  it('tells a subscriber of a change, and keeps the same snapshot when nothing changed', async () => {
    const scripted = scriptedOtherPlayerPort(true);
    const player = new OtherPlayer(scripted.port, manualOtherPlayerClock().clock);
    let told = 0;
    const unsubscribe = player.subscribe(() => {
      told += 1;
    });
    await player.poll();
    expect(told).toBe(1);
    const before = player.getSnapshot();
    await player.poll();
    expect(told).toBe(2);
    const seen = player.getSnapshot();
    await player.poll();
    expect(player.getSnapshot()).toBe(seen);
    expect(before).not.toBe(seen);
    unsubscribe();
    scripted.setActive(false);
    await player.poll();
    expect(told).toBe(2);
  });
});

describe('what a press sends — spike 0034 §1.2', () => {
  it('sends pause while the player plays, and play once it is paused', async () => {
    const { scripted, player } = await seenPlayer();
    await player.press('play-pause');
    expect(scripted.keys).toStrictEqual(['pause']);
    expect(player.getSnapshot().playing).toBe(false);
    await player.press('play-pause');
    expect(scripted.keys).toStrictEqual(['pause', 'play']);
    expect(player.getSnapshot().playing).toBe(true);
  });

  it('sends next and previous as themselves, believing nothing new', async () => {
    const { scripted, player } = await seenPlayer();
    await player.press('next');
    await player.press('previous');
    expect(scripted.keys).toStrictEqual(['next', 'previous']);
    expect(player.getSnapshot().playing).toBe(true);
  });

  it('believes a press over the readings while a player stops, then the readings', async () => {
    const { scripted, time, player } = await seenPlayer();
    // The player is slow to stop: the reading straight after still says playing.
    await player.press('play-pause');
    await player.poll();
    expect(player.getSnapshot().playing).toBe(false);
    time.advance(PRESS_SETTLE_MILLISECONDS);
    await player.poll();
    // The rider's player did not obey: the control says so, and offers Pause again.
    expect(player.getSnapshot().playing).toBe(true);
    scripted.setActive(false);
    await player.poll();
    expect(player.getSnapshot().playing).toBe(false);
  });

  it('follows the rider pausing in their own app', async () => {
    const { scripted, player } = await seenPlayer();
    scripted.setActive(false);
    await player.poll();
    await player.press('play-pause');
    expect(scripted.keys).toStrictEqual(['play']);
  });

  it('keeps what it believed when a key could not be sent, and never rejects', async () => {
    const { scripted, player } = await seenPlayer();
    scripted.failKeys();
    await expect(player.press('play-pause')).resolves.toBeUndefined();
    expect(player.getSnapshot().playing).toBe(true);
    await expect(player.press('next')).resolves.toBeUndefined();
    expect(scripted.keys).toStrictEqual([]);
    // And the next reading is believed at once: the failed press does not hold it.
    scripted.setActive(false);
    await player.poll();
    expect(player.getSnapshot().playing).toBe(false);
  });
});

describe('what the menu music may ask — owner ruling 3 of 2026-11-05', () => {
  it('reads the rider’s player as in use while the control believes it plays', async () => {
    const { scripted, player } = await seenPlayer();
    expect(player.riderPlayerInUse()).toBe(true);
    scripted.setActive(false);
    await player.poll();
    expect(player.riderPlayerInUse()).toBe(false);
  });
});

describe('what it holds — spike 0034 §4', () => {
  it('holds two booleans and nothing else', async () => {
    const { player } = await seenPlayer();
    const snapshot = player.getSnapshot();
    expect(Object.keys(snapshot).sort()).toStrictEqual(['playing', 'seen']);
    for (const value of Object.values(snapshot)) expect(typeof value).toBe('boolean');
  });
});

/**
 * `main.tsx` makes the player and hands it to the shell. An optional prop
 * nobody supplies is green under both the typechecker and `check:wiring`
 * (docs/agents/wiring-gate.md §Limits), so this reads the source: it proves
 * the composition is written, not that a device runs it.
 */
describe('main.tsx composes the player inside the Android shell — #2073', () => {
  const main = readFileSync(join(import.meta.dirname, '../main.tsx'), 'utf8');

  it('makes it from the plugin only where it is offered', () => {
    expect(main).toMatch(
      /otherPlayerOffered\(platformCapacitor\(\)\)\s*\?\s*new OtherPlayer\(mobile\.capacitorOtherPlayer\(mobile\.capacitorOtherPlayerPlugin\(\)\)\)\s*:\s*undefined/,
    );
  });

  it('hands it to the shell', () => {
    expect(main).toContain('otherPlayer={platform.otherPlayer}');
  });

  it('hands the same player to the menus’ music, which yields to it — #2253', () => {
    const call = /createMenuMusic\(\{[\s\S]*?\n {2}\}\);/.exec(main)?.[0];
    expect(call, 'main.tsx makes no menu music').toBeDefined();
    expect(call).toMatch(/\briderPlayer:\s*platform\.otherPlayer,/);
  });
});
