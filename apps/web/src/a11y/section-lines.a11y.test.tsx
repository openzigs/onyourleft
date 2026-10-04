// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * One short line per section, on every route — #1013.
 *
 * Every route in the table is opened in the real shell over both of
 * `testing/populated-shell.tsx`'s fixtures (and, on a list–detail route, with
 * the fixture's item selected), with a store behind the Files screen, and every
 * section on it is held to `a11y/section-lines.ts`: at most one drawn
 * paragraph of explanation, of at most `SECTION_LINE_CHARACTERS` characters.
 * The rest is behind the section's ⓘ (`design/SectionHelp.tsx`), which since
 * #1031 is the one place: the "More about" disclosure is gone.
 *
 * ## The two lists, and why each fails when it goes stale
 *
 * {@link DOCUMENTS} names the routes that ARE explanation — About is a page a
 * rider opens to read — and {@link READINGS} the sections whose paragraphs are
 * the rider's own data or this device's state rather than an explanation of a
 * control. Each entry carries its reason, and an entry the walk never needs is
 * a failure: an exemption that stopped exempting anything is a false statement
 * left lying in the tree.
 *
 * ## The control
 *
 * The rule's own cases at the foot of this file: two paragraphs fail, one long
 * one fails, and the same words behind a closed disclosure, in a status
 * message, an empty state or kept-visible text pass. Without them a walk that
 * found no sections at all would report every route clean — so the walk also
 * requires that it found sections, and that at least one of them has an ⓘ.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { StoreHarness } from '@onyourleft/store/testing';

import { ALL_ROUTES, type RouteDefinition, type RouteId } from '../shell/routes';
import { openRoute, selectFixtureItem } from '../testing/hierarchy-walk';
import type { Mounted } from '../testing/mount';
import { emptyTransferPort } from '../testing/transfer-port';

import {
  SECTION_LINE_CHARACTERS,
  sectionLineFaults,
  sectionProse,
  type SectionProse,
} from './section-lines';

/** Routes that are a document to read, where every section is explanation. */
const DOCUMENTS: Partial<Record<RouteId, string>> = {
  about:
    'About is the explanation a rider opens on purpose — what the app is, its licence, where data lives — and nothing on it is a control a line could stand beside',
  credits:
    'Credits is the attribution a licence asks for and the notices that go with it: every paragraph on it is the obligation itself, and none explains a control',
};

/**
 * Sections whose paragraphs are a reading — the rider's data or this device's
 * state — and not an explanation, keyed `"<route id> <heading>"`.
 */
const READINGS: Record<string, string> = {
  'activity-detail Side camera':
    'the side camera’s saved report: its summary sentence is the report’s own, stored with it (#388) and worded by ADR 0030’s rules, not an explanation of a control',
  'segment-detail The long drag up past the reservoir, the farm and the old quarry':
    'a segment’s own facts (its length, its efforts, what it is ranked by) and the one line that says what to do with them',
  'home Streaks and badges':
    'the rider’s own streak, read back from their rides, and how many of their older rides are still to be looked at — their data and this device’s state, not an explanation of a control (#947)',
  'route-builder Distance, climbing and surface':
    'the route being drawn, read back: its distance, its surfaces and its profile, each a reading of the draft',
};

let mounted: Mounted | undefined;
/** How many section ⓘ the walk met, so a walk over sections with none fails. */
let helpsMet = 0;
let harness: StoreHarness | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await harness?.destroy();
  harness = undefined;
  globalThis.location.hash = '';
});

async function sectionsOf(route: RouteDefinition, populated: boolean): Promise<SectionProse[]> {
  const transfer = await emptyTransferPort();
  harness = transfer.harness;
  mounted = await openRoute(route, populated, undefined, { transfer: transfer.port });
  const main = document.querySelector('main');
  if (main === null) throw new Error('the shell rendered no main');
  const sections = sectionProse(main);
  helpsMet += main.querySelectorAll('.oyl-section-help').length;
  if (populated && (await selectFixtureItem(route))) {
    sections.push(...sectionProse(main));
  }
  mounted.unmount();
  mounted = undefined;
  await harness.destroy();
  harness = undefined;
  return sections;
}

describe('#1013 — every section keeps at most one short line', () => {
  it('holds on every route, over both fixtures', async () => {
    const faults: string[] = [];
    const readingsUsed = new Set<string>();
    let sectionCount = 0;
    for (const populated of [false, true]) {
      for (const route of ALL_ROUTES) {
        const sections = await sectionsOf(route, populated);
        sectionCount += sections.length;
        if (DOCUMENTS[route.id] !== undefined) continue;
        for (const section of sections) {
          const key = `${route.id} ${section.heading}`;
          if (READINGS[key] !== undefined) {
            readingsUsed.add(key);
            continue;
          }
          for (const fault of sectionLineFaults(section)) {
            faults.push(`${route.id} (${populated ? 'populated' : 'empty'}): ${fault}`);
          }
        }
      }
    }
    expect(sectionCount, 'the walk found no sections at all').toBeGreaterThan(40);
    expect(helpsMet, 'the walk met no section ⓘ').toBeGreaterThan(10);
    expect([...new Set(faults)]).toEqual([]);
    expect(
      Object.keys(READINGS).filter((key) => !readingsUsed.has(key)),
      'READINGS entries the walk never needed',
    ).toEqual([]);
    expect(
      Object.keys(DOCUMENTS).filter((id) => !ALL_ROUTES.some((route) => route.id === id)),
      'DOCUMENTS entries naming no route',
    ).toEqual([]);
  }, 120_000);
});

