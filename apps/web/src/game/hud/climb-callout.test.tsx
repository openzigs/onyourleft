// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The climb callout and the road-ahead strip's title on the rendered HUD —
 * #2593.
 *
 * `look-ahead.test.ts` holds the arithmetic. This holds the wire: that the
 * real `HudPanel`, handed a ride at a distance on a synthetic climb, puts the
 * callout in the notice cell as the climb comes within its lead, counts down
 * to the top on it and is gone at the top; that it gives way to every notice
 * and is not drawn where the rider turned it off or on a Delivery round's game
 * strip; and that its sentence is live only where it is told nothing else
 * says the climb, and is held for the phase rather than following the
 * countdown. Where it stands on the stage is the browser gate's
 * (`ride-hud-layout.browser.spec.ts` §"#2593"): jsdom does no layout.
 */

import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  metres,
  routeProfile,
  type RoutePoint,
  type RouteProfile,
} from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { mount, type Mounted } from '../../testing/mount';
import { UnitsProvider } from '../../units/context';
import { FRESH_WEEK, startRound } from '../delivery/round';
import { atStartLine, type GameState } from '../simulation';

import { HudPanel, type HudPanelProps } from './HudPanel';
import { DEFAULT_HUD_LAYOUT } from './hud-layout-preference';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const STEP = 10;

/** North from 0°, 0°: synthetic, as `CLAUDE.md` §6 asks of location data here. */
function along(index: number): ReturnType<typeof geographicPosition> {
  return geographicPosition(degreesLatitude((index * STEP) / 111_320), degreesLongitude(0));
}

/** 1 km flat at 100 m, 600 m at 6 %, 1.4 km flat — `look-ahead-strip.test.tsx`'s climb. */
function climb(): RouteProfile {
  const elevations = [100];
  for (let metre = STEP; metre <= 3000; metre += STEP) {
    elevations.push(metre <= 1000 ? 100 : metre <= 1600 ? 100 + ((metre - 1000) * 6) / 100 : 136);
  }
  const points: RoutePoint[] = elevations.map((elevation, index) => ({
    position: along(index),
    elevation: altitudeMetres(elevation),
  }));
  return routeProfile(points);
}

const PROFILE = climb();

function at(distance: number): GameState {
  const start = atStartLine(PROFILE);
  return { ...start, ride: { ...start.ride, distance: metres(distance) } };
}

