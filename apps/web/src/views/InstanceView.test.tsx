// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Connect screen (#777, #778, #773's device list), over the scripted port
 * in `instance/testing.ts`. `instance/instance-port.test.ts` is where the port
 * itself meets a real instance; this is what the screen does with its answers.
 * The route is audited, over both walk fixtures, by `a11y/routes.a11y.test.tsx`.
 */

import { afterEach, describe, expect, it } from 'vitest';

import type { InstancePort } from '../instance/instance-port';
import { scriptedInstance } from '../instance/testing';
import {
  activateWithKeyboard,
  mount,
  settle,
  submitForm,
  typeInto,
  type Mounted,
} from '../testing/mount';
import {
  DISCONNECT_KEEPS_RIDES,
  INSTANCE_KEPT_VISIBLE,
  INSTANCE_NO_PORT,
  InstanceView,
  RECOVERY_CODES_LEAD,
} from './InstanceView';

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
