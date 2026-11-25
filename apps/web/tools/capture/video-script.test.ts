// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3156: the demo video's scene script — what it may claim, its timing, and
 * the `.srt` and chapter list that come from it. Every shipped script is held
 * to no problems here, in the ordinary suite, as `capture -- --script` holds
 * it before it renders.
 */

import { describe, expect, it } from 'vitest';

import { CAPTURE_SCENES } from '../../src/game/capture-scene';
import { VIDEO_SCRIPTS } from './capture-args';
import {
  CALLOUT_PANELS,
  captionAt,
  cardLines,
  chapterTime,
  scriptChapters,
  scriptProblems,
  scriptSeconds,
  scriptSrt,
  srtTime,
  type CalloutPanel,
  type VideoCaption,
  type VideoFeature,
  type VideoScene,
  type VideoScript,
} from './video-script';
import { YOUTUBE_SCRIPT } from './scripts/youtube';

/** Three ten-second chapters, so a test of one scene's rules sees none of the chapters'. */
function scriptOf(scene: Partial<VideoScene>, captions: readonly VideoCaption[]): VideoScript {
  return {
    id: 'test',
    scenes: [
      { id: 'one', chapter: 'One', capture: 'route-hud', seconds: 10, ...scene, captions },
      { id: 'two', chapter: 'Two', capture: 'route-hud', seconds: 10, captions: [] },
      { id: 'three', chapter: 'Three', capture: 'route-hud', seconds: 10, captions: [] },
    ],
  };
}

function problemsOf(scene: Partial<VideoScene>, captions: readonly VideoCaption[]): string[] {
  return scriptProblems(scriptOf(scene, captions), CAPTURE_SCENES);
}

