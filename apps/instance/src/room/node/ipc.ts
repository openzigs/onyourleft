// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the HTTP process and a room worker say to each other (#780) — plain
 * data over Node's IPC channel, with a socket handle riding along on
 * `socket`.
 */

import type { Admission, RoomPhase } from '../core/room.ts';
import type { RoomPlan } from '../room-plan.ts';
import type { HostMetrics, RoomFlagRaised, RoomResult, RoomSeat } from './room-host.ts';

/** What a worker is started with, as its one command-line argument (JSON). */
export interface WorkerSettings {
  readonly index: number;
  /** `permessage-deflate`: off unless the operator turns it on (ruling Q16). */
  readonly compression: boolean;
  readonly maxBufferedBytes: number;
  readonly pingIntervalMs: number;
}

/** The parts of the upgrade request `ws` reads, copied: the request itself cannot cross. */
export interface UpgradeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export type ToWorker =
  | {
      readonly type: 'socket';
      readonly socketId: string;
      readonly plan: RoomPlan;
      /**
       * The room is a race that has left its lobby (#897): the worker joins
       * it only if it still holds it, and otherwise refuses `room-closed`.
       */
      readonly started: boolean;
      readonly request: UpgradeRequest;
      /** Bytes the HTTP parser read past the request head, base64 — almost always empty. */
      readonly head: string;
    }
  | { readonly type: 'admitted'; readonly id: number; readonly admission: Admission | null }
  | {
      readonly type: 'start';
      readonly id: number;
      readonly roomId: string;
      /**
       * Only the room's creator, seated and connected, may start it — the
       * owner's ruling of 2026-09-30 (`room-host.ts` §`start`); any seated
       * rider in a room an operator opened, which has no creator.
       */
      readonly athleteId: string;
    }
  | { readonly type: 'metrics'; readonly id: number }
  /** Take a rider out of a room for its life (#789). */
  | {
      readonly type: 'remove';
      readonly id: number;
      readonly roomId: string;
      readonly athleteId: string;
    }
  /** Who sits in a seat of a room, and the room's tick (#789): a report from the room names them. */
  | {
      readonly type: 'seat';
      readonly id: number;
      readonly roomId: string;
      readonly riderId: number;
    }
  | { readonly type: 'shutdown' };

export type FromWorker =
  | { readonly type: 'ready'; readonly pid: number }
  | {
      readonly type: 'admit';
      readonly id: number;
      readonly roomId: string;
      readonly ticket: string;
    }
  | { readonly type: 'result'; readonly roomId: string; readonly result: RoomResult }
  | { readonly type: 'race-started'; readonly roomId: string }
  | { readonly type: 'race-finished'; readonly roomId: string }
  | { readonly type: 'room-closed'; readonly roomId: string; readonly phase: RoomPhase }
  | { readonly type: 'socket-closed'; readonly socketId: string }
  | {
      readonly type: 'metrics';
      readonly id: number;
      readonly metrics: HostMetrics;
      readonly rssBytes: number;
    }
  | { readonly type: 'started'; readonly id: number; readonly ok: boolean }
  | { readonly type: 'removed'; readonly id: number; readonly ok: boolean }
  | { readonly type: 'seated'; readonly id: number; readonly seat: RoomSeat | null }
  | { readonly type: 'flag'; readonly roomId: string; readonly flag: RoomFlagRaised }
  | { readonly type: 'stopped' };
