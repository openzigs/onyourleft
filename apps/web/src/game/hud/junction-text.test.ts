// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the junction prompt says (#2898, ADR 0088 D-3): its words, and the
 * sentences owed to the HUD's one region as a junction appears, as the choice
 * changes and as it locks. That they reach the region through `announce.ts`
 * and the HUD is `JunctionChoicePrompt.a11y.test.tsx`'s.
 */

import { describe, expect, it } from 'vitest';

import type { JunctionPrompt } from '../open-world/junction-choice';
import { starRide } from '../open-world/junction-ride-testing';
import {
  junctionEvent,
  junctionSpoken,
  lockLine,
  NO_JUNCTION_ANNOUNCED,
  TURN_NOTICE_WORDS,
  wayWord,
  type JunctionAnnounced,
} from './junction-text';

describe('a way’s name, by its turn', () => {
  it('is straight on, a bear, a turn or a sharp turn, left or right', () => {
    expect([0, 15, -15].map(wayWord)).toEqual(['Straight on', 'Straight on', 'Straight on']);
    expect([16, -16, 60, -60].map(wayWord)).toEqual([
      'Bear right',
      'Bear left',
      'Bear right',
      'Bear left',
    ]);
    expect([61, -61, 135, -135].map(wayWord)).toEqual(['Right', 'Left', 'Right', 'Left']);
    expect([136, -136, 180].map(wayWord)).toEqual(['Sharp right', 'Sharp left', 'Sharp right']);
  });
});

describe('how far until the choice is final', () => {
  it('is said in tens of the rider’s own unit', () => {
    expect(lockLine(150, 'metric')).toBe('Choice locks in 150 m');
    expect(lockLine(144, 'metric')).toBe('Choice locks in 140 m');
    expect(lockLine(3, 'metric')).toBe('Choice locks in 10 m');
    expect(lockLine(150, 'imperial')).toBe('Choice locks in 490 ft');
  });
});

/** One frame: offer, and say it at once when `said`. */
function frame(
  announced: JunctionAnnounced,
  shown: JunctionPrompt | undefined,
  said = true,
): { readonly text: string | undefined; readonly announced: JunctionAnnounced } {
  const step = junctionEvent(announced, shown);
  return {
    text: step.event?.text,
    announced: said ? junctionSpoken(step.announced, step.event?.kind) : step.announced,
  };
}

describe('what the region is told, and when (ADR 0088 D-3)', () => {
  it('says the ways and the default as it appears, a choice as it changes, and the lock', () => {
    const { route, choice, junction, rider, ids } = starRide([-90, 0, 90]);
    let state = NO_JUNCTION_ANNOUNCED;
    const heard: (string | undefined)[] = [];
    const at = (where: number) => {
      const step = frame(state, choice.prompt(where));
      state = step.announced;
      heard.push(step.text);
    };
    at(rider);
    at(rider + 5);
    choice.press('left', rider + 5);
    at(rider + 10);
    route.choose(junction.distance, ids[1] as string, rider + 10);
    at(rider + 15);
    at(junction.distance - 100);
    at(junction.distance - 50);
    at(junction.distance + 1);
    expect(heard).toEqual([
      'Junction ahead: left, straight on or right. The default is straight on.',
      undefined,
      'Chosen: left.',
      'Chosen: straight on, the default.',
      'Junction choice locked: straight on.',
      undefined,
      undefined,
    ]);
  });

  it('owes a sentence until the announcer says it, and replaces it with a newer one', () => {
    const { choice, junction, rider } = starRide([-90, 0, 90]);
    let state = NO_JUNCTION_ANNOUNCED;
    let step = frame(state, choice.prompt(rider), false);
    expect(step.text).toMatch(/^Junction ahead/);
    // Not said this frame (a higher event held the window): offered again.
    step = frame(step.announced, choice.prompt(rider + 5), false);
    expect(step.text).toMatch(/^Junction ahead/);
    // Said by another kind: still owed.
    state = junctionSpoken(step.announced, 'trainer-lost');
    step = frame(state, choice.prompt(rider + 6), false);
    expect(step.text).toMatch(/^Junction ahead/);
    // Locked before it was said: the lock, which names the way taken, replaces it.
    step = frame(step.announced, choice.prompt(junction.distance - 90));
    expect(step.text).toBe('Junction choice locked: straight on.');
    // A junction passed owes nothing, even unsaid.
    step = frame(NO_JUNCTION_ANNOUNCED, choice.prompt(rider), false);
    step = frame(step.announced, choice.prompt(junction.distance + 1), false);
    expect(step.text).toBeUndefined();
    expect(step.announced).toEqual(NO_JUNCTION_ANNOUNCED);
  });

  it('says a turn notice once, before the junction’s own sentence, and with no junction prompted — #3058', () => {
    const { choice, rider } = starRide([-90, 0, 90]);
    const turning = { kind: 'turning-round', since: 4 } as const;
    // With no junction prompted: said, once, however many frames it stands.
    let step = junctionEvent(NO_JUNCTION_ANNOUNCED, undefined, turning);
    expect(step.event?.text).toBe(TURN_NOTICE_WORDS['turning-round'].said);
    let state = junctionSpoken(step.announced, step.event?.kind);
    step = junctionEvent(state, undefined, turning);
    expect(step.event).toBeUndefined();
    // Not said this frame: owed, and still owed past a junction appearing,
    // whose sentence comes the frame after it.
    const early = { kind: 'no-junction', since: 9 } as const;
    step = junctionEvent(step.announced, undefined, early);
    expect(step.event?.text).toBe(TURN_NOTICE_WORDS['no-junction'].said);
    step = junctionEvent(step.announced, choice.prompt(rider), early);
    expect(step.event?.text).toBe(TURN_NOTICE_WORDS['no-junction'].said);
    state = junctionSpoken(step.announced, step.event?.kind);
    step = junctionEvent(state, choice.prompt(rider + 1), early);
    expect(step.event?.text).toMatch(/^Junction ahead/);
    state = junctionSpoken(step.announced, step.event?.kind);
    expect(junctionEvent(state, choice.prompt(rider + 2), early).event).toBeUndefined();
  });

  it('says a junction is too close to choose when its prompt appears already locked (D-1.5)', () => {
    const { choice, junction } = starRide([-90, 0]);
    const step = frame(NO_JUNCTION_ANNOUNCED, choice.prompt(junction.distance - 60));
    expect(step.text).toBe('Junction ahead, too close to choose: straight on.');
  });
});
