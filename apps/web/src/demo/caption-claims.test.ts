// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { captionScriptProblems } from './caption-claims';
import { CAPTION_SCRIPTS, type Caption, type CaptionScene } from './caption-script';

/** A script of one scene, `scene` over a hill scene's defaults. */
function problemsOf(scene: Partial<CaptionScene>, captions: readonly Caption[]): string[] {
  return captionScriptProblems({
    id: 'test',
    scenes: [{ id: 'one', preset: 'hill', seconds: 20, ...scene, captions }],
  });
}

describe('what a caption script may claim — #3074', () => {
  it.each(Object.entries(CAPTION_SCRIPTS))(
    'the %s script claims only what it shows',
    (_name, script) => {
      expect(captionScriptProblems(script)).toEqual([]);
    },
  );

  it('holds a climb caption to a scene whose lead rider is on a climb for its whole time', () => {
    const climb: Caption = { at: 4, seconds: 6, text: 'Feel every climb', feature: 'climb' };
    expect(problemsOf({ preset: 'hill' }, [climb])).toEqual([]);
    // The climb preset is two minutes of flat before its climb.
    expect(problemsOf({ preset: 'climb' }, [climb])).toEqual([
      'test scene one, “Feel every climb”: claims climb, which the scene does not show',
    ]);
  });

  it('holds a group caption to two riders or more in the camera’s frame for its whole time', () => {
    const group: Caption = { at: 2, seconds: 4, text: 'Ride as a group', feature: 'group' };
    // The group tour's roadside shot, 37 s to 45 s, frames all four.
    expect(
      problemsOf({ preset: 'group', seconds: 41 }, [{ ...group, at: 37, seconds: 3.5 }]),
    ).toEqual([]);
    // Behind the lead, the rest of the group is behind the camera.
    expect(problemsOf({ preset: 'group' }, [group])).toEqual([
      'test scene one, “Ride as a group”: claims group, which the scene does not show',
    ]);
    expect(
      problemsOf({ preset: 'sprint', seconds: 41 }, [{ ...group, at: 37, seconds: 3.5 }]),
    ).toEqual(['test scene one, “Ride as a group”: claims group, which the scene does not show']);
  });

  it('holds a map-data caption to a scene that rides the render’s baked route', () => {
    const map: Caption = { at: 2, seconds: 4, text: 'Your routes', feature: 'map-data' };
    expect(problemsOf({ route: true }, [map])).toEqual([]);
    expect(problemsOf({}, [map])).toEqual([
      'test scene one, “Your routes”: claims map-data, which the scene does not show',
    ]);
  });

  it.each([
    ['Lower your TSS', 'TSS'],
    ['Track IF and CTL', 'IF'],
    ['See your NP', 'NP'],
    ['Better than Zwift', 'zwift'],
    ['Sync with strava', 'strava'],
    ['Validated power', 'validated'],
    ['Accurate to a watt', 'accurate to'],
    ['A professional fit at home', 'professional fit'],
  ])('refuses %j, which may not say %j', (text, word) => {
    expect(problemsOf({}, [{ at: 2, seconds: 4, text }])).toEqual([
      `test scene one, “${text}”: may not say “${word}”`,
    ]);
  });

  it('control: says “if” and “np” as ordinary words, where they are no trademark', () => {
    expect(problemsOf({}, [{ at: 2, seconds: 4, text: 'Ride if you like, snappy' }])).toEqual([]);
  });

  it('keeps each caption readable, inside its scene, and a second from the next', () => {
    expect(
      problemsOf({ seconds: 10 }, [
        { at: 0, seconds: 2, text: 'Short' },
        { at: 2.5, seconds: 4, text: 'Close' },
        { at: 8, seconds: 4, text: 'Late', fadeSeconds: 2.5 },
        { at: 1, seconds: 3, text: ' ' },
      ]),
    ).toEqual([
      'test scene one, “Short”: is up for under 3 seconds',
      'test scene one, “Short”: is less than 1 second from the next',
      'test scene one: a caption says nothing',
      'test scene one, “ ”: is less than 1 second from the next',
      'test scene one, “Late”: runs outside its scene’s 10 seconds',
      'test scene one, “Late”: its fades are longer than it is',
    ]);
  });

  it('refuses a scene with no preset, a bad or repeated id, or part of a second', () => {
    expect(
      captionScriptProblems({
        id: 'test',
        scenes: [
          { id: 'Bad id', preset: 'hill', seconds: 2.5, captions: [] },
          { id: 'Bad id', preset: 'descent' as 'hill', seconds: 4, captions: [] },
        ],
      }),
    ).toEqual([
      'test scene Bad id: a scene’s id is lowercase letters, digits and hyphens',
      'test scene Bad id: a scene is a whole number of seconds, not 2.5',
      'test scene Bad id: a scene’s id is lowercase letters, digits and hyphens',
      'test scene Bad id: the id is used twice',
      'test scene Bad id: there is no preset descent',
    ]);
    expect(captionScriptProblems({ id: 'empty', scenes: [] })).toEqual(['empty has no scenes']);
  });
});
