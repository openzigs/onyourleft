// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The HUD, audited — and the two of #94's criteria that only the DOM can settle.
 *
 * Named `*.a11y.test.tsx` deliberately, so `test:a11y` selects it: #94 asks for
 * WCAG AA on a surface drawn over a 3D scene, and putting that assertion outside
 * the accessibility gate would leave the one criterion the gate exists for
 * outside it. `scripts/check-a11y-suite.mjs` would catch the reverse mistake.
 */

import type React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { HudPanel, CONTROL_MINIMUM_PIXELS } from './HudPanel';
import { NO_READING, type HudInput } from './fields';
import { atStartLine } from '../simulation';
import { auditAccessibility, formatViolations, tabbableElements } from '../../a11y/audit';
import { mount, type Mounted } from '../../testing/mount';
import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  metresPerSecond,
  pacerGap,
  routeProfile,
  watts,
  type RoutePoint,
} from '@onyourleft/domain';

/**
 * The HUD inside the landmark it actually lives in.
 *
 * `auditAccessibility` walks the whole document, and rightly so — a landmark
 * rule cannot be checked against a fragment. The HUD is never the whole page: it
 * sits over the canvas inside the ride screen's `main`. Mounting it bare would
 * make the audit report a missing landmark that the shipping screen has, which
 * is a false failure and would train the next person to loosen the audit.
 */
function inRideScreen(hud: React.ReactElement): React.ReactElement {
  return (
    <main>
      <h1>Ride</h1>
      {hud}
    </main>
  );
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/**
 * What a screen reader says when it reaches one field, as one string.
 *
 * ⚠️ **The announced text, not the markup** — #255's second acceptance
 * criterion asks for exactly that, and the distinction is the whole point of
 * the issue. The defect it is pinning was invisible in the markup: `<dd>12 s
 * behind</dd>` is well-formed, named, associated and audits clean, and the only
 * thing wrong with it is what a person hears. A test that asserted on elements
 * and attributes could not have gone red for it.
 *
 * A `dt`/`dd` pair is announced as its term and then its definition, so the two
 * texts joined with a comma is what a rider is told. Whitespace is collapsed
 * the way `a11y/audit.ts` collapses it, because a screen reader does not read
 * JSX indentation aloud.
 */
function announced(label: string): string {
  const pairs = [...document.querySelectorAll('.oyl-hud__field')];
  const field = pairs.find((pair) => text(pair.querySelector('dt')) === label);
  if (field === undefined) {
    throw new Error(`no HUD field labelled ${label}`);
  }
  return `${label}, ${text(field.querySelector('dd'))}`;
}

function text(element: Element | null): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 60; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(index <= 30 ? index : 60 - index),
    });
  }
  return routeProfile(points);
}

function props(overrides: Partial<HudInput> = {}): HudInput & {
  onPause: () => void;
  onEnd: () => void;
  paused: boolean;
} {
  const profile = route();
  return {
    profile,
    state: atStartLine(profile),
    cadence: { value: 88, live: true },
    heartRate: { value: 150, live: true },
    onPause: () => undefined,
    onEnd: () => undefined,
    paused: false,
    ...overrides,
  };
}

