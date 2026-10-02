// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The pre-ride chooser — #940.
 *
 * What jsdom can say about it: the ORDER of the notices and *Ride*, the cards'
 * words through `units/format.ts`, the drawing hidden from assistive
 * technology, the radio group, the ghost for the chosen route, a refused *Ride*
 * that starts nothing — and the module graph, which must reach no renderer and
 * no map (`stage-chooser-imports.test.ts`). Where *Ride* lands on a screen is `browser/ride.browser.spec.ts`
 * §"#940"; the refusals' own wiring through `GameView` is `picker.a11y.test.tsx`.
 */

import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';
import type { UnitSystem } from '@onyourleft/store';

import { formatDistance, formatSmallDistance, measurementText } from '../units/format';
import { auditAccessibility, formatViolations } from '../a11y/audit';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { pacerChoice } from './pacer-choice';
import { DEFAULT_RIDING_POSITION, type RidingPosition } from './rider';
import { RoutePicker, type RidableRoute } from './StageChooser';
import { windChoice } from './wind-choice';

function ridable(id: string, name: string, attempts: number, rise: number): RidableRoute {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 60; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 50) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(20 + rise * Math.sin((index / 60) * Math.PI)),
    });
  }
  return { id, name, profile: routeProfile(points), attempts };
}

const ROUTES: readonly RidableRoute[] = [
  ridable('a', 'Box Hill', 0, 40),
  ridable('b', 'Ditchling', 3, 120),
];

const NOTICES = {
  releaseNotice: 'The trainer did not confirm it let go.',
  trainerPromise: 'Your trainer will follow this route’s hills.',
  trainerNotice: 'A workout is driving your trainer.',
} as const;

interface Options {
  readonly units?: UnitSystem;
  readonly asking?: boolean;
  readonly worldChosen?: boolean;
  readonly notices?: boolean;
  readonly intensity?: string;
  readonly onIntensity?: (value: string) => void;
  readonly onStart?: (route: RidableRoute, ghost: boolean) => Promise<void>;
}

/** The chooser with its own state, as `GameView` holds it. */
function Chooser(options: Options): JSX.Element {
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [withGhost, setWithGhost] = useState(false);
  const [position, setPosition] = useState<RidingPosition>(DEFAULT_RIDING_POSITION);
  const units = options.units ?? 'metric';
  const withPacer = options.intensity !== undefined;
  const intensity = options.intensity ?? '2.5';
  return (
    <main>
      <h1>Trainer game</h1>
      <RoutePicker
        routes={ROUTES}
        picked={picked}
        onPick={setPicked}
        units={units}
        withGhost={withGhost}
        onGhost={setWithGhost}
        withPacer={withPacer}
        onPacer={() => undefined}
        intensity={intensity}
        onIntensity={options.onIntensity ?? (() => undefined)}
        choice={pacerChoice(withPacer, intensity)}
        withWind={false}
        onWind={() => undefined}
        windSpeed=""
        onWindSpeed={() => undefined}
        windFrom="270"
        onWindFrom={() => undefined}
        air={windChoice(false, '', '270', units)}
        windUnit="km/h"
        trainerNotice={options.notices === true ? NOTICES.trainerNotice : undefined}
        trainerPromise={options.notices === true ? NOTICES.trainerPromise : undefined}
        asking={options.asking ?? false}
        releaseNotice={options.notices === true ? NOTICES.releaseNotice : undefined}
        position={position}
        onPosition={setPosition}
        worldChosen={options.worldChosen ?? false}
        onStart={async (route, ghost) => {
          await options.onStart?.(route, ghost);
        }}
      />
    </main>
  );
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function render(options: Options = {}): Promise<Mounted> {
  mounted = await mount(<Chooser {...options} />);
  await settle();
  return mounted;
}

function rideButton(root: ParentNode): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(root, 'button').filter((button) =>
    (button.textContent ?? '').startsWith('Ride '),
  );
  expect(found, 'exactly one Ride').toHaveLength(1);
  return found[0] as HTMLButtonElement;
}

function radios(root: ParentNode): HTMLInputElement[] {
  // The route cards' group. Since #994 the loadout holds a second radio group,
  // the riding position, which is not a route.
  return queryAll<HTMLInputElement>(root, '.oyl-chooser__card input[type="radio"]');
}

