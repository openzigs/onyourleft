// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The instance's key on the Instance screen, and the invitation on Moderation
 * (#1190, ADR 0047 D-6): what the rider sees for each answer of the port, and
 * — over the REAL port — that the card the link-code screen shows is the
 * device's own pin, whatever the instance answered.
 */

import {
  base32Unpadded,
  INSTANCE_KEY_PURPOSE,
  instanceCard,
  instanceIdentityFingerprint,
  instanceKeyId,
  openSealedRequest,
  parseSealedEnvelope,
  sealedReplyWriter,
  sessionTokenSha256,
  toHex,
  utf8Encode,
  type Sha256,
  type SignatureVerifier,
} from '@onyourleft/domain';
import { webCryptoHpkePrimitives } from '@onyourleft/store';
import { afterEach, describe, expect, it } from 'vitest';

import { groupedFingerprint, INSTANCE_KEY_TEXT } from '../instance/instance-pin';
import {
  createInstancePort,
  INSTANCE_SESSION_STORAGE_KEY,
  type InstanceStorage,
} from '../instance/instance-port';
import { INVITE_CARD_CAUTION } from '../instance/moderation-port';
import { INSTANCE_ACCOUNT_STORAGE_KEY } from '../instance/sign-in';
import {
  LOADED_LOCALLY,
  SCRIPTED_FINGERPRINT,
  SCRIPTED_NEW_FINGERPRINT,
  scriptedInstance,
  scriptedModeration,
} from '../instance/testing';
import { mount, settle, typeInto, typeIntoTextArea, type Mounted } from '../testing/mount';
import { InstanceKeys, INSTANCE_KEY_PINNED } from './InstanceKeys';
import { ModerationView } from './ModerationView';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const ORIGIN = 'https://ride.example';

function text(): string {
  return (mounted?.container.textContent ?? '').replace(/\s+/g, ' ');
}

function button(name: string): HTMLButtonElement {
  // A sentence may NAME a control; only a button is one.
  const found = [...(mounted?.container.querySelectorAll('button') ?? [])].find(
    (each) => each.textContent === name,
  );
  if (found === undefined) throw new Error(`no ${name} button`);
  return found;
}

async function press(name: string): Promise<void> {
  button(name).click();
  await settle();
}

async function pasteCard(card: string): Promise<void> {
  const box = mounted?.container.querySelector('textarea');
  if (box === null || box === undefined) throw new Error('no card box');
  await typeIntoTextArea(box, card);
  await press('Use this card');
}

describe('the instance’s key on the Instance screen (#1190)', () => {
  it('says a device with no card needs one, and pins a card pasted into the box', async () => {
    const scripted = scriptedInstance({ connected: true });
    mounted = await mount(<InstanceKeys port={scripted.port} />);
    await settle();
    expect(text()).toContain(INSTANCE_KEY_TEXT['needs-card']);
    expect(() => button('Add another device')).toThrow();
    await pasteCard(`oyl-instance:${ORIGIN}#${SCRIPTED_FINGERPRINT}`);
    expect(scripted.held.pin).toBe(SCRIPTED_FINGERPRINT);
    expect(text()).toContain(INSTANCE_KEY_PINNED);
    expect(text()).toContain(groupedFingerprint(SCRIPTED_FINGERPRINT));
  });

  it('shows a different card beside the pin, whole, and keeps the pin until the rider confirms', async () => {
    const scripted = scriptedInstance({ connected: true, pin: SCRIPTED_FINGERPRINT });
    mounted = await mount(<InstanceKeys port={scripted.port} />);
    await settle();
    const newCard = `oyl-instance:${ORIGIN}#${SCRIPTED_NEW_FINGERPRINT}`;
    await pasteCard(newCard);
    expect(text()).toContain(INSTANCE_KEY_TEXT['confirm-new-card']);
    expect(text()).toContain(groupedFingerprint(SCRIPTED_FINGERPRINT));
    expect(text()).toContain(groupedFingerprint(SCRIPTED_NEW_FINGERPRINT));
    expect(scripted.held.pin).toBe(SCRIPTED_FINGERPRINT);
    await press('Keep the card this device has');
    expect(scripted.held.pin).toBe(SCRIPTED_FINGERPRINT);
    expect(text()).not.toContain(INSTANCE_KEY_TEXT['confirm-new-card']);

    await pasteCard(newCard);
    await press('Confirm the new card');
    expect(scripted.held.pin).toBe(SCRIPTED_NEW_FINGERPRINT);
    expect(scripted.calls).toContain(`confirmCard ${newCard}`);
  });

  it('says a refusal loudly, and shows both fingerprints when the instance announced a new key', async () => {
    const scripted = scriptedInstance({
      connected: true,
      pin: SCRIPTED_FINGERPRINT,
      keys: {
        kind: 'needs-new-card',
        text: INSTANCE_KEY_TEXT['needs-new-card'],
        pinned: SCRIPTED_FINGERPRINT,
        expected: SCRIPTED_NEW_FINGERPRINT,
      },
    });
    mounted = await mount(<InstanceKeys port={scripted.port} />);
    await settle();
    expect(text()).toContain(INSTANCE_KEY_TEXT['needs-new-card']);
    expect(text()).toContain(groupedFingerprint(SCRIPTED_NEW_FINGERPRINT));
    expect(() => button('Add another device')).toThrow();
  });
});

describe('the link-code screen shows the PINNED card, not the instance’s (#1190, D-6)', () => {
  /** A digest that is the input, padded: enough for a fingerprint to be computed the same way twice. */
  const sha256: Sha256 = (bytes) => {
    const out = new Uint8Array(32);
    bytes.forEach((byte, index) => {
      out[index % 32] = ((out[index % 32] ?? 0) + byte * (index + 1)) & 0xff;
    });
    return Promise.resolve(out);
  };
  const verifier: SignatureVerifier = {
    algorithm: 'Ed25519',
    verify: () => Promise.resolve(true),
  };

  it('composes the card from this device’s stored pin when the answer carries another', async () => {
    const identityKey = 'aa'.repeat(32);
    const pin = base32Unpadded(await instanceIdentityFingerprint(sha256, ORIGIN, identityKey));
    const pinned = `oyl-instance:${ORIGIN}#${pin}`;
    const planted = instanceCard(ORIGIN, new Uint8Array(32).fill(7));
    const map = new Map<string, string>([
      [
        INSTANCE_ACCOUNT_STORAGE_KEY,
        JSON.stringify({ origin: ORIGIN, instanceAthleteId: 'a', pin }),
      ],
      [INSTANCE_SESSION_STORAGE_KEY, JSON.stringify({ origin: ORIGIN, token: 't' })],
    ]);
    const storage: InstanceStorage = {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => void map.set(key, value),
      removeItem: (key) => void map.delete(key),
    };
    // A real X25519 key, because the link code is minted SEALED (#1192): this
    // stand-in opens the request and seals its answer back, as the instance
    // does — and plants a card in it, which only an instance could now do.
    const pair = await webCryptoHpkePrimitives.generateX25519KeyPair();
    const keyId = await instanceKeyId(sha256, pair.publicKey);
    const statement = {
      purpose: INSTANCE_KEY_PURPOSE,
      instanceOrigin: ORIGIN,
      keyId,
      encryptionKey: toHex(pair.publicKey),
      serial: 1,
      notBefore: 1_789_999_000,
      issuedAt: 1_789_999_000,
      notAfter: 1_790_100_000,
    };
    const json = (body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const devicePair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign']);
    const port = createInstancePort({
      storage,
      loadedFrom: LOADED_LOCALLY,
      ensureLocalAthlete: () => Promise.resolve(),
      signingKey: async () => ({
        algorithm: 'Ed25519',
        publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', devicePair.publicKey)),
        sign: async (message) =>
          new Uint8Array(
            await crypto.subtle.sign('Ed25519', devicePair.privateKey, new Uint8Array(message)),
          ),
      }),
      sha256,
      verifier,
      now: () => 1_790_000_000_000,
      send: async (url, init) => {
        if (new URL(url).pathname === '/v1/instance/keys') {
          return json({
            identityKey,
            statements: [{ statement, signature: 'bb'.repeat(64) }],
            endorsements: [],
          });
        }
        const envelope = parseSealedEnvelope(
          JSON.parse(init.body as string) as Record<string, unknown>,
        );
        if (envelope === undefined) throw new Error('not sealed');
        const binding = {
          instanceOrigin: ORIGIN,
          keyId,
          tokenSha256: await sessionTokenSha256(sha256, 't'),
        };
        const opened = await openSealedRequest(webCryptoHpkePrimitives, pair, envelope, binding);
        const writer = await sealedReplyWriter(webCryptoHpkePrimitives, opened.context, binding);
        return json(
          await writer.reply(
            200,
            'application/json',
            utf8Encode(
              JSON.stringify({
                linkCode: 'abcd-efgh-jkmn-pqrs',
                expiresAt: 1_790_000_300,
                card: planted,
              }),
            ),
          ),
        );
      },
    });
    mounted = await mount(<InstanceKeys port={port} />);
    await settle();
    await press('Add another device');
    // A sealed call does real cryptography, which no fixed number of ticks waits
    // out (#1192): wait for the answer, a bounded number of times.
    for (let tick = 0; tick < 200 && !text().includes('abcd-efgh-jkmn-pqrs'); tick += 1) {
      await settle();
    }
    expect(text()).toContain(`${pinned} abcd-efgh-jkmn-pqrs`);
    expect(text()).not.toContain(planted);
  });
});

describe('the invitation share sheet (#1190, D-6 source 3)', () => {
  it('shows the invitation with this device’s card, and the caution about its channel', async () => {
    const scripted = scriptedModeration();
    mounted = await mount(<ModerationView port={scripted.port} />);
    await settle();
    const reason = mounted.container.querySelectorAll('input');
    await typeInto(reason[reason.length - 1] as HTMLInputElement, 'A friend from the club');
    await press('Make an invitation');
    expect(text()).toContain(INVITE_CARD_CAUTION);
    expect(text()).toContain(`oyl-instance:${ORIGIN}#${SCRIPTED_FINGERPRINT} wxyz-2345-abcd-efgh`);
  });

  it('makes no invitation on a device with no card, and says it needs one', async () => {
    const scripted = scriptedModeration({ pin: null });
    mounted = await mount(<ModerationView port={scripted.port} />);
    await settle();
    const reason = mounted.container.querySelectorAll('input');
    await typeInto(reason[reason.length - 1] as HTMLInputElement, 'A friend');
    await press('Make an invitation');
    expect(text()).toContain(INSTANCE_KEY_TEXT['needs-card']);
    expect(text()).not.toContain(INVITE_CARD_CAUTION);
  });
});
