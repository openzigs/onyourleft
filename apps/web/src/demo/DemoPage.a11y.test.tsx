// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The demo page, audited — #1647.
 *
 * `routes.a11y.test.tsx` cannot reach it: the demo is its own page and build,
 * not a route of the app's shell. So its markup is audited here, playing and
 * refused, and its controls are held to WCAG 2.2 SC 2.2.2's "a mechanism to
 * pause or stop": named buttons, reachable by keyboard.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  accessibleName,
  auditAccessibility,
  formatViolations,
  tabbableElements,
} from '../a11y/audit';
import { mount, settle, type Mounted } from '../testing/mount';
import { DemoPage } from './DemoPage';
import { fakeDrawnWorld, fakeRenderer, SteppedFrames } from './stage-testing';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function show(search: string, reducedMotion = false): Promise<void> {
  mounted = await mount(
    <DemoPage
      search={search}
      renderer={fakeRenderer(new Promise(() => undefined)).renderer}
      drawnWorld={fakeDrawnWorld}
      frames={new SteppedFrames()}
      reducedMotion={reducedMotion}
      observeInView={() => () => undefined}
      publish={() => undefined}
    />,
  );
  await settle();
}

describe('the demo page is accessible — #1647', () => {
  it.each([
    ['playing', '?preset=climb', false],
    ['paused for reduced motion', '?preset=group', true],
    ['refusing its query', '?preset=nowhere', false],
  ])('passes the audit while %s', async (_what, search, reducedMotion) => {
    await show(search, reducedMotion);
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  it('can be paused and stopped from the keyboard (SC 2.2.2)', async () => {
    await show('?preset=sprint');
    const names = tabbableElements(document)
      .filter((element) => element.tagName === 'BUTTON')
      .map((element) => accessibleName(element));
    expect(names).toEqual(['Pause', 'Stop']);
  });

  it('offers Play, and Stop, from the keyboard when reduced motion starts it paused', async () => {
    await show('?preset=climb', true);
    const names = tabbableElements(document)
      .filter((element) => element.tagName === 'BUTTON')
      .map((element) => accessibleName(element));
    expect(names).toEqual(['Play', 'Stop']);
  });
});
