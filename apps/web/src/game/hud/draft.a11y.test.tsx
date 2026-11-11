// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The draft on the HUD — #787, ADR 0038 D-5: rendered by the HUD the game
 * mounts and read back from its text. A share of aerodynamic drag beside the
 * draft's label and never a watt figure; absent on a ride with no room.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { accessibleName, auditAccessibility, formatViolations } from '../../a11y/audit';
import { AA_LARGE_TEXT_OR_NON_TEXT, AA_TEXT, contrastRatio } from '../../design/contrast';
import { CONTRAST_REQUIREMENTS, paletteColours, THEMES } from '../../design/tokens';
import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';
import { HudPanel } from './HudPanel';

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

async function hud(
  room:
    | {
        readonly nearby: number;
        readonly draft?: number | 'off';
        readonly draftShown?: boolean;
        readonly inDraft?: boolean;
      }
    | undefined,
  solo?: { readonly soloDraft: number; readonly soloInDraft: boolean },
): Promise<void> {
  const profile = route();
  mounted = await mount(
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={profile}
        state={atStartLine(profile)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement=""
        room={room}
        {...solo}
      />
    </main>,
  );
}

const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The field labelled `label`, as a screen reader hears it: its term, then its definition. */
function field(label: string): string | undefined {
  const found = [...document.querySelectorAll('.oyl-hud__field')].find(
    (each) => text(each.querySelector('dt')) === label,
  );
  return found === undefined
    ? undefined
    : `${text(found.querySelector('dt'))} ${text(found.querySelector('dd'))}`;
}

describe('the draft on the HUD — #787', () => {
  it('says the room’s draft as a share of drag, never beside a watt figure, and audits clean', async () => {
    await hud({ nearby: 1, draft: 34, draftShown: true });
    expect(field('Draft')).toBe('Draft 34 % of drag at most 59 %');
    expect(field('Draft')).not.toMatch(/\bW\b|watt/i);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('says Off in a room made with drafting off', async () => {
    await hud({ nearby: 1, draft: 'off', draftShown: true });
    expect(field('Draft')).toBe('Draft Off');
  });

  it('is not on the HUD at all on a ride with no room — absent, not "0 %"', async () => {
    await hud(undefined);
    expect(field('Draft')).toBeUndefined();
    expect(text(document.querySelector('.oyl-hud'))).not.toContain('% of drag');
  });

  it('is not on the HUD in a room unless the ride says the rider’s setting shows it — ADR 0038 D-5', async () => {
    await hud({ nearby: 1, draft: 34 });
    expect(field('Nearby')).toBeDefined();
    expect(field('Draft')).toBeUndefined();
    expect(document.querySelector('.oyl-hud__gauge')).toBeNull();
  });

  it('draws a gauge filled to the share of the full scale, with the full-scale end drawn, hidden from a screen reader — #327', async () => {
    await hud({ nearby: 1, draft: 34, draftShown: true });
    const gauges = document.querySelectorAll('.oyl-hud__gauge');
    expect(gauges).toHaveLength(1);
    const gauge = gauges[0];
    expect(gauge?.closest('.oyl-hud__field')?.querySelector('dt')?.textContent).toBe('Draft');
    expect(gauge?.getAttribute('aria-hidden')).toBe('true');
    const fill = Number(gauge?.querySelector('.oyl-hud__gauge-fill')?.getAttribute('width'));
    expect(fill).toBeCloseTo((34 / 59) * 100, 9);
    expect(gauge?.querySelector('.oyl-hud__gauge-scale')?.getAttribute('width')).toBe('100');
    const full = gauge?.querySelector('.oyl-hud__gauge-full');
    expect([full?.getAttribute('x1'), full?.getAttribute('x2')]).toEqual(['100', '100']);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('draws no gauge in a room with drafting off', async () => {
    await hud({ nearby: 1, draft: 'off', draftShown: true });
    expect(document.querySelector('.oyl-hud__gauge')).toBeNull();
  });
});

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

/** The Draft field's box. */
function draftBox(): Element | undefined {
  return [...document.querySelectorAll('.oyl-hud__field')].find(
    (each) => text(each.querySelector('dt')) === 'Draft',
  );
}

/** What differs between the two states, read off the rendered HUD. */
function drawnState(): { readonly mark: boolean; readonly line: string; readonly read: string } {
  const box = draftBox();
  const definition = box?.querySelector('dd');
  return {
    mark: box?.querySelector('dt svg.oyl-hud__shelter') != null,
    line: text(box?.querySelector('.oyl-hud__detail')),
    read: definition == null ? '' : accessibleName(definition),
  };
}

describe('the rider in the draft — #2426, the shelter mark and the words', () => {
  it('draws the shelter mark and says "In the draft" while in it, and the scale is still read', async () => {
    await hud({ nearby: 1, draft: 12, draftShown: true, inDraft: true });
    const box = draftBox();
    const mark = box?.querySelector('svg.oyl-hud__shelter');
    expect(mark, 'the mark is in the Draft field').not.toBeNull();
    expect(mark?.closest('dt'), 'beside the label, never on the number’s line').not.toBeNull();
    expect(mark?.getAttribute('aria-hidden')).toBe('true');
    expect(mark?.getAttribute('focusable')).toBe('false');
    // An arch over a closed, filled pocket.
    expect(mark?.querySelector('.oyl-hud__shelter-arch')).not.toBeNull();
    expect(mark?.querySelector('.oyl-hud__shelter-pocket')?.getAttribute('d')).toMatch(/Z$/);
    expect(box?.classList.contains('oyl-hud__field--sheltered')).toBe(true);
    expect(text(box?.querySelector('.oyl-hud__detail'))).toBe('In the draft');
    expect(field('Draft')).toBe('Draft 12 % of drag In the draft at most 59 %');
    // The text alternative: the definition's own name, the hidden mark left out.
    expect(drawnState().read).toBe('12 % of drag In the draft at most 59 %');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('draws no mark and no outline out of the draft, and the line is the scale again', async () => {
    await hud({ nearby: 1, draft: 4, draftShown: true, inDraft: false });
    expect(draftBox()?.querySelector('svg.oyl-hud__shelter')).toBeNull();
    expect(draftBox()?.classList.contains('oyl-hud__field--sheltered')).toBe(false);
    expect(field('Draft')).toBe('Draft 4 % of drag at most 59 %');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('never marks a room made with drafting off, or one with no frame yet', async () => {
    await hud({ nearby: 1, draft: 'off', draftShown: true, inDraft: true });
    expect(document.querySelector('.oyl-hud__shelter')).toBeNull();
    expect(field('Draft')).toBe('Draft Off');
    mounted?.unmount();
    await hud({ nearby: 1, draftShown: true, inDraft: true });
    expect(document.querySelector('.oyl-hud__shelter')).toBeNull();
  });

  it('marks a solo ride’s Draft field the same way, from the simulation’s state', async () => {
    await hud(undefined, { soloDraft: 22, soloInDraft: true });
    expect(draftBox()?.querySelector('svg.oyl-hud__shelter')).not.toBeNull();
    expect(field('Draft')).toBe('Draft 22 % In the draft at most 59 %');
    mounted?.unmount();
    await hud(undefined, { soloDraft: 22, soloInDraft: false });
    expect(draftBox()?.querySelector('svg.oyl-hud__shelter')).toBeNull();
    expect(field('Draft')).toBe('Draft 22 % at most 59 %');
  });

  // jsdom loads no theme.css, so the forced stylesheet below recolours nothing
  // the test can see: this is a DOM-difference test (the glyph and the words
  // are there in one state and not the other), not a rendering of a grey HUD.
  it('is not colour alone: with every colour forced to one, the two states still differ in shape and words — SC 1.4.1', async () => {
    const flat = document.createElement('style');
    flat.textContent =
      '* { color: #777 !important; fill: #777 !important; stroke: #777 !important; ' +
      'background: #777 !important; outline-color: #777 !important; }';
    document.head.append(flat);
    try {
      await hud({ nearby: 1, draft: 12, draftShown: true, inDraft: true });
      const into = drawnState();
      const mark = draftBox()?.querySelector('svg.oyl-hud__shelter');
      expect(mark == null ? '' : getComputedStyle(mark).getPropertyValue('fill')).toBe(
        getComputedStyle(document.body).getPropertyValue('fill'),
      );
      expect(formatViolations(auditAccessibility(document))).toBe('');
      mounted?.unmount();
      await hud({ nearby: 1, draft: 4, draftShown: true, inDraft: false });
      const out = drawnState();
      expect(formatViolations(auditAccessibility(document))).toBe('');
      expect([into.mark, out.mark]).toEqual([true, false]);
      expect([into.line, out.line]).toEqual(['In the draft', 'at most 59 %']);
      expect(into.read).toContain('In the draft');
      expect(out.read).not.toContain('In the draft');
    } finally {
      flat.remove();
    }
  });

  it('touches nothing outside the Draft field: the power field and every other element are the same in and out — no recoloured power', async () => {
    const outside = (): { readonly power: string; readonly rest: string } => {
      const copy = document.querySelector('.oyl-hud')?.cloneNode(true) as Element | undefined;
      const power = [...document.querySelectorAll('.oyl-hud__field')].find((each) =>
        text(each.querySelector('dt')).startsWith('Power'),
      );
      for (const each of copy?.querySelectorAll('.oyl-hud__field') ?? []) {
        if (text(each.querySelector('dt')) === 'Draft') each.remove();
      }
      return {
        power: power?.outerHTML ?? 'no power field',
        // The strips' ids are React's `useId`, new with each mount.
        rest: (copy?.outerHTML ?? '').replace(/oyl-(route|ahead)-[^-"]+-/g, 'oyl-$1-id-'),
      };
    };
    await hud({ nearby: 1, draft: 12, draftShown: true, inDraft: false });
    const before = outside();
    mounted?.unmount();
    await hud({ nearby: 1, draft: 12, draftShown: true, inDraft: true });
    const after = outside();
    expect(after.power).not.toBe('no power field');
    expect(after.power).toBe(before.power);
    expect(after.rest).toBe(before.rest);
    expect(document.querySelectorAll('.oyl-hud__shelter')).toHaveLength(1);
  });

  it('draws the mark in `hudShelter` (3:1) and the words in `hudInk` (4.5:1) on the HUD surface, measured from the tokens', () => {
    expect(declared('.oyl-hud__shelter-arch', 'stroke')).toEqual(['var(--oyl-color-hud-shelter)']);
    expect(declared('.oyl-hud__shelter-pocket', 'fill')).toEqual(['var(--oyl-color-hud-shelter)']);
    expect(declared('.oyl-hud__field--sheltered .oyl-hud__detail', 'color')).toEqual([
      'var(--oyl-color-hud-ink)',
    ]);
    expect(declared('.oyl-hud__field--sheltered', 'outline')).toEqual([
      '3px solid var(--oyl-color-hud-shelter)',
    ]);
    // Outside the box: an inset ring would be drawn over the field's content.
    // `hud.browser.spec.ts` measures the same thing in a real engine.
    expect(declared('.oyl-hud__field--sheltered', 'outline-offset')).toEqual(['0']);
    expect(declared('.oyl-hud__panel', 'background')).toEqual(['var(--oyl-color-hud-surface)']);
    for (const theme of THEMES) {
      const palette = paletteColours(theme);
      expect(contrastRatio(palette.hudShelter, palette.hudSurface)).toBeGreaterThanOrEqual(
        AA_LARGE_TEXT_OR_NON_TEXT,
      );
      expect(contrastRatio(palette.hudInk, palette.hudSurface)).toBeGreaterThanOrEqual(AA_TEXT);
    }
    const pair = CONTRAST_REQUIREMENTS.find(
      (each) => each.foreground === 'hudShelter' && each.background === 'hudSurface',
    );
    expect(pair?.minimum).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_NON_TEXT);
  });

  it('has no motion: no rule for the mark or its field declares a transition or an animation — ADR 0041 D-5', () => {
    for (const selector of [
      '.oyl-hud__shelter',
      '.oyl-hud__shelter-arch',
      '.oyl-hud__shelter-pocket',
      '.oyl-hud__field--sheltered',
      '.oyl-hud__field',
    ]) {
      for (const property of ['transition', 'transition-property', 'animation', 'animation-name']) {
        expect(declared(selector, property), `${selector} ${property}`).toEqual([]);
      }
    }
  });
});
