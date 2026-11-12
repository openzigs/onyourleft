// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A level's moving hazards are said in words, never by sight alone — #2364,
 * ADR 0065 D-10.9, audited inside `test:a11y`.
 *
 * The real `GameView`, chooser, simulation, round, obstacles, HUD and
 * announcer ride the synthetic fixture level (ADR 0065 D-7.5) with moving
 * hazards in its round. What is read is what a rider hears: the HUD's one
 * live region saying a dog, a car pulling out or another rider coming the
 * other way, in the words `hud/delivery-announce.ts` gives each, while the
 * ride screen has no accessibility finding.
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
import type { GameRenderer } from '../../port';
import { writeRealisticWorldChoice } from '../../world-preference';

import { parseLevelFile } from './level-file';

const FIXTURE = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fixture-level.json'),
    'utf8',
  ),
) as { round: Record<string, unknown> } & Record<string, unknown>;

/** The fixture level, its round all moving hazards, as dense as a level may ask. */
const LEVEL = parseLevelFile(
  { ...FIXTURE, round: { ...FIXTURE.round, hazardsPerKilometre: { static: 0, moving: 4 } } },
  'fixture-level',
);

/** Each moving hazard's sentence, as the live region says it. */
const MOVING_SAID =
  /^(A dog ahead, from the (left|right)\.|A car pulling out ahead, on the (left|right)\.|A rider coming the other way, in the (left|right) lane\.)$/;

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
  localStorage.setItem(
    ANNOUNCEMENTS_STORAGE_KEY,
    JSON.stringify({ ...DEFAULT_ANNOUNCEMENTS, enabled: true }),
  );
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.push(callback);
    return pending.length;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(
    <T extends ArrayBufferView>(array: T): T => {
      (array as unknown as Uint32Array)[0] = 11;
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

describe('#2364 — a level’s moving hazards, said in words', () => {
  it('says a moving hazard through the HUD’s one live region on a level ride, with no finding', async () => {
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
    for (let frame = 0; frame < 600 && heard === undefined; frame += 1) {
      await pump();
      if (MOVING_SAID.test(region())) heard = region();
    }
    expect(heard).toMatch(MOVING_SAID);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
