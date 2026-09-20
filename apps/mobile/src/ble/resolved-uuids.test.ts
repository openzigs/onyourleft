// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The Android half of #370's second criterion: *"the transport reports the
 * UUIDs the link resolved, on **both** platforms"*.
 *
 * ⚠️ **Everything below runs against the scripted port, not a phone.** That is
 * the standing limitation of every test in this directory
 * (`apps/mobile/README.md` §4), and it is worth restating here because what is
 * being asserted is a translation: plugin shapes in, this program's vocabulary
 * out. The translation is checkable without hardware; that the plugin's
 * `getServices` returns what Android discovered is not, and is not claimed.
 */

import { describe, expect, it } from 'vitest';

import { readCapacitorResolvedUuids } from './resolved-uuids';
import { scriptedPort, SCRIPTED_DEVICE, type ScriptedPort, type ScriptedStack } from './testing';

const DEVICE = SCRIPTED_DEVICE.deviceId;

const POWER_SERVICE = '00001818-0000-1000-8000-00805f9b34fb';
const POWER_MEASUREMENT = '00002a63-0000-1000-8000-00805f9b34fb';
const VENDOR_CONTROL_POINT = 'a026e005-0a7d-4ab3-97fa-f1500f9feb8b';

/** A scripted port with `initialize()` already done, as every other call needs. */
async function started(stack: ScriptedStack): Promise<ScriptedPort> {
  const port = scriptedPort(stack);
  await port.initialize();
  return port;
}

describe('readCapacitorResolvedUuids', () => {
  it('flattens services and their characteristics into one list', async () => {
    const port = await started({
      services: [
        {
          uuid: POWER_SERVICE,
          characteristics: [{ uuid: POWER_MEASUREMENT }, { uuid: VENDOR_CONTROL_POINT }],
        },
      ],
    });

    const resolved = await readCapacitorResolvedUuids(port, DEVICE);

    expect([...resolved].sort()).toEqual(
      [POWER_SERVICE, POWER_MEASUREMENT, VENDOR_CONTROL_POINT].sort(),
    );
  });

  it('asks the plugin about the device it was given', async () => {
    const port = await started({ services: [] });

    await readCapacitorResolvedUuids(port, DEVICE);

    expect(port.calls).toContain(`getServices:${DEVICE}`);
  });

  /**
   * ⚠️ A rejection is the empty list, and that is the whole safety property of
   * this function. It exists to make a message more specific; a plugin that
   * cannot answer must leave a rider with the trainer they had rather than
   * with a pairing failure. `ride/trainer.ts` §`controlChoice` is the other
   * half of the same rule.
   */
  it('answers nothing when the plugin refuses', async () => {
    const port = await started({ servicesRejectWith: new Error('not connected') });

    await expect(readCapacitorResolvedUuids(port, DEVICE)).resolves.toEqual([]);
  });

  it('answers nothing before the stack is initialised', async () => {
    const port = scriptedPort({ services: [{ uuid: POWER_SERVICE, characteristics: [] }] });

    await expect(readCapacitorResolvedUuids(port, DEVICE)).resolves.toEqual([]);
  });
});
