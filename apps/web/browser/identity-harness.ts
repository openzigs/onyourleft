// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #772's cross-platform criterion, executed rather than argued: a statement
 * signed by THIS BROWSER's WebCrypto, with the device key the app itself keeps
 * — the store's non-extractable Ed25519 `CryptoKey` in IndexedDB — is verified
 * by the Node instance (ADR 0014 D-8: "#7 verifies from Node what `apps/web`
 * signed in a browser").
 *
 * The page runs the client's real `signInToInstance` with the real
 * `ensureLocalAthlete` and `ensureDeviceSigningKey`. Its transport is the one
 * thing that is the harness's: `window.oylInstancePost`, which
 * `identity.browser.spec.ts` exposes from Node and which posts to a real
 * instance — the real handler, the real identity routes and a real SQLite
 * file — running in the spec's own process. So the bytes the browser signed
 * cross into Node exactly as sent and are verified there by the instance's
 * own code.
 *
 * Since #777 it also drives the PRODUCTION instance port, whose transport is
 * the real `fetch` in `instance-transport.ts`, cross-origin from this page to
 * the instance's own listener — so the instance's CORS answers, the transport's
 * request settings and a real browser's refusal rules are all in the path.
 *
 * ⚠️ **What it does not prove**: anything about a phone's WebView. The page
 * publishes the result on `window.__oylIdentity` and asserts nothing.
 */

import { unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey, openActivityStore } from '@onyourleft/store';

import {
  createInstancePort,
  type ConnectOutcome,
  type DevicesOutcome,
  type InstanceState,
} from '../src/instance/instance-port';
import { signInToInstance, type SignedIn } from '../src/instance/sign-in';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../src/local-athlete';

export interface IdentityHarness {
  signIn(origin: string, database: string): Promise<SignedIn>;
  /**
   * #777: the PRODUCTION instance port — the real `instance-transport.ts`
   * `fetch`, cross-origin to the instance the spec runs — connecting, then
   * reading back what a reload would show, and the device list.
   */
  connect(
    address: string,
    database: string,
  ): Promise<{ connected: ConnectOutcome; current: InstanceState; devices: DevicesOutcome }>;
  /** A fresh port over the same `localStorage` — the reload — and what it reads. */
  reload(database: string): Promise<InstanceState>;
}

declare global {
  interface Window {
    __oylIdentity?: IdentityHarness;
    /** Exposed by the spec from Node: posts to the instance it is running. */
    oylInstancePost?: (
      path: string,
      body: Readonly<Record<string, unknown>>,
    ) => Promise<{ status: number; body: unknown }>;
  }
}

function portOver(database: string) {
  const store = openActivityStore(database);
  return createInstancePort({
    storage: localStorage,
    ensureLocalAthlete: () => ensureLocalAthlete(store, unixSeconds(Math.floor(Date.now() / 1000))),
    signingKey: () => ensureDeviceSigningKey(store, LOCAL_ATHLETE),
  });
}

window.__oylIdentity = {
  connect: async (address, database) => {
    const port = portOver(database);
    const connected = await port.connect(address, 'Anna');
    return { connected, current: await port.current(), devices: await port.devices() };
  },
  reload: async (database) => portOver(database).current(),
  signIn: (origin, database) => {
    const store = openActivityStore(database);
    return signInToInstance({
      origin,
      transport: {
        post: (path, body) => {
          const post = window.oylInstancePost;
          if (post === undefined) throw new Error('the spec exposed no instance');
          return post(path, body);
        },
      },
      storage: localStorage,
      ensureLocalAthlete: () =>
        ensureLocalAthlete(store, unixSeconds(Math.floor(Date.now() / 1000))),
      signingKey: () => ensureDeviceSigningKey(store, LOCAL_ATHLETE),
    });
  },
};
