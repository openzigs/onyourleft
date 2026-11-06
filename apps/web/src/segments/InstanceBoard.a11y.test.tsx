// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * A segment's board on the rider's instance, and the instance's segments
 * (#68), audited and driven through a stand-in port.
 *
 * `routes.a11y.test.tsx` renders every route with no ports, so neither section
 * renders there: with no instance there is nothing to show (ADR 0036 D-3).
 * This file renders them in the states they have — not published, refused,
 * published with a board — and holds #68's last criterion: the board says
 * whose it is in WORDS, the instance named, "not every instance".
 */

import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createSegment,
  geographicPosition,
  metres,
  seconds,
  unixSeconds,
} from '@onyourleft/domain';
import type { DegreesLatitude, DegreesLongitude } from '@onyourleft/domain';
import {
  activityId,
  athleteId,
  segmentEffortId,
  segmentId,
  type SegmentEffortRecord,
  type SegmentRecord,
} from '@onyourleft/store';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type {
  BoardPeriod,
  BoardScope,
  InstanceBoard as Board,
  InstanceSegment,
  LeaderboardPort,
  SegmentStanding,
} from '../instance/leaderboard-port';
import { chooseOption, mount, queryAll, settle, type Mounted } from '../testing/mount';

import {
  FLAG_SENTENCE,
  HAZARD_CONFIRM_SENTENCE,
  HAZARD_SENTENCE,
  HAZARDOUS_BOARD_SENTENCE,
  InstanceBoard,
  PUBLISH_SENTENCE,
  SHARE_SENTENCE,
  WITHDRAW_SENTENCE,
  HELD_EFFORTS_SENTENCE,
} from './InstanceBoard';
import { ADD_SENTENCE, InstanceSegments } from './InstanceSegments';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const LOCAL = athleteId('local');

const SEGMENT: SegmentRecord = (() => {
  const made = createSegment({
    id: 'local-1',
    createdBy: LOCAL,
    name: 'Box Hill',
    sport: 'ride',
    geometry: Array.from({ length: 6 }, (_, index) =>
      geographicPosition((51.5 + index * 0.001) as DegreesLatitude, -0.12 as DegreesLongitude),
    ),
    elevationSource: 'none',
    visibility: 'public',
    createdAt: unixSeconds(1_790_000_000),
  });
  return { ...made, id: segmentId(made.id), createdBy: LOCAL };
})();

const EFFORT: SegmentEffortRecord = {
  id: segmentEffortId('e1'),
  athleteId: LOCAL,
  segmentId: SEGMENT.id,
  activityId: activityId('ride-1'),
  startedAt: unixSeconds(1_790_000_100),
  elapsed: seconds(95),
  deviation: metres(2),
  visibility: 'public',
  attributes: {},
};

const BEA_EFFORT = 'b'.repeat(32);

const BOARD: Board = {
  scope: 'instance',
  period: 'all-time',
  hazardous: false,
  rows: [
    {
      rank: 1,
      rider: 'Bea',
      yours: false,
      elapsedSeconds: 90,
      effortId: BEA_EFFORT,
      excluded: null,
    },
    {
      rank: 2,
      rider: 'Anna',
      yours: true,
      elapsedSeconds: 95,
      effortId: 'a'.repeat(32),
      excluded: null,
    },
  ],
};

interface Calls {
  readonly published: SegmentRecord[];
  readonly boards: [string, BoardScope, BoardPeriod][];
  readonly shared: readonly SegmentEffortRecord[][];
  readonly withdrawn: readonly SegmentEffortRecord[][];
  readonly added: string[];
}

