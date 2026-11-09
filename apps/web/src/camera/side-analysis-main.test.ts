// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `main.tsx` hands each pairing's `SideAnalysis` the reader that names the
 * hosted service its pictures go on to (#2175), and nothing else fails when
 * it does not: the option is optional, so dropping it only leaves the screen
 * naming no service — a promise to the rider quietly unsaid (#2192).
 *
 * Read from the source, as `retired-hosted-key-main.test.ts` reads it,
 * because `main.tsx` runs on import. What the reader answers is
 * `instance-pose.test.ts` §`sideInstanceHostedService`'s, and what the screen
 * says with it is `views/SideCameraControl.test.tsx`'s.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from '../units/no-inline-units';

import { SOURCE_ROOT } from './import-walk-testing';

const main = stripComments(readFileSync(join(SOURCE_ROOT, 'main.tsx'), 'utf8'));

/** The one `new SideAnalysis({ … })` in `main.tsx`, up to its closing `})`. */
function sideAnalysisOptions(): string {
  const start = main.indexOf('new SideAnalysis({');
  expect(start).toBeGreaterThan(0);
  expect(main.indexOf('new SideAnalysis(', start + 1)).toBe(-1);
  const end = main.indexOf('});', start);
  expect(end).toBeGreaterThan(start);
  return main.slice(start, end);
}

describe('main.tsx names the hosted service to the side camera’s analysis (#2175, #2192)', () => {
  it('passes hostedService, read from the rider’s choice for the instance signed in to now', () => {
    expect(sideAnalysisOptions().replace(/\s+/g, ' ')).toContain(
      'hostedService: analyser.place === ' +
        "'instance' ? () => sideInstanceHostedService( " +
        'readSideInstanceChoice(sidePictures?.port.sideInstanceOrigin()), ) : undefined,',
    );
  });

  it('passes it from the same choice that sends the pictures to the instance', () => {
    // The pictures go to the instance on `readSideInstanceChoice(origin)`, and
    // the service named must be read off that same choice, not another.
    expect(main.replace(/\s+/g, ' ')).toContain(
      'onInstance: () => readSideInstanceChoice(sidePictures?.port.sideInstanceOrigin()) !== undefined,',
    );
  });
});
