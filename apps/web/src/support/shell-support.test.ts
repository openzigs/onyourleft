// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #284's first two criteria, at the seam rather than at the screen.
 *
 * The screen's half is `DevicesView.shell.test.tsx`; this file asserts that the
 * answer comes from the **plugin** and that each of the plugin's four outcomes
 * arrives as wording a rider can act on.
 */

import type { TransportAvailability } from '@onyourleft/sensors';
import { createCapacitorTransport, mayShowDeviceList, permissionNotice } from '@onyourleft/mobile';
import { scriptedPort, type ScriptedStack } from '@onyourleft/mobile/testing';
import { unixSeconds } from '@onyourleft/domain';
import { describe, expect, it, vi } from 'vitest';

import { capacitorShellSupport } from './shell-support';

const ALL: readonly TransportAvailability[] = [
  { kind: 'available' },
  { kind: 'not-permitted' },
  { kind: 'adapter-unavailable' },
  { kind: 'unsupported' },
];

/**
 * The port as `main.tsx` builds it — the **real** `permissionNotice` and
 * `mayShowDeviceList`, with only the plugin call scripted.
 *
 * Substituting the wording here would make this file agree with itself and say
 * nothing about the two functions #284 exists to give a caller.
 */
function portFor(...answers: readonly TransportAvailability[]): {
  readonly port: ReturnType<typeof capacitorShellSupport>;
  readonly availability: ReturnType<typeof vi.fn<() => Promise<TransportAvailability>>>;
} {
  const availability = vi.fn<() => Promise<TransportAvailability>>();
  for (const answer of answers) {
    availability.mockResolvedValueOnce(answer);
  }
  availability.mockResolvedValue(answers[answers.length - 1] ?? { kind: 'available' });
  return {
    port: capacitorShellSupport({ availability, notice: permissionNotice, mayShowDeviceList }),
    availability,
  };
}

describe('the answer comes from the plugin, not from the WebView', () => {
  it('asks the transport every time it is read', async () => {
    const { port, availability } = portFor({ kind: 'available' });
    await port.readShellSupport();
    await port.readShellSupport();
    expect(availability).toHaveBeenCalledTimes(2);
  });

  it('reports the plugin’s kind unchanged', async () => {
    for (const answer of ALL) {
      const { port } = portFor(answer);
      expect((await port.readShellSupport()).kind).toBe(answer.kind);
    }
  });

  it('lets a device list be shown only when the plugin says available', async () => {
    for (const answer of ALL) {
      const { port } = portFor(answer);
      expect((await port.readShellSupport()).canPair).toBe(answer.kind === 'available');
    }
  });
});

