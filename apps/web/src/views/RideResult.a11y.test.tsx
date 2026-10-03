// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #1042 — the result card a rider sees once a ride is saved, on the real Ride
 * screen over the stub controller.
 *
 * What is asserted is what a rider can see and hear: the card is there only
 * for a stopped, saved ride; a failed save keeps its own sentence, word for
 * word, and no card; the card states the saved facts and nothing else; it is
 * announced once and not again on a re-render; *Done* puts it away and leaves
 * focus somewhere; and the screen keeps ONE primary while it is up.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';

import { beatsPerMinute, metres, seconds, watts } from '@onyourleft/domain';
import { activityId } from '@onyourleft/store';

import { auditAccessibility, formatViolations, tabbableElements } from '../a11y/audit';
import { onePrimaryViolations, PRIMARY_BUTTON_SELECTOR } from '../a11y/button-hierarchy';
import type { RideSnapshot } from '../ride/controller';
import type { SavedRide } from '../ride/ride-result';
import { RideResultCard } from '../ride/RideResultCard';
import { idleSnapshot, ridingSnapshot, stubRideController } from '../ride/testing';
import { activateWithKeyboard, mount, queryAll, settle, type Mounted } from '../testing/mount';
import { UnitsProvider } from '../units/context';
import { RideView } from './RideView';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const SAVED: SavedRide = {
  activityId: activityId('ride-1042'),
  elapsedTime: seconds(3_725),
  distance: metres(32_400),
  averagePower: watts(212),
  averageHeartRate: beatsPerMinute(141),
  gameOutcome: undefined,
};

/** A ride that stopped and saved, as the controller publishes it. */
function savedSnapshot(ride: SavedRide = SAVED): Partial<RideSnapshot> {
  return {
    phase: 'stopped',
    stopping: false,
    saveState: 'saved',
    savedActivityId: ride.activityId,
    savedRide: ride,
  };
}

async function show(state: Partial<RideSnapshot>): Promise<ReturnType<typeof stubRideController>> {
  const stub = stubRideController(ridingSnapshot());
  stub.set(state);
  mounted = await mount(<RideView controller={stub.controller} />);
  await settle();
  return stub;
}

const card = (): HTMLElement | undefined =>
  queryAll<HTMLElement>(document, '[data-oyl-result-card]')[0];

/** The card's one region, and what it holds. */
const region = (): HTMLElement | undefined =>
  card() === undefined ? undefined : queryAll<HTMLElement>(card()!, '[role="status"]')[0];

function buttonNamed(label: string): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document, 'button').find(
    (button) => button.textContent?.trim() === label,
  );
  if (found === undefined) {
    throw new Error(`no button named ${label}`);
  }
  return found;
}

