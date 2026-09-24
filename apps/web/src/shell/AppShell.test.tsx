// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The shell's own behaviour, as distinct from the accessibility properties
 * `../a11y/routes.a11y.test.tsx` asserts across every route.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { act } from 'react';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  kilograms,
  routeProfile,
  watts,
  type Kilograms,
  type RoutePoint,
} from '@onyourleft/domain';
import { athleteId, type AthleteRecord } from '@onyourleft/store';

import type { AthleteMassPort } from '../athlete/store-port';
import type { GamePort, RidableRoute } from '../game/GameView';
import type { ThermalPort } from '../game/thermal-port';
import { activateWithKeyboard, mount, settle, typeInto, type Mounted } from '../testing/mount';
import type { CapabilityProbe } from '../support/bluetooth-support';
import type { ShellSupport } from '../support/shell-support-port';
import { MASS_CLEARED, MASS_SAVED } from '../views/SettingsView';

import { AppShell } from './AppShell';
import { hrefFor, routeById } from './routes';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

/** What the plugin says on a phone where everything works. */
const PHONE_CAN_PAIR: ShellSupport = { kind: 'available', canPair: true, notice: null };

/** The `h2`s the rendered view carries, which is where the two halves differ. */
function viewSections(): (string | null)[] {
  return [...document.querySelectorAll('main h2')].map((heading) => heading.textContent);
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
});

async function open(path: string): Promise<void> {
  globalThis.location.hash = `#${path}`;
  mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
  await settle();
}

describe('the router', () => {
  it('renders the view the fragment selects, including on first load', async () => {
    // Not "renders the default and then corrects itself". `useRoute` uses
    // `useSyncExternalStore` precisely so the first paint is already right; an
    // effect-based reader would flash the ride view here.
    await open('/about');
    expect(document.querySelector('h1')?.textContent).toBe(routeById('about').title);
  });

  it('follows a link rendered inside a view, not only one in the header', async () => {
    await open('/ride');
    const link = document.querySelector<HTMLAnchorElement>(
      `main a[href="${hrefFor(routeById('devices'))}"]`,
    );
    expect(link).not.toBeNull();
    await activateWithKeyboard(link as HTMLAnchorElement);
    expect(document.querySelector('h1')?.textContent).toBe(routeById('devices').title);
  });

  it('shows the not-found view for an address that matches nothing, with a way out', async () => {
    await open('/there-is-no-such-page');
    expect(document.querySelector('h1')?.textContent).toBe('That page does not exist');
    // The way out is the point. A not-found page with no links is a dead end
    // for a keyboard user.
    expect(document.querySelectorAll('main a').length).toBeGreaterThan(0);
  });

  it('reaches the credits from the About page, and renders the real ones', async () => {
    // ⚠️ Two things no other test in the shell can see. The accessibility
    // suite opens every route and checks the `h1`, so a `case 'credits'`
    // wired to the wrong component would pass it — the heading comes from the
    // route table, not from the view. And the credits page has no header
    // navigation entry by design (ADR 0023 D-3 puts it beside the licence
    // statement on About), so this link is the only way a rider reaches the
    // attribution notice at all.
    await open('/about');
    const link = document.querySelector<HTMLAnchorElement>(
      `main a[href="${hrefFor(routeById('credits'))}"]`,
    );
    expect(link, 'the About page does not link to the credits').not.toBeNull();
    await activateWithKeyboard(link as HTMLAnchorElement);
    await settle();

    expect(document.querySelector('h1')?.textContent).toBe(routeById('credits').title);
    // Generated from `ASSETS.toml`, so this is what the manifest says today
    // rather than a string in a view.
    expect(document.querySelector('main')?.textContent ?? '').toContain('Kenney');
  });

  it('stops listening for navigation once it is unmounted', async () => {
    await open('/');
    mounted?.unmount();
    mounted = undefined;
    // A subscription that outlived the tree would set state on it here. The
    // assertion is the absence of a React warning, which `mount` would have
    // reported through `caughtErrors` and React through console.
    globalThis.location.hash = '#/about';
    await settle();
    expect(document.querySelector('h1')).toBeNull();
  });
});