describe('#940 — the order of the notices and Ride', () => {
  it('puts every standing notice before Ride, in their old order', async () => {
    const tree = await render({ notices: true, worldChosen: true });
    const ride = rideButton(tree.container);
    const text = tree.container.textContent ?? '';

    const at = (words: string): number => {
      const index = text.indexOf(words);
      expect(index, `"${words}" is on the chooser`).toBeGreaterThanOrEqual(0);
      return index;
    };
    const order = [
      at(NOTICES.releaseNotice),
      at(NOTICES.trainerPromise),
      at(NOTICES.trainerNotice),
      at('Your rides are in the realistic world'),
      at(ride.textContent ?? ''),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));

    // And by the DOM's own reckoning, element against element.
    const statuses = queryAll(tree.container, '.oyl-status');
    expect(statuses).toHaveLength(4);
    for (const status of statuses) {
      expect(
        status.compareDocumentPosition(ride) & Node.DOCUMENT_POSITION_FOLLOWING,
        `${status.textContent ?? ''} comes before Ride`,
      ).toBeTruthy();
    }
  });

  it('says it is asking in the promise’s place, still before Ride, and marks Ride unavailable', async () => {
    const tree = await render({ notices: true, asking: true });
    const text = tree.container.textContent ?? '';
    const asking = text.indexOf('Asking your trainer for control');
    expect(asking).toBeGreaterThanOrEqual(0);
    expect(text).not.toContain(NOTICES.trainerPromise);
    expect(asking).toBeLessThan(text.indexOf('Ride Box Hill'));
    expect(rideButton(tree.container).getAttribute('aria-disabled')).toBe('true');
  });

  it('puts every notice, then Ride, before the cards — in the flow (#940 reviews, B1 and #503)', async () => {
    const tree = await render({ notices: true, worldChosen: true });
    const cards = tree.container.querySelector('.oyl-chooser__cards');
    const ride = rideButton(tree.container);
    const notices = queryAll(tree.container, '.oyl-status');
    expect(notices).toHaveLength(4);
    for (const notice of notices) {
      expect(notice.compareDocumentPosition(ride) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(
      ride.compareDocumentPosition(cards as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
      'Ride comes before the cards',
    ).toBeTruthy();
    // Ride's own box holds Ride and nothing else.
    const go = ride.closest('.oyl-chooser__go');
    expect(go?.children).toHaveLength(1);
  });

  it('puts the cards before the loadout', async () => {
    const tree = await render();
    const cards = tree.container.querySelector('.oyl-chooser__cards');
    const loadout = tree.container.querySelector('.oyl-chooser__loadout');
    expect(cards).not.toBeNull();
    expect(loadout).not.toBeNull();
    expect(
      (cards as Element).compareDocumentPosition(loadout as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('#940 — the route cards', () => {
  it('is one radio group, the first route chosen, and Ride names the chosen route', async () => {
    const tree = await render();
    const group = radios(tree.container);
    expect(group).toHaveLength(ROUTES.length);
    expect(new Set(group.map((radio) => radio.name)).size).toBe(1);
    expect(group.map((radio) => radio.checked)).toEqual([true, false]);
    expect(rideButton(tree.container).textContent).toBe('Ride Box Hill');

    await activateWithKeyboard(group[1] as HTMLInputElement);
    await settle();
    expect(radios(tree.container).map((radio) => radio.checked)).toEqual([false, true]);
    expect(rideButton(tree.container).textContent).toBe('Ride Ditchling');
  });

  it('starts the CHOSEN route, with the ghost only where there is an attempt', async () => {
    const onStart = vi.fn<(route: RidableRoute, ghost: boolean) => Promise<void>>(() =>
      Promise.resolve(),
    );
    const tree = await render({ onStart });
    await activateWithKeyboard(radios(tree.container)[1] as HTMLInputElement);
    await settle();
    const ghost = queryAll<HTMLInputElement>(tree.container, '.oyl-game__ghost input')[0];
    expect(ghost?.disabled).toBe(false);
    await activateWithKeyboard(ghost as HTMLInputElement);
    await activateWithKeyboard(rideButton(tree.container));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0]?.[0].id).toBe('b');
    expect(onStart.mock.calls[0]?.[1]).toBe(true);
  });

  it('does not show a ghost ticked on one route as ticked on a route never ridden (#940 review)', async () => {
    const tree = await render();
    await activateWithKeyboard(radios(tree.container)[1] as HTMLInputElement);
    await settle();
    const ghost = (): HTMLInputElement =>
      queryAll<HTMLInputElement>(tree.container, '.oyl-game__ghost input')[0] as HTMLInputElement;
    await activateWithKeyboard(ghost());
    expect(ghost().checked).toBe(true);
    await activateWithKeyboard(radios(tree.container)[0] as HTMLInputElement);
    await settle();
    expect(ghost().disabled).toBe(true);
    expect(ghost().checked).toBe(false);
  });

  it('offers the ghost disabled, with the reason as its label, on a route never ridden (#93)', async () => {
    const tree = await render();
    const ghost = queryAll<HTMLInputElement>(tree.container, '.oyl-game__ghost input')[0];
    expect(ghost?.disabled).toBe(true);
    expect(ghost?.closest('label')?.textContent).toBe('Race your best — ride it once first');
  });

  for (const units of ['metric', 'imperial'] as const) {
    it(`states each route's distance and climb in words, in ${units} units`, async () => {
      const tree = await render({ units });
      const cards = queryAll(tree.container, '.oyl-chooser__card');
      expect(cards).toHaveLength(ROUTES.length);
      ROUTES.forEach((route, index) => {
        const card = cards[index] as HTMLElement;
        const distance = measurementText(formatDistance(route.profile.totalDistance, units));
        const climb = measurementText(formatSmallDistance(route.profile.totalAscent, units));
        const facts = card.querySelector('.oyl-chooser__facts');
        expect(facts?.textContent).toBe(`${distance} · climb ${climb}`);
        // The radio is described by the words, so a screen reader hears them.
        const radio = card.querySelector('input[type="radio"]');
        expect(radio?.getAttribute('aria-describedby')).toBe(facts?.id);
        expect(card.querySelector('h3')?.textContent).toBe(route.name);
      });
    });
  }

  it('draws each route’s shape, hidden from assistive technology', async () => {
    const tree = await render();
    const shapes = queryAll(tree.container, '.oyl-chooser__card svg');
    expect(shapes).toHaveLength(ROUTES.length);
    for (const shape of shapes) {
      expect(shape.getAttribute('aria-hidden')).toBe('true');
      expect(shape.querySelector('path')).not.toBeNull();
      expect(shape.textContent).toBe('');
    }
  });

  it('audits clean', async () => {
    await render({ notices: true, worldChosen: true });
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});

describe('#940 — a refused Ride (#255)', () => {
  it('stays focusable, names its reason, and starts nothing', async () => {
    const onStart = vi.fn(() => Promise.resolve());
    const tree = await render({ intensity: '70', onStart });
    const ride = rideButton(tree.container);
    expect(ride.disabled).toBe(false);
    expect(ride.getAttribute('aria-disabled')).toBe('true');
    const reason = document.getElementById(ride.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toContain('70');
    await activateWithKeyboard(ride);
    expect(onStart).not.toHaveBeenCalled();
  });
});

describe('#994 — game-style controls in the loadout', () => {
  it('draws each on/off as a switch that is still a checkbox', async () => {
    const tree = await render({ intensity: '2.5' });
    for (const kind of ['ghost', 'pacer', 'wind']) {
      const box = tree.container.querySelector<HTMLInputElement>(`.oyl-game__${kind} input`);
      expect(box?.type, kind).toBe('checkbox');
      expect(box?.getAttribute('role'), kind).toBe('switch');
    }
  });

  it('offers the riding position as three radios, all on the screen at once', async () => {
    const tree = await render();
    const group = queryAll<HTMLInputElement>(
      tree.container,
      '.oyl-game__position input[type="radio"]',
    );
    expect(group.map((radio) => radio.value)).toEqual(['upright', 'hoods', 'drops']);
    expect(new Set(group.map((radio) => radio.name)).size).toBe(1);
    expect(tree.container.querySelector('.oyl-game__position legend')?.textContent).toBe(
      'How you are riding',
    );
    expect(group.find((radio) => radio.checked)?.value).toBe(DEFAULT_RIDING_POSITION);
    await activateWithKeyboard(group[2] as HTMLInputElement);
    await settle();
    expect(
      queryAll<HTMLInputElement>(tree.container, '.oyl-game__position input:checked')[0]?.value,
    ).toBe('drops');
  });

  it('steps the pacer intensity with − and +, and the box keeps its own name', async () => {
    const typed: string[] = [];
    const tree = await render({ intensity: '2.5', onIntensity: (value) => typed.push(value) });
    const box = tree.container.querySelector<HTMLInputElement>('#oyl-game-pacer-intensity');
    // The buttons are beside the box, not in its label, so the box is named by
    // its words alone and not "… Decrease 2.5 Increase".
    expect(box?.labels?.[0]?.textContent).toBe('Pacer intensity, watts per kilogram');
    const increase = queryAll<HTMLButtonElement>(tree.container, 'button').find(
      (button) => button.getAttribute('aria-label') === 'Increase pacer intensity',
    );
    await activateWithKeyboard(increase as HTMLButtonElement);
    expect(typed).toEqual(['2.6']);
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });
});
