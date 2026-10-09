// SPDX-License-Identifier: Apache-2.0

/**
 * HPKE's test support (#1188): the one way to fix an ephemeral key, and the
 * conformance assertions every port implementation is run through.
 *
 * ## ⚠️ Never imported by production code
 *
 * {@link setupBaseSenderWithEphemeral} is Encap with a key the caller chose.
 * RFC 9180 Appendix A needs exactly that; a production sender that reused an
 * ephemeral key would give every request to one instance key one shared
 * secret. So this module is reached only as `@onyourleft/domain/hpke-testing`,
 * `src/index.ts` names none of it (`hpke-surface.test.ts`), and
 * `eslint.config.js` §`HPKE_TESTING_IMPORT_PATTERNS` refuses the import in any
 * file that is not a test or test support.
 *
 * ## The assertions throw, they are not `expect` calls
 *
 * `packages/store/src/testing`'s round-trip harness makes the same choice for
 * the same reason: the same assertion body runs against the client's port and
 * the instance's, from two packages' test files, and a broken port must make
 * it throw ({@link HpkeConformanceFailure}) — which
 * `packages/store/src/hpke-web-crypto.test.ts` shows by running it over a port
 * with one primitive damaged.
 */

import { bytesEqual, fromHex, toHex } from '../identity/hex';
import { utf8Encode } from '../identity/utf8';
import { HpkeError, type HpkeRefusal } from './errors';
import {
  decap,
  encap,
  keySchedule,
  replyKeys,
  replyOpener,
  replySealer,
  setupBaseRecipient,
  setupBaseSender,
  setupRecipient,
  setupSender,
  type HpkeRecipientContext,
  type HpkeReplyOpener,
  type HpkeReplySealer,
  type HpkeSenderContext,
} from './hpke';
import { RFC_9180_A_1_BASE, RFC_9458_APPENDIX_A } from './hpke-vectors-testing';
import type { HpkePrimitives, X25519KeyPair } from './primitives';

export { RFC_9180_A_1_BASE, RFC_9458_APPENDIX_A } from './hpke-vectors-testing';

/** Turns a raw 32-byte X25519 private key into the implementation's handle. */
export type ImportX25519PrivateKey<PrivateKey> = (raw: Uint8Array) => Promise<PrivateKey>;

/** Raised by every assertion here, naming the value that disagreed. */
export class HpkeConformanceFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HpkeConformanceFailure';
  }
}

// --- What production cannot do -----------------------------------------------

/** `SetupBaseS` with the ephemeral key pair given. Tests only — see the header. */
export async function setupBaseSenderWithEphemeral<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  recipientPublicKey: Uint8Array,
  info: Uint8Array,
  ephemeral: X25519KeyPair<PrivateKey>,
  options: { readonly messageLimit?: bigint } = {},
): Promise<HpkeSenderContext> {
  return setupSender(port, recipientPublicKey, info, { ...options, ephemeral });
}

/** `SetupBaseR` with a lowered §5.2 limit. */
export async function setupBaseRecipientWithLimit<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  recipient: X25519KeyPair<PrivateKey>,
  enc: Uint8Array,
  info: Uint8Array,
  messageLimit: bigint,
): Promise<HpkeRecipientContext> {
  return setupRecipient(port, recipient, enc, info, { messageLimit });
}

/** A reply sealed with the nonce and the exporter label given. */
export async function replySealerWith<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  request: HpkeRecipientContext,
  responseNonce: Uint8Array,
  label: string,
): Promise<HpkeReplySealer> {
  return replySealer(port, request, responseNonce, label);
}

/** A reply opened under the exporter label given. */
export async function replyOpenerWith<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  request: HpkeSenderContext,
  responseNonce: Uint8Array,
  label: string,
): Promise<HpkeReplyOpener> {
  return replyOpener(port, request, responseNonce, label);
}

// --- RFC 9180 Appendix A.1, mode_base ----------------------------------------

/** How many messages A.1.1.1's listed sequence numbers need sealed: 0 to 256. */
const A1_MESSAGES = 257;

/**
 * RFC 9180 A.1.1 through `port`: Encap and Decap's shared secret, the key
 * schedule's `key`, `base_nonce` and `exporter_secret`, every listed
 * encryption sealed by the sender and opened by the recipient at its sequence
 * number, and every exported value from both sides.
 *
 * @throws {HpkeConformanceFailure} naming the first value that disagrees.
 */