function stubPort(
  options: {
    standing?: SegmentStanding;
    refusal?: string;
    board?: Board;
    segments?: readonly InstanceSegment[];
  } = {},
): { port: LeaderboardPort; calls: Calls } {
  const calls = { published: [], boards: [], shared: [], withdrawn: [], added: [] } as {
    published: SegmentRecord[];
    boards: [string, BoardScope, BoardPeriod][];
    shared: SegmentEffortRecord[][];
    withdrawn: SegmentEffortRecord[][];
    added: string[];
  };
  let standing: SegmentStanding = options.standing ?? {
    kind: 'published',
    segmentId: 'a'.repeat(32),
    yours: true,
  };
  const port: LeaderboardPort = {
    offered: () => true,
    instanceName: () => 'rides.example.org',
    publishRefusal: () => Promise.resolve(options.refusal),
    standing: () => Promise.resolve(standing),
    flagEffort: (id, effortId, reason) => {
      calls.added.push(`flag ${effortId} ${reason} on ${id}`);
      return Promise.resolve('flagged');
    },
    flagHazard: (id, reason) => {
      calls.added.push(`hazard ${reason} on ${id}`);
      return Promise.resolve('rate-limited');
    },
    withdrawSegment: (id) => {
      calls.added.push(`withdrawn ${id}`);
      standing = { kind: 'not-published', segmentId: id };
      return Promise.resolve(true);
    },
    publish: (segment) => {
      calls.published.push(segment);
      standing = { kind: 'published', segmentId: 'a'.repeat(32), yours: true };
      return Promise.resolve('published');
    },
    board: (id, scope, period) => {
      calls.boards.push([id, scope, period]);
      return Promise.resolve(options.board ?? { ...BOARD, scope, period });
    },
    share: (_id, efforts) => {
      calls.shared.push([...efforts]);
      return Promise.resolve({ rides: 1, notSynced: 1, failed: 0 });
    },
    withdraw: (_id, efforts) => {
      calls.withdrawn.push([...efforts]);
      return Promise.resolve({ rides: 1, notSynced: 0, failed: 0 });
    },
    listSegments: () => Promise.resolve(options.segments ?? []),
    addSegment: (id) => {
      calls.added.push(id);
      return Promise.resolve('added');
    },
  };
  return { port, calls };
}

/** A section as its screen places it: in the page's one `main`, under its headings. */
function onAPage(section: ReactElement, level: 2 | 3 = 3): ReactElement {
  return (
    <main>
      <h1>Segments</h1>
      {level === 3 ? (
        <section aria-labelledby="the-segment">
          <h2 id="the-segment">Box Hill</h2>
          {section}
        </section>
      ) : (
        section
      )}
    </main>
  );
}

function clean(): void {
  const violations = auditAccessibility(document);
  expect(violations, formatViolations(violations)).toEqual([]);
}

const text = (): string => mounted?.container.textContent ?? '';

function button(name: RegExp): HTMLButtonElement {
  const found = queryAll<HTMLButtonElement>(document, 'button').find((each) =>
    name.test(each.textContent ?? ''),
  );
  if (found === undefined) throw new Error(`no button ${String(name)}`);
  return found;
}

