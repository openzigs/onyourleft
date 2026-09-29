// SPDX-License-Identifier: Apache-2.0

/**
 * The encoder and the decoder — #768's round-trip and refusal criteria.
 *
 * Every refusal is tested against a message that is otherwise valid, so the
 * reason asserted is the one check that fired and removing that check turns
 * exactly its case red.
 */

import { describe, expect, it } from 'vitest';

import {
  decodeClientMessage,
  decodeRoomMessage,
  encodeMessage,
  ProtocolEncodeError,
  REFUSAL_REASONS,
  utf8ByteLength,
  type Decoded,
  type RefusalReason,
} from './codec';
import {
  FLAG_COASTING,
  FLAG_PLAUSIBILITY,
  FRAME_INTERVAL_MS,
  PROTOCOL_VERSION,
  REPORT_INTERVAL_MS,
  type ProtocolMessage,
  type Report,
} from './messages';
import {
  MAXIMUM_MESSAGE_BYTES,
  MAXIMUM_NESTING_DEPTH,
  MAXIMUM_REPORTED_POWER_WATTS,
  MAXIMUM_RIDERS,
} from './schema';

const PHYSICS = { physicsVersion: 1 };
const SHA = 'a'.repeat(64);

/** One of every message, with every optional field present, and the same without. */
const MESSAGES: readonly ProtocolMessage[] = [
  { type: 'hello', protocol: PROTOCOL_VERSION, physicsVersion: 1, ticket: 'room-7.ticket_ABC' },
  { type: 'report', sequence: 0, atMs: 0, powerWatts: 0 },
  { type: 'report', sequence: 41, atMs: 1_727_600_000_000, powerWatts: 312.5, cadenceRpm: 91 },
  {
    type: 'welcome',
    riderId: 3,
    routeRef: { sha256: SHA },
    roomConfig: {
      kind: 'race',
      ridingPosition: 'hoods',
      reportIntervalMs: REPORT_INTERVAL_MS,
      frameIntervalMs: FRAME_INTERVAL_MS,
    },
  },
  { type: 'refuse', reason: 'physics-mismatch' },
  { type: 'frame', tick: 0, riders: [] },
  {
    type: 'frame',
    tick: 1_200,
    ackSequence: 2_399,
    riders: [
      { riderId: 3, decimetres: 184_223, centimetresPerSecond: 1_104, draftPercent: 0, flags: 0 },
      {
        riderId: 9,
        decimetres: 183_950,
        centimetresPerSecond: 998,
        draftPercent: 27,
        flags: FLAG_PLAUSIBILITY | FLAG_COASTING,
      },
    ],
  },
  { type: 'finish', order: [9, 3, 12] },
];

function decodeAny(text: string): Decoded<ProtocolMessage> {
  const asClient = decodeClientMessage(text, PHYSICS);
  if (asClient.ok || asClient.refusal.reason !== 'unknown-type') {
    return asClient;
  }
  return decodeRoomMessage(text);
}

function refusalOf(decoded: Decoded<unknown>): RefusalReason | 'accepted' {
  return decoded.ok ? 'accepted' : decoded.refusal.reason;
}

describe('decode(encode(m)) ≡ m', () => {
  it.each(MESSAGES.map((message) => [message.type, message] as const))(
    'round-trips a %s',
    (_, message) => {
      expect(decodeAny(encodeMessage(message))).toEqual({ ok: true, message });
    },
  );

  it('covers every message type', () => {
    expect(new Set(MESSAGES.map((message) => message.type))).toEqual(
      new Set(['hello', 'report', 'welcome', 'refuse', 'frame', 'finish']),
    );
  });

  it('writes nothing a caller hung on the object', () => {
    const report = { type: 'report', sequence: 1, atMs: 1, powerWatts: 1, latitude: 51.5 };
    const text = encodeMessage(report as Report);
    expect(text).not.toContain('latitude');
  });
});

