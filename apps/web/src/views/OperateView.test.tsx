// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area (#2603): over the REAL instance (`testing/operate-instance-testing.ts`)
 * as its owner, its deputy and a rider, and over the scripted port in
 * `instance/testing.ts` for what the screen does with each answer. The route
 * is audited over both walk fixtures by `a11y/routes.a11y.test.tsx`, and laid
 * out at a tablet's and a phone's size by `browser/operate.browser.spec.ts`.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { createModerationPort } from '../instance/moderation-port';
import { createOperatePort, OPERATOR_LOG_PAGE } from '../instance/operate-port';
import {
  closeOperateWorlds,
  countingSealed,
  operatedWorld,
  writeOperatorEntries,
} from '../testing/operate-instance-testing';
import { scriptedOperate } from '../instance/testing';
import { AppShell } from '../shell/AppShell';
import { hrefFor, hrefForModerationSection, routeById } from '../shell/routes';
import { activateWithKeyboard, mount, settle, type Mounted } from '../testing/mount';
import {
  OPERATE_NO_PORT,
  OPERATE_PURPOSE,
  OPERATE_SECTIONS_TO_COME,
  OPERATE_STANDING_TEXT,
  OPERATOR_LOG_MORE_UNREADABLE_TEXT,
  OPERATOR_LOG_UNREADABLE_TEXT,
  OperateView,
  operatorActionLabel,
} from './OperateView';
import { MODERATION_SECTION_HEADING } from './ModerationView';

let mounted: Mounted | undefined;

afterEach(async () => {
  mounted?.unmount();
  mounted = undefined;
  globalThis.location.hash = '';
  await closeOperateWorlds();
});

function text(): string {
  return (mounted?.container.textContent ?? '').replace(/\s+/g, ' ');
}

/** The log's lines, top to bottom. */
function logLines(): string[] {
  return [...(mounted?.container.querySelectorAll('.oyl-operate__log > li') ?? [])].map((each) =>
    (each.textContent ?? '').replace(/\s+/g, ' '),
  );
}

function showOlder(): HTMLButtonElement | undefined {
  return [...(mounted?.container.querySelectorAll('button') ?? [])].find(
    (each) => each.textContent === 'Show older entries',
  );
}

/** Settle until `done` holds: a sealed read takes more than a couple of turns. */
async function until(done: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !done(); turn += 1) await settle();
  await settle();
}

const readDone = () => !text().includes('Reading the instance');

describe('the Operate area over the real instance — #2603', () => {
  it(`shows the owner the log newest first, and Show older entries appends the next page`, async () => {
    const { owner, world } = await operatedWorld();
    await writeOperatorEntries(world, OPERATOR_LOG_PAGE + 2);
    mounted = await mount(<OperateView port={createOperatePort(owner.dependencies)} />);
    await until(() => logLines().length > 0);
    expect(text()).toContain(OPERATE_PURPOSE);
    expect(logLines()).toHaveLength(OPERATOR_LOG_PAGE);
    // Newest first: the last written (`blobs=26`) is the first line.
    expect(logLines()[0]).toContain(`blobs=${String(OPERATOR_LOG_PAGE + 1)}`);
    expect(logLines()[0]).toContain('Backup taken');
    expect(logLines()[0]).toContain('from the command line on the host: done');
    const button = showOlder();
    expect(button).toBeDefined();
    if (button !== undefined) await activateWithKeyboard(button);
    await until(() => logLines().length > OPERATOR_LOG_PAGE);
    expect(logLines()).toHaveLength(OPERATOR_LOG_PAGE + 2);
    expect(logLines().at(-2)).toContain('blobs=1)');
    expect(logLines().at(-1)).toContain('blobs=0)');
    // The end of the log: nothing more to ask for.
    expect(showOlder()).toBeUndefined();
  });

  it.each(['deputy', 'rider'] as const)(
    'tells the %s only that their account is not the owner, and never asks for the log',
    async (who) => {
      const operated = await operatedWorld();
      await writeOperatorEntries(operated.world, 2);
      if (who === 'rider') await operated.approveRider();
      const counted = countingSealed(operated.world, '/v1/operate/log');
      const port = createOperatePort({ ...operated[who].dependencies, send: counted.send });
      mounted = await mount(<OperateView port={port} />);
      await until(readDone);
      expect(text()).toContain(OPERATE_STANDING_TEXT['not-owner']);
      expect(logLines()).toEqual([]);
      expect(text()).not.toContain('blobs=');
      // No request reached `/v1/operate/log`: the standing read was the only one.
      expect(counted.count()).toBe(0);
      // The control: the same counting reaches the route when the owner reads.
      const owners = countingSealed(operated.world, '/v1/operate/log');
      await createOperatePort({ ...operated.owner.dependencies, send: owners.send }).log();
      expect(owners.count()).toBe(1);
    },
  );
});

