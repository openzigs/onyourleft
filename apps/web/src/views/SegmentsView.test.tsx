// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The segments screen (#64).
 *
 * Three of the eight acceptance criteria are about what a *rider* is told, so
 * they are asserted here rather than only in `segments/create.ts`:
 *
 * - a segment made from somebody else's ride is refused, and the refusal is on
 *   screen (criterion 1);
 * - a near-duplicate is saved, saved **private**, and the earlier segment is
 *   still there (criterion 3);
 * - a segment starting inside a privacy zone is saved private and the screen
 *   says which of the two rules did it (criterion 4).
 *
 * The claim that runs through all three: **the screen reports the visibility it
 * actually wrote, never the one that was asked for.** A screen that showed
 * "public" over a private record would be harmless; one that showed "private"
 * over a public record is a published address, and the same code path produces
 * both.
 */

import { createSegment, metres, unixSeconds, type GeographicPosition } from '@onyourleft/domain';
import { degreesLatitude, degreesLongitude, geographicPosition } from '@onyourleft/domain';
import {
  activityId,
  athleteId as toAthleteId,
  privacyZoneId,
  segmentId,
  type ActivityRecord,
  type PrivacyZoneRecord,
  type SegmentRecord,
} from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { holdFirstLibraryPage, stubMatchPort, type HeldPage } from '../segments/match-testing';
import { stubSegments, type StubSegments } from '../segments/testing';
import {
  activateWithKeyboard,
  mount,
  queryAll,
  settle,
  typeInto,
  type Mounted,
} from '../testing/mount';

import { SegmentsView } from './SegmentsView';

const OWNER = toAthleteId('athlete-a');
const OTHER = toAthleteId('athlete-b');
const RIDE = activityId('ride-1');
const NOW = unixSeconds(1_760_000_000);
const METRES_PER_DEGREE_LATITUDE = 111_194.9;

let view: Mounted | undefined;

afterEach(() => {
  view?.unmount();
  view = undefined;
});

function at(latitude: number, longitude: number): GeographicPosition {
  return geographicPosition(degreesLatitude(latitude), degreesLongitude(longitude));
}

function northward(count: number, spacingMetres = 50): GeographicPosition[] {
  const step = spacingMetres / METRES_PER_DEGREE_LATITUDE;
  return Array.from({ length: count }, (_unused, index) => at(51.5 + index * step, -0.12));
}

function ride(owner = OWNER, overrides: Partial<ActivityRecord> = {}): ActivityRecord {
  return {
    id: RIDE,
    athleteId: owner,
    name: 'Morning ride',
    startedAt: NOW,
    startedAtTimeZone: 'UTC',
    elapsedTime: 3600 as ActivityRecord['elapsedTime'],
    movingTime: 3500 as ActivityRecord['movingTime'],
    distance: 30_000 as ActivityRecord['distance'],
    visibility: 'private',
    hasPosition: true,
    createdAt: NOW,
    ...overrides,
  };
}

function existingSegment(geometry: readonly GeographicPosition[]): SegmentRecord {
  return {
    id: segmentId('existing-1'),
    createdBy: OWNER,
    name: 'The same climb',
    sport: 'ride',
    geometry,
    start: { position: geometry[0] as GeographicPosition, bearing: 0 as never, radius: metres(15) },
    end: {
      position: geometry[geometry.length - 1] as GeographicPosition,
      bearing: 0 as never,
      radius: metres(15),
    },
    bearingToleranceDegrees: 60,
    distance: metres(1000),
    elevationSource: 'none',
    visibility: 'private',
    createdAt: NOW,
  };
}

function zoneAt(centre: GeographicPosition): PrivacyZoneRecord {
  return {
    id: privacyZoneId('zone-1'),
    athleteId: OWNER,
    centre,
    radius: metres(500),
    label: 'home',
    createdAt: NOW,
  };
}

/** Mounts the view over a stub and waits for its first read. */
async function show(port: StubSegments): Promise<HTMLElement> {
  view = await mount(<SegmentsView port={port} />);
  await settle();
  return view.container;
}