describe('the numeric edge cases of a report, property-style', () => {
  const report = (overrides: Record<string, unknown>): string =>
    JSON.stringify({ type: 'report', sequence: 1, atMs: 1, powerWatts: 200, ...overrides });

  it('round-trips every power in [0, 2500] it is handed, whole or not', () => {
    for (let step = 0; step <= 1_000; step += 1) {
      const powerWatts = (step / 1_000) * MAXIMUM_REPORTED_POWER_WATTS;
      const message: Report = { type: 'report', sequence: step, atMs: step, powerWatts };
      expect(decodeClientMessage(encodeMessage(message), PHYSICS)).toEqual({ ok: true, message });
    }
  });

  it.each([
    ['NaN power, which JSON writes as null', { powerWatts: null }],
    ['a negative power', { powerWatts: -0.5 }],
    ['a power just over 2500 W', { powerWatts: MAXIMUM_REPORTED_POWER_WATTS + 0.001 }],
    ['a power as a string', { powerWatts: '200' }],
    ['a non-integer sequence', { sequence: 1.5 }],
    ['a negative sequence', { sequence: -1 }],
    ['a sequence past the safe integers', { sequence: 2 ** 53 }],
    ['a non-integer time', { atMs: 10.25 }],
    ['a cadence over 255', { cadenceRpm: 256 }],
  ])('refuses %s', (_, overrides) => {
    expect(refusalOf(decodeClientMessage(report(overrides), PHYSICS))).toBe('bad-value');
  });

  it('refuses to encode NaN, a negative power or a non-integer sequence, rather than sending it', () => {
    for (const bad of [
      { powerWatts: Number.NaN },
      { powerWatts: -1 },
      { powerWatts: 2_501 },
      { sequence: 0.5 },
    ]) {
      const message = { type: 'report', sequence: 1, atMs: 1, powerWatts: 1, ...bad } as Report;
      expect(() => encodeMessage(message)).toThrow(ProtocolEncodeError);
    }
  });

  it('reads -0 as 0, so a decoded message is the one its own encoding decodes to', () => {
    const decoded = decodeClientMessage(report({ powerWatts: -0 }), PHYSICS);
    expect(
      decoded.ok && Object.is(decoded.message.type === 'report' && decoded.message.powerWatts, 0),
    ).toBe(true);
  });
});

