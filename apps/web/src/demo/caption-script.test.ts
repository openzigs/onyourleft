// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';

import { YOUTUBE_CAPTIONS } from '../../demo/captions/youtube';
import {
  CAPTION_SCRIPTS,
  captionAt,
  captionFrames,
  isCaptionScriptId,
  scriptSeconds,
  type CaptionScene,
  type CaptionScript,
} from './caption-script';

const SCENE: CaptionScene = {
  id: 'one',
  preset: 'group',
  seconds: 12,
  captions: [
    { at: 1, seconds: 4, text: 'First', placement: 'title' },
    { at: 6, seconds: 4, text: 'Second', fadeSeconds: 1, feature: 'map-data' },
  ],
};

const ALL = { reducedMotion: false, shows: () => true } as const;

describe('when a caption is on screen — #3074', () => {
  it.each([
    [0.99, undefined],
    [1, undefined],
    [1.25, { text: 'First', placement: 'title', opacity: 0.5 }],
    [1.5, { text: 'First', placement: 'title', opacity: 1 }],
    [4.75, { text: 'First', placement: 'title', opacity: 0.5 }],
    [5, undefined],
    [6.5, { text: 'Second', placement: 'lower-third', opacity: 0.5 }],
    [8, { text: 'Second', placement: 'lower-third', opacity: 1 }],
    [9.5, { text: 'Second', placement: 'lower-third', opacity: 0.5 }],
    [10, undefined],
  ])('at %s s shows %j', (seconds, shown) => {
    expect(captionAt(SCENE, seconds, ALL)).toEqual(shown);
  });

  it('cuts in and out under reduced motion: whole for its whole time, and only then', () => {
    const still = { ...ALL, reducedMotion: true };
    expect(captionAt(SCENE, 1.01, still)?.opacity).toBe(1);
    expect(captionAt(SCENE, 4.99, still)?.opacity).toBe(1);
    expect(captionAt(SCENE, 0.99, still)).toBeUndefined();
    expect(captionAt(SCENE, 5, still)).toBeUndefined();
  });

  it('leaves out a caption whose feature the run cannot show, and keeps the rest', () => {
    const noMap = { reducedMotion: false, shows: (feature: string) => feature !== 'map-data' };
    expect(captionAt(SCENE, 8, noMap)).toBeUndefined();
    expect(captionAt(SCENE, 3, noMap)?.text).toBe('First');
  });
});

describe('a caption script’s length and frames — #3074', () => {
  const SCRIPT: CaptionScript = {
    id: 'test',
    scenes: [SCENE, { id: 'two', preset: 'hill', seconds: 8, captions: [] }],
  };

  it('is its scenes end to end', () => {
    expect(scriptSeconds(SCRIPT)).toBe(20);
    expect(scriptSeconds(YOUTUBE_CAPTIONS)).toBeGreaterThanOrEqual(60);
    expect(scriptSeconds(YOUTUBE_CAPTIONS)).toBeLessThanOrEqual(90);
  });

  it('puts each caption’s frames in the video: before, in the middle of, and after its time', () => {
    expect(captionFrames(SCRIPT, 2)).toEqual([
      {
        scene: 'one',
        text: 'First',
        placement: 'title',
        feature: undefined,
        sceneFrame: 0,
        before: 1,
        middle: 6,
        after: 10,
      },
      {
        scene: 'one',
        text: 'Second',
        placement: 'lower-third',
        feature: 'map-data',
        sceneFrame: 0,
        before: 11,
        middle: 16,
        after: 20,
      },
    ]);
    // Every frame named is inside, or outside, as captionAt says.
    for (const frames of captionFrames(SCRIPT, 2)) {
      const at = (frame: number) => captionAt(SCENE, frame / 2, ALL)?.text;
      expect(at(frames.middle)).toBe(frames.text);
      expect(at(frames.before ?? -1)).not.toBe(frames.text);
      expect(at(frames.after ?? -1)).not.toBe(frames.text);
    }
  });

  it('counts a later scene’s frames from its own start, and names no frame outside the scene', () => {
    const later: CaptionScript = {
      id: 'test',
      scenes: [
        { id: 'a', preset: 'climb', seconds: 3, captions: [] },
        { id: 'b', preset: 'hill', seconds: 4, captions: [{ at: 0, seconds: 4, text: 'Whole' }] },
      ],
    };
    expect(captionFrames(later, 1)).toEqual([
      expect.objectContaining({ sceneFrame: 3, before: undefined, middle: 5, after: undefined }),
    ]);
  });
});

describe('the caption scripts — #3074', () => {
  it('names each by the id it carries', () => {
    for (const [name, script] of Object.entries(CAPTION_SCRIPTS)) {
      expect(script.id).toBe(name);
      expect(isCaptionScriptId(name)).toBe(true);
    }
    expect(isCaptionScriptId('toString')).toBe(false);
    expect(isCaptionScriptId('tiktok')).toBe(false);
  });
});