describe('a segment’s board on the instance (#68)', () => {
  it('says whose board it is in words — the instance, and not every instance — and marks your row', async () => {
    const { port, calls } = stubPort();
    mounted = await mount(
      onAPage(<InstanceBoard port={port} segment={SEGMENT} efforts={[EFFORT]} />),
    );
    await settle();
    expect(text()).toContain('Leaderboard on rides.example.org');
    expect(text()).toContain(
      'The riders on rides.example.org who shared their efforts: this instance only, not every instance.',
    );
    expect(text()).toContain('Ranked by elapsed time');
    expect(text()).toContain('Anna (you)');
    expect(text()).toContain(SHARE_SENTENCE);
    expect(calls.boards).toEqual([['a'.repeat(32), 'instance', 'all-time']]);
    clean();
  });

  it('asks again for whose and when the rider chose, and says so', async () => {
    const { port, calls } = stubPort();
    mounted = await mount(
      onAPage(<InstanceBoard port={port} segment={SEGMENT} efforts={[EFFORT]} />),
    );
    await settle();
    const [whose, when] = queryAll<HTMLSelectElement>(document, 'select');
    await chooseOption(whose!, 'personal');
    await settle();
    await chooseOption(when!, 'last-90-days');
    await settle();
    expect(calls.boards.at(-1)).toEqual(['a'.repeat(32), 'personal', 'last-90-days']);
    expect(text()).toContain('Only your own efforts you shared on rides.example.org.');
    expect(text()).toContain('Efforts ridden before this segment was published');
    clean();
  });

  it('shares and withdraws the rider’s efforts on a press, and says what came of it', async () => {
    const { port, calls } = stubPort();
    mounted = await mount(
      onAPage(<InstanceBoard port={port} segment={SEGMENT} efforts={[EFFORT]} />),
    );
    await settle();
    button(/^Share my efforts/).click();
    await settle();
    expect(calls.shared).toEqual([[EFFORT]]);
    expect(text()).toContain('Shared efforts from 1 ride.');
    expect(text()).toContain('1 ride is not on your instance yet');
    button(/^Take my efforts off/).click();
    await settle();
    expect(calls.withdrawn).toEqual([[EFFORT]]);
    expect(text()).toContain('Withdrew efforts from 1 ride.');
  });

  it('still offers a withheld segment’s publisher its withdrawal, and its sharer their efforts back', async () => {
    const { port, calls } = stubPort({
      standing: {
        kind: 'withheld',
        refusal: 'Part of this segment is in one of your privacy zones.',
        held: { segmentId: 'a'.repeat(32), yours: true, shared: true },
      },
    });
    mounted = await mount(
      onAPage(<InstanceBoard port={port} segment={SEGMENT} efforts={[EFFORT]} />),
    );
    await settle();
    expect(text()).toContain('Part of this segment is in one of your privacy zones.');
    expect(text()).toContain(HELD_EFFORTS_SENTENCE);
    expect(text()).toContain(WITHDRAW_SENTENCE);
    // Never the board, and never a way to share or publish more.
    expect(calls.boards).toEqual([]);
    expect(queryAll(document, 'button').map((each) => each.textContent)).toEqual([
      'Take my efforts off this board',
      'Withdraw this segment from rides.example.org',
    ]);
    clean();
    button(/^Take my efforts off/).click();
    await settle();
    expect(calls.withdrawn).toEqual([[EFFORT]]);
    button(/^Withdraw this segment/).click();
    await settle();
    expect(calls.added).toEqual([`withdrawn ${'a'.repeat(32)}`]);
  });

  it('lets the rider who published it withdraw it, saying what that deletes — and nobody else', async () => {
    const { port, calls } = stubPort();
    mounted = await mount(onAPage(<InstanceBoard port={port} segment={SEGMENT} efforts={[]} />));
    await settle();
    expect(text()).toContain(WITHDRAW_SENTENCE);
    clean();
    button(/^Withdraw this segment from rides\.example\.org/).click();
    await settle();
    expect(calls.added).toEqual([`withdrawn ${'a'.repeat(32)}`]);
    expect(text()).toContain('Withdrew this segment from rides.example.org.');
    // Not there any more: offered for publishing again.
    expect(text()).toContain(PUBLISH_SENTENCE);
    mounted.unmount();

    const theirs = stubPort({
      standing: { kind: 'published', segmentId: 'a'.repeat(32), yours: false },
    });
    mounted = await mount(
      onAPage(<InstanceBoard port={theirs.port} segment={SEGMENT} efforts={[]} />),
    );
    await settle();
    expect(text()).not.toContain(WITHDRAW_SENTENCE);
    expect(queryAll(document, 'button')).toEqual([]);
  });

  it('offers to publish a segment that is not there yet, saying what is sent', async () => {
    const { port, calls } = stubPort({
      standing: { kind: 'not-published', segmentId: 'a'.repeat(32) },
    });
    mounted = await mount(onAPage(<InstanceBoard port={port} segment={SEGMENT} efforts={[]} />));
    await settle();
    expect(text()).toContain(PUBLISH_SENTENCE);
    expect(calls.boards).toEqual([]);
    clean();
    button(/^Publish to rides\.example\.org/).click();
    await settle();
    expect(calls.published).toEqual([SEGMENT]);
    expect(text()).toContain('Published on rides.example.org.');
    expect(calls.boards.length).toBe(1);
  });

  it('shows the refusal, and no publish control, for a segment that may not go', async () => {
    const { port, calls } = stubPort({
      standing: { kind: 'not-published', segmentId: 'a'.repeat(32) },
      refusal: 'Part of this segment is in one of your privacy zones.',
    });
    mounted = await mount(onAPage(<InstanceBoard port={port} segment={SEGMENT} efforts={[]} />));
    await settle();
    expect(text()).toContain('Part of this segment is in one of your privacy zones.');
    expect(queryAll(document, 'button')).toEqual([]);
    expect(calls.published).toEqual([]);
    clean();
  });

  it('shows the refusal, and reads no board, for a segment the instance was never asked about', async () => {
    const { port, calls } = stubPort({
      standing: { kind: 'withheld', refusal: 'This segment is private on this device.' },
    });
    mounted = await mount(onAPage(<InstanceBoard port={port} segment={SEGMENT} efforts={[]} />));
    await settle();
    expect(text()).toContain('This segment is private on this device.');
    expect(text()).not.toContain('could not be asked');
    expect(queryAll(document, 'button')).toEqual([]);
    expect(calls.boards).toEqual([]);
    clean();
  });
});