describe('the demo video’s scene script — #3156', () => {
  it.each(Object.entries(VIDEO_SCRIPTS))('the %s script may be rendered', (_name, script) => {
    expect(scriptProblems(script, CAPTURE_SCENES)).toEqual([]);
  });

  it('rides every mode a capture scene has, and leaves the instance scenes to #3155', () => {
    const ridden = new Set(YOUTUBE_SCRIPT.scenes.map((scene) => scene.capture));
    expect([...ridden].sort()).toEqual(Object.keys(CAPTURE_SCENES).sort());
    expect(
      YOUTUBE_SCRIPT.scenes
        .flatMap((scene) => scene.captions)
        .some((c) => c.feature === 'instance'),
    ).toBe(false);
    // About the epic's two and a half to three minutes, less the two instance scenes.
    expect(scriptSeconds(YOUTUBE_SCRIPT)).toBeGreaterThanOrEqual(120);
    expect(scriptSeconds(YOUTUBE_SCRIPT)).toBeLessThanOrEqual(180);
  });

  // One row a claim: the scene that rides the mode, where it is accepted, and
  // one that does not, where it is refused.
  it.each<[VideoFeature, string, number, string]>([
    ['delivery', 'delivery', 0, 'lap-race'],
    ['lap-race', 'lap-race', 0, 'delivery'],
    ['workout', 'workout', 0, 'pacer'],
    ['junction', 'free-ride', 2, 'route-hud'],
    ['pacer', 'pacer', 0, 'workout'],
  ])('accepts a %s caption only on a scene that rides it', (feature, shows, at, not) => {
    const caption: VideoCaption = { at, seconds: 4, text: 'A feature', feature };
    expect(problemsOf({ capture: shows }, [caption])).toEqual([]);
    expect(problemsOf({ capture: not }, [caption])).toEqual([
      `test scene one, “A feature”: claims ${feature}, which the scene does not show`,
    ]);
    // The synthetic route's plain ride shows none of them.
    expect(problemsOf({}, [caption])).toEqual([
      `test scene one, “A feature”: claims ${feature}, which the scene does not show`,
    ]);
  });

  it('refuses an instance caption on every capture scene, until #3155 rides one', () => {
    for (const capture of Object.keys(CAPTURE_SCENES)) {
      expect(
        problemsOf({ capture }, [{ at: 0, seconds: 4, text: 'Group rides', feature: 'instance' }]),
      ).toEqual(['test scene one, “Group rides”: claims instance, which the scene does not show']);
    }
  });

  it('holds a junction caption to the free ride’s first scripted turn, counting from', () => {
    const junction: VideoCaption = { at: 1, seconds: 4, text: 'Turn', feature: 'junction' };
    expect(problemsOf({ capture: 'free-ride' }, [junction])).toEqual([
      'test scene one, “Turn”: claims junction, which the scene does not show',
    ]);
    // The same caption, the scene written from a second into its ride.
    expect(problemsOf({ capture: 'free-ride', from: 1 }, [junction])).toEqual([]);
  });

  it('holds a callout to a panel only its mode draws to that mode', () => {
    const modal = (Object.entries(CALLOUT_PANELS) as [string, CalloutPanel][]).filter(
      ([, panel]) => panel.feature !== undefined,
    );
    expect(modal.map(([name]) => name).sort()).toEqual(
      ['best', 'houses', 'item', 'junction', 'pacer', 'standings', 'throw', 'workout'].sort(),
    );
    for (const [name, panel] of modal) {
      expect(
        problemsOf({}, [
          { at: 0, seconds: 4, text: 'There', callout: name as keyof typeof CALLOUT_PANELS },
        ]),
      ).toEqual([
        `test scene one, “There”: claims ${String(panel.feature)}, which the scene does not show`,
      ]);
    }
    expect(problemsOf({}, [{ at: 0, seconds: 4, text: 'There', callout: 'gradient' }])).toEqual([]);
  });

  it('refuses a caption up for under three seconds or over six, outside its scene, or too near the next', () => {
    expect(
      problemsOf({}, [
        { at: 0, seconds: 2.5, text: 'Short' },
        { at: 3, seconds: 3, text: 'Close' },
        { at: 6.5, seconds: 6.5, text: 'Long and late' },
      ]),
    ).toEqual([
      'test scene one, “Short”: is up for 2.5 seconds, not 3 to 6',
      'test scene one, “Short”: is less than 1 second from the next',
      'test scene one, “Close”: is less than 1 second from the next',
      'test scene one, “Long and late”: runs outside its scene’s 10 seconds',
      'test scene one, “Long and late”: is up for 6.5 seconds, not 3 to 6',
    ]);
  });

  it('refuses the words no caption may say', () => {
    expect(problemsOf({}, [{ at: 0, seconds: 4, text: 'Lower your TSS' }])).toEqual([
      'test scene one, “Lower your TSS”: may not say “TSS”',
    ]);
    expect(problemsOf({}, [{ at: 0, seconds: 4, text: 'Better than Zwift' }])).toEqual([
      'test scene one, “Better than Zwift”: may not say “zwift”',
    ]);
  });

  it('refuses a short scene, a part second, an unknown scene or panel, and a placed callout', () => {
    expect(
      scriptProblems(
        {
          id: 'test',
          scenes: [
            { id: 'Bad', chapter: 'A', capture: 'route-hud', seconds: 5, from: 0.5, captions: [] },
            { id: 'two', chapter: 'B', capture: 'nowhere', seconds: 10, captions: [] },
            {
              id: 'two',
              chapter: 'C',
              capture: 'route-hud',
              seconds: 10,
              captions: [
                { at: 0, seconds: 3, text: 'A', callout: 'nowhere' as 'map' },
                { at: 4, seconds: 3, text: 'B', callout: 'map', placement: 'title' },
                { at: 8, seconds: 0, text: ' ' },
              ],
            },
          ],
        },
        CAPTURE_SCENES,
      ),
    ).toEqual([
      'test scene Bad: a scene’s id is lowercase letters, digits and hyphens',
      'test scene Bad: a scene is a whole number of seconds, 6 or more, not 5',
      'test scene Bad: from is a whole number of seconds, not 0.5',
      'test scene two: there is no capture scene nowhere',
      'test scene two: the id is used twice',
      'test scene two, “A”: there is no HUD panel nowhere',
      'test scene two, “B”: a callout is drawn beside its panel, so it has no placement',
      'test scene two: a caption says nothing',
      'test scene two, “ ”: is up for 0 seconds, not 3 to 6',
      'test chapter “A”: 5 seconds, and YouTube’s are 10 or more',
    ]);
  });

  it('keeps YouTube’s chapter rules: the first at 0:00, three or more, each ten seconds or longer', () => {
    expect(
      scriptProblems(
        {
          id: 'test',
          scenes: [
            { id: 'one', capture: 'route-hud', seconds: 10, captions: [] },
            { id: 'two', chapter: 'Two', capture: 'route-hud', seconds: 10, captions: [] },
          ],
        },
        CAPTURE_SCENES,
      ),
    ).toEqual([
      'test: the first scene starts no chapter, and YouTube’s first is at 0:00',
      'test: 1 chapters, and YouTube reads 3 or more',
    ]);
    expect(scriptProblems({ id: 'empty', scenes: [] }, CAPTURE_SCENES)).toEqual([
      'empty has no scenes',
      'empty: 0 chapters, and YouTube reads 3 or more',
    ]);
  });

  it('fades each caption in and out over half a second', () => {
    const scene: VideoScene = {
      id: 'one',
      capture: 'route-hud',
      seconds: 10,
      captions: [{ at: 2, seconds: 4, text: 'Hello' }],
    };
    expect(captionAt(scene, 1.99)).toBeUndefined();
    expect(captionAt(scene, 2.25)?.opacity).toBeCloseTo(0.5);
    expect(captionAt(scene, 4)?.opacity).toBe(1);
    expect(captionAt(scene, 5.75)?.opacity).toBeCloseTo(0.5);
    expect(captionAt(scene, 6)).toBeUndefined();
  });

  it('writes every caption into the .srt, timed in the whole video', () => {
    const script = scriptOf({ seconds: 70 }, [
      { at: 61.25, seconds: 4, text: 'Second' },
      { at: 1, seconds: 3, text: 'First' },
    ]);
    const withCard: VideoScript = {
      ...script,
      scenes: [
        ...script.scenes,
        {
          id: 'four',
          capture: 'route-hud',
          seconds: 10,
          captions: [{ at: 0, seconds: 6, text: 'Free', placement: 'card' }],
        },
      ],
    };
    expect(scriptSrt(withCard)).toBe(
      [
        '1\n00:00:01,000 --> 00:00:04,000\nFirst\n',
        '2\n00:01:01,250 --> 00:01:05,250\nSecond\n',
        `3\n00:01:30,000 --> 00:01:36,000\nFree\n${cardLines().join('\n')}\n`,
      ].join('\n'),
    );
    expect(srtTime(3_723.0456)).toBe('01:02:03,046');
  });

  it('lists a chapter for each scene that starts one, as YouTube reads them', () => {
    expect(scriptChapters(scriptOf({ seconds: 75 }, []))).toBe('0:00 One\n1:15 Two\n1:25 Three\n');
    expect(chapterTime(3_725)).toBe('1:02:05');
    expect(scriptChapters(YOUTUBE_SCRIPT).split('\n')[0]).toBe('0:00 On Your Left');
  });

  it('puts the map credit and the project’s address on the closing card', () => {
    expect(cardLines()).toEqual([
      'Map data © OpenStreetMap contributors',
      expect.stringContaining('OpenStreetMap'),
      'OpenStreetMap: https://www.openstreetmap.org/copyright',
      'Open Database License: https://opendatacommons.org/licenses/odbl/1-0/',
      'On Your Left: https://github.com/openzigs/onyourleft',
    ]);
    const last = YOUTUBE_SCRIPT.scenes.at(-1);
    expect(last?.captions.some((caption) => caption.placement === 'card')).toBe(true);
  });
});
