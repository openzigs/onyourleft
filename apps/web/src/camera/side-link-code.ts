// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **What a side-camera pairing code says, and the refusal of everything it
 * may not** — #529, [ADR 0033](../../../../docs/adr/0033-side-camera-link.md)
 * D-1 and D-4.
 *
 * Two codes cross by sight and nothing else carries signalling (D-1): the
 * tablet shows an **offer** and the phone reads it; the phone shows an
 * **answer** and the tablet reads it. Each is the text of one QR code:
 *
 * ```text
 * OYLSIDE1{"r":"o","u":"…","p":"…","f":"…","s":"actpass","c":["192.168.1.20:50123"],"k":"…"}
 * ```
 *
 * - `r` — `o` for an offer, `a` for an answer. A phone that reads an answer,
 *   or a tablet that reads an offer, has been shown the wrong screen and is
 *   told so.
 * - `u`, `p` — the ICE username fragment and password.
 * - `f` — the SHA-256 DTLS fingerprint, 32 bytes in unpadded base64url. This
 *   is what authenticates the peer (D-4): a device that did not appear in
 *   front of the other's camera cannot present a matching certificate.
 * - `s` — the DTLS role: `actpass` on an offer, `active` or `passive` on an
 *   answer.
 * - `c` — the host candidates, `address:port`, an IPv6 address in brackets.
 * - `k` — **the offer only**: D-4's one-time secret, 32 random bytes in
 *   base64url, which the phone sends back as its first message.
 *
 * ## ⚠️ An unknown field is refused, not ignored
 *
 * [ADR 0017](../../../../docs/adr/0017-workout-file-format.md) D-4's rule,
 * which D-1 names: a code carrying a field this build does not read is a code
 * from a build that meant something this one would not do. The version is in
 * the prefix, so a future format is `OYLSIDE2` and this build refuses it whole.
 *
 * ## ⚠️ The candidate rule, in exactly one place
 *
 * {@link candidateAccepted} is D-4's rule and nothing else decides it. The
 * ENCODER leaves out every candidate the rule does not accept — a global IPv6
 * address on a dual-stack home network is omitted, not fatal — and the DECODER
 * refuses the whole code if it carries one, because an honest encoder never
 * writes one. There is no field for a candidate's type, so a relay or
 * server-reflexive candidate cannot be expressed at all: what the decoder can
 * be shown is an address, and a public one is refused.
 *
 * **TCP candidates are left out by the encoder**, decided here because #529's
 * review of spike 0011 asked for it to be decided rather than fallen into: a
 * desktop Chrome with camera access always adds a `tcptype active` candidate,
 * which listens on nothing and so can be dialled by nobody. Dropping it costs
 * no path. A decoder that refused every code with one in it would have refused
 * every such peer, which is the failure the review named.
 *
 * **An mDNS `.local` name is accepted**, and a code whose candidates are all
 * names is NOT refused here: spike 0011 found two desktop Chromes connect over
 * names alone, and an Android end cannot resolve one. Whether a path exists is
 * found out by ICE, and when it did not, `side-link.ts` §`TabletSideLink`
 * (its `#failure`) chooses `SIDE_PAIRING_END_TEXT['names-only']`, which says
 * it in words.
 *
 * ⚠️ **A refusal never repeats a value from the code** — ADR 0004 decision D's
 * rule, applied to an address on the rider's own network.
 */

import { addressSpaceOf } from './analysis-endpoint';
import type { SideCandidate, SidePeerParameters, SideSetup } from './side-link-sdp';

/** The prefix every code starts with, which is also its version. */
export const PAIRING_CODE_PREFIX = 'OYLSIDE1';

/**
 * The longest code this build reads: 1 KiB. An honest offer with four
 * candidates is about 250 characters; this bound is on what a hostile code can
 * make the decoder parse, not a tuning.
 */
export const MAXIMUM_PAIRING_CODE_LENGTH = 1024;