describe('the header', () => {
  it('names its navigation landmark, so it is distinguishable in a landmark list', async () => {
    await open('/');
    expect(document.querySelector('nav')?.getAttribute('aria-label')).toBe('Primary');
  });

  it('offers five destinations, each an icon and a word — #427, #428', async () => {
    await open('/');
    const primary = [...document.querySelectorAll('nav[aria-label="Primary"] a')];
    expect(primary.map((a) => a.getAttribute('href'))).toEqual([
      '#/',
      '#/ride',
      '#/activities',
      '#/routes',
      '#/devices',
    ]);
    expect(primary.map((a) => a.textContent)).toEqual([
      'Home',
      'Ride',
      'History',
      'Routes',
      'More',
    ]);
    for (const link of primary) {
      // The icon is decoration; the word is the name.
      expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('lists the current group’s pages, and only that group’s', async () => {
    await open('/ride');
    const pages = [...document.querySelectorAll('nav[aria-label="Ride pages"] a')];
    expect(pages.map((a) => a.getAttribute('href'))).toEqual(['#/ride', '#/game', '#/workouts']);
    expect(document.querySelector('nav[aria-label="History pages"]')).toBeNull();
  });

  it('draws no second row for a group of one page', async () => {
    await open('/routes');
    expect(document.querySelectorAll('nav')).toHaveLength(1);
    expect(
      document
        .querySelector('nav[aria-label="Primary"] a[href="#/routes"]')
        ?.getAttribute('aria-current'),
    ).toBe('page');
  });

  it('marks the current group as current and the current page as the page — never two pages', async () => {
    await open('/analysis');
    const history = document.querySelector('nav[aria-label="Primary"] a[href="#/activities"]');
    expect(history?.getAttribute('aria-current')).toBe('true');
    const pages = [...document.querySelectorAll('a[aria-current="page"]')];
    expect(pages.map((a) => a.getAttribute('href'))).toEqual(['#/analysis']);
  });
});

describe('the Devices screen inside the Android shell', () => {
  // ⚠️ **This is the second JSX hop #284's port travels through, and the one
  // nothing else watches.** The #278 gate sees the *view*'s read of
  // `ShellSupportPort` (`WIRE003`), and `DevicesView.shell.test.tsx` drives the
  // component directly with a port in hand — so replacing the `devices` case in
  // `AppShell.tsx` with `<DevicesView capabilities={props.capabilities} />`
  // leaves the whole suite, `check:wiring`, `typecheck` and `lint` green while a
  // rider on Android is silently back on the WebView's answer, which is #284 in
  // full. Measured. These two tests are what notices.
  it('hands the screen the shell port when `main.tsx` supplied one', async () => {
    const readShellSupport = vi.fn<() => Promise<ShellSupport>>().mockResolvedValue(PHONE_CAN_PAIR);
    globalThis.location.hash = '#/devices';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} shell={{ readShellSupport }} />);
    await settle();

    // The port was reached at all — the prop arrived rather than being dropped.
    expect(readShellSupport).toHaveBeenCalledTimes(1);
    // And the rider-visible half: the shell branch heads its answer "This
    // phone". `NO_BLUETOOTH` is deliberately the capabilities here, so a screen
    // that fell back to the browser probe would render the browser heading and
    // "Sensors cannot be paired in this browser" underneath it.
    expect(viewSections()).toContain('This phone');
    expect(viewSections()).not.toContain('This browser');
  });

  it('leaves the browser branch alone when there is no port', async () => {
    await open('/devices');
    expect(viewSections()).toContain('This browser');
    expect(viewSections()).not.toContain('This phone');
  });
});

describe('the view heading', () => {
  it('is the single h1 and is what names the main landmark', async () => {
    await open('/devices');
    const main = document.querySelector('main');
    const headings = document.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(main?.getAttribute('aria-labelledby')).toBe(headings[0]?.id);
  });

  it('is focusable programmatically without joining the tab order', async () => {
    await open('/');
    expect(document.querySelector('main')?.getAttribute('tabindex')).toBe('-1');
  });
});

/**
 * The rider's weight, threaded from the athlete row to the two screens that
 * need it (#325).
 *
 * ⚠️ **This is the half `check:wiring` cannot see.** `check-wiring.mjs`
 * §Limits records that an optional prop nobody supplies is invisible to it, so
 * `WIRE003` covers "the settings screen calls the port" and nothing covers "the
 * shell hands the settings screen a port" or "the shell hands the game a mass".
 * Both are asserted here.
 *
 * The second case is the one worth having: a setting that needs a page reload
 * to take effect is a setting a rider reports as broken.
 */
describe('what the rider weighs (#325)', () => {
  /** A port that accepts a weight and answers with the row it wrote. */
  function massPort(writes: (number | undefined)[]): AthleteMassPort {
    const owner = athleteId('local');
    return {
      athleteId: owner,
      store: {
        setAthleteMass: (id, mass): Promise<AthleteRecord | undefined> => {
          writes.push(mass);
          return Promise.resolve({
            id,
            displayName: 'You',
            createdAt: 0 as AthleteRecord['createdAt'],
            ...(mass === undefined ? {} : { mass }),
          });
        },
      },
    };
  }

  /** The one button on the weight panel, found by its words rather than by order. */
  function saveWeight(): void {
    const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(
      (candidate) => candidate.textContent === 'Save weight',
    );
    if (button === undefined) {
      throw new Error('the Save weight button is not on the page');
    }
    button.click();
  }

  it('shows the settings screen the stored weight, in the stored units', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        athleteMass={massPort([])}
        riderMass={kilograms(62.4)}
      />,
    );
    await settle();

    expect(document.querySelector<HTMLInputElement>('#oyl-rider-mass')?.value).toBe('62.4');
  });

  it('offers no weight box when `main.tsx` supplied no port', async () => {
    // The port is what makes the control exist, so its absence is what the
    // accessibility suite would otherwise audit instead of the control —
    // `routes.a11y.test.tsx` §`settingsPort` records that trap.
    globalThis.location.hash = '#/settings';
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} />);
    await settle();

    expect(document.querySelector('#oyl-rider-mass')).toBeNull();
  });

  it('keeps the new weight after a save, without a reload', async () => {
    // ⚠️ The shell **owns** the live value from the prop onwards, exactly as it
    // does for the unit preference. A shell that went on rendering
    // `props.riderMass` would show the rider their old weight the moment they
    // saved a new one, and would ride them at it.
    const writes: (number | undefined)[] = [];
    globalThis.location.hash = '#/settings';
    mounted = await mount(
      <AppShell
        capabilities={NO_BLUETOOTH}
        athleteMass={massPort(writes)}
        riderMass={kilograms(70)}
      />,
    );
    await settle();

    const box = document.querySelector<HTMLInputElement>('#oyl-rider-mass');
    if (box === null) {
      throw new Error('the weight box is not on the page');
    }
    await typeInto(box, '64');
    saveWeight();
    await settle();

    expect(writes).toEqual([64]);
    expect(document.querySelector<HTMLInputElement>('#oyl-rider-mass')?.value).toBe('64.0');
    expect(document.body.textContent).not.toContain('You have not entered one');
  });

  /**
   * ⚠️ **These two are here rather than in `SettingsView.test.tsx` because that
   * file cannot see the defect they cover.** Every view-level case passes
   * `onRiderMassChange={() => undefined}`, so the `riderMass` prop never moves;
   * in the shell it does, and `WeightField` is keyed on it. A successful save
   * therefore remounted the field and threw away the confirmation the same
   * handler had just set — CLAUDE.md §5's *wrong harness*, where the double is
   * inert in exactly the dimension the bug lives in.
   *
   * The confirmation is a `StatusMessage live`, which is the **only**
   * announcement a screen-reader user gets that the write landed, so losing it
   * is not cosmetic.
   */
  it('confirms a saved weight, which is the only announcement of the write', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(
      <AppShell capabilities={NO_BLUETOOTH} athleteMass={massPort([])} riderMass={kilograms(70)} />,
    );
    await settle();

    const box = document.querySelector<HTMLInputElement>('#oyl-rider-mass');
    if (box === null) {
      throw new Error('the weight box is not on the page');
    }
    await typeInto(box, '64');
    saveWeight();
    await settle();

    expect(document.body.textContent).toContain(MASS_SAVED);
  });

  it('confirms a cleared weight, on the branch that returns the rider to the default', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(
      <AppShell capabilities={NO_BLUETOOTH} athleteMass={massPort([])} riderMass={kilograms(70)} />,
    );
    await settle();

    const box = document.querySelector<HTMLInputElement>('#oyl-rider-mass');
    if (box === null) {
      throw new Error('the weight box is not on the page');
    }
    await typeInto(box, '');
    saveWeight();
    await settle();

    expect(document.body.textContent).toContain(MASS_CLEARED);
  });

  /**
   * The control that stops the two above being satisfied by a panel that always
   * says something. Re-saving the weight already on the row leaves the key
   * unchanged, so this case passed even while both of those failed — which is
   * the inversion worth keeping: before the fix the confirmation appeared
   * exactly when nothing had changed.
   */
  it('confirms a re-save of the weight already on the row', async () => {
    globalThis.location.hash = '#/settings';
    mounted = await mount(
      <AppShell capabilities={NO_BLUETOOTH} athleteMass={massPort([])} riderMass={kilograms(70)} />,
    );
    await settle();

    const box = document.querySelector<HTMLInputElement>('#oyl-rider-mass');
    if (box === null) {
      throw new Error('the weight box is not on the page');
    }
    await typeInto(box, '70');
    saveWeight();
    await settle();

    expect(document.body.textContent).toContain(MASS_SAVED);
  });
});