describe('the Operate area’s Status over the real instance — #2604', () => {
  /** The value a Status fact is shown with, by its name. */
  function fact(name: string): string {
    const term = [...(mounted?.container.querySelectorAll('dt') ?? [])].find(
      (each) => each.textContent === name,
    );
    return (term?.nextElementSibling?.textContent ?? '').replace(/\s+/g, ' ');
  }

  it('shows the owner the instance’s counts as the instance holds them, above the log', async () => {
    const { owner, approveRider } = await operatedWorld();
    await approveRider();
    mounted = await mount(<OperateView port={createOperatePort(owner.dependencies)} />);
    await until(() => fact('Accounts') !== '');
    // The owner, the deputy and the approved rider.
    expect(fact('Accounts')).toBe('3 active, 0 awaiting approval, 0 suspended');
    expect(fact('Tunnel')).toBe('not known');
    expect(fact('Last backup')).toBe('not recorded');
    expect(fact('Instance keys')).toBe('ready');
    const headings = [...(mounted.container.querySelectorAll('h2') ?? [])].map(
      (each) => each.textContent,
    );
    expect(headings.slice(0, 7)).toEqual([
      'Status',
      'Accounts',
      'Backups',
      'AI backend',
      'Rooms',
      'Instance keys',
      'Operator log',
    ]);
    expect(OPERATE_SECTIONS_TO_COME).not.toContain('Status');
    expect(OPERATE_SECTIONS_TO_COME).not.toContain('Rooms');
    expect(OPERATE_SECTIONS_TO_COME).not.toContain('Instance keys');
    expect(OPERATE_SECTIONS_TO_COME).not.toContain('Backups');
  });

  it.each(['deputy', 'rider'] as const)(
    'never asks the instance’s status for the %s',
    async (who) => {
      const operated = await operatedWorld();
      const counted = countingSealed(operated.world, '/v1/operate/status');
      const port = createOperatePort({ ...operated[who].dependencies, send: counted.send });
      mounted = await mount(<OperateView port={port} />);
      await until(readDone);
      expect(text()).toContain(OPERATE_STANDING_TEXT['not-owner']);
      expect(fact('Accounts')).toBe('');
      expect(counted.count()).toBe(0);
      // The control: the same counting reaches the route when the owner reads.
      const owners = countingSealed(operated.world, '/v1/operate/status');
      await createOperatePort({ ...operated.owner.dependencies, send: owners.send }).status();
      expect(owners.count()).toBe(1);
    },
  );
});

