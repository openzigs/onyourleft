// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The demo's stats are the ride HUD's — #1650. Every reading is read back off
 * the rendered DOM, and the controls' effect off `window.__oylDemo`, which is
 * what the demo's browser gate (#1648) and the video render (#1655) read.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { seconds } from '@onyourleft/domain';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { hudReadings } from '../game/hud/fields';
import { PANEL_NAMES } from '../game/hud/HudCore';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { DEMO_LABEL, DemoPage } from './DemoPage';
import { createDemoPlayer } from './player';
import { GROUP_PRESET, SPRINT_PRESET } from './presets';
import { scriptedSample } from './script';
import { fakeDrawnWorld, fakeRenderer, SteppedFrames } from './stage-testing';

const DEMO = dirname(fileURLToPath(import.meta.url));
const HUD = join(DEMO, '../game/hud');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  delete window.__oylDemo;
});

async function page(search: string, reducedMotion = false): Promise<SteppedFrames> {
  const frames = new SteppedFrames();
  mounted = await mount(
    <DemoPage
      search={search}
      renderer={fakeRenderer(new Promise(() => undefined)).renderer}
      drawnWorld={fakeDrawnWorld}
      frames={frames}
      reducedMotion={reducedMotion}
      observeInView={() => () => undefined}
      // As `main.tsx` publishes it.
      publish={(snapshot) => {
        window.__oylDemo = snapshot;
      }}
    />,
  );
  await settle();
  return frames;
}

async function step(frames: SteppedFrames, count: number, stepMs: number): Promise<void> {
  await act(async () => {
    frames.step(count, stepMs);
    await Promise.resolve();
  });
}

/** The value a reading's `dd` shows, by its label. */
function shown(label: string): string {
  const term = [...document.querySelectorAll('.oyl-hud dt')].find(
    (each) => each.textContent === label,
  );
  const value = term?.nextElementSibling;
  if (value === null || value === undefined) throw new Error(`no ${label} on the HUD`);
  return value.childNodes[0]?.textContent ?? '';
}

const button = (name: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll('.oyl-hud button')].find(
    (each) => each.textContent === name,
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`no HUD button ${name}`);
  return found;
};

/** Every source file under `src/demo/` that ships: not a test and not a test helper. */
function shippedDemoSources(): { readonly name: string; readonly text: string }[] {
  return readdirSync(DEMO)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .filter((name) => !name.endsWith('-testing.ts'))
    .map((name) => ({ name, text: readFileSync(join(DEMO, name), 'utf8') }));
}

