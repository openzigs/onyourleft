// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The setup on a built-in Delivery level — #2362, the owner's ruling of
 * 2026-11-08 on PR #2378: the chooser's summary counts the rider's own routes
 * and never the level, the OpenStreetMap credit stands beside the level's card
 * (ADR 0065 D-6.5), and with the standard world chosen the chooser says the
 * level rides in the realistic world while offering its round.
 *
 * The real `RoutePicker`, handed what `GameView` hands it: the level's card
 * first among the routes and a `level` offer naming it. The level is the
 * synthetic fixture level (ADR 0065 D-7.5).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { northRoute } from '../../route-fixtures-testing';
import { OSM_ATTRIBUTION } from '../../../map/basemap';
import { hrefFor, routeById } from '../../../shell/routes';
import { mount, queryAll, settle, type Mounted } from '../../../testing/mount';
import { pacerChoice } from '../../pacer-choice';
import { DEFAULT_RIDING_POSITION, type RidingPosition } from '../../rider';
import {
  BUILT_IN_CIRCUITS_TEXT,
  DELIVERY_CHOICE_TEXT,
  LEVEL_SETUP_TEXT,
  RoutePicker,
  type DeliveryCourse,
  type RidableRoute,
} from '../../StageChooser';
import { windChoice } from '../../wind-choice';

import { parseLevelFile } from './level-file';
import { levelRoute } from './levels';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = parseLevelFile(
  JSON.parse(readFileSync(join(HERE, 'fixtures', 'fixture-level.json'), 'utf8')) as unknown,
  'fixture-level',
);
const LEVEL = levelRoute(FIXTURE);

const OWN: readonly RidableRoute[] = ['First road', 'Second road'].map((name, index) => ({
  id: `saved-${String(index)}`,
  name,
  profile: northRoute(1_500 + 100 * index, () => 0),
  attempts: 0,
}));

interface Options {
  readonly own?: readonly RidableRoute[];
  readonly worldChosen?: boolean;
  readonly courses?: ReadonlyMap<string, DeliveryCourse>;
}

/** The chooser on the level, as `GameView` hands it over. */
function Chooser(options: Options): JSX.Element {
  const [picked, setPicked] = useState<string | undefined>(LEVEL.id);
  const [position, setPosition] = useState<RidingPosition>(DEFAULT_RIDING_POSITION);
  return (
    <main>
      <RoutePicker
        routes={[LEVEL, ...(options.own ?? OWN)]}
        level={{ routeId: LEVEL.id, credit: OSM_ATTRIBUTION }}
        picked={picked}
        onPick={setPicked}
        units="metric"
        withGhost={false}
        onGhost={() => undefined}
        withPacer={false}
        onPacer={() => undefined}
        intensity="2.5"
        onIntensity={() => undefined}
        choice={pacerChoice(false, '2.5')}
        withWind={false}
        onWind={() => undefined}
        windSpeed=""
        onWindSpeed={() => undefined}
        windFrom="270"
        onWindFrom={() => undefined}
        air={windChoice(false, '', '270', 'metric')}
        windUnit="km/h"
        trainerNotice={undefined}
        trainerPromise={undefined}
        asking={false}
        releaseNotice={undefined}
        position={position}
        onPosition={setPosition}
        worldChosen={options.worldChosen ?? true}
        delivery={{
          chosen: true,
          onChoose: () => undefined,
          week: { day: 2, houses: FIXTURE.round.houses },
          courses: options.courses,
        }}
        onStart={() => Promise.resolve()}
      />
    </main>
  );
}

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function render(options: Options = {}): Promise<HTMLElement> {
  mounted = await mount(<Chooser {...options} />);
  await settle();
  return mounted.container;
}

const counted = (houses: number): DeliveryCourse => ({ kind: 'counted', houses });

/** The cards' summary line, as drawn. */
function summary(root: HTMLElement): string | undefined {
  return [...root.querySelectorAll('.oyl-chooser__routes p')]
    .map((each) => each.textContent ?? '')
    .find((each) => /can hold today|cannot hold today|being counted/.test(each));
}

describe('the setup on a built-in level — #2362, round 2', () => {
  it('counts only the rider’s own routes in the summary, never the level', async () => {
    const [first, second] = OWN;
    if (first === undefined || second === undefined) throw new Error('two own routes');
    const root = await render({
      courses: new Map([
        [LEVEL.id, counted(FIXTURE.round.houses)],
        [first.id, counted(FIXTURE.round.houses)],
        [second.id, counted(0)],
      ]),
    });
    expect(summary(root)).toBe('1 of your 2 routes can hold today’s Delivery round.');
  });

  it('says nothing of “your routes” when the level is the only card', async () => {
    const root = await render({
      own: [],
      courses: new Map([[LEVEL.id, counted(FIXTURE.round.houses)]]),
    });
    expect(summary(root)).toBeUndefined();
    expect(root.textContent).not.toMatch(/your route/i);
  });

  it('shows the OpenStreetMap credit and the way to the licence beside the level’s card', async () => {
    const root = await render();
    const credit = root.querySelector('[data-credit="level"]');
    expect(credit?.textContent).toContain(OSM_ATTRIBUTION);
    expect(credit?.querySelector('a')?.textContent).toBe(BUILT_IN_CIRCUITS_TEXT.licence);
    expect(credit?.querySelector('a')?.getAttribute('href')).toBe(hrefFor(routeById('credits')));
    // Beside the level's card: straight after its list, before the rider's own cards.
    const levelCard = [...root.querySelectorAll('.oyl-chooser__card')].find(
      (card) => card.querySelector('input')?.getAttribute('value') === LEVEL.id,
    );
    expect(levelCard?.parentElement?.nextElementSibling).toBe(credit);
    // One radio group still: the level and the rider's routes are one choice.
    const names = new Set(
      queryAll<HTMLInputElement>(root, '.oyl-chooser__card input[type="radio"]').map(
        (radio) => radio.name,
      ),
    );
    expect(names.size).toBe(1);
  });

  it('with the standard world chosen, says the level rides in the realistic world and offers its round', async () => {
    const root = await render({ worldChosen: false });
    expect(root.querySelector('[data-level-world]')?.textContent).toBe(LEVEL_SETUP_TEXT.world);
    expect(root.textContent).toContain(DELIVERY_CHOICE_TEXT.label);
    // A saved route chosen instead keeps the standard world's chooser: no round, no level line.
    const own = queryAll<HTMLInputElement>(root, '.oyl-chooser__card input[type="radio"]').find(
      (radio) => radio.value === OWN[0]?.id,
    );
    own?.click();
    await settle();
    expect(root.querySelector('[data-level-world]')).toBeNull();
    expect(root.textContent).not.toContain(DELIVERY_CHOICE_TEXT.label);
  });

  it('with the realistic world chosen, says that world’s own line, not the level’s', async () => {
    const root = await render({ worldChosen: true });
    expect(root.querySelector('[data-level-world]')).toBeNull();
    expect(root.querySelector('.oyl-chooser__world-label')?.textContent).toBe('Realistic world');
  });
});
