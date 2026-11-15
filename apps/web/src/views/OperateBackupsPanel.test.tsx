// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Backups (#2607): over the REAL instance
 * (`testing/operate-instance-testing.ts`), whose `backup` service is played by
 * writing its records through the instance's own store, and over the scripted
 * port in `instance/testing.ts` for what the screen does with each answer.
 * The panel's re-read clock is a hand-turned one, so no case waits on time.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { createOperatePort, type OperateBackup } from '../instance/operate-port';
import { SCRIPTED_BACKUPS, scriptedOperate } from '../instance/testing';
import {
  aSnapshot,
  closeOperateWorlds,
  operatedWorld,
  serveBackupRequest,
  writeBackups,
} from '../testing/operate-instance-testing';
import { activateWithKeyboard, chooseOption, mount, settle, type Mounted } from '../testing/mount';
import {
  BACK_UP_NOW_CONFIRM_TEXT,
  BACKUP_NOT_ASKED_TEXT,
  BACKUP_WAITING_TEXT,
  BACKUPS_REREAD_MILLISECONDS,
  BACKUPS_UNREADABLE_TEXT,
  OperateBackupsPanel,
  type Every,
} from './OperateBackupsPanel';

let mounted: Mounted | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  await closeOperateWorlds();
});

/** A clock turned by hand: what the panel asked to run, and how often. */
function handClock(): { every: Every; tick(): void; running(): number[] } {
  const ticks = new Map<() => void, number>();
  return {
    every: (milliseconds, tick) => {
      ticks.set(tick, milliseconds);
      return () => {
        ticks.delete(tick);
      };
    },
    tick: () => {
      for (const tick of [...ticks.keys()]) tick();
    },
    running: () => [...ticks.values()],
  };
}

function text(of: ParentNode | null | undefined = mounted?.container): string {
  return (of?.textContent ?? '').replace(/\s+/g, ' ');
}

/** The list's lines, top to bottom. */
function rows(): string[] {
  return [...(mounted?.container.querySelectorAll('.oyl-operate__backups > li') ?? [])].map(
    (each) => text(each),
  );
}

function backUpNowButton(): HTMLButtonElement | undefined {
  return [...(mounted?.container.querySelectorAll('button') ?? [])].find(
    (each) => each.textContent === 'Back up now',
  );
}

/** The open confirmation, which Radix portals into the body. */
function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="alertdialog"]');
}

/** Press Back up now, then confirm it. */
async function backUpNow(): Promise<void> {
  const answer = 'Back up now';
  const button = backUpNowButton();
  if (button === undefined) throw new Error('no Back up now');
  await activateWithKeyboard(button);
  await settle();
  const asked = dialog();
  if (asked === null) throw new Error('no confirmation');
  const choice = [...asked.querySelectorAll('button')].find((each) => each.textContent === answer);
  if (choice === undefined) throw new Error(`no ${answer} in the confirmation`);
  await activateWithKeyboard(choice);
  await settle();
  await settle();
}

/** Settle until `done` holds: a sealed read takes more than a couple of turns. */
async function until(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !done(); turn += 1) await settle();
  await settle();
}

/** The restore steps' commands: each `docker compose …` the owner is to run. */
function commands(): string[] {
  return [...(mounted?.container.querySelectorAll('.oyl-operate__restore code') ?? [])]
    .map((each) => text(each))
    .filter((each) => each.startsWith('docker compose'));
}

