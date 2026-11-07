// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The built-in workouts' list and filters, audited — #2304.
 *
 * - **Audited** at one pane and at two, on arrival, filtered, with nothing
 *   matching and with a built-in chosen (`a11y/audit.ts`'s rules).
 * - **Every card's shape is text**: the sentence `library.ts` writes is in the
 *   card, and the drawing beside it is `aria-hidden` and empty of text.
 * - **Every filter is a labelled control** in a named form, and its target is
 *   the 48 px the issue asks for: declared in `theme.css` §"THE BUILT-IN
 *   WORKOUTS' FILTERS" over exactly these controls. The laid-out box is
 *   `browser/built-ins.browser.spec.ts`'s, which jsdom cannot measure.
 * - **Contrast in both palettes**: no colour is new here — the text is the
 *   page's ink and `oyl-muted`, both declared pairs `contrast.a11y.test.ts`
 *   holds in each palette, and the cards' zone colours are the block chart's,
 *   which `zones.a11y.test.tsx` holds and `zones.browser.spec.ts` reads painted
 *   on a built-in card in both.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { athleteId } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import { mount, queryAll, settle, type Mounted } from '../testing/mount';
import { answerTwoPanes } from '../testing/panes';
import { BUILT_IN_CARDS, builtInFilterQuery } from '../workouts/built-in';
import { workoutStub } from '../workouts/testing';
import { WorkoutsView } from './WorkoutsView';

// `join` rather than `new URL(…, import.meta.url)`, which Vite rewrites into an asset URL.
const THEME = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../design/theme.css'),
  'utf8',
);

let mounted: Mounted | undefined;
let restore: (() => void) | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  restore?.();
  restore = undefined;
});

async function screen(options: { readonly query?: string; readonly selected?: string } = {}) {
  mounted = await mount(
    <main>
      <h1>Workouts</h1>
      <WorkoutsView
        port={workoutStub(athleteId('athlete-a'))}
        query={options.query}
        selected={options.selected}
      />
    </main>,
  );
  await settle();
}

function builtIns(): HTMLElement {
  const section = document.querySelector<HTMLElement>('[data-oyl-built-ins]');
  if (section === null) throw new Error('no built-in workouts on this screen');
  return section;
}

const audit = (): string => formatViolations(auditAccessibility(document));

describe('the built-in workouts pass the audit — #2304', () => {
  for (const wide of [false, true]) {
    describe(wide ? 'at two panes' : 'at one pane', () => {
      it.each([
        ['on arrival', {}],
        ['filtered', { query: builtInFilterQuery({ category: 'tempo', length: 60 }) }],
        [
          'with nothing matching',
          { query: builtInFilterQuery({ category: 'recovery', length: 90 }) },
        ],
        ['with a built-in chosen', { selected: 'built-in:tempo-2x20', query: 'category=tempo' }],
      ])('%s', async (_, options) => {
        restore = answerTwoPanes(wide, THEME);
        await screen(options);
        expect(audit()).toBe('');
      });
    });
  }
});

describe('every card’s shape is readable as text — #2304', () => {
  it('carries the shape sentence, with the drawing hidden and silent', async () => {
    await screen();
    const cards = queryAll(builtIns(), '[data-oyl-built-in]');
    expect(cards).toHaveLength(BUILT_IN_CARDS.length);
    for (const [index, card] of cards.entries()) {
      const expected = BUILT_IN_CARDS[index];
      expect(card.textContent).toContain(expected?.shape);
      const drawings = queryAll(card, 'svg');
      expect(drawings).toHaveLength(1);
      expect(drawings[0]?.getAttribute('aria-hidden')).toBe('true');
      expect(drawings[0]?.textContent).toBe('');
      // One control a card: its name, which opens it.
      expect(queryAll(card, 'a, button, input, select')).toHaveLength(1);
    }
  });

  it('names the zones the cards paint once, by number and name, outside the cards', async () => {
    await screen();
    const keys = queryAll(builtIns(), '[data-oyl-zone-key]');
    expect(keys).toHaveLength(1);
    expect(keys[0]?.closest('[data-oyl-built-in]')).toBeNull();
    for (const entry of queryAll(keys[0] as HTMLElement, '[data-oyl-zone]')) {
      expect(entry.textContent?.trim()).toMatch(/^\d [A-Z]/);
    }
  });
});

describe('every filter is a labelled 48 px control — #2304', () => {
  it('is in a named form, each select with its own label and the checkbox inside its own', async () => {
    await screen();
    const form = builtIns().querySelector('form');
    expect(form?.getAttribute('aria-label')).toBe('Filter the built-in workouts');
    const selects = queryAll<HTMLSelectElement>(form as HTMLElement, 'select');
    expect(
      selects.map(
        (each) => document.querySelector(`label[for="${CSS.escape(each.id)}"]`)?.textContent,
      ),
    ).toEqual(['Category', 'Length']);
    const box = (form as HTMLElement).querySelector('input[type="checkbox"]');
    expect(box?.closest('label')?.textContent).toBe('Has a heart-rate target');
    // Nothing in the form but those three.
    expect(queryAll(form as HTMLElement, 'input, select, button, a')).toHaveLength(3);
  });

  it('declares 48 px on exactly those controls, as the rows that take the press', () => {
    const at = THEME.indexOf('.oyl-filters select,');
    expect(at, 'theme.css has no rule for the filters').toBeGreaterThan(-1);
    const rule = THEME.slice(at, THEME.indexOf('}', at) + 1);
    expect(rule).toBe(
      ".oyl-filters select,\n.oyl-filters label:has(> input[type='checkbox']) {\n  min-height: 3rem;\n}",
    );
  });
});