function hud(
  distance: number,
  extra: Partial<HudPanelProps> = {},
  units: UnitSystem = 'metric',
): ReactElement {
  return (
    <UnitsProvider units={units}>
      <HudPanel
        profile={PROFILE}
        state={at(distance)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement=""
        {...extra}
      />
    </UnitsProvider>
  );
}

async function hudAt(
  distance: number,
  extra: Partial<HudPanelProps> = {},
  units: UnitSystem = 'metric',
): Promise<HTMLElement> {
  mounted = await mount(hud(distance, extra, units));
  return mounted.container;
}

const callout = (root: ParentNode): HTMLElement | null =>
  root.querySelector<HTMLElement>('[data-testid="oyl-hud-climb-callout"]');

const calloutText = (root: ParentNode): string =>
  callout(root)?.querySelector('.oyl-hud__climb-callout-text')?.textContent ?? '';

const sentence = (root: ParentNode): HTMLElement | null =>
  callout(root)?.querySelector<HTMLElement>('[role="status"]') ?? null;

describe('the climb callout on the HUD — #2593', () => {
  it('is not drawn while the climb is further ahead than its lead, though the strip names it', async () => {
    const root = await hudAt(200);
    expect(callout(root)).toBeNull();
    expect(root.querySelector('.oyl-hud__notices')).toBeNull();
    expect(root.querySelector('[data-testid="oyl-hud-next-climb"]')?.textContent).toMatch(
      /^Climb in \d+ m · 6 %$/,
    );
  });

  it('stands in the notice cell as the climb comes within its lead, saying the strip’s caption and more', async () => {
    const root = await hudAt(700);
    const box = callout(root);
    expect(box?.closest('.oyl-hud > .oyl-hud__notices')).not.toBeNull();
    expect(box?.closest('.oyl-hud__notices--collapsed')).toBeNull();
    expect(box?.getAttribute('data-climb')).toBe('ahead');
    const caption = root.querySelector('[data-testid="oyl-hud-next-climb"]')?.textContent ?? '';
    expect(calloutText(root)).toMatch(/^Climb in \d+0 m · 6 % avg · 0\.6 km$/);
    // The same digits as the strip's caption, on the same frame.
    expect(calloutText(root).startsWith(caption)).toBe(true);
  });

  it('counts down to the top on the climb, and is gone at the top', async () => {
    const root = await hudAt(1200);
    expect(callout(root)?.getAttribute('data-climb')).toBe('on');
    expect(calloutText(root)).toMatch(/^Top in \d+0 m · 6 %$/);
    expect(calloutText(root)).toBe(
      root.querySelector('[data-testid="oyl-hud-next-climb"]')?.textContent,
    );
    const before = Number(/(\d+) m/.exec(calloutText(root))?.[1]);
    await mounted?.rerender(hud(1300));
    const after = Number(/(\d+) m/.exec(calloutText(root))?.[1]);
    expect(before - after).toBe(100);
    await mounted?.rerender(hud(1700));
    expect(callout(root)).toBeNull();
    expect(root.querySelector('.oyl-hud__notices')).toBeNull();
  });

  it('says it in the rider’s units', async () => {
    const root = await hudAt(700, {}, 'imperial');
    expect(calloutText(root)).toMatch(/^Climb in \d+ ft · 6 % avg · 0\.4 mi$/);
  });

  it('is not drawn when the rider turned it off in Settings', async () => {
    const root = await hudAt(1200, { layout: { ...DEFAULT_HUD_LAYOUT, climbCallout: false } });
    expect(callout(root)).toBeNull();
    // The strip's caption stays as it was.
    expect(root.querySelector('[data-testid="oyl-hud-next-climb"]')?.textContent).toMatch(/^Top/);
  });

  it('gives way to every notice, and to the lap that has just ended', async () => {
    let root = await hudAt(1200, { notices: <p id="said">Trainer lost</p> });
    expect(root.querySelector('#said')).not.toBeNull();
    expect(callout(root)).toBeNull();
    mounted?.unmount();
    root = await hudAt(1200, { lapNotice: <p id="lap">Lap 2</p> });
    expect(root.querySelector('#lap')).not.toBeNull();
    expect(callout(root)).toBeNull();
    mounted?.unmount();
    root = await hudAt(1200, {
      standingNotice: { content: <p id="road">Road</p>, expanded: true, onToggle: () => undefined },
    });
    expect(callout(root)).toBeNull();
  });

  it('stands with a standing notice put away, which takes no cell', async () => {
    const root = await hudAt(1200, {
      standingNotice: {
        content: <p id="road">Road</p>,
        expanded: false,
        onToggle: () => undefined,
      },
    });
    expect(callout(root)).not.toBeNull();
    expect(root.querySelector('.oyl-hud__notices--collapsed')).toBeNull();
  });

  it('is not drawn on a Delivery round, as its game strip or as Everything', async () => {
    const delivery = { round: startRound(4), week: FRESH_WEEK, score: 0, next: undefined };
    let root = await hudAt(1200, { delivery });
    expect(root.querySelector('.oyl-hud--delivery-game')).not.toBeNull();
    expect(callout(root)).toBeNull();
    mounted?.unmount();
    root = await hudAt(1200, {
      delivery,
      layout: { ...DEFAULT_HUD_LAYOUT, delivery: 'everything' },
    });
    expect(callout(root)).toBeNull();
    // The strip's caption, drawn as Everything, still names the climb.
    expect(root.querySelector('[data-testid="oyl-hud-next-climb"]')?.textContent).toMatch(/^Top/);
  });
});

describe('what the climb callout says to a screen reader — #2593', () => {
  it('has no live sentence where the HUD’s region says the climb', async () => {
    const root = await hudAt(700, { climbCalloutLive: false });
    expect(callout(root)).not.toBeNull();
    expect(sentence(root)).toBeNull();
    expect(callout(root)?.querySelector('[aria-live], [role="alert"]')).toBeNull();
  });

  it('is silent where nobody said whether the climb is spoken — the demo', async () => {
    const root = await hudAt(700);
    expect(sentence(root)).toBeNull();
  });

  it('announces each phase once, in words, held while the countdown moves', async () => {
    const root = await hudAt(700, { climbCalloutLive: true });
    const said = sentence(root)?.textContent;
    expect(said).toMatch(/^Climb in \d+0 metres: 6 per cent average, 0\.6 kilometres long\.$/);
    expect(sentence(root)?.classList.contains('oyl-visually-hidden')).toBe(true);
    // Further on, the phrase moves and the sentence does not.
    const shown = calloutText(root);
    await mounted?.rerender(hud(800, { climbCalloutLive: true }));
    expect(calloutText(root)).not.toBe(shown);
    expect(sentence(root)?.textContent).toBe(said);
    // On the climb, a new sentence, once.
    await mounted?.rerender(hud(1100, { climbCalloutLive: true }));
    const onIt = sentence(root)?.textContent;
    expect(onIt).toMatch(/^On the climb: top in \d+0 metres, 6 per cent\.$/);
    await mounted?.rerender(hud(1300, { climbCalloutLive: true }));
    expect(sentence(root)?.textContent).toBe(onIt);
  });
});

describe('the road-ahead strip’s title — #2593', () => {
  it('names the window in the rider’s units, over the strip, hidden from a screen reader', async () => {
    let root = await hudAt(200);
    const title = root.querySelector('[data-testid="oyl-hud-ahead-title"]');
    expect(title?.textContent).toBe('Next 2 km');
    expect(title?.getAttribute('aria-hidden')).toBe('true');
    // Beside the strip, in its box: the strip's own name says the window.
    expect(
      title?.parentElement?.querySelector('[data-testid="oyl-hud-look-ahead"]'),
    ).not.toBeNull();
    expect(
      root.querySelector('[data-testid="oyl-hud-look-ahead"]')?.getAttribute('aria-label'),
    ).toMatch(/^The next 2 kilometres: /);
    mounted?.unmount();
    root = await hudAt(200, {}, 'imperial');
    expect(root.querySelector('[data-testid="oyl-hud-ahead-title"]')?.textContent).toBe(
      'Next 1.2 mi',
    );
  });
});
