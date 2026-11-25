// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3156: the demo video's scene script — what it may claim, its timing, and
 * the `.srt` and chapter list that come from it. Every shipped script is held
 * to no problems here, in the ordinary suite, as `capture -- --script` holds
 * it before it renders.
 */

import { BOT_TACTICS, type BotTactic } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import { CAPTURE_SCENES } from '../../src/game/capture-scene';
import { VIDEO_SCRIPTS } from './capture-args';
import {
  CALLOUT_PANELS,
  captionAt,
  cardLines,
  chapterTime,
  FADE_SECONDS,
  RIDING_PANELS,
  SCENE_FADE_SECONDS,
  sceneFade,
  scenePanels,
  scriptChapters,
  scriptProblems,
  scriptSeconds,
  scriptSrt,
  shownLines,
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

  it('holds delivery to a round with throws, and a lap race to a circuit', () => {
    const delivery = CAPTURE_SCENES.delivery;
    const race = CAPTURE_SCENES['lap-race'];
    if (delivery === undefined || race === undefined) throw new Error('no such capture scene');
    const scenes = {
      ...CAPTURE_SCENES,
      // A level ridden with no throw, and a lap race off a circuit.
      'no-throws': { ...delivery, cues: (delivery.cues ?? []).filter((c) => c.kind !== 'throw') },
      'off-circuit': { ...race, route: { id: 'level:somewhere', name: 'Somewhere' } },
    };
    for (const [feature, capture] of [
      ['delivery', 'no-throws'],
      ['lap-race', 'off-circuit'],
    ] as const) {
      const caption: VideoCaption = { at: 0, seconds: 4, text: 'A feature', feature };
      expect(scriptProblems(scriptOf({ capture }, [caption]), scenes)).toEqual([
        `test scene one, “A feature”: claims ${feature}, which the scene does not show`,
      ]);
    }
  });

  it('holds a callout to its panel’s mode, whatever the caption claims itself', () => {
    expect(
      problemsOf({ capture: 'workout' }, [
        { at: 0, seconds: 4, text: 'Houses', callout: 'houses', feature: 'workout' },
      ]),
    ).toEqual(['test scene one, “Houses”: claims delivery, which the scene does not show']);
    expect(
      problemsOf({ capture: 'delivery' }, [
        { at: 0, seconds: 4, text: 'Houses', callout: 'houses', feature: 'delivery' },
      ]),
    ).toEqual([]);
  });

  it('lets only the closing card name an instance-only feature, as optional on your own instance', () => {
    const statement = 'Optional on your own instance: an AI pacer and AI bots';
    const card = (lines: readonly string[], text = 'Free'): VideoCaption => ({
      at: 0,
      seconds: 6,
      text,
      placement: 'card',
      lines,
    });
    const withLast = (last: VideoScene, first: readonly VideoCaption[] = []): VideoScript => {
      const script = scriptOf({}, first);
      return { ...script, scenes: [...script.scenes, last] };
    };
    const closing = (caption: VideoCaption): VideoScene => ({
      id: 'closing',
      chapter: 'Closing',
      capture: 'route-hud',
      seconds: 10,
      captions: [caption],
    });
    // The closing card, so worded.
    expect(scriptProblems(withLast(closing(card([statement]))), CAPTURE_SCENES)).toEqual([]);
    // Anywhere else: a scene's caption, or a card that is not the last scene's.
    expect(problemsOf({ capture: 'lap-race' }, [{ at: 0, seconds: 4, text: 'AI bots' }])).toEqual([
      'test scene one, “AI bots”: names a feature only an instance runs, which only the closing card may state',
    ]);
    expect(problemsOf({ capture: 'lap-race' }, [{ at: 0, seconds: 4, text: statement }])).toEqual([
      `test scene one, “${statement}”: names a feature only an instance runs, which only the closing card may state`,
    ]);
    expect(
      scriptProblems(withLast(closing(card([])), [card([statement])]), CAPTURE_SCENES),
    ).toEqual([
      `test scene one, “${statement}”: names a feature only an instance runs, which only the closing card may state`,
    ]);
    // On the closing card, but as the card's words, or not worded as optional.
    expect(scriptProblems(withLast(closing(card([], statement))), CAPTURE_SCENES)).toEqual([
      `test scene closing, “${statement}”: names a feature only an instance runs, which only the closing card may state`,
    ]);
    expect(
      scriptProblems(withLast(closing(card(['Race AI bots on your instance']))), CAPTURE_SCENES),
    ).toEqual([
      'test scene closing, “Race AI bots on your instance”: names a feature only an instance runs, so the card says “Optional on your own instance:”',
    ]);
    // Lines are a card's or a title's, and the instance claim stays refused on the card.
    expect(problemsOf({}, [{ at: 0, seconds: 4, text: 'Free', lines: ['More'] }])).toEqual([
      'test scene one, “Free”: only a card or a title has lines under its words',
    ]);
    expect(
      scriptProblems(
        withLast(closing({ ...card([statement]), feature: 'instance' })),
        CAPTURE_SCENES,
      ),
    ).toEqual(['test scene closing, “Free”: claims instance, which the scene does not show']);
    // The shipped closing card says it, and no other caption of the script does.
    const said = YOUTUBE_SCRIPT.scenes.flatMap((scene) =>
      scene.captions.flatMap((caption) => [caption.text, ...(caption.lines ?? [])]),
    );
    expect(said.filter((text) => /\bAI\b|\binstance\b/iu.test(text))).toEqual([statement]);
    expect(YOUTUBE_SCRIPT.scenes.at(-1)?.captions.at(-1)?.lines).toEqual([
      'On Android, and in Chrome or Edge on your computer. iOS coming soon.',
      statement,
    ]);
  });

  it('opens on the logo with the platforms line beneath it, and says the line again on the closing card — #3175', () => {
    // The owner's wording of 2026-11-25 11:20Z, which replaced "On Android. Coming to iOS soon.".
    const platforms = 'On Android, and in Chrome or Edge on your computer. iOS coming soon.';
    const opening = YOUTUBE_SCRIPT.scenes[0]?.captions[0];
    expect(opening).toMatchObject({ placement: 'title', logo: true, lines: [platforms] });
    expect(shownLines(opening as VideoCaption)).toEqual([
      'Free, open-source indoor and outdoor cycling',
      platforms,
    ]);
    const card = YOUTUBE_SCRIPT.scenes.at(-1)?.captions.find((c) => c.placement === 'card');
    expect(card?.lines?.[0]).toBe(platforms);
    expect(shownLines(card as VideoCaption).slice(0, 2)).toEqual([
      'Free and open source',
      platforms,
    ]);
  });

  it('draws the logo over a title or a card alone, and lets a title carry lines — #3175', () => {
    expect(
      problemsOf({}, [
        { at: 0, seconds: 4, text: 'Free', placement: 'title', logo: true, lines: ['More'] },
      ]),
    ).toEqual([]);
    expect(
      problemsOf({}, [{ at: 0, seconds: 4, text: 'Free', placement: 'card', logo: true }]),
    ).toEqual([]);
    expect(problemsOf({}, [{ at: 0, seconds: 4, text: 'Free', logo: true }])).toEqual([
      'test scene one, “Free”: only a title or a card is drawn under the logo',
    ]);
    expect(
      problemsOf({}, [{ at: 0, seconds: 4, text: 'Free', callout: 'map', logo: true }]),
    ).toEqual(['test scene one, “Free”: only a title or a card is drawn under the logo']);
  });

  it('asks every riding scene for the whole HUD, and each mode for its own panels — #3175', () => {
    const of = (name: string): string[] => {
      const scene = CAPTURE_SCENES[name];
      if (scene === undefined) throw new Error(`no scene ${name}`);
      return scenePanels(scene);
    };
    expect(RIDING_PANELS).toEqual(['readings', 'totals', 'elevation', 'map', 'controls']);
    expect(of('route-hud')).toEqual([...RIDING_PANELS]);
    expect(of('free-ride')).toEqual([...RIDING_PANELS]);
    // A workout's strip is drawn in the map's place (#1307).
    expect(of('workout')).toEqual(['readings', 'totals', 'elevation', 'controls', 'workout']);
    expect(of('pacer')).toEqual([...RIDING_PANELS, 'pacer', 'best']);
    expect(of('lap-race')).toEqual([...RIDING_PANELS, 'standings', 'item']);
    expect(of('delivery')).toEqual([...RIDING_PANELS, 'houses', 'throw']);
    // Every one is a panel the page can find, the controls by the HUD's own class.
    expect(CALLOUT_PANELS.controls.selector).toBe('.oyl-hud__controls');
  });

  it('says in the lap race that the bots attack, chase and sit in, tactics they ride', () => {
    const race = YOUTUBE_SCRIPT.scenes.find((scene) => scene.capture === 'lap-race');
    expect(race?.captions).toContainEqual(
      expect.objectContaining({ text: 'Bots that attack, chase and sit in', callout: 'standings' }),
    );
    // Each one named is a tactic the on-device bots ride (ADR 0067).
    const named: readonly BotTactic[] = ['attack', 'chase', 'sit-in'];
    expect(BOT_TACTICS).toEqual(expect.arrayContaining(named));
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

  it('gives a card up to ten seconds, for the address and the credit under its words', () => {
    expect(
      problemsOf({ seconds: 12 }, [{ at: 1, seconds: 10, text: 'Free', placement: 'card' }]),
    ).toEqual([]);
    expect(
      problemsOf({ seconds: 12 }, [{ at: 1, seconds: 10.5, text: 'Free', placement: 'card' }]),
    ).toEqual(['test scene one, “Free”: is up for 10.5 seconds, not 3 to 10']);
    // Only a card: a title of the same length is refused as any caption.
    expect(
      problemsOf({ seconds: 12 }, [{ at: 1, seconds: 8, text: 'Free', placement: 'title' }]),
    ).toEqual(['test scene one, “Free”: is up for 8 seconds, not 3 to 6']);
  });

  it('closes on the logo, with the card up long enough to find the address — #3175', () => {
    const closing = YOUTUBE_SCRIPT.scenes.at(-1);
    const card = closing?.captions.find((caption) => caption.placement === 'card');
    expect(card).toMatchObject({ logo: true, seconds: 8 });
    expect((card?.at ?? 0) + (card?.seconds ?? 0)).toBe(closing?.seconds);
  });

  it('gives every caption read over the ride time to be read: three words a second at most', () => {
    for (const scene of YOUTUBE_SCRIPT.scenes) {
      for (const caption of scene.captions) {
        // The title and the card are read as a card, not in passing over the ride.
        if (caption.placement === 'card' || caption.placement === 'title') continue;
        const words = caption.text.split(/\s+/u).length;
        // The half-second fades are not reading time.
        expect(words / (caption.seconds - 2 * FADE_SECONDS), caption.text).toBeLessThanOrEqual(3);
      }
    }
  });

  it('starts no scene of the shipped script from a stop', () => {
    // A capture scene pulls off from rest; the first seconds are not shown.
    for (const scene of YOUTUBE_SCRIPT.scenes) {
      expect(scene.from ?? 0, scene.id).toBeGreaterThanOrEqual(2);
    }
  });

  it('fades each scene from black and to black, but for the closing card at the end', () => {
    const middle = { first: false, last: false };
    expect(sceneFade(0, 10, middle)).toBe(1);
    expect(sceneFade(SCENE_FADE_SECONDS / 2, 10, middle)).toBeCloseTo(0.5);
    expect(sceneFade(SCENE_FADE_SECONDS, 10, middle)).toBe(0);
    expect(sceneFade(5, 10, middle)).toBe(0);
    expect(sceneFade(10 - SCENE_FADE_SECONDS / 2, 10, middle)).toBeCloseTo(0.5);
    expect(sceneFade(10, 10, middle)).toBe(1);
    // The video opens from black, as every scene does.
    expect(sceneFade(SCENE_FADE_SECONDS / 2, 10, { first: true, last: false })).toBeCloseTo(0.5);
    // Its last frame is the closing card, not black.
    const last = { first: false, last: true };
    expect(sceneFade(10, 10, last)).toBe(0);
    expect(sceneFade(10 - SCENE_FADE_SECONDS / 2, 10, last)).toBe(0);
    expect(sceneFade(SCENE_FADE_SECONDS / 2, 10, last)).toBeCloseTo(0.5);
    // No caption of the shipped script is on screen while its scene is fading.
    YOUTUBE_SCRIPT.scenes.forEach((scene, index) => {
      const edges = { first: index === 0, last: index === YOUTUBE_SCRIPT.scenes.length - 1 };
      for (const caption of scene.captions) {
        expect(sceneFade(caption.at, scene.seconds, edges), caption.text).toBe(0);
        expect(sceneFade(caption.at + caption.seconds, scene.seconds, edges), caption.text).toBe(0);
      }
    });
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

  it('holds a card that ends its scene, with no fade out, to the scene’s last frame', () => {
    const closing = YOUTUBE_SCRIPT.scenes.at(-1);
    if (closing === undefined) throw new Error('no closing scene');
    const card = closing.captions.find((caption) => caption.placement === 'card');
    // A frame is taken at the end of its time: the last at the scene's last second.
    expect(captionAt(closing, closing.seconds)).toEqual({ caption: card, opacity: 1 });
    expect(captionAt(closing, closing.seconds - 0.1)?.opacity).toBe(1);
    // A card that ends before its scene does fades out, as any caption.
    const early: VideoScene = {
      id: 'one',
      capture: 'route-hud',
      seconds: 10,
      captions: [{ at: 2, seconds: 4, text: 'Card', placement: 'card' }],
    };
    expect(captionAt(early, 5.75)?.opacity).toBeCloseTo(0.5);
    expect(captionAt(early, 6)).toBeUndefined();
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
      'Get it free: github.com/openzigs/onyourleft',
    ]);
    const last = YOUTUBE_SCRIPT.scenes.at(-1);
    expect(last?.captions.some((caption) => caption.placement === 'card')).toBe(true);
  });
});
