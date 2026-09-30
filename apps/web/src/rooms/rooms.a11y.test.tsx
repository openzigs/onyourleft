// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Every state of the room panel and a race's result, audited — #784 and
 * #785's "every string passes `test:a11y`". The game route itself is walked
 * by `a11y/routes.a11y.test.tsx` with no ports, which renders only the panel's
 * "connect an instance" state; the rest are rendered here, each once.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { EnteredRoom, RaceResultRow, RoomsPort } from '../net/rooms-port';
import { mount, settle, type Mounted } from '../testing/mount';
import { RACE_LEFT_EARLY_TEXT, RaceResult } from './RaceResult';
import { RoomPanel, type RoomPanelProps } from './RoomPanel';
import { northProfile } from './rooms-testing';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const ROWS: readonly RaceResultRow[] = [
  {
    place: 1,
    displayName: 'Ann',
    you: false,
    finishMs: 3_600_000,
    wattsPerKilogram: 4.1,
    flags: [{ durationSeconds: 1200, overWattsPerKilogram: 6.5 }],
  },
  { place: 2, displayName: null, you: false, finishMs: null, wattsPerKilogram: null, flags: [] },
  { place: null, displayName: 'Me', you: true, finishMs: null, wattsPerKilogram: 2.9, flags: [] },
];

const ROOMS: RoomsPort = {
  create: () => Promise.resolve({ kind: 'unreachable' }),
  join: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
  start: () => Promise.resolve({ kind: 'started' }),
  results: () => Promise.resolve({ kind: 'result', rows: ROWS }),
};

const ENTERED: EnteredRoom = {
  roomId: 'room-1',
  kind: 'race',
  ridingPosition: 'hoods',
  code: 'ABCDE-FGHJK-MNPQR',
  profile: northProfile(1_000),
  routeSha256: 'a'.repeat(64),
};

function panel(overrides: Partial<RoomPanelProps>): RoomPanelProps {
  return {
    rooms: ROOMS,
    routes: [{ id: 'r', name: 'Up the hill', profile: northProfile(1_000) }],
    weightDeclared: true,
    position: 'hoods',
    entered: undefined,
    onEnter: () => undefined,
    onRide: () => undefined,
    ...overrides,
  };
}

async function audited(element: React.ReactElement): Promise<void> {
  mounted = await mount(
    <main>
      <h1>Game</h1>
      {element}
    </main>,
  );
  await settle();
  await settle();
  const violations = auditAccessibility(document);
  expect(violations, formatViolations(violations)).toEqual([]);
}

describe('the room panel and a race’s result pass the accessibility audit — #784, #785', () => {
  it.each([
    ['with no instance', panel({ rooms: undefined })],
    ['with no declared weight', panel({ weightDeclared: false })],
    ['ready to make or join', panel({})],
    ['with no route of the rider’s own', panel({ routes: [] })],
    ['in a race it made, with the code to share', panel({ entered: ENTERED })],
    [
      'in a group ride it joined',
      panel({ entered: { ...ENTERED, kind: 'group', code: undefined } }),
    ],
  ])('%s', async (_, props) => {
    await audited(<RoomPanel {...props} />);
  });

  it('a race’s result, the rider’s own line marked as theirs', async () => {
    await audited(<RaceResult rooms={ROOMS} roomId="room-1" finishers={2} ownWatts={210} />);
    expect(document.querySelectorAll('.oyl-race-result__rows li')).toHaveLength(3);
    expect(document.querySelector('[aria-current="true"]')?.textContent).toContain('You');
  });

  it('a race the rider left while it ran: what is kept for them, and the one control that asks', async () => {
    await audited(
      <RaceResult rooms={ROOMS} roomId="room-1" finishers={undefined} ownWatts={210} />,
    );
    expect(document.body.textContent).toContain(RACE_LEFT_EARLY_TEXT);
    expect(document.querySelectorAll('button')).toHaveLength(1);
    expect(document.querySelector('ol')).toBeNull();
  });
});
