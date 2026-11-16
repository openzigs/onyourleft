// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Rooms (#2612): over the REAL instance
 * (`testing/operate-instance-testing.ts`), whose room workers are a list the
 * test fills, and over the scripted port in `instance/testing.ts` for what the
 * screen does with each answer. What is shown after *End room* is read back
 * from the instance's own list.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createOperatePort } from '../instance/operate-port';
import { SCRIPTED_ROOMS, scriptedOperate } from '../instance/testing';
import { closeOperateWorlds, operatedWorld, roomMadeBy } from '../testing/operate-instance-testing';
import {
  activateWithKeyboard,
  chooseOption,
  mount,
  settle,
  typeInto,
  type Mounted,
} from '../testing/mount';
import {
  END_ROOM_CONFIRM_TEXT,
  OperateRoomsPanel,
  ROOM_NOT_ENDED_TEXT,
  ROOMS_UNREADABLE_TEXT,
} from './OperateRoomsPanel';

let mounted: Mounted | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await closeOperateWorlds();
});

function text(of: ParentNode | null | undefined = mounted?.container): string {
  return (of?.textContent ?? '').replace(/\s+/g, ' ');
}

/** The list's lines, top to bottom. */
function rows(): string[] {
  return [...(mounted?.container.querySelectorAll('.oyl-operate__rooms > li') ?? [])].map((each) =>
    text(each),
  );
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

function buttonIn(root: ParentNode | null, name: string): HTMLButtonElement {
  const found = [...(root?.querySelectorAll('button') ?? [])].find(
    (each) => each.textContent === name,
  );
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
}

/** Settle until `done`, for a read that crosses the real instance's handler. */
async function until(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !done(); turn += 1) await settle();
  await settle();
}

async function show(port: Parameters<typeof OperateRoomsPanel>[0]['port']): Promise<void> {
  mounted = await mount(<OperateRoomsPanel port={port} />);
  await until(() => !text().includes('Reading the rooms'));
}

/** *End room* on the `index`th row, then the reason and the code typed into its confirmation. */
async function endRow(index: number, typed: string, reason = 'abuse'): Promise<HTMLButtonElement> {
  const row = mounted?.container.querySelectorAll('.oyl-operate__rooms > li')[index] ?? null;
  await activateWithKeyboard(buttonIn(row, 'End room'));
  await settle();
  const open = dialog();
  const select = open?.querySelector('select');
  const input = open?.querySelector('input');
  if (select === null || select === undefined || input === null || input === undefined) {
    throw new Error('no confirmation form');
  }
  await chooseOption(select, reason);
  await typeInto(input, typed);
  return buttonIn(open, 'End room');
}

