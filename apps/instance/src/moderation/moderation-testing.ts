// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the moderation tests share: an instance with a named owner and deputy,
 * and riders signed in on it through the real listener.
 *
 * Test support, never shipped: nothing under `src/` but a test imports it.
 */

import {
  startIdentityInstance,
  testDevice,
  type IdentityInstance,
  type TestDevice,
} from '../auth/identity-testing.ts';

/** A rider signed in on the test instance. */
export interface Rider {
  readonly device: TestDevice;
  readonly athleteId: string;
  readonly token: string;
}

export interface ModerationWorld extends IdentityInstance {
  readonly owner: Rider;
  readonly deputy: Rider;
  /** A new rider, signed in. */
  rider(displayName?: string): Promise<Rider>;
  /** Call as a rider. */
  as(
    rider: Rider,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }>;
}

export async function startModerationWorld(
  options: Parameters<typeof startIdentityInstance>[0] = {},
): Promise<ModerationWorld> {
  const ownerDevice = await testDevice();
  const deputyDevice = await testDevice();
  const world = await startIdentityInstance({
    ...options,
    moderators: { owner: ownerDevice.publicKey, deputy: deputyDevice.publicKey },
  });
  const join = async (device: TestDevice, displayName?: string): Promise<Rider> => {
    // Every rider has a minute's challenge allowance to themselves.
    world.clock.ms += 60_000;
    const session = await world.signIn(device, displayName === undefined ? {} : { displayName });
    if (session.status !== 200) throw new Error(`sign-in: ${JSON.stringify(session.body)}`);
    return {
      device,
      athleteId: session.body.athleteId as string,
      token: session.body.sessionToken as string,
    };
  };
  const owner = await join(ownerDevice, 'Owner');
  const deputy = await join(deputyDevice, 'Deputy');
  return {
    ...world,
    owner,
    deputy,
    rider: async (displayName) => join(await testDevice(), displayName),
    as: (rider, method, path, body) =>
      world.call(method, path, { token: rider.token, ...(body === undefined ? {} : { body }) }),
  };
}

export const codeOf = (body: unknown): unknown =>
  (body as { error?: { code?: unknown } } | null)?.error?.code;