/**
 * The most candidates a code may carry. A phone or tablet on one network
 * gathers one or two (spike 0012 §1: one each); eight leaves room for a
 * device on two interfaces and still bounds the QR code's size.
 */
export const MAXIMUM_PAIRING_CANDIDATES = 8;

/** The one-time secret's length in bytes (D-4). */
export const PAIRING_SECRET_BYTES = 32;

/** Which of the two codes. */
export type PairingRole = 'offer' | 'answer';

/**
 * What a decoded code carries: an offer always has its one-time secret and an
 * answer never does. Two types rather than one with an optional secret, so
 * that a reader of an offer cannot be asked to handle a secret that
 * {@link readPairingCode} has already refused to be without (#550's review).
 */
export type PairingCode = OfferPairingCode | AnswerPairingCode;

/** An offer, as the phone reads it off the tablet. */
export interface OfferPairingCode {
  readonly role: 'offer';
  readonly parameters: SidePeerParameters;
  /** The one-time secret — D-4. */
  readonly secret: Uint8Array;
}

/** An answer, as the tablet reads it off the phone. */
export interface AnswerPairingCode {
  readonly role: 'answer';
  readonly parameters: SidePeerParameters;
  /** An answer carries none. */
  readonly secret: undefined;
}

/** What {@link readPairingCode} answers. */
export type PairingCodeRead<Code extends PairingCode = PairingCode> =
  { readonly code: Code } | { readonly refusal: PairingRefusal };

/** Why a scanned code was refused, or why a code could not be made. */
export type PairingRefusal =
  /** Not this app's code, or not this version of it. */
  | 'not-a-pairing-code'
  /** The other screen's code: the phone was shown an answer, or the tablet an offer. */
  | 'wrong-code'
  /** A field this build does not read, or a field out of its bounds. */
  | 'malformed'
  /** A candidate that is not on the rider's own network. */
  | 'not-local'
  /** Nothing left to connect to once every candidate the rule refuses was left out. */
  | 'no-candidate'
  /** The tablet's offer has already been answered, or its pairing is over (D-4: single use). */
  | 'used'
  /** This browser or WebView offers no way to make a direct link at all. */
  | 'unavailable';

/** What the rider is told, per refusal. Every one names what to do next. */
export const PAIRING_REFUSAL_TEXT: Readonly<Record<PairingRefusal, string>> = {
  'not-a-pairing-code':
    'That is not a side-camera pairing code from this app, or it is from a different version. ' +
    'Update both devices to the same version and try again.',
  'wrong-code':
    'That is the code from the other step. Point the camera at the code the other device is ' +
    'showing for this step.',
  malformed:
    'That pairing code could not be read correctly. Start pairing again on the tablet to get a ' +
    'fresh code.',
  'not-local':
    'That pairing code names an address that is not on your own network, so it was refused. ' +
    'Both devices must be on the same Wi-Fi.',
  'no-candidate':
    'This device has no address on a local network to offer, so it cannot be paired. Connect ' +
    'it to the same Wi-Fi as the other device and try again.',
  used:
    'That pairing has already been used. Press "Pair a phone" on the tablet to show a fresh code, ' +
    'and scan that one.',
  unavailable:
    'This browser cannot make a direct link to another device, so it cannot be paired. Use the ' +
    'On Your Left app, or a recent version of Chrome.',
};

/**
 * Whether D-4 lets a candidate cross: a UDP host candidate whose address
 * `analysis-endpoint.ts` §`addressSpaceOf` calls `local`, or an mDNS `.local`
 * name — and nothing else.
 *
 * ⚠️ **The address is bracketed before it is classified**, which D-4 requires
 * of #529 by name: an ICE candidate carries an IPv6 address without brackets,
 * and `addressSpaceOf` reads IPv6 only inside them, so a raw one would come
 * back `undefined` and every IPv6 candidate would be refused for the wrong
 * reason. `loopback` is not `local` and is refused; so are `localhost`,
 * `.home.arpa` and `.internal`, which `addressSpaceOf` admits for a typed
 * address and which are never ICE candidates.
 */
