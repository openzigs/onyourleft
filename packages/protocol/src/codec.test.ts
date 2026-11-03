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
  CLIENT_MESSAGE_TYPES,
  CLIENT_OUTCOME_FIELDS,
  ITEM_KEYS,
  LANE_COUNT,
  MAXIMUM_GAP_DECISECONDS,
  MAXIMUM_ITEM_EVENTS,
  MAXIMUM_LAPS,
  MAXIMUM_MESSAGE_BYTES,
  MAXIMUM_NESTING_DEPTH,
  MAXIMUM_RACE_OFFSET_CENTIMETRES,
  MAXIMUM_REPORTED_POWER_WATTS,
  MAXIMUM_RIDERS,
  MESSAGE_FIELDS,
} from './schema';

const PHYSICS = { physicsVersion: 1 };
const SHA = 'a'.repeat(64);

/** One of every message, with every optional field present, and the same without. */
const MESSAGES: readonly ProtocolMessage[] = [
  { type: 'hello', protocol: PROTOCOL_VERSION, physicsVersion: 1, ticket: 'room-7.ticket_ABC' },
  { type: 'report', sequence: 0, atMs: 0, powerWatts: 0 },
  { type: 'report', sequence: 41, atMs: 1_727_600_000_000, powerWatts: 312.5, cadenceRpm: 91 },
  { type: 'item-use', sequence: 0, atMs: 0 },
  { type: 'item-use', sequence: 17, atMs: 1_727_600_000_250 },
  { type: 'lane', sequence: 18, atMs: 1_727_600_000_300, lane: 0 },
  { type: 'lane', sequence: 19, atMs: 1_727_600_000_400, lane: LANE_COUNT - 1 },
  {
    type: 'welcome',
    riderId: 3,
    routeRef: { sha256: SHA },
    roomConfig: {
      kind: 'race',
      ridingPosition: 'hoods',
      reportIntervalMs: REPORT_INTERVAL_MS,
      frameIntervalMs: FRAME_INTERVAL_MS,
      drafting: 'on',
    },
  },
  {
    type: 'welcome',
    riderId: 4,
    routeRef: { sha256: SHA },
    roomConfig: {
      kind: 'race',
      ridingPosition: 'drops',
      reportIntervalMs: REPORT_INTERVAL_MS,
      frameIntervalMs: FRAME_INTERVAL_MS,
      drafting: 'off',
      lapRace: { laps: 3, items: 'on' },
    },
  },
  { type: 'refuse', reason: 'physics-mismatch' },
  { type: 'frame', tick: 0, riders: [] },
  {
    type: 'frame',
    tick: 61,
    ackSequence: 120,
    riders: [
      {
        riderId: 3,
        decimetres: 18_422,
        centimetresPerSecond: 1_104,
        draftPercent: 0,
        flags: 0,
        raceOffsetCentimetres: -MAXIMUM_RACE_OFFSET_CENTIMETRES,
        lane: 0,
        held: 'none',
        lapsDone: 1,
      },
      {
        riderId: 9,
        decimetres: 18_395,
        centimetresPerSecond: 998,
        draftPercent: 12,
        flags: FLAG_PLAUSIBILITY,
        raceOffsetCentimetres: 250,
        lane: 2,
        held: 'crosswind-gust',
        lapsDone: 0,
      },
    ],
    itemEvents: [
      { riderId: 9, event: 'pick-up', item: 'crosswind-gust' },
      { riderId: 3, event: 'use', item: 'puddle' },
      { riderId: 3, event: 'hit', item: 'tow' },
    ],
  },
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
  { type: 'countdown', startsInMs: 10_000 },
  { type: 'name', riderId: 9, displayName: 'Åsa 🚲 Ng' },
  { type: 'standings', tick: 0, riders: [] },
  {
    type: 'standings',
    tick: 1_200,
    riders: [
      { riderId: 9, gapDeciseconds: -123, wattsPerKilogramTenths: 41, flags: FLAG_PLAUSIBILITY },
      { riderId: 3, gapDeciseconds: 0, wattsPerKilogramTenths: 0, flags: FLAG_COASTING },
      { riderId: 12, gapDeciseconds: 87, wattsPerKilogramTenths: 1_000, flags: 0 },
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
      new Set([
        'hello',
        'report',
        'item-use',
        'lane',
        'welcome',
        'refuse',
        'frame',
        'countdown',
        'name',
        'standings',
        'finish',
      ]),
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
    JSON.stringify({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      physicsVersion: 1,
      ticket: 't',
      ...overrides,
    });

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
    expect(refusalOf(decodeClientMessage(hello({ protocol: PROTOCOL_VERSION + 1 }), PHYSICS))).toBe(
      'protocol-mismatch',
    );
    // A newer client's hello with a field this build has never heard of is a
    // version mismatch, not an unknown key.
    expect(
      refusalOf(
        decodeClientMessage(hello({ protocol: PROTOCOL_VERSION + 1, somethingNew: true }), PHYSICS),
      ),
    ).toBe('protocol-mismatch');
  });

  it('refuses a version-1 build cleanly, as a version and nothing else — #1347', () => {
    // Version 2 added the race's names and standings (ADR 0051). A build from
    // before them is told it is a different version, which the client says as
    // "update the app", rather than being seated in a race it cannot list.
    expect(refusalOf(decodeClientMessage(hello({ protocol: 1 }), PHYSICS))).toBe(
      'protocol-mismatch',
    );
  });

  it('refuses a version-2 build, as version 2 refused version 1 — #1908', () => {
    // Version 3 added the lap race's inputs, settings and frame slots. A
    // version-2 build would be seated in a lap race it cannot steer or read.
    expect(PROTOCOL_VERSION).toBe(3);
    expect(refusalOf(decodeClientMessage(hello({ protocol: 2 }), PHYSICS))).toBe(
      'protocol-mismatch',
    );
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
          `{"type":"hello","protocol":${String(PROTOCOL_VERSION)},"physicsVersion":1,"ticket":"t","__proto__":{}}`,
          PHYSICS,
        ),
      ),
    ).toBe('unknown-key');
    const welcome = JSON.parse(
      encodeMessage(MESSAGES.find((m) => m.type === 'welcome') as ProtocolMessage),
    ) as {
      routeRef: Record<string, unknown>;
    };
    welcome.routeRef['geometry'] = 'nope';
    expect(refusalOf(decodeRoomMessage(JSON.stringify(welcome)))).toBe('unknown-key');
  });

  it('refuses a missing required key', () => {
    const noTicket = JSON.stringify({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      physicsVersion: 1,
    });
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
    expect(
      refusalOf(
        decodeRoomMessage(
          JSON.stringify({
            type: 'standings',
            tick: 1,
            riders: [
              [4, 0, 1, 0],
              [4, 10, 1, 0],
            ],
          }),
        ),
      ),
    ).toBe('bad-value');
  });

  it('refuses a welcome that does not say whether the room drafts, or says it otherwise — #787', () => {
    const welcome = JSON.parse(
      encodeMessage(MESSAGES.find((m) => m.type === 'welcome') as ProtocolMessage),
    ) as {
      roomConfig: Record<string, unknown>;
    };
    expect(refusalOf(decodeRoomMessage(JSON.stringify(welcome)))).toBe('accepted');
    for (const drafting of [true, 'yes', 1]) {
      welcome.roomConfig['drafting'] = drafting;
      expect(refusalOf(decodeRoomMessage(JSON.stringify(welcome))), String(drafting)).toBe(
        'bad-value',
      );
    }
    delete welcome.roomConfig['drafting'];
    expect(refusalOf(decodeRoomMessage(JSON.stringify(welcome)))).toBe('missing-key');
  });

  it('refuses a name a real instance would never have stored — #1347', () => {
    const name = (displayName: unknown) =>
      decodeRoomMessage(JSON.stringify({ type: 'name', riderId: 1, displayName }));
    // What `checkDisplayName` admits is admitted: 32 scalars, an emoji each.
    expect(refusalOf(name('🚲'.repeat(32)))).toBe('accepted');
    expect(refusalOf(name('Rider'))).toBe('accepted');
    for (const hostile of [
      '',
      'Ann\u202Eoof', // a right-to-left override, which reverses the list after it
      'Ann\u2066x', // an isolate
      'An\u200Bn', // a zero-width space
      'Ann\u0600', // a format character that is not default-ignorable
      'Ann\u3164', // a default-ignorable that is not a format character (a Hangul filler)
      'Ann\nBea', // a control
      '🚲'.repeat(33),
      7,
    ]) {
      expect(refusalOf(name(hostile)), JSON.stringify(hostile)).toBe('bad-value');
    }
  });

  it('refuses a standings row past its bounds — #1347', () => {
    const row = (slots: readonly unknown[]) =>
      decodeRoomMessage(JSON.stringify({ type: 'standings', tick: 1, riders: [slots] }));
    expect(refusalOf(row([1, -MAXIMUM_GAP_DECISECONDS, 1_000, 7]))).toBe('accepted');
    for (const slots of [
      [1, MAXIMUM_GAP_DECISECONDS + 1, 0, 0],
      [1, -MAXIMUM_GAP_DECISECONDS - 1, 0, 0],
      [1, 1.5, 0, 0],
      [1, 0, 1_001, 0],
      [1, 0, -1, 0],
      [1, 0, 0, 8],
      [1, 0, 0],
      [1, 0, 0, 0, 0],
    ]) {
      expect(refusalOf(row(slots)), JSON.stringify(slots)).toBe('bad-value');
    }
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
    expect(new Set(REFUSAL_REASONS).size).toBe(12);
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

/**
 * #1908: a lap race's inputs in, the room's outcomes out, every field bounded
 * (ADR 0060 D-5.4). Each case alters a message that is otherwise accepted, so
 * the reason asserted is the one check that fired.
 */
describe('the lap race — #1908', () => {
  const itemUse = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({ type: 'item-use', sequence: 1, atMs: 1, ...overrides });
  const lane = (overrides: Record<string, unknown> = {}): string =>
    JSON.stringify({ type: 'lane', sequence: 1, atMs: 1, lane: 1, ...overrides });
  /** A lap race's nine-slot rider, with the named slots replaced. */
  const lapRow = (overrides: Record<string, unknown> = {}): unknown[] => {
    const row = MESSAGE_FIELDS.frame.riders.shape.row;
    const valid: Record<string, unknown> = {
      riderId: 1,
      decimetres: 10,
      centimetresPerSecond: 900,
      draftPercent: 0,
      flags: 0,
      raceOffsetCentimetres: 0,
      lane: 1,
      held: 'none',
      lapsDone: 0,
      ...overrides,
    };
    return [...row.slots, ...row.tail].map((slot) => valid[slot.name]);
  };
  const frame = (fields: Record<string, unknown>): string =>
    JSON.stringify({ type: 'frame', tick: 1, riders: [lapRow()], ...fields });

  it('accepts the unaltered messages each case below alters', () => {
    expect(refusalOf(decodeClientMessage(itemUse(), PHYSICS))).toBe('accepted');
    expect(refusalOf(decodeClientMessage(lane(), PHYSICS))).toBe('accepted');
    expect(refusalOf(decodeRoomMessage(frame({})))).toBe('accepted');
    expect(refusalOf(decodeRoomMessage(frame({ itemEvents: [[1, 'hit', 'tailwind']] })))).toBe(
      'accepted',
    );
  });

  it('refuses an unknown item key, held or in an event', () => {
    for (const key of ['banana', 'shell', 'Tailwind', '', 7, null]) {
      expect(
        refusalOf(decodeRoomMessage(frame({ riders: [lapRow({ held: key })] }))),
        String(key),
      ).toBe('bad-value');
      expect(
        refusalOf(decodeRoomMessage(frame({ itemEvents: [[1, 'pick-up', key]] }))),
        String(key),
      ).toBe('bad-value');
    }
    // `none` is a held item, never an event's.
    expect(refusalOf(decodeRoomMessage(frame({ itemEvents: [[1, 'use', 'none']] })))).toBe(
      'bad-value',
    );
    expect(refusalOf(decodeRoomMessage(frame({ itemEvents: [[1, 'teleport', 'tow']] })))).toBe(
      'bad-value',
    );
    // Every key the schema states is one a rider may hold and an event may carry.
    for (const key of ITEM_KEYS) {
      expect(refusalOf(decodeRoomMessage(frame({ itemEvents: [[1, 'use', key]] })))).toBe(
        'accepted',
      );
      expect(refusalOf(decodeRoomMessage(frame({ riders: [lapRow({ held: key })] })))).toBe(
        'accepted',
      );
    }
  });

  it('refuses a lane outside the stated lanes, sent or framed', () => {
    for (const value of [-1, LANE_COUNT, 1.5, '1', null]) {
      expect(refusalOf(decodeClientMessage(lane({ lane: value }), PHYSICS)), String(value)).toBe(
        'bad-value',
      );
      expect(
        refusalOf(decodeRoomMessage(frame({ riders: [lapRow({ lane: value })] }))),
        String(value),
      ).toBe('bad-value');
    }
    for (let value = 0; value < LANE_COUNT; value += 1) {
      expect(refusalOf(decodeClientMessage(lane({ lane: value }), PHYSICS))).toBe('accepted');
    }
    expect(refusalOf(decodeClientMessage(lane({ lane: undefined }), PHYSICS))).toBe('missing-key');
  });

  it('refuses an item-event list longer than the stated bound, and accepts one at it', () => {
    const events = (count: number) =>
      Array.from({ length: count }, (_, index) => [index % MAXIMUM_RIDERS, 'hit', 'tow']);
    expect(refusalOf(decodeRoomMessage(frame({ itemEvents: events(MAXIMUM_ITEM_EVENTS) })))).toBe(
      'accepted',
    );
    expect(
      refusalOf(decodeRoomMessage(frame({ itemEvents: events(MAXIMUM_ITEM_EVENTS + 1) }))),
    ).toBe('too-long');
  });

  it('refuses a negative sequence, or one that is not a whole number, on either input', () => {
    for (const text of [
      itemUse({ sequence: -1 }),
      lane({ sequence: -1 }),
      itemUse({ sequence: 0.5 }),
      lane({ sequence: 2 ** 53 }),
      itemUse({ atMs: -1 }),
    ]) {
      expect(refusalOf(decodeClientMessage(text, PHYSICS)), text).toBe('bad-value');
    }
  });

  it('refuses any client message carrying an outcome, as an outcome and not an unknown key', () => {
    const hello = (extra: Record<string, unknown>): string =>
      JSON.stringify({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        physicsVersion: 1,
        ticket: 't',
        ...extra,
      });
    const report = (extra: Record<string, unknown>): string =>
      JSON.stringify({ type: 'report', sequence: 1, atMs: 1, powerWatts: 200, ...extra });
    for (const [field, value] of [
      ['hit', true],
      ['raceOffset', 10],
      ['position', 1],
      ['raceOffsetCentimetres', 1_000],
      ['held', 'tailwind'],
      ['item', 'tailwind'],
      ['lapsDone', 3],
      ['decimetres', 99_999],
    ] as const) {
      for (const text of [
        itemUse({ [field]: value }),
        lane({ [field]: value }),
        report({ [field]: value }),
        hello({ [field]: value }),
      ]) {
        expect(refusalOf(decodeClientMessage(text, PHYSICS)), text).toBe('outcome-from-client');
      }
    }
    // A detail names the key and never its value.
    const decoded = decodeClientMessage(itemUse({ raceOffset: 987_654 }), PHYSICS);
    expect(JSON.stringify(decoded)).not.toContain('987654');
  });

  it('counts every slot of the room’s rider as an outcome a client may not send', () => {
    const row = MESSAGE_FIELDS.frame.riders.shape.row;
    const slots = [...row.slots, ...row.tail].map((slot) => slot.name);
    const inputs = new Set(
      CLIENT_MESSAGE_TYPES.flatMap((type) => Object.keys(MESSAGE_FIELDS[type])),
    );
    expect(slots).toContain('raceOffsetCentimetres');
    // The one slot a client also sends is the lane: the lane it ASKS for is an
    // input, and the frame's is the room's answer to it.
    expect(slots.filter((slot) => inputs.has(slot))).toEqual(['lane']);
    for (const name of slots.filter((slot) => slot !== 'riderId' && !inputs.has(slot))) {
      expect(CLIENT_OUTCOME_FIELDS, name).toContain(name);
    }
    // And no outcome is a field a client message carries.
    for (const field of inputs) {
      expect(CLIENT_OUTCOME_FIELDS, field).not.toContain(field);
    }
  });

  it('refuses a rider row that carries part of the lap slots, or a lap slot past its bound', () => {
    const row = (slots: readonly unknown[]) =>
      refusalOf(decodeRoomMessage(frame({ riders: [slots] })));
    // Five (no lap race) and nine (a lap race) are the two lengths.
    expect(row(lapRow().slice(0, 5))).toBe('accepted');
    expect(row(lapRow())).toBe('accepted');
    for (const length of [4, 6, 7, 8, 10]) {
      const slots = [...lapRow(), 0].slice(0, length);
      expect(row(slots), String(length)).toBe('bad-value');
    }
    expect(row(lapRow({ raceOffsetCentimetres: MAXIMUM_RACE_OFFSET_CENTIMETRES }))).toBe(
      'accepted',
    );
    expect(row(lapRow({ raceOffsetCentimetres: -MAXIMUM_RACE_OFFSET_CENTIMETRES }))).toBe(
      'accepted',
    );
    for (const override of [
      { raceOffsetCentimetres: MAXIMUM_RACE_OFFSET_CENTIMETRES + 1 },
      { raceOffsetCentimetres: -MAXIMUM_RACE_OFFSET_CENTIMETRES - 1 },
      { raceOffsetCentimetres: 0.5 },
      { lapsDone: -1 },
      { lapsDone: MAXIMUM_LAPS + 1 },
    ]) {
      expect(row(lapRow(override)), JSON.stringify(override)).toBe('bad-value');
    }
  });

  it('refuses to encode a rider with part of the lap slots, rather than sending it', () => {
    expect(() =>
      encodeMessage({
        type: 'frame',
        tick: 1,
        riders: [
          {
            riderId: 1,
            decimetres: 1,
            centimetresPerSecond: 1,
            draftPercent: 0,
            flags: 0,
            lane: 1,
          },
        ],
      }),
    ).toThrow(ProtocolEncodeError);
  });

  it('refuses a lap race’s settings out of bounds, or one without the other', () => {
    const welcome = (lapRace: unknown) =>
      refusalOf(
        decodeRoomMessage(
          JSON.stringify({
            type: 'welcome',
            riderId: 1,
            routeRef: { sha256: SHA },
            roomConfig: {
              kind: 'race',
              ridingPosition: 'hoods',
              reportIntervalMs: 500,
              frameIntervalMs: 1000,
              drafting: 'on',
              lapRace,
            },
          }),
        ),
      );
    expect(welcome({ laps: 1, items: 'off' })).toBe('accepted');
    expect(welcome({ laps: MAXIMUM_LAPS, items: 'on' })).toBe('accepted');
    for (const bad of [
      { laps: 0, items: 'on' },
      { laps: MAXIMUM_LAPS + 1, items: 'on' },
      { laps: 2.5, items: 'on' },
      { laps: 3, items: true },
      { laps: 3, items: 'some' },
    ]) {
      expect(welcome(bad), JSON.stringify(bad)).toBe('bad-value');
    }
    expect(welcome({ laps: 3 })).toBe('missing-key');
    expect(welcome({ items: 'on' })).toBe('missing-key');
    expect(welcome({ laps: 3, items: 'on', seed: 4 })).toBe('unknown-key');
  });
});
