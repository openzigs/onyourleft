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
import { stripComments } from '../../../units/no-inline-units';
import { pacerChoice } from '../../pacer-choice';
import { DEFAULT_RIDING_POSITION, type RidingPosition } from '../../rider';
import { DEFAULT_LAP_RACE_CHOICE } from '../../lap-race/choice';
import {
  BUILT_IN_CIRCUITS_TEXT,
  DELIVERY_CHOICE_TEXT,
  LAP_RACE_CHOICE_TEXT,
  LEVEL_SETUP_TEXT,
  LEVEL_WORLD_ID,
  RoutePicker,
  type DeliveryCourse,
  type RidableRoute,
} from '../../StageChooser';
import { REALISTIC_DOWNLOAD_SIZE_TEXT } from '../../realistic-assets';
import { windChoice } from '../../wind-choice';

import { parseLevelFile } from './level-file';
import { levelRoute } from './levels';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = parseLevelFile(
  JSON.parse(readFileSync(join(HERE, 'fixtures', 'fixture-level.json'), 'utf8')) as unknown,
  'fixture-level',
);

function ownRoute(index: number): RidableRoute {
  return {
    id: `saved-${String(index)}`,
    name: index === 0 ? 'First road' : 'Second road',
    profile: northRoute(1_500 + 100 * index, () => 0),
    attempts: 0,
  };
}
const OWN: readonly RidableRoute[] = [ownRoute(0), ownRoute(1)];

// The shipped levels are loops; the fixture's line is not, so it is ridden here as one.
const LEVEL: RidableRoute = (() => {
  const route = levelRoute(FIXTURE);
  return { ...route, profile: { ...route.profile, loop: true } };
})();
/** A built-in circuit, as the lap race's chooser holds one. */
const CIRCUIT: RidableRoute = { ...ownRoute(9), id: 'circuit:ring', name: 'Ring' };

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
        level={{ routeId: LEVEL.id, credit: OSM_ATTRIBUTION, houses: FIXTURE.round.houses }}
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
        lapRace={{
          chosen: false,
          onChoose: () => undefined,
          choice: DEFAULT_LAP_RACE_CHOICE,
          onChoice: () => undefined,
          assisted: false,
        }}
        circuits={{ circuits: [CIRCUIT], credit: OSM_ATTRIBUTION }}
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
    // Drawn over the rider's own cards, after the level's card and its credit, so it
    // does not read as describing the level (review of PR #2378, round 3).
    const line = [...root.querySelectorAll('.oyl-chooser__routes p')].find(
      (each) => each.textContent === summary(root),
    );
    const credit = root.querySelector('[data-credit="level"]');
    const ownCard = [...root.querySelectorAll('.oyl-chooser__card')].find(
      (card) => card.querySelector('input')?.getAttribute('value') === first.id,
    );
    expect(
      credit && line && credit.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      line && ownCard && line.compareDocumentPosition(ownCard) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('tells a browser rider the realistic world is downloaded, and the Android app nothing of the kind', () => {
    // The size and the offline rule in Settings' own terms, the size from the one shared constant.
    expect(LEVEL_SETUP_TEXT.world(false)).toContain(
      `downloads it when the ride starts, ${REALISTIC_DOWNLOAD_SIZE_TEXT}, and does not keep it on this device for use offline.`,
    );
    expect(LEVEL_SETUP_TEXT.world(true)).not.toMatch(/download|MB/);
    for (const inShell of [false, true]) {
      expect(LEVEL_SETUP_TEXT.world(inShell)).toContain('Your choice in Settings stays as it is.');
      expect(LEVEL_SETUP_TEXT.world(inShell)).not.toContain('—');
    }
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
    const notice = root.querySelector(`#${LEVEL_WORLD_ID}`);
    expect(notice?.textContent).toContain(
      `${LEVEL_SETUP_TEXT.worldLabel}: ${LEVEL_SETUP_TEXT.world(false)}`,
    );
    // The app's info notice, not the compact world line (review of PR #2378, round 3).
    expect(notice?.classList.contains('oyl-status')).toBe(true);
    expect(notice?.closest('.oyl-chooser__world')).toBeNull();
    expect(root.textContent).toContain(DELIVERY_CHOICE_TEXT.label);
    // A saved route chosen instead keeps the standard world's chooser: no round, no level line.
    const own = queryAll<HTMLInputElement>(root, '.oyl-chooser__card input[type="radio"]').find(
      (radio) => radio.value === OWN[0]?.id,
    );
    own?.click();
    await settle();
    expect(root.querySelector(`#${LEVEL_WORLD_ID}`)).toBeNull();
    expect(root.textContent).not.toContain(DELIVERY_CHOICE_TEXT.label);
  });

  it('with the realistic world chosen, says that world’s own line, not the level’s', async () => {
    const root = await render({ worldChosen: true });
    expect(root.querySelector(`#${LEVEL_WORLD_ID}`)).toBeNull();
    expect(root.querySelector('.oyl-chooser__world-label')?.textContent).toBe('Realistic world');
  });

  it('offers no lap race and no built-in circuits on a level, and says what a level’s round is', async () => {
    const root = await render();
    expect(root.textContent).not.toContain(LAP_RACE_CHOICE_TEXT.label);
    expect(root.querySelector('.oyl-game__lap-race')).toBeNull();
    expect(root.textContent).not.toContain(BUILT_IN_CIRCUITS_TEXT.heading);
    expect(root.querySelector('[data-credit="circuits"]')).toBeNull();
    expect(root.textContent).toContain(DELIVERY_CHOICE_TEXT.levelHint);
    expect(root.textContent).not.toContain(DELIVERY_CHOICE_TEXT.hint);
    // A saved route chosen instead: its race and the built-in circuits, as on any
    // setup, and the round's own hint (round 4: from the chosen card, both ways).
    const radio = (id: string): HTMLInputElement | undefined =>
      queryAll<HTMLInputElement>(root, '.oyl-chooser__card input[type="radio"]').find(
        (each) => each.value === id,
      );
    radio(OWN[0]?.id ?? '')?.click();
    await settle();
    expect(root.textContent).toContain(DELIVERY_CHOICE_TEXT.hint);
    expect(root.querySelector('.oyl-game__lap-race')).not.toBeNull();
    expect(root.textContent).toContain(BUILT_IN_CIRCUITS_TEXT.heading);
    // And the level chosen again: neither.
    radio(LEVEL.id)?.click();
    await settle();
    expect(root.querySelector('.oyl-game__lap-race')).toBeNull();
    expect(root.textContent).not.toContain(BUILT_IN_CIRCUITS_TEXT.heading);
    expect(root.textContent).toContain(DELIVERY_CHOICE_TEXT.levelHint);
  });

  it('says the download’s size from one constant, in Settings and on a level’s setup alike', () => {
    const SOURCE = join(HERE, '..', '..', '..');
    for (const file of ['game/StageChooser.tsx', 'views/SettingsView.tsx']) {
      const code = stripComments(readFileSync(join(SOURCE, file), 'utf8'));
      expect(code, file).toContain('REALISTIC_DOWNLOAD_SIZE_TEXT');
      expect(code, file).not.toMatch(/\d+\s*MB/);
    }
  });
});
