// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The demo page, audited — #1647.
 *
 * `routes.a11y.test.tsx` cannot reach it: the demo is its own page and build,
 * not a route of the app's shell. So its markup is audited here, playing and
 * refused, and its controls are held to WCAG 2.2 SC 2.2.2's "a mechanism to
 * pause or stop": named buttons, reachable by keyboard. Since #1650 those are
 * the ride HUD's own controls, and the HUD over the world is audited with it.
 */

import { Blob as NodeBlob } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { bakeFixtureRouteInto, routeFilesIn } from '../../browser/demo-route-fixture';

import {
  accessibleName,
  auditAccessibility,
  formatViolations,
  tabbableElements,
} from '../a11y/audit';
import { mount, settle, type Mounted } from '../testing/mount';
import type { ReadDemoFile } from './baked-route';
import { DemoPage } from './DemoPage';
import { fakeDrawnWorld, fakeRenderer, SteppedFrames } from './stage-testing';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const NO_FILES: ReadDemoFile = (path) => Promise.reject(new Error(`no ${path}`));

async function show(
  search: string,
  reducedMotion = false,
  readFile: ReadDemoFile = NO_FILES,
): Promise<void> {
  mounted = await mount(
    <DemoPage
      search={search}
      renderer={fakeRenderer(new Promise(() => undefined)).renderer}
      drawnWorld={fakeDrawnWorld}
      frames={new SteppedFrames()}
      reducedMotion={reducedMotion}
      observeInView={() => () => undefined}
      publish={() => undefined}
      readFile={readFile}
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
    // #1650: the stats overlay — the ride HUD's own — is part of what is audited.
    expect(document.querySelector('.oyl-hud') !== null).toBe(search !== '?preset=nowhere');
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

describe('the demo page on a baked route is accessible — #1652', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'oyl-demo-a11y-'));
  let files: Map<string, Uint8Array<ArrayBuffer>>;

  // jsdom's `Blob` has no `stream`, which `corridor.ts`' gzip reads through.
  beforeAll(async () => {
    vi.stubGlobal('Blob', NodeBlob);
    await bakeFixtureRouteInto(scratch);
    files = routeFilesIn(scratch);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    rmSync(scratch, { recursive: true, force: true });
  });

  it('passes the audit with the credit and the “Map data” notice open, reached by keyboard', async () => {
    await show('?preset=climb&route=fixture', false, (path) => {
      const bytes = files.get(path);
      return bytes === undefined ? Promise.reject(new Error(path)) : Promise.resolve(bytes);
    });
    for (let turn = 0; turn < 50 && document.querySelector('summary') === null; turn += 1) {
      await settle();
    }
    const summary = document.querySelector('summary');
    expect(summary).not.toBeNull();
    expect(tabbableElements(document)).toContain(summary);
    expect(accessibleName(summary as Element)).toBe('Map data');
    (summary?.parentElement as HTMLDetailsElement).open = true;
    const violations = auditAccessibility(document);
    expect(violations, formatViolations(violations)).toEqual([]);
    const names = tabbableElements(document)
      .filter((element) => element.tagName === 'A')
      .map((element) => accessibleName(element));
    expect(names).toEqual(
      expect.arrayContaining([
        'OpenStreetMap',
        'Open Database License',
        'This route’s map data',
        'Its licence notice',
      ]),
    );
  });
});
