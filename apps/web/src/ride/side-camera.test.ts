// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The side camera as a ride shows it — #551. Pure: which line, whether it can
 * be stopped from the ride, and when its link going is an event.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import type { SideControlState } from '../camera/side-pairing-port';
import { stripComments } from '../units/no-inline-units';

import {
  SIDE_CAMERA_LOST_SENTENCE,
  sideCameraLine,
  sideCameraLost,
  sideCameraLostEvent,
  sideCameraOnRide,
  sideCameraStoppable,
} from './side-camera';

const paired = (overrides: Partial<SideControlState> = {}): SideControlState => ({
  phone: 'filming',
  answered: true,
  stopReason: undefined,
  command: undefined,
  ended: undefined,
  ...overrides,
});

describe('the line — #551’s first criterion', () => {
  it('says filming, stopped and link lost, the three the issue names', () => {
    expect(sideCameraOnRide(paired())).toBe('filming');
    expect(sideCameraOnRide(paired({ phone: 'stopped', stopReason: 'rider' }))).toBe('stopped');
    expect(sideCameraOnRide(paired({ phone: 'lost' }))).toBe('lost');
    expect(sideCameraLine('filming')).toBe('Side camera: filming.');
  });

  it('says nothing with no pairing, and nothing for an offer nobody has answered', () => {
    expect(sideCameraOnRide(undefined)).toBeUndefined();
    expect(sideCameraOnRide(paired({ phone: 'pairing', answered: false }))).toBeUndefined();
    // Answered, and the phone has not proved itself yet: still not paired.
    expect(sideCameraOnRide(paired({ phone: 'pairing' }))).toBeUndefined();
  });

  it('says a camera that is on and not filming is not filming', () => {
    expect(sideCameraOnRide(paired({ phone: 'framing' }))).toBe('framing');
    expect(sideCameraLine('framing')).toContain('not filming');
  });

  it('calls a link that went and ended the pairing lost, not ended', () => {
    // `side-link.ts` §`#end` sets the phone lost for `link-lost`.
    expect(sideCameraOnRide(paired({ phone: 'lost', ended: 'link-lost' }))).toBe('lost');
  });

  it('calls a stop the tablet asked for, and the pairing that closed after it, stopped', () => {
    expect(
      sideCameraOnRide(paired({ phone: 'stopped', stopReason: 'tablet', ended: 'ended-here' })),
    ).toBe('stopped');
  });

  it('does not call a pairing that ended some other way stopped', () => {
    expect(sideCameraOnRide(paired({ phone: 'filming', ended: 'broken' }))).toBe('ended');
  });

  it('says where a stop the rider pressed has got to', () => {
    expect(sideCameraOnRide(paired({ command: { kind: 'stop', status: 'waiting' } }))).toBe(
      'stopping',
    );
    expect(sideCameraOnRide(paired({ command: { kind: 'stop', status: 'unacknowledged' } }))).toBe(
      'stop-unconfirmed',
    );
    // A stop the phone has confirmed is not in progress: the phone's own
    // state says where it is, and "stopped" arrives with it.
    expect(sideCameraOnRide(paired({ command: { kind: 'stop', status: 'acknowledged' } }))).toBe(
      'filming',
    );
    // A start the Camera screen sent is not a stop in progress.
    expect(sideCameraOnRide(paired({ command: { kind: 'start', status: 'waiting' } }))).toBe(
      'filming',
    );
  });
});

describe('stopping from the ride — #551’s third criterion', () => {
  it('is offered while the phone films, and while the link is lost', () => {
    expect(sideCameraStoppable(paired())).toBe(true);
    expect(sideCameraStoppable(paired({ phone: 'lost' }))).toBe(true);
  });

  it('is not offered with nothing to stop, or once the pairing has ended', () => {
    expect(sideCameraStoppable(undefined)).toBe(false);
    expect(sideCameraStoppable(paired({ phone: 'framing' }))).toBe(false);
    expect(sideCameraStoppable(paired({ phone: 'stopped', stopReason: 'rider' }))).toBe(false);
    expect(sideCameraStoppable(paired({ phone: 'lost', ended: 'link-lost' }))).toBe(false);
    expect(sideCameraStoppable(paired({ answered: false }))).toBe(false);
  });
});

describe('the link going — #551’s second criterion', () => {
  it('is an event on the step from not lost to lost, and on no other', () => {
    expect(sideCameraLostEvent(false, paired({ phone: 'lost' }))).toEqual({
      kind: 'side-camera-lost',
      text: SIDE_CAMERA_LOST_SENTENCE,
    });
    // Already lost: said once, not every frame.
    expect(sideCameraLostEvent(true, paired({ phone: 'lost' }))).toBeUndefined();
    // Not lost.
    expect(sideCameraLostEvent(false, paired())).toBeUndefined();
    expect(sideCameraLostEvent(true, paired())).toBeUndefined();
    expect(sideCameraLostEvent(false, undefined)).toBeUndefined();
  });

  it('reads lost the way the line does', () => {
    expect(sideCameraLost(paired({ phone: 'lost' }))).toBe(true);
    expect(sideCameraLost(paired({ phone: 'lost', answered: false }))).toBe(false);
    expect(sideCameraLost(paired())).toBe(false);
  });
});

describe('no picture on the tablet — #551’s fourth criterion, ADR 0033', () => {
  // The ride's half of the side camera reads the phone's STATE and nothing
  // else. A name that reaches the pictures, or the pose model that looks at
  // them, in any of these files is how a preview would arrive.
  const files = ['side-camera.ts', 'useSideCamera.ts', 'SideCameraOnRide.tsx'];
  for (const file of files) {
    it(`${file} reaches neither the pictures nor the analysis of them`, () => {
      // Code only: the files' own notes name what they do not read.
      const source = stripComments(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8'));
      expect(source).not.toMatch(
        /onSideCameraPicture|\.analysis\b|SidePicture|<img|<video|<canvas/,
      );
    });
  }
});
