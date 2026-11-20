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

/**
 * #2253: `isMusicActive()` counts our own open output stream (measured on the
 * tablet), so a reading is believed only when our output held none open from
 * the ask to the answer. `quiet` stands for `CueOutput.quietToken`.
 */
describe('a reading that may be our own stream is not believed — #2253', () => {
  function ownOutput(): { open: boolean; opens: number; quietToken: () => number | undefined } {
    const own = {
      open: false,
      opens: 0,
      quietToken: () => (own.open ? undefined : own.opens),
    };
    return own;
  }

  it('while our stream is open, two readings in a row show nothing, and no listener hears them', async () => {
    const scripted = scriptedOtherPlayerPort(true);
    const own = ownOutput();
    own.open = true;
    const player = new OtherPlayer(scripted.port, manualOtherPlayerClock().clock, own);
    let heard = 0;
    player.onReading(() => {
      heard += 1;
    });
    await player.poll();
    await player.poll();
    expect(scripted.readings(), 'non-vacuity: both were asked').toBe(2);
    expect(player.getSnapshot()).toStrictEqual({ seen: false, playing: false });
    expect(player.riderPlayerInUse()).toBe(false);
    expect(heard).toBe(0);
  });

  it('with our stream shut, the rider’s player is believed both ways, and each reading is heard', async () => {
    const scripted = scriptedOtherPlayerPort(true);
    const own = ownOutput();
    const player = new OtherPlayer(scripted.port, manualOtherPlayerClock().clock, own);
    let heard = 0;
    const stop = player.onReading(() => {
      heard += 1;
    });
    await player.poll();
    await player.poll();
    expect(player.getSnapshot()).toStrictEqual({ seen: true, playing: true });
    expect(heard).toBe(2);
    scripted.setActive(false);
    await player.poll();
    expect(player.riderPlayerInUse()).toBe(false);
    expect(heard).toBe(3);
    stop();
    await player.poll();
    expect(heard, 'heard after the unsubscribe').toBe(3);
  });

  it('a stream that opened between the ask and the answer is not believed', async () => {
    const own = ownOutput();
    let answer: (active: boolean) => void = () => undefined;
    const port: OtherPlayerPort = {
      sendKey: () => Promise.resolve(),
      otherAudioActive: () =>
        new Promise<boolean>((resolve) => {
          answer = resolve;
        }),
    };
    const player = new OtherPlayer(port, manualOtherPlayerClock().clock, own);
    const reading = player.poll();
    // A menu sound opens and shuts our stream while the plugin answers.
    own.opens += 1;
    answer(true);
    await reading;
    expect(player.riderPlayerInUse(), 'a reading that spanned our own sound was believed').toBe(
      false,
    );
  });

  it('a reading of ours breaks the run of two: a sighting needs two believed in a row', async () => {
    const scripted = scriptedOtherPlayerPort(true);
    const own = ownOutput();
    const player = new OtherPlayer(scripted.port, manualOtherPlayerClock().clock, own);
    await player.poll();
    own.open = true;
    await player.poll();
    own.open = false;
    await player.poll();
    expect(player.getSnapshot().seen, 'two readings around one of ours made a sighting').toBe(
      false,
    );
    await player.poll();
    expect(player.getSnapshot().seen).toBe(true);
  });
});

/**
 * #2407: menu music asks for readings at fixed moments (#2402), and one asked
 * while another poll is out must be answered by a poll that starts after the
 * ask, not dropped until the header's next 4 s poll.
 */