/** Fills the form and submits it, the way a rider would. */
async function makeSegment(
  container: HTMLElement,
  fields: { readonly name: string; readonly to: string; readonly visibility?: string },
): Promise<void> {
  const name = container.querySelector<HTMLInputElement>('#segment-name');
  const to = container.querySelector<HTMLInputElement>('#segment-to');
  const visibility = container.querySelector<HTMLSelectElement>('#segment-visibility');
  if (name === null || to === null || visibility === null) {
    throw new Error('the segment form is not on the page');
  }
  await typeInto(name, fields.name);
  await typeInto(to, fields.to);
  // The select is uncontrolled (`defaultValue`), so React tracks no value on
  // it and a plain assignment is what a rider's choice looks like to
  // `new FormData(form)`. `typeInto`'s native-setter dance is only needed for a
  // controlled input.
  visibility.value = fields.visibility ?? 'public';

  // Through the button, not through a synthesised `submit` event: this asserts
  // the control is reachable by keyboard at all — which is #48's third
  // criterion and the half a dispatched event cannot see — and it runs the
  // click inside `act`, so React's own state update is not reported as
  // unwrapped.
  const button = queryAll(container, 'button').find(
    (candidate) => (candidate.textContent ?? '').trim() === 'Make the segment',
  );
  if (button === undefined) {
    throw new Error('no button labelled “Make the segment”');
  }
  await activateWithKeyboard(button);
  await settle();
}

function textOf(container: HTMLElement): string {
  return container.textContent ?? '';
}

/**
 * The one status message that reports what was saved.
 *
 * Found by its opening word rather than by position, and isolated from the
 * notes beside it: the notes explain *why* a visibility was downgraded and
 * therefore also contain the words "saved as private", so a search over the
 * whole page cannot tell the two apart. See the note in the privacy-zone test.
 */
function savedMessage(container: HTMLElement): string {
  const message = queryAll(container, '.oyl-status').find((element) =>
    (element.textContent ?? '').includes('Saved'),
  );
  if (message === undefined) {
    throw new Error('no “Saved …” status message on the page');
  }
  return message.textContent ?? '';
}

describe('with no local store', () => {
  it('says so rather than showing an empty table', async () => {
    view = await mount(<SegmentsView />);
    await settle();
    expect(textOf(view.container)).toContain('no usable local database');
    // An empty table would claim the rider has no segments, which is a
    // different and false statement.
    expect(queryAll(view.container, 'table')).toHaveLength(0);
  });
});

describe('choosing a ride', () => {
  it('offers only rides that have a track', async () => {
    const port = stubSegments(OWNER, [
      { activity: ride(), track: northward(21) },
      { activity: { ...ride(), id: activityId('turbo'), hasPosition: false } },
    ]);
    const container = await show(port);
    expect(queryAll(container, '#segment-ride option')).toHaveLength(1);
  });

  it('says an indoor ride is normal rather than faulty when there is nothing to cut', async () => {
    const port = stubSegments(OWNER, [{ activity: ride(undefined, { hasPosition: false }) }]);
    const container = await show(port);
    expect(textOf(container)).toContain('is normal and is not a fault');
    expect(container.querySelector('form')).toBeNull();
  });

  it('states that there is no map yet rather than leaving it to be inferred', async () => {
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    const container = await show(port);
    expect(textOf(container)).toContain('no map on this screen yet');
  });
});

describe('criterion 1 — only from a ride the athlete owns', () => {
  it('refuses, and the refusal is on the page', async () => {
    // The port belongs to OTHER; the only ride belongs to OWNER. The stub
    // stands in for the store's `[athleteId+id]` index.
    const port = stubSegments(OTHER, [{ activity: ride(OWNER), track: northward(21) }]);
    view = await mount(<SegmentsView port={port} />);
    await settle();
    // No ride is offered at all, because the list is scoped too — which is the
    // first of the two defences and the one a rider sees.
    expect(queryAll(view.container, '#segment-ride option')).toHaveLength(0);
    expect(port.written).toEqual([]);
  });
});

