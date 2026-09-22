// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * What the owner's answers to [ADR 0028](../../../../docs/adr/0028-racing-fairness.md)
 * left behind that a machine can check
 * ([#488](https://github.com/openzigs/onyourleft/issues/488)).
 *
 * ⚠️ **This file contains no racing code and must not grow any.** There is no
 * room, no transport, no client and no category: ADR 0028 D-0's first block —
 * there is no server in Phase 1, owner decision D6,
 * [#7](https://github.com/openzigs/onyourleft/issues/7) — is untouched by the
 * amendment this reads. What is here is a **document gate**, in the shape
 * `privacy/policy.test.ts` already uses for `docs/privacy-policy.md`: the
 * assertions are against the file on disk rather than against a constant
 * restating itself.
 *
 * It lives in `game/` for the reason `three-seam.test.ts` does — that file is a
 * grep over the whole tree with no production sibling either — and because the
 * two constants ADR 0028 D-1 puts in a race are `rider.ts`'s, next door.
 *
 * **Three properties, and each is one nothing else in this repository would
 * notice.** `ADR003` checks the amendment's *shape* — one section, last, dated
 * entries in date order — and says nothing about what is inside it.
 *
 * 1. **The ceiling table is four rows and its ceilings fall as the duration
 *    rises.** A power–duration ceiling that rose with duration would be
 *    nonsense — it would say a rider may hold more watts per kilogram for an
 *    hour than for five seconds — and it is one transposed row away in a
 *    Markdown table nobody compiles.
 * 2. **Provenance is one of two words, and a row with no anchor may not claim
 *    the stronger one.** The amendment's whole honesty rests on the difference
 *    between *read first-hand* and *a lead nobody has read*; a third word
 *    invented later, or an unanchored row promoted to `first-hand`, erases it.
 * 3. **The body still says what the amendment quotes back at it.** ADR 0013
 *    forbids editing an accepted ADR's body, and `CLAUDE.md` §7 says a reviewer
 *    asking *"does any hunk touch a line that already existed?"* is the
 *    mechanism. That is a property of a diff and not of a file — but the
 *    particular lines this amendment is written **against** can be pinned, so
 *    an edit to any of them is a red test rather than a quiet contradiction.
 *
 * ⚠️ **What it deliberately does NOT check.** Nothing about whether a ceiling
 * is the right number, which is a physiology question no assertion here could
 * answer; nothing about whether a citation supports its figure, which needs
 * somebody to read the paper — the amendment marks three of the four rows
 * `unsourced` for exactly that reason; and nothing about the decisions
 * themselves, because ADR 0007 §"Which of D1–D7 a machine checks: none of them"
 * applies to ADR 0028 verbatim and the amendment does not change it.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/** The repository root, resolved from this file rather than from `cwd`. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const ADR_PATH = 'docs/adr/0028-racing-fairness.md';

const adr = readFileSync(join(ROOT, ADR_PATH), 'utf8');

/**
 * The amendment is everything from the `## Amendments` heading on. Splitting
 * here rather than searching the whole file is what lets the body-integrity
 * assertions below mean something: a line quoted in the amendment satisfying a
 * `toContain` over the whole document would be the vacuous version of them.
 */
const amendmentStart = adr.indexOf('\n## Amendments\n');
const body = amendmentStart === -1 ? adr : adr.slice(0, amendmentStart);
const amendment = amendmentStart === -1 ? '' : adr.slice(amendmentStart);

/**
 * How long each duration the amendment names actually is. Written here rather
 * than parsed out of the words, because the point of the table is that a reader
 * and this test agree on the ORDER — deriving the order from the same string
 * that states it would agree with itself whatever it said.
 */
const DURATION_SECONDS: ReadonlyMap<string, number> = new Map([
  ['5 s', 5],
  ['1 min', 60],
  ['20 min', 1200],
  ['1 h', 3600],
]);

/** The only two words the provenance column may carry. */
const PROVENANCE = ['first-hand', 'unsourced'] as const;

interface CeilingRow {
  readonly duration: string;
  readonly wattsPerKilogram: number;
  readonly anchor: string;
  readonly provenance: string;
  readonly provenanceCell: string;
}

/**
 * Every row of the ceiling table, read out of the amendment.
 *
 * A row is a Markdown table row whose first cell is a bolded duration and whose
 * second is a bolded W/kg figure. That shape is what makes the table findable
 * without anchoring on a heading somebody may reword; a row that loses either
 * bold marker simply is not found, which is why the count is asserted first.
 */
const ceilingRows: readonly CeilingRow[] = amendment
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith('|') && line.endsWith('|'))
  .map((line) =>
    line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim()),
  )
  .filter((cells) => cells.length === 5 && /^\*\*[\d.]+ W\/kg\*\*$/.test(cells[1] ?? ''))
  .map((cells) => ({
    duration: (cells[0] ?? '').replace(/\*\*/g, ''),
    wattsPerKilogram: Number.parseFloat((cells[1] ?? '').replace(/\*\*/g, '')),
    anchor: cells[2] ?? '',
    provenance: (/\*\*([a-z-]+)\*\*/.exec(cells[4] ?? '')?.[1] ?? '').trim(),
    provenanceCell: cells[4] ?? '',
  }));

describe("ADR 0028's owner answers — #488", () => {
  it('has an Amendments section, which is where every answer lives', () => {
    expect(amendmentStart, `${ADR_PATH} has no "## Amendments" section`).not.toBe(-1);
    // The body is never edited, so the section cannot be anywhere but the end.
    // `ADR003` enforces that; this only establishes that the split above found
    // a real section rather than silently treating the whole file as body.
    expect(amendment.length).toBeGreaterThan(0);
  });

  it('records an answer for each of the six questions that were asked', () => {
    // The body names Q1 to Q5 in its own section and Q6 beneath it. An
    // amendment that answered five of six would read as complete, because the
    // one it dropped is only named in a paragraph further down.
    for (const question of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']) {
      expect(amendment, `the amendment records no answer for ${question}`).toContain(
        `| **${question}** |`,
      );
    }
  });

  it('names the four durations Q3 answered, and no others', () => {
    expect(ceilingRows.map((row) => row.duration)).toEqual([...DURATION_SECONDS.keys()]);
  });

  it('gives a ceiling that falls as the duration rises', () => {
    // A rider may hold fewer watts per kilogram for longer. A table that says
    // otherwise is transposed, and Markdown will not say so.
    for (let index = 1; index < ceilingRows.length; index += 1) {
      const previous = ceilingRows[index - 1];
      const current = ceilingRows[index];
      if (previous === undefined || current === undefined) {
        throw new Error('the ceiling table lost a row between two assertions');
      }
      expect(
        DURATION_SECONDS.get(current.duration) ?? 0,
        `${current.duration} is not longer than ${previous.duration}`,
      ).toBeGreaterThan(DURATION_SECONDS.get(previous.duration) ?? 0);
      expect(
        current.wattsPerKilogram,
        `the ceiling at ${current.duration} is not below the one at ${previous.duration}`,
      ).toBeLessThan(previous.wattsPerKilogram);
      expect(current.wattsPerKilogram).toBeGreaterThan(0);
    }
  });

  it('marks every ceiling with one of the two provenance words', () => {
    for (const row of ceilingRows) {
      expect(
        PROVENANCE as readonly string[],
        `${row.duration} carries no recognised provenance word`,
      ).toContain(row.provenance);
    }
  });

  it('refuses to call a ceiling with no anchor first-hand', () => {
    // The amendment writes an em dash where a figure has nothing behind it.
    // Such a row is a number somebody chose, and saying it was read first-hand
    // would be the one claim this table exists to keep honest.
    for (const row of ceilingRows) {
      if (row.anchor.replace(/\*/g, '').trim() === '—') {
        expect(row.provenance, `${row.duration} has no anchor and claims to be sourced`).toBe(
          'unsourced',
        );
      }
    }
  });

  it('says when each anchor was read, in the row itself', () => {
    // A provenance word without a date is an assertion about a moving target:
    // a page fetched today and the same URL in two years are different
    // evidence, and only one of them was looked at. The date has to be in the
    // ROW — one date at the top of the amendment would be satisfied by the
    // entry's own heading and would say nothing about any particular figure.
    for (const row of ceilingRows) {
      expect(row.provenanceCell, `${row.duration} does not say when its anchor was read`).toMatch(
        /20\d\d-\d\d-\d\d/,
      );
    }
  });

  it('is written against a body that still says what it quotes', () => {
    // ADR 0013: the body is never edited. Each of these is a line the
    // amendment answers or supersedes, so an edit to one leaves the amendment
    // arguing with a document that no longer exists.
    const quoted = [
      '### D-4 — Categories are W/kg bands',
      '**Q1 — Should a race derive frontal area',
      '**Q2 — Will a race ever carry a prize',
      '**Q3 — What are the W/kg ceilings, at which durations?**',
      "**Q4 — May a rider's declared mass be shown to other riders in the room?**",
      '**Q5 — What are the category boundaries, and what are the categories called?**',
      '**Q6 — Is spike 0005 §5 Question A bought before any racing code is written?**',
    ];
    for (const line of quoted) {
      expect(body, `the ADR body no longer carries: ${line}`).toContain(line);
    }
  });
});
