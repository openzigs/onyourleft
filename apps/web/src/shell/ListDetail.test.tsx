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

import { act, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { mount, settle, type Mounted } from '../testing/mount';
import { answerTwoPanes, rotatablePanes } from '../testing/panes';

import { CREATE_HEADING_ID, CreateLink, ListDetail, SELECTED_HEADING_ID } from './ListDetail';
import { matchHash, routeById } from './routes';

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

  it('gives the skip link this page’s own address, so a new tab opens this page rather than not-found', async () => {
    // #670's review (N5): it was `#<pane id>`, which the router reads as a
    // route — middle-click, or open in a new tab, was the not-found page.
    restore = answerTwoPanes(true, THEME);
    mounted = await mount(layout(undefined));
    const skip = pane('list').querySelector<HTMLAnchorElement>('.oyl-pane-skip');
    expect(skip?.getAttribute('href')).toBe('#/activities');
    expect(matchHash(skip?.getAttribute('href') ?? '').route.id).toBe('activities');
    await mounted.rerender(layout('b'));
    expect(skip?.getAttribute('href')).toBe('#/activities/selected/b');
    expect(matchHash(skip?.getAttribute('href') ?? '').route.id).toBe('activities');
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

/** #670's review (N4): a tablet turned upright with focus in the list. */
describe('rotating from two panes to one', () => {
  it('moves focus from a list link to the chosen item’s heading, not to <body>', async () => {
    const panes = rotatablePanes(true, THEME);
    restore = panes.restore;
    mounted = await mount(layout('a'));
    const link = pane('list').querySelector<HTMLElement>('[data-oyl-select="b"]');
    link?.focus();
    expect(document.activeElement).toBe(link);
    act(() => {
      panes.rotate(false);
    });
    await settle();
    expect(pane('list').hidden).toBe(true);
    expect(document.activeElement?.id).toBe(SELECTED_HEADING_ID);
    expect(document.activeElement?.textContent).toBe('Ride a');
  });

  it('leaves focus on the list when nothing is chosen, because the list stays', async () => {
    const panes = rotatablePanes(true, THEME);
    restore = panes.restore;
    mounted = await mount(layout(undefined));
    const link = pane('list').querySelector<HTMLElement>('[data-oyl-select="b"]');
    link?.focus();
    act(() => {
      panes.rotate(false);
    });
    await settle();
    expect(pane('list').hidden).toBe(false);
    expect(document.activeElement).toBe(link);
  });

  it('hands no focus to a rider who had focused nothing', async () => {
    const panes = rotatablePanes(true, THEME);
    restore = panes.restore;
    mounted = await mount(layout('a'));
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    act(() => {
      panes.rotate(false);
    });
    await settle();
    expect(document.activeElement).toBe(document.body);
  });

  it('leaves focus alone when it was outside the list, which is not hidden', async () => {
    const panes = rotatablePanes(true, THEME);
    restore = panes.restore;
    mounted = await mount(layout('a'));
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    act(() => {
      panes.rotate(false);
    });
    await settle();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});

/** #670's review (N1): the way from a chosen item to the form beside the list. */
describe('the create link', () => {
  function withForm(selection: string | undefined): JSX.Element {
    return (
      <main>
        <ListDetail
          route={routeById('routes')}
          selection={selection}
          listLabel="Saved routes"
          detailLabel="Route"
          backLabel="All routes"
          detailWithoutSelection
          list={
            <>
              <p>
                <CreateLink route={routeById('routes')} selection={selection}>
                  Import a route
                </CreateLink>
              </p>
              <a href="#/routes/selected/a" data-oyl-select="a">
                Route a
              </a>
            </>
          }
          detail={
            selection === undefined ? (
              <h2 id={CREATE_HEADING_ID} tabIndex={-1}>
                Import a route
              </h2>
            ) : (
              <h2 id={SELECTED_HEADING_ID} tabIndex={-1}>
                Route {selection}
              </h2>
            )
          }
        />
      </main>
    );
  }

  it('is the primary with an item chosen, and leads to the list’s own address', async () => {
    restore = answerTwoPanes(true, THEME);
    mounted = await mount(withForm('a'));
    const link = pane('list').querySelector('[data-oyl-create]');
    expect(link?.className).toBe('oyl-button');
    expect(link?.getAttribute('href')).toBe('#/routes');
  });

  it('moves focus to the form’s heading when it lets the selection go, not to the item', async () => {
    restore = answerTwoPanes(true, THEME);
    mounted = await mount(withForm('a'));
    const link = pane('list').querySelector<HTMLAnchorElement>('[data-oyl-create]');
    link?.click();
    // What the shell does on the hashchange the link causes.
    await mounted.rerender(withForm(undefined));
    await settle();
    expect(document.activeElement?.id).toBe(CREATE_HEADING_ID);
  });

  it('is secondary with nothing chosen, and moves focus to the form without routing', async () => {
    restore = answerTwoPanes(false, THEME);
    globalThis.location.hash = '#/routes';
    mounted = await mount(withForm(undefined));
    const link = pane('list').querySelector<HTMLAnchorElement>('[data-oyl-create]');
    expect(link?.className).toBe('oyl-button oyl-button--secondary');
    link?.click();
    await settle();
    expect(document.activeElement?.id).toBe(CREATE_HEADING_ID);
    expect(globalThis.location.hash).toBe('#/routes');
  });

  it('does not steer a later back to the list away from the item', async () => {
    // The note a create link leaves is spent by the next change of selection.
    restore = answerTwoPanes(true, THEME);
    mounted = await mount(withForm(undefined));
    pane('list').querySelector<HTMLAnchorElement>('[data-oyl-create]')?.click();
    await mounted.rerender(withForm('a'));
    await settle();
    await mounted.rerender(withForm(undefined));
    await settle();
    expect(document.activeElement?.getAttribute('data-oyl-select')).toBe('a');
  });
});