export async function assertRfc9180A1Base<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  importPrivateKey: ImportX25519PrivateKey<PrivateKey>,
): Promise<void> {
  const v = RFC_9180_A_1_BASE;
  const { recipient, ephemeral, info } = await a1Keys(importPrivateKey);

  const encapsulated = await encap(port, recipient.publicKey, ephemeral);
  same('Encap enc', encapsulated.enc, v.enc);
  same('Encap shared_secret', encapsulated.sharedSecret, v.sharedSecret);
  same('Decap shared_secret', await decap(port, fromHex(v.enc, 'enc'), recipient), v.sharedSecret);

  const schedule = await keySchedule(port, encapsulated.sharedSecret, info);
  same('key', schedule.key, v.key);
  same('base_nonce', schedule.baseNonce, v.baseNonce);
  same('exporter_secret', schedule.exporterSecret, v.exporterSecret);

  const sender = await setupBaseSenderWithEphemeral(port, recipient.publicKey, info, ephemeral);
  const opener = await setupBaseRecipient(port, recipient, sender.enc, info);
  const sealed = await sealA1Messages(sender);
  for (const listed of v.encryptions) {
    const message = sealed[listed.sequence];
    if (message === undefined) throw new HpkeConformanceFailure('a listed sequence was not sealed');
    same(`aad at sequence ${String(listed.sequence)}`, message.aad, listed.aad);
    same(`ct at sequence ${String(listed.sequence)}`, message.ct, listed.ct);
  }
  for (const [sequence, message] of sealed.entries()) {
    const opened = await opener.open(message.aad, message.ct);
    same(`pt opened at sequence ${String(sequence)}`, opened, a1Plaintext());
  }

  for (const listed of v.exports) {
    const context = fromHex(listed.exporterContext, 'exporter_context');
    const what = `export of "${listed.exporterContext}"`;
    same(`sender ${what}`, await sender.export(context, listed.length), listed.exportedValue);
    same(`recipient ${what}`, await opener.export(context, listed.length), listed.exportedValue);
  }
}

/**
 * Every A.1.1.1 ciphertext with each one of its bytes flipped, each AAD with
 * each one of its bytes flipped, and messages out of order, replayed and
 * skipped: every one refused `open-failed`, and the context still opening the
 * genuine message afterwards.
 */
export async function assertRfc9180A1TamperingRefused<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  importPrivateKey: ImportX25519PrivateKey<PrivateKey>,
): Promise<void> {
  const v = RFC_9180_A_1_BASE;
  const { recipient, ephemeral, info } = await a1Keys(importPrivateKey);
  const sender = await setupBaseSenderWithEphemeral(port, recipient.publicKey, info, ephemeral);
  const sealed = await sealA1Messages(sender);
  const at = (sequence: number): { aad: Uint8Array; ct: Uint8Array } => {
    const message = sealed[sequence];
    if (message === undefined) throw new HpkeConformanceFailure('no such sequence');
    return message;
  };

  // Out of order on a fresh context: 1 before 0, a replay of 0, 2 before 1.
  const ordered = await setupBaseRecipient(port, recipient, sender.enc, info);
  await refused('sequence 1 opened first', ordered.open(at(1).aad, at(1).ct), 'open-failed');
  await ordered.open(at(0).aad, at(0).ct);
  await refused('sequence 0 replayed', ordered.open(at(0).aad, at(0).ct), 'open-failed');
  await refused('sequence 2 opened at 1', ordered.open(at(2).aad, at(2).ct), 'open-failed');
  await ordered.open(at(1).aad, at(1).ct);

  // Each listed message, flipped byte by byte, at its own sequence number.
  const listed = new Set<number>(v.encryptions.map((encryption) => encryption.sequence));
  const walker = await setupBaseRecipient(port, recipient, sender.enc, info);
  for (const [sequence, message] of sealed.entries()) {
    if (listed.has(sequence)) {
      for (let index = 0; index < message.ct.length; index += 1) {
        await refused(
          `ct at sequence ${String(sequence)} with byte ${String(index)} flipped`,
          walker.open(message.aad, flipped(message.ct, index)),
          'open-failed',
        );
      }
      for (let index = 0; index < message.aad.length; index += 1) {
        await refused(
          `aad at sequence ${String(sequence)} with byte ${String(index)} flipped`,
          walker.open(flipped(message.aad, index), message.ct),
          'open-failed',
        );
      }
    }
    await walker.open(message.aad, message.ct);
  }
}

