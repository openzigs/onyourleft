// SPDX-License-Identifier: AGPL-3.0-or-later

import { renderToStaticMarkup } from 'react-dom/server';

import { describe, expect, it } from 'vitest';

import { SOURCE_CODE_URL } from '../privacy/policy';
import {
  DEMO_LICENCE_URL,
  DEMO_NOTICES_PATH,
  DEMO_VIDEO_URL,
  DemoSourceOffer,
} from './SourceOffer';

const markup = renderToStaticMarkup(<DemoSourceOffer />);

/** The text of the link whose href is `href`, or undefined if there is none. */
function linkText(href: string): string | undefined {
  const escaped = href.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return new RegExp(`<a href="${escaped}"[^>]*>([^<]*)</a>`).exec(markup)?.[1];
}

describe('the demo offers its source — AGPL-3.0 §6, #1645', () => {
  it('links the repository as "Source code"', () => {
    expect(linkText(SOURCE_CODE_URL)).toBe('Source code');
  });

  it('links the licence, by name', () => {
    expect(DEMO_LICENCE_URL).toBe('https://github.com/openzigs/onyourleft/blob/main/LICENSE');
    expect(linkText(DEMO_LICENCE_URL)).toBe('Licence (AGPL-3.0-or-later)');
  });

  it('links the third-party notices the build copies, relative to the page', () => {
    expect(DEMO_NOTICES_PATH).toBe('./licences/third-party.txt');
    expect(linkText(DEMO_NOTICES_PATH)).toBe('Third-party notices');
  });
});

describe('the demo links its two-minute video — #3225', () => {
  it('links the video by name, as a link to YouTube and not an embed', () => {
    expect(DEMO_VIDEO_URL).toBe('https://www.youtube.com/watch?v=lgpE-VbyFa0');
    expect(linkText(DEMO_VIDEO_URL)).toBe('Watch the two-minute demo on YouTube');
    expect(markup).not.toMatch(/<iframe/);
  });
});
