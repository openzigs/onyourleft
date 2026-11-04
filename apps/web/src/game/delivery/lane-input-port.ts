// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a steering controller's handlebar angle asks for a lane — #1827. The
 * HUD's `ControllerIntents` hands the lane the bars point at to the ride, and
 * `GameView` turns the round's steering to it (`steer.ts` §`steerToLane`).
 *
 * A port of its own beside `steer-port.ts`, whose one method takes a lane to
 * the left or the right: the angle names a lane, not a step, and the keys'
 * port is held to its one method (`steer.test.ts`). Like it, this carries a
 * lane and nothing else: no path to the trainer.
 */

export interface LaneInputPort {
  /** The rider's bars point at lane `lane`, an index into `LANE_OFFSETS_METRES`. */
  steerToLane(lane: number): void;
}
