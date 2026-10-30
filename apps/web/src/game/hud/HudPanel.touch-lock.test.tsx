// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1482 — the touch lock on the trainer game's HUD, the HUD half of #1432.
 *
 * What a tap reaches is read off the callbacks the HUD was handed, which are
 * what `GameView` wires to the game (`GameView.test.tsx` §"#1482" holds that
 * end, through the real game). Taps are `design/touch-lock-testing.ts`'s: a
 * jsdom `click()` is a keyboard's, which the lock lets through by design.
 *
 * Where the lock sits, and that it fits, is a layout claim the browser gate
 * makes (`ride-targets.browser.spec.ts`, `ride.browser.spec.ts`,
 * `ride-workout.browser.spec.ts` §"#1244"); jsdom lays nothing out.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { TOUCH_LOCK_EXEMPT } from '../../design/touch-lock';
import { hold, tap } from '../../design/touch-lock-testing';
import { TOUCH_LOCK_NAME } from '../../design/TouchLockButton';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../../testing/mount';
import { atStartLine } from '../simulation';
import { HudPanel, type HudPanelProps } from './HudPanel';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
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

interface Pressed {
  pause: number;
  end: number;
  keep: number;
  replansOff: number;
  ghost: number;
}

async function hud(pressed: Pressed, more: Partial<HudPanelProps> = {}): Promise<void> {
  const profile = route();
  mounted = await mount(
    <HudPanel
      profile={profile}
      state={atStartLine(profile)}
      cadence={{ value: 88, live: true }}
      heartRate={{ value: 150, live: true }}
      chases={[]}
      announcement=""
      paused={false}
      onPause={() => {
        pressed.pause += 1;
      }}
      onEnd={() => {
        pressed.end += 1;
      }}
      keepPlan={{
        sentence: 'The next block is easier.',
        onKeep: () => {
          pressed.keep += 1;
        },
      }}
      onReplansOff={() => {
        pressed.replansOff += 1;
      }}
      ghostStop={{
        rider: 'Bea',
        onStop: () => {
          pressed.ghost += 1;
        },
      }}
      {...more}
    />,
  );
  await settle();
}

const none = (): Pressed => ({ pause: 0, end: 0, keep: 0, replansOff: 0, ghost: 0 });

function button(name: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
    (each) => (each.textContent ?? '').replace(/\s+/g, ' ').trim() === name,
  );
  if (found === undefined) {
    throw new Error(`no button "${name}" on the HUD`);
  }
  return found;
}

const lock = (): HTMLButtonElement => button(TOUCH_LOCK_NAME);

describe('the touch lock on the HUD — #1482', () => {
  it('is on the HUD, off, in the actions panel beside Pause and End ride', async () => {
    await hud(none());

    expect(lock().getAttribute('aria-pressed')).toBe('false');
    expect(lock().closest('.oyl-hud__controls')).toBe(
      button('Pause').closest('.oyl-hud__controls'),
    );
    // After End ride in the document, so Pause and End ride keep their places
    // for a screen reader and the tab key.
    expect(
      button('End ride').compareDocumentPosition(lock()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it('lets every tap through while it is off — the control for the case below', async () => {
    const pressed = none();
    await hud(pressed);

    for (const name of ['Pause', 'Keep the plan', 'Switch re-plans off', 'Stop ghost of Bea']) {
      tap(button(name));
    }

    expect(pressed).toEqual({ pause: 1, end: 0, keep: 1, replansOff: 1, ghost: 1 });
  });

  it('turns on with a tap, and then ignores taps on every other HUD control', async () => {
    const pressed = none();
    await hud(pressed);

    tap(lock());
    expect(lock().getAttribute('aria-pressed')).toBe('true');

    for (const name of ['Pause', 'Keep the plan', 'Switch re-plans off', 'Stop ghost of Bea']) {
      tap(button(name));
    }
    expect(pressed).toEqual(none());
  });

  it('lets a tap on End ride through while it is on — the owner’s ruling to make', async () => {
    const pressed = none();
    await hud(pressed);
    tap(lock());

    tap(button('End ride'));

    expect(pressed.end).toBe(1);
    expect(button('End ride').hasAttribute(TOUCH_LOCK_EXEMPT)).toBe(true);
    expect(button('Pause').hasAttribute(TOUCH_LOCK_EXEMPT)).toBe(false);
  });

  it('names the Trainer notice toggle, and only it, so layout rules never key on position', async () => {
    let toggled = 0;
    await hud(none());
    const controls = (): Element =>
      mounted?.container.querySelector('.oyl-hud__controls') as Element;
    expect(controls().querySelector('.oyl-hud__notice-toggle')).toBeNull();
    // The lock is the third control with no notice standing (#1482).
    expect(controls().children.length).toBe(3);

    mounted?.unmount();
    await hud(none(), {
      standingNotice: {
        content: <p>The road is not reaching your trainer</p>,
        expanded: false,
        onToggle: () => {
          toggled += 1;
        },
      },
    });
    const named = controls().querySelectorAll('.oyl-hud__notice-toggle');
    expect(named.length).toBe(1);
    expect(named[0]?.textContent).toContain('Trainer notice');

    tap(lock());
    tap(named[0] as HTMLElement);
    expect(toggled).toBe(0);
  });

  it('keeps theme.css from reading the lock as a standing notice by position (#1482)', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../design/theme.css'),
      'utf8',
    );
    expect(css).not.toMatch(/oyl-hud__controls\s*>\s*:nth-child\(3\)/);
    expect(css).not.toMatch(/oyl-hud__controls\s*>\s*\[aria-controls\]/);
  });

  it('lets a keyboard or screen reader press Pause while it is on', async () => {
    const pressed = none();
    await hud(pressed);
    tap(lock());

    await activateWithKeyboard(button('Pause'));

    expect(pressed.pause).toBe(1);
  });

  it('is not released by a tap, and is by a held press', async () => {
    const pressed = none();
    await hud(pressed);
    tap(lock());

    tap(lock());
    expect(lock().getAttribute('aria-pressed')).toBe('true');

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    hold(lock(), (ms) => vi.advanceTimersByTime(ms));
    expect(lock().getAttribute('aria-pressed')).toBe('false');

    tap(button('Pause'));
    expect(pressed.pause).toBe(1);
  });

  it('is released at once by a key, as on the Ride screen', async () => {
    await hud(none());
    tap(lock());

    await activateWithKeyboard(lock());

    expect(lock().getAttribute('aria-pressed')).toBe('false');
  });
});