describe('flagging, and what is not counted (#69)', () => {
  it('lets a rider with efforts of their own flag another rider’s time, saying what that does', async () => {
    const { port, calls } = stubPort();
    mounted = await mount(
      onAPage(<InstanceBoard port={port} segment={SEGMENT} efforts={[EFFORT]} />),
    );
    await settle();
    expect(text()).toContain(FLAG_SENTENCE);
    expect(text()).toContain(HAZARD_SENTENCE);
    clean();
    const [, , which, why] = queryAll<HTMLSelectElement>(document, 'select');
    // Only the other rider's time is offered: never the rider's own.
    expect([...which!.options].map((option) => option.value)).toEqual([BEA_EFFORT]);
    await chooseOption(why!, 'gps-error');
    button(/^Flag this time/).click();
    await settle();
    expect(calls.added).toEqual([`flag ${BEA_EFFORT} gps-error on ${'a'.repeat(32)}`]);
    expect(text()).toContain('Flagged. It is off the board.');
    button(/^Flag it as hazardous/).click();
    await settle();
    // Asked before it is raised: the first press sends nothing.
    expect(calls.added).toHaveLength(1);
    expect(text()).toContain(HAZARD_CONFIRM_SENTENCE);
    button(/^No, keep it/).click();
    await settle();
    expect(text()).not.toContain(HAZARD_CONFIRM_SENTENCE);
    expect(calls.added).toHaveLength(1);
    button(/^Flag it as hazardous/).click();
    await settle();
    button(/^Yes, flag it as hazardous/).click();
    await settle();
    expect(calls.added.at(-1)).toBe(`hazard traffic on ${'a'.repeat(32)}`);
    expect(text()).toContain('You have flagged as many as you may today');
  });

  it('offers no flag to a rider with no effort of their own on the segment', async () => {
    const { port } = stubPort();
    mounted = await mount(onAPage(<InstanceBoard port={port} segment={SEGMENT} efforts={[]} />));
    await settle();
    expect(text()).not.toContain(FLAG_SENTENCE);
    expect(text()).not.toContain(HAZARD_SENTENCE);
  });

  it('says a hazardous segment ranks nobody, tells the screen above, and offers no flag', async () => {
    const { port } = stubPort({ board: { ...BOARD, hazardous: true, rows: [] } });
    const told: boolean[] = [];
    mounted = await mount(
      onAPage(
        <InstanceBoard
          port={port}
          segment={SEGMENT}
          efforts={[EFFORT]}
          onHazardous={(hazardous) => told.push(hazardous)}
        />,
      ),
    );
    await settle();
    expect(text()).toContain(HAZARDOUS_BOARD_SENTENCE);
    expect(told.at(-1)).toBe(true);
    expect(text()).not.toContain(FLAG_SENTENCE);
    clean();
  });

  it('shows the rider’s own uncounted effort with its reason and no place', async () => {
    const { port } = stubPort({
      board: {
        scope: 'personal',
        period: 'all-time',
        hazardous: false,
        rows: [
          {
            rank: 1,
            rider: 'Anna',
            yours: true,
            elapsedSeconds: 95,
            effortId: 'a'.repeat(32),
            excluded: null,
          },
          {
            rank: null,
            rider: 'Anna',
            yours: true,
            elapsedSeconds: 9,
            effortId: 'c'.repeat(32),
            excluded: 'Excluded automatically: 61.7 m/s averaged over the segment.',
          },
        ],
      },
    });
    mounted = await mount(
      onAPage(<InstanceBoard port={port} segment={SEGMENT} efforts={[EFFORT]} />),
    );
    await settle();
    const cells = queryAll(document, 'tbody tr').map((row) => row.textContent);
    expect(cells[1]).toContain('—');
    expect(cells[1]).toContain('Excluded automatically: 61.7 m/s averaged over the segment.');
    expect(cells[0]).toContain('Yes');
    clean();
  });
});

describe('the segments on the instance (#68)', () => {
  const listed: InstanceSegment[] = [
    {
      segmentId: 'b'.repeat(32),
      name: 'Leith Hill',
      sport: 'ride',
      distanceMetres: 1200,
      yours: false,
    },
    {
      segmentId: 'c'.repeat(32),
      name: 'Held already',
      sport: 'ride',
      distanceMetres: 900,
      yours: false,
    },
    { segmentId: 'd'.repeat(32), name: 'Mine', sport: 'ride', distanceMetres: 700, yours: true },
  ];

  it('lists them, says whose instance, and adds one on a press', async () => {
    const { port, calls } = stubPort({ segments: listed });
    let added = 0;
    mounted = await mount(
      onAPage(
        <InstanceSegments
          port={port}
          held={new Set(['c'.repeat(32)])}
          onAdded={() => {
            added += 1;
          }}
        />,
        2,
      ),
    );
    await settle();
    expect(text()).toContain('Segments on rides.example.org');
    expect(text()).toContain('this instance only, not every instance');
    expect(text()).toContain(ADD_SENTENCE);
    expect(text()).toContain('Mine (yours)');
    // Only the one not on this device is offered.
    expect(queryAll(document, 'button').map((each) => each.textContent)).toEqual([
      'Add “Leith Hill”',
    ]);
    clean();
    button(/^Add “Leith Hill”/).click();
    await settle();
    expect(calls.added).toEqual(['b'.repeat(32)]);
    expect(added).toBe(1);
    expect(text()).toContain('Added “Leith Hill”. Match your rides to find your efforts on it.');
  });
});