describe('#1042 — the card is shown for a saved ride and only for one', () => {
  it('shows the saved facts as readings, a link to the ride and one Done', async () => {
    await show(savedSnapshot());
    const shown = card();
    expect(shown).toBeDefined();
    // A named group, not a landmark: the screen already has one unnamed
    // `section` (the workout panel's), and a second landmark would make both
    // indistinguishable (`landmarks-are-distinguishable`).
    expect(shown!.getAttribute('role')).toBe('group');
    expect(shown!.getAttribute('aria-labelledby')).toBe(queryAll<HTMLElement>(shown!, 'h3')[0]?.id);
    const readings = queryAll<HTMLElement>(shown!, '.oyl-reading').map((node) => node.textContent);
    expect(readings).toEqual(['1:02:05', '32.4 km', '212 W', '141 bpm']);
    const terms = queryAll<HTMLElement>(shown!, 'dt').map((node) => node.textContent);
    expect(terms).toEqual(['Elapsed', 'Distance', 'Average power', 'Average heart rate']);
    const link = queryAll<HTMLAnchorElement>(shown!, 'a')[0];
    expect(link?.textContent).toBe('Open this ride');
    expect(link?.getAttribute('href')).toBe('#/activities/ride-1042');
    expect(queryAll<HTMLButtonElement>(shown!, 'button').map((b) => b.textContent)).toEqual([
      'Done',
    ]);
  });

  it('says no power meter, and nothing about heart rate, for a ride with neither', async () => {
    await show(savedSnapshot({ ...SAVED, averagePower: undefined, averageHeartRate: undefined }));
    const shown = card()!;
    expect(queryAll<HTMLElement>(shown, 'dt').map((node) => node.textContent)).toEqual([
      'Elapsed',
      'Distance',
      'Average power',
    ]);
    expect(shown.textContent).toContain('No power meter');
    expect(shown.textContent).not.toContain('bpm');
  });

  it('states distance in the rider’s units, through the units module', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set(savedSnapshot());
    mounted = await mount(
      <UnitsProvider units="imperial">
        <RideView controller={stub.controller} />
      </UnitsProvider>,
    );
    await settle();
    expect(queryAll<HTMLElement>(card()!, '.oyl-reading')[1]?.textContent).toBe('20.1 mi');
  });

  it.each([
    ['beaten', 'In your last trainer game ride, you beat your best on that route.'],
    ['level', 'In your last trainer game ride, you matched your best on that route.'],
    [
      'not-beaten',
      'In your last trainer game ride, your best on that route finished ahead of you.',
    ],
  ] as const)('states a game ride’s latched outcome %s in words', async (outcome, words) => {
    await show(savedSnapshot({ ...SAVED, gameOutcome: outcome }));
    expect(card()!.textContent).toContain(words);
  });

  it('says nothing about a game for a ride that rode none', async () => {
    await show(savedSnapshot());
    expect(card()!.textContent).not.toContain('trainer game');
  });

  it.each([
    ['recording', { phase: 'recording' }],
    ['paused', { phase: 'paused' }],
    ['still stopping', { stopping: true }],
    ['still saving', { saveState: 'saving' }],
    ['empty', { saveState: 'empty' }],
    ['unavailable', { saveState: 'unavailable' }],
    ['with the last checkpoint unwritten', { storage: 'failed' }],
  ] as const)('is absent while the ride is %s', async (_, state) => {
    await show({ ...savedSnapshot(), ...state });
    expect(card()).toBeUndefined();
  });

  it('is absent for a save that failed, whose sentence is unchanged word for word', async () => {
    await show({
      ...savedSnapshot(),
      saveState: 'failed',
      saveError: 'the device is full',
    });
    expect(card()).toBeUndefined();
    const notice = queryAll<HTMLElement>(document, '.oyl-status').find((node) =>
      node.textContent?.includes('could not be added'),
    );
    expect(notice?.textContent).toBe(
      '!Stopped: The ride is stopped and every second of it is on this device, but it could not ' +
        'be added to your activities: the device is full. It is still here and will be offered ' +
        'back next time you open On Your Left.',
    );
    // Still announced: it is the answer to the rider's Stop.
    expect(notice?.getAttribute('role')).toBe('status');
  });
});