describe('every unusable state is told apart, and says what to do', () => {
  it('has nothing to say when the plugin is available', async () => {
    const { port } = portFor({ kind: 'available' });
    expect((await port.readShellSupport()).notice).toBeNull();
  });

  it('gives each unusable state a notice with a DISTINCT title', async () => {
    const titles: string[] = [];
    for (const answer of ALL.filter((one) => one.kind !== 'available')) {
      const { port } = portFor(answer);
      const notice = (await port.readShellSupport()).notice;
      expect(notice?.title).toBeTruthy();
      expect(notice?.explanation).toBeTruthy();
      titles.push(notice?.title ?? '');
    }
    // Criterion 2 in one assertion: a rider whose adapter is off and a rider
    // who refused the permission must not read the same screen.
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('sends a rider with the radio off to Bluetooth, and a refused one to the app’s settings', async () => {
    const off = portFor({ kind: 'adapter-unavailable' });
    const refused = portFor({ kind: 'not-permitted' });
    const offNotice = (await off.port.readShellSupport()).notice;
    const refusedNotice = (await refused.port.readShellSupport()).notice;

    expect(offNotice?.instruction).toMatch(/bluetooth/i);
    expect(refusedNotice?.instruction).toMatch(/settings/i);
    // And not each other's, which is the failure a single generic instruction
    // would produce while every assertion above still passed.
    expect(refusedNotice?.instruction).not.toBe(offNotice?.instruction);
  });

  it('offers no instruction and no retry on a stack with no Bluetooth at all', async () => {
    const { port } = portFor({ kind: 'unsupported' });
    const notice = (await port.readShellSupport()).notice;
    expect(notice?.instruction).toBeNull();
    // `permissionNotice` gives this state no action on purpose, and a rider
    // offered a "check again" for a phone that has no BLE radio would press it
    // for ever.
    expect(notice?.recoverable).toBe(false);
  });

  it('marks the states that a rider can actually fix as recoverable', async () => {
    for (const kind of ['not-permitted', 'adapter-unavailable'] as const) {
      const { port } = portFor({ kind });
      expect((await port.readShellSupport()).notice?.recoverable).toBe(true);
    }
  });
});

describe('the instruction maps every action the notice can carry', () => {
  it('says nothing extra when the only action is to ask again', async () => {
    // `permissionNotice` cannot currently produce `retry` — no branch returns
    // it — but `PermissionAction` declares it, so the mapping has to be total
    // or a future notice would render `undefined` at a rider. The same reason
    // `bluetooth-support.ts` §`supportFor` keeps its unreachable branch, and
    // the same remedy: reach it with a stub rather than leave it unchecked.
    const port = capacitorShellSupport({
      availability: async () => Promise.resolve({ kind: 'adapter-unavailable' }),
      notice: () => ({
        title: 'Ask again',
        explanation: 'The stack was busy.',
        action: { label: 'Try again', kind: 'retry' },
      }),
      mayShowDeviceList,
    });
    const notice = (await port.readShellSupport()).notice;
    // Nothing to do outside the app, so no prose — but the state is still one
    // a re-check could fix, so the button stays.
    expect(notice?.instruction).toBeNull();
    expect(notice?.recoverable).toBe(true);
  });
});

/**
 * The whole chain, against the **real** transport and the scripted plugin.
 *
 * Every test above stubs `availability()`, which is right for asserting a
 * mapping and blind to the thing that actually breaks a screen like this: the
 * read that cannot see the fix. A rider is told to grant a permission, goes to
 * Android's Settings, grants it, comes back and presses Check again — and if
 * anything between here and the plugin holds on to the first answer, the button
 * is decoration and the rider is stuck on the page that sent them away.
 *
 * `createCapacitorTransport` is the production transport, `scriptedPort` is
 * `apps/mobile`'s own double, and only the rider's decision is scripted.
 */
describe('a permission granted outside the app is visible to the next read', () => {
  function shellOverRealTransport(stack: ScriptedStack): ReturnType<typeof capacitorShellSupport> {
    const transport = createCapacitorTransport({
      plugin: scriptedPort(stack),
      // No profile is needed to answer "can this stack be used at all", and
      // passing none keeps this about availability rather than about GATT.
      profiles: [],
      now: () => unixSeconds(0),
    });
    return capacitorShellSupport({
      availability: async () => transport.availability(),
      notice: permissionNotice,
      mayShowDeviceList,
    });
  }

  it('reports the grant on the re-read, rather than replaying the denial', async () => {
    let denied = true;
    // A getter, so the rider's decision can change between reads exactly as it
    // does on a phone. `scriptedPort` reads the stack per call.
    const stack: ScriptedStack = {
      get initializeRejectsWith(): unknown {
        return denied ? new Error('permission denied by the rider') : undefined;
      },
    };
    const port = shellOverRealTransport(stack);

    const refused = await port.readShellSupport();
    expect(refused.kind).toBe('not-permitted');
    expect(refused.canPair).toBe(false);
    expect(refused.notice?.title).toBe('On Your Left needs Bluetooth permission');

    denied = false;

    const granted = await port.readShellSupport();
    // ⚠️ This is the assertion the whole file exists for. `ensureInitialized`
    // memoises a SUCCESSFUL initialisation and deliberately does not memoise a
    // failed one — `transport.ts` says why, and this is the consumer that makes
    // the difference visible. Caching the rejection turns "Check again" into a
    // control that cannot work, which is the shape #48's first criterion bars.
    expect(granted.kind).toBe('available');
    expect(granted.canPair).toBe(true);
    expect(granted.notice).toBeNull();
  });

  it('reports a switched-off radio through the same chain, and tells it apart from a denial', async () => {
    // `isEnabled()` is the method #284 deletes the `@unwired` note from: it has
    // a production caller for the first time, and this is the path.
    const port = shellOverRealTransport({ enabled: false });
    const off = await port.readShellSupport();
    expect(off.kind).toBe('adapter-unavailable');
    expect(off.notice?.title).toBe('Bluetooth is switched off');
  });
});