describe('the rule itself — its control', () => {
  function sectionsFrom(html: string): SectionProse[] {
    const root = document.createElement('main');
    root.innerHTML = html;
    document.body.append(root);
    try {
      return sectionProse(root);
    } finally {
      root.remove();
    }
  }
  const LONG = 'A sentence long enough to be more than one line. '.repeat(3).trim();

  it('passes one short line, and fails two paragraphs or one long one', () => {
    const [one, two, long] = sectionsFrom(
      `<h2>One</h2><p>One short line.</p>
       <h2>Two</h2><p>One short line.</p><p>And another.</p>
       <h2>Long</h2><p>${LONG}</p>`,
    );
    expect(LONG.length).toBeGreaterThan(SECTION_LINE_CHARACTERS);
    expect(sectionLineFaults(one ?? { heading: '', paragraphs: [] })).toEqual([]);
    expect(sectionLineFaults(two ?? { heading: '', paragraphs: [] })).toHaveLength(1);
    expect(sectionLineFaults(long ?? { heading: '', paragraphs: [] })).toHaveLength(1);
  });

  it('does not count what the ruling keeps on the screen, or what is behind a closed ⓘ', () => {
    const [section] = sectionsFrom(
      `<h3>Kept</h3><p>One short line.</p>
       <details class="oyl-section-help"><summary><span class="oyl-visually-hidden">Help with Kept</span></summary><div class="oyl-section-help__panel"><p>${LONG}</p></div></details>
       <details><summary>Any closed disclosure</summary><p>${LONG}</p></details>
       <div data-oyl-kept-visible=""><p>${LONG}</p></div>
       <p class="oyl-status">${LONG}</p>
       <div role="alert"><p>${LONG}</p></div>
       <div data-oyl-empty-state="road"><p>${LONG}</p></div>
       <label><p>${LONG}</p></label>
       <ul><li><p>${LONG}</p></li></ul>`,
    );
    expect(section?.paragraphs).toEqual(['One short line.']);
  });

  it('counts an OPEN disclosure’s paragraphs, and not a hidden one’s', () => {
    const [open, hidden] = sectionsFrom(
      `<h3>Open</h3><p>One.</p><details open><summary>s</summary><p>Two.</p></details>
       <h3>Hidden</h3><p>One.</p><div hidden><p>Two.</p></div>`,
    );
    expect(open?.paragraphs).toEqual(['One.', 'Two.']);
    expect(hidden?.paragraphs).toEqual(['One.']);
  });

  it('reads prose written straight into a div, and not a div that only wraps — #1023', () => {
    const [section] = sectionsFrom(
      `<h3>Div</h3><div>Prose written straight into a div.</div>
       <div><p>One paragraph inside a wrapper.</p></div>`,
    );
    expect(section?.paragraphs).toEqual([
      'Prose written straight into a div.',
      'One paragraph inside a wrapper.',
    ]);
  });

  it('counts a paragraph ending in a link, and not a row of links — #1023', () => {
    const [section] = sectionsFrom(
      `<h3>Links</h3><p>Rides on this device, newest first</p>
       <p>Read how it works on the <a href="#/about">About screen</a> </p>
       <p><a href="#/a">Your rides</a> · <a href="#/b">Import or export files</a></p>`,
    );
    expect(section?.paragraphs).toEqual(['Read how it works on the About screen']);
  });

  it('leaves out a field’s hint, and nothing else a paragraph describes — #1023', () => {
    const [section] = sectionsFrom(
      `<h3>Field</h3><p>One short line.</p>
       <p><label for="f">Weight</label> <input id="f" aria-describedby="f-hint"></p>
       <p id="f-hint">Leave it blank to go back to the assumed weight.</p>
       <button aria-describedby="b-hint">Save</button>
       <p id="b-hint">A button’s description is still prose.</p>`,
    );
    expect(section?.paragraphs).toEqual([
      'One short line.',
      'A button’s description is still prose.',
    ]);
  });

  it('leaves the line under the screen’s title to #993, and starts a section at h2, h3 or h4', () => {
    const sections = sectionsFrom(
      `<h1>Screen</h1><p>${LONG}</p><h4>Four</h4><p>One.</p><h5>Five</h5><p>Two.</p>`,
    );
    expect(sections.map((section) => section.heading)).toEqual(['Four']);
    expect(sections[0]?.paragraphs).toEqual(['One.', 'Two.']);
  });
});
