// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A house on a level that must not get a parcel is said in words, never by
 * sight alone — #2365, ADR 0065 D-10.5, audited inside `test:a11y`.
 *
 * The real `GameView`, chooser, simulation, round, HUD and announcer ride
 * the synthetic fixture level (ADR 0065 D-7.5) with half its houses to get
 * no parcel. What is read is what a rider hears: the HUD's one live region
 * saying the next house is to be skipped, on which side, while the ride
 * screen has no accessibility finding.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { kilograms, watts } from '@onyourleft/domain';
import { levelRouteId } from '@onyourleft/store';

import { auditAccessibility, formatViolations } from '../../../a11y/audit';
import { mount, queryAll, settle, type Mounted } from '../../../testing/mount';
import { GameView, type GamePort } from '../../GameView';
import { ANNOUNCEMENTS_STORAGE_KEY, DEFAULT_ANNOUNCEMENTS } from '../../hud/announce-preference';
import { skipHouseSentence } from '../../hud/delivery-announce';
import type { GameRenderer } from '../../port';
import { writeRealisticWorldChoice } from '../../world-preference';

import { parseLevelFile } from './level-file';

const FIXTURE = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fixture-level.json'),
    'utf8',
  ),
) as { round: Record<string, unknown> } & Record<string, unknown>;

/** The fixture level, half its houses to get no parcel and half the rest mailboxes, with no hazard. */
const LEVEL = parseLevelFile(
  {
    ...FIXTURE,
    round: {
      ...FIXTURE.round,
      hazardsPerKilometre: { static: 0, moving: 0 },
      mailboxShare: 0.5,
      noDeliveryShare: 0.5,
    },
  },
  'fixture-level',
);

const SKIP_SAID = [skipHouseSentence('left'), skipHouseSentence('right')];

const port: GamePort = {
  listRoutes: () => Promise.resolve([]),
  loadDeliveryLevel: (id) => Promise.resolve(id === LEVEL.id ? LEVEL : undefined),
  loadGhost: () => Promise.resolve(undefined),
  readSensors: () => ({
    rider: { power: watts(260), live: true, paired: true },
    cadence: { value: 90, live: true, paired: true },
    heartRate: { value: 140, live: true, paired: true },
  }),
};

const renderer: GameRenderer = {
  loadRealisticWorld: () => Promise.resolve({ loaded: true }),
  create: () => ({
    hasContext: true,
    prepare: () => Promise.resolve(),
    render: () => undefined,
    setQuality: () => undefined,
    setRiderKit: () => undefined,
    setSeason: () => undefined,
    resize: () => undefined,
    destroy: () => undefined,
  }),
};

let pending: FrameRequestCallback[] = [];
let nowMs = 0;
let mounted: Mounted | undefined;

beforeEach(() => {
  pending = [];
  nowMs = 0;
  localStorage.clear();
  writeRealisticWorldChoice(localStorage, true);
  // Announcements off, the default: the warning is said all the same (`announce.ts` §`ALWAYS_SPOKEN`).
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: false }),
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = 23;
      return array;
    },
  );
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
  globalThis.location.hash = '';
});

async function pump(): Promise<void> {
  const due = pending;
  pending = [];
  nowMs += 250;
  await act(async () => {
    for (const callback of due) callback(nowMs);
    await Promise.resolve();
  });
}

describe('#2365 — a house that must not get a parcel, said in words', () => {
  it(
    'says the next house is to be skipped through the HUD’s one live region, with announcements off, with no finding',
    { timeout: 30_000 },
    async () => {
      globalThis.location.hash = `#/game?route=${levelRouteId(LEVEL.id)}&play=delivery`;
      mounted = await mount(
        <main>
          <h1>Trainer game</h1>
          <GameView
            port={port}
            renderer={() => Promise.resolve(renderer)}
            now={() => nowMs}
            riderMass={kilograms(72)}
          />
        </main>,
      );
      for (let i = 0; i < 50 && (mounted.container.textContent ?? '').includes('Loading'); i++) {
        await settle();
      }
      const ride = queryAll<HTMLButtonElement>(mounted.container, 'button').find((button) =>
        (button.textContent ?? '').startsWith('Ride '),
      );
      expect(ride).toBeDefined();
      await act(async () => {
        ride?.click();
        await Promise.resolve();
      });
      await settle();
      const region = (): string =>
        document.querySelector('[data-oyl-announcer="hud"]')?.textContent ?? '';
      let heard: string | undefined;
      for (let frame = 0; frame < 800 && heard === undefined; frame += 1) {
        await pump();
        if (SKIP_SAID.includes(region())) heard = region();
      }
      expect(SKIP_SAID).toContain(heard);
      expect(formatViolations(auditAccessibility(document))).toBe('');
    },
  );
});