/**
 * …and all the way into the game, which is the link no other test covered.
 *
 * ⚠️ **This block exists because a mutation found a hole rather than because
 * it was planned.** Deleting `riderMass={riderMass}` from the shell's
 * `<GameView>` left every test in this repository green: `GameView.test.tsx`
 * supplies the prop itself, and `check:wiring` cannot see a prop that is simply
 * not passed — `check-wiring.mjs` §Limits states that limit in so many words.
 * So the one link between the athlete row and the physics had nothing holding
 * it, which is the whole shape of #325 arriving one layer up.
 *
 * It reads the **HUD**, not the renderer: the speed a rider looks at is a
 * function of the mass the simulation was built with, it needs no WebGL, and it
 * is what a rider would actually notice going wrong.
 */
describe('the weight reaches the ride (#325)', () => {
  /** One route with a climb in it, so mass has somewhere to show. */
  function ridableRoute(): RidableRoute {
    const points: RoutePoint[] = [];
    for (let index = 0; index <= 200; index += 1) {
      points.push({
        position: geographicPosition(
          degreesLatitude(51.5 + (index * 10) / 111_320),
          degreesLongitude(-0.12),
        ),
        elevation: altitudeMetres(index * 0.6),
      });
    }
    return { id: 'route-1', name: 'Test climb', profile: routeProfile(points), attempts: 0 };
  }

  function pedallingPort(): GamePort {
    return {
      listRoutes: () => Promise.resolve([ridableRoute()]),
      loadGhost: () => Promise.resolve(undefined),
      readSensors: () => ({
        rider: { power: watts(240), live: true, paired: true },
        cadence: { value: 85, live: true, paired: true },
        heartRate: { value: 140, live: true, paired: true },
      }),
    };
  }

  /** Ride the climb for a minute at this weight and report what the HUD says. */
  async function hudSpeedAt(riderMass: Kilograms): Promise<string> {
    const frames: FrameRequestCallback[] = [];
    let clockMs = 1_000_000;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    vi.stubGlobal('performance', { now: () => clockMs });

    globalThis.location.hash = '#/game';
    const shell = await mount(
      <AppShell capabilities={NO_BLUETOOTH} game={pedallingPort()} riderMass={riderMass} />,
    );
    await settle();

    const ride = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    if (ride === undefined) {
      throw new Error('the route picker offered no ride');
    }
    await act(async () => {
      ride.click();
      await Promise.resolve();
    });
    await settle();

    for (let index = 0; index < 240; index += 1) {
      const next = frames.shift();
      if (next === undefined) {
        break;
      }
      clockMs += 250;
      await act(async () => {
        next(clockMs);
        await Promise.resolve();
      });
    }
    await settle();

    const speed = [...document.querySelectorAll('.oyl-hud__field')].find((field) =>
      (field.querySelector('.oyl-hud__label')?.textContent ?? '').includes('Speed'),
    );
    const text = speed?.querySelector('.oyl-hud__value')?.textContent ?? '';
    shell.unmount();
    vi.unstubAllGlobals();
    // A fixture guard: a HUD showing a dash, or nothing, would make every
    // comparison below pass over two blanks.
    expect(text).toMatch(/\d/);
    return text;
  }

  it('shows a light rider a different speed on a climb than a heavy one', async () => {
    // ⚠️ The same route, the same power, the same clock, the same number of
    // frames — the only difference is what the shell was told the rider weighs.
    // Remove `riderMass` from the shell's `<GameView>` and these agree.
    const light = await hudSpeedAt(kilograms(55));
    const heavy = await hudSpeedAt(kilograms(105));

    expect(light).not.toBe(heavy);
  });
});

