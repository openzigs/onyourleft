// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2600 in the accessibility gate: the ride HUD with its controls hidden, with
 * every panel open and with every panel tucked away to its tab, audited by the
 * gate's own audit — and the two things jsdom can hold that the browser gate
 * cannot see from outside: a hidden control is still in the tab order and the
 * accessibility tree (it is faded and then clipped, never `hidden`,
 * `display: none` or `aria-hidden`), and each panel is one named button that
 * says whether the panel is shown or hidden.
 *
 * The 48 px targets and the reflow at large text are layout, and so the
 * browser gate's (`ride-chrome.browser.spec.ts`); what is held here is that
 * the stylesheet DECLARES 48 px for a tab, which that spec measures.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations, tabbableElements } from '../../a11y/audit';
import { mount, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';
import { CONTROLS_HIDE_MILLISECONDS } from './controls-reveal';
import { panelToggleName } from './HudCore';
import { HudPanel } from './HudPanel';
import {
  COLLAPSIBLE_PANELS,
  RIDE_CHROME_STORAGE_KEY,
  writeRideChrome,
} from './ride-chrome-preference';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
  localStorage.removeItem(RIDE_CHROME_STORAGE_KEY);
});

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index),
    });
  }
  return routeProfile(points);
}

const profile = route();

/** In the page's one `main`, under its one `h1`, as the shell draws a ride. */
function onAPage(): JSX.Element {
  return (
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={profile}
        state={atStartLine(profile)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        chases={[]}
        announcement=""
        paused={false}
        onPause={() => undefined}
        onEnd={() => undefined}
        trainer={{ gradePercent: 3, writes: 1 }}
      />
    </main>
  );
}

function names(): string[] {
  return tabbableElements(document).map((each) => (each.textContent ?? '').trim());
}

describe('the ride HUD’s hiding controls and collapsing panels — #2600', () => {
  it('audits clean with the controls hidden, and keeps every one in the tab order', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mounted = await mount(onAPage());
    const shown = names();
    act(() => {
      vi.advanceTimersByTime(CONTROLS_HIDE_MILLISECONDS);
    });
    expect(document.querySelector('.oyl-hud')?.getAttribute('data-oyl-controls')).toBe('hidden');
    // Nothing hidden by an attribute an assistive technology reads.
    for (const control of document.querySelectorAll('.oyl-hud__actions button')) {
      expect(control.closest('[hidden], [aria-hidden="true"], [inert]')).toBeNull();
    }
    expect(names()).toEqual(shown);
    expect(shown).toEqual(expect.arrayContaining(['Pause', 'End ride']));
    const audit = auditAccessibility(document);
    expect(audit, formatViolations(audit)).toEqual([]);
  });

  it('audits clean with every panel open, each one control named as shown', async () => {
    mounted = await mount(onAPage());
    const controls = [...document.querySelectorAll('button[data-oyl-tab]')];
    expect(controls.map((each) => each.textContent)).toEqual(
      ['Power', 'Readings', 'Route', 'Trainer'].map((word) => panelToggleName(word, true)),
    );
    // In the tab order, and nowhere hidden from an assistive technology.
    for (const each of controls) {
      expect(tabbableElements(document)).toContain(each);
      expect(each.closest('[hidden], [aria-hidden="true"], [inert]')).toBeNull();
    }
    const audit = auditAccessibility(document);
    expect(audit, formatViolations(audit)).toEqual([]);
  });

  it('audits clean with every panel tucked away, each tab named and saying it is hidden', async () => {
    writeRideChrome(localStorage, { autoHide: true, collapsed: [...COLLAPSIBLE_PANELS] });
    mounted = await mount(onAPage());
    const tabs = [...document.querySelectorAll('button.oyl-hud__tab')];
    // The four this ride draws — no race and no loop, so no standings' tab
    // although the device has that panel collapsed too.
    expect(tabs.map((each) => each.getAttribute('aria-label'))).toEqual(
      ['Power', 'Readings', 'Route', 'Trainer'].map((word) => panelToggleName(word, false)),
    );
    // SC 2.5.3: the name begins with the word drawn.
    for (const each of tabs) {
      expect(each.getAttribute('aria-label')?.startsWith(each.textContent ?? '?')).toBe(true);
    }
    expect(document.querySelector('.oyl-hud__laps, .oyl-hud__standings')).toBeNull();
    expect(document.querySelector('.oyl-hud__tuck')).toBeNull();
    // Pause and End ride are never among what collapses.
    expect(names()).toEqual(expect.arrayContaining(['Pause', 'End ride']));
    const audit = auditAccessibility(document);
    expect(audit, formatViolations(audit)).toEqual([]);
  });

  it('declares a tab, and a panel’s control while drawn, a 48 px target both ways', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../design/theme.css'),
      'utf8',
    );
    const rule = /\n\.oyl-hud__tab,\n\.oyl-hud__tuck \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/min-height: 3rem;/);
    expect(rule).toMatch(/min-width: 3rem;/);
  });
});
