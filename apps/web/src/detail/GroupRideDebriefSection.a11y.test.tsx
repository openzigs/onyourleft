// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The ride page's group ride debrief, audited where it sits** — #3310.
 *
 * The whole page is rendered with a group ride in each state the section
 * draws, and audited: the section is an `h3` under the ride's `h2`, beside
 * the page's other `h3` sections, and its figures are a definition list —
 * each figure's `dt` is its header cell.
 *
 * Large text: the list is the page's own `.oyl-ride-summary` grid, whose
 * columns are `rem` wide and fill the row (`auto-fit`), so at a larger text
 * size a figure wraps to the next row and never forces a sideways scroll.
 * What is held here is that the section draws in that grid and that the grid
 * sets no size in pixels.
 *
 * ⚠️ What it cannot see: jsdom lays nothing out, so the reflow itself is not
 * measured here. The page's figures in that grid are laid out at 320 px wide
 * by `browser/list-detail.browser.spec.ts`.
 *
 * ⚠️ Named `*.a11y.test.tsx` because that is what `test:a11y` selects on
 * (#142).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { activityId, athleteId, type GroupRideFact } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { mount, settle, type Mounted } from '../testing/mount';
import { ActivityDetailView } from '../views/ActivityDetailView';

import { GROUP_RIDE_DEBRIEF_WORDS } from './GroupRideDebriefSection';
import { GROUP_RIDE_WAITED, GROUP_RIDE_WAITED_RIDE, stubActivity, stubDetail } from './testing';

const ATHLETE = athleteId('athlete-a');
const RIDE = activityId('ride-1');
const THEME = join(dirname(fileURLToPath(import.meta.url)), '..', 'design', 'theme.css');

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function openWith(groupRide: GroupRideFact): Promise<Element> {
  document.documentElement.lang = 'en';
  mounted = await mount(
    <main>
      <h1>Ride details</h1>
      <ActivityDetailView
        port={stubDetail(ATHLETE, {
          activity: stubActivity({
            ...GROUP_RIDE_WAITED_RIDE,
            rideFacts: { drafted: true, groupRide },
          }),
          channels: {},
          laps: [],
        })}
        activityId={RIDE}
      />
    </main>,
  );
  await settle();
  await settle();
  const section = document.querySelector('[data-oyl-group-debrief]');
  if (section === null) throw new Error('the debrief was not drawn');
  return section;
}

function expectClean(where: string): void {
  const violations = auditAccessibility(document);
  expect(violations.length === 0 ? '' : `${where}\n${formatViolations(violations)}`).toBe('');
}

describe('the group ride debrief passes the audit — #3310', () => {
  it('with a whole log: a heading, and a list whose every figure has its header', async () => {
    const section = await openWith(GROUP_RIDE_WAITED);
    expectClean('a group ride with a whole log');
    const heading = section.querySelector('h3');
    expect(heading?.textContent).toBe(GROUP_RIDE_DEBRIEF_WORDS.heading);
    const rows = [...section.querySelectorAll('dl > div')];
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const row of rows) {
      expect(row.querySelector('dt')?.textContent ?? '').not.toBe('');
      expect(row.querySelector('dd')?.textContent ?? '').not.toBe('');
    }
  });

  it('with a log cut short, and its one line', async () => {
    const section = await openWith({ ...GROUP_RIDE_WAITED, logCut: true });
    expectClean('a group ride whose log was cut short');
    expect(section.textContent).toContain(GROUP_RIDE_DEBRIEF_WORDS.logCut);
  });

  it('with no pull: no average pull row, and still clean', async () => {
    const section = await openWith({
      ...GROUP_RIDE_WAITED,
      log: [{ at: 0, phase: 'steady', role: 'in-line', groupSpeed: 8 }],
    });
    expectClean('a group ride with no pull');
    expect(section.textContent).not.toContain(GROUP_RIDE_DEBRIEF_WORDS.averagePull);
  });

  it('adds nothing to the tab order: a debrief is read, not operated', async () => {
    const section = await openWith(GROUP_RIDE_WAITED);
    expect(tabbableElements(document).filter((element) => section.contains(element))).toEqual([]);
  });

  it('draws in the page’s figure grid, which sets no size in pixels (large text)', async () => {
    const section = await openWith(GROUP_RIDE_WAITED);
    expect(section.querySelector('dl')?.classList.contains('oyl-ride-summary')).toBe(true);
    const css = readFileSync(THEME, 'utf8');
    const rules = [...css.matchAll(/\.oyl-ride-summary[^{,]*\{([^}]*)\}/g)].map((rule) => rule[1]);
    expect(rules.length).toBeGreaterThan(0);
    for (const body of rules) expect(body, body).not.toMatch(/\d\s*px\b/);
    // The columns fill the row and wrap: a figure moves down, never off to the side.
    expect(css).toMatch(
      /\.oyl-ride-summary\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\([\d.]+rem/,
    );
  });
});
