// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Connect screen (#777, #778, #773's device list), over the scripted port
 * in `instance/testing.ts`. `instance/instance-port.test.ts` is where the port
 * itself meets a real instance; this is what the screen does with its answers.
 * The route is audited, over both walk fixtures, by `a11y/routes.a11y.test.tsx`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  AFTER_REVOKE_TEXT,
  formatDay,
  noticeText,
  REVOKE_MARK_TEXT,
  revokeKeyName,
} from '../instance/account-change-notices';
import { ACCOUNT_CHANGES_UNAVAILABLE_TEXT, type InstancePort } from '../instance/instance-port';
import { INSTANCE_KEY_TEXT } from '../instance/instance-pin';
import {
  SCRIPTED_ACCOUNT_CHANGES,
  SCRIPTED_FINGERPRINT,
  scriptedInstance,
  scriptedModeration,
} from '../instance/testing';
import {
  activateWithKeyboard,
  mount,
  settle,
  submitForm,
  typeInto,
  typeIntoTextArea,
  type Mounted,
} from '../testing/mount';
import {
  DISCONNECT_KEEPS_RIDES,
  INSTANCE_KEPT_VISIBLE,
  INSTANCE_NO_PORT,
  INSTANCE_RECEIVES,
  InstanceView,
  MODERATE_LINK_TEXT,
  RECOVERY_CODES_LEAD,
  TERMS_CHANGED_TEXT,
} from './InstanceView';
import { ACCOUNT_NOTICES_TEXT } from './InstanceDevices';

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

async function connectAs(address: string, name: string): Promise<void> {
  const inputs = [...(mounted?.container.querySelectorAll('input') ?? [])];
  await typeInto(inputs[0] as HTMLInputElement, address);
  await typeInto(inputs[1] as HTMLInputElement, name);
  const form = mounted?.container.querySelector('form');
  if (form === null || form === undefined) throw new Error('no form');
  await submitForm(form);
  await settle();
}

describe('the Connect screen — #777, #778', () => {
  it('says it cannot connect where there is no port, and offers no Connect', async () => {
    mounted = await mount(<InstanceView />);
    expect(text()).toContain(INSTANCE_NO_PORT);
    expect(mounted.container.querySelector('button')).toBeNull();
  });

  it('lists what the instance will receive BEFORE sign-in, on the screen, above Connect', async () => {
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    for (const sentence of INSTANCE_KEPT_VISIBLE) expect(text()).toContain(sentence);
    // Kept visible: no closed disclosure anywhere above it.
    expect(mounted.container.querySelector('details')).toBeNull();
    const list = mounted.container.querySelector('[data-oyl-kept-visible] ul');
    const connect = button('Connect');
    expect(list).not.toBeNull();
    expect(
      (list as Element).compareDocumentPosition(connect) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Nothing was asked of the instance but what this device holds.
    expect(scripted.calls).toEqual(['current']);
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
    // No screen removes what the instance holds: the sentence says whom to ask.
    expect(DISCONNECT_KEEPS_RIDES).toContain('ask whoever runs the instance');
    expect(DISCONNECT_KEEPS_RIDES).not.toContain('erased on the instance');
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
    expect(sync).toContain('which needs the instance’s card');
    expect(sync).toContain('with their positions and heart rate');
    expect(sync).toContain('sealed on this device for the instance alone');
    expect(sync).toContain('Nothing is synced until you press Sync now');
    expect(sync).not.toContain('does not offer Sync yet');
    expect(INSTANCE_KEPT_VISIBLE).toContain(room);
    expect(INSTANCE_KEPT_VISIBLE).toContain(sync);
    const scripted = scriptedInstance();
    mounted = await mount(<InstanceView port={scripted.port} />);
    await settle();
    const list = mounted.container.querySelector('[data-oyl-kept-visible] ul');
    expect(list?.textContent).toContain(room ?? 'no room line');
    expect(list?.textContent).toContain(sync ?? 'no sync line');
    expect(
      (list as Element).compareDocumentPosition(button('Connect')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
    expect(text()).toContain('Lanes of the Weald');
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
    expect(mounted.container.querySelector('[role="status"]')?.textContent).toContain(
      'That address starts with http://.',
    );
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
