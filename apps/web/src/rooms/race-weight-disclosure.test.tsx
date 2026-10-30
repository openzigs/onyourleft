// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The owner's ruling of 2026-10-15 on #1354 (ADR 0051 D-1): live W/kg stays in
 * a race, and a rider is told BEFORE they make a race, or ride in one they
 * joined, that the others can work out roughly what they weigh from it. A
 * group ride sends no W/kg to anybody, so it says nothing of the kind.
 *
 * Read off the rendered panel, as the rider reads it.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { EnteredRoom, RoomsPort } from '../net/rooms-port';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import { RACE_WEIGHT_DISCLOSURE, RoomPanel, type RoomPanelProps } from './RoomPanel';
import { northProfile } from './rooms-testing';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const ROOMS: RoomsPort = {
  create: () => Promise.resolve({ kind: 'unreachable' }),
  join: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
  listPublic: () => Promise.resolve({ kind: 'refused', reason: 'no-public-rooms' }),
  joinPublic: () => Promise.resolve({ kind: 'refused', reason: 'no-such-room' }),
  start: () => Promise.resolve({ kind: 'started' }),
  results: () => Promise.resolve({ kind: 'result', rows: [] }),
  blockRider: () => Promise.resolve({ kind: 'unreachable' as const }),
  noticePage: () => undefined,
};

const RACE: EnteredRoom = {
  roomId: 'room-1',
  kind: 'race',
  ridingPosition: 'hoods',
  drafting: true,
  code: undefined,
  madeIt: false,
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

/** Every paragraph that says the disclosure, word for word. */
function disclosures(): Element[] {
  return [...document.querySelectorAll('p')].filter(
    (each) => each.textContent === RACE_WEIGHT_DISCLOSURE,
  );
}

function radio(label: string): HTMLInputElement {
  const found = [...document.querySelectorAll('label')].find((each) =>
    each.textContent?.startsWith(label),
  );
  const input = found?.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`no radio for ${label}`);
  return input;
}

function ridesButton(): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (each) => each.textContent === 'Ride in the room',
  );
  if (found === undefined) throw new Error('no Ride in the room button');
  return found;
}

describe('a race says the others can work out your weight, before you are in it — the owner’s ruling of 2026-10-15', () => {
  it('says it before the rider makes a race, and not while a group ride is chosen', async () => {
    mounted = await mount(<RoomPanel {...panel({})} />);
    await settle();
    expect(disclosures()).toHaveLength(0);

    await activateWithKeyboard(radio('Race'));
    expect(disclosures()).toHaveLength(1);
    expect(disclosures()[0]?.closest('.oyl-rooms__make')).not.toBeNull();

    await activateWithKeyboard(radio('Group ride'));
    expect(disclosures()).toHaveLength(0);
  });

  it('says it in a race joined by its code, above the control that rides it', async () => {
    mounted = await mount(<RoomPanel {...panel({ entered: RACE })} />);
    await settle();
    const said = disclosures();
    expect(said).toHaveLength(1);
    const before = said[0]?.compareDocumentPosition(ridesButton()) ?? 0;
    expect(before & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says nothing of the kind in a group ride', async () => {
    mounted = await mount(<RoomPanel {...panel({ entered: { ...RACE, kind: 'group' } })} />);
    await settle();
    expect(disclosures()).toHaveLength(0);
    expect(document.body.textContent).not.toContain('what you weigh.');
  });
});