describe('#1042 — announced politely, once', () => {
  it('fills its one polite region once, and a re-render says nothing new', async () => {
    const stub = await show(savedSnapshot());
    const spoken = region();
    expect(spoken).toBeDefined();
    expect(spoken!.textContent).toBe('Ride saved: 1:02:05 elapsed, 32.4 kilometres.');

    // The 1 Hz tick and a sensor notification both re-render the screen.
    const node = spoken;
    stub.set({ elapsedSeconds: 3_726, tick: 1 } as Partial<RideSnapshot>);
    await settle();
    expect(region()).toBe(node);
    expect(region()!.textContent).toBe('Ride saved: 1:02:05 elapsed, 32.4 kilometres.');
  });

  it('renders its region EMPTY first, so the sentence arriving is a change a reader hears', () => {
    // The first render, before any effect: a region mounted with its words
    // already in it is read twice or not at all (`StatusMessage` §`live`).
    const markup = renderToStaticMarkup(
      <RideResultCard
        result={SAVED}
        announce
        onAnnounced={() => undefined}
        onDone={() => undefined}
      />,
    );
    expect(markup).toContain('<p class="oyl-visually-hidden" role="status"></p>');
  });

  it('is the ONE voice for the save: the success sentence above it is shown, not announced', async () => {
    await show(savedSnapshot());
    const saved = queryAll<HTMLElement>(document, '.oyl-status').find((node) =>
      node.textContent?.includes('saved to your activities'),
    );
    expect(saved?.textContent).toContain(
      'The ride is stopped and saved to your activities. Closing the tab is safe now.',
    );
    expect(saved?.getAttribute('role')).toBeNull();
    // No other region on the screen says anything about the save.
    const regions = queryAll<HTMLElement>(document, '[role="status"], [role="alert"]').filter(
      (node) => node.closest('[data-oyl-result-card]') === null,
    );
    expect(regions.filter((node) => node.textContent?.includes('saved'))).toEqual([]);
  });

  it('says the game’s outcome after the facts, once', async () => {
    await show(savedSnapshot({ ...SAVED, gameOutcome: 'beaten' }));
    expect(region()!.textContent).toBe(
      'Ride saved: 1:02:05 elapsed, 32.4 kilometres. In your last trainer game ride, you beat ' +
        'your best on that route.',
    );
  });
});

describe('#1042 — Done, focus and the button hierarchy', () => {
  it('meets Done, then the ride’s page, then Start a new ride, in that order', async () => {
    await show(savedSnapshot());
    const names = tabbableElements(document).map((element) => element.textContent?.trim());
    const done = names.indexOf('Done');
    expect(done).toBeGreaterThanOrEqual(0);
    expect(names.slice(done, done + 3)).toEqual(['Done', 'Open this ride', 'Start a new ride']);
  });

  it('keeps one primary: Done, with Start a new ride stepped down beside it', async () => {
    await show(savedSnapshot());
    expect(onePrimaryViolations(document)).toEqual([]);
    expect(buttonNamed('Done').matches(PRIMARY_BUTTON_SELECTOR)).toBe(true);
    expect(buttonNamed('Start a new ride').matches(PRIMARY_BUTTON_SELECTOR)).toBe(false);
  });

  it('puts the card away on Done, hands focus to Start a new ride, and does not bring it back', async () => {
    const stub = await show(savedSnapshot());
    await activateWithKeyboard(buttonNamed('Done'));
    await settle();
    expect(card()).toBeUndefined();
    expect(document.activeElement).toBe(buttonNamed('Start a new ride'));
    // With the card gone, Start a new ride is the screen's primary again.
    expect(buttonNamed('Start a new ride').matches(PRIMARY_BUTTON_SELECTOR)).toBe(true);
    // And the success sentence is still on the screen.
    expect(document.body.textContent).toContain('saved to your activities');

    stub.set({ elapsedSeconds: 3_727 });
    await settle();
    expect(card()).toBeUndefined();
    expect(stub.calls.startNewRide).toBe(0);
  });

  it('comes back for the NEXT saved ride after Done', async () => {
    const stub = await show(savedSnapshot());
    await activateWithKeyboard(buttonNamed('Done'));
    await settle();
    stub.set(idleSnapshot());
    await settle();
    stub.set(savedSnapshot({ ...SAVED, activityId: activityId('ride-1043') }));
    await settle();
    expect(card()).toBeDefined();
  });

  it('passes the structural audit with the card up', async () => {
    const stub = stubRideController(ridingSnapshot());
    stub.set(savedSnapshot({ ...SAVED, gameOutcome: 'not-beaten' }));
    // Under the page's own title, as the shell renders it — RideNewRide's way.
    mounted = await mount(
      <main>
        <h1>Ride</h1>
        <RideView controller={stub.controller} />
      </main>,
    );
    await settle();
    expect(card()).toBeDefined();
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });
});

