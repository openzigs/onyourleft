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
 * The largest legal message is a frame of {@link MAXIMUM_RIDERS} riders, each
 * slot at its bound: 3 682 bytes, computed in `frame-size.test.ts`. 8 KiB
 * leaves room over that and refuses anything a real room would never send.
 */
export const MAXIMUM_MESSAGE_BYTES = 8192;

/**
 * The deepest a message nests, checked **before** it is parsed. A frame is
 * the deepest: an object, holding the riders array, holding one rider's
 * array — three. Anything deeper is not a message.
 */
export const MAXIMUM_NESTING_DEPTH = 3;

/** ADR 0037 D-7: a room is 50 riders, up to 100. */
export const MAXIMUM_RIDERS = 100;

/** The most power a report may carry — Sir Chris Hoy's 2500 W peak, the one first-hand figure in ADR 0028 Q3's table. */
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
        },
      },
    },
  },
  refuse: {
    reason: {
      shape: {
        kind: 'enum',
        values: ['protocol-mismatch', 'physics-mismatch', 'ticket-refused', 'room-full'],
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
export const CLIENT_MESSAGE_TYPES: readonly ClientMessage['type'][] = ['hello', 'report'];

/** The types a client may receive. */
export const ROOM_MESSAGE_TYPES: readonly RoomMessage['type'][] = [
  'welcome',
  'refuse',
  'frame',
  'finish',
];
