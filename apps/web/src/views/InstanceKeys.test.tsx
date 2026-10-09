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
  type Sha256,
  type SignatureVerifier,
} from '@onyourleft/domain';
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
    const encryptionKey = new Uint8Array(32).fill(3);
    const statement = {
      purpose: INSTANCE_KEY_PURPOSE,
      instanceOrigin: ORIGIN,
      keyId: await instanceKeyId(sha256, encryptionKey),
      encryptionKey: '03'.repeat(32),
      serial: 1,
      notBefore: 1,
      issuedAt: 1,
      notAfter: 4_000_000_000,
    };
    const json = (body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const port = createInstancePort({
      storage,
      ensureLocalAthlete: () => Promise.resolve(),
      signingKey: () => Promise.reject(new Error('not asked')),
      sha256,
      verifier,
      now: () => 1_790_000_000_000,
      send: (url) =>
        new URL(url).pathname === '/v1/instance/keys'
          ? json({
              identityKey,
              statements: [{ statement, signature: 'bb'.repeat(64) }],
              endorsements: [],
            })
          : json({ linkCode: 'abcd-efgh-jkmn-pqrs', expiresAt: 1_790_000_300, card: planted }),
    });
    mounted = await mount(<InstanceKeys port={port} />);
    await settle();
    await press('Add another device');
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
