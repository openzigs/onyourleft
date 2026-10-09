// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What `POST /v1/sealed` needs beyond the accounts and the keys (#1191,
 * ADR 0047 D-9): the HPKE port it opens with, the box's clock, and the
 * durable replay record — over the store, so a restart inside a request's
 * freshness window still refuses it.
 *
 * The order the endpoint checks things in is `routes.ts`'s; this module is
 * the small set of things that order is checked against.
 */

import { SEALED_REPLAY_SECONDS, toHex, type HpkePrimitives, type Sha256 } from '@onyourleft/domain';

import { instanceHpkePrimitives } from '../auth/crypto.ts';
import type { Caller } from '../auth/identity.ts';
import type { SqlStore } from '../store/sql-store.ts';

/** The `CryptoKey` type, spelt so that this DOM-less program can name it. */
type InstanceCryptoKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>;

export interface Sealed {
  /** The HPKE port: the instance's own, unless a test counts its X25519 calls. */
  readonly primitives: HpkePrimitives<InstanceCryptoKey>;
  readonly sha256: Sha256;
  /** The box's clock, Unix seconds. */
  nowSeconds(): number;
  /** Record `enc`: `replayed` when this instance saw it in the last ten minutes. */
  record(enc: Uint8Array): Promise<'recorded' | 'replayed'>;
  /** A sealed request the caller's key signed: its `last_used_at` moves (D-8). */
  touch(caller: Caller): Promise<void>;
}

export interface SealedOptions {
  readonly store: Pick<SqlStore, 'recordSealedRequest' | 'touchDeviceKey'>;
  /** Unix milliseconds. */
  readonly now: () => number;
  readonly primitives?: HpkePrimitives<InstanceCryptoKey>;
}

/** SHA-256 over the platform's WebCrypto: what the domain's sealing reads `bodySha256` with. */
export const sha256: Sha256 = async (bytes) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));

export function createSealed(options: SealedOptions): Sealed {
  const nowSeconds = (): number => Math.floor(options.now() / 1000);
  return {
    primitives: options.primitives ?? instanceHpkePrimitives,
    sha256,
    nowSeconds,
    async record(enc) {
      const at = nowSeconds();
      return options.store.recordSealedRequest(
        toHex(await sha256(enc)),
        at,
        at - SEALED_REPLAY_SECONDS,
      );
    },
    async touch(caller) {
      await options.store.touchDeviceKey(caller.athleteId, caller.deviceKey, nowSeconds());
    },
  };
}