describe('the demo’s stats overlay — #1650', () => {
  it('is the ride HUD’s own: the demo imports HudCore, and HudPanel renders HudCore', () => {
    const page = readFileSync(join(DEMO, 'DemoPage.tsx'), 'utf8');
    expect(page).toMatch(/^import \{ HudCore \} from '\.\.\/game\/hud\/HudCore';$/m);
    expect(page).toMatch(/<HudCore\b/);
    const panel = readFileSync(join(HUD, 'HudPanel.tsx'), 'utf8');
    expect(panel).toMatch(/^import \{ HudCore \} from '\.\/HudCore';$/m);
    expect(panel).toMatch(/<HudCore\b/);
  });

  it('draws no reading of its own: no HUD field label and no HUD field class in the demo’s source', () => {
    const player = createDemoPlayer(SPRINT_PRESET);
    const labels = hudReadings({
      state: player.state,
      profile: player.profile,
      cadence: player.sensors.cadence,
      heartRate: player.sensors.heartRate,
      movingSeconds: 0,
      units: 'metric',
    }).map((reading) => reading.label);
    expect(labels).toEqual(expect.arrayContaining(['Power', 'Cadence', 'Heart rate']));
    const copied: string[] = [];
    for (const { name, text } of shippedDemoSources()) {
      for (const label of labels) {
        // A label as a string literal or as JSX text.
        const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (new RegExp(`['"\`>]${escaped}['"\`<]`).test(text)) copied.push(`${name}: ${label}`);
      }
      if (/oyl-hud__(field|value|label|fields)/.test(text))
        copied.push(`${name}: a HUD field class`);
    }
    expect(copied).toEqual([]);
  });

  it('shows the scripted lead’s numbers: power, cadence and heart rate at 66 s of the sprint', async () => {
    const frames = await page('?preset=sprint');
    // The first frame notes the clock; each one after it rides 500 ms.
    await step(frames, 133, 500);
    const at = seconds(66);
    const lead = SPRINT_PRESET.riders[0];
    if (lead === undefined) throw new Error('the sprint has no rider');
    const script = scriptedSample(lead, at);
    expect(Number(shown('Power'))).toBe(Math.round(script.watts));
    expect(Number(shown('Power'))).toBeGreaterThan(700);
    expect(Number(shown('Cadence'))).toBe(Math.round(script.cadence));
    expect(Number(shown('Heart rate'))).toBe(Math.round(script.heartRate));
  });

  it('says, visibly, that the riders are scripted, and names every readings panel', async () => {
    await page('?preset=climb');
    const label = [...document.querySelectorAll('p')].find(
      (each) => each.textContent === DEMO_LABEL,
    );
    expect(label).toBeDefined();
    expect(label?.className).not.toContain('visually-hidden');
    // In the HUD's own tokens, the pair `contrast.a11y.test.ts` holds.
    expect(label?.getAttribute('style')).toContain('color: var(--oyl-color-hud-ink)');
    expect(label?.getAttribute('style')).toContain('background: var(--oyl-color-hud-surface)');
    const panels = [...document.querySelectorAll('.oyl-hud dl')].map((each) =>
      each.getAttribute('aria-label'),
    );
    expect(panels).toEqual([PANEL_NAMES.primary, PANEL_NAMES.secondary]);
  });

  it('pauses and stops through the HUD’s own controls, and __oylDemo says so', async () => {
    const frames = await page('?preset=group');
    await step(frames, 20, 100);
    expect(window.__oylDemo?.state).toBe('playing');
    await activateWithKeyboard(button('Pause'));
    expect(window.__oylDemo?.state).toBe('paused');
    await activateWithKeyboard(button('Play'));
    expect(window.__oylDemo?.state).toBe('playing');
    await step(frames, 5, 100);
    await activateWithKeyboard(button('Stop'));
    // Back on the lead's start line.
    expect(window.__oylDemo).toMatchObject({
      state: 'stopped',
      distance: GROUP_PRESET.riders[0]?.startMetres,
    });
  });

  it('has no pacer field: the demo has no pacer, so no dashed *Pacer* (owner, 2026-10-25)', async () => {
    const frames = await page('?preset=sprint');
    await step(frames, 20, 100);
    const labels = [...document.querySelectorAll('.oyl-hud dt')].map((each) => each.textContent);
    // The readings are there, so an empty list is not what passes this.
    expect(labels).toEqual(expect.arrayContaining(['Power', 'Cadence', 'Heart rate']));
    expect(labels).not.toContain('Pacer');
    expect(document.querySelector('.oyl-hud')?.textContent).not.toMatch(/pacer/i);
  });

  it('shows no trainer line, workout strip, standings or room report, and says nothing aloud', async () => {
    const frames = await page('?preset=group');
    await step(frames, 20, 100);
    expect(document.querySelector('.oyl-hud')).not.toBeNull();
    expect(document.querySelector('.oyl-hud__trainer')).toBeNull();
    expect(document.querySelector('.oyl-workout-graph')).toBeNull();
    expect(document.querySelector('.oyl-hud__standings')).toBeNull();
    expect(document.querySelector('.oyl-hud__report, .oyl-hud__room-row')).toBeNull();
    expect(document.querySelector('.oyl-hud__lock')).toBeNull();
    expect(document.querySelector('[data-oyl-announcer="hud"]')?.textContent).toBe('');
  });
});
