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

/**
 * A 400 m x 200 m circuit, closed, so `loop: true` is honest.
 *
 * ⚠️ At module scope rather than inside #285's describe block, because #287
 * needs it too: `route()` above is a straight kilometre and can never be a loop,
 * which is the one shape the elevation strip's old clamped fraction was correct
 * for.
 */
function circuit(): ReturnType<typeof routeProfile> {
  const metresPerDegree = 111_320;
  const halfHeight = 100 / metresPerDegree;
  const east = 400 / (metresPerDegree * Math.cos((51.5 * Math.PI) / 180));
  const corners: readonly (readonly [number, number])[] = [
    [51.5 - halfHeight, -0.12],
    [51.5 - halfHeight, -0.12 + east],
    [51.5 + halfHeight, -0.12 + east],
    [51.5 + halfHeight, -0.12],
    [51.5 - halfHeight, -0.12],
  ];
  const points: RoutePoint[] = [];
  for (let corner = 0; corner < corners.length - 1; corner += 1) {
    const [fromLatitude, fromLongitude] = corners[corner] as readonly [number, number];
    const [toLatitude, toLongitude] = corners[corner + 1] as readonly [number, number];
    for (let step = 0; step < 40; step += 1) {
      const fraction = step / 40;
      points.push({
        position: geographicPosition(
          degreesLatitude(fromLatitude + (toLatitude - fromLatitude) * fraction),
          degreesLongitude(fromLongitude + (toLongitude - fromLongitude) * fraction),
        ),
        elevation: altitudeMetres(10),
      });
    }
  }
  const [lastLatitude, lastLongitude] = corners[corners.length - 1] as readonly [number, number];
  points.push({
    position: geographicPosition(degreesLatitude(lastLatitude), degreesLongitude(lastLongitude)),
    elevation: altitudeMetres(10),
  });
  return routeProfile(points, { loop: true });
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

  /**
   * What `data-position` means, stated — #287's fourth criterion.
   *
   * ⚠️ **The contract the two assertions above rest on changed.** It was *the
   * rider's distance over the route's length, clamped to 1*. It is now *the
   * fraction along the profile the marker is drawn at, wrapped on a
   * `loop: true` route and clamped on any other* — the same number the sentence
   * beside the strip is rounded from, which is why the three tests below read
   * the attribute and the text together rather than either alone. A marker that
   * agreed with no sentence would satisfy the old contract and still be the
   * defect #287 is about.
   */
  describe('and says the same thing in words', () => {
    it('does not tell a rider on lap two that the ride is complete', async () => {
      const profile = circuit();
      const total: number = profile.totalDistance;
      const base = props({ profile });
      mounted = await mount(
        inRideScreen(
          <HudPanel
            {...base}
            state={{
              ...base.state,
              ride: { speed: metresPerSecond(8), distance: metres(total * 1.25) },
            }}
          />,
        ),
      );

      const marker = document.querySelector('[data-testid="oyl-hud-position"]');
      expect(Number(marker?.getAttribute('data-position'))).toBeCloseTo(0.25, 6);
      expect(document.body.textContent).toContain('25% of lap 2');
      expect(document.body.textContent).not.toContain('100% complete');
      expect(document.querySelector('.oyl-hud__profile-svg')?.getAttribute('aria-label')).toBe(
        'Route profile, 25 per cent of lap 2',
      );
    });

    it('still tells a rider past the end of a point-to-point route that it is', async () => {
      const base = props();
      const total: number = base.profile.totalDistance;
      mounted = await mount(
        inRideScreen(
          <HudPanel
            {...base}
            state={{
              ...base.state,
              ride: { speed: metresPerSecond(0), distance: metres(total * 2) },
            }}
          />,
        ),
      );

      const marker = document.querySelector('[data-testid="oyl-hud-position"]');
      expect(base.profile.loop).toBe(false);
      expect(Number(marker?.getAttribute('data-position'))).toBe(1);
      expect(document.body.textContent).toContain('100% complete');
    });

    it('draws the marker where the sentence says it is', async () => {
      // The picture and the words out of one value (#94's third criterion,
      // widened by #287's third). The marker's `x` is the fraction as a
      // percentage of the viewBox, so reading both off the DOM is what catches
      // a second percentage computed in the component.
      const profile = circuit();
      const total: number = profile.totalDistance;
      const base = props({ profile });
      mounted = await mount(
        inRideScreen(
          <HudPanel
            {...base}
            state={{
              ...base.state,
              ride: { speed: metresPerSecond(8), distance: metres(total * 2.4) },
            }}
          />,
        ),
      );

      const marker = document.querySelector('[data-testid="oyl-hud-position"]');
      const x = Number(marker?.getAttribute('x1'));
      const said = document.querySelector('.oyl-hud__profile-text')?.textContent ?? '';
      expect(said).toBe(`${String(Math.round(x))}% of lap 3`);
      expect(Number(marker?.getAttribute('data-position')) * 100).toBeCloseTo(x, 6);
    });
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
        chases={[
          {
            to: 'bot',
            gap: pacerGap({
              botDistance: metres(botMetres),
              riderDistance: metres(riderMetres),
              referenceSpeed: metresPerSecond(10),
            }),
          },
        ]}
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
          chases={[
            {
              to: 'ghost',
              gap: pacerGap({
                botDistance: metres(220),
                riderDistance: metres(100),
                referenceSpeed: metresPerSecond(10),
              }),
            },
          ]}
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

  /**
   * #259 — what a rider is told once their own best has crossed the line.
   *
   * ⚠️ **The announced form, and the exact sentence.** #259's fourth criterion
   * asks for the new wording here for the reason #94 binds this panel at all: a
   * rider reads it at arm's length and a rider using a screen reader hears it
   * in one breath, and "Your best, Beaten by you" and "Your best, Finished
   * ahead of you" have to be impossible to confuse in either channel. The gap
   * handed in is identical in both cases and is the *losing* one throughout —
   * a panel that read the gap rather than the result would say the same thing
   * twice.
   */
  describe('once the rider’s own best has finished (#259)', () => {
    function afterTheirBestFinished(
      outcome: 'beaten' | 'level' | 'not-beaten',
    ): React.ReactElement {
      const base = props();
      return inRideScreen(
        <HudPanel
          {...base}
          state={{ ...base.state, ride: { speed: metresPerSecond(10), distance: metres(100) } }}
          chases={[
            {
              to: 'ghost',
              gap: pacerGap({
                botDistance: metres(220),
                riderDistance: metres(100),
                referenceSpeed: metresPerSecond(10),
              }),
              outcome,
            },
          ]}
        />,
      );
    }

    it('tells a rider who beat it that they beat it', async () => {
      mounted = await mount(afterTheirBestFinished('beaten'));

      expect(announced('Your best')).toBe('Your best, Beaten by you');
      // The gap it was handed says the attempt is 12 s ahead. A field that went
      // on quoting it would read exactly as it did before the line — which is
      // the defect, in the rider's own words.
      expect(announced('Your best')).not.toContain('12');
      expect(announced('Your best')).not.toContain('ahead of you');
    });

    it('tells a rider who did not beat it something that cannot be mistaken for it', async () => {
      mounted = await mount(afterTheirBestFinished('not-beaten'));

      expect(announced('Your best')).toBe('Your best, Finished ahead of you');
      expect(announced('Your best')).not.toContain('Beaten');
    });

    it('announces a dead heat as neither', async () => {
      mounted = await mount(afterTheirBestFinished('level'));

      expect(announced('Your best')).toBe('Your best, Matched by you');
    });

    it('audits clean with a finished attempt on the screen, which is a different tree', async () => {
      mounted = await mount(afterTheirBestFinished('beaten'));

      expect(formatViolations(auditAccessibility(document))).toBe('');
    });
  });

  it('announces the pacer and your own best separately when both are raced (#253)', async () => {
    // ⚠️ Two gap fields is a DOM shape this panel could not previously produce,
    // so it is audited as well as read: the `dt`/`dd` association has to hold
    // for both, and a duplicated React key would collapse them into one.
    const base = props();
    mounted = await mount(
      inRideScreen(
        <HudPanel
          {...base}
          state={{ ...base.state, ride: { speed: metresPerSecond(10), distance: metres(100) } }}
          chases={[
            {
              to: 'bot',
              gap: pacerGap({
                botDistance: metres(20),
                riderDistance: metres(100),
                referenceSpeed: metresPerSecond(10),
              }),
            },
            {
              to: 'ghost',
              gap: pacerGap({
                botDistance: metres(220),
                riderDistance: metres(100),
                referenceSpeed: metresPerSecond(10),
              }),
            },
          ]}
        />,
      ),
    );

    expect(announced('Pacer')).toBe('Pacer, 8 s behind you');
    expect(announced('Your best')).toBe('Your best, 12 s ahead of you');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});

/**
 * The route in plan, on the panel the audit actually renders — #285.
 *
 * ⚠️ **Here rather than in a file of its own**, because #285's fifth criterion
 * is that `test:a11y` covers *the route with it present*, and the route-level
 * audit (`routes.a11y.test.tsx`) renders the game screen with no port and
 * therefore never reaches the HUD at all — `picker.a11y.test.tsx` records that
 * gap in its own header. This file is the one place the gate sees this panel.
 */
describe('the route in plan (#285)', () => {
  /** The module-scope circuit, which #287 shares. @see circuit */
  const loop = circuit;

  function markAt(): { readonly x: number; readonly y: number } {
    const mark = document.querySelector('[data-testid="oyl-hud-plan-here"]');
    if (mark === null) {
      throw new Error('no rider mark on the plan');
    }
    return { x: Number(mark.getAttribute('data-x')), y: Number(mark.getAttribute('data-y')) };
  }

  it('is actually on the HUD, so the audit above is not passing over nothing', async () => {
    mounted = await mount(inRideScreen(<HudPanel {...props()} />));

    expect(document.querySelector('.oyl-hud__plan-svg')).not.toBeNull();
    expect(document.querySelectorAll('.oyl-hud__plan-line').length).toBeGreaterThan(0);
  });

  it('carries a description rather than being a bare svg', async () => {
    mounted = await mount(inRideScreen(<HudPanel {...props()} />));

    const plan = document.querySelector('.oyl-hud__plan-svg');
    expect(plan?.getAttribute('role')).toBe('img');
    expect(plan?.getAttribute('aria-label')).toContain('Route in plan, north up');
  });

  it('audits clean on a loop, which is a different description and a different tree', async () => {
    const profile = loop();
    const base = props({ profile });
    mounted = await mount(
      inRideScreen(
        <HudPanel
          {...base}
          state={{
            ...base.state,
            ride: { speed: metresPerSecond(8), distance: metres(profile.totalDistance * 1.5) },
          }}
        />,
      ),
    );

    expect(formatViolations(auditAccessibility(document))).toBe('');
    expect(document.querySelector('.oyl-hud__plan-svg')?.getAttribute('aria-label')).toContain(
      'on lap 2',
    );
  });

  it('puts the rider in the right place on lap two of a loop', async () => {
    // ⚠️ #285's fourth criterion, read off the rendered panel rather than off
    // the projection. ⚠️ **This comment used to say the elevation strip beside
    // it was pinned at 100 % for this same ride state, because
    // `fields.ts` §`profilePosition` clamped — #287 fixed that and the strip now
    // shares this panel's wrapped fraction.** What the assertion below still
    // catches is a mark placed from a clamped value of any origin.
    const profile = loop();
    const total: number = profile.totalDistance;
    const base = props({ profile });

    mounted = await mount(
      inRideScreen(
        <HudPanel
          {...base}
          state={{
            ...base.state,
            ride: { speed: metresPerSecond(8), distance: metres(total / 4) },
          }}
        />,
      ),
    );
    const lapOne = markAt();
    mounted.unmount();

    mounted = await mount(
      inRideScreen(
        <HudPanel
          {...base}
          state={{
            ...base.state,
            ride: { speed: metresPerSecond(8), distance: metres(total * 1.25) },
          }}
        />,
      ),
    );
    const lapTwo = markAt();

    expect(lapTwo.x).toBeCloseTo(lapOne.x, 3);
    expect(lapTwo.y).toBeCloseTo(lapOne.y, 3);
    // And not simply sitting at the start line, which would satisfy the line
    // above if BOTH readings were wrong in the same way.
    mounted.unmount();
    mounted = await mount(inRideScreen(<HudPanel {...base} />));
    const startLine = markAt();
    expect(Math.hypot(lapTwo.x - startLine.x, lapTwo.y - startLine.y)).toBeGreaterThan(1);
  });
});
