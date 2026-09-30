// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A stand-in {@link InstancePort} for the views, the accessibility walk and
 * the browser harnesses (#777). Test support, never shipped.
 *
 * It keeps what an instance would: the connection, the athlete's display name
 * and their devices, and answers every method from that — so a screen that
 * showed the name it was typed rather than the name read back would show the
 * wrong one here too. It sends nothing anywhere.
 */

import type {
  ConnectOutcome,
  DevicesOutcome,
  InstanceDevice,
  InstancePort,
  InstanceState,
} from './instance-port';

export interface ScriptedInstance {
  readonly port: InstancePort;
  /** Every method called, in order. */
  readonly calls: string[];
  /** What the instance holds — change it to change what the next read answers. */
  held: {
    connected: boolean;
    origin: string;
    instanceName: string | null;
    displayName: string;
    sourceUrl: string | null;
    devices: readonly InstanceDevice[];
  };
}

/** Two devices, one of them this one — the shape `GET /v1/auth/devices` answers. */
export const SCRIPTED_DEVICES: readonly InstanceDevice[] = [
  {
    publicKey: 'a1'.repeat(32),
    addedAt: 1_790_000_000,
    lastUsedAt: 1_790_500_000,
    revokedAt: null,
    thisDevice: true,
  },
  {
    publicKey: 'b2'.repeat(32),
    addedAt: 1_790_100_000,
    lastUsedAt: null,
    revokedAt: null,
    thisDevice: false,
  },
];

export interface ScriptedInstanceOptions {
  readonly connected?: boolean;
  /** What `connect` answers, when not a plain success. */
  readonly connectAnswer?: ConnectOutcome;
  /** What `current` answers when connected, when not a plain `connected`. */
  readonly state?: InstanceState;
}

export function scriptedInstance(options: ScriptedInstanceOptions = {}): ScriptedInstance {
  const calls: string[] = [];
  const scripted: ScriptedInstance = {
    calls,
    held: {
      connected: options.connected ?? false,
      origin: 'https://ride.example',
      instanceName: 'Lanes of the Weald',
      displayName: 'Rider',
      sourceUrl:
        'https://github.com/openzigs/onyourleft/tree/0123456789abcdef0123456789abcdef01234567',
      devices: SCRIPTED_DEVICES,
    },
    port: {
      current: () => {
        calls.push('current');
        const { held } = scripted;
        if (!held.connected) return Promise.resolve({ kind: 'not-connected' });
        return Promise.resolve(
          options.state ?? {
            kind: 'connected',
            origin: held.origin,
            instanceName: held.instanceName,
            displayName: held.displayName,
            sourceUrl: held.sourceUrl,
          },
        );
      },
      connect: (address, displayName) => {
        calls.push(`connect ${address}`);
        const answer = options.connectAnswer ?? { kind: 'connected' };
        if (answer.kind === 'connected') {
          scripted.held.connected = true;
          if (displayName.trim() !== '') scripted.held.displayName = displayName.trim();
        }
        return Promise.resolve(answer);
      },
      devices: () => {
        calls.push('devices');
        const answer: DevicesOutcome = scripted.held.connected
          ? { kind: 'listed', devices: scripted.held.devices }
          : { kind: 'unavailable', text: 'not connected' };
        return Promise.resolve(answer);
      },
      disconnect: () => {
        calls.push('disconnect');
        scripted.held.connected = false;
        return Promise.resolve();
      },
    },
  };
  return scripted;
}