describe('a reading asked for while one is in flight is asked again — #2407', () => {
  /** A port whose readings stay out until the test answers them, in order. */
  function slowPort(): {
    port: OtherPlayerPort;
    asked: () => number;
    answer: (active: boolean) => void;
  } {
    const waiting: ((active: boolean) => void)[] = [];
    let asked = 0;
    return {
      port: {
        sendKey: () => Promise.resolve(),
        otherAudioActive: () => {
          asked += 1;
          return new Promise<boolean>((resolve) => {
            waiting.push(resolve);
          });
        },
      },
      asked: () => asked,
      answer: (active) => {
        const next = waiting.shift();
        if (next === undefined) throw new Error('no reading is out');
        next(active);
      },
    };
  }

  it('asks one poll at a time, then once more after the one that was out', async () => {
    const slow = slowPort();
    const player = new OtherPlayer(slow.port, manualOtherPlayerClock().clock);
    const first = player.poll();
    const asked = player.poll();
    const askedToo = player.poll();
    expect(slow.asked(), 'two polls were out at once').toBe(1);
    slow.answer(false);
    await first;
    await flush();
    expect(slow.asked(), 'the request made in flight was dropped').toBe(2);
    let answered = false;
    void asked.then(() => {
      answered = true;
    });
    await flush();
    expect(answered, 'answered before its own reading came back').toBe(false);
    slow.answer(true);
    await asked;
    await askedToo;
    expect(slow.asked(), 'two requests in one flight are one poll after it').toBe(2);
    expect(player.riderPlayerInUse(), 'the reading asked for was not the one believed').toBe(true);
    // And the next flight takes a request of its own.
    const later = player.poll();
    const laterAsked = player.poll();
    slow.answer(true);
    await later;
    await flush();
    expect(slow.asked(), 'a later request in flight was dropped').toBe(4);
    slow.answer(false);
    await laterAsked;
    expect(player.riderPlayerInUse()).toBe(false);
  });

  it('judges the poll asked again by its own ask, so a reading of ours is followed by one believed', async () => {
    const slow = slowPort();
    const own = { open: true, quietToken: (): number | undefined => (own.open ? undefined : 0) };
    const player = new OtherPlayer(slow.port, manualOtherPlayerClock().clock, own);
    let heard = 0;
    player.onReading(() => {
      heard += 1;
    });
    // The header's poll goes out while our stream is still open…
    const header = player.poll();
    // …and the menus' music, having hushed, asks for a reading of its own.
    own.open = false;
    const music = player.poll();
    slow.answer(true);
    await header;
    expect(heard, 'a reading taken over our own stream was believed').toBe(0);
    await flush();
    slow.answer(true);
    await music;
    expect(heard, 'the reading the music asked for never came').toBe(1);
    expect(player.riderPlayerInUse()).toBe(true);
  });

  it('asks again even when the reading that was out failed', async () => {
    let asked = 0;
    const port: OtherPlayerPort = {
      sendKey: () => Promise.resolve(),
      otherAudioActive: () => {
        asked += 1;
        return asked === 1 ? Promise.reject(new Error('timed out')) : Promise.resolve(true);
      },
    };
    const player = new OtherPlayer(port, manualOtherPlayerClock().clock);
    const first = player.poll();
    const again = player.poll();
    await first;
    await again;
    expect(asked).toBe(2);
    expect(player.riderPlayerInUse()).toBe(true);
  });

  it('does not ask again once the shell has stopped watching, as on a ride route', async () => {
    const slow = slowPort();
    const player = new OtherPlayer(slow.port, manualOtherPlayerClock().clock);
    const stop = player.watch();
    const asked = player.poll();
    stop();
    slow.answer(false);
    await flush();
    expect(slow.asked(), 'asked again after the shell stopped polling').toBe(1);
    await expect(asked).resolves.toBeUndefined();
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
      /otherPlayerOffered\(platformCapacitor\(\)\)\s*\?\s*new OtherPlayer\(\s*mobile\.capacitorOtherPlayer\(mobile\.capacitorOtherPlayerPlugin\(\)\),/,
    );
  });

  it('makes it over the app’s one audio output, so our own stream is never the rider’s — #2253', () => {
    expect(main).toMatch(
      /new OtherPlayer\(\s*mobile\.capacitorOtherPlayer\(mobile\.capacitorOtherPlayerPlugin\(\)\),\s*BROWSER_OTHER_PLAYER_CLOCK,\s*sharedCueOutput\(\),\s*\)\s*:\s*undefined/,
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
