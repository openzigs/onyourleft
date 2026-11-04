// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A steering controller's events as Delivery's intents (#1827), pure: each
 * mapping, the angle preferred, the bounds an angle cannot pass, and a flood
 * that cannot ask a frame for more than one of each.
 */

import { parseButtonState, type OpenBikeControlEvent } from '@onyourleft/sensors/protocol';
import { describe, expect, it } from 'vitest';

import {
  CENTRE_LANE_DEGREES,
  CONTROLLER_THROW_BUTTONS,
  controllerInputWaiting,
  drainControllerIntents,
  laneForAngle,
  MAX_PENDING,
  NO_CONTROLLER_INPUT,
  SIDE_LANE_DEGREES,
  takeControllerEvents,
  type ControllerInputState,
  type ControllerIntents,
} from './controller-input';
import { LANE_OFFSETS_METRES, startSteer, steerToLane } from './steer';

const press = (direction: 'left' | 'right', superseded = false): OpenBikeControlEvent => ({
  kind: 'steer',
  direction,
  pressed: true,
  superseded,
});
const release = (direction: 'left' | 'right'): OpenBikeControlEvent => ({
  kind: 'steer',
  direction,
  pressed: false,
  superseded: false,
});
const angle = (degrees: number): OpenBikeControlEvent => ({ kind: 'steering-angle', degrees });
const button = (id: number, pressed = true): OpenBikeControlEvent => ({
  kind: 'button',
  button: id,
  pressed,
  state: pressed ? 1 : 0,
});

/** Take each notification in turn, then drain once. */
function oneFrame(...notifications: (readonly OpenBikeControlEvent[])[]): ControllerIntents {
  let state: ControllerInputState = NO_CONTROLLER_INPUT;
  for (const events of notifications) state = takeControllerEvents(state, events);
  return drainControllerIntents(state).intents;
}

const NOTHING: ControllerIntents = { steer: undefined, lane: undefined, parcel: undefined };

describe('steer buttons', () => {
  it('ask for one lane each way a press, and nothing for a release', () => {
    expect(oneFrame([press('left')])).toEqual({ ...NOTHING, steer: 'lane-left' });
    expect(oneFrame([press('right')])).toEqual({ ...NOTHING, steer: 'lane-right' });
    expect(oneFrame([release('left')])).toEqual(NOTHING);
  });
});

describe('the handlebar angle', () => {
  it('points at the side lanes at or past the side threshold, and the centre near straight', () => {
    expect([SIDE_LANE_DEGREES, CENTRE_LANE_DEGREES]).toEqual([10, 5]);
    expect(laneForAngle(-SIDE_LANE_DEGREES, undefined)).toBe(0);
    expect(laneForAngle(SIDE_LANE_DEGREES, undefined)).toBe(2);
    expect(laneForAngle(CENTRE_LANE_DEGREES, 2)).toBe(1);
    expect(laneForAngle(-CENTRE_LANE_DEGREES, 0)).toBe(1);
  });

  it('keeps the lane it had between the two thresholds, so bars near one cannot flick it', () => {
    expect(laneForAngle(7, 2)).toBe(2);
    expect(laneForAngle(-7, 0)).toBe(0);
    expect(laneForAngle(7, 1)).toBe(1);
    expect(laneForAngle(7, undefined)).toBe(1);
  });

  it('never points past the outer lanes, at the specification’s extremes or from a bad byte', () => {
    expect(oneFrame([angle(-63)]).lane).toBe(0);
    expect(oneFrame([angle(63)]).lane).toBe(2);
    // 0xFF and 0x01 are no-op codes: the codec gives no event, so nothing is asked.
    for (const code of [0xff, 0x01]) {
      const read = parseButtonState(new DataView(Uint8Array.from([0x01, 0x1b, code]).buffer));
      expect(read.ok && read.events).toEqual([]);
      expect(oneFrame(read.ok ? read.events : [])).toEqual(NOTHING);
    }
    // Every lane any angle asks for is one of the three, so the rider is
    // never drawn past `racing-line.ts`' limit, as the lanes are not.
    for (let degrees = -63; degrees <= 63; degrees += 0.5) {
      const lane = laneForAngle(degrees, undefined);
      expect(LANE_OFFSETS_METRES[lane]).toBeDefined();
    }
  });

  it('asks for a lane only when the bars point at a new one', () => {
    let state = takeControllerEvents(NO_CONTROLLER_INPUT, [angle(30)]);
    state = drainControllerIntents(state).state;
    expect(drainControllerIntents(takeControllerEvents(state, [angle(40)])).intents.lane).toBe(
      undefined,
    );
    expect(drainControllerIntents(takeControllerEvents(state, [angle(0)])).intents.lane).toBe(1);
  });

  it('turns the round to the lane, and refuses none it does not have', () => {
    const start = startSteer(0);
    expect(steerToLane(start, 2).lane).toBe(2);
    expect(steerToLane(start, 1)).toBe(start);
    for (const bad of [-1, 3, 1.5, Number.NaN]) expect(steerToLane(start, bad)).toBe(start);
  });
});

