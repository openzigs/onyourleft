// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A room code** (#784): what a rider shares so friends can join their room.
 *
 * ## A bearer secret, and what follows from that
 *
 * Whoever holds a room's code may join it — ADR 0028 D-6.3: *"a race among
 * people who already know each other — a shared room code — needs nothing
 * more"*. So a code is treated as a credential, like a session token:
 *
 * - **{@link ROOM_CODE_BITS} bits of entropy** (75), from the platform's
 *   CSPRNG — #784 asks for at least 64. Fifteen symbols of Crockford's
 *   base-32 alphabet, each exactly five bits (32 divides 256, so a byte's
 *   low five bits are uniform and no symbol is likelier than another).
 * - **Stored as its SHA-256 and never as itself** (migration 0013), so a copy
 *   of the database lets nobody in. It is looked up by that digest through a
 *   unique index: the comparison is between digests, so how long a lookup
 *   takes says nothing about how much of a guess was right — the property a
 *   constant-time comparison buys, without one to get wrong.
 * - **Never logged, never in a URL.** It travels in a POST body (the request
 *   log names the route PATTERN, never a body or a path value — `log.ts`), an
 *   error about it names the field and never its value, and `rooms.test.ts`
 *   reads every log line a create and a join write for it.
 * - **Joining by code is rate-limited** per athlete and per address
 *   (`rooms.ts` §`DEFAULT_ROOM_LIMITS`): at 75 bits, a guesser allowed ten a
 *   quarter of an hour needs about 10¹⁶ years for an even chance at one room.
 *
 * ## Typed by a person
 *
 * Crockford's alphabet has no I, L, O or U, and {@link normaliseRoomCode}
 * reads the letters a person confuses with digits as the digits (`O` as `0`,
 * `I` and `L` as `1`), any case, with spaces and hyphens ignored. It is shown
 * in three groups of five ({@link displayRoomCode}).
 */

import { sha256Hex } from '../auth/crypto.ts';

/** Crockford's base 32: no I, L, O or U. */
export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Symbols in a code. */
export const ROOM_CODE_LENGTH = 15;

/** The entropy of one code: five bits a symbol. #784 asks for at least 64. */
export const ROOM_CODE_BITS = ROOM_CODE_LENGTH * Math.log2(ROOM_CODE_ALPHABET.length);

/** A new code, canonical (no separators), from `random`'s bytes — the CSPRNG in production. */
export function newRoomCode(
  random: (count: number) => Uint8Array = (count) => crypto.getRandomValues(new Uint8Array(count)),
): string {
  const bytes = random(ROOM_CODE_LENGTH);
  if (bytes.length !== ROOM_CODE_LENGTH) throw new RangeError('not enough random bytes');
  let code = '';
  for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte & 0b11111];
  return code;
}

/** A code as a person reads it: three groups of five. */
export function displayRoomCode(code: string): string {
  return code.match(/.{1,5}/g)?.join('-') ?? code;
}

/**
 * What a person typed, as a canonical code — or `undefined` when it cannot be
 * one. Case, spaces and hyphens are ignored; `O` is read as `0`, `I` and `L`
 * as `1`.
 */
export function normaliseRoomCode(typed: unknown): string | undefined {
  if (typeof typed !== 'string' || typed.length > 64) return undefined;
  const code = typed.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (code.length !== ROOM_CODE_LENGTH) return undefined;
  for (const symbol of code) if (!ROOM_CODE_ALPHABET.includes(symbol)) return undefined;
  return code;
}

/** What is stored and looked up in place of the code (migration 0013). */
export function roomCodeDigest(code: string): Promise<string> {
  return sha256Hex(code);
}
