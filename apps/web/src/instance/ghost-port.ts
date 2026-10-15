// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Another rider's ghost, asked of this device's instance** (#331, ADR 0039):
 * what the trainer game may ask, and the one production implementation of it.
 *
 * A `*-port.ts` on purpose: `scripts/check-wiring.mjs` watches every method of
 * {@link GhostPort} (WIRE003) and every export of this file (WIRE002), and
 * `main.tsx` is the only production code that names {@link createGhostPort}.
 *
 * ## What leaves, and what comes back
 *
 * - **Out: one digest.** The SHA-256 of the route's canonical GPX
 *   (`detail/race-consent.ts` §`raceRouteDigest`), in the path of a SEALED
 *   `GET /v1/ghosts/{route}` — through `instance-transport.ts`, the one module
 *   this client sends instance traffic through (ADR 0036 D-3 (a)). Never the
 *   route, never a position. Only a rider who already holds the route can name
 *   it, and the instance lists no routes.
 * - **Back: ONE ghost, or none** (ADR 0021 D-4.1). A rider's display name and
 *   their speed on a uniform clock. There is no list to read: the answer has
 *   room for one, and anything else in it is refused as malformed.
 *
 * ## Nothing for a rider with no instance
 *
 * {@link GhostPort.offered} reads this device's storage and nothing else, as
 * the sync panel's availability does. With no instance, or one this copy of
 * the app cannot seal to, it is `false`: the game offers no choice and sends
 * nothing. A rider with no instance loses this and nothing else (ADR 0036
 * D-3, as ADR 0046 frames a feature that runs only through an instance).
 *
 * ## Untrusted on arrival
 *
 * The answer comes from a server and, before it, from another rider. The name
 * is held to the display-name rule (`@onyourleft/domain` §`checkDisplayName`)
 * and the speeds to finite, non-negative numbers within
 * {@link MAXIMUM_GHOST_SLOTS}; anything else is `malformed`, never a ghost.
 * The game then builds the track through the same integrator its own ghost
 * uses (`game/ghost-source.ts` §`ghostFromSpeed`), which refuses a ride holed
 * for longer than a few seconds.
 */

import { checkDisplayName, type RouteProfile, type Sha256 } from '@onyourleft/domain';
import { webCryptoSha256 } from '@onyourleft/store';

import { raceRouteDigest } from '../detail/race-consent';
import { heldInstanceSession, heldSealedSession, type SealingDependencies } from './instance-port';
import { sealedRouteGate } from './instance-pin';
import { readInstanceAccount } from './sign-in';

/** The most slots a ghost may arrive in: the instance's own limit (`race-ghost.ts`). */
export const MAXIMUM_GHOST_SLOTS = 7200;

/** Another rider's ghost, as it arrived: who, and how fast, slot by slot. */
export interface RiderGhostRecording {
  /** Their display name, as the instance shows it to this rider. */
  readonly rider: string;
  /** Seconds between slots. */
  readonly sampleIntervalSeconds: number;
  /** Metres per second per slot; `undefined` where the ride held no speed. */
  readonly speed: readonly (number | undefined)[];
}

/** What asking for a ghost came to. */
export type RiderGhostAnswer =
  | { readonly kind: 'ghost'; readonly ghost: RiderGhostRecording }
  /** Nobody who agreed to be raced has ridden this route, or none this rider may see. */
  | { readonly kind: 'none' }
  /** The instance could not be asked, or answered something that is not a ghost. */
  | { readonly kind: 'unavailable' };

/** What the trainer game may ask of the instance. */
export interface GhostPort {
  /** Whether to offer another rider's ghost at all — from this device's storage, sending nothing. */
  offered(): boolean;
  /** ONE other rider's ghost on this route, asked by the route's digest. */
  riderGhost(route: RouteProfile): Promise<RiderGhostAnswer>;
}

export interface GhostPortDependencies extends SealingDependencies {
  readonly sha256?: Sha256;
}

/**
 * The answer's body as a ghost, or `undefined` when it is not one — a name
 * that breaks the display-name rule, a clock that does not move, a speed that
 * is not a finite non-negative number, more slots than any ride is sent in,
 * or any member beyond the three a ghost has.
 */
export function parseRiderGhost(body: unknown): RiderGhostRecording | null | undefined {
  if (body === null || typeof body !== 'object') return undefined;
  const outer = body as Record<string, unknown>;
  if (Object.keys(outer).length !== 1 || !('ghost' in outer)) return undefined;
  const ghost = outer.ghost;
  if (ghost === null) return null;
  if (typeof ghost !== 'object') return undefined;
  const fields = ghost as Record<string, unknown>;
  if (Object.keys(fields).sort().join() !== 'rider,sampleInterval,speed') return undefined;
  const { rider, sampleInterval, speed } = fields;
  if (typeof rider !== 'string') return undefined;
  const name = checkDisplayName(rider);
  if (!name.ok) return undefined;
  if (typeof sampleInterval !== 'number' || !Number.isInteger(sampleInterval) || sampleInterval < 1)
    return undefined;
  if (!Array.isArray(speed) || speed.length < 2 || speed.length > MAXIMUM_GHOST_SLOTS)
    return undefined;
  const slots: (number | undefined)[] = [];
  for (const value of speed as unknown[]) {
    if (value === null) {
      slots.push(undefined);
    } else if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      slots.push(value);
    } else {
      return undefined;
    }
  }
  return { rider: name.name, sampleIntervalSeconds: sampleInterval, speed: slots };
}

/** The production {@link GhostPort}: `main.tsx` builds it, and nothing else in the client. */
export function createGhostPort(dependencies: GhostPortDependencies): GhostPort {
  const session = heldSealedSession(dependencies);
  const sha256 = dependencies.sha256 ?? webCryptoSha256;
  return {
    offered: () => {
      const account = readInstanceAccount(dependencies.storage);
      if (account === undefined || heldInstanceSession(dependencies.storage) === undefined) {
        return false;
      }
      return sealedRouteGate(account, dependencies.loadedFrom).kind === 'open';
    },
    riderGhost: async (route) => {
      try {
        const held = await session();
        if (held.kind === 'closed') return { kind: 'unavailable' };
        const digest = await raceRouteDigest(route, sha256);
        const answer = await held.sealed.call('GET', `/v1/ghosts/${digest}`, {
          token: held.token,
        });
        if (answer.status !== 200) return { kind: 'unavailable' };
        const ghost = parseRiderGhost(answer.body);
        if (ghost === undefined) return { kind: 'unavailable' };
        return ghost === null ? { kind: 'none' } : { kind: 'ghost', ghost };
      } catch {
        // No answer: the ride does not start, and says so.
        return { kind: 'unavailable' };
      }
    },
  };
}
