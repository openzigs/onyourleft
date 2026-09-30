// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Other riders, drawn a little in the past** — #782's snapshot interpolation.
 *
 * A room sends the whole field once a second (ADR 0037 D-4: fan-out at 1 Hz).
 * Drawing each rider where the newest frame put them would make every other
 * rider on the road jump once a second; extrapolating past it would draw them
 * where the room has not put them — through a corner they did not take, or on
 * past the moment they stopped. So this is #323's `drawnAt` idea applied to the
 * network: **render a fixed delay behind the room's clock and draw each rider
 * between the two frames that bracket that instant** (Fiedler, *Snapshot
 * Interpolation*; Gambetta, *Entity Interpolation* — both read 2026-09-28).
 *
 * ## The room's clock, on this device
 *
 * A frame carries its `tick`, and the room ticks every `frameIntervalMs`, so a
 * frame describes the room's instant `tick × frameIntervalMs`. What this
 * device knows is when each frame ARRIVED; the difference is the offset
 * between the two clocks plus the network's delay. The smallest such
 * difference over the recent frames ({@link OFFSET_WINDOW_FRAMES}) is the
 * least-delayed frame's, and it is the offset used — so a frame that arrives
 * late never pulls the whole picture later with it.
 *
 * ## The two rules the tests hold
 *
 * - **Linear in the render clock between two frames**, rider by rider.
 * - **Never past the newest frame**: an instant after it draws the newest
 *   frame's position and stays there until another arrives. A frame late by a
 *   whole period is a rider held still for up to a second, which is honest; a
 *   rider drawn where the room never put them is not.
 *
 * ⚠️ **What was not established, stated rather than guessed**: spike 0007 §9
 * says of a 1–2 s render delay that *"nobody watched a screen for this
 * spike"*. {@link INTERPOLATION_DELAY_FRAMES} is chosen, not measured on a
 * person; #733 carries the owner's look at it.
 */

import type { Frame } from '@onyourleft/protocol';

/**
 * How far behind the room's clock other riders are drawn, in frame intervals:
 * **1.5** — 1 500 ms at the default 1 Hz fan-out.
 *
 * One interval is the least that ever has a frame on each side of the drawn
 * instant; the half beyond it is room for the delay to vary by half a second
 * (spike 0007 §9 measured a fan-out wait of 274 ms median at 2 Hz ingest)
 * before a rider is held. Chosen, not measured on a screen — see the header.
 */
export const INTERPOLATION_DELAY_FRAMES = 1.5;

/** How many recent frames the clock offset is the minimum of. */
export const OFFSET_WINDOW_FRAMES = 10;

/** How many frames are kept to interpolate between. Two are needed; four ride out a late one. */
const KEPT_FRAMES = 4;

/** One other rider, where to draw them. */
export interface DrawnRemoteRider {
  readonly riderId: number;
  /** Along the route, in metres — the room's odometer, never a coordinate. */
  readonly distanceMetres: number;
  readonly speedMetresPerSecond: number;
  /** `@onyourleft/protocol`'s flags, as the room last sent them. */
  readonly flags: number;
}

interface HeldFrame {
  /** The room's instant this frame describes, in the room's milliseconds. */
  readonly roomMs: number;
  readonly riders: ReadonlyMap<number, DrawnRemoteRider>;
}

/** The frames a room sent, and where to draw its riders at any instant on this device. */
export class SnapshotBuffer {
  readonly #frameIntervalMs: number;
  readonly #frames: HeldFrame[] = [];
  readonly #offsets: number[] = [];

  constructor(frameIntervalMs: number) {
    this.#frameIntervalMs = frameIntervalMs;
  }

  /** The render delay, in milliseconds. @see INTERPOLATION_DELAY_FRAMES */
  get delayMs(): number {
    return this.#frameIntervalMs * INTERPOLATION_DELAY_FRAMES;
  }

  /** A frame that arrived at `receivedAtMs` on this device's clock. */
  push(frame: Frame, receivedAtMs: number): void {
    const roomMs = frame.tick * this.#frameIntervalMs;
    const newest = this.#frames.at(-1);
    // A frame that is not newer than the newest is a duplicate or a straggler.
    if (newest !== undefined && roomMs <= newest.roomMs) return;
    const riders = new Map<number, DrawnRemoteRider>();
    for (const rider of frame.riders) {
      riders.set(rider.riderId, {
        riderId: rider.riderId,
        distanceMetres: rider.decimetres / 10,
        speedMetresPerSecond: rider.centimetresPerSecond / 100,
        flags: rider.flags,
      });
    }
    this.#frames.push({ roomMs, riders });
    if (this.#frames.length > KEPT_FRAMES) this.#frames.shift();
    this.#offsets.push(receivedAtMs - roomMs);
    if (this.#offsets.length > OFFSET_WINDOW_FRAMES) this.#offsets.shift();
  }

  /** Forget every frame — a new room, not a rejoin (a rejoin keeps the room's clock). */
  clear(): void {
    this.#frames.length = 0;
    this.#offsets.length = 0;
  }

  /** The room's instant a local instant corresponds to, or `undefined` before the first frame. */
  roomTimeAt(localMs: number): number | undefined {
    if (this.#offsets.length === 0) return undefined;
    return localMs - Math.min(...this.#offsets);
  }

  /** The local instant a room instant corresponds to, or `undefined` before the first frame. */
  localTimeOf(roomMs: number): number | undefined {
    if (this.#offsets.length === 0) return undefined;
    return roomMs + Math.min(...this.#offsets);
  }

  /** The newest frame's entry for one rider, and the room's instant it describes. */
  newest(
    riderId: number,
  ): { readonly rider: DrawnRemoteRider; readonly roomMs: number } | undefined {
    const frame = this.#frames.at(-1);
    const rider = frame?.riders.get(riderId);
    return frame === undefined || rider === undefined ? undefined : { rider, roomMs: frame.roomMs };
  }

  /**
   * Every rider the frames carry, drawn at `localMs` less the render delay:
   * between the two frames bracketing that instant, and never past the newest.
   */
  at(localMs: number): readonly DrawnRemoteRider[] {
    const room = this.roomTimeAt(localMs);
    if (room === undefined) return [];
    const drawnAt = room - this.delayMs;
    const frames = this.#frames;
    const newest = frames.at(-1) as HeldFrame;
    const oldest = frames[0] as HeldFrame;
    if (drawnAt >= newest.roomMs) return [...newest.riders.values()];
    if (drawnAt <= oldest.roomMs) return [...oldest.riders.values()];
    let after = 1;
    while ((frames[after] as HeldFrame).roomMs < drawnAt) after += 1;
    const from = frames[after - 1] as HeldFrame;
    const to = frames[after] as HeldFrame;
    const share = (drawnAt - from.roomMs) / (to.roomMs - from.roomMs);
    const drawn: DrawnRemoteRider[] = [];
    for (const [riderId, end] of to.riders) {
      const start = from.riders.get(riderId);
      if (start === undefined) {
        // Arrived in the later frame: drawn there, not slid in from nowhere.
        drawn.push(end);
        continue;
      }
      drawn.push({
        riderId,
        distanceMetres: start.distanceMetres + (end.distanceMetres - start.distanceMetres) * share,
        speedMetresPerSecond:
          start.speedMetresPerSecond +
          (end.speedMetresPerSecond - start.speedMetresPerSecond) * share,
        flags: end.flags,
      });
    }
    return drawn;
  }
}