describe('the HUD passes the accessibility audit', () => {
  it('renders with no violations', async () => {
    mounted = await mount(inRideScreen(<HudPanel {...props()} />));

    const violations = auditAccessibility(document);

    expect(formatViolations(violations)).toBe('');
  });

  it('audits clean with every sensor dropped, which is a different tree', async () => {
    const base = props();
    mounted = await mount(
      inRideScreen(
        <HudPanel
          {...base}
          state={{ ...base.state, input: { power: watts(0), live: false } }}
          cadence={{ value: undefined, live: false }}
          heartRate={{ value: undefined, live: false }}
        />,
      ),
    );

    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});

describe('a rider can tell a lost sensor from a zero, on the screen', () => {
  it('writes the words as well as the dash, so the tint is not the only signal', async () => {
    const base = props();
    mounted = await mount(
      inRideScreen(
        <HudPanel {...base} state={{ ...base.state, input: { power: watts(0), live: false } }} />,
      ),
    );

    const field = document.querySelector('.oyl-hud__field--stale');
    expect(field).not.toBeNull();
    expect(field?.textContent).toContain(NO_READING);
    expect(field?.textContent).toContain('Sensor lost');
  });

  it('says nothing of the sort for a genuine zero', async () => {
    const base = props();
    mounted = await mount(
      inRideScreen(
        <HudPanel {...base} state={{ ...base.state, input: { power: watts(0), live: true } }} />,
      ),
    );

    expect(document.querySelector('.oyl-hud__field--stale')).toBeNull();
    expect(document.body.textContent).not.toContain('Sensor lost');
  });
});

describe('the position marker tracks the physics', () => {
  it('moves with the ride’s own odometer and nothing else', async () => {
    const base = props();
    const total: number = base.profile.totalDistance;
    mounted = await mount(
      inRideScreen(
        <HudPanel
          {...base}
          state={{
            ...base.state,
            ride: { speed: metresPerSecond(9), distance: metres(total / 4) },
          }}
        />,
      ),
    );

    const marker = document.querySelector('[data-testid="oyl-hud-position"]');
    expect(Number(marker?.getAttribute('data-position'))).toBeCloseTo(0.25, 6);
  });

  it('offers the profile as text as well as a picture', async () => {
    const base = props();
    const total: number = base.profile.totalDistance;
    mounted = await mount(
      inRideScreen(
        <HudPanel
          {...base}
          state={{
            ...base.state,
            ride: { speed: metresPerSecond(0), distance: metres(total / 2) },
          }}
        />,
      ),
    );

    expect(document.body.textContent).toContain('50% complete');
  });
});

describe('the mid-ride controls are usable with gloves on', () => {
  it('gives pause and end targets well above the WCAG minimum', async () => {
    mounted = await mount(inRideScreen(<HudPanel {...props()} />));

    const controls = [...document.querySelectorAll<HTMLElement>('.oyl-hud__control')];
    expect(controls).toHaveLength(2);
    for (const control of controls) {
      // WCAG 2.2 SC 2.5.8 asks 24px and SC 2.5.5 asks 44px; both assume a dry
      // fingertip and a stationary user, which #94's rider is not.
      expect(Number.parseInt(control.style.minHeight, 10)).toBeGreaterThanOrEqual(
        CONTROL_MINIMUM_PIXELS,
      );
      expect(Number.parseInt(control.style.minWidth, 10)).toBeGreaterThanOrEqual(
        CONTROL_MINIMUM_PIXELS,
      );
    }
  });

  it('puts both controls in the tab order', async () => {
    mounted = await mount(inRideScreen(<HudPanel {...props()} />));

    const names = tabbableElements(document).map((element) => element.textContent);
    expect(names).toContain('Pause');
    expect(names).toContain('End ride');
  });

  it('says Resume rather than Pause once the ride is paused', async () => {
    mounted = await mount(inRideScreen(<HudPanel {...props({})} paused />));

    expect(document.body.textContent).toContain('Resume');
  });
});

describe('the gap says who is ahead, to the eye and to a screen reader (#255)', () => {
  function chasing(botMetres: number, riderMetres: number): React.ReactElement {
    const base = props();
    return inRideScreen(
      <HudPanel
        {...base}
        state={{
          ...base.state,
          ride: { speed: metresPerSecond(10), distance: metres(riderMetres) },
        }}
        gap={pacerGap({
          botDistance: metres(botMetres),
          riderDistance: metres(riderMetres),
          referenceSpeed: metresPerSecond(10),
        })}
        gapTo="bot"
      />,
    );
  }

  it('announces a pacer in front as being ahead of the rider', async () => {
    mounted = await mount(chasing(220, 100));

    // ⚠️ The exact sentence, because the defect was a *true* sentence read
    // under the wrong subject. `toContain('ahead')` would have passed against
    // the old code too: it said `ahead` — about the rider.
    expect(announced('Pacer')).toBe('Pacer, 12 s ahead of you');
    expect(announced('Pacer')).not.toContain('behind');
  });

  it('announces a pacer the rider has dropped as being behind them', async () => {
    mounted = await mount(chasing(100, 220));

    expect(announced('Pacer')).toBe('Pacer, 12 s behind you');
    expect(announced('Pacer')).not.toContain('ahead');
  });

  it('names the rider’s own best attempt as the thing that is ahead', async () => {
    const base = props();
    mounted = await mount(
      inRideScreen(
        <HudPanel
          {...base}
          state={{ ...base.state, ride: { speed: metresPerSecond(10), distance: metres(100) } }}
          gap={pacerGap({
            botDistance: metres(220),
            riderDistance: metres(100),
            referenceSpeed: metresPerSecond(10),
          })}
          gapTo="ghost"
        />,
      ),
    );

    expect(announced('Your best')).toBe('Your best, 12 s ahead of you');
  });

  it('announces level rather than a direction it cannot support', async () => {
    mounted = await mount(chasing(104, 100));

    expect(announced('Pacer')).toBe('Pacer, Level');
  });

  it('audits clean with a gap on the screen, which is a different tree', async () => {
    mounted = await mount(chasing(220, 100));

    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