describe('what the decoder refuses — one check, one reason', () => {
  const hello = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({ type: 'hello', protocol: 1, physicsVersion: 1, ticket: 't', ...overrides });

  it('accepts the unaltered message each case below alters', () => {
    expect(refusalOf(decodeClientMessage(hello(), PHYSICS))).toBe('accepted');
  });

  it('refuses a message over the byte limit before parsing it', () => {
    // Not JSON at all: were it parsed, this would be `not-json`.
    const over = `{${'x'.repeat(MAXIMUM_MESSAGE_BYTES)}`;
    expect(refusalOf(decodeClientMessage(over, PHYSICS))).toBe('too-large');
    // Counted in UTF-8, not in string length: 2 731 × "€" is 8 193 bytes in
    // 2 731 characters.
    const euros = hello({ ticket: '€'.repeat(Math.ceil(MAXIMUM_MESSAGE_BYTES / 3)) });
    expect(euros.length).toBeLessThan(MAXIMUM_MESSAGE_BYTES);
    expect(refusalOf(decodeClientMessage(euros, PHYSICS))).toBe('too-large');
  });

  it('refuses nesting past the bound before parsing it', () => {
    // Unbalanced, so a parse would say `not-json`; the scan says too deep first.
    const deep = '['.repeat(MAXIMUM_NESTING_DEPTH + 1);
    expect(refusalOf(decodeClientMessage(deep, PHYSICS))).toBe('too-deep');
    // Brackets inside a string are not nesting.
    expect(refusalOf(decodeClientMessage(hello({ ticket: '[[[[[{{{{' }), PHYSICS))).toBe(
      'accepted',
    );
    // A legal frame nests exactly to the bound.
    const frame = encodeMessage({
      type: 'frame',
      tick: 1,
      riders: [{ riderId: 1, decimetres: 1, centimetresPerSecond: 1, draftPercent: 0, flags: 0 }],
    });
    expect(refusalOf(decodeRoomMessage(frame))).toBe('accepted');
  });

  it('refuses something that is not text at all, from a caller that ignored the types', () => {
    const binary = new Uint8Array([123, 125]) as unknown as string;
    expect(refusalOf(decodeClientMessage(binary, PHYSICS))).toBe('not-json');
  });

  it('refuses text that is not JSON, and JSON that is not an object', () => {
    expect(refusalOf(decodeClientMessage('{"type":', PHYSICS))).toBe('not-json');
    expect(refusalOf(decodeClientMessage('["hello"]', PHYSICS))).toBe('not-an-object');
    expect(refusalOf(decodeClientMessage('null', PHYSICS))).toBe('not-an-object');
  });

  it('refuses an unknown type, and a type from the other direction', () => {
    expect(refusalOf(decodeClientMessage(hello({ type: 'teleport' }), PHYSICS))).toBe(
      'unknown-type',
    );
    expect(refusalOf(decodeClientMessage('{}', PHYSICS))).toBe('unknown-type');
    // A client sending the room's own frame is not a message a room receives.
    const frame = encodeMessage({ type: 'frame', tick: 1, riders: [] });
    expect(refusalOf(decodeClientMessage(frame, PHYSICS))).toBe('unknown-type');
    expect(refusalOf(decodeRoomMessage(hello()))).toBe('unknown-type');
  });

  it('refuses another protocol version, read before anything else in the hello', () => {
    expect(refusalOf(decodeClientMessage(hello({ protocol: 2 }), PHYSICS))).toBe(
      'protocol-mismatch',
    );
    // A newer client's hello with a field this build has never heard of is a
    // version mismatch, not an unknown key.
    expect(
      refusalOf(decodeClientMessage(hello({ protocol: 2, somethingNew: true }), PHYSICS)),
    ).toBe('protocol-mismatch');
  });

  it('refuses another physics version — ADR 0028 D-2 rule 5', () => {
    expect(refusalOf(decodeClientMessage(hello({ physicsVersion: 2 }), PHYSICS))).toBe(
      'physics-mismatch',
    );
    expect(refusalOf(decodeClientMessage(hello(), { physicsVersion: 2 }))).toBe('physics-mismatch');
  });

  it('refuses an unknown key, at the top and nested', () => {
    expect(refusalOf(decodeClientMessage(hello({ extra: 1 }), PHYSICS))).toBe('unknown-key');
    expect(refusalOf(decodeClientMessage(hello({ __proto__: 1 }), PHYSICS))).toBe('accepted');
    // A literal "__proto__" key in the TEXT is an own key after JSON.parse.
    expect(
      refusalOf(
        decodeClientMessage(
          '{"type":"hello","protocol":1,"physicsVersion":1,"ticket":"t","__proto__":{}}',
          PHYSICS,
        ),
      ),
    ).toBe('unknown-key');
    const welcome = JSON.parse(encodeMessage(MESSAGES[3] as ProtocolMessage)) as {
      routeRef: Record<string, unknown>;
    };
    welcome.routeRef['geometry'] = 'nope';
    expect(refusalOf(decodeRoomMessage(JSON.stringify(welcome)))).toBe('unknown-key');
  });

  it('refuses a missing required key', () => {
    const noTicket = JSON.stringify({ type: 'hello', protocol: 1, physicsVersion: 1 });
    expect(refusalOf(decodeClientMessage(noTicket, PHYSICS))).toBe('missing-key');
  });

  it('refuses a list over its bound, and accepts one at it', () => {
    const row = (id: number) => [id, 1, 1, 0, 0];
    const frame = (count: number) =>
      JSON.stringify({
        type: 'frame',
        tick: 1,
        riders: Array.from({ length: count }, (_, i) => row(i)),
      });
    expect(refusalOf(decodeRoomMessage(frame(MAXIMUM_RIDERS)))).toBe('accepted');
    expect(refusalOf(decodeRoomMessage(frame(MAXIMUM_RIDERS + 1)))).toBe('too-long');
    const order = (count: number) =>
      JSON.stringify({ type: 'finish', order: Array.from({ length: count }, (_, i) => i) });
    expect(refusalOf(decodeRoomMessage(order(MAXIMUM_RIDERS)))).toBe('accepted');
    expect(refusalOf(decodeRoomMessage(order(MAXIMUM_RIDERS + 1)))).toBe('too-long');
  });

  it('refuses a rider twice in a frame or a finish', () => {
    const twice = JSON.stringify({
      type: 'frame',
      tick: 1,
      riders: [
        [4, 1, 1, 0, 0],
        [4, 2, 1, 0, 0],
      ],
    });
    expect(refusalOf(decodeRoomMessage(twice))).toBe('bad-value');
    expect(refusalOf(decodeRoomMessage('{"type":"finish","order":[4,4]}'))).toBe('bad-value');
  });

  it('refuses a malformed value of every other kind', () => {
    const cases = [
      hello({ ticket: 'has space' }),
      hello({ ticket: '' }),
      hello({ ticket: 7 }),
      JSON.stringify({ type: 'refuse', reason: 'because' }),
      JSON.stringify({ type: 'frame', tick: 1, riders: [[1, 1, 1, 0]] }),
      JSON.stringify({ type: 'frame', tick: 1, riders: [[1, 1, 1, 0, 4]] }),
      JSON.stringify({ type: 'frame', tick: 1, riders: [[1, 1, 1, 101, 0]] }),
      JSON.stringify({ type: 'frame', tick: 1, riders: {} }),
      JSON.stringify({
        type: 'welcome',
        riderId: 1,
        routeRef: { sha256: 'A'.repeat(64) },
        roomConfig: {},
      }),
      JSON.stringify({ type: 'welcome', riderId: 1, routeRef: [], roomConfig: {} }),
    ];
    for (const text of cases) {
      const decoded = text.includes('"hello"')
        ? decodeClientMessage(text, PHYSICS)
        : decodeRoomMessage(text);
      expect(refusalOf(decoded), text).toBe('bad-value');
    }
  });

  it('never puts a value from the message in a refusal’s detail', () => {
    const secret = 'S3CRET-TICKET';
    const decoded = decodeClientMessage(hello({ ticket: `${secret} x` }), PHYSICS);
    expect(decoded.ok).toBe(false);
    expect(JSON.stringify(decoded)).not.toContain(secret);
  });

  it('names every reason it can give', () => {
    expect(new Set(REFUSAL_REASONS).size).toBe(11);
  });
});

describe('utf8ByteLength', () => {
  it('counts UTF-8 bytes, a surrogate pair as four and a lone surrogate as three', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('🚲')).toBe(4);
    expect(utf8ByteLength('\ud800')).toBe(3);
    expect(utf8ByteLength('\udc00x')).toBe(4);
  });
});
