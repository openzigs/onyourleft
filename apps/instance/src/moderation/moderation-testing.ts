// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the moderation tests share: an instance with a named owner and deputy,
 * or with the owner alone (#905: the project's instance has one moderator),
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

/** An instance whose operator named the owner alone, as the project's does (#905). */
export interface SoleModeratorWorld extends IdentityInstance {
  readonly owner: Rider;
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

/** An instance whose operator named an owner and a deputy. */
export interface ModerationWorld extends SoleModeratorWorld {
  readonly deputy: Rider;
}

type StartOptions = Parameters<typeof startIdentityInstance>[0];

export async function startModerationWorld(options: StartOptions = {}): Promise<ModerationWorld> {
  const deputyDevice = await testDevice();
  const { world, join } = await startWorld(options, deputyDevice.publicKey);
  return { ...world, deputy: await join(deputyDevice, 'Deputy') };
}

export async function startSoleModeratorWorld(
  options: StartOptions = {},
): Promise<SoleModeratorWorld> {
  return (await startWorld(options, undefined)).world;
}

async function startWorld(
  options: StartOptions,
  deputyKey: string | undefined,
): Promise<{
  readonly world: SoleModeratorWorld;
  readonly join: (device: TestDevice, displayName?: string) => Promise<Rider>;
}> {
  const ownerDevice = await testDevice();
  const world = await startIdentityInstance({
    ...options,
    moderators:
      deputyKey === undefined
        ? { owner: ownerDevice.publicKey }
        : { owner: ownerDevice.publicKey, deputy: deputyKey },
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
  return {
    join,
    world: {
      ...world,
      owner,
      rider: async (displayName) => join(await testDevice(), displayName),
      as: (rider, method, path, body) =>
        world.call(method, path, { token: rider.token, ...(body === undefined ? {} : { body }) }),
    },
  };
}

export const codeOf = (body: unknown): unknown =>
  (body as { error?: { code?: unknown } } | null)?.error?.code;
