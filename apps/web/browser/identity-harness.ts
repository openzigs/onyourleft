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
 * ⚠️ **What it does not prove**: anything about a phone's WebView, or about
 * the production transport, which is #777's and does not exist yet. The page
 * publishes the result on `window.__oylIdentity` and asserts nothing.
 */

import { unixSeconds } from '@onyourleft/domain';
import { ensureDeviceSigningKey, openActivityStore } from '@onyourleft/store';

import { signInToInstance, type SignedIn } from '../src/instance/sign-in';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../src/local-athlete';

export interface IdentityHarness {
  signIn(origin: string, database: string): Promise<SignedIn>;
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

window.__oylIdentity = {
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