export function candidateAccepted(candidate: SideCandidate): boolean {
  if (candidate.transport !== 'udp' || candidate.type !== 'host') {
    return false;
  }
  if (!Number.isInteger(candidate.port) || candidate.port < 1 || candidate.port > 65_535) {
    return false;
  }
  return addressAccepted(candidate.address);
}

/** The address half of {@link candidateAccepted}. */
function addressAccepted(address: string): boolean {
  const lowered = address.toLowerCase();
  if (lowered.includes(':')) {
    // An IPv6 address: only hex digits, colons and at most one `%zone`, which
    // is dropped before classifying because a URL host never carries one.
    const [bare = '', ...zone] = lowered.split('%');
    if (zone.length > 1 || !/^[0-9a-f:]{2,39}$/.test(bare)) {
      return false;
    }
    return addressSpaceOf(`[${bare}]`) === 'local';
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(lowered)) {
    return addressSpaceOf(lowered) === 'local';
  }
  // A name. Only an mDNS name as a browser mints one: a label and `.local`.
  return /^[a-z0-9](?:[a-z0-9-]{0,62})\.local$/.test(lowered);
}

/**
 * The code one end shows, or the refusal when it has nothing to show.
 *
 * Every candidate {@link candidateAccepted} refuses is left out here, before
 * the code is built — D-4's *"the encoder omits"*.
 */
export function pairingCodeText(
  role: PairingRole,
  parameters: SidePeerParameters,
  secret?: Uint8Array,
): { readonly text: string } | { readonly refusal: PairingRefusal } {
  const candidates = parameters.candidates
    .filter(candidateAccepted)
    .slice(0, MAXIMUM_PAIRING_CANDIDATES);
  if (candidates.length === 0) {
    return { refusal: 'no-candidate' };
  }
  const body: Record<string, unknown> = {
    r: role === 'offer' ? 'o' : 'a',
    u: parameters.ufrag,
    p: parameters.password,
    f: base64Url(parameters.fingerprint),
    s: parameters.setup,
    c: candidates.map(candidateText),
  };
  if (role === 'offer') {
    if (secret?.length !== PAIRING_SECRET_BYTES) {
      throw new RangeError('an offer carries a one-time secret of the fixed length');
    }
    body['k'] = base64Url(secret);
  }
  return { text: `${PAIRING_CODE_PREFIX}${JSON.stringify(body)}` };
}

function candidateText(candidate: SideCandidate): string {
  const address = candidate.address.includes(':')
    ? `[${candidate.address.split('%')[0] ?? ''}]`
    : candidate.address;
  return `${address}:${String(candidate.port)}`;
}

/** The fields an offer may carry, and an answer. Anything else is refused. */
const OFFER_FIELDS: ReadonlySet<string> = new Set(['r', 'u', 'p', 'f', 's', 'c', 'k']);
const ANSWER_FIELDS: ReadonlySet<string> = new Set(['r', 'u', 'p', 'f', 's', 'c']);

/** RFC 8839 §5.4: `ice-char = ALPHA / DIGIT / "+" / "/"`, with its lengths. */
const UFRAG_PATTERN = /^[A-Za-z0-9+/]{4,256}$/;
const PASSWORD_PATTERN = /^[A-Za-z0-9+/]{22,256}$/;

/**
 * A scanned code, decoded and checked, or the refusal.
 *
 * `expected` is the code this screen is waiting for: the phone expects an
 * offer and the tablet an answer.
 */