describe('the angle is preferred', () => {
  it('drops a steer sent beside an available angle', () => {
    const read = parseButtonState(
      new DataView(Uint8Array.from([0x01, 0x18, 0x01, 0x1b, 0x94]).buffer),
    );
    if (!read.ok) throw new Error('the fixture did not parse');
    expect(oneFrame(read.events)).toEqual({ ...NOTHING, lane: 2 });
  });

  it('drops steer buttons while the angle is available, and takes them again once it goes', () => {
    expect(oneFrame([angle(0)], [press('left')])).toEqual({ ...NOTHING, lane: 1 });
    expect(oneFrame([angle(0)], [{ kind: 'steering-angle-unavailable' }], [press('left')])).toEqual(
      { ...NOTHING, steer: 'lane-left' },
    );
  });

  it('forgets a lane the angle asked for when the angle goes before a frame takes it', () => {
    expect(oneFrame([angle(30)], [{ kind: 'steering-angle-unavailable' }])).toEqual(NOTHING);
  });
});

describe('throws', () => {
  it('Power-up 1 throws left and Power-up 2 right, a press each; a release and other buttons nothing', () => {
    expect(CONTROLLER_THROW_BUTTONS).toEqual({ 0x50: 'left', 0x51: 'right' });
    expect(oneFrame([button(0x50)])).toEqual({ ...NOTHING, parcel: 'left' });
    expect(oneFrame([button(0x51)])).toEqual({ ...NOTHING, parcel: 'right' });
    expect(oneFrame([button(0x50, false)])).toEqual(NOTHING);
    expect(oneFrame([button(0x52), button(0x01), button(0x30)])).toEqual(NOTHING);
  });
});

describe('a flood is bounded', () => {
  it('asks a frame for one of each however much arrives, and keeps a bounded state', () => {
    let state: ControllerInputState = NO_CONTROLLER_INPUT;
    for (let index = 0; index < 50_000; index += 1) {
      state = takeControllerEvents(state, [
        index % 2 === 0 ? press('left') : press('right'),
        button(0x50),
        button(0x51),
      ]);
      expect(state.steers.length).toBeLessThanOrEqual(MAX_PENDING);
      expect(state.throws.length).toBeLessThanOrEqual(MAX_PENDING);
    }
    expect(MAX_PENDING).toBe(2);
    const first = drainControllerIntents(state);
    expect(first.intents).toEqual({ steer: 'lane-left', lane: undefined, parcel: 'left' });
    const second = drainControllerIntents(first.state);
    expect(second.intents).toEqual({ steer: 'lane-right', lane: undefined, parcel: 'right' });
    expect(controllerInputWaiting(second.state)).toBe(false);
  });

  it('keeps only the newest angle’s lane from a flood of angles', () => {
    let state: ControllerInputState = NO_CONTROLLER_INPUT;
    for (let index = 0; index < 50_000; index += 1) {
      state = takeControllerEvents(state, [angle(index % 2 === 0 ? -40 : 40)]);
    }
    expect(drainControllerIntents(state).intents).toEqual({ ...NOTHING, lane: 2 });
  });
});

describe('nothing waits once drained', () => {
  it('says whether anything waits for a frame', () => {
    expect(controllerInputWaiting(NO_CONTROLLER_INPUT)).toBe(false);
    expect(controllerInputWaiting(takeControllerEvents(NO_CONTROLLER_INPUT, [press('left')]))).toBe(
      true,
    );
  });
});
