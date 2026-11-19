// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Connect screen (#777, #778, #773's device list), over the scripted port
 * in `instance/testing.ts`. `instance/instance-port.test.ts` is where the port
 * itself meets a real instance; this is what the screen does with its answers.
 * The route is audited, over both walk fixtures, by `a11y/routes.a11y.test.tsx`.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AFTER_REVOKE_TEXT,
  formatDay,
  noticeText,
  REVOKE_MARK_TEXT,
  revokeKeyName,
} from '../instance/account-change-notices';
import {
  ACCOUNT_CHANGES_UNAVAILABLE_TEXT,
  RENAME_REFUSAL_TEXT,
  type InstancePort,
} from '../instance/instance-port';
import { codeWithCard, INSTANCE_KEY_TEXT } from '../instance/instance-pin';
import {
  SCRIPTED_ACCOUNT_CHANGES,
  SCRIPTED_FINGERPRINT,
  scriptedInstance,
  scriptedModeration,
  scriptedOperate,
} from '../instance/testing';
import type { ModerationPort } from '../instance/moderation-port';
import { createOperatePort } from '../instance/operate-port';
import { closeOperateWorlds, operatedWorld } from '../testing/operate-instance-testing';
import { answer, fieldLabelled, pasteCode, saidUnder } from '../testing/connect-flow';
import {
  activateWithKeyboard,
  mount,
  settle,
  submitForm,
  typeInto,
  typeIntoTextArea,
  type Mounted,
} from '../testing/mount';
import { CHANGE_NAME_TEXT } from './InstanceName';
import {
  DISCONNECT_KEEPS_RIDES,
  INSTANCE_CONNECTED_KEPT_VISIBLE,
  INSTANCE_KEPT_VISIBLE,
  INSTANCE_NO_PORT,
  INSTANCE_RECEIVES,
  INSTANCE_RECEIVES_LEAD,
  InstanceView,
  MODERATE_LINK_TEXT,
  OPERATE_LINK_TEXT,
  RECOVERY_CODES_LEAD,
  TERMS_CHANGED_TEXT,
} from './InstanceView';
import { ACCOUNT_NOTICES_TEXT } from './InstanceDevices';
import { ERASE_ACCOUNT_TEXT } from './EraseAccount';
import { CONNECT_FLOW_TEXT } from './ConnectFlow';
import { OWNER_CLAIM_TEXT } from './OwnerClaim';
import { ERASE_REFUSAL_TEXT, type StatementsPort } from '../instance/statements-port';
import type { BlocksPort } from '../instance/blocks-port';
import { BLOCKS_TEXT } from './BlocksPanel';

const CODE = 'k7mq-x3ra-p9tz-wc4e';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function text(): string {
  return (mounted?.container.textContent ?? '').replace(/\s+/g, ' ');
}

function button(name: string): HTMLButtonElement {
  const found = [...(mounted?.container.querySelectorAll('button') ?? [])].find(
    (each) => each.textContent === name,
  );
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
}

/** Connect by an address alone: the expert's form, in its disclosure since #2828. */
async function connectAs(address: string, name: string): Promise<void> {
  await typeInto(fieldLabelled<HTMLInputElement>(CONNECT_FLOW_TEXT.addressLabel), address);
  await typeInto(fieldLabelled<HTMLInputElement>(CONNECT_FLOW_TEXT.nameLabel), name);
  const form = mounted?.container.querySelector<HTMLFormElement>(
    `form[aria-label="${CONNECT_FLOW_TEXT.expert}"]`,
  );
  if (form === null || form === undefined) throw new Error('no form');
  await submitForm(form);
  await settle();
}

/**
 * What the instance receives is on the screen: in the document, and with no
 * CLOSED disclosure above it — #2828 put it in one drawn open (owner ruling
 * of 2026-11-18), which the rider may fold and nothing opens closed.
 */
function expectReceivesShown(where: string): void {
  for (const sentence of INSTANCE_KEPT_VISIBLE) expect(text(), where).toContain(sentence);
  const list = mounted?.container.querySelector('[data-oyl-kept-visible] ul');
  expect(list, where).not.toBeNull();
  for (let at = list?.parentElement; at; at = at.parentElement) {
    if (at instanceof HTMLDetailsElement) expect(at.open, where).toBe(true);
  }
  expect(list?.closest('details')?.querySelector('summary')?.textContent, where).toBe(
    INSTANCE_RECEIVES_LEAD,
  );
}