describe('the Rooms section over the scripted instance — #2612', () => {
  it('shows each room with its kind, phase, host, riders by name and count, and its code', async () => {
    await show(scriptedOperate().port);
    expect(rows()).toEqual([
      'Race, private, under way. Opened 2026-11-14 19:30 UTC by Ann. 3 riders: Ann, Bea and a rider. Code a1b2c3. End room',
      'Group ride, public, waiting to start. Opened 2026-11-14 18:00 UTC by Cal. Nobody is in it. Code 0f1e2d. End room',
    ]);
  });

  it('keeps End room unable to act until the room’s code is typed, and sends nothing meanwhile', async () => {
    const scripted = scriptedOperate();
    await show(scripted.port);
    const confirm = await endRow(0, 'a1b2c');
    expect(text(dialog())).toContain(END_ROOM_CONFIRM_TEXT);
    expect(text(dialog())).toContain('type the room’s code, a1b2c3');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
    await activateWithKeyboard(confirm);
    await settle();
    expect(scripted.calls.filter((call) => call.startsWith('end room'))).toEqual([]);
    expect(dialog()).not.toBeNull();
    // Another room's code does not do either.
    const typed = dialog()?.querySelector('input');
    if (typed === null || typed === undefined) throw new Error('no input');
    await typeInto(typed, '0f1e2d');
    expect(confirm.getAttribute('aria-disabled')).toBe('true');
  });

  it('ends the room once the code matches, in any case, and shows the list the instance reads after', async () => {
    const scripted = scriptedOperate();
    await show(scripted.port);
    const confirm = await endRow(0, ' A1B2C3', 'stuck');
    expect(confirm.getAttribute('aria-disabled')).toBeNull();
    await activateWithKeyboard(confirm);
    await settle();
    await settle();
    expect(dialog()).toBeNull();
    expect(scripted.calls).toEqual([
      'rooms',
      `end room ${SCRIPTED_ROOMS[0]?.roomId ?? ''} stuck  A1B2C3`,
      'rooms',
    ]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Group ride');
  });

  it('shows the room still there when the instance’s list still has it, read back rather than assumed', async () => {
    const scripted = scriptedOperate();
    scripted.held.endIsLost = true;
    await show(scripted.port);
    await activateWithKeyboard(await endRow(0, 'a1b2c3'));
    await settle();
    await settle();
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toContain('Race');
  });

  it('says the room was not ended when the instance ended nothing, and reads the list again', async () => {
    const scripted = scriptedOperate();
    await show(scripted.port);
    const confirm = await endRow(0, 'a1b2c3');
    // The room ended elsewhere meanwhile: the instance has nothing to end.
    scripted.held.rooms = (scripted.held.rooms ?? []).slice(1);
    await activateWithKeyboard(confirm);
    await settle();
    await settle();
    expect(text()).toContain(ROOM_NOT_ENDED_TEXT);
    expect(rows()).toHaveLength(1);
  });

  it('says the rooms could not be read, and draws no End room', async () => {
    await show(scriptedOperate({ rooms: null }).port);
    expect(text()).toContain(ROOMS_UNREADABLE_TEXT);
    expect(mounted?.container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('the Rooms section over the real instance — #2612', () => {
  it('reads the rooms the instance holds open, ends one by its typed code, and reads the list again', async () => {
    const { owner, rider, approveRider, world, liveRooms } = await operatedWorld();
    await approveRider();
    const race = await roomMadeBy(world, rider.athleteId(), 'race');
    const ride = await roomMadeBy(world, rider.athleteId(), 'group');
    liveRooms.push({ roomId: ride, phase: 'running', athleteIds: [rider.athleteId()] });
    const port = createOperatePort(owner.dependencies);
    await show(port);
    // Newest first: the ride was made after the race.
    expect(rows().map((row) => row.slice(0, 32))).toEqual([
      'Group ride, private, under way. ',
      'Race, private, waiting to start.',
    ]);
    expect(rows()[0]).toContain('1 rider: Rider.');
    const confirm = await endRow(1, race.slice(0, 6), 'maintenance');
    await activateWithKeyboard(confirm);
    await until(() => dialog() === null && rows().length === 1);
    // Read back from the instance: the race is gone from its list, and logged.
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Group ride');
    const log = await port.log();
    expect(log.kind === 'page' ? log.entries[0] : undefined).toMatchObject({
      action: 'room_ended',
      detail: 'maintenance,race,riders=0',
      outcome: 'done',
    });
  });

  it('reads nothing and ends nothing for the deputy, whom the instance answers as no route', async () => {
    const { owner, deputy, rider, approveRider, world } = await operatedWorld();
    await approveRider();
    const race = await roomMadeBy(world, rider.athleteId(), 'race');
    const port = createOperatePort(deputy.dependencies);
    expect(await port.rooms()).toEqual({ kind: 'not-owner' });
    expect(await port.endRoom(race, 'other', race.slice(0, 6))).toEqual({ kind: 'not-ended' });
    // Read back as the owner: the race is still open.
    const read = await createOperatePort(owner.dependencies).rooms();
    expect(read.kind === 'rooms' ? read.rooms.map((room) => room.roomId) : read).toEqual([race]);
  });
});
