// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2600: which panel a tap tucks away (`panel-tabs.ts` §`panelTapped`), and
 * where an open panel's keyboard control is drawn while focused
 * (§`tuckPlace`). Boxes as a 1024×768 stage lays them out, in CSS pixels; the
 * browser gate measures the real ones (`ride-chrome.browser.spec.ts`).
 */

import { afterEach, describe, expect, it } from 'vitest';

import { panelTapped, tuckPlace, type TabBox } from './panel-tabs';

afterEach(() => {
  document.body.replaceChildren();
});

/** A HUD as the stage draws one: panels under their own classes, a control in two. */
function hud(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'oyl-hud';
  section.innerHTML = `
    <dl class="oyl-hud__panel oyl-hud__fields--primary"><dt>Power</dt><dd id="power">212 W</dd></dl>
    <div class="oyl-hud__panel oyl-hud__route"><svg id="strip"></svg></div>
    <div class="oyl-hud__panel oyl-hud__standings">
      <button type="button" id="swap">Laps</button>
      <ol><li id="line">1 You</li></ol>
    </div>
    <div class="oyl-hud__panel oyl-hud__actions">
      <p class="oyl-hud__trainer" id="trainer">Trainer 3%</p>
      <div class="oyl-hud__controls"><button type="button" id="pause">Pause</button></div>
    </div>`;
  document.body.append(section);
  return section;
}

const at = (id: string): Element | null => document.getElementById(id);
const open = ['primary', 'route', 'standings', 'trainer'] as const;

describe('a tap on a panel tucks it away — #2600', () => {
  it('names the panel a tap on its reading, its figure or its line landed on', () => {
    const section = hud();
    expect(panelTapped(at('power'), section, open)).toBe('primary');
    expect(panelTapped(at('strip'), section, open)).toBe('route');
    expect(panelTapped(at('line'), section, open)).toBe('standings');
    expect(panelTapped(at('trainer'), section, open)).toBe('trainer');
  });

  it('tucks nothing for a tap on a control, even one inside a panel', () => {
    const section = hud();
    expect(panelTapped(at('swap'), section, open)).toBeUndefined();
    expect(panelTapped(at('pause'), section, open)).toBeUndefined();
  });

  it('tucks the panel for a tap on a line in a standings list that scrolls', () => {
    const section = hud();
    const list = section.querySelector('ol') as HTMLElement;
    list.setAttribute('tabindex', '0');
    list.setAttribute('data-oyl-scrolls', '');
    expect(panelTapped(at('line'), section, open)).toBe('standings');
    // A focusable box that is no scroll region is still a control.
    list.removeAttribute('data-oyl-scrolls');
    expect(panelTapped(at('line'), section, open)).toBeUndefined();
  });

  it('tucks nothing for a tap on a panel that is not open, or on no panel', () => {
    const section = hud();
    expect(panelTapped(at('power'), section, ['route'])).toBeUndefined();
    // The actions panel is never one that tucks: only its trainer's line.
    expect(panelTapped(section.querySelector('.oyl-hud__controls'), section, open)).toBeUndefined();
    expect(panelTapped(section, section, open)).toBeUndefined();
    expect(panelTapped(document.body, section, open)).toBeUndefined();
  });
});

describe('an open panel’s keyboard control, while focused — #2600', () => {
  const layer: TabBox = { left: 0, top: 0, right: 1024, bottom: 768 };

  it('is drawn on the panel’s own top-start corner', () => {
    const panel: TabBox = { left: 8, top: 16, right: 392, bottom: 200 };
    expect(tuckPlace({ panel, layer, width: 180 })).toEqual({ left: 8, top: 16 });
  });

  it('moves in from the stage’s far edge rather than leave it', () => {
    const panel: TabBox = { left: 900, top: 100, right: 1016, bottom: 300 };
    expect(tuckPlace({ panel, layer, width: 180 })).toEqual({ left: 1024 - 180, top: 100 });
  });

  it('is placed against the layer, wherever the layer is on the page', () => {
    const offset: TabBox = { left: 40, top: 30, right: 1064, bottom: 798 };
    const panel: TabBox = { left: 48, top: 46, right: 392, bottom: 200 };
    expect(tuckPlace({ panel, layer: offset, width: 180 })).toEqual({ left: 8, top: 16 });
  });
});