describe('the Operate area’s Accounts over the real instance — #2605', () => {
  const SHELL = { capabilities: { bluetooth: undefined, secureContext: true } } as const;

  /** The section headed `heading`, or `undefined`. */
  function section(heading: string): HTMLElement | undefined {
    return [...(mounted?.container.querySelectorAll('section') ?? [])].find(
      (each) => each.querySelector('h2')?.textContent === heading,
    );
  }

  function link(name: string): HTMLAnchorElement | undefined {
    return [...(mounted?.container.querySelectorAll('a') ?? [])].find(
      (each) => each.textContent === name,
    );
  }

  /** The names in the Moderation screen's approval queue. */
  function waiting(): string[] {
    return [...(section('Waiting for approval')?.querySelectorAll('h3') ?? [])].map(
      (each) => each.textContent,
    );
  }

  it('shows the owner two accounts awaiting approval, and Go to approvals lands on that heading, focused', async () => {
    const operated = await operatedWorld();
    await operated.anotherRider('Second rider');
    globalThis.location.hash = hrefFor(routeById('operate'));
    mounted = await mount(
      <AppShell
        {...SHELL}
        operate={createOperatePort(operated.owner.dependencies)}
        moderation={createModerationPort(operated.owner.dependencies)}
      />,
    );
    await until(() => link('Go to approvals') !== undefined);
    const accounts = (section('Accounts')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(accounts).toContain('2 awaiting approval');
    expect(accounts).toContain('0 suspended');
    expect(accounts).toContain('Registration mode: approval');
    const approvals = link('Go to approvals');
    expect(approvals?.getAttribute('href')).toBe(hrefForModerationSection('approvals'));
    if (approvals !== undefined) await activateWithKeyboard(approvals);
    await until(() => document.activeElement?.id === MODERATION_SECTION_HEADING.approvals);
    expect(mounted.container.querySelector('h1')?.textContent).toBe('Moderation');
    expect(document.activeElement?.textContent).toBe('Waiting for approval');
    // The queue the count was of, read by the screen that decides it.
    expect(waiting().sort()).toEqual(['Rider', 'Second rider']);
  });

  it('gives the deputy no link-out in Operate, and the Moderation screen still opens for them at a section', async () => {
    const operated = await operatedWorld();
    mounted = await mount(<OperateView port={createOperatePort(operated.deputy.dependencies)} />);
    await until(readDone);
    expect(text()).toContain(OPERATE_STANDING_TEXT['not-owner']);
    expect(section('Accounts')).toBeUndefined();
    expect(link('Go to approvals')).toBeUndefined();
    mounted.unmount();
    globalThis.location.hash = hrefForModerationSection('approvals');
    mounted = await mount(
      <AppShell {...SHELL} moderation={createModerationPort(operated.deputy.dependencies)} />,
    );
    await until(() => document.activeElement?.id === MODERATION_SECTION_HEADING.approvals);
    expect(document.activeElement?.textContent).toBe('Waiting for approval');
    expect(waiting()).toEqual(['Rider']);
  });
});

describe('the Operate area over a scripted instance — #2603', () => {
  it('renders two entries newest first, then Show older entries appends the next page from the port', async () => {
    const scripted = scriptedOperate({ pageSize: 2 });
    mounted = await mount(<OperateView port={scripted.port} />);
    await settle();
    expect(logLines()).toHaveLength(2);
    expect(logLines()[0]).toContain('Restored from a backup');
    expect(logLines()[0]).toContain('failed (keys_not_rotated,blobs=999999999)');
    expect(logLines()[1]).toContain(
      'Room opened, 2026-11-14 09:30 UTC, from the app: done (ride).',
    );
    const button = showOlder();
    if (button === undefined) throw new Error('no Show older entries');
    await activateWithKeyboard(button);
    await settle();
    expect(logLines()).toHaveLength(3);
    expect(logLines()[2]).toContain(
      'Database migrated, 2026-11-14 09:00 UTC, from the command line on the host: done (applied=40).',
    );
    // Backups (#2607) reads its own list as it is drawn; the log's own reads,
    // among the AI backend's (#2611).
    expect(
      scripted.calls.filter(
        (call) => ['standing', 'status', 'backups'].includes(call) || call.startsWith('log'),
      ),
    ).toEqual(['standing', 'status', 'log', 'backups', 'log 2']);
    expect(showOlder()).toBeUndefined();
  });

  it('says what each part of the area is for, and lists the sections still to come', async () => {
    mounted = await mount(<OperateView port={scriptedOperate().port} />);
    await settle();
    expect(text()).toContain(OPERATE_PURPOSE);
    for (const section of OPERATE_SECTIONS_TO_COME) expect(text()).toContain(section);
  });

  it('shows an action a newer instance added by its own name', async () => {
    const scripted = scriptedOperate({
      entries: [
        {
          id: 1,
          at: '2026-11-14T09:00:00.000Z',
          source: 'cli',
          action: 'tunnel_check',
          detail: null,
          outcome: 'done',
        },
      ],
    });
    mounted = await mount(<OperateView port={scripted.port} />);
    await settle();
    expect(logLines()).toEqual([
      'tunnel check, 2026-11-14 09:00 UTC, from the command line on the host: done.',
    ]);
  });

  it('names the instance’s admin pages as an entry’s source, by listener (#2641)', async () => {
    const scripted = scriptedOperate({
      entries: [
        {
          id: 2,
          at: '2026-11-15T09:01:00.000Z',
          source: 'admin_loopback',
          action: 'admin_refused',
          detail: 'code,refused=3',
          outcome: 'refused',
        },
        {
          id: 1,
          at: '2026-11-15T09:00:00.000Z',
          source: 'admin_tunnel',
          action: 'admin_sign_in',
          detail: 'code',
          outcome: 'done',
        },
      ],
    });
    mounted = await mount(<OperateView port={scripted.port} />);
    await settle();
    expect([...logLines()].sort()).toEqual([
      'Admin sign-in attempts refused, 2026-11-15 09:01 UTC, from the admin pages, on the server machine: refused (code,refused=3).',
      'Signed in to the admin pages, 2026-11-15 09:00 UTC, from the admin pages, through the tunnel: done (code).',
    ]);
  });

  it.each([
    ['analysis_settings_set', 'AI settings changed'],
    ['analysis_settings_cleared', 'AI settings returned to .env'],
    ['analysis_model_checked', 'Model checked for tool calling'],
  ])('names the AI backend’s action %s in words (#2611)', (action, label) => {
    expect(operatorActionLabel(action)).toBe(label);
  });

  it.each([
    ['admin_passkey_enrolled', 'Admin passkey added'],
    ['admin_passkey_revoked', 'Admin passkey revoked'],
    ['admin_passkey_confirmed', 'Admin passkey confirmed on the host'],
  ])('names the admin passkeys’ action %s in words (#2642)', (action, label) => {
    expect(operatorActionLabel(action)).toBe(label);
  });

  it('names “back up now” in the log as the owner asked for it (#2607)', () => {
    expect(operatorActionLabel('backup_requested')).toBe('Backup asked for');
  });

  it.each([
    ['constructor', 'constructor'],
    ['__proto__', '  proto  '],
    ['toString', 'toString'],
  ])(
    'labels an action named like a property every object inherits, %s, by its own name',
    (action, label) => {
      expect(operatorActionLabel(action)).toBe(label);
    },
  );

  it('draws an action named `constructor` by its own name, not as an empty label', async () => {
    const scripted = scriptedOperate({
      entries: [
        {
          id: 1,
          at: '2026-11-14T09:00:00.000Z',
          source: 'app',
          action: 'constructor',
          detail: null,
          outcome: 'done',
        },
      ],
    });
    mounted = await mount(<OperateView port={scripted.port} />);
    await settle();
    expect(mounted.container.querySelector('.oyl-operate__log strong')?.textContent).toBe(
      'constructor',
    );
  });

  it('moves focus to the first entry the last page brought, as Show older entries goes', async () => {
    const scripted = scriptedOperate({ pageSize: 2 });
    mounted = await mount(<OperateView port={scripted.port} />);
    await settle();
    const button = showOlder();
    if (button === undefined) throw new Error('no Show older entries');
    await activateWithKeyboard(button);
    await settle();
    expect(showOlder()).toBeUndefined();
    const entries = mounted.container.querySelectorAll('.oyl-operate__log > li');
    expect(entries).toHaveLength(3);
    expect(document.activeElement).toBe(entries[2]);
    // Reachable by script only: it does not join the tab order.
    expect(entries[2]?.getAttribute('tabindex')).toBe('-1');
  });

  it('moves focus to the last entry shown when the last page brought none', async () => {
    const scripted = scriptedOperate({ pageSize: 2 });
    const port = {
      ...scripted.port,
      log: async (cursor?: string) => {
        const read = await scripted.port.log(cursor);
        if (read.kind !== 'page') return read;
        // A full first page with a cursor, then an empty last one.
        return cursor === undefined ? read : { kind: 'page' as const, entries: [], next: null };
      },
    };
    mounted = await mount(<OperateView port={port} />);
    await settle();
    const button = showOlder();
    if (button === undefined) throw new Error('no Show older entries');
    await activateWithKeyboard(button);
    await settle();
    expect(showOlder()).toBeUndefined();
    const entries = mounted.container.querySelectorAll('.oyl-operate__log > li');
    expect(entries).toHaveLength(2);
    expect(document.activeElement).toBe(entries[1]);
  });

  it('leaves focus alone when the rider moved it while the last page was coming', async () => {
    const scripted = scriptedOperate({ pageSize: 2 });
    let arrive: () => void = () => undefined;
    const port = {
      ...scripted.port,
      log: async (cursor?: string) => {
        if (cursor !== undefined) {
          await new Promise<void>((resolve) => {
            arrive = resolve;
          });
        }
        return scripted.port.log(cursor);
      },
    };
    mounted = await mount(
      <>
        <a href="#elsewhere">Elsewhere</a>
        <OperateView port={port} />
      </>,
    );
    await settle();
    const button = showOlder();
    if (button === undefined) throw new Error('no Show older entries');
    await activateWithKeyboard(button);
    const elsewhere = mounted.container.querySelector<HTMLAnchorElement>('a[href="#elsewhere"]');
    elsewhere?.focus();
    arrive();
    await settle();
    expect(logLines()).toHaveLength(3);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('leaves focus on the document after a pointer press brings a middle page, as Safari leaves it', async () => {
    const scripted = scriptedOperate({ pageSize: 1 });
    mounted = await mount(<OperateView port={scripted.port} />);
    await settle();
    const button = showOlder();
    if (button === undefined) throw new Error('no Show older entries');
    // Safari on macOS and iOS does not focus a button on click or tap.
    expect(document.activeElement).toBe(document.body);
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    await settle();
    expect(logLines()).toHaveLength(2);
    expect(showOlder()).toBeDefined();
    expect(document.activeElement).toBe(document.body);
    expect(mounted.container.querySelector('.oyl-operate__log > li[tabindex]')).toBeNull();
  });

  it('leaves focus where it is while there is still an older page to show', async () => {
    const scripted = scriptedOperate({ pageSize: 1 });
    mounted = await mount(<OperateView port={scripted.port} />);
    await settle();
    const button = showOlder();
    if (button === undefined) throw new Error('no Show older entries');
    await activateWithKeyboard(button);
    await settle();
    expect(logLines()).toHaveLength(2);
    expect(document.activeElement?.textContent).toBe('Show older entries');
    expect(mounted.container.querySelector('.oyl-operate__log > li[tabindex]')).toBeNull();
  });

  it('announces how the read ended — the not-the-owner sentence and the unreadable log are polite live regions', async () => {
    const refused = scriptedOperate({ standing: 'not-owner' });
    mounted = await mount(<OperateView port={refused.port} />);
    await settle();
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toContain(
      OPERATE_STANDING_TEXT['not-owner'],
    );
    mounted.unmount();
    const unread = scriptedOperate();
    unread.held.logReadable = false;
    mounted = await mount(<OperateView port={unread.port} />);
    await settle();
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toContain(
      OPERATOR_LOG_UNREADABLE_TEXT,
    );
  });

  it.each(['not-owner', 'signed-out', 'unreachable', 'no-keys'] as const)(
    'tells %s only that, and asks for nothing but the standing',
    async (standing) => {
      const scripted = scriptedOperate({ standing });
      mounted = await mount(<OperateView port={scripted.port} />);
      await settle();
      expect(text()).toContain(OPERATE_STANDING_TEXT[standing]);
      expect(text()).not.toContain(OPERATE_PURPOSE);
      expect(scripted.calls).toEqual(['standing']);
      expect(mounted.container.querySelector('a')?.getAttribute('href')).toBe(
        '#/settings/instance',
      );
    },
  );

  it('says the log could not be read, and draws no entry', async () => {
    const scripted = scriptedOperate();
    scripted.held.logReadable = false;
    mounted = await mount(<OperateView port={scripted.port} />);
    await settle();
    expect(text()).toContain(OPERATOR_LOG_UNREADABLE_TEXT);
    expect(logLines()).toEqual([]);
  });

  it('says a page did not come, keeps what is shown, and offers it again', async () => {
    const scripted = scriptedOperate({ pageSize: 2 });
    mounted = await mount(<OperateView port={scripted.port} />);
    await settle();
    scripted.held.logReadable = false;
    const button = showOlder();
    if (button === undefined) throw new Error('no Show older entries');
    await activateWithKeyboard(button);
    await settle();
    expect(text()).toContain(OPERATOR_LOG_MORE_UNREADABLE_TEXT);
    expect(logLines()).toHaveLength(2);
    scripted.held.logReadable = true;
    const again = showOlder();
    if (again === undefined) throw new Error('no Show older entries offered again');
    await activateWithKeyboard(again);
    await settle();
    expect(text()).not.toContain(OPERATOR_LOG_MORE_UNREADABLE_TEXT);
    expect(logLines()).toHaveLength(3);
  });

  it('says so where there is no local store to keep a sign-in in', async () => {
    mounted = await mount(<OperateView />);
    await settle();
    expect(text()).toContain(OPERATE_NO_PORT);
  });

  it('is what the shell opens at /settings/instance/operate, for a non-owner asking only the standing', async () => {
    const scripted = scriptedOperate({ standing: 'not-owner' });
    globalThis.location.hash = '#/settings/instance/operate';
    mounted = await mount(
      <AppShell
        capabilities={{ bluetooth: undefined, secureContext: true }}
        operate={scripted.port}
      />,
    );
    await until(() => text().includes(OPERATE_STANDING_TEXT['not-owner']));
    expect(mounted.container.querySelector('h1')?.textContent).toBe('Operate');
    expect(text()).toContain(OPERATE_STANDING_TEXT['not-owner']);
    expect(scripted.calls).toEqual(['standing']);
    // Not in the navigation, as Moderation is not.
    expect(mounted.container.querySelector('nav a[href="#/settings/instance/operate"]')).toBeNull();
  });
});