/**
 * …and the thermal forecast reaches the game's ladder (#247).
 *
 * The same hole the block above closes, one prop along: `thermal` is an
 * optional prop threaded through JSX, so deleting it from the shell's
 * `<GameView>` would be green in `check:wiring` and in `GameView.test.tsx`,
 * which supplies it itself. A ride started through the shell must ask the
 * port the shell was handed.
 */
describe('the thermal forecast reaches the ride (#247)', () => {
  it('asks the port it was handed once a ride starts', async () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    let asked = 0;
    const thermal: ThermalPort = {
      readThermalHeadroom: () => {
        asked += 1;
        return Promise.resolve(0.3);
      },
    };
    const route: RidableRoute = {
      id: 'route-1',
      name: 'Flat',
      profile: routeProfile(
        [0, 1, 2].map((index) => ({
          position: geographicPosition(
            degreesLatitude(51.5 + (index * 500) / 111_320),
            degreesLongitude(-0.12),
          ),
          elevation: altitudeMetres(0),
        })),
      ),
      attempts: 0,
    };
    const game: GamePort = {
      listRoutes: () => Promise.resolve([route]),
      loadGhost: () => Promise.resolve(undefined),
      readSensors: () => ({
        rider: { power: watts(200), live: true, paired: true },
        cadence: { value: 85, live: true, paired: true },
        heartRate: { value: 140, live: true, paired: true },
      }),
    };

    globalThis.location.hash = '#/game';
    const shell = await mount(
      <AppShell capabilities={NO_BLUETOOTH} game={game} thermal={thermal} />,
    );
    await settle();
    // Nothing is asked before a ride: the picker has no ladder.
    expect(asked).toBe(0);

    const ride = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      (button.textContent ?? '').startsWith('Ride '),
    );
    await act(async () => {
      ride?.click();
      await Promise.resolve();
    });
    await settle();

    expect(asked).toBeGreaterThan(0);
    shell.unmount();
    vi.unstubAllGlobals();
  });
});