/** Leave the Ride screen and come back to it — the router unmounts it, the controller stays. */
async function remount(stub: ReturnType<typeof stubRideController>): Promise<void> {
  mounted?.unmount();
  mounted = await mount(<RideView controller={stub.controller} />);
  await settle();
}

describe('#1042 — the card outlives the screen, not the ride (#1049’s review)', () => {
  it('stays put away after Done when the screen is mounted again', async () => {
    const stub = await show(savedSnapshot());
    await activateWithKeyboard(buttonNamed('Done'));
    await settle();
    expect(stub.calls.dismissResult).toBe(1);

    // Ride → Activities → Ride.
    await remount(stub);
    expect(card()).toBeUndefined();
    expect(buttonNamed('Start a new ride').matches(PRIMARY_BUTTON_SELECTOR)).toBe(true);
    expect(onePrimaryViolations(document)).toEqual([]);
    // And the save is not said again by the sentence the card used to silence.
    const saved = queryAll<HTMLElement>(document, '.oyl-status').find((node) =>
      node.textContent?.includes('saved to your activities'),
    );
    expect(saved).toBeDefined();
    expect(saved!.getAttribute('role')).toBeNull();
  });

  it('is shown again without Done, and does NOT announce the ride a second time', async () => {
    const stub = await show(savedSnapshot());
    expect(region()!.textContent).toBe('Ride saved: 1:02:05 elapsed, 32.4 kilometres.');
    expect(stub.calls.noteResultAnnounced).toBe(1);

    await remount(stub);
    expect(card()).toBeDefined();
    expect(region()!.textContent).toBe('');
    expect(stub.calls.noteResultAnnounced).toBe(1);
    // Still the one primary: the card is up, so Done is.
    expect(buttonNamed('Done').matches(PRIMARY_BUTTON_SELECTOR)).toBe(true);
    // And nothing else on the screen says it either.
    const regions = queryAll<HTMLElement>(document, '[role="status"], [role="alert"]');
    expect(regions.filter((node) => node.textContent?.toLowerCase().includes('saved'))).toEqual([]);
  });

  it('keeps the region it filled when the controller records that it spoke', async () => {
    // The controller turning `resultAnnounced` on re-renders the card at once;
    // that must not empty what was just announced.
    const stub = await show(savedSnapshot());
    expect(stub.calls.noteResultAnnounced).toBe(1);
    stub.set({ elapsedSeconds: 3_728 });
    await settle();
    expect(region()!.textContent).toBe('Ride saved: 1:02:05 elapsed, 32.4 kilometres.');
  });
});

describe('#1042 — one voice when a working copy is left behind (#1049’s review)', () => {
  it('lets the leftover warning carry the save, with every word of it still rendered', async () => {
    const stub = await show({ ...savedSnapshot(), leftover: true });
    expect(card()).toBeDefined();
    // The card is shown and silent…
    expect(region()!.textContent).toBe('');
    expect(stub.calls.noteResultAnnounced).toBe(0);
    // …and the warning, word for word, is the one polite region about the save.
    const warning = queryAll<HTMLElement>(document, '.oyl-status').find((node) =>
      node.textContent?.includes('working copy'),
    );
    expect(warning?.textContent).toBe(
      '!Saved, with a working copy left behind: The ride is stopped and saved to your ' +
        'activities. The working copy on this device could not be removed, so it will be ' +
        'offered back next time — discarding it changes nothing about the saved ride.',
    );
    expect(warning?.getAttribute('role')).toBe('status');
    const speaking = queryAll<HTMLElement>(document, '[role="status"], [role="alert"]').filter(
      (node) => (node.textContent ?? '').toLowerCase().includes('saved'),
    );
    expect(speaking).toEqual([warning]);
  });
});