export function readPairingCode(text: string, expected: 'offer'): PairingCodeRead<OfferPairingCode>;
export function readPairingCode(
  text: string,
  expected: 'answer',
): PairingCodeRead<AnswerPairingCode>;
export function readPairingCode(text: string, expected: PairingRole): PairingCodeRead;
export function readPairingCode(text: string, expected: PairingRole): PairingCodeRead {
  if (text.length > MAXIMUM_PAIRING_CODE_LENGTH || !text.startsWith(PAIRING_CODE_PREFIX)) {
    return { refusal: 'not-a-pairing-code' };
  }
  let body: unknown;
  try {
    body = JSON.parse(text.slice(PAIRING_CODE_PREFIX.length));
  } catch {
    return { refusal: 'not-a-pairing-code' };
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { refusal: 'not-a-pairing-code' };
  }
  const fields = body as Record<string, unknown>;
  const role = fields['r'] === 'o' ? 'offer' : fields['r'] === 'a' ? 'answer' : undefined;
  if (role === undefined) {
    return { refusal: 'malformed' };
  }
  if (role !== expected) {
    return { refusal: 'wrong-code' };
  }
  const allowed = role === 'offer' ? OFFER_FIELDS : ANSWER_FIELDS;
  if (Object.keys(fields).some((key) => !allowed.has(key))) {
    return { refusal: 'malformed' };
  }
  const { u: ufrag, p: password, f, s: setup, c, k } = fields;
  if (typeof ufrag !== 'string' || !UFRAG_PATTERN.test(ufrag)) {
    return { refusal: 'malformed' };
  }
  if (typeof password !== 'string' || !PASSWORD_PATTERN.test(password)) {
    return { refusal: 'malformed' };
  }
  const fingerprint = typeof f === 'string' ? fromBase64Url(f, 32) : undefined;
  if (fingerprint === undefined) {
    return { refusal: 'malformed' };
  }
  if (!setupFits(setup, role)) {
    return { refusal: 'malformed' };
  }
  if (!Array.isArray(c) || c.length > MAXIMUM_PAIRING_CANDIDATES) {
    return { refusal: 'malformed' };
  }
  if (c.length === 0) {
    // An honest encoder refuses to make this code at all.
    return { refusal: 'no-candidate' };
  }
  const candidates: SideCandidate[] = [];
  for (const entry of c) {
    const candidate = typeof entry === 'string' ? candidateFromText(entry) : undefined;
    if (candidate === undefined) {
      return { refusal: 'malformed' };
    }
    if (!candidateAccepted(candidate)) {
      return { refusal: 'not-local' };
    }
    candidates.push(candidate);
  }
  const parameters = { ufrag, password, fingerprint, setup, candidates };
  if (role === 'answer') {
    return { code: { role, parameters, secret: undefined } };
  }
  // Decoded last, so that the one place an offer's secret is checked is also
  // the place its type is narrowed — #550's review found a second check of it
  // downstream that could never fire.
  const secret = typeof k === 'string' ? fromBase64Url(k, PAIRING_SECRET_BYTES) : undefined;
  return secret === undefined ? { refusal: 'malformed' } : { code: { role, parameters, secret } };
}

function setupFits(setup: unknown, role: PairingRole): setup is SideSetup {
  return role === 'offer' ? setup === 'actpass' : setup === 'active' || setup === 'passive';
}

/** `address:port`, an IPv6 address in brackets, as {@link candidateText} writes it. */
function candidateFromText(text: string): SideCandidate | undefined {
  const match = /^(?:\[([0-9A-Fa-f:]+)\]|([^\s:[\]]+)):(\d{1,5})$/.exec(text);
  if (match === null) {
    return undefined;
  }
  const address = match[1] ?? match[2];
  const port = Number(match[3]);
  if (address === undefined) {
    return undefined;
  }
  return { address, port, transport: 'udp', type: 'host' };
}

/**
 * RFC 4648 §5's URL-safe base64, unpadded — how a code writes its fingerprint
 * and its secret, and how the tablet and the phone both spell the secret they
 * compare (`side-link.ts`). One copy, because two that drifted would fail every
 * pairing (#550's review).
 */
export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64Url(text: string, length: number): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) {
    return undefined;
  }
  let binary: string;
  try {
    binary = atob(text.replaceAll('-', '+').replaceAll('_', '/'));
  } catch {
    return undefined;
  }
  if (binary.length !== length) {
    return undefined;
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
