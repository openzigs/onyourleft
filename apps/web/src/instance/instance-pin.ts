// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **This device's pin on its instance's identity key** — #1190, ADR 0047 D-5,
 * D-6, D-14 Q1, Q6 and Q8.
 *
 * - **A pin comes only from an instance card** scanned or pasted inside the
 *   app (D-6). `oyl-instance:` is a label inside that string and NOT a URL
 *   scheme this app registers (`no-url-handler.test.ts`): any app may claim a
 *   scheme, and nothing the operating system hands the app is a card.
 * - **No card, no sealed route** (D-14 Q1): a device that signed in with only
 *   an address may sign in as today and holds no pin; {@link sealedRouteGate}
 *   is the gate every phase-1 feature asks (#1192 puts it on each screen),
 *   and — first — whether this copy of the app may seal at all (D-11,
 *   {@link sealedBuildOffered}).
 * - **Never a silent re-pin.** A served identity that is not the pin is
 *   refused; a verified endorsement from the pinned key stops sealing and asks
 *   for a card; only the rider confirming a card replaces the pin.
 * - **The card a device shows** — on its link-code screen and in an invite —
 *   is {@link cardFromPin}: composed from ITS OWN stored pin, never taken from
 *   anything an instance answered (D-6 sources 2 and 3).
 *
 * The judgement itself is `@onyourleft/domain`'s (`judgeInstanceKeys`); this
 * module reads `/v1/instance/keys`, re-reads it once before an expired or
 * older-key refusal (D-5), and says each outcome in the rider's words.
 *
 * ⚠️ **Every sentence here is DRAFT wording for the owner to approve in this
 * pull request** (D-14 Q6, #880's convention).
 */

import {
  base32UnpaddedDecode,
  INSTANCE_CARD_PREFIX,
  judgeInstanceKeys,
  NO_KEY_TRUST,
  parseInstanceCard,
  fromHex,
  type InstanceKeyStatement,
  type InstanceKeysVerdict,
  type InstanceKeyTrust,
  type SealedInstanceKey,
  type Sha256,
  type SignatureVerifier,
} from '@onyourleft/domain';

import type { InstanceAccount } from './sign-in';

/** What a rider is told about the instance's keys. Draft wording (D-14 Q6). */
export const INSTANCE_KEY_TEXT = {
  /** D-6's mismatch refusal. */
  mismatch:
    'This instance’s key is not the one on the card you were given. Nothing was sent. Check that ' +
    'the card is for this instance, and get a new one from its operator if it is.',
  /** D-14 Q1's notice, wherever a feature that needs the card would be. */
  'needs-card':
    'This needs the instance’s card. Get it from the instance’s operator, or from the Instance ' +
    'screen of another of your devices that has it (Add another device), and paste it below.',
  /** D-5 / D-14 Q8: a planned rotation was endorsed; the app stops sealing until a new card. */
  'needs-new-card':
    'Your instance has a new key. Nothing more will be sent to it until you scan its new card: ' +
    'ask its operator for the card, and check that its whole fingerprint is the same as the one below.',
  /** D-5's expired refusal. */
  expired:
    'Your instance’s keys have expired. It may have been off for a while; it renews them when it ' +
    'starts. If it is running, check this phone’s date and time, and ask its operator to restart ' +
    'it and to check its clock.',
  /** D-6: the confirm-new-card notice, shown with the old and new fingerprints. */
  'confirm-new-card':
    'This card has a different key from the one this device has. Only confirm if the instance’s ' +
    'operator told you its key changed. Compare both fingerprints with what they gave you.',
  /** A card for another instance than this account's. */
  'other-origin': 'That card is for a different instance from the one this device is connected to.',
  /** Not a card, or a damaged one. */
  'not-a-card':
    'That is not an instance card. A card starts oyl-instance: and ends with 52 letters and ' +
    'digits; paste the whole of it.',
  /** A card whose fingerprint is not the endorsed one. */
  'not-the-endorsed-card':
    'That card does not carry the new key your instance announced. Nothing was changed. Ask its ' +
    'operator for the card made after the key changed.',
  /** The keys could not be read at all. */
  unreachable: 'The instance did not answer, so its keys could not be checked. Nothing was sent.',
} as const;

/** D-5's older-key refusal, naming the serial this device holds. Never the phone's clock. */
export function olderKeyText(highestSerial: number): string {
  return (
    'Your instance offered an older key than it has used before. Nothing was sent. If its ' +
    `operator restored a backup, they can fix this with the number ${String(highestSerial)}.`
  );
}

/** The card this device shows for its instance, from its OWN pin — or `undefined` with none. */
export function cardFromPin(account: InstanceAccount | undefined): string | undefined {
  if (account?.pin === undefined || base32UnpaddedDecode(account.pin, 32) === undefined) {
    return undefined;
  }
  return `${INSTANCE_CARD_PREFIX}${account.origin}#${account.pin}`;
}

/**
 * Where this copy of the app was loaded from (#1192, ADR 0047 D-11): whether
 * it runs inside the Android shell, and the page's own address. `main.tsx`
 * reads it once, from `location.href` and `support/capacitor.ts`.
 */
export interface LoadedFrom {
  readonly native: boolean;
  readonly href: string;
}

/**
 * D-11's web-build notice, wherever a phase-1 feature would be. ⚠️ **Draft
 * wording for the owner to approve in #1192's pull request** (D-14 Q6).
 */
export const WEB_BUILD_TEXT =
  'Encrypted features are not offered in a copy of the app loaded from a website, because ' +
  'whoever serves a website’s code could change it to take the encryption out. Use the Android ' +
  'app, or a copy of the app saved on this device.';

/** A loopback host, as the URL parser spells one. */
function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    /^127\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/.test(hostname)
  );
}