describe('criterion 4 — a privacy zone forces private, and the screen says so', () => {
  it('saves private even though the rider asked for public', async () => {
    const track = northward(21);
    const port = stubSegments(OWNER, [{ activity: ride(), track }], {
      privacyZones: [zoneAt(track[0] as GeographicPosition)],
    });
    const container = await show(port);
    await makeSegment(container, { name: 'Home climb', to: '21', visibility: 'public' });

    // What was WRITTEN. This is the assertion that matters.
    expect(port.written).toHaveLength(1);
    expect(port.written[0]?.visibility).toBe('private');
    // And what the screen SAYS, which must agree with it.
    //
    // ⚠️ Asserted on the SAVED-message element, not on the page text. The first
    // draft searched the whole page for "as private" and passed against a
    // mutation that reported the requested visibility instead — because the
    // privacy-zone note below also contains the words "saved as private". A
    // substring that two different sentences can satisfy pins neither.
    expect(savedMessage(container)).toContain('as private');
    expect(savedMessage(container)).not.toContain('as public');
    expect(textOf(container)).toContain('published address');
  });

  it('leaves a segment public when no zone is near either end', async () => {
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    const container = await show(port);
    await makeSegment(container, { name: 'The drag', to: '21', visibility: 'public' });

    expect(port.written[0]?.visibility).toBe('public');
    expect(savedMessage(container)).toContain('as public');
  });
});

describe('criterion 3 — a near-duplicate is kept, forced private, and explained', () => {
  it('saves it, says why, and does not remove the earlier one', async () => {
    const track = northward(21);
    const existing = existingSegment(track);
    const port = stubSegments(OWNER, [{ activity: ride(), track }], { existing: [existing] });
    const container = await show(port);
    await makeSegment(container, { name: 'The same climb again', to: '21', visibility: 'public' });

    expect(port.written[0]?.visibility).toBe('private');
    expect(textOf(container)).toContain('already have');
    // ADR 0007 D-2.4: both are kept. The earlier segment is still in the table.
    expect(textOf(container)).toContain('The same climb');
    expect(textOf(container)).toContain('The same climb again');
  });

  it('names the overlapping segment and how much of the new one runs along it', async () => {
    const track = northward(21);
    const port = stubSegments(OWNER, [{ activity: ride(), track }], {
      existing: [existingSegment(track)],
    });
    const container = await show(port);
    await makeSegment(container, { name: 'Again', to: '21', visibility: 'public' });
    expect(textOf(container)).toContain('100% of the new segment');
  });
});

describe('what the table says', () => {
  it('reports an unmeasured climb as unmeasured, never as zero', async () => {
    // A flat road and an unmeasured one are different claims, which is why the
    // record's elevation fields are optional rather than defaulted.
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    const container = await show(port);
    await makeSegment(container, { name: 'No barometer', to: '21', visibility: 'private' });
    // Asserted on the climb CELL, not on the page text: the distance cell says
    // "1000 m", which contains "0 m", and the first draft of this test failed
    // on its own segment's length.
    const cells = queryAll(container, 'tbody td').map((cell) => (cell.textContent ?? '').trim());
    expect(cells[2]).toBe('Not measured');
    expect(cells[2]).not.toBe('0 m');
  });

  it('carries the visibility as a word rather than as a colour', async () => {
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    const container = await show(port);
    await makeSegment(container, { name: 'Mine', to: '21', visibility: 'private' });
    const cells = queryAll(container, 'tbody td').map((cell) => cell.textContent ?? '');
    expect(cells).toContain('Only me');
  });

  it('refuses a span below the minimum and writes nothing', async () => {
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    const container = await show(port);
    // Four samples of a 50 m grid is 150 m, well under the 400 m minimum.
    await makeSegment(container, { name: 'Too short', to: '4', visibility: 'public' });
    expect(port.written).toEqual([]);
    expect(textOf(container)).toContain('at least 400 m long');
  });

  it('refuses an unnamed segment and writes nothing', async () => {
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    const container = await show(port);
    await makeSegment(container, { name: '   ', to: '21', visibility: 'public' });
    expect(port.written).toEqual([]);
    expect(textOf(container)).toContain('Give the segment a name');
  });
});

/**
 * The sweep's control (#282).
 *
 * The screen half of the wiring: the sweep had no production caller at all, so
 * a rider who made a segment never saw an effort on it. What is asserted here
 * is the part `segments/sweep.test.ts` cannot see — that a **rider** can reach
 * it, that it is reached by pressing a control and not by looking at the page,
 * and that what happened is said afterwards.
 */