describe('Backups over the real instance — #2607', () => {
  it('lists three snapshots newest first with their ages, and Back up now waits, then shows the snapshot the service recorded', async () => {
    const { owner, world } = await operatedWorld();
    // Older than the 15 minutes the instance refuses a request within.
    await writeBackups(world, [
      aSnapshot(world, 13 * 3600),
      aSnapshot(world, 7 * 3600),
      aSnapshot(world, 3600),
    ]);
    const clock = handClock();
    mounted = await mount(
      <OperateBackupsPanel port={createOperatePort(owner.dependencies)} every={clock.every} />,
    );
    await until(() => rows().length > 0);
    expect(rows()).toHaveLength(3);
    expect(rows()[0]).toContain('1 hour ago');
    expect(rows()[1]).toContain('7 hours ago');
    expect(rows()[2]).toContain('13 hours ago');
    expect(rows()[0]).toContain(aSnapshot(world, 3600).snapshot);
    expect(clock.running()).toEqual([]);

    await backUpNow();
    await until(() => text().includes(BACKUP_WAITING_TEXT));
    // The button is replaced while the request waits, and the list is read again on the clock.
    expect(text()).toContain(BACKUP_WAITING_TEXT);
    expect(backUpNowButton()).toBeUndefined();
    expect(clock.running()).toEqual([BACKUPS_REREAD_MILLISECONDS]);
    expect(rows()).toHaveLength(3);
    // Focus is not dropped to the page with the button that went.
    // It lands on the sentence that replaced it.
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
    expect(text(document.activeElement)).toBe(text(document.activeElement?.firstElementChild));
    expect(text(document.activeElement)).toContain(BACKUP_WAITING_TEXT);

    // Unserved, a re-read finds the same three.
    clock.tick();
    await until(() => false);
    expect(rows()).toHaveLength(3);

    // The `backup` service serves it: its record, read back through the route.
    world.clock.ms += 30_000;
    const served = aSnapshot(world, 0);
    await serveBackupRequest(world, served);
    clock.tick();
    await until(() => rows().length === 4);
    expect(rows()).toHaveLength(4);
    expect(rows()[0]).toContain(served.snapshot);
    expect(rows()[0]).toContain('asked for from the app');
    expect(text()).not.toContain(BACKUP_WAITING_TEXT);
    expect(backUpNowButton()).toBeDefined();
    // Nothing waits, so nothing is read again.
    expect(clock.running()).toEqual([]);
  });

  it('shows the instance’s own sentence for a refused Back up now, and leaves the list as it was read', async () => {
    const { owner, world } = await operatedWorld();
    // A backup two minutes ago: the instance refuses another for 15 minutes.
    await writeBackups(world, [aSnapshot(world, 120)]);
    mounted = await mount(
      <OperateBackupsPanel
        port={createOperatePort(owner.dependencies)}
        every={handClock().every}
      />,
    );
    await until(() => rows().length > 0);
    const before = rows();
    await backUpNow();
    await until(() => text().includes('15 minutes'));
    expect(text()).toContain(
      'A backup is already waiting, or one was made in the last 15 minutes. Nothing was asked for: each extra backup removes an older one.',
    );
    expect(rows()).toEqual(before);
    expect(text()).not.toContain(BACKUP_WAITING_TEXT);
    // Read back through the instance: nothing waits.
    expect(await world.freshRead((store) => store.pendingBackupRequest())).toBeUndefined();
  });
});

