// SPDX-License-Identifier: Apache-2.0

/**
 * The wire format as **data**: every message's fields, their bounds, and the
 * limits the decoder applies before it parses anything.
 *
 * One table drives the encoder, the decoder and `coordinates.test.ts`'s walk,
 * so a field cannot be accepted by one and unseen by another. Hand-written
 * rather than a schema library because this package ships to every client and
 * every room under Apache-2.0 with **no production dependency at all**, in the
 * style of `packages/domain/src/workout/format.ts` (ADR 0017 D-4: an unknown
 * key is refused, not ignored).
 */

import type { ClientMessage, ProtocolMessage, RoomMessage } from './messages';

/**
 * The most UTF-8 bytes a message may be, checked **before** it is parsed.
 *
 * The largest legal message is a lap race's frame of {@link MAXIMUM_RIDERS}
 * riders, every slot at its bound, with {@link MAXIMUM_ITEM_EVENTS} item
 * events: computed in `frame-size.test.ts`. 16 KiB since version 3 (#1908) —
 * 8 KiB before it, when a frame had five slots a rider and no events — leaves
 * room over that and refuses anything a real room would never send. It is
 * also the room's ingest bound (`apps/instance` §`worker.ts` `maxPayload`).
 */
export const MAXIMUM_MESSAGE_BYTES = 16_384;

/**
 * The deepest a message nests, checked **before** it is parsed. A frame is
 * the deepest: an object, holding the riders array, holding one rider's
 * array — three. Anything deeper is not a message.
 */
export const MAXIMUM_NESTING_DEPTH = 3;

/** ADR 0037 D-7: a room is 50 riders, up to 100. */
export const MAXIMUM_RIDERS = 100;

/**
 * The most power a report may carry — Sir Chris Hoy's 2500 W peak, the one
 * first-hand figure in ADR 0028 Q3's table.
 *
 * ⚠️ **A wire bound, and so a ceiling on the room's own limit** (#779, from
 * #832's review). `@onyourleft/physics`' `PlausibilityLimits.maximumPowerWatts`
 * defaults to this same 2500 (`physics-agreement.test.ts` holds them equal),
 * and a room may **lower** it but never raise it: a report over this bound is
 * refused by the decoder as `bad-value` before the room sees it, so a room
 * configured higher would admit nothing more. The room refuses such a
 * configuration at start-up (`apps/instance` §`roomSettings`). Raising it is a
 * new `PROTOCOL_VERSION`.
 *
 * ⚠️ **And an over-bound report coasts the rider and feeds no rule-2 flag.**
 * The room never sees its power, so it simulates that step at 0 W (rule 1) and
 * shows the rider coasting; a flag is rule 2's, over the power the room
 * simulated. A rider whose meter reports 3000 W is therefore slowed, visibly,
 * and not flagged — which is the safer of the two errors, and stated here
 * rather than discovered.
 */
export const MAXIMUM_REPORTED_POWER_WATTS = 2500;

/** The longest admission ticket, in characters. */
export const MAXIMUM_TICKET_LENGTH = 1024;

/** A value's shape. */
export type Shape =
  | { readonly kind: 'integer'; readonly minimum: number; readonly maximum: number }
  | { readonly kind: 'number'; readonly minimum: number; readonly maximum: number }
  | { readonly kind: 'string'; readonly pattern: RegExp; readonly maximumLength: number }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'object'; readonly fields: Readonly<Record<string, Field>> }
  | {
      readonly kind: 'array';
      readonly items: Shape;
      readonly maximumLength: number;
      /** Every item distinct. */
      readonly distinct?: true;
    }
  | {
      readonly kind: 'tuple';
      /** Decoded as an object keyed by slot name; sent as an array in slot order. */
      readonly slots: readonly { readonly name: string; readonly shape: Shape }[];
      /**
       * Slots sent after {@link slots}, **all of them or none** (#1908): a
       * tuple is `slots.length` values or `slots.length + tail.length`, never
       * a length between. A decoded tuple sent short has none of their keys.
       */
      readonly tail?: readonly { readonly name: string; readonly shape: Shape }[];
    }
  | {
      /** An array of tuples, no two sharing the first slot. */
      readonly kind: 'rows';
      readonly row: Extract<Shape, { kind: 'tuple' }>;
      readonly maximumLength: number;
    };

/** A named field of an object. */
export interface Field {
  readonly shape: Shape;
  readonly optional?: true;
}

