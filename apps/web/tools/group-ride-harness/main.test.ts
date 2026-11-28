// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * #3309: the command, and the file it writes. The rides here are short
 * (`SHORT`, a 3 km course of this file's own) so two whole runs fit in a
 * case; the fixture courses are ridden by `marks.*.test.ts`.
 */

import { courseOf } from '@onyourleft/domain/group-ride-testing';
import { describe, expect, it } from 'vitest';

import type { HarnessCourse } from './courses';
import { main, readCommand, runHarness } from './main';
import { PASS_MARKS } from './marks';
import { assertNumbersOnly, resultFileText } from './results';
import { rideScripted, type RideAsked, type RideRecord } from './ride';
import { SCRIPTED_RIDERS } from './riders';

/** 3 km: level, a short climb and its descent, level. Synthetic, as every course here. */
const SHORT: HarnessCourse = {
  name: 'hilly',
  profile: courseOf([
    [1_000, 0],
    [400, 6],
    [400, -6],
    [1_200, 0],
  ]),
};

const shortRide = (asked: RideAsked): RideRecord => rideScripted({ ...asked, course: SHORT });

/** A run of `args` with the short ride, what it printed and what it wrote. */
async function run(
  args: readonly string[],
  ride: (asked: RideAsked) => RideRecord = shortRide,
): Promise<{ code: number; lines: string[]; files: Map<string, string> }> {
  const lines: string[] = [];
  const files = new Map<string, string>();
  const code = await main(args, {
    print: (line) => lines.push(line),
    ride,
    write: async (file, text) => {
      files.set(file, text);
      await Promise.resolve();
    },
  });
  return { code, lines, files };
}

describe('the group-ride harness', () => {
  it('two runs give byte-identical scores', () => {
    const first = resultFileText(runHarness(['absent'], [SHORT]));
    const second = resultFileText(runHarness(['absent'], [SHORT]));
    expect(second).toBe(first);
    expect(first).toContain('"seed": 3309');
  });

  it('prints a table of numbers, the marks with their reasons, and exits 0 at every mark', async () => {
    const { code, lines, files } = await run([
      '--rider',
      'steady',
      '--course',
      'flat',
      '--results',
      'out',
    ]);
    expect(code).toBe(0);
    const [head, row] = lines;
    expect(head?.trim().split(/\s+/u).slice(0, 3)).toEqual(['rider', 'course', 'cohesion']);
    // Every cell after the rider and the course is a number, or '-' or 'yes'/'no'.
    const cells = row?.trim().split(/\s+/u) ?? [];
    expect(cells.slice(0, 2)).toEqual(['steady', 'flat']);
    for (const each of cells.slice(2)) expect(each).toMatch(/^(-?\d+(\.\d+)?|-|yes|no)$/u);
    const markLines = lines.filter((line) => line.startsWith('pass ') || line.startsWith('BELOW'));
    expect(markLines.map((line) => line.split(':')[0])).toEqual([
      'pass  steady flat pulls-on-time',
      'pass  steady flat no-correction',
      'pass  steady flat cue-ceiling',
    ]);
    // Each mark's reason is written beside it: the marks' own words, after the score.
    expect(markLines.map((line) => line.split(' -- ')[1])).toEqual(
      ['pulls-on-time', 'no-correction', 'cue-ceiling'].map(
        (mark) => PASS_MARKS.find((each) => each.mark === mark)?.reason,
      ),
    );
    expect([...files.keys()]).toEqual(['out/group-ride-v2-seed-3309.json']);
  });

  it('exits 1 below a pass mark, and says which and why', async () => {
    // The weak rider's ride with the group gone at the finish: the no-drop mark is broken.
    const dropped = (asked: RideAsked): RideRecord => ({ ...shortRide(asked), finishBehindM: 400 });
    const { code, lines } = await run(['--rider', 'weak', '--course', 'flat'], dropped);
    expect(code).toBe(1);
    expect(lines).toContain('BELOW THE PASS MARK: 1 of 2 marks');
    expect(lines.find((line) => line.startsWith('BELOW weak flat finishes-with-group'))).toMatch(
      /: 400 \(most 30\) -- owner ruling 3/u,
    );
  });

  it('exits 2 for a command it cannot read', async () => {
    for (const args of [
      ['--rider', 'nobody'],
      ['--course'],
      ['--seed', '1'],
      ['--course', 'flat,moon'],
    ]) {
      expect((await run(args)).code).toBe(2);
    }
    expect(readCommand([])?.riders).toEqual(SCRIPTED_RIDERS);
    expect(readCommand(['--course', 'hilly,flat'])?.courses.map((each) => each.name)).toEqual([
      'flat',
      'hilly',
    ]);
  });
});

describe('the results file', () => {
  it('holds numbers, seeds and closed-list words only: no place, no coordinate', () => {
    const text = resultFileText(runHarness(['weak'], [SHORT]));
    const parsed = JSON.parse(text) as unknown;
    expect(() => {
      assertNumbersOnly(parsed);
    }).not.toThrow();
    // The course's positions and heights never reach the file.
    expect(text).not.toMatch(
      /"(?:lat|lng|lon|latitude|longitude|positions?|elevations?|altitude)"/iu,
    );
    // And nothing in it is a fraction of a degree beside another: every number is a score or a seed.
    expect(Object.keys(parsed as object)).toEqual([
      'rulesVersion',
      'seed',
      'targetKmh',
      'passed',
      'rides',
    ]);
  });

  it('refuses a sentence, a value that is not finite, and a key that is not a word, naming where and never the value', () => {
    expect(() => {
      assertNumbersOnly({ rides: [{ rider: 'a rider at 12 Some Street' }] });
    }).toThrow('result.rides[0].rider is text that is not one short word');
    expect(() => {
      assertNumbersOnly({ score: Number.POSITIVE_INFINITY });
    }).toThrow('result.score is not a finite number');
    expect(() => {
      assertNumbersOnly({ 'two words': 1 });
    }).toThrow('result has a key that is not one word');
    expect(() => {
      assertNumbersOnly({ rides: [{ rider: 'a rider at 12 Some Street' }] });
    }).not.toThrow(/Some Street/u);
  });

  it('is refused before it is written when anything in it is not a number or a word', () => {
    const result = runHarness(['steady'], [SHORT]);
    const tainted = { ...result, rides: [{ ...result.rides[0], course: 'Somewhere Real' }] };
    expect(() => resultFileText(tainted as typeof result)).toThrow('not one short word');
  });
});
