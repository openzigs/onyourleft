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
 * Since #1227 it also asks the instance for a WRITE-UP of a ride
 * (`writeUp`): the real `createInstanceAnalysis`, as `main.tsx` builds it,
 * over the sealed session the production port keeps once it has connected
 * with the instance's card, so the job's start, its event stream, its resume
 * and its acknowledgement all go over the real `fetch`, sealed, to the
 * instance's own listener on loopback. The ride is written into this page's
 * IndexedDB from the store's own fixtures, and the write-up is read back from
 * a fresh connection to it. What the page was shown is recorded view by view,
 * so the spec can turn the network off mid-stream and see the page follow.
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
  type ActivityId,
} from '@onyourleft/store';
import { rideFor, streamSetFor } from '@onyourleft/store/testing';

import {
  createInstancePort,
  heldSealedSession,
  type ConnectOutcome,
  type DevicesOutcome,
  type InstanceState,
} from '../src/instance/instance-port';
import { createInstanceAnalysis } from '../src/ride-analysis/instance-analysis';
import type {
  InstanceAskOutcome,
  InstanceJobView,
} from '../src/ride-analysis/instance-analysis-port';
import { jobSessionOf, type JobSession } from '../src/ride-analysis/instance-job';
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
  /**
   * #1227: write a ride into `database` and press for a write-up of it on the
   * instance this page connected to (`connect` first). Returns at once; the
   * run goes on, and {@link IdentityHarness.writeUpState} reads it.
   * `idleMilliseconds` is the transport's idle cut for the job's stream, for
   * the control; the shipped one otherwise.
   */
  startWriteUp(database: string, options?: { readonly idleMilliseconds?: number }): Promise<void>;
  /**
   * Every view the page was handed so far, the outcome once the run ended,
   * and — once it has — the write-up read back through a FRESH connection to
   * the store, as the ride's page reads it.
   */
  writeUpState(): Promise<WriteUpState>;
}

/** What {@link IdentityHarness.writeUpState} reads. */
export interface WriteUpState {
  readonly views: readonly InstanceJobView[];
  readonly outcome: InstanceAskOutcome | undefined;
  readonly saved: { readonly text: string; readonly source: string } | undefined;
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

/** The run `startWriteUp` began: one at a time. */
let writing:
  | {
      readonly database: string;
      readonly rideId: ActivityId;
      readonly views: InstanceJobView[];
      outcome: InstanceAskOutcome | undefined;
    }
  | undefined;

/** A job session whose stream has the given idle cut: the control's. */
function withIdleCut(session: JobSession, idleMilliseconds: number | undefined): JobSession {
  if (session.kind === 'closed' || idleMilliseconds === undefined) return session;
  const { channel } = session;
  return {
    ...session,
    channel: {
      call: (method, path, options) => channel.call(method, path, options),
      stream: (path, options) => channel.stream(path, { ...options, idleMilliseconds }),
    },
  };
}

window.__oylIdentity = {
  connect: async (address, database, card) => {
    const port = portOver(database);
    // With the instance's card: a new key registers only sealed (#1192).
    const connected = await port.connect(address, 'Anna', card);
    return { connected, current: await port.current(), devices: await port.devices() };
  },
  reload: async (database) => portOver(database).current(),
  startWriteUp: async (database, options = {}) => {
    const store = openActivityStore(database);
    await ensureLocalAthlete(store, unixSeconds(Math.floor(Date.now() / 1000)));
    // An hour's ride from the store's own fixtures, with its streams.
    const ride = rideFor(LOCAL_ATHLETE);
    await store.putActivity(ride);
    await store.putStreamSet(streamSetFor(ride, { sampleCount: 3600 }));
    // As `main.tsx` §`buildInstanceAnalysis` builds it.
    const sealed = heldSealedSession({
      storage: localStorage,
      loadedFrom: { native: false, href: location.href },
      signingKey: () => ensureDeviceSigningKey(store, LOCAL_ATHLETE),
    });
    const port = createInstanceAnalysis({
      store,
      athleteId: LOCAL_ATHLETE,
      connected: () => true,
      session: async () => withIdleCut(jobSessionOf(await sealed()), options.idleMilliseconds),
      cameraConsented: () => false,
      now: () => unixSeconds(Math.floor(Date.now() / 1000)),
      pending: localStorage,
    });
    const run: NonNullable<typeof writing> = {
      database,
      rideId: ride.id,
      views: [],
      outcome: undefined,
    };
    writing = run;
    void port
      .ask(ride.id, 'instance-local', (view) => run.views.push(view), new AbortController().signal)
      .then((outcome) => {
        run.outcome = outcome;
      });
  },
  writeUpState: async () => {
    const run = writing;
    if (run === undefined) return { views: [], outcome: undefined, saved: undefined };
    let saved: WriteUpState['saved'];
    if (run.outcome !== undefined) {
      const fresh = openActivityStore(run.database);
      const row = await fresh.getRideWriteUp(LOCAL_ATHLETE, run.rideId);
      saved = row === undefined ? undefined : { text: row.text, source: row.source };
    }
    return { views: [...run.views], outcome: run.outcome, saved };
  },
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
