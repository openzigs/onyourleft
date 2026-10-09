// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Syncing this device with its instance, from the app** (#1195): what the
 * Instance screen's sync panel may ask, and the one production implementation
 * of it.
 *
 * `sync.ts` holds every rule of a sync (#776, #881) and names no `fetch`.
 * This module is what calls it: over the SEALED session `instance-port.ts`
 * keeps (`heldSealedSession`, #1192), through `instance-transport.ts` — the
 * one module this client sends instance traffic through (ADR 0036 D-3 (a)).
 * Every sync route is sealed-only (ADR 0047 D-7, the owner's D-14 Q7 ruling,
 * "ships sealed only"), and there is no plaintext fallback anywhere here:
 * a device that cannot seal does not sync.
 *
 * A `*-port.ts` on purpose: `scripts/check-wiring.mjs` watches every method of
 * {@link SyncPort} (WIRE003) and every export of this file (WIRE002), and
 * `main.tsx` is the only production code that names {@link createSyncPort}.
 *
 * ## Nothing for a rider with no instance
 *
 * {@link SyncPort.availability} reads this device's storage and nothing else.
 * With no instance account it answers `none`, and the screen draws no control,
 * says nothing and sends nothing (#1195's fourth criterion). Sync runs only
 * when the rider presses it: there is no background sync.
 *
 * ## Nothing without the card
 *
 * A device signed in with only an address holds no pin (#1190), so it cannot
 * seal (D-14 Q1). It is `closed`, with #1190's own "this needs the instance's
 * card" sentence, and {@link SyncPort.sync} refuses with that sentence having
 * sent nothing — not even the keys' read.
 *
 * ## A key is admitted by the rider, never by the instance
 *
 * {@link SyncPort.admitKey} is `sync.ts` §`admitDeviceKey`: the ONE way a key
 * becomes trusted on this device (#898). The screen calls it only after the
 * rider has confirmed, on this device, that the key is theirs; a key the
 * instance lists is only ever a question ({@link SyncReport.keysToConfirm}).
 *
 * ## A request that is not answered is a failure of THAT thing, not the sync
 *
 * The sealed call throws when nothing answers. Inside a sync that would end
 * the whole run with no report, so {@link answeringTransport} turns a thrown
 * request into an answer with no status: `sync.ts` then records that one thing
 * as failed (`no-answer`) and goes on, leaving every local row as it was, and
 * the next sync sends again what this one did not hear an answer for (#901).
 * A manifest that is not answered still stops the run — there is nothing to
 * sync against — and says so.
 *
 * ⚠️ **Every sentence here is DRAFT wording for the owner to approve** (#1195).
 */

import { isHexOfLength, toHex, unixSeconds } from '@onyourleft/domain';
import type { ActivityId, ActivityStore, AthleteId } from '@onyourleft/store';
import { webCryptoSha256, webCryptoVerifier } from '@onyourleft/store';

import { heldInstanceSession, heldSealedSession, type SealingDependencies } from './instance-port';
import { sealedRouteGate } from './instance-pin';
import { readInstanceAccount } from './sign-in';
import {
  admitDeviceKey,
  athleteKeysFrom,
  InstanceSyncError,
  sealedSyncTransport,
  syncWithInstance,
  type SyncReport,
  type SyncStore,
  type SyncTransport,
} from './sync';

/** What a sync and an admission need of the local store. */
export type SyncPortStore = SyncStore & Pick<ActivityStore, 'putTrustedDeviceKey'>;

export interface SyncPortDependencies extends SealingDependencies {
  /** The local store, asked for at each use: `localStore()` in `main.tsx`. */
  readonly store: () => SyncPortStore;
  readonly athleteId: AthleteId;
  /** The zone a pulled ride is imported in when its record names none it can use. */
  readonly timeZone: string;
  /**
   * A ride's summary body (#835) — `ride-analysis/ride-summary.ts`
   * §`rideSummaryOf`, bound ONCE for the port's life, so its cache pays.
   */
  readonly rideSummary: (activityId: ActivityId) => Promise<string | undefined>;
  /** A new document's id, for a conflict copy (#924). */
  readonly newDocumentId: () => string;
}

/** Whether this device may sync now, read from this device alone. */
export type SyncAvailability =
  /** No instance on this device: no control, no sentence, no request. */
  | { readonly kind: 'none' }
  /** Signed in, and sync cannot be sealed: the sentence that says why, and no control. */
  | { readonly kind: 'closed'; readonly text: string }
  /** Signed in with a card: the control is offered. */
  | { readonly kind: 'offered' };

export type SyncOutcome =
  | { readonly kind: 'synced'; readonly report: SyncReport }
  | { readonly kind: 'refused'; readonly text: string };

export type AdmitOutcome =
  { readonly kind: 'admitted' } | { readonly kind: 'refused'; readonly text: string };

/** What the sync panel may ask. */
export interface SyncPort {
  /** Whether to draw a sync control at all — from this device's storage, sending nothing. */
  availability(): SyncAvailability;
  /** One sync, sealed, when the rider presses for it. A second press while one runs joins it. */
  sync(): Promise<SyncOutcome>;
  /**
   * Trust another of the rider's device keys on THIS device (#898). Called by
   * the screen only after the rider confirmed it; never from what an instance said.
   */
  admitKey(publicKey: string): Promise<AdmitOutcome>;
}

/**
 * What the rider is told when a sync could not run. ⚠️ Draft wording (#1195).
 */
export const SYNC_REFUSAL_TEXT = {
  'no-answer':
    'The instance did not answer, so nothing was synced. Nothing on this device was changed. ' +
    'Try again when it is running and this device is online.',
  'signed-out':
    'The instance no longer accepts this device’s sign-in, so nothing was synced. Disconnect ' +
    'and connect again.',
  other: 'The instance refused to sync, so nothing was synced. Nothing on this device was changed.',
  'not-a-key': 'That is not a device key this app can trust.',
} as const;

/** A key, shortened to what a rider can compare by eye — as the Instance screen shows it. */
export function keyFingerprint(publicKey: string): string {
  return `${publicKey.slice(0, 8)}…${publicKey.slice(-8)}`;
}

/** The answer a request that threw is turned into: no status, and `no-answer`. */
const NO_ANSWER = { status: 0, body: { error: { code: 'no-answer' } } } as const;

/**
 * `transport` with every request that throws turned into an answer with no
 * status (the module header): a failure of that one thing, which `sync.ts`
 * records and the next sync sends again.
 */
export function answeringTransport(transport: SyncTransport): SyncTransport {
  return {
    json: async (method, path, body) => {
      try {
        return await transport.json(method, path, body);
      } catch {
        return NO_ANSWER;
      }
    },
    bytes: async (path) => {
      try {
        return await transport.bytes(path);
      } catch {
        return { status: 0, bytes: new Uint8Array(0) };
      }
    },
  };
}

/** The production {@link SyncPort}: `main.tsx` builds it, and nothing else in the client. */
export function createSyncPort(dependencies: SyncPortDependencies): SyncPort {
  const session = heldSealedSession(dependencies);
  const now = (): number => (dependencies.now ?? (() => Date.now()))();
  let running: Promise<SyncOutcome> | undefined;

  const run = async (): Promise<SyncOutcome> => {
    const held = await session();
    if (held.kind === 'closed') return { kind: 'refused', text: held.text };
    const sealed = answeringTransport(sealedSyncTransport(held.sealed, held.token));
    const store = dependencies.store();
    try {
      const report = await syncWithInstance({
        sealed,
        store,
        athleteId: dependencies.athleteId,
        signingKey: dependencies.signingKey,
        sha256: dependencies.sha256 ?? webCryptoSha256,
        verifier: dependencies.verifier ?? webCryptoVerifier,
        now: () => unixSeconds(Math.floor(now() / 1000)),
        timeZone: dependencies.timeZone,
        rideSummary: dependencies.rideSummary,
        athleteKeys: () => athleteKeysFrom(sealed),
        newDocumentId: dependencies.newDocumentId,
      });
      return { kind: 'synced', report };
    } catch (error) {
      if (error instanceof InstanceSyncError) {
        if (error.code === 'no-answer')
          return { kind: 'refused', text: SYNC_REFUSAL_TEXT['no-answer'] };
        if (error.code === 'unauthenticated') {
          return { kind: 'refused', text: SYNC_REFUSAL_TEXT['signed-out'] };
        }
      }
      return { kind: 'refused', text: SYNC_REFUSAL_TEXT.other };
    }
  };

  return {
    availability: () => {
      const account = readInstanceAccount(dependencies.storage);
      // No instance, or no sign-in held for it: nothing at all (#1195).
      if (account === undefined || heldInstanceSession(dependencies.storage) === undefined) {
        return { kind: 'none' };
      }
      const gate = sealedRouteGate(account, dependencies.loadedFrom);
      return gate.kind === 'open' ? { kind: 'offered' } : { kind: 'closed', text: gate.text };
    },
    sync: () => {
      running ??= run().finally(() => {
        running = undefined;
      });
      return running;
    },
    admitKey: async (publicKey) => {
      if (!isHexOfLength(publicKey, 32)) {
        return { kind: 'refused', text: SYNC_REFUSAL_TEXT['not-a-key'] };
      }
      // Never this device's own: it is always trusted, and is not a question.
      if (publicKey === toHex((await dependencies.signingKey()).publicKey)) {
        return { kind: 'admitted' };
      }
      await admitDeviceKey(
        dependencies.store(),
        dependencies.athleteId,
        publicKey,
        unixSeconds(Math.floor(now() / 1000)),
      );
      return { kind: 'admitted' };
    },
  };
}