// --- Low-order points ---------------------------------------------------------

/**
 * Small-order Curve25519 points, whose X25519 output is all zeros for every
 * scalar (RFC 7748 §5 clamps the cofactor in): `0`, `1`, and a point of order
 * 8. Each is what RFC 9180 §7.1.4's check exists for.
 */
export const LOW_ORDER_POINTS: readonly string[] = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
];

/**
 * Every {@link LOW_ORDER_POINTS} entry refused by the production `Encap`
 * (as a recipient key) and `Decap` (as an `enc`), through `port`.
 */
export async function assertLowOrderPointsRefused<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  importPrivateKey: ImportX25519PrivateKey<PrivateKey>,
): Promise<void> {
  const { recipient, info } = await a1Keys(importPrivateKey);
  for (const point of LOW_ORDER_POINTS) {
    const publicKey = fromHex(point, 'a low-order point');
    await refusedAsLowOrder(`Encap to ${point}`, setupBaseSender(port, publicKey, info));
    await refusedAsLowOrder(
      `Decap of ${point}`,
      setupBaseRecipient(port, recipient, publicKey, info),
    );
  }
}

// --- RFC 9458 Appendix A: the reply derivation --------------------------------

/**
 * RFC 9458 Appendix A through `port`, which is ADR 0047 D-2's derivation under
 * RFC 9458's own label: the request opened by the recipient and sealed by the
 * sender, the exported secret, the reply's key and nonce from
 * `enc || response_nonce`, and the response sealed by the one and opened by the
 * other.
 */
export async function assertRfc9458Reply<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
  importPrivateKey: ImportX25519PrivateKey<PrivateKey>,
): Promise<void> {
  const v = RFC_9458_APPENDIX_A;
  const configuration = fromHex(v.keyConfiguration, 'the key configuration');
  const recipient = {
    publicKey: configuration.slice(3, 35),
    privateKey: await importPrivateKey(fromHex(v.skR, 'skR')),
  };
  const ephemeral = {
    publicKey: fromHex(v.pkE, 'pkE'),
    privateKey: await importPrivateKey(fromHex(v.skE, 'skE')),
  };
  const info = fromHex(v.info, 'info');
  const encapsulated = fromHex(v.encapsulatedRequest, 'the encapsulated request');
  const enc = encapsulated.slice(7, 39);
  const requestCiphertext = encapsulated.slice(39);
  const responseNonce = fromHex(v.responseNonce, 'response_nonce');
  const empty = new Uint8Array(0);

  // The instance's side.
  const opened = await setupBaseRecipient(port, recipient, enc, info);
  same('the request opened', await opened.open(empty, requestCiphertext), v.request);
  same(
    'the exported response secret',
    await opened.export(utf8Encode(v.responseLabel), 16),
    v.exportedSecret,
  );
  const keys = await replyKeys(port, opened, responseNonce, v.responseLabel);
  same('the response key', keys.key, v.key);
  same('the response nonce', keys.baseNonce, v.nonce);
  const sealer = await replySealerWith(port, opened, responseNonce, v.responseLabel);
  const responseCiphertext = await sealer.seal(empty, fromHex(v.response, 'the response'));
  same(
    'the encapsulated response',
    concatenated(sealer.responseNonce, responseCiphertext),
    v.encapsulatedResponse,
  );

  // The device's side.
  const sender = await setupBaseSenderWithEphemeral(port, recipient.publicKey, info, ephemeral);
  same('enc', sender.enc, toHex(enc));
  same(
    'the request sealed',
    await sender.seal(empty, fromHex(v.request, 'the request')),
    toHex(requestCiphertext),
  );
  const replyOpener = await replyOpenerWith(port, sender, responseNonce, v.responseLabel);
  same('the response opened', await replyOpener.open(empty, responseCiphertext), v.response);
}

// --- The sequence limit -------------------------------------------------------

/**
 * A sender at a limit of 3 seals three messages and refuses the fourth and the
 * fifth `message-limit`; a recipient at 2 opens two and refuses the third,
 * genuine message the same way. Neither wraps to sequence 0.
 */
