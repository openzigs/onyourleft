// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The list–detail layout's own decisions — #670: which panes are on screen at
 * which width, where focus goes when an item is chosen and when it is let go,
 * and that the breakpoint is the one `theme.css` declares.
 *
 * jsdom lays nothing out, so "side by side" is `browser/list-detail.browser.spec.ts`'s;
 * this file is the half that decides.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { mount, settle, type Mounted } from '../testing/mount';
import { answerTwoPanes } from '../testing/panes';

import { ListDetail, SELECTED_HEADING_ID } from './ListDetail';
import { routeById } from './routes';

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

function layout(selection: string | undefined, detailWithoutSelection = false): JSX.Element {
  return (
    <main>
      <ListDetail
        route={routeById('activities')}
        selection={selection}
        listLabel="Your rides"
        detailLabel="Ride summary"
        backLabel="All rides"
        detailWithoutSelection={detailWithoutSelection}
        list={
          <ul>
            {['a', 'b'].map((id) => (
              <li key={id}>
                <a href={`#/activities/selected/${id}`} data-oyl-select={id}>
                  Ride {id}
                </a>
              </li>
            ))}
          </ul>
        }
        detail={
          selection === undefined ? (
            <p>Choose a ride.</p>
          ) : (
            <h2 id={SELECTED_HEADING_ID} tabIndex={-1}>
              Ride {selection}
            </h2>
          )
        }
      />
    </main>
  );
}

function pane(name: 'list' | 'detail'): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-oyl-pane="${name}"]`);
  if (element === null) throw new Error(`no ${name} pane`);
  return element;
}

describe('one pane, below the breakpoint', () => {
  it('shows the list alone when nothing is chosen, and says nothing in an empty detail', async () => {
    restore = answerTwoPanes(false, THEME);
    mounted = await mount(layout(undefined));
    expect(pane('list').hidden).toBe(false);
    expect(pane('detail').hidden).toBe(true);
    expect(document.querySelector('[data-oyl-panes]')?.getAttribute('data-oyl-panes')).toBe('1');
  });

  it('keeps a detail that is more than "choose one" — a builder, an import', async () => {
    restore = answerTwoPanes(false, THEME);
    mounted = await mount(layout(undefined, true));
    expect(pane('list').hidden).toBe(false);
    expect(pane('detail').hidden).toBe(false);
  });

  it('replaces the list with the chosen item, and offers the way back', async () => {
    restore = answerTwoPanes(false, THEME);
    mounted = await mount(layout('a'));
    expect(pane('list').hidden).toBe(true);
    expect(pane('detail').hidden).toBe(false);
    const back = pane('detail').querySelector('a');
    expect(back?.textContent).toBe('All rides');
    expect(back?.getAttribute('href')).toBe('#/activities');
  });

  it('is what a window with no matchMedia gets', async () => {
    mounted = await mount(layout('a'));
    expect(pane('list').hidden).toBe(true);
  });
});

describe('two panes, at the breakpoint theme.css declares', () => {
  it('shows both, with no back link, and names each as its own region', async () => {
    restore = answerTwoPanes(true, THEME);
    mounted = await mount(layout('a'));
    expect(document.querySelector('[data-oyl-panes]')?.getAttribute('data-oyl-panes')).toBe('2');
    expect(document.querySelector('.oyl-list-detail--two')).not.toBeNull();
    expect(pane('list').hidden).toBe(false);
    expect(pane('detail').hidden).toBe(false);
    expect(pane('detail').textContent).not.toContain('All rides');
    expect(pane('list').tagName).toBe('SECTION');
    expect(
      document.getElementById(pane('list').getAttribute('aria-labelledby') ?? '')?.textContent,
    ).toBe('Your rides');
    expect(pane('detail').getAttribute('aria-label')).toBe('Ride summary');
  });

  it('shows the empty detail beside the list, where there is room for it', async () => {
    restore = answerTwoPanes(true, THEME);
    mounted = await mount(layout(undefined));
    expect(pane('detail').hidden).toBe(false);
  });

  it('is decided by the custom property, so a matchMedia answering any other query is one pane', async () => {
    // The stub answers ONLY `(min-width: <theme.css's value>)`. Without the
    // property there is no query to ask, and the layout is one pane.
    restore = answerTwoPanes(true, THEME);
    const declared = document.head.querySelector('style');
    declared?.remove();
    mounted = await mount(layout('a'));
    expect(pane('list').hidden).toBe(true);
  });

  it('moves focus to the detail pane from the skip link, without changing the route', async () => {
    restore = answerTwoPanes(true, THEME);
    globalThis.location.hash = '#/activities';
    mounted = await mount(layout(undefined));
    const skip = pane('list').querySelector<HTMLAnchorElement>('.oyl-pane-skip');
    expect(skip?.textContent).toBe('Skip to ride summary');
    skip?.focus();
    skip?.click();
    await settle();
    expect(document.activeElement).toBe(pane('detail'));
    expect(globalThis.location.hash).toBe('#/activities');
  });
});

describe('focus', () => {
  for (const wide of [false, true]) {
    const where = wide ? 'two panes' : 'one pane';

    it(`${where}: choosing an item moves focus to the detail pane's heading`, async () => {
      restore = answerTwoPanes(wide, THEME);
      mounted = await mount(layout(undefined));
      await mounted.rerender(layout('b'));
      await settle();
      expect(document.activeElement?.id).toBe(SELECTED_HEADING_ID);
      expect(document.activeElement?.textContent).toBe('Ride b');
    });

    it(`${where}: letting it go moves focus back to the item that was chosen`, async () => {
      restore = answerTwoPanes(wide, THEME);
      mounted = await mount(layout('b'));
      await mounted.rerender(layout(undefined));
      await settle();
      expect(document.activeElement?.getAttribute('data-oyl-select')).toBe('b');
    });
  }

  it('does not move focus on first render — a reload keeps what the browser chose', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    mounted = await mount(layout('a'));
    await settle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('waits for a heading that arrives after a read, rather than giving up', async () => {
    mounted = await mount(layout(undefined));
    // The selection changes; the detail is still being read.
    await mounted.rerender(
      <main>
        <ListDetail
          route={routeById('activities')}
          selection="a"
          listLabel="Your rides"
          detailLabel="Ride summary"
          backLabel="All rides"
          detailWithoutSelection={false}
          list={null}
          detail={<p>Reading this ride…</p>}
        />
      </main>,
    );
    expect(document.activeElement?.id).not.toBe(SELECTED_HEADING_ID);
    await mounted.rerender(layout('a'));
    await settle();
    expect(document.activeElement?.id).toBe(SELECTED_HEADING_ID);
  });
});
