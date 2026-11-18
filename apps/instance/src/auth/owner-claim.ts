// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The owner's claim** (#2782, ADR 0080 D-3, D-5): the owner key set from the
 * app, instead of pasted into `OYL_INSTANCE_OWNER_KEY`.
 *
 * 1. **Mint** — the loopback setup page (#2784) mints a claim code and shows
 *    it once, as a QR with the instance card (#2783). It is ADR 0069 D-1's
 *    code: `readableCode(16)`, 79 bits, ten minutes, single use, stored only
 *    as the SHA-256 of its normalised form, and minting voids every other
 *    one — a pending claim's included.
 * 2. **Redeem** — the tablet pins the card's fingerprint, then sends the code
 *    on `POST /v1/auth/owner-claim`: a SEALED, sessionless route
 *    (`sealed/routes.ts` §`SESSIONLESS_PATHS`) whose sealed request is signed
 *    by the key its body names, so the edge can neither read the code nor
 *    substitute the key. The claim becomes **pending**, holding that key and
 *    the six-digit comparison code derived from the code and the key
 *    (`@onyourleft/domain` §`ownerClaimComparisonCode`), which the tablet
 *    derives too and shows.
 * 3. **Confirm or discard** — on the loopback page, where the owner compares
 *    the two six digits. Confirming records the key as the owner key in the
 *    database (`instance_owner`); every owner check reads it from there
 *    (`moderation/moderation.ts` §`ownerKey`), so it applies without a
 *    restart. Discarding voids the code.
 *
 * **One refusal** (D-3): an unknown, used or expired code, a redemption while
 * another claim is pending, a claim on an instance already claimed — by the
 * database or by `OYL_INSTANCE_OWNER_KEY`, which wins and refuses every claim
 * (D-3, Q-2) — and the deputy's key all answer `claim_refused`, byte for
 * byte the same. Redemptions are rate-limited as ADR 0069 D-4 limits admin
 * sign-ins: per client address and for everybody together.
 *
 * `operator owner-claim reset` (`operator/commands.ts`) is the way back.
 */

import { ownerClaimComparisonCode } from '@onyourleft/domain';

import { adminCodeSha256, newAdminCode } from '../admin/code.ts';
import type { ErrorCode, FieldProblem } from '../errors.ts';
import type { Moderators } from '../moderation/moderation.ts';
import { sha256 } from '../sealed/sealed.ts';
import type { AdminSource, PendingOwnerClaim, SqlStore } from '../store/sql-store.ts';
import { isPublicKey } from './crypto.ts';
import { addressKey, createRateLimiter, type RateLimit } from './rate-limit.ts';

/** How long a claim code, and so a pending claim, lives: ADR 0069 D-1's ten minutes. */
export const OWNER_CLAIM_LIFETIME_SECONDS = 10 * 60;

export interface OwnerClaimLimits {
  /** Redemptions per client address. */
  readonly perAddress: RateLimit;
  /** Redemptions from everybody together. */
  readonly overall: RateLimit;
}

/** ADR 0069 D-4's sign-in limits, which D-3 applies to a redemption. */
export const DEFAULT_OWNER_CLAIM_LIMITS: OwnerClaimLimits = {
  perAddress: { limit: 10, windowMs: 60_000 },
  overall: { limit: 30, windowMs: 60_000 },
};

export interface OwnerClaimOptions {
  readonly store: SqlStore;
  /** Unix milliseconds. */
  readonly now: () => number;
  /** The keys the operator named: an owner key set refuses every claim. */
  readonly moderators?: Moderators;
  readonly limits?: OwnerClaimLimits;
}

type ClaimOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: ErrorCode; readonly fields?: readonly FieldProblem[] };

export interface OwnerClaim {
  /**
   * A new claim code, for the loopback page to show once, and when it ends
   * (Unix seconds) — or `claimed`, and nothing minted, when the instance has
   * an owner key. Logged as `owner_claim_code_minted` from `source`.
   */
  mint(
    source: AdminSource,
  ): Promise<{ readonly code: string; readonly expiresAt: number } | 'claimed'>;
  /** `POST /v1/auth/owner-claim`'s body, from a sealed request signed by its `publicKey`. */
  redeem(
    body: Readonly<Record<string, unknown>>,
    address: string | null,
  ): Promise<ClaimOutcome<{ readonly claim: 'pending' }>>;
  /** The claim waiting for the owner on the loopback page, or `undefined`. */
  pending(): Promise<PendingOwnerClaim | undefined>;
  /**
   * The owner said the tablet shows `comparisonCode`: the pending claim with
   * it becomes the owner key. `none` when there is no such claim. Logged as
   * `owner_claim_confirmed` from `source` when it is done.
   */
  confirm(comparisonCode: string, source: AdminSource): Promise<'confirmed' | 'none'>;
  /** The owner said it does not match: the pending claim and its code are void. */
  discard(source: AdminSource): Promise<boolean>;
}

const refused: ClaimOutcome<never> = { ok: false, code: 'claim_refused' };

export function createOwnerClaim(options: OwnerClaimOptions): OwnerClaim {
  const { store, now } = options;
  const named = options.moderators ?? {};
  const limits = options.limits ?? DEFAULT_OWNER_CLAIM_LIMITS;
  const perAddress = createRateLimiter(limits.perAddress, now);
  const overall = createRateLimiter(limits.overall, now);
  const seconds = (): number => Math.floor(now() / 1000);
  /** No actor: before the claim there is no owner's athlete to name (migration 0044's rule). */
  const actor = (source: AdminSource) => ({ source, athleteId: null });

  return {
    async mint(source) {
      if (named.owner !== undefined) return 'claimed';
      const { code, sha256: codeSha256 } = await newAdminCode();
      const mintedAt = seconds();
      const expiresAt = mintedAt + OWNER_CLAIM_LIFETIME_SECONDS;
      const { value } = await store.recordOperatorAction(
        { actor: actor(source), action: 'owner_claim_code_minted', at: mintedAt },
        async (inside) => {
          const minted = await inside.mintOwnerClaimCode({ codeSha256, mintedAt, expiresAt });
          return minted.outcome === 'claimed'
            ? { outcome: 'refused', value: 'claimed' as const }
            : {
                outcome: 'done',
                detail: minted.voided > 0 ? 'voided_unused' : null,
                value: 'minted' as const,
              };
        },
      );
      return value === 'claimed' ? 'claimed' : { code, expiresAt };
    },

    async redeem(body, address) {
      const { publicKey, claimCode } = body;
      if (!isPublicKey(publicKey)) {
        return {
          ok: false,
          code: 'validation_failed',
          fields: [{ field: 'publicKey', problem: 'must be 64 lowercase hex characters' }],
        };
      }
      if (typeof claimCode !== 'string') {
        return {
          ok: false,
          code: 'validation_failed',
          fields: [{ field: 'claimCode', problem: 'must be a string' }],
        };
      }
      // Counted before anything is looked up, so a refused guess costs one.
      if (!perAddress.allow(address === null ? 'unknown' : addressKey(address))) {
        return { ok: false, code: 'rate_limited' };
      }
      if (!overall.allow('all')) return { ok: false, code: 'rate_limited' };
      // The environment wins: no claim while OYL_INSTANCE_OWNER_KEY is set
      // (Q-2), and the deputy is kept out of the owner's place (D-3).
      if (named.owner !== undefined || publicKey === named.deputy) return refused;
      const codeSha256 = await adminCodeSha256(claimCode);
      if (codeSha256 === undefined) return refused;
      const taken = await store.redeemOwnerClaimCode({
        codeSha256,
        deviceKey: publicKey,
        comparisonCode: await ownerClaimComparisonCode(sha256, claimCode, publicKey),
        at: seconds(),
      });
      return taken === 'pending' ? { ok: true, value: { claim: 'pending' } } : refused;
    },

    pending: () => store.pendingOwnerClaim(seconds()),

    async confirm(comparisonCode, source) {
      const at = seconds();
      const { value } = await store.recordOperatorAction(
        { actor: actor(source), action: 'owner_claim_confirmed', at },
        async (inside) => {
          const confirmed =
            named.owner === undefined ? await inside.confirmOwnerClaim(comparisonCode, at) : 'none';
          return { outcome: confirmed === 'confirmed' ? 'done' : 'refused', value: confirmed };
        },
      );
      return value;
    },

    async discard(source) {
      const at = seconds();
      const { value } = await store.recordOperatorAction(
        { actor: actor(source), action: 'owner_claim_discarded', at },
        async (inside) => {
          const discarded = await inside.discardOwnerClaim(at);
          return { outcome: discarded ? 'done' : 'refused', value: discarded };
        },
      );
      return value;
    },
  };
}
