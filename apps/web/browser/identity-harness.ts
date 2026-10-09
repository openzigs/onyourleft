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
 * Since #1192 a key the instance has not seen registers only SEALED (ADR 0047
 * D-7), so `signIn` seals its session request in this browser — with the
 * client's own `sealedInstance` — to the newest key the instance serves, and
 * sends it through `window.oylInstanceFetch`, a raw request the spec exposes.
 * The tampering control flips the signature HERE, before sealing, because
 * nothing on the way can read the request any more.
 *
 * ⚠️ **What it does not prove**: anything about a phone's WebView. The page
 * publishes the result on `window.__oylIdentity` and asserts nothing.
 */

import { fromHex, unixSeconds } from '@onyourleft/domain';
import {
  ensureDeviceSigningKey,
  openActivityStore,
  webCryptoHpkePrimitives,
  webCryptoSha256,
} from '@onyourleft/store';

import {
  createInstancePort,
  type ConnectOutcome,
  type DevicesOutcome,
  type InstanceState,
} from '../src/instance/instance-port';
import {
  createInstanceClock,
  sealedInstance,
  type InstanceSend,
} from '../src/instance/instance-transport';
import { signInToInstance, type SignedIn } from '../src/instance/sign-in';
import { ensureLocalAthlete, LOCAL_ATHLETE } from '../src/local-athlete';

export interface IdentityHarness {
  /**
   * Sign in with a statement for `origin`, sealed to the instance at
   * `instanceOrigin` (#1192). `flipSignature`: the statement's signature is
   * changed before it is sealed — the control.
   */
  signIn(
    origin: string,
    database: string,
    options: { readonly instanceOrigin: string; readonly flipSignature?: boolean },
  ): Promise<SignedIn>;
  /**
   * #777: the PRODUCTION instance port — the real `instance-transport.ts`
   * `fetch`, cross-origin to the instance the spec runs — connecting, then
   * reading back what a reload would show, and the device list.
   */
  connect(
    address: string,
    database: string,
    card: string,
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
    /** Exposed by the spec from Node: one raw request to the instance it is running (#1192). */
    oylInstanceFetch?: (
      path: string,
      init: { method: string; headers: Record<string, string>; body: string | null },
    ) => Promise<{ status: number; contentType: string; text: string }>;
  }
}

/** `window.oylInstanceFetch` as a transport's `send`: the request, raw, to the spec's instance. */
const exposedSend: InstanceSend = async (url, init) => {
  const relay = window.oylInstanceFetch;
  if (relay === undefined) throw new Error('the spec exposed no instance');
  const answered = await relay(new URL(url).pathname, {
    method: init.method ?? 'GET',
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    body: typeof init.body === 'string' ? init.body : null,
  });
  return new Response(answered.text === '' ? null : answered.text, {
    status: answered.status,
    headers: { 'content-type': answered.contentType },
  });
};

function portOver(database: string) {
  const store = openActivityStore(database);
  return createInstancePort({
    storage: localStorage,
    // This page is served from loopback: a copy that may seal (ADR 0047 D-11).
    loadedFrom: { native: false, href: location.href },
    ensureLocalAthlete: () => ensureLocalAthlete(store, unixSeconds(Math.floor(Date.now() / 1000))),
    signingKey: () => ensureDeviceSigningKey(store, LOCAL_ATHLETE),
  });
}

window.__oylIdentity = {
  connect: async (address, database, card) => {
    const port = portOver(database);
    // With the instance's card: a new key registers only sealed (#1192).
    const connected = await port.connect(address, 'Anna', card);
    return { connected, current: await port.current(), devices: await port.devices() };
  },
  reload: async (database) => portOver(database).current(),
  signIn: async (origin, database, options) => {
    const store = openActivityStore(database);
    const signingKey = () => ensureDeviceSigningKey(store, LOCAL_ATHLETE);
    const local = () => ensureLocalAthlete(store, unixSeconds(Math.floor(Date.now() / 1000)));
    // The instance's newest encryption key, as it serves it. Not judged under
    // a pin here: what this page proves is the device key's signature (#772).
    const served = (await (
      await exposedSend(`${options.instanceOrigin}/v1/instance/keys`, { method: 'GET' })
    ).json()) as { statements: { statement: { keyId: string; encryptionKey: string } }[] };
    const newest = served.statements.at(-1)?.statement;
    if (newest === undefined) throw new Error('the instance serves no encryption key');
    await local();
    const sealed = sealedInstance(
      options.instanceOrigin,
      {
        instanceKey: {
          keyId: newest.keyId,
          publicKey: fromHex(newest.encryptionKey, 'the encryption key', 32),
        },
        signingKey: await signingKey(),
        primitives: webCryptoHpkePrimitives,
        sha256: webCryptoSha256,
        clock: createInstanceClock(),
      },
      exposedSend,
    );
    return signInToInstance({
      origin,
      transport: {
        post: (path, body) => {
          const post = window.oylInstancePost;
          if (post === undefined) throw new Error('the spec exposed no instance');
          return post(path, body);
        },
      },
      sealed: {
        post: (path, body) => {
          const signature = typeof body.signature === 'string' ? body.signature : '';
          const flipped = (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1);
          return sealed.call('POST', path, {
            body: options.flipSignature === true ? { ...body, signature: flipped } : body,
          });
        },
      },
      storage: localStorage,
      ensureLocalAthlete: local,
      signingKey,
    });
  },
};