const COUNT = { kind: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const;
const VERSION = { kind: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } as const;
const RIDER_ID = { kind: 'integer', minimum: 0, maximum: 2_147_483_647 } as const;

/**
 * The longest time gap a standings row carries, in tenths of a second: 100
 * hours, which no race on any route reaches.
 */
export const MAXIMUM_GAP_DECISECONDS = 3_600_000;

/**
 * The most W/kg a standings row carries, in tenths: 100 W/kg, five times the
 * 18 W/kg five-second ceiling of ADR 0028 Q3. A room clamps a higher figure to
 * it: {@link MAXIMUM_REPORTED_POWER_WATTS} at the lightest mass a room admits
 * (20 kg, `@onyourleft/physics` §`DEFAULT_PLAUSIBILITY_LIMITS`) would be 125.
 */
export const MAXIMUM_WATTS_PER_KILOGRAM_TENTHS = 1_000;

/**
 * A display name, as `@onyourleft/domain` §`checkDisplayName` admits one:
 * no control (`Cc`), no format character (`Cf`) — which is every
 * bidirectional override, embedding, isolate and mark that function refuses
 * by name — and no other default-ignorable code point, at most 32 scalar
 * values: 64 UTF-16 code units, which is what `length` counts. Held on the
 * wire too, so a hostile room cannot reverse the text of a list with an
 * override a real instance would never have stored (#1347).
 */
const DISPLAY_NAME = {
  kind: 'string',
  pattern: /^[^\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]+$/u,
  maximumLength: 64,
} as const;

/**
 * The items a lap race has, by key — `@onyourleft/domain` §`ITEM_KINDS`
 * (#1899), restated because this package has no production dependency;
 * `lap-race-agreement.test.ts` holds the two equal.
 */
export const ITEM_KEYS = ['tailwind', 'tow', 'puddle', 'crosswind-gust', 'rain-cape'] as const;

/** How many lanes a lap race has — `@onyourleft/domain` §`LANE_COUNT` (ADR 0060 D-6.3). Lanes are `0` to this less one. */
export const LANE_COUNT = 3;

/**
 * The most a race offset may be, either way, in whole centimetres: ADR 0060
 * D-3.3's B = 10 m, `@onyourleft/domain` §`RACE_OFFSET_BOUND_METRES`.
 */
export const MAXIMUM_RACE_OFFSET_CENTIMETRES = 1_000;

/**
 * The most laps a lap race may be on the wire. A wire bound, above any room's
 * own (the solo chooser offers up to 10, `apps/web` §`LAP_RACE_MOST_LAPS`): a
 * room may offer fewer, never more.
 */
export const MAXIMUM_LAPS = 100;

/**
 * The most item events one frame carries: two a rider of a full room. An event
 * is an announcement, never state — every outcome is also in the frame's rider
 * slots — so a room with more on one tick sends the first this many in its own
 * order and drops the rest (#1909), and a client loses a word, never a place.
 */
export const MAXIMUM_ITEM_EVENTS = 2 * MAXIMUM_RIDERS;

const LANE = { kind: 'integer', minimum: 0, maximum: LANE_COUNT - 1 } as const;
const ITEM_KEY = { kind: 'enum', values: ITEM_KEYS } as const;

/** Everything a message carries beside its `type`, keyed by that type. */
export const MESSAGE_FIELDS = {
  hello: {
    protocol: { shape: VERSION },
    physicsVersion: { shape: VERSION },
    ticket: {
      shape: { kind: 'string', pattern: /^[\x21-\x7e]+$/, maximumLength: MAXIMUM_TICKET_LENGTH },
    },
  },
  report: {
    sequence: { shape: COUNT },
    atMs: { shape: COUNT },
    powerWatts: { shape: { kind: 'number', minimum: 0, maximum: MAXIMUM_REPORTED_POWER_WATTS } },
    cadenceRpm: { shape: { kind: 'number', minimum: 0, maximum: 255 }, optional: true },
  },
  'item-use': {
    sequence: { shape: COUNT },
    atMs: { shape: COUNT },
  },
  lane: {
    sequence: { shape: COUNT },
    atMs: { shape: COUNT },
    lane: { shape: LANE },
  },
  welcome: {
    riderId: { shape: RIDER_ID },
    routeRef: {
      shape: {
        kind: 'object',
        fields: {
          sha256: { shape: { kind: 'string', pattern: /^[0-9a-f]{64}$/, maximumLength: 64 } },
        },
      },
    },
    roomConfig: {
      shape: {
        kind: 'object',
        fields: {
          kind: { shape: { kind: 'enum', values: ['race', 'ride'] } },
          ridingPosition: { shape: { kind: 'enum', values: ['upright', 'hoods', 'drops'] } },
          reportIntervalMs: { shape: { kind: 'integer', minimum: 100, maximum: 60_000 } },
          frameIntervalMs: { shape: { kind: 'integer', minimum: 100, maximum: 60_000 } },
          drafting: { shape: { kind: 'enum', values: ['on', 'off'] } },
          lapRace: {
            shape: {
              kind: 'object',
              fields: {
                laps: { shape: { kind: 'integer', minimum: 1, maximum: MAXIMUM_LAPS } },
                items: { shape: { kind: 'enum', values: ['on', 'off'] } },
              },
            },
            optional: true,
          },
        },
      },
    },
  },
  refuse: {
    reason: {
      shape: {
        kind: 'enum',
        values: [
          'protocol-mismatch',
          'physics-mismatch',
          'ticket-refused',
          'room-full',
          'room-closed',
        ],
      },
    },
  },
  frame: {
    tick: { shape: COUNT },
    ackSequence: { shape: COUNT, optional: true },
    riders: {
      shape: {
        kind: 'rows',
        maximumLength: MAXIMUM_RIDERS,
        row: {
          kind: 'tuple',
          slots: [
            { name: 'riderId', shape: RIDER_ID },
            { name: 'decimetres', shape: { kind: 'integer', minimum: 0, maximum: 1_000_000_000 } },
            {
              name: 'centimetresPerSecond',
              shape: { kind: 'integer', minimum: 0, maximum: 10_000 },
            },
            { name: 'draftPercent', shape: { kind: 'integer', minimum: 0, maximum: 100 } },
            { name: 'flags', shape: { kind: 'integer', minimum: 0, maximum: 3 } },
          ],
          // A lap race's four, all or none (#1908).
          tail: [
            {
              name: 'raceOffsetCentimetres',
              shape: {
                kind: 'integer',
                minimum: -MAXIMUM_RACE_OFFSET_CENTIMETRES,
                maximum: MAXIMUM_RACE_OFFSET_CENTIMETRES,
              },
            },
            { name: 'lane', shape: LANE },
            { name: 'held', shape: { kind: 'enum', values: ['none', ...ITEM_KEYS] } },
            { name: 'lapsDone', shape: { kind: 'integer', minimum: 0, maximum: MAXIMUM_LAPS } },
          ],
        },
      },
    },
    itemEvents: {
      shape: {
        kind: 'array',
        maximumLength: MAXIMUM_ITEM_EVENTS,
        items: {
          kind: 'tuple',
          slots: [
            { name: 'riderId', shape: RIDER_ID },
            { name: 'event', shape: { kind: 'enum', values: ['pick-up', 'use', 'hit'] } },
            { name: 'item', shape: ITEM_KEY },
          ],
        },
      },
      optional: true,
    },
  },
  countdown: {
    // An hour at most: no room is configured with a longer countdown (#785).
    startsInMs: { shape: { kind: 'integer', minimum: 0, maximum: 3_600_000 } },
  },
  name: {
    riderId: { shape: RIDER_ID },
    displayName: { shape: DISPLAY_NAME },
  },
  standings: {
    tick: { shape: COUNT },
    riders: {
      shape: {
        kind: 'rows',
        maximumLength: MAXIMUM_RIDERS,
        row: {
          kind: 'tuple',
          slots: [
            { name: 'riderId', shape: RIDER_ID },
            {
              name: 'gapDeciseconds',
              shape: {
                kind: 'integer',
                minimum: -MAXIMUM_GAP_DECISECONDS,
                maximum: MAXIMUM_GAP_DECISECONDS,
              },
            },
            {
              name: 'wattsPerKilogramTenths',
              shape: { kind: 'integer', minimum: 0, maximum: MAXIMUM_WATTS_PER_KILOGRAM_TENTHS },
            },
            // A frame's two flags and FLAG_FINISHED.
            { name: 'flags', shape: { kind: 'integer', minimum: 0, maximum: 7 } },
          ],
        },
      },
    },
  },
  finish: {
    order: {
      shape: { kind: 'array', items: RIDER_ID, maximumLength: MAXIMUM_RIDERS, distinct: true },
    },
  },
} as const satisfies Record<ProtocolMessage['type'], Readonly<Record<string, Field>>>;

/** The types a room may receive. A room refuses a `frame` from a client as an unknown type. */
export const CLIENT_MESSAGE_TYPES: readonly ClientMessage['type'][] = [
  'hello',
  'report',
  'item-use',
  'lane',
];

/**
 * Keys a client message must never carry, because each names an OUTCOME the
 * room decides (ADR 0060 D-5.4, ADR 0028 D-2): a hit, a pick-up, a held item,
 * an offset, a distance, a lap count, a place or an order. Refused
 * `outcome-from-client` — before `unknown-key`, so a room can count a client
 * that claims a result apart from one that is merely a different build.
 *
 * Every slot of a frame's rider bar its `riderId` is here, which
 * `codec.test.ts` holds, so a slot added to the room's answer is refused from
 * a client the day it is added.
 */
export const CLIENT_OUTCOME_FIELDS: readonly string[] = [
  'hit',
  'hits',
  'pickUp',
  'item',
  'held',
  'raceOffset',
  'raceOffsetCentimetres',
  'position',
  'place',
  'distance',
  'decimetres',
  'centimetresPerSecond',
  'draftPercent',
  'flags',
  'lapsDone',
  'laps',
  'order',
  'itemEvents',
];

/** The types a client may receive. */
export const ROOM_MESSAGE_TYPES: readonly RoomMessage['type'][] = [
  'welcome',
  'refuse',
  'frame',
  'countdown',
  'name',
  'standings',
  'finish',
];
