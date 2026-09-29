// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/protocol` — the race-room wire format (#768).
 *
 * Every message a client (`apps/web`) and a room (`apps/instance`) exchange,
 * the encoder, a bounded decoder that refuses what it does not recognise, and
 * the version handshake. Here, under `packages/`, because it is the only place
 * both sides may import from; Apache-2.0, platform-free and with **no
 * production dependency**. See `README.md`.
 *
 * ```ts
 * // In a room, for every text frame a socket delivers:
 * const decoded = decodeClientMessage(text, { physicsVersion: PHYSICS_VERSION });
 * if (!decoded.ok) {
 *   // decoded.refusal.reason is one of REFUSAL_REASONS; a hello refused for a
 *   // version is answered with `refuse` before the socket is closed.
 * }
 * ```
 */

export type {
  ClientMessage,
  Finish,
  Frame,
  FrameRider,
  Hello,
  ProtocolMessage,
  Refuse,
  RefuseReason,
  Report,
  RidingPosition,
  RoomConfig,
  RoomKind,
  RoomMessage,
  Welcome,
} from './messages';
export {
  FLAG_COASTING,
  FLAG_PLAUSIBILITY,
  FRAME_INTERVAL_MS,
  PROTOCOL_VERSION,
  REPORT_INTERVAL_MS,
} from './messages';

export type { Field, Shape } from './schema';
export {
  CLIENT_MESSAGE_TYPES,
  MAXIMUM_MESSAGE_BYTES,
  MAXIMUM_NESTING_DEPTH,
  MAXIMUM_REPORTED_POWER_WATTS,
  MAXIMUM_RIDERS,
  MAXIMUM_TICKET_LENGTH,
  MESSAGE_FIELDS,
  ROOM_MESSAGE_TYPES,
} from './schema';

export type { DecodeExpectations, Decoded, Refusal, RefusalReason } from './codec';
export {
  decodeClientMessage,
  decodeRoomMessage,
  encodeMessage,
  ProtocolEncodeError,
  REFUSAL_REASONS,
  utf8ByteLength,
} from './codec';