describe('Backups over a scripted instance — #2607', () => {
  it('reads the list again after Back up now rather than editing it, so an instance that recorded nothing shows nothing new', async () => {
    const scripted = scriptedOperate();
    // The instance takes the request and records no backup.
    scripted.held.servesAtOnce = true;
    mounted = await mount(<OperateBackupsPanel port={scripted.port} every={handClock().every} />);
    await settle();
    const before = rows();
    expect(before).toHaveLength(3);
    await backUpNow();
    expect(scripted.calls).toEqual(['backups', 'back up now', 'backups']);
    expect(rows()).toEqual(before);
    expect(backUpNowButton()).toBeDefined();
  });

  it('asks for nothing when the confirmation is declined, and says what Back up now removes', async () => {
    const scripted = scriptedOperate();
    mounted = await mount(<OperateBackupsPanel port={scripted.port} every={handClock().every} />);
    await settle();
    const button = backUpNowButton();
    if (button === undefined) throw new Error('no Back up now');
    await activateWithKeyboard(button);
    await settle();
    expect(text(dialog())).toContain(BACK_UP_NOW_CONFIRM_TEXT);
    // A plain confirmation, not a typed one: nothing to type.
    expect(dialog()?.querySelector('input')).toBeNull();
    const notNow = [...(dialog()?.querySelectorAll('button') ?? [])].find(
      (each) => each.textContent === 'Not now',
    );
    if (notNow === undefined) throw new Error('no Not now');
    await activateWithKeyboard(notNow);
    await settle();
    expect(dialog()).toBeNull();
    expect(scripted.calls).toEqual(['backups']);
  });

  it('has no control that sends a restore: Back up now is the only one that sends anything', async () => {
    const scripted = scriptedOperate();
    mounted = await mount(<OperateBackupsPanel port={scripted.port} every={handClock().every} />);
    await settle();
    const section = mounted.container.querySelector('section');
    expect(
      [...(section?.querySelectorAll('button') ?? [])].map((each) => each.textContent),
    ).toEqual(['Back up now']);
    expect(section?.querySelector('form')).toBeNull();
    expect(section?.querySelectorAll('input, textarea')).toHaveLength(0);
    expect(section?.querySelectorAll('a')).toHaveLength(0);
    // Its one other control picks the snapshot the steps are written for, and sends nothing.
    const picker = section?.querySelector('select');
    if (picker === null || picker === undefined) throw new Error('no snapshot picker');
    await chooseOption(picker, '1');
    await settle();
    expect(scripted.calls).toEqual(['backups']);
  });

  it('writes the restore steps for the chosen snapshot by name, and with no host path', async () => {
    const scripted = scriptedOperate();
    mounted = await mount(<OperateBackupsPanel port={scripted.port} every={handClock().every} />);
    await settle();
    const [newest, , oldest] = SCRIPTED_BACKUPS as [
      Extract<OperateBackup, { outcome: 'done' }>,
      OperateBackup,
      Extract<OperateBackup, { outcome: 'done' }>,
    ];
    // The newest snapshot, by default; the failed run is not offered.
    expect(commands()).toContain(
      `docker compose run --rm --no-deps --entrypoint node backup src/operator/cli.ts restore /backups/${newest.snapshot} --force`,
    );
    const picker = mounted.container.querySelector('select');
    expect([...(picker?.options ?? [])].map((each) => each.value)).toEqual(['3', '1']);
    if (picker === null) throw new Error('no snapshot picker');
    await chooseOption(picker, '1');
    await settle();
    const steps = text(mounted.container.querySelector('.oyl-operate__restore'));
    expect(steps).toContain(`restore /backups/${oldest.snapshot} --force`);
    expect(steps).not.toContain(newest.snapshot);
    expect(steps).toContain('48100 rows and 1200 blobs');
    // In order: stop, restore, rotate the key, verify, start.
    expect(
      commands().map((each) =>
        /cli\.ts (\S+)|compose (stop|up)/.exec(each)?.slice(1).find(Boolean),
      ),
    ).toEqual(['stop', 'restore', 'instance-key', 'verify', 'up']);
    // Every path in a step is inside a container: the snapshot's folder in the
    // `backup` service, or the CLI's own source. The host's folder is never known.
    const paths = steps.split(' ').filter((word) => word.includes('/'));
    expect(paths.length).toBeGreaterThan(0);
    for (const path of paths)
      expect(path).toMatch(/^(\/backups\/snapshot-[0-9A-Za-z-]+|src\/operator\/cli\.ts)$/);
    expect(steps).toContain('rotates the instance’s encryption key');
  });

  it('writes a one-off snapshot’s steps from where deploy.sh puts it', async () => {
    const oneOff: OperateBackup = {
      outcome: 'done',
      id: 9,
      at: '2026-11-14T19:00:00.000Z',
      ageSeconds: 7200,
      snapshot: 'snapshot-2026-11-14T19-00-00-000Z',
      rows: 1,
      blobs: 1,
      sizeBytes: 1,
      offBox: 'not-configured',
      intervalSeconds: null,
      requested: false,
    };
    mounted = await mount(
      <OperateBackupsPanel
        port={scriptedOperate({ backups: [oneOff] }).port}
        every={handClock().every}
      />,
    );
    await settle();
    expect(commands().join(' ')).toContain(
      `restore /backups/pre-deploy/${oneOff.snapshot} --force`,
    );
    expect(rows()[0]).toContain('a one-off');
    // A one-off is not the backup service's: no scheduled snapshot, so nothing is called stale.
    expect(text()).not.toContain('a backup was missed');
  });

  it('warns of a failed off-box copy and a failed run, and of none where all went well', async () => {
    mounted = await mount(
      <OperateBackupsPanel port={scriptedOperate().port} every={handClock().every} />,
    );
    await settle();
    const [newest, failed, oldest] = rows();
    expect(newest).toContain('off-box copy made');
    expect(newest).not.toContain('Off-box copy failed');
    expect(failed).toContain('no snapshot was made (ENOSPC)');
    expect(failed).toContain('This backup run failed');
    expect(oldest).toContain('off-box copy FAILED');
    expect(oldest).toContain('only on the machine the instance runs on');
    expect(newest).toContain('3.4 GB, 48213 rows, 1204 blobs');
    expect(text()).not.toContain('a backup was missed');
  });

  it.each([
    ['just over twice the interval', 2 * 21_600 + 1, true],
    ['exactly twice the interval', 2 * 21_600, false],
  ])('calls the newest scheduled snapshot stale at %s', async (_name, ageSeconds, stale) => {
    const [newest, ...rest] = SCRIPTED_BACKUPS;
    if (newest === undefined) throw new Error('no backups');
    mounted = await mount(
      <OperateBackupsPanel
        port={scriptedOperate({ backups: [{ ...newest, ageSeconds }, ...rest] }).port}
        every={handClock().every}
      />,
    );
    await settle();
    expect(text().includes('more than twice the backup interval of 6 hours')).toBe(stale);
  });

  it('says the backups could not be read, and offers nothing', async () => {
    mounted = await mount(
      <OperateBackupsPanel
        port={scriptedOperate({ backups: null }).port}
        every={handClock().every}
      />,
    );
    await settle();
    expect(text()).toContain(BACKUPS_UNREADABLE_TEXT);
    expect(backUpNowButton()).toBeUndefined();
    expect(rows()).toEqual([]);
  });

  it('says no backup is recorded, and that there is nothing to restore, before the first', async () => {
    mounted = await mount(
      <OperateBackupsPanel
        port={scriptedOperate({ backups: [] }).port}
        every={handClock().every}
      />,
    );
    await settle();
    expect(text()).toContain('No backup is recorded yet.');
    expect(text()).toContain('There is no snapshot to restore yet.');
    expect(mounted.container.querySelector('select')).toBeNull();
    expect(backUpNowButton()).toBeDefined();
  });

  it('says a Back up now the instance did not take was not asked for, and leaves the list', async () => {
    const scripted = scriptedOperate();
    scripted.held.backUpNow = { kind: 'unreachable' };
    mounted = await mount(<OperateBackupsPanel port={scripted.port} every={handClock().every} />);
    await settle();
    await backUpNow();
    expect(text()).toContain(BACKUP_NOT_ASKED_TEXT);
    expect(scripted.calls).toEqual(['backups', 'back up now']);
    expect(backUpNowButton()).toBeDefined();
  });

  it('reads again on the clock while a request the panel did not make is waiting, and only then', async () => {
    const scripted = scriptedOperate();
    scripted.held.pendingSince = '2026-11-14T20:59:00.000Z';
    const clock = handClock();
    mounted = await mount(<OperateBackupsPanel port={scripted.port} every={clock.every} />);
    await settle();
    expect(text()).toContain(BACKUP_WAITING_TEXT);
    expect(clock.running()).toEqual([BACKUPS_REREAD_MILLISECONDS]);
    scripted.held.pendingSince = null;
    clock.tick();
    await settle();
    expect(scripted.calls).toEqual(['backups', 'backups']);
    expect(clock.running()).toEqual([]);
    expect(backUpNowButton()).toBeDefined();
  });
});