/**
 * D-11: sealed features are offered only in the Android app, and in a web
 * build loaded from a loopback address or from a file the rider installed. A
 * build loaded over `https:` from any other host — the instance's own origin
 * included — offers none of them, because the edge that served its code could
 * have served other code. Anything that cannot be read as an address is a
 * website, so it is refused rather than guessed at.
 */
export function sealedBuildOffered(from: LoadedFrom): boolean {
  if (from.native) return true;
  let url: URL;
  try {
    url = new URL(from.href);
  } catch {
    return false;
  }
  if (url.protocol === 'file:') return true;
  return (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHost(url.hostname);
}

/** Whether a phase-1 (sealed) feature may be used on this device now (D-11, D-14 Q1, Q8). */
export type SealedRouteGate =
  | { readonly kind: 'open'; readonly pin: string }
  | { readonly kind: 'web-build'; readonly text: string }
  | { readonly kind: 'needs-card'; readonly text: string }
  | { readonly kind: 'needs-new-card'; readonly text: string; readonly expected: string };

/**
 * The gate: a build loaded from a website, no sealed route (D-11); no pin, no
 * sealed route; an endorsed rotation waiting, no sealed route.
 */
export function sealedRouteGate(
  account: InstanceAccount | undefined,
  from: LoadedFrom,
): SealedRouteGate {
  if (!sealedBuildOffered(from)) return { kind: 'web-build', text: WEB_BUILD_TEXT };
  if (account?.pin === undefined) {
    return { kind: 'needs-card', text: INSTANCE_KEY_TEXT['needs-card'] };
  }
  if (account.expectedFingerprint !== undefined) {
    return {
      kind: 'needs-new-card',
      text: INSTANCE_KEY_TEXT['needs-new-card'],
      expected: account.expectedFingerprint,
    };
  }
  return { kind: 'open', pin: account.pin };
}

/** A fingerprint as a rider compares it: the 52 characters in groups of four. */
export function groupedFingerprint(fingerprint: string): string {
  return fingerprint.match(/.{1,4}/g)?.join(' ') ?? fingerprint;
}

/** How a card's refusal reads. */
export function cardRefusalText(problem: 'not-a-card' | 'other-origin' | 'fingerprint'): string {
  return problem === 'other-origin'
    ? INSTANCE_KEY_TEXT['other-origin']
    : INSTANCE_KEY_TEXT['not-a-card'];
}

/** What the crypto and the clock are, handed in. */
export interface PinCrypto {
  readonly sha256: Sha256;
  readonly verifier: SignatureVerifier;
  /** Unix milliseconds. */
  readonly now: () => number;
}

/** Reads `GET /v1/instance/keys`: the parsed body, or `undefined` when nothing usable answered. */
export type ServedKeysReader = () => Promise<unknown>;

/**
 * Judge the instance's keys for `pin`, re-reading once before an expired or
 * older-key verdict is final (D-5) — a device that has been away sees the
 * statement the instance renewed meanwhile.
 */
export async function judgeWithReread(
  read: ServedKeysReader,
  origin: string,
  pin: string,
  trust: InstanceKeyTrust,
  crypto: PinCrypto,
): Promise<InstanceKeysVerdict | 'unreachable'> {
  const pinBytes = base32UnpaddedDecode(pin, 32);
  if (pinBytes === undefined) return { kind: 'mismatch' };
  let remembered = trust;
  let verdict: InstanceKeysVerdict | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const served = await read();
    if (served === undefined) return 'unreachable';
    verdict = await judgeInstanceKeys({
      served,
      origin,
      pin: pinBytes,
      trust: remembered,
      now: Math.floor(crypto.now() / 1000),
      sha256: crypto.sha256,
      verifier: crypto.verifier,
    });
    if (verdict.kind !== 'expired' && verdict.kind !== 'older') return verdict;
    remembered = verdict.trust;
  }
  return verdict ?? 'unreachable';
}