describe('finding efforts — the sweep’s control', () => {
  /** A stub library the matcher will find one effort in. */
  function matchable(): ReturnType<typeof stubMatchPort> {
    const geometry = northward(26, 20);
    const built = createSegment({
      id: 'the-drag',
      createdBy: OWNER,
      name: 'The long drag',
      sport: 'ride',
      geometry,
      elevationSource: 'none',
      visibility: 'private',
      createdAt: NOW,
    });
    const leadIn = [4, 3, 2, 1].map((back) =>
      at(51.5 - (back * 20) / METRES_PER_DEGREE_LATITUDE, -0.12),
    );
    return stubMatchPort({
      athleteId: OWNER,
      rides: [{ activity: ride(), track: [...leadIn, ...geometry] }],
      segments: [{ ...built, id: segmentId(built.id), createdBy: OWNER }],
    });
  }

  /**
   * A held sweep, released after the test whatever the test did.
   *
   * ⚠️ **A gate left closed leaks into the NEXT test**, because the in-flight
   * guard `matchLibrary` keeps is module state and every test here sweeps as
   * the same athlete: a test that fails before releasing leaves a sweep
   * running for ever, and the test after it *joins* that stuck sweep and reads
   * nothing at all. That is a cascade of failures with one real cause, which
   * is how this hook came to be written — it happened.
   */
  const gates: HeldPage[] = [];

  function hold(port: ReturnType<typeof stubMatchPort>): HeldPage {
    const held = holdFirstLibraryPage(port);
    gates.push(held);
    return held;
  }

  afterEach(async () => {
    for (const gate of gates) {
      gate.release();
    }
    gates.length = 0;
    await settle();
  });

  /** The sweep's control, by the label it is currently carrying. */
  function matchButton(container: HTMLElement, label: string): HTMLElement | undefined {
    return queryAll(container, 'button').find(
      (candidate) => (candidate.textContent ?? '').trim() === label,
    );
  }

  /**
   * Presses the control the way a rider does, by keyboard.
   *
   * @param settledLabel what the button must read once the press has been
   * handled. It defaults to the idle label because most of these tests press a
   * sweep that finishes within the press; a test that holds a sweep open passes
   * “Matching…”, and the check is what stops it asserting against a screen
   * where the press never landed at all.
   */
  async function pressMatch(
    container: HTMLElement,
    settledLabel = 'Match my rides',
  ): Promise<void> {
    const button = matchButton(container, 'Match my rides');
    if (button === undefined) {
      throw new Error('no button labelled “Match my rides”');
    }
    await activateWithKeyboard(button);
    await settle();
    if (matchButton(container, settledLabel) === undefined) {
      throw new Error(`the control does not read “${settledLabel}” after the press`);
    }
  }

  it('writes no effort until the rider presses it', async () => {
    // ⚠️ The claim `segments/sweep.ts` makes in words: a read path that writes
    // is a read path whose cost nobody can state. Rendering the screen must
    // sweep nothing.
    const match = matchable();
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    view = await mount(<SegmentsView port={port} match={match} />);
    await settle();

    expect(match.writes).toEqual([]);

    await pressMatch(view.container);

    expect(match.writes).toHaveLength(1);
    expect(match.stored.size).toBe(1);
  });

  it('says how many rides, segments and efforts the sweep found', async () => {
    const match = matchable();
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    view = await mount(<SegmentsView port={port} match={match} />);
    await settle();

    await pressMatch(view.container);

    expect(textOf(view.container)).toContain(
      'Matched 1 ride against 1 segment and found 1 effort.',
    );
  });

  it('says there is nothing to match against rather than reporting a sweep of zero', async () => {
    const match = stubMatchPort({ athleteId: OWNER, rides: [], segments: [] });
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    view = await mount(<SegmentsView port={port} match={match} />);
    await settle();

    await pressMatch(view.container);

    expect(textOf(view.container)).toContain('nothing to match your rides against yet');
  });

  it('says the sweep stopped part-way rather than re-enabling the button in silence', async () => {
    // ⚠️ The failure a rider can actually hit: one press writes efforts for up
    // to 100 rides, so a quota refusal, an effort naming another athlete and a
    // stream that will not decode all reject this call. Without a `catch` the
    // control returns to "Match my rides" with nothing said, which reads as
    // "nothing happened" over a sweep that wrote part of its work.
    const match = matchable();
    match.failNextWrite = true;
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    view = await mount(<SegmentsView port={port} match={match} />);
    await settle();

    await pressMatch(view.container);

    expect(textOf(view.container)).toContain('Matching stopped part-way through');
    // Not the success sentence as well: a failed sweep reports no count.
    expect(textOf(view.container)).not.toContain('Matched 1 ride');
    const button = queryAll(view.container, 'button').find(
      (candidate) => (candidate.textContent ?? '').trim() === 'Match my rides',
    );
    expect(button?.hasAttribute('disabled')).toBe(false);
  });

  it('offers no control at all where there is no store behind it', async () => {
    // #48's first criterion: a control that cannot work is not shown disabled,
    // it is not shown. The rest of the screen still works.
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    view = await mount(<SegmentsView port={port} />);
    await settle();

    expect(
      queryAll(view.container, 'button').map((button) => (button.textContent ?? '').trim()),
    ).not.toContain('Match my rides');
  });

  it('says a ride is not skipped when it is a recording gap that stopped it', async () => {
    const geometry = northward(26, 20);
    const built = createSegment({
      id: 'the-drag',
      createdBy: OWNER,
      name: 'The long drag',
      sport: 'ride',
      geometry,
      elevationSource: 'none',
      visibility: 'private',
      createdAt: NOW,
    });
    const leadIn = [4, 3, 2, 1].map((back) =>
      at(51.5 - (back * 20) / METRES_PER_DEGREE_LATITUDE, -0.12),
    );
    const holed = [
      ...geometry.slice(0, 12),
      ...Array.from<undefined>({ length: 40 }).fill(undefined),
      ...geometry.slice(12),
    ];
    const match = stubMatchPort({
      athleteId: OWNER,
      rides: [{ activity: ride(), track: [...leadIn, ...holed] }],
      segments: [{ ...built, id: segmentId(built.id), createdBy: OWNER }],
    });
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    view = await mount(<SegmentsView port={port} match={match} />);
    await settle();

    await pressMatch(view.container);

    expect(textOf(view.container)).toContain('gap in the recording');
  });

  it('disables the control it owns while its own sweep runs', async () => {
    // #294's third criterion: the module guard does not replace `matching`.
    // The component flag is what puts "Matching…" on the button and takes it
    // out of the tab order for the press that started the sweep, and that is
    // still this view's job.
    const match = matchable();
    const held = hold(match);
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    view = await mount(<SegmentsView port={port} match={match} />);
    await settle();

    await pressMatch(view.container, 'Matching…');

    const busy = matchButton(view.container, 'Matching…');
    expect(busy?.hasAttribute('disabled')).toBe(true);

    held.release();
    await settle();

    expect(matchButton(view.container, 'Match my rides')?.hasAttribute('disabled')).toBe(false);
  });

  it('does not start a second sweep when the screen is left and come back to mid-sweep', async () => {
    // ⚠️ #294, the whole of it. `matching` dies with the view: navigating away
    // unmounts this screen and navigating back mounts a fresh one with the
    // control enabled, while the first sweep is still running — nothing
    // cancels it. Counted by the corpus read, which happens once per sweep
    // that actually starts: a second loop reads the segments again.
    const match = matchable();
    const held = hold(match);
    const port = stubSegments(OWNER, [{ activity: ride(), track: northward(21) }]);
    view = await mount(<SegmentsView port={port} match={match} />);
    await settle();
    await pressMatch(view.container, 'Matching…');

    // Away, and back: a brand new component, with `matching` false again.
    view.unmount();
    view = await mount(<SegmentsView port={port} match={match} />);
    await settle();
    expect(matchButton(view.container, 'Match my rides')?.hasAttribute('disabled')).toBe(false);

    await pressMatch(view.container, 'Matching…');
    held.release();
    await settle();

    expect(match.reads.filter((read) => read.startsWith('segments:'))).toHaveLength(1);
    expect(match.writes).toHaveLength(1);
    // The second press reports the sweep that was running rather than nothing:
    // a rider who came back to the screen is told what happened to their rides.
    expect(textOf(view.container)).toContain(
      'Matched 1 ride against 1 segment and found 1 effort.',
    );
  });
});