describe('the Connect screen — #777, #778', () => {
  it('says it cannot connect where there is no port, and offers no Connect', async () => {
    mounted = await mount(<InstanceView />);
    expect(text()).toContain(INSTANCE_NO_PORT);
    expect(mounted.container.querySelector('button')).toBeNull();
  });

  it('lists what the instance will receive BEFORE sign-in, on the screen at every step, under the controls (#778, #2828)', async () => {
    const line = codeWithCard(`oyl-instance:https://ride.example#${SCRIPTED_FINGERPRINT}`, CODE);
    for (const [where, reach] of [
      ['start', () => Promise.resolve()],
      ['question', () => pasteCode(line)],
      [
        'claim',
        async () => {
          await pasteCode(line);
          await answer('claim');
        },
      ],
      [
        'invite',
        async () => {
          await pasteCode(line);
          await answer('invite');
        },
      ],
      [
        'device',
        async () => {
          await pasteCode(line);
          await answer('device');
        },
      ],
      ['card', () => pasteCode(`oyl-instance:https://ride.example#${SCRIPTED_FINGERPRINT}`)],
    ] as const) {
      const scripted = scriptedInstance();
      mounted = await mount(<InstanceView port={scripted.port} />);
      await settle();
      await reach();
      expectReceivesShown(where);
      // Under every control the step offers (#2828): not between them.
      const receives = mounted.container.querySelector('[data-oyl-kept-visible]')!;
      for (const control of mounted.container.querySelectorAll('button, textarea, input')) {
        expect(
          control.compareDocumentPosition(receives) & Node.DOCUMENT_POSITION_FOLLOWING,
          `${where}: ${control.outerHTML}`,
        ).toBeTruthy();
      }
      // Nothing was asked of the instance but what this device holds.
      expect(scripted.calls, where).toEqual(['current']);
      mounted.unmount();
      mounted = undefined;
    }
  });

  it('draws no claim once a server is connected (#2823)', async () => {
    const scripted = scriptedInstance({ connected: true });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(text()).toContain('Connected');
    expect(text()).not.toContain(OWNER_CLAIM_TEXT.heading);
    expect(() => button(OWNER_CLAIM_TEXT.claim)).toThrow();
  });

  it('says when the name is sent and kept, and what a rider asks the operator for — #892 review', () => {
    // What `instance-port.test.ts` measures against a real instance: a typed
    // name is sent on every Connect and kept only on the first.
    const said = INSTANCE_RECEIVES.join(' ');
    expect(said).toContain('sent each time you press Connect with a name typed');
    expect(said).toContain('keeps it only if it has not seen this device before');
    expect(said).toContain('earlier names');
    expect(said).toContain('Connecting itself sends no ride, route, position or heart rate');
    expect(said).not.toContain('Nothing else from this version of the app');
    // #906: what the instance holds is deleted from this screen, or by its operator.
    expect(DISCONNECT_KEEPS_RIDES).toContain(
      'delete your account on the instance from this screen',
    );
    expect(DISCONNECT_KEEPS_RIDES).toContain('ask whoever runs the instance');
    expect(DISCONNECT_KEEPS_RIDES).not.toContain('this app cannot remove it');
  });

  it('lists what a private room and a sync send, before Connect and kept visible — #778, #1195', async () => {
    // Rooms shipped (#784, #785): a list that ended "nothing else" with no
    // room in it told a rider less than the app sends. Sync's line comes
    // before sync does (#1195 is blocked by #778).
    const room = INSTANCE_RECEIVES.find((line) => line.includes('private room'));
    const sync = INSTANCE_RECEIVES.find((line) => line.includes('Only if you sync'));
    expect(room).toContain('the route of a room you make');
    expect(room).toContain('your power and cadence while you ride in it');
    expect(room).toContain('the weight you declare once as you join');
    expect(sync).toContain('which needs the server’s card');
    expect(sync).toContain('with their positions and heart rate');
    expect(sync).toContain('sealed on this device for the server alone');
    expect(sync).toContain('Nothing is synced until you press Sync now');
    expect(sync).not.toContain('does not offer Sync yet');
    // #1104 (F-3): what a sync also sends since #1100 and #1237.
    expect(sync).toContain('your saved workouts and your workout goals');
    // #1104 (F-3): what the instance receives without a sync.
    const ask = INSTANCE_RECEIVES.find((line) => line.includes('Only if you ask it for one'));
    expect(ask).toContain('a ride’s numbers for a write-up, sealed');
    expect(ask).toContain(
      'your list of words to mask, and your privacy zones: their names, where they are and how large',
    );
    expect(ask).not.toContain('to mask with your privacy zones');
    // #1104 (review): the two other things that go to the instance without a sync.
    expect(ask).toContain('a summary of each block you have ridden, for a re-plan during the ride');
    expect(ask).toContain('the side camera’s pictures');
    expect(INSTANCE_KEPT_VISIBLE).toContain(ask);
    expect(INSTANCE_KEPT_VISIBLE).toContain(room);
    expect(INSTANCE_KEPT_VISIBLE).toContain(sync);
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    const list = mounted.container.querySelector('[data-oyl-kept-visible] ul');
    expect(list?.textContent).toContain(room ?? 'no room line');
    expect(list?.textContent).toContain(sync ?? 'no sync line');
    expectReceivesShown('not connected');
  });

  it('shows the names the instance holds after connecting, not the ones typed', async () => {
    const scripted = scriptedInstance();
    // The instance keeps its own idea of the name: whatever it says is what shows.
    const port: InstancePort = {
      ...scripted.port,
      connect: async (address, name) => {
        const outcome = await scripted.port.connect(address, name);
        scripted.held.displayName = 'Name from the instance';
        return outcome;
      },
    };
    mounted = await mount(<InstanceView port={port} />);
    await settle();
    await connectAs('https://ride.example', 'Anna');
    expect(scripted.calls).toContain('connect https://ride.example');
    expect(text()).toContain('Name from the instance');
    expect(text()).not.toContain('Anna');
    expect(text()).toContain('Lanes by the old quarry');
    // #773: this athlete's devices, this one named.
    expect(text()).toContain('This device');
    expect(text()).toContain('Another device');
    expect(text()).toContain(DISCONNECT_KEEPS_RIDES);
    const source = mounted.container.querySelector('a[target="_blank"]');
    expect(source?.getAttribute('href')).toMatch(/^https:\/\/github\.com\//);
    expect(source?.getAttribute('rel')).toContain('noreferrer');
  });

  it('shows the recovery codes once, and lets the rider put them away', async () => {
    const scripted = scriptedInstance({
      connectAnswer: { kind: 'connected', recoveryCodes: ['aaaa-bbbb', 'cccc-dddd'] },
    });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await connectAs('https://ride.example', '');
    expect(text()).toContain(RECOVERY_CODES_LEAD);
    expect(text()).toContain('cccc-dddd');
    await activateWithKeyboard(button('I have written them down'));
    await settle();
    expect(text()).not.toContain('cccc-dddd');
  });

  it('says why an address was refused, and stays on the form', async () => {
    const scripted = scriptedInstance({
      connectAnswer: { kind: 'refused', text: 'That address starts with http://.' },
    });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await connectAs('http://ride.example', '');
    // #2828: directly under the button that was pressed.
    expect(saidUnder('Connect')).toContain('That address starts with http://.');
    expect(button('Connect')).toBeDefined();
  });

  it('disconnects, and goes back to the form', async () => {
    const scripted = scriptedInstance({ connected: true });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(text()).toContain('Connected');
    await activateWithKeyboard(button('Disconnect'));
    await settle();
    expect(scripted.calls).toContain('disconnect');
    expect(button('Connect')).toBeDefined();
  });

  it('says why a sign-in cannot be read, offers the card box, and reads it again once pinned (#1210)', async () => {
    const scripted = scriptedInstance({
      connected: true,
      state: {
        kind: 'unreadable',
        origin: 'https://ride.example',
        text: INSTANCE_KEY_TEXT['needs-card'],
      },
    });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(text()).toContain(INSTANCE_KEY_TEXT['needs-card']);
    expect(text()).not.toContain('did not answer');
    expect(button('Disconnect')).toBeDefined();
    expect(scripted.calls).not.toContain('devices');
    // The card, given here, opens it: the screen reads the sign-in again.
    const box = mounted.container.querySelector('textarea');
    if (box === null) throw new Error('no card box');
    await typeIntoTextArea(box, `oyl-instance:https://ride.example#${SCRIPTED_FINGERPRINT}`);
    await activateWithKeyboard(button('Use this card'));
    await settle();
    expect(scripted.calls.filter((call) => call === 'current')).toHaveLength(2);
    expect(text()).toContain('Connected');
    expect(scripted.calls).toContain('devices');
  });

  it('says so when the instance no longer accepts this device, and still offers Disconnect', async () => {
    const scripted = scriptedInstance({
      connected: true,
      state: { kind: 'signed-out', origin: 'https://ride.example' },
    });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(text()).toContain('no longer accepts this device’s sign-in');
    expect(button('Disconnect')).toBeDefined();
    // No device list is asked for a session the instance refused.
    expect(scripted.calls).not.toContain('devices');
  });
});

describe('the link to Moderation, for the instance’s moderator only — #955', () => {
  function moderateLink(): HTMLAnchorElement | undefined {
    return [...(mounted?.container.querySelectorAll('a') ?? [])].find(
      (each) => each.textContent === MODERATE_LINK_TEXT,
    );
  }

  it('is drawn for the moderator, and goes to the Moderation route', async () => {
    const scripted = scriptedInstance({ connected: true });
    const moderation = scriptedModeration({ standing: 'moderator' });
    mounted = await mount(<InstanceView port={scripted.port} moderation={moderation.port} />);
    await settle();
    expect(moderateLink()?.getAttribute('href')).toBe('#/settings/instance/moderation');
    expect(moderation.calls).toEqual(['standing']);
  });

  it.each(['not-moderator', 'signed-out', 'unreachable'] as const)(
    'is not drawn for an account that is not the moderator (%s)',
    async (standing) => {
      const scripted = scriptedInstance({ connected: true });
      const moderation = scriptedModeration({ standing });
      mounted = await mount(<InstanceView port={scripted.port} moderation={moderation.port} />);
      await settle();
      expect(moderateLink()).toBeUndefined();
    },
  );

  it('is not asked for, or drawn, before this device connects', async () => {
    const scripted = scriptedInstance({ connected: false });
    const moderation = scriptedModeration({ standing: 'moderator' });
    mounted = await mount(<InstanceView port={scripted.port} moderation={moderation.port} />);
    await settle();
    expect(moderateLink()).toBeUndefined();
    expect(moderation.calls).toEqual([]);
  });
});

describe('the link to Operate, for the instance’s owner only — #2603', () => {
  afterEach(async () => {
    await closeOperateWorlds();
  });

  function operateLink(): HTMLAnchorElement | undefined {
    return [...(mounted?.container.querySelectorAll('a') ?? [])].find(
      (each) => each.textContent === OPERATE_LINK_TEXT,
    );
  }

  // The session's `moderatorRole`, as the REAL instance gives it to each
  // device: 'owner', 'deputy' and null.
  it.each([
    ['owner', 'owner', true],
    ['deputy', 'deputy', false],
    ['rider', null, false],
  ] as const)('for the %s, whose moderatorRole is %s, is drawn: %s', async (who, _role, drawn) => {
    const operated = await operatedWorld();
    if (who === 'rider') await operated.approveRider();
    const real = createOperatePort(operated[who].dependencies);
    let answered = false;
    const operate = {
      ...real,
      standing: async () => {
        const standing = await real.standing();
        answered = true;
        return standing;
      },
    };
    const scripted = scriptedInstance({ connected: true });
    mounted = await mount(<InstanceView port={scripted.port} operate={operate} />);
    for (let turn = 0; turn < 200 && !answered; turn += 1) await settle();
    await settle();
    expect(answered).toBe(true);
    expect(operateLink() !== undefined).toBe(drawn);
    if (drawn) {
      expect(operateLink()?.getAttribute('href')).toBe('#/settings/instance/operate');
    }
  });

  it('is drawn for the owner over the scripted port, as a button-sized link', async () => {
    const scripted = scriptedInstance({ connected: true });
    const operate = scriptedOperate({ standing: 'owner' });
    mounted = await mount(<InstanceView port={scripted.port} operate={operate.port} />);
    await settle();
    expect(operateLink()?.getAttribute('href')).toBe('#/settings/instance/operate');
    expect(operateLink()?.className).toBe('oyl-button oyl-button--secondary');
    expect(operate.calls).toEqual(['standing']);
  });

  it('is not drawn for a moderator who is not the owner, who still gets the Moderation link', async () => {
    const scripted = scriptedInstance({ connected: true });
    const moderation = scriptedModeration({ standing: 'moderator' });
    const operate = scriptedOperate({ standing: 'not-owner' });
    mounted = await mount(
      <InstanceView port={scripted.port} moderation={moderation.port} operate={operate.port} />,
    );
    await settle();
    expect(operateLink()).toBeUndefined();
    expect(text()).toContain(MODERATE_LINK_TEXT);
  });

  it.each(['signed-out', 'unreachable', 'no-keys'] as const)(
    'is not drawn when the standing is %s',
    async (standing) => {
      const scripted = scriptedInstance({ connected: true });
      const operate = scriptedOperate({ standing });
      mounted = await mount(<InstanceView port={scripted.port} operate={operate.port} />);
      await settle();
      expect(operateLink()).toBeUndefined();
    },
  );

  it('is asked at the same time as the Moderation standing, not after it', async () => {
    const scripted = scriptedInstance({ connected: true });
    const moderation = scriptedModeration({ standing: 'moderator' });
    let answerModeration: (standing: 'moderator') => void = () => undefined;
    const held = {
      ...moderation.port,
      standing: () =>
        new Promise<'moderator'>((resolve) => {
          answerModeration = resolve;
        }),
    };
    const operate = scriptedOperate({ standing: 'owner' });
    mounted = await mount(
      <InstanceView port={scripted.port} moderation={held} operate={operate.port} />,
    );
    await settle();
    // Moderation has not answered, and Operate has already been asked.
    expect(operate.calls).toEqual(['standing']);
    expect(operateLink()).toBeUndefined();
    answerModeration('moderator');
    await settle();
    expect(operateLink()?.getAttribute('href')).toBe('#/settings/instance/operate');
    expect(text()).toContain(MODERATE_LINK_TEXT);
    expect(operate.calls).toEqual(['standing']);
  });

  it('is not asked for, or drawn, before this device connects', async () => {
    const scripted = scriptedInstance({ connected: false });
    const operate = scriptedOperate({ standing: 'owner' });
    mounted = await mount(<InstanceView port={scripted.port} operate={operate.port} />);
    await settle();
    expect(operateLink()).toBeUndefined();
    expect(operate.calls).toEqual([]);
  });
});

describe('the riders this rider blocked — #1529', () => {
  function blocksPort() {
    const calls: string[] = [];
    const port: BlocksPort = {
      read: () => {
        calls.push('read');
        return Promise.resolve({
          kind: 'blocks',
          blocks: [{ handle: 'a'.repeat(32), name: 'Ann', blockedAt: 1_790_000_000 }],
        });
      },
      unblock: () => Promise.resolve({ kind: 'unblocked' }),
    };
    return { port, calls };
  }

  it('lists them once this device is signed in', async () => {
    const blocks = blocksPort();
    mounted = await mount(
      <InstanceView port={scriptedInstance({ connected: true }).port} blocks={blocks.port} />,
    );
    await settle();
    expect(text()).toContain(BLOCKS_TEXT.heading);
    expect(text()).toContain('Ann, blocked 2026-09-21');
  });

  it('is not asked for, or drawn, before this device connects', async () => {
    const blocks = blocksPort();
    mounted = await mount(
      <InstanceView port={scriptedInstance({ connected: false }).port} blocks={blocks.port} />,
    );
    await settle();
    expect(text()).not.toContain(BLOCKS_TEXT.heading);
    expect(blocks.calls).toEqual([]);
  });
});

describe('terms of service the rider has not read — #909', () => {
  it('says so, links the instance’s terms, and stops saying so once they are marked read', async () => {
    const scripted = scriptedInstance({ connected: true });
    scripted.held.termsVersion = '2026-11-01';
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(text()).toContain(TERMS_CHANGED_TEXT.lead('2026-11-01'));
    const link = [...(mounted.container.querySelectorAll('a') ?? [])].find(
      (each) => each.textContent === TERMS_CHANGED_TEXT.read,
    );
    expect(link?.getAttribute('href')).toBe('https://ride.example/terms');
    expect(link?.getAttribute('target')).toBe('_blank');
    await activateWithKeyboard(button(TERMS_CHANGED_TEXT.done));
    await settle();
    expect(scripted.calls).toContain('markTermsRead 2026-11-01');
    expect(text()).not.toContain(TERMS_CHANGED_TEXT.lead('2026-11-01'));
  });

  it('says nothing for an instance that publishes no terms, or terms already read', async () => {
    const scripted = scriptedInstance({ connected: true });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(text()).not.toContain('terms of service took effect');
    mounted.unmount();
    scripted.held.termsVersion = '2026-11-01';
    scripted.held.termsRead = '2026-11-01';
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(text()).not.toContain('terms of service took effect');
  });
});

describe('the account-change notices and a revoke, on the device list — #1208', () => {
  const key = (pair: string): string => pair.repeat(32);
  const THIS = key('a1');
  const REVOKED = key('b2');
  const SINCE = key('c3');
  const LINKED = key('d4');
  const OLDER = key('e5');
  const ORDER = [OLDER, THIS, REVOKED, SINCE, LINKED];

  /** This device, the key to revoke, one added after it, one it linked, and one older. */
  function fiveKeys(): ReturnType<typeof scriptedInstance> {
    const scripted = scriptedInstance({ connected: true });
    const device = (publicKey: string, addedAt: number, thisDevice = false) => ({
      publicKey,
      addedAt,
      lastUsedAt: null,
      revokedAt: null,
      thisDevice,
    });
    scripted.held.devices = [
      device(OLDER, 1_780_000_000),
      // Added after the key it revokes, so `revokeMarks` alone would mark it.
      device(THIS, 1_790_120_000, true),
      device(REVOKED, 1_790_100_000),
      device(SINCE, 1_790_150_000),
      device(LINKED, 1_789_000_000),
    ];
    scripted.held.changes = [
      ...SCRIPTED_ACCOUNT_CHANGES,
      {
        id: 5,
        at: 1_790_400_000,
        kind: 'key_added',
        actorKey: REVOKED,
        subjectKey: LINKED,
        subjectAddedAt: 1_789_000_000,
        via: 'link_code',
        address: null,
      },
    ];
    return scripted;
  }

  const day = formatDay;
  // Named against the five keys, so it carries a time only where the zone the
  // test runs in puts another of them on the same day.
  const REVOKED_NAME = revokeKeyName(
    { publicKey: REVOKED, addedAt: 1_790_100_000 },
    fiveKeys().held.devices,
  );

  /** The device list's line for a key, in {@link ORDER}. */
  function item(publicKey: string): string {
    const found = [...(mounted?.container.querySelectorAll('.oyl-instance__devices li') ?? [])][
      ORDER.indexOf(publicKey)
    ];
    return (found?.textContent ?? '').replace(/\s+/g, ' ');
  }

  it('shows every notice in its sentence, and keeps it until the rider acknowledges', async () => {
    const scripted = scriptedInstance({ connected: true });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    const keys = scripted.held.devices;
    const notices = SCRIPTED_ACCOUNT_CHANGES.filter((entry) => entry.actorKey !== THIS);
    expect(notices).toHaveLength(2);
    for (const notice of notices) expect(text()).toContain(noticeText(notice, keys, THIS));
    // Not this device's own changes, and nothing tucked in a disclosure.
    expect(text()).not.toContain('this device made a link code');
    const list = mounted.container.querySelector('.oyl-instance__notices');
    expect(list?.closest('details')).toBeNull();
    scripted.calls.length = 0;
    await activateWithKeyboard(button(ACCOUNT_NOTICES_TEXT.acknowledge));
    await settle();
    // Through the newest notice, and the log read again through the port.
    expect(scripted.calls).toEqual(['acknowledgeAccountChanges 4', 'accountChanges']);
    expect(scripted.held.acknowledgedThrough).toBe(4);
    expect(mounted.container.querySelector('.oyl-instance__notices')).toBeNull();
    for (const notice of notices) expect(text()).not.toContain(noticeText(notice, keys, THIS));
  });

  it('keeps the notices, and says why, when the mark could not be moved', async () => {
    const scripted = scriptedInstance({ connected: true });
    const port: InstancePort = {
      ...scripted.port,
      acknowledgeAccountChanges: () =>
        Promise.resolve({
          kind: 'unavailable',
          text: ACCOUNT_CHANGES_UNAVAILABLE_TEXT['not-acknowledged'],
        }),
    };
    mounted = await mount(<InstanceView port={port} />);
    await settle();
    await activateWithKeyboard(button(ACCOUNT_NOTICES_TEXT.acknowledge));
    await settle();
    expect(text()).toContain(ACCOUNT_CHANGES_UNAVAILABLE_TEXT['not-acknowledged']);
    expect(mounted.container.querySelector('.oyl-instance__notices')).not.toBeNull();
  });

  it('says the log cannot be shown, and still lists the devices', async () => {
    const scripted = scriptedInstance({ connected: true });
    const port: InstancePort = {
      ...scripted.port,
      accountChanges: () =>
        Promise.resolve({
          kind: 'unavailable',
          text: ACCOUNT_CHANGES_UNAVAILABLE_TEXT['no-answer'],
        }),
    };
    mounted = await mount(<InstanceView port={port} />);
    await settle();
    expect(text()).toContain(ACCOUNT_CHANGES_UNAVAILABLE_TEXT['no-answer']);
    expect(text()).toContain('Another device');
  });

  it('revokes a key only once asked twice, then marks the list and says what a revoke did', async () => {
    const scripted = fiveKeys();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(text()).not.toContain(AFTER_REVOKE_TEXT);
    await activateWithKeyboard(button(ACCOUNT_NOTICES_TEXT.revoke(REVOKED_NAME)));
    await settle();
    expect(scripted.calls.some((call) => call.startsWith('revokeDevice'))).toBe(false);
    expect(text()).toContain(ACCOUNT_NOTICES_TEXT.confirm(REVOKED_NAME));
    await activateWithKeyboard(button(ACCOUNT_NOTICES_TEXT.confirmRevoke));
    await settle();
    expect(scripted.calls).toContain(`revokeDevice ${REVOKED}`);
    // Read back: the list again, from the port, with the revoke in it.
    expect(scripted.calls.filter((call) => call === 'devices')).toHaveLength(2);
    expect(item(REVOKED)).toContain('removed');
    const above = [...mounted.container.querySelectorAll('p')].find(
      (each) => each.textContent === AFTER_REVOKE_TEXT,
    );
    const list = mounted.container.querySelector('.oyl-instance__devices');
    expect(above).toBeDefined();
    expect(
      (above as Element).compareDocumentPosition(list as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(item(SINCE)).toContain(REVOKE_MARK_TEXT['added-since']);
    expect(item(LINKED)).toContain(REVOKE_MARK_TEXT['linked-by-revoked']);
    // Neither mark on this device, the revoked key itself, or a key older than it.
    for (const unmarked of [THIS, REVOKED, OLDER]) {
      expect(item(unmarked)).not.toContain(REVOKE_MARK_TEXT['added-since']);
      expect(item(unmarked)).not.toContain(REVOKE_MARK_TEXT['linked-by-revoked']);
    }
  });

  it('keeps a key the rider thought better of, and sends nothing', async () => {
    const scripted = fiveKeys();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await activateWithKeyboard(button(ACCOUNT_NOTICES_TEXT.revoke(REVOKED_NAME)));
    await settle();
    await activateWithKeyboard(button(ACCOUNT_NOTICES_TEXT.keep));
    await settle();
    expect(scripted.calls.some((call) => call.startsWith('revokeDevice'))).toBe(false);
    expect(text()).not.toContain(ACCOUNT_NOTICES_TEXT.confirm(REVOKED_NAME));
  });

  it('offers no revoke of this device, of a key already revoked, or of the last key', async () => {
    const scripted = scriptedInstance({ connected: true });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    const revokes = (): (string | null)[] =>
      [...(mounted?.container.querySelectorAll('button') ?? [])]
        .map((each) => each.textContent)
        .filter((name) => (name ?? '').startsWith('Revoke the key'));
    // Two live keys: only the other one is offered.
    const other = `the key added on ${day(scripted.held.devices[1]?.addedAt ?? 0)}`;
    expect(revokes()).toEqual([ACCOUNT_NOTICES_TEXT.revoke(other)]);
    mounted.unmount();
    // The other one revoked: this device is the last live key, and nothing is offered.
    await scripted.port.revokeDevice(REVOKED);
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(revokes()).toEqual([]);
  });

  it('tells two keys added the same day apart by their time, on the button and when asked', async () => {
    const scripted = fiveKeys();
    // Local times, so the two share a day in whatever zone the test runs in.
    const at = (hour: number, minute: number): number =>
      new Date(2026, 8, 22, hour, minute).getTime() / 1000;
    scripted.held.devices = scripted.held.devices.map((device) =>
      device.publicKey === REVOKED
        ? { ...device, addedAt: at(9, 30) }
        : device.publicKey === SINCE
          ? { ...device, addedAt: at(14, 5) }
          : device,
    );
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    const later = 'the key added on 22 September at 14:05';
    const earlier = 'the key added on 22 September at 09:30';
    // Each is found by its accessible name, and no two revoke buttons share one.
    const names = [...mounted.container.querySelectorAll('button')]
      .map((each) => each.textContent ?? '')
      .filter((name) => name.startsWith('Revoke the key'));
    expect(names).toContain(ACCOUNT_NOTICES_TEXT.revoke(later));
    expect(names).toContain(ACCOUNT_NOTICES_TEXT.revoke(earlier));
    expect(new Set(names).size).toBe(names.length);
    // A key alone on its day keeps the day alone.
    expect(
      button(ACCOUNT_NOTICES_TEXT.revoke(`the key added on ${day(1_780_000_000)}`)),
    ).toBeDefined();
    await activateWithKeyboard(button(ACCOUNT_NOTICES_TEXT.revoke(later)));
    await settle();
    expect(text()).toContain(ACCOUNT_NOTICES_TEXT.confirm(later));
    await activateWithKeyboard(button(ACCOUNT_NOTICES_TEXT.confirmRevoke));
    await settle();
    expect(scripted.calls).toContain(`revokeDevice ${SINCE}`);
  });

  it('says why a key was not revoked, and marks nothing', async () => {
    const scripted = fiveKeys();
    const port: InstancePort = {
      ...scripted.port,
      revokeDevice: () =>
        Promise.resolve({
          kind: 'unavailable',
          text: ACCOUNT_CHANGES_UNAVAILABLE_TEXT['not-revoked'],
        }),
    };
    mounted = await mount(<InstanceView port={port} />);
    await settle();
    await activateWithKeyboard(button(ACCOUNT_NOTICES_TEXT.revoke(REVOKED_NAME)));
    await settle();
    await activateWithKeyboard(button(ACCOUNT_NOTICES_TEXT.confirmRevoke));
    await settle();
    expect(text()).toContain(ACCOUNT_CHANGES_UNAVAILABLE_TEXT['not-revoked']);
    expect(text()).not.toContain(AFTER_REVOKE_TEXT);
    expect(text()).not.toContain(REVOKE_MARK_TEXT['added-since']);
  });
});

describe('deleting the account on the instance from the Instance screen — #906', () => {
  /**
   * A statements port with no statements, whose deletion does what the real
   * one does to this device (`statements-port.test.ts` holds that against a
   * real instance): on `erased`, the sign-in is forgotten — here, the scripted
   * instance stops being connected — and nothing else.
   */
  function erasing(
    scripted: ReturnType<typeof scriptedInstance>,
    outcome: Awaited<ReturnType<StatementsPort['eraseAccount']>>,
  ): { readonly port: StatementsPort; readonly asked: () => number } {
    let asked = 0;
    return {
      asked: () => asked,
      port: {
        read: () => Promise.resolve({ kind: 'statements', statements: [] }),
        appeal: () => Promise.reject(new Error('no appeal in this test')),
        exportAccount: () => Promise.reject(new Error('no export in this test')),
        eraseAccount: () => {
          asked += 1;
          if (outcome.kind === 'erased') scripted.held.connected = false;
          return Promise.resolve(outcome);
        },
      },
    };
  }

  it('asks first, says nothing on this device is deleted, and sends nothing until confirmed', async () => {
    const scripted = scriptedInstance({ connected: true });
    const statements = erasing(scripted, { kind: 'erased' });
    mounted = await mount(<InstanceView port={scripted.port} statements={statements.port} />);
    await settle();
    expect(text()).toContain(ERASE_ACCOUNT_TEXT.heading);
    await activateWithKeyboard(button(ERASE_ACCOUNT_TEXT.erase));
    await settle();
    expect(text()).toContain(ERASE_ACCOUNT_TEXT.confirm);
    expect(ERASE_ACCOUNT_TEXT.confirm).toContain('Nothing on this device is deleted');
    expect(ERASE_ACCOUNT_TEXT.confirm).toContain('everything this instance holds about you');
    expect(statements.asked()).toBe(0);
    await activateWithKeyboard(button(ERASE_ACCOUNT_TEXT.keep));
    await settle();
    expect(text()).not.toContain(ERASE_ACCOUNT_TEXT.confirm);
    expect(statements.asked()).toBe(0);
    expect(text()).toContain('Lanes by the old quarry');
  });

  it('deletes it on confirmation, and the screen READ BACK shows this device disconnected', async () => {
    const scripted = scriptedInstance({ connected: true });
    const statements = erasing(scripted, { kind: 'erased' });
    mounted = await mount(<InstanceView port={scripted.port} statements={statements.port} />);
    await settle();
    await activateWithKeyboard(button(ERASE_ACCOUNT_TEXT.erase));
    await settle();
    await activateWithKeyboard(button(ERASE_ACCOUNT_TEXT.confirmErase));
    await settle();
    expect(statements.asked()).toBe(1);
    // What shows is what the port reads now, not what the press assumed.
    expect(scripted.calls.filter((call) => call === 'current').length).toBeGreaterThan(1);
    expect(text()).toContain(ERASE_ACCOUNT_TEXT.erased);
    expect(text()).not.toContain('Lanes by the old quarry');
    expect(text()).not.toContain(ERASE_ACCOUNT_TEXT.heading);
    expect(button('Connect')).toBeDefined();
  });

  it('says why when the instance does not delete it, and stays signed in', async () => {
    const scripted = scriptedInstance({ connected: true });
    const statements = erasing(scripted, { kind: 'refused', text: ERASE_REFUSAL_TEXT });
    mounted = await mount(<InstanceView port={scripted.port} statements={statements.port} />);
    await settle();
    await activateWithKeyboard(button(ERASE_ACCOUNT_TEXT.erase));
    await settle();
    await activateWithKeyboard(button(ERASE_ACCOUNT_TEXT.confirmErase));
    await settle();
    expect(statements.asked()).toBe(1);
    expect(text()).toContain(ERASE_REFUSAL_TEXT);
    expect(text()).not.toContain(ERASE_ACCOUNT_TEXT.erased);
    expect(text()).toContain('Lanes by the old quarry');
  });

  it('cannot be kept once the deletion is sent: the confirmation stays until the answer', async () => {
    const scripted = scriptedInstance({ connected: true });
    let answer: (outcome: Awaited<ReturnType<StatementsPort['eraseAccount']>>) => void = () => {};
    const port: StatementsPort = {
      ...erasing(scripted, { kind: 'erased' }).port,
      eraseAccount: () =>
        new Promise((resolve) => {
          answer = (outcome) => {
            scripted.held.connected = false;
            resolve(outcome);
          };
        }),
    };
    mounted = await mount(<InstanceView port={scripted.port} statements={port} />);
    await settle();
    await activateWithKeyboard(button(ERASE_ACCOUNT_TEXT.erase));
    await settle();
    await activateWithKeyboard(button(ERASE_ACCOUNT_TEXT.confirmErase));
    await settle();
    expect(button(ERASE_ACCOUNT_TEXT.keep).getAttribute('aria-disabled')).toBe('true');
    await activateWithKeyboard(button(ERASE_ACCOUNT_TEXT.keep));
    await settle();
    expect(text()).toContain(ERASE_ACCOUNT_TEXT.confirm);
    answer({ kind: 'erased' });
    await settle();
    expect(text()).toContain(ERASE_ACCOUNT_TEXT.erased);
  });

  it('is not offered to a device that is not signed in', async () => {
    const signedOut = scriptedInstance({
      connected: true,
      state: { kind: 'signed-out', origin: 'https://ride.example' },
    });
    mounted = await mount(
      <InstanceView
        port={signedOut.port}
        statements={erasing(signedOut, { kind: 'erased' }).port}
      />,
    );
    await settle();
    expect(text()).toContain('Not signed in');
    expect(text()).not.toContain(ERASE_ACCOUNT_TEXT.heading);
    mounted.unmount();
    const notConnected = scriptedInstance({ connected: false });
    mounted = await mount(
      <InstanceView
        port={notConnected.port}
        statements={erasing(notConnected, { kind: 'erased' }).port}
      />,
    );
    await settle();
    expect(text()).not.toContain(ERASE_ACCOUNT_TEXT.heading);
  });
});

describe('changing the name other riders see, from the Instance screen — #906 item 2', () => {
  /** The rename section's field, found by its label. */
  function renameField(): HTMLInputElement {
    const label = [...(mounted?.container.querySelectorAll('label') ?? [])].find(
      (each) => each.textContent === CHANGE_NAME_TEXT.label,
    );
    const field = mounted?.container.querySelector(`[id="${label?.htmlFor ?? ''}"]`);
    if (!(field instanceof HTMLInputElement)) throw new Error('no rename field');
    return field;
  }

  async function renameTo(name: string): Promise<void> {
    const field = renameField();
    await typeInto(field, name);
    const form = field.closest('form');
    if (form === null) throw new Error('no rename form');
    await submitForm(form);
    await settle();
  }

  /** The name the Connected panel shows, beside "Your name there". */
  function shownName(): string | null | undefined {
    const term = [...(mounted?.container.querySelectorAll('dt') ?? [])].find(
      (each) => each.textContent === 'Your name there',
    );
    return term?.nextElementSibling?.textContent;
  }

  it('says the earlier names are kept before the press, and sends nothing until it', async () => {
    const scripted = scriptedInstance({ connected: true });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    expect(text()).toContain(CHANGE_NAME_TEXT.heading);
    expect(INSTANCE_CONNECTED_KEPT_VISIBLE).toContain(CHANGE_NAME_TEXT.earlierNames);
    const note = [...mounted.container.querySelectorAll('p')].find(
      (each) => each.textContent === CHANGE_NAME_TEXT.earlierNames,
    );
    expect(note).toBeDefined();
    expect(
      (note as Element).compareDocumentPosition(button(CHANGE_NAME_TEXT.change)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(scripted.calls.some((call) => call.startsWith('rename'))).toBe(false);
  });

  it('changes it, and shows the name READ BACK from the instance, not the one typed', async () => {
    const scripted = scriptedInstance({ connected: true });
    // The instance keeps its own idea of the name: whatever it says is what shows.
    const port: InstancePort = {
      ...scripted.port,
      rename: async (name) => {
        const outcome = await scripted.port.rename(name);
        scripted.held.displayName = 'Name from the instance';
        return outcome;
      },
    };
    mounted = await mount(<InstanceView port={port} />);
    await settle();
    expect(shownName()).toBe('Rider');
    const reads = scripted.calls.filter((call) => call === 'current').length;
    await renameTo('Anna B');
    expect(scripted.calls).toContain('rename Anna B');
    expect(scripted.calls.filter((call) => call === 'current').length).toBeGreaterThan(reads);
    expect(shownName()).toBe('Name from the instance');
    expect(text()).toContain(CHANGE_NAME_TEXT.changed);
    expect(renameField().value).toBe('');
  });

  it('says why a name was not changed, and keeps the name shown and the one typed', async () => {
    const scripted = scriptedInstance({
      connected: true,
      renameAnswer: { kind: 'refused', text: RENAME_REFUSAL_TEXT.rate_limited },
    });
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    await renameTo('Anna B');
    expect(text()).toContain(RENAME_REFUSAL_TEXT.rate_limited);
    expect(text()).not.toContain(CHANGE_NAME_TEXT.changed);
    expect(shownName()).toBe('Rider');
    expect(renameField().value).toBe('Anna B');
  });

  it('is not offered to a device that is not signed in', async () => {
    const signedOut = scriptedInstance({
      connected: true,
      state: { kind: 'signed-out', origin: 'https://ride.example' },
    });
    mounted = await mount(<InstanceView port={signedOut.port} />);
    await settle();
    expect(text()).toContain('Not signed in');
    expect(text()).not.toContain(CHANGE_NAME_TEXT.heading);
    mounted.unmount();
    mounted = await mount(<InstanceView port={scriptedInstance({ connected: false }).port} />);
    await settle();
    expect(text()).not.toContain(CHANGE_NAME_TEXT.heading);
  });
});

describe('a rider who leaves the screen while it is being read — #2851', () => {
  const STEPS = ['current', 'devices', 'accountChanges', 'standing'] as const;

  /**
   * A connected screen whose read is stopped at `step`: that question is
   * asked, and its answer kept back until {@link finish}.
   */
  function readStoppedAt(step: (typeof STEPS)[number]) {
    const scripted = scriptedInstance({ connected: true });
    const moderation = scriptedModeration({ standing: 'moderator' });
    const operate = scriptedOperate({ standing: 'owner' });
    let answerNow: () => void = () => undefined;
    const kept = new Promise<void>((resolve) => {
      answerNow = resolve;
    });
    let stopped = 0;
    /** `ask`, asked when the screen asks it, and answered only once `kept` is. */
    function at<T>(here: (typeof STEPS)[number], ask: () => Promise<T>): () => Promise<T> {
      if (here !== step) return ask;
      return () => {
        stopped += 1;
        const answered = ask();
        return kept.then(() => answered);
      };
    }
    const port: InstancePort = {
      ...scripted.port,
      current: at('current', () => scripted.port.current()),
      devices: at('devices', () => scripted.port.devices()),
      accountChanges: at('accountChanges', () => scripted.port.accountChanges()),
    };
    const moderating: ModerationPort = {
      ...moderation.port,
      standing: at('standing', () => moderation.port.standing()),
    };
    return {
      view: <InstanceView port={port} moderation={moderating} operate={operate.port} />,
      /** How many times the read has reached `step`. */
      stopped: () => stopped,
      /** Every question any port has been asked so far, in each port's order. */
      asked: () => [...scripted.calls, '|', ...moderation.calls, '|', ...operate.calls],
      /**
       * Give the answer, and let everything it leads to run. One turn of the
       * event loop is all of it: every scripted answer is an already-settled
       * promise, so what follows is microtasks, and they are done before a task.
       */
      async finish(): Promise<void> {
        answerNow();
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        });
      },
    };
  }

  /**
   * How many times the global `window` is read while `during` runs.
   *
   * ⚠️ **That is how a state update is seen here, on a view that has gone.**
   * React says nothing about one — no warning, no render — but react-dom asks
   * `window.event` for the priority of every `setState`, drawn or not. It is
   * the read that failed the job with `window is not defined`, the whole suite
   * having passed, when jsdom was torn down under a read still in flight. So
   * "nothing was set" is "the window was not read", and the first case below
   * holds this to counting at all: were React to stop asking, that case would
   * go red rather than these pass for nothing.
   */
  async function windowReadsDuring(during: () => Promise<void>): Promise<number> {
    const real = Object.getOwnPropertyDescriptor(globalThis, 'window');
    if (real === undefined) throw new Error('this environment has no window to watch');
    const held = window;
    let reads = 0;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      get: () => {
        reads += 1;
        return held;
      },
    });
    try {
      await during();
    } finally {
      Object.defineProperty(globalThis, 'window', real);
    }
    return reads;
  }

  it('sets what an answer says while the screen is still drawn, which reads the window', async () => {
    const read = readStoppedAt('standing');
    mounted = await mount(read.view);
    await settle();
    expect(read.stopped()).toBe(1);
    expect(text()).not.toContain(MODERATE_LINK_TEXT);
    const reads = await windowReadsDuring(() => act(() => read.finish()));
    expect(text()).toContain(MODERATE_LINK_TEXT);
    expect(reads).toBeGreaterThan(0);
  });

  it.each(STEPS)(
    'sets nothing, and asks the instance nothing more, when the answer to %s arrives after the screen has gone',
    async (step) => {
      const read = readStoppedAt(step);
      mounted = await mount(read.view);
      await settle();
      // The read is waiting exactly here, and everything else has been drawn.
      expect(read.stopped()).toBe(1);
      const askedWhileDrawn = read.asked();

      mounted.unmount();
      mounted = undefined;
      const reads = await windowReadsDuring(() => read.finish());

      expect(reads).toBe(0);
      expect(read.asked()).toEqual(askedWhileDrawn);
    },
  );
});