export async function assertMessageLimitRaises<PrivateKey>(
  port: HpkePrimitives<PrivateKey>,
): Promise<void> {
  const recipient = await port.generateX25519KeyPair();
  const ephemeral = await port.generateX25519KeyPair();
  const info = utf8Encode('the limit');
  const sender = await setupBaseSenderWithEphemeral(port, recipient.publicKey, info, ephemeral, {
    messageLimit: 3n,
  });
  const aad = new Uint8Array(0);
  const ciphertexts: Uint8Array[] = [];
  for (let index = 0; index < 3; index += 1) {
    ciphertexts.push(await sender.seal(aad, Uint8Array.of(index)));
  }
  await refused(
    'a fourth seal at a limit of 3',
    sender.seal(aad, Uint8Array.of(3)),
    'message-limit',
  );
  await refused(
    'a fifth seal at a limit of 3',
    sender.seal(aad, Uint8Array.of(4)),
    'message-limit',
  );

  const opener = await setupBaseRecipientWithLimit(port, recipient, sender.enc, info, 2n);
  for (let index = 0; index < 2; index += 1) {
    same(
      `message ${String(index)} under the limit`,
      await opener.open(aad, ciphertexts[index] ?? new Uint8Array(0)),
      toHex(Uint8Array.of(index)),
    );
  }
  await refused(
    'a third open at a limit of 2',
    opener.open(aad, ciphertexts[2] ?? new Uint8Array(0)),
    'message-limit',
  );
}

// --- Helpers ------------------------------------------------------------------

async function a1Keys<PrivateKey>(importPrivateKey: ImportX25519PrivateKey<PrivateKey>): Promise<{
  readonly recipient: X25519KeyPair<PrivateKey>;
  readonly ephemeral: X25519KeyPair<PrivateKey>;
  readonly info: Uint8Array;
}> {
  const v = RFC_9180_A_1_BASE;
  return {
    recipient: {
      publicKey: fromHex(v.pkRm, 'pkRm'),
      privateKey: await importPrivateKey(fromHex(v.skRm, 'skRm')),
    },
    ephemeral: {
      publicKey: fromHex(v.pkEm, 'pkEm'),
      privateKey: await importPrivateKey(fromHex(v.skEm, 'skEm')),
    },
    info: fromHex(v.info, 'info'),
  };
}

/** A.1.1.1's one plaintext, which every listed encryption shares. */
function a1Plaintext(): string {
  const first = RFC_9180_A_1_BASE.encryptions[0];
  if (first === undefined) throw new HpkeConformanceFailure('A.1.1.1 lists no encryption');
  return first.pt;
}

/** Seals A.1.1.1's plaintext at sequence 0 to 256, each with aad `Count-<n>`. */
async function sealA1Messages(
  sender: HpkeSenderContext,
): Promise<{ readonly aad: Uint8Array; readonly ct: Uint8Array }[]> {
  const pt = fromHex(a1Plaintext(), 'pt');
  const sealed: { aad: Uint8Array; ct: Uint8Array }[] = [];
  for (let sequence = 0; sequence < A1_MESSAGES; sequence += 1) {
    const aad = utf8Encode(`Count-${String(sequence)}`);
    sealed.push({ aad, ct: await sender.seal(aad, pt) });
  }
  return sealed;
}

function same(what: string, actual: Uint8Array, expectedHex: string): void {
  if (!bytesEqual(actual, fromHex(expectedHex, what))) {
    throw new HpkeConformanceFailure(`${what}: got ${toHex(actual)}, the RFC has ${expectedHex}`);
  }
}

async function refused(
  what: string,
  attempt: Promise<unknown>,
  reason: HpkeRefusal,
): Promise<void> {
  try {
    await attempt;
  } catch (error) {
    if (error instanceof HpkeError && error.reason === reason) return;
    throw new HpkeConformanceFailure(
      `${what}: refused, but not as ${reason} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  throw new HpkeConformanceFailure(`${what}: was accepted`);
}

async function refusedAsLowOrder(what: string, attempt: Promise<unknown>): Promise<void> {
  try {
    await attempt;
  } catch (error) {
    // A platform that follows the port contract throws inside `x25519`, which
    // the module reports as `invalid-public-key`; one that returns the zeros
    // meets the module's own check. Either is a refusal of the point.
    if (
      error instanceof HpkeError &&
      (error.reason === 'low-order-point' || error.reason === 'invalid-public-key')
    ) {
      return;
    }
    throw new HpkeConformanceFailure(`${what}: refused for the wrong reason`);
  }
  throw new HpkeConformanceFailure(`${what}: was accepted`);
}

function flipped(bytes: Uint8Array, index: number): Uint8Array {
  const copy = bytes.slice();
  copy[index] = (copy[index] ?? 0) ^ 0x01;
  return copy;
}

function concatenated(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
