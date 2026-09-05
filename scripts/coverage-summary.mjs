#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Render `coverage/coverage-summary.json` as a Markdown table, per package.
 *
 * Exists because coverage was being *computed* and not *reported*: the `text`
 * reporter's output goes into a CI log under the install and build noise, and
 * the `html` one is written to a runner that is then destroyed. The numbers
 * reached review only when an author pasted them into a pull request body by
 * hand, which is self-reported and vanishes the moment a human opens a PR
 * instead. #126.
 *
 * **This prints. It does not gate, and must not.** ADR 0005 decision C and
 * CLAUDE.md §5 make the mutation list the gate and forbid inventing a
 * percentage floor. A non-zero exit here would be that floor arriving by the
 * back door, so the only way this exits non-zero is if it cannot find or parse
 * its input — a report that silently renders nothing is the failure it exists
 * to prevent.
 *
 * Per package rather than one workspace total, because a total hides a new
 * package landing at 40% behind four mature ones at 99% — which is precisely
 * the case worth seeing in review.
 *
 * Usage: node scripts/coverage-summary.mjs [path/to/coverage-summary.json]
 */

import { readFileSync } from 'node:fs';

const METRICS = ['statements', 'branches', 'functions', 'lines'];

/**
 * The workspace package a covered file belongs to, or `undefined`.
 *
 * Matched on the `packages/<name>/` and `apps/<name>/` segments rather than on
 * a prefix of the absolute path, because the report records absolute paths and
 * those differ between a contributor's checkout, a CI runner and a git
 * worktree — and a path that fails to match would silently drop a whole
 * package out of the table rather than announce itself.
 */
export function packageOf(filePath) {
  // A dependency's own `packages/<name>/` directory would otherwise be
  // attributed to a workspace package of that name and silently inflate its
  // numbers with files nobody in this repository wrote. Caught by the test
  // suite, not by inspection -- the first version of this function had the bug.
  if (/(?:^|\/)node_modules\//.test(filePath)) return undefined;
  const match = /(?:^|\/)(packages|apps)\/([^/]+)\//.exec(filePath);
  return match === null ? undefined : `${match[1]}/${match[2]}`;
}

/** Sum the per-file counts into one row per package. */
export function aggregate(summary) {
  const rows = new Map();
  for (const [filePath, entry] of Object.entries(summary)) {
    if (filePath === 'total') continue;
    const name = packageOf(filePath);
    if (name === undefined) continue;
    const row = rows.get(name) ?? {
      files: 0,
      ...Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }])),
    };
    row.files += 1;
    for (const metric of METRICS) {
      const cell = entry[metric];
      if (cell === undefined) continue;
      row[metric].covered += cell.covered ?? 0;
      row[metric].total += cell.total ?? 0;
    }
    rows.set(name, row);
  }
  return rows;
}

const percent = (covered, total) =>
  total === 0 ? '—' : `${((covered / total) * 100).toFixed(2)}%`;

export function render(summary) {
  const rows = aggregate(summary);
  const lines = [
    '### Coverage',
    '',
    'Reported, not gated — the gate is the mutation list in the pull request body',
    '([CLAUDE.md §5](../blob/main/CLAUDE.md), ADR 0005 decision C). There is no',
    'percentage floor and one must not be added.',
    '',
    '| Package | Files | Statements | Branches | Functions | Lines |',
    '|---|--:|--:|--:|--:|--:|',
  ];
  for (const name of [...rows.keys()].sort()) {
    const row = rows.get(name);
    lines.push(
      `| \`${name}\` | ${row.files} | ` +
        METRICS.map((m) => percent(row[m].covered, row[m].total)).join(' | ') +
        ' |',
    );
  }
  const total = summary.total;
  if (total !== undefined) {
    lines.push(
      `| **workspace** | | ` +
        METRICS.map((m) => (total[m] === undefined ? '—' : `${total[m].pct.toFixed(2)}%`)).join(
          ' | ',
        ) +
        ' |',
    );
  }
  if (rows.size === 0) {
    lines.push('', '⚠️ No `packages/*` or `apps/*` file appeared in the report.');
  }
  return lines.join('\n');
}

const isEntryPoint = import.meta.url === `file://${process.argv[1]}`;
if (isEntryPoint) {
  const path = process.argv[2] ?? 'coverage/coverage-summary.json';
  let summary;
  try {
    summary = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    // The one failure worth exiting on: a report that is missing or unreadable
    // renders an empty table, and an empty table reads like good news.
    console.error(`coverage-summary: cannot read ${path}: ${error.message}`);
    process.exit(1);
  }
  console.log(render(summary));
}
