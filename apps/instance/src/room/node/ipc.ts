// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the HTTP process and a room worker say to each other (#780) — plain
 * data over Node's IPC channel, with a socket handle riding along on
 * `socket`.
 */

import type { Admission } from '../core/room.ts';
import type { RoomPlan } from '../room-plan.ts';
import type { HostMetrics, RoomResult } from './room-host.ts';

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
      readonly request: UpgradeRequest;
      /** Bytes the HTTP parser read past the request head, base64 — almost always empty. */
      readonly head: string;
    }
  | { readonly type: 'admitted'; readonly id: number; readonly admission: Admission | null }
  | {
      readonly type: 'start';
      readonly id: number;
      readonly roomId: string;
      /** Only a rider seated and connected in the room may start it. */
      readonly athleteId: string;
    }
  | { readonly type: 'metrics'; readonly id: number }
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
  | { readonly type: 'room-closed'; readonly roomId: string }
  | { readonly type: 'socket-closed'; readonly socketId: string }
  | {
      readonly type: 'metrics';
      readonly id: number;
      readonly metrics: HostMetrics;
      readonly rssBytes: number;
    }
  | { readonly type: 'started'; readonly id: number; readonly ok: boolean }
  | { readonly type: 'stopped' };
