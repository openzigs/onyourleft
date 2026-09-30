// SPDX-License-Identifier: Apache-2.0

/**
 * A seeded fuzz over the decoder — #768, on `packages/fit/tools/fuzz/`'s
 * precedent.
 *
 * ## What it asserts
 *
 * For every input: the decoder **returns** — it never throws — and what it
 * returns is either a refusal with a reason in `REFUSAL_REASONS`, or a message
 * that re-encodes to text the same decoder accepts as the same message. So an
 * accepted input is a real message, not merely a non-throw.
 *
 * ## What it feeds
 *
 * Mutations of every valid message — a character replaced, inserted, deleted,
 * a span duplicated, the text truncated, a number swapped for an extreme, a
 * bracket run spliced in — plus random printable and random unicode strings.
 * Seeded, so a failure names its seed and case and reproduces.
 *
 * Budget: {@link CASES} cases, well under the five seconds #768 allows. The
 * case carries its own timeout for the reason `packages/fit`'s fuzz does:
 * under `test:coverage`, beside every other file on a two-core runner, the
 * same work takes several times as long as it does alone, and 25 000 cases
 * passed Vitest's 5 s default alone (1.1 s) and failed it there. The timeout is
 * a stop on a wedged loop, not the budget; the budget is the case count.
 */

import { describe, expect, it } from 'vitest';

import {
  decodeClientMessage,
  decodeRoomMessage,
  encodeMessage,
  REFUSAL_REASONS,
  type Decoded,
} from './codec';
import type { ProtocolMessage } from './messages';

const SEED = 0x0768_2026;
const CASES = 10_000;
const PHYSICS = { physicsVersion: 1 };

function random(seed: number): { below(limit: number): number } {
  let state = seed >>> 0;
  const u32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };
  return { below: (limit) => (limit > 0 ? u32() % limit : 0) };
}

const SEEDS: readonly string[] = (
  [
    { type: 'hello', protocol: 1, physicsVersion: 1, ticket: 'abc.DEF-123' },
    { type: 'report', sequence: 7, atMs: 1_727_600_000_000, powerWatts: 250.5, cadenceRpm: 88 },
    {
      type: 'welcome',
      riderId: 2,
      routeRef: { sha256: '0123456789abcdef'.repeat(4) },
      roomConfig: {
        kind: 'ride',
        ridingPosition: 'drops',
        reportIntervalMs: 500,
        frameIntervalMs: 1000,
      },
    },
    { type: 'refuse', reason: 'room-full' },
    {
      type: 'frame',
      tick: 12,
      ackSequence: 23,
      riders: [
        { riderId: 1, decimetres: 1200, centimetresPerSecond: 950, draftPercent: 0, flags: 0 },
        { riderId: 2, decimetres: 1190, centimetresPerSecond: 960, draftPercent: 25, flags: 2 },
      ],
    },
    { type: 'countdown', startsInMs: 9_000 },
    { type: 'finish', order: [2, 1] },
  ] satisfies ProtocolMessage[]
)
  .map((message) => encodeMessage(message))
  // And JSON that is not a message at all, so the not-an-object path is fed
  // directly rather than only by the odd mutation that happens to reach it.
  .concat(['[{"type":"report"}]', '"hello"', '1e3', 'null']);

const EXTREMES = [
  '1e309',
  '-1',
  '0.5',
  'NaN',
  '9007199254740993',
  '"x"',
  'null',
  'true',
  '[]',
  '{}',
  '-0',
];

function mutate(text: string, rng: { below(limit: number): number }): string {
  const at = rng.below(text.length + 1);
  switch (rng.below(9)) {
    case 0:
      return text.slice(0, at) + String.fromCharCode(32 + rng.below(95)) + text.slice(at + 1);
    case 1:
      return text.slice(0, at) + String.fromCharCode(rng.below(0x10000)) + text.slice(at);
    case 2:
      return text.slice(0, at) + text.slice(at + 1 + rng.below(8));
    case 3: {
      const end = Math.min(text.length, at + rng.below(40));
      return text.slice(0, end) + text.slice(at, end) + text.slice(end);
    }
    case 4:
      return text.slice(0, at);
    case 5:
      return text.replace(/-?\d+(\.\d+)?/, EXTREMES[rng.below(EXTREMES.length)] ?? '0');
    case 6:
      return text.slice(0, at) + '['.repeat(1 + rng.below(6)) + text.slice(at);
    case 7:
      return text.slice(0, at) + 'x'.repeat(rng.below(9000)) + text.slice(at);
    default:
      return text.replace(
        /"[a-zA-Z]+":/,
        `"${['lat', '__proto__', 'type', 'constructor', ''][rng.below(5)] ?? ''}":`,
      );
  }
}

function randomText(rng: { below(limit: number): number }): string {
  const length = rng.below(200);
  let out = '';
  const unicode = rng.below(2) === 0;
  for (let index = 0; index < length; index += 1) {
    out += String.fromCharCode(unicode ? rng.below(0x10000) : 32 + rng.below(95));
  }
  return out;
}

function holds(decoded: Decoded<ProtocolMessage>, text: string): void {
  if (!decoded.ok) {
    if (!REFUSAL_REASONS.includes(decoded.refusal.reason)) {
      throw new Error(`unknown refusal ${decoded.refusal.reason} for ${JSON.stringify(text)}`);
    }
    return;
  }
  const again = encodeMessage(decoded.message);
  const round =
    decoded.message.type === 'hello' || decoded.message.type === 'report'
      ? decodeClientMessage(again, PHYSICS)
      : decodeRoomMessage(again);
  expect(round).toEqual(decoded);
}

describe('the decoder under a seeded fuzz — #768', () => {
  it(`returns a refusal or a real message for ${String(CASES)} inputs, and never throws`, () => {
    const rng = random(SEED);
    const reasons = new Set<string>();
    let accepted = 0;
    for (let index = 0; index < CASES; index += 1) {
      let text = rng.below(10) === 0 ? randomText(rng) : (SEEDS[rng.below(SEEDS.length)] ?? '');
      for (let round = rng.below(3); round >= 0; round -= 1) {
        text = mutate(text, rng);
      }
      let client: Decoded<ProtocolMessage>;
      let room: Decoded<ProtocolMessage>;
      try {
        client = decodeClientMessage(text, PHYSICS);
        room = decodeRoomMessage(text);
      } catch (error) {
        throw new Error(
          `seed ${String(SEED)} case ${String(index)} threw on ${JSON.stringify(text)}: ${String(error)}`,
          { cause: error },
        );
      }
      holds(client, text);
      holds(room, text);
      for (const decoded of [client, room]) {
        if (decoded.ok) {
          accepted += 1;
        } else {
          reasons.add(decoded.refusal.reason);
        }
      }
    }
    // Non-vacuity: the corpus reaches acceptance AND most of the refusals, so
    // a decoder that refused everything, or accepted everything, is a red run.
    expect(accepted).toBeGreaterThan(CASES / 100);
    expect([...reasons]).toEqual(
      expect.arrayContaining([
        'too-large',
        'too-deep',
        'not-json',
        'not-an-object',
        'unknown-type',
        'unknown-key',
        'bad-value',
      ]),
    );
  }, 30_000);
});
