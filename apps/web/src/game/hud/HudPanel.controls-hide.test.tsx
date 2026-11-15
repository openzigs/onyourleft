// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2600 — the ride's controls hide until touched (`controls-reveal.ts`).
 *
 * What a tap reaches is read off the callbacks the HUD was handed, as
 * `HudPanel.touch-lock.test.tsx` reads them; taps are
 * `design/touch-lock-testing.ts`'s, because a jsdom `click()` is a keyboard's.
 * Whether they are HIDDEN is the HUD's `data-oyl-controls`, which is the one
 * thing `theme.css` §"#2600" reads to clip them; that the clip is what a rider
 * sees, and that a finger then lands on the road, is the browser gate's
 * (`ride-chrome.browser.spec.ts`). jsdom lays nothing out.
 */

import { act, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { tap } from '../../design/touch-lock-testing';
import { mount, queryAll, type Mounted } from '../../testing/mount';
import type { ControllerPort } from '../delivery/controller-port';
import type { PadSnapshot } from '../gamepad-port';
import { atStartLine } from '../simulation';
import { CONTROLS_HIDE_MILLISECONDS, HIDES_ATTRIBUTE } from './controls-reveal';
import { HudCore } from './HudCore';
import { HudPanel, type HudPanelProps } from './HudPanel';
import { REPORT_REASONS_MS } from './RoomReport';
import { BOTS, RIDER, hudOf, startRace, tick } from './lap-race-testing';
import { RIDE_CHROME_STORAGE_KEY, writeRideChrome } from './ride-chrome-preference';

let mounted: Mounted | undefined;
let listed: (PadSnapshot | null)[] = [];

beforeEach(() => {
  listed = [];
  Object.defineProperty(window.navigator, 'getGamepads', {
    configurable: true,
    value: () => listed,
  });
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.useRealTimers();
  localStorage.removeItem(RIDE_CHROME_STORAGE_KEY);
  Reflect.deleteProperty(window.navigator, 'getGamepads');
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

let pressed = { pause: 0, end: 0 };

function ride(more: Partial<HudPanelProps> = {}): JSX.Element {
  return (
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
      {...more}
    />
  );
}

async function hud(more: Partial<HudPanelProps> = {}): Promise<void> {
  pressed = { pause: 0, end: 0 };
  // No `settle`: its macrotask is a `setTimeout`, which these tests fake.
  mounted = await mount(ride(more));
}

function controls(): string | null {
  return mounted?.container.querySelector('.oyl-hud')?.getAttribute('data-oyl-controls') ?? null;
}

function button(name: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(mounted?.container ?? document, 'button').find(
    (each) => (each.textContent ?? '').replace(/\s+/g, ' ').trim() === name,
  );
  if (found === undefined) throw new Error(`no button "${name}" on the HUD`);
  return found;
}

function wait(milliseconds: number): void {
  act(() => {
    vi.advanceTimersByTime(milliseconds);
  });
}

function idle(): void {
  wait(CONTROLS_HIDE_MILLISECONDS);
}

function key(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  });
}

describe('the ride controls hide until touched — #2600', () => {
  it('hide after five seconds with no input, and not a moment before', async () => {
    await hud();
    expect(controls()).toBe('shown');
    wait(CONTROLS_HIDE_MILLISECONDS - 1);
    expect(controls()).toBe('shown');
    wait(1);
    expect(controls()).toBe('hidden');
  });

  it('marks Pause, End ride and the lock as what hides, and the trainer line as what stays', async () => {
    await hud({ trainer: { gradePercent: 3, writes: 1 } });
    const row = button('Pause').closest(`[${HIDES_ATTRIBUTE}]`);
    expect(row).not.toBeNull();
    expect(button('End ride').closest(`[${HIDES_ATTRIBUTE}]`)).toBe(row);
    expect(
      mounted?.container.querySelector('.oyl-hud__trainer')?.closest(`[${HIDES_ATTRIBUTE}]`),
    ).toBeNull();
  });

  it('shows them on the first tap of a hidden control, and presses nothing', async () => {
    await hud();
    idle();
    tap(button('Pause'));
    expect(pressed.pause).toBe(0);
    expect(controls()).toBe('shown');
    // The second tap presses what is now drawn.
    tap(button('Pause'));
    expect(pressed.pause).toBe(1);
    idle();
    tap(button('End ride'));
    expect(pressed.end).toBe(0);
    tap(button('End ride'));
    expect(pressed.end).toBe(1);
  });

  it('shows them on a tap anywhere, and that tap starts the wait again', async () => {
    await hud();
    idle();
    const reading = mounted?.container.querySelector('.oyl-hud__fields--primary') as Element;
    tap(reading);
    expect(controls()).toBe('shown');
    wait(CONTROLS_HIDE_MILLISECONDS - 1);
    tap(reading);
    wait(CONTROLS_HIDE_MILLISECONDS - 1);
    expect(controls()).toBe('shown');
    wait(1);
    expect(controls()).toBe('hidden');
  });

  it('swallows the pointer’s own down and up on a hidden control, not only its click', async () => {
    await hud();
    idle();
    const pause = button('Pause');
    const seen: string[] = [];
    pause.addEventListener('pointerdown', () => seen.push('down'));
    pause.addEventListener('pointerup', () => seen.push('up'));
    // A touch-lock's release begins on a control's own pointerdown: none may.
    tap(pause);
    expect(seen).toEqual([]);
    // Drawn now, the next press reaches the control.
    tap(pause);
    expect(seen).toEqual(['down', 'up']);
  });

  it('holds them drawn while a report’s reasons are on show, and lets go after', async () => {
    await hud({
      room: { nearby: 2 },
      onFollowNext: () => undefined,
      report: {
        target: { riderId: 4, rider: 'Bea' },
        onReport: () => Promise.resolve({ kind: 'reported' }),
      },
    });
    act(() => {
      button('Report Bea').click();
    });
    idle();
    idle();
    expect(controls()).toBe('shown');
    // The reasons close with nothing chosen: the wait starts again.
    wait(REPORT_REASONS_MS);
    idle();
    expect(controls()).toBe('hidden');
  });

  it('lets a keyboard or a screen reader press a hidden control at once', async () => {
    await hud();
    idle();
    // `click()` is a click with `detail` 0: Enter, Space, a screen reader's.
    act(() => {
      button('Pause').click();
    });
    expect(pressed.pause).toBe(1);
  });

  it('lets a key press a hidden control even after a touch that came to nothing', async () => {
    await hud();
    idle();
    // A finger comes down on a reading and slides away: no click follows.
    const reading = mounted?.container.querySelector('.oyl-hud__fields--primary') as Element;
    act(() => {
      reading.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }),
      );
    });
    // Then Enter on Pause, whose click has `detail` 0.
    act(() => {
      button('Pause').click();
    });
    expect(pressed.pause).toBe(1);
  });

  it('shows them on a key, and on focus arriving on one', async () => {
    await hud();
    idle();
    key();
    expect(controls()).toBe('shown');
    idle();
    act(() => {
      button('End ride').focus();
    });
    expect(controls()).toBe('shown');
  });

  it('keeps them while the keyboard holds focus on one, so the ring is never on nothing', async () => {
    await hud();
    key();
    act(() => {
      button('Pause').focus();
    });
    idle();
    idle();
    expect(controls()).toBe('shown');
    // A finger elsewhere: the keyboard no longer holds them.
    tap(mounted?.container.querySelector('.oyl-hud__fields--primary') as Element);
    idle();
    expect(controls()).toBe('hidden');
  });

  it('shows them on a pad’s press', async () => {
    // Steering alone, as a lap race's lane keys: no throw buttons to hold them.
    await hud({ steering: { steer: () => undefined } });
    idle();
    expect(controls()).toBe('hidden');
    listed = [
      {
        connected: true,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, (_, index) => ({ pressed: index === 15 })),
      },
    ];
    act(() => {
      window.dispatchEvent(new Event('gamepadconnected'));
      vi.advanceTimersToNextFrame();
      vi.advanceTimersToNextFrame();
    });
    expect(controls()).toBe('shown');
  });

  it('shows them on a paired controller’s press', async () => {
    let send:
      | ((events: Parameters<Parameters<ControllerPort['onControllerEvents']>[0]>[0]) => void)
      | undefined;
    const controller: ControllerPort = {
      onControllerEvents: (listener) => {
        send = listener;
        return () => undefined;
      },
    };
    await hud({ steering: { steer: () => undefined }, controller });
    idle();
    expect(controls()).toBe('hidden');
    act(() => {
      send?.([{ kind: 'button', button: 1, pressed: true, state: 1 }]);
    });
    expect(controls()).toBe('shown');
  });

  it('stay drawn, whatever the wait, while the ride has a reason to keep them', async () => {
    const finished = tick(startRace({ laps: 1 }), {
      atMs: 60_000,
      effortDistances: { [RIDER]: 1_005, [BOTS[0]]: 10, [BOTS[1]]: 10, [BOTS[2]]: 10 },
    });
    const held: readonly [string, Partial<HudPanelProps>][] = [
      ['paused', { paused: true }],
      ['the end-of-ride question', { endQuestion: <p>End this ride?</p> }],
      ['a notice', { notices: [<p key="fault">Control lost</p>] }],
      [
        'the road not reaching the trainer',
        {
          standingNotice: {
            content: <p>Not reaching</p>,
            expanded: false,
            onToggle: () => undefined,
          },
        },
      ],
      ['a finished lap race', { lapRace: hudOf(finished) }],
      ['the simulated ride’s mark', { simulated: ['This ride is simulated.'] }],
      ['a waiting re-plan', { keepPlan: { sentence: 'Easier next.', onKeep: () => undefined } }],
      ['the side camera filming', { sideCamera: { line: 'Filming', onStop: undefined } }],
      ['a Delivery round’s throw buttons', { throwing: { throwParcel: () => undefined } }],
    ];
    for (const [reason, more] of held) {
      mounted?.unmount();
      await hud(more);
      idle();
      idle();
      expect(controls(), reason).toBe('shown');
    }
    // And the control for that list: a lap race not yet finished does not.
    mounted?.unmount();
    await hud({ lapRace: hudOf(startRace({ laps: 1 })) });
    idle();
    expect(controls()).toBe('hidden');
  });

  it('come back on resuming, and hide again five seconds later', async () => {
    await hud({ paused: true });
    idle();
    expect(controls()).toBe('shown');
    await mounted?.rerender(ride({ paused: false }));
    wait(CONTROLS_HIDE_MILLISECONDS - 1);
    expect(controls()).toBe('shown');
    wait(1);
    expect(controls()).toBe('hidden');
  });

  it('stay drawn for a rider who turned the auto-hide off in Settings', async () => {
    writeRideChrome(localStorage, { autoHide: false, collapsed: [] });
    await hud();
    idle();
    idle();
    expect(controls()).toBe('shown');
    tap(button('Pause'));
    expect(pressed.pause).toBe(1);
  });

  it('never hide on the demo, which renders the HUD with no chrome (SC 2.2.2)', async () => {
    mounted = await mount(
      <HudCore
        profile={profile}
        state={atStartLine(profile)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        chases={[]}
        announcement=""
        paused={false}
        onPause={() => undefined}
        onEnd={() => undefined}
        units="metric"
        touchLock={false}
        labels={{ resume: 'Play', end: 'Stop' }}
        routeFigure={null}
      />,
    );
    idle();
    idle();
    expect(controls()).toBeNull();
    expect(mounted.container.querySelector('.oyl-hud__tab')).toBeNull();
  });
});
