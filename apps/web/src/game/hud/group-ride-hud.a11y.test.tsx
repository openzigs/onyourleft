// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A group ride on the HUD — #3305 (ADR 0101 D-5): the role strip and the cue
 * line, rendered by the HUD the game mounts and read back the way a screen
 * reader reads them. The strip is two readings in the HUD's description list,
 * each its term then its definition; the cue line is one labelled notice; and
 * **the HUD keeps exactly one live region**, which is the announcer's.
 * Audited at each state and at each HUD text size.
 *
 * ⚠️ What it cannot see: jsdom lays nothing out. Whether the strip and the
 * line fit at large text on a tablet-shaped viewport is measured in the
 * pinned Chromium, `browser/lap-race-hud.browser.spec.ts` §"#3305"; what is
 * held here is that the large sizes change no role, no name and no word.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  CUE_KINDS,
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../../a11y/audit';
import { AA_TEXT, contrastRatio } from '../../design/contrast';
import { paletteColours, THEMES } from '../../design/tokens';
import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';

import { GROUP_RIDE_CUE_TEXT, type GroupRideHud } from './group-ride-hud';
import { GROUP_RIDE_CUE_CLASS, groupCueNotice } from './GroupRideCue';
import { DEFAULT_HUD_LAYOUT, HUD_TEXT_SIZES, type HudTextSize } from './hud-layout-preference';
import { HudPanel } from './HudPanel';

const themeCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design', 'theme.css'),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** Each value `property` is declared with in the rules whose selector list names `selector`. */
function declared(selector: string, property: string): (string | undefined)[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const values: (string | undefined)[] = [];
  for (const match of themeCss.matchAll(new RegExp(`${escaped}(?=\\s*[,{])`, 'g'))) {
    const opened = themeCss.indexOf('{', match.index);
    const closed = themeCss.indexOf('}', opened);
    const block = themeCss.slice(opened + 1, closed);
    for (const found of block.matchAll(new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+);`, 'g'))) {
      values.push(found[1]?.trim());
    }
  }
  return values;
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

const PROFILE = route();

const ON_A_WHEEL: GroupRideHud = {
  place: 3,
  of: 6,
  gapMetres: 1.2,
  pullLeftSeconds: undefined,
  groupSpeed: 31 / 3.6,
  targetSpeed: 30 / 3.6,
  live: true,
};
const ON_THE_FRONT: GroupRideHud = {
  ...ON_A_WHEEL,
  place: 1,
  gapMetres: undefined,
  pullLeftSeconds: 24,
};
const NO_POWER: GroupRideHud = { ...ON_A_WHEEL, live: false };

function panel(
  strip: GroupRideHud,
  cue: string | undefined,
  textSize: HudTextSize = 'normal',
  announcement = '',
): JSX.Element {
  return (
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={PROFILE}
        state={atStartLine(PROFILE)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement={announcement}
        layout={{ ...DEFAULT_HUD_LAYOUT, textSize }}
        groupRide={strip}
        notices={[groupCueNotice(cue)]}
      />
    </main>
  );
}

const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The reading labelled `label`: its element in the HUD's description list. */
function reading(label: string): Element | undefined {
  return [...document.querySelectorAll('.oyl-hud__field')].find(
    (each) => text(each.querySelector('dt')) === label,
  );
}

/** The reading as a screen reader hears it: its term, then its definition. */
function heard(label: string): string {
  const found = reading(label);
  return `${text(found?.querySelector('dt'))} ${text(found?.querySelector('dd'))}`;
}

describe('the role strip, as a screen reader reads it — #3305', () => {
  it('is two readings in the HUD’s description list, each a term and its definition', async () => {
    mounted = await mount(panel(ON_A_WHEEL, undefined));
    for (const label of ['In line', 'Group']) {
      const found = reading(label);
      expect(found, label).toBeDefined();
      expect(found?.closest('dl'), label).not.toBeNull();
      expect(found?.querySelectorAll('dt'), label).toHaveLength(1);
      expect(found?.querySelectorAll('dd'), label).toHaveLength(1);
    }
    expect(heard('In line')).toBe('In line 3 of 6 Gap 1.2 m');
    expect(heard('Group')).toBe('Group 31 km/h Target average 30');
    // The strip is not live: the countdown and the gap never interrupt.
    for (const label of ['In line', 'Group']) {
      expect(reading(label)?.closest('[role="status"], [aria-live]')).toBeNull();
    }
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('reads the pull’s countdown inside the place’s own definition, on the front', async () => {
    mounted = await mount(panel(ON_THE_FRONT, undefined));
    expect(heard('In line')).toBe('In line 1 of 6 Pull 24 s');
    expect(reading('In line')?.closest('[role="status"], [aria-live]')).toBeNull();
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('says the sensor is lost in words, beside the dash, with no power reading', async () => {
    mounted = await mount(panel(NO_POWER, undefined));
    expect(heard('In line')).toBe('In line — of 6 Sensor lost');
    expect(heard('Group')).toBe('Group — km/h Target average 30 Sensor lost');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});

describe('the cue line, as a screen reader reads it — #3305', () => {
  it.each(CUE_KINDS)(
    '%s: one labelled notice, not live, and the HUD audits clean',
    async (kind) => {
      mounted = await mount(panel(ON_A_WHEEL, GROUP_RIDE_CUE_TEXT[kind]));
      const line = document.querySelector(`.${GROUP_RIDE_CUE_CLASS}`);
      // Its label is text, so the notice names itself without a tint or a glyph.
      expect(text(line?.querySelector('.oyl-status__label'))).toBe('Group ride:');
      expect(text(line)).toContain(`Group ride: ${GROUP_RIDE_CUE_TEXT[kind]}`);
      expect(line?.querySelector('.oyl-status__glyph')?.getAttribute('aria-hidden')).toBe('true');
      expect(line?.closest('[role="status"], [aria-live]')).toBeNull();
      // The HUD's one live region is the announcer's, with the line on it.
      const live = document.querySelectorAll('[role="status"], [aria-live]');
      expect(live).toHaveLength(1);
      expect(live[0]?.getAttribute('data-oyl-announcer')).toBe('hud');
      expect(formatViolations(auditAccessibility(document))).toBe('');
    },
  );

  it('is said by the announcer’s region and by nothing else', async () => {
    const sentence = GROUP_RIDE_CUE_TEXT['pull-off'];
    mounted = await mount(panel(ON_THE_FRONT, sentence, 'normal', sentence));
    const region = document.querySelector('[data-oyl-announcer="hud"]');
    expect(region?.getAttribute('role')).toBe('status');
    expect(text(region)).toBe(sentence);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});

describe('at each HUD text size, the tablet’s large sizes included — #3305', () => {
  it.each(HUD_TEXT_SIZES)(
    '%s text: the same roles, names and words, and a clean audit',
    async (size) => {
      const longest = [...CUE_KINDS]
        .map((kind) => GROUP_RIDE_CUE_TEXT[kind])
        .sort((a, b) => b.length - a.length)[0] as string;
      mounted = await mount(panel(ON_THE_FRONT, longest, size));
      expect(document.querySelector('[data-oyl-hud-text]')?.getAttribute('data-oyl-hud-text')).toBe(
        size,
      );
      expect(heard('In line')).toBe('In line 1 of 6 Pull 24 s');
      expect(heard('Group')).toBe('Group 31 km/h Target average 30');
      expect(text(document.querySelector(`.${GROUP_RIDE_CUE_CLASS}`))).toContain(longest);
      expect(document.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
      expect(formatViolations(auditAccessibility(document))).toBe('');
    },
  );
});

describe('the colours are the tokens’ declared pairs — #3305', () => {
  it('the strip is the HUD’s ink on its surface and the line an information notice’s pair, AA in every theme', () => {
    // No colour of the group ride's own: the fields are HUD fields, and the
    // line is the information tone's pair, drawn larger as the pacer's is.
    expect(themeCss).not.toMatch(/group-ride[^{]*\{[^}]*\bcolor:/);
    expect(declared('.oyl-hud__notices .oyl-status.oyl-hud__pacer-say', 'color')).toEqual([]);
    expect(declared('.oyl-hud__notices .oyl-status.oyl-hud__pacer-say', 'background')).toEqual([]);
    expect(declared('.oyl-hud__panel', 'background')).toEqual(['var(--oyl-color-hud-surface)']);
    for (const theme of THEMES) {
      const palette = paletteColours(theme);
      expect(contrastRatio(palette.hudInk, palette.hudSurface), theme).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
      expect(contrastRatio(palette.infoInk, palette.infoSurface), theme).toBeGreaterThanOrEqual(
        AA_TEXT,
      );
    }
  });

  it('the line is drawn under the information tone, whose pair that is', async () => {
    mounted = await mount(panel(ON_A_WHEEL, GROUP_RIDE_CUE_TEXT['next-up']));
    const line = document.querySelector(`.${GROUP_RIDE_CUE_CLASS}`);
    expect(line?.classList.contains('oyl-status--info')).toBe(true);
  });
});