/** A link code or an invite code, as `apps/instance` mints them: four groups of four. */
const CODE_PATTERN = /^[a-z2-9]{4}(?:-[a-z2-9]{4}){3}$/;

/**
 * A code and the card together, as one line and one QR code (D-6 sources 2
 * and 3): `<card> <code>`. The card is `card`, which the caller composed with
 * {@link cardFromPin} — never one an instance answered.
 */
export function codeWithCard(card: string, code: string): string {
  return `${card} ${code}`;
}

/** A line {@link codeWithCard} wrote, read back: the card's text and the code — or `undefined`. */
export function readCodeWithCard(
  text: string,
): { readonly card: string; readonly code: string } | undefined {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 2) return undefined;
  const [card, code] = parts as [string, string];
  const lower = code.toLowerCase();
  if (!card.startsWith(INSTANCE_CARD_PREFIX) || !CODE_PATTERN.test(lower)) return undefined;
  return { card, code: lower };
}

/** A card read and checked against the instance's served keys, before anything is kept. */
export type CardCheck =
  | {
      readonly kind: 'verified';
      readonly fingerprint: string;
      readonly keyTrust: InstanceKeyTrust;
      /**
       * The encryption key a sealed request goes to (#1192): present only when
       * the served keys are TRUSTED under the card, not merely signed by it —
       * an expired or older statement pins the identity and seals nothing.
       */
      readonly instanceKey?: SealedInstanceKey;
      /** What to say when there is no {@link instanceKey}. */
      readonly sealingText?: string;
    }
  | { readonly kind: 'refused'; readonly text: string };

/** The key a trusted statement names, as a sealed request takes it (#1192). */
export function sealedKeyOf(statement: InstanceKeyStatement): SealedInstanceKey {
  return {
    keyId: statement.keyId,
    publicKey: fromHex(statement.encryptionKey, 'the instance’s encryption key', 32),
  };
}

/**
 * Read `cardText` for `origin` and check the instance at `origin` serves keys
 * signed by the identity key it names (D-6). Nothing is kept here: the caller
 * keeps the pin only on `verified`.
 */
export async function checkCard(
  cardText: string,
  origin: string,
  read: ServedKeysReader,
  crypto: PinCrypto,
  trust: InstanceKeyTrust = NO_KEY_TRUST,
): Promise<CardCheck> {
  const parsed = parseInstanceCard(cardText, origin);
  if (!parsed.ok) return { kind: 'refused', text: cardRefusalText(parsed.problem) };
  const verdict = await judgeWithReread(read, origin, parsed.card.fingerprintText, trust, crypto);
  if (verdict === 'unreachable') return { kind: 'refused', text: INSTANCE_KEY_TEXT.unreachable };
  if (verdict.kind === 'mismatch' || verdict.kind === 'new-card') {
    return { kind: 'refused', text: INSTANCE_KEY_TEXT.mismatch };
  }
  // The identity is the card's. Expired or older statements are a sealing
  // problem, not a reason to refuse the card: the pin is the identity key.
  return {
    kind: 'verified',
    fingerprint: parsed.card.fingerprintText,
    keyTrust: verdict.trust,
    ...(verdict.kind === 'trusted'
      ? { instanceKey: sealedKeyOf(verdict.statement) }
      : {
          sealingText:
            verdict.kind === 'older'
              ? olderKeyText(verdict.highestSerial)
              : INSTANCE_KEY_TEXT.expired,
        }),
  };
}
