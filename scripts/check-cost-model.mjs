#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Recompute `docs/cost-model.md` from its own stated inputs, and fail when the
 * document disagrees with itself.
 *
 * ## Why a cost model needs a gate at all
 *
 * #54 asks for a model that makes "free to the end user" a **tested** claim.
 * A table of dollars in a Markdown file is not tested: it is arithmetic
 * somebody did once, in a document that will outlive the day they did it. The
 * inputs move — R2 republished its rates, the Protomaps planet build grew
 * 103 MB in the four days before this was written, Verisign has announced a
 * `.com` rise for 1 November 2026 — and when an input is edited, every figure
 * derived from it silently becomes a number that was once true. That is the
 * same shape as CLAUDE.md §4a's "a documented command nobody has run", one
 * artefact over.
 *
 * So the document holds the **inputs** and the **outputs**, and this script
 * holds the **arithmetic** — and nothing holds two of the three. An input is
 * written down once, with its provenance; every figure that follows from it is
 * checked against the model on every CI run. Editing an input and not the
 * table is a red build rather than a stale document.
 *
 * ## What it checks
 *
 * | Rule | Fails when |
 * |---|---|
 * | `COST001` | the document, one of its table anchors, a table, or the three required scale columns is missing or unreadable |
 * | `COST002` | an input the model needs is absent from the inputs table, or its value is not a number |
 * | `COST003` | a stated monetary figure disagrees with what the model computes from the inputs |
 * | `COST004` | an input carries no provenance, or a confidence outside the stated vocabulary |
 * | `COST005` | the run checked no figures at all |
 * | `COST006` | a stated dominant or second-largest line item is not the one the model computes |
 *
 * `COST005` is the one that looks redundant and is not. Every other rule
 * reports a disagreement, and a parser that found nothing to disagree with
 * reports none of them — a table whose rows this script skips would otherwise
 * exit 0 with a success line claiming the model checks out. This repository
 * has shipped that shape five separate times (CLAUDE.md §`DOC002`), so the
 * guard is explicit and has a fixture of its own.
 *
 * ⚠️ It is counted **per table**, not once for the run, and that is what makes
 * it reachable rather than decorative. A run-wide count is satisfied by any
 * one table having rows, so the donations table could be silently skipped in
 * its entirety while the projection kept the total above zero — a guard
 * against a vacuous pass that is itself vacuous. Both tables are therefore
 * required to have contributed something, and the suite has a fixture where
 * the donations table parses as a table and yields no comparison at all.
 *
 * `COST004` is the other one worth defending. A cost model is only as good as
 * the provenance of its inputs, and #54's whole argument is about which
 * figures are measured and which are guesses — `L`, map loads per user per
 * month, is the difference between a $950 bill and a $3,050 bill on a metered
 * API and nobody has measured it. An input that arrives with no provenance
 * column is exactly how that distinction gets lost, so it is a build failure
 * rather than a documentation nicety.
 *
 * ## Limits — read these before reading a green run as more than it is
 *
 * - **It checks arithmetic, not truth.** Every input could be wrong and this
 *   would pass. What it guarantees is that the document's conclusions follow
 *   from the document's stated premises, and that each premise says where it
 *   came from. Whether $0.015/GB-month is still R2's price is a question for a
 *   person with a browser, and the document records the date it was last read.
 * - **The prose is not checked, and that is where the figures a reader quotes
 *   live.** Only the three anchored tables are checked. Every share, ratio,
 *   threshold and band stated in a sentence — the crossover derived by
 *   `--print`, the instance's percentage of each total, the price band the box
 *   dominates across — is outside every rule, and a reader editing an input
 *   has to recompute them by hand to notice they moved.
 *
 *   ⚠️ **This is not hypothetical: the document shipped for review with three
 *   of them wrong on the day they were typed** — an instance share taken
 *   against the infrastructure subtotal and quoted as a fully-loaded one, a
 *   dominance claim that was false at the floor of its own stated band, and a
 *   donations arithmetic the table beneath it already contradicted. All three
 *   are corrected and each now carries a note saying what it used to say. The
 *   lesson generalises past this gate: **a checker over a document's tables
 *   creates a blind spot in that document's prose**, so a green run here is
 *   evidence about the tables and about nothing a person will actually quote.
 *
 *   The stopping point is deliberate all the same. Machine-checking a sentence
 *   means pinning its wording, and a gate that forbids rewording a paragraph
 *   gets deleted. The answer is a reviewer who recomputes, not a rule.
 * - **It says nothing about any bill.** No traffic has been served and no
 *   invoice exists. The document says so in its own words and this script
 *   cannot tell the difference.
 *
 * Usage:
 *   node scripts/check-cost-model.mjs [--root <dir>] [--print]
 *
 * `--print` emits the tables the model computes, for pasting into the document
 * after an input changes. It is the ergonomic half of the gate: without it the
 * response to a red build is to edit numbers by hand until it goes green,
 * which is how an arithmetic error gets typed in twice.
 */

import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

/** Where the model lives, relative to the repository root. */
const DOCUMENT = 'docs/cost-model.md';

/** The anchors that mark each machine-checked table. */
const ANCHORS = {
  inputs: '<!-- cost-model:inputs -->',
  projection: '<!-- cost-model:projection -->',
  donations: '<!-- cost-model:donations -->',
};

/**
 * The scales #54's second acceptance criterion names. Asserted rather than
 * read: a document that quietly dropped the 100,000 column would otherwise
 * pass a check that only ever looked at the columns it found. The values are
 * read out of the header all the same, so a mislabelled column fails here
 * instead of being silently modelled at the wrong population.
 */
const REQUIRED_SCALES = [1000, 10000, 100000];

/** The confidence vocabulary an input's provenance must be classified under. */
const CONFIDENCE = new Set(['measured', 'read', 'inherited', 'inferred']);

/**
 * Every input the model reads, with what it means. A key here that the
 * document does not carry is `COST002`; a key the document carries that this
 * does not is ignored, because a model may legitimately record a figure it
 * quotes in prose without deriving anything from it.
 */
const REQUIRED_INPUTS = {
  r: 'rides per active per month',
  d: 'recorded hours per ride',
  b: 'stored bytes per recorded hour',
  m: 'months of accumulation modelled',
  L: 'map loads per active per month',
  T: 'tile requests per map load',
  h: 'CDN cache hit rate',
  s: 'average tile size in bytes',
  S: 'basemap archive size in bytes',
  p_storage: 'object storage, USD per GB-month',
  p_classB: 'object storage Class B reads, USD per million',
  p_egress: 'object storage egress, USD per GB',
  box_eur: 'the reference instance, EUR per month',
  fx: 'USD per EUR',
  domain_usd_year: 'domain registration, USD per year',
  email_usd_month: 'transactional email, USD per month',
  errors_usd_month: 'error tracking, USD per month',
  fee_rate: 'card processing, share of the transaction',
  fee_fixed: 'card processing, fixed fee per transaction in USD',
  support_usd_year: 'one supporter gift, USD per year',
};

/**
 * The projection's rows, in order, each with the function that produces it.
 * The row label in the document must match the key exactly once formatting is
 * stripped.
 *
 * A row with an `of` is a **component**: it is eligible to be the dominant
 * line item, and its `group` says which of the two totals it lands in.
 * Subtotals and per-user rows are not eligible, or the answer to "what
 * dominates" would always be the subtotal.
 */
const LINE_ITEMS = [
  {
    label: 'Instance (one box)',
    group: 'infrastructure',
    of: (i) => i.box_eur * i.fx,
  },
  {
    label: 'Basemap archive storage',
    group: 'infrastructure',
    of: (i) => (i.S / 1e9) * i.p_storage,
  },
  {
    label: 'Basemap tile requests',
    group: 'infrastructure',
    of: (i, A) => ((A * i.L * i.T * (1 - i.h)) / 1e6) * i.p_classB,
  },
  {
    label: 'Basemap egress',
    group: 'infrastructure',
    of: (i, A) => ((A * i.L * i.T * i.s) / 1e9) * i.p_egress,
  },
  {
    label: 'Activity streams (object storage)',
    group: 'infrastructure',
    of: (i, A) => ((A * i.r * i.d * i.b * i.m) / 1e9) * i.p_storage,
  },
  { label: 'Infrastructure subtotal', subtotal: 'infrastructure' },
  { label: 'Infrastructure, per 1,000 MAU', perThousand: 'infrastructure' },
  { label: 'Domain name', group: 'extras', of: (i) => i.domain_usd_year / 12 },
  { label: 'Transactional email', group: 'extras', of: (i) => i.email_usd_month },
  { label: 'Error tracking', group: 'extras', of: (i) => i.errors_usd_month },
  { label: 'Fully loaded total', subtotal: 'loaded' },
  { label: 'Fully loaded, per 1,000 MAU', perThousand: 'loaded' },
  // The headline claim of #54 — "free to you; costs somebody about ten cents a
  // year" — and therefore the one figure most worth holding to the arithmetic.
  // In CENTS because dollars at two decimal places round it to $0.00 at two of
  // the three scales, which is how a claim becomes unfalsifiable by accident.
  { label: 'Fully loaded, US cents per athlete per year', cents: 'loaded' },
];

/** The two text rows at the foot of the projection, checked by `COST006`. */
const DOMINANCE_ROWS = { 'Dominant line item': 0, 'Second-largest line item': 1 };

/** Round a non-negative amount to two places, half up. */
export function round2(value) {
  return Math.round(value * 100 + 1e-9) / 100;
}

/**
 * A figure as the document writes it. Every row is US dollars except the one
 * stated in cents, which carries no symbol — a `¢` in the cell would not
 * survive `numberIn`, and a row that cannot be parsed is a row that is not
 * checked.
 */
function money(item, value) {
  return item.cents === undefined ? `$${value.toFixed(2)}` : value.toFixed(2);
}

/** Strip Markdown emphasis and code formatting from a table cell. */
function plain(cell) {
  return cell.replaceAll('*', '').replaceAll('`', '').trim();
}

/**
 * Read a number out of a cell, tolerating `$`, `%`, thousands separators and
 * surrounding formatting. Returns `undefined` when the cell is not a number,
 * which every caller treats as a failure rather than as a zero.
 */
function numberIn(cell) {
  if (typeof cell !== 'string') return undefined;
  const text = plain(cell).replaceAll('$', '').replaceAll(',', '').replaceAll('%', '').trim();
  if (text === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The first Markdown table following an anchor, as rows of trimmed cells.
 *
 * Throws when the anchor is absent or nothing table-shaped follows it. Both
 * are `COST001`: an anchor that has drifted away from the table it names is
 * indistinguishable, to every other rule, from a document that agrees with the
 * model perfectly.
 */
export function tableAfter(text, anchor) {
  const at = text.indexOf(anchor);
  if (at === -1) throw new Error(`COST001: ${DOCUMENT} carries no ${anchor} anchor`);
  const lines = text.slice(at + anchor.length).split('\n');
  const rows = [];
  let started = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      if (started) break;
      continue;
    }
    started = true;
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
    if (cells.every((cell) => /^\s*:?-{2,}:?\s*$/.test(cell))) continue;
    rows.push(cells.map((cell) => cell.trim()));
  }
  if (rows.length < 2) throw new Error(`COST001: no table follows ${anchor} in ${DOCUMENT}`);
  return rows;
}

/**
 * The inputs table as `{ values, problems }`. A missing or unreadable input is
 * `COST002`; a missing provenance or an unrecognised confidence is `COST004`.
 * Both are collected rather than thrown so one run reports every one of them.
 */
export function readInputs(rows) {
  const problems = [];
  const values = {};
  const seen = new Map();
  for (const row of rows.slice(1)) {
    if (row.length < 5) continue;
    const key = plain(row[0]);
    // `Object.hasOwn` rather than `in`, which reaches `Object.prototype`: a row
    // keyed `toString`, `constructor` or `valueOf` would otherwise be treated
    // as an input the model reads, validated for provenance, and written into
    // `values` where it shadows a prototype member. Harmless today and exactly
    // the kind of thing that stops being harmless quietly.
    if (key === '' || !Object.hasOwn(REQUIRED_INPUTS, key)) continue;
    seen.set(key, row);
    const value = numberIn(row[1]);
    if (value === undefined) {
      problems.push(`COST002: input \`${key}\` has no readable value (cell: "${row[1]}")`);
    } else {
      values[key] = value;
    }
    if (plain(row[3]) === '') problems.push(`COST004: input \`${key}\` states no provenance`);
    const confidence = plain(row[4]).toLowerCase();
    if (!CONFIDENCE.has(confidence)) {
      problems.push(
        `COST004: input \`${key}\` is classified "${plain(row[4])}", which is not one of ` +
          `${[...CONFIDENCE].join(', ')}`,
      );
    }
  }
  for (const [key, meaning] of Object.entries(REQUIRED_INPUTS)) {
    if (!seen.has(key))
      problems.push(`COST002: the inputs table is missing \`${key}\` — ${meaning}`);
  }
  return { values, problems };
}

/**
 * Every figure the model produces at one population, keyed by row label, plus
 * the ordered component rows the dominance rules read.
 */
export function project(inputs, actives) {
  const figures = new Map();
  const components = [];
  // Two running sums rather than one, because "fully loaded" is the question
  // #54 asks to be answered explicitly: the infrastructure subtotal is the
  // headline, and the extras below it are what the other reading adds.
  let infrastructure = 0;
  let extras = 0;
  for (const item of LINE_ITEMS) {
    let value;
    if (item.of !== undefined) {
      value = item.of(inputs, actives);
      components.push({ label: item.label, value });
      if (item.group === 'infrastructure') infrastructure += value;
      else extras += value;
    } else if (item.subtotal !== undefined) {
      value = item.subtotal === 'infrastructure' ? infrastructure : infrastructure + extras;
    } else if (item.perThousand !== undefined) {
      const total =
        item.perThousand === 'infrastructure' ? infrastructure : infrastructure + extras;
      value = total / (actives / 1000);
    } else {
      const total = item.cents === 'infrastructure' ? infrastructure : infrastructure + extras;
      value = ((total * 12) / actives) * 100;
    }
    figures.set(item.label, value);
  }
  return { figures, components };
}

/**
 * The scale columns the projection is stated at, read out of its header.
 *
 * Read rather than assumed so a mislabelled column is caught, and then
 * asserted against `REQUIRED_SCALES` so a dropped one is too. Either alone
 * fails open in one direction — CLAUDE.md §4j makes the same argument about a
 * watched set that is written down instead of discovered, and §4e about the
 * accessibility selector that matched a directory.
 */
export function readScales(header) {
  // The header reads "10,000 MAU", so the unit comes off before the number is
  // parsed. It is stripped here rather than inside `numberIn`, which stays
  // strict so that "about ten euro" in an input cell is still a failure.
  const scales = header.slice(1).map((cell) => numberIn(plain(cell).replace(/\s*MAU\s*$/i, '')));
  if (scales.some((scale) => scale === undefined)) {
    throw new Error(
      `COST001: the projection's scale columns are not all numbers: ${header.slice(1).join(' | ')}`,
    );
  }
  const stated = scales.join(',');
  if (stated !== REQUIRED_SCALES.join(',')) {
    throw new Error(
      `COST001: the projection must be stated at ${REQUIRED_SCALES.join(', ')} monthly actives ` +
        `(#54's second acceptance criterion); it is stated at ${stated}`,
    );
  }
  return scales;
}

/** Everything the model computes, at every required scale. */
export function model(inputs) {
  const perScale = new Map();
  for (const actives of REQUIRED_SCALES) perScale.set(actives, project(inputs, actives));
  return perScale;
}

/**
 * Compare the projection table against the model. Returns
 * `{ problems, checked }`, and `checked` is what `COST005` reads: a comparison
 * that ran over nothing is not agreement.
 */
export function checkProjection(rows, inputs) {
  const problems = [];
  let checked = 0;
  const scales = readScales(rows[0]);
  const perScale = model(inputs);
  const stated = new Map(rows.slice(1).map((row) => [plain(row[0]), row]));

  for (const item of LINE_ITEMS) {
    const row = stated.get(item.label);
    if (row === undefined) {
      problems.push(`COST003: the projection has no row for "${item.label}"`);
      continue;
    }
    scales.forEach((actives, index) => {
      const expected = round2(perScale.get(actives).figures.get(item.label));
      const found = numberIn(row[index + 1]);
      checked += 1;
      if (found === undefined) {
        problems.push(
          `COST003: "${item.label}" at ${actives.toLocaleString('en-US')} MAU is not a number ` +
            `(cell: "${row[index + 1]}"); the model gives ${money(item, expected)}`,
        );
        return;
      }
      if (round2(found) !== expected) {
        problems.push(
          `COST003: "${item.label}" at ${actives.toLocaleString('en-US')} MAU states ` +
            `${money(item, found)}; the model gives ${money(item, expected)}`,
        );
      }
    });
  }

  for (const [label, rank] of Object.entries(DOMINANCE_ROWS)) {
    const row = stated.get(label);
    if (row === undefined) {
      problems.push(`COST006: the projection has no "${label}" row`);
      continue;
    }
    scales.forEach((actives, index) => {
      const ranked = [...perScale.get(actives).components].sort((a, b) => b.value - a.value);
      const expected = ranked[rank].label;
      checked += 1;
      if (plain(row[index + 1]) !== expected) {
        problems.push(
          `COST006: "${label}" at ${actives.toLocaleString('en-US')} MAU states ` +
            `"${plain(row[index + 1])}"; the model gives "${expected}"`,
        );
      }
    });
  }

  return { problems, checked };
}

/** One row of the donations table, recomputed from the card rate. */
export function donation(inputs, chargesPerYear) {
  const amount = inputs.support_usd_year / chargesPerYear;
  const fees = chargesPerYear * (inputs.fee_rate * amount + inputs.fee_fixed);
  return { amount, fees, share: (fees / inputs.support_usd_year) * 100 };
}

/**
 * Compare the donations table against the model. The number of charges a year
 * is read from the document — it is the cadence being illustrated, not a
 * derived figure — and everything else on the row is recomputed from it.
 */
export function checkDonations(rows, inputs) {
  const problems = [];
  let checked = 0;
  for (const row of rows.slice(1)) {
    if (row.length < 5) continue;
    const cadence = plain(row[0]);
    const charges = numberIn(row[1]);
    if (charges === undefined || charges <= 0) {
      problems.push(`COST003: the "${cadence}" row states no readable number of charges a year`);
      continue;
    }
    const expected = donation(inputs, charges);
    const cells = [
      { name: 'amount per charge', found: numberIn(row[2]), want: round2(expected.amount), dp: 2 },
      { name: 'fees per year', found: numberIn(row[3]), want: round2(expected.fees), dp: 2 },
      {
        name: 'share of the gift',
        found: numberIn(row[4]),
        want: Math.round(expected.share * 10 + 1e-9) / 10,
        dp: 1,
      },
    ];
    for (const cell of cells) {
      checked += 1;
      if (cell.found === undefined) {
        problems.push(`COST003: the "${cadence}" row's ${cell.name} is not a number`);
        continue;
      }
      const rounded = cell.dp === 1 ? Math.round(cell.found * 10 + 1e-9) / 10 : round2(cell.found);
      if (rounded !== cell.want) {
        problems.push(
          `COST003: the "${cadence}" row's ${cell.name} states ${cell.found.toFixed(cell.dp)}; ` +
            `the model gives ${cell.want.toFixed(cell.dp)}`,
        );
      }
    }
  }
  return { problems, checked };
}

/**
 * The population at which basemap tile requests overtake archive storage.
 *
 * Quoted in the document's prose and regenerated by `--print`. It is the one
 * derived figure here that a rule does not check — see §Limits.
 */
export function crossover(inputs) {
  const perActive = ((inputs.L * inputs.T * (1 - inputs.h)) / 1e6) * inputs.p_classB;
  if (perActive <= 0) return Infinity;
  return ((inputs.S / 1e9) * inputs.p_storage) / perActive;
}

/** The tables the model computes, as Markdown, for pasting into the document. */
export function printable(inputs) {
  const perScale = model(inputs);
  const head = `| Line item | ${REQUIRED_SCALES.map((a) => `${a.toLocaleString('en-US')} MAU`).join(' | ')} |`;
  const rule = `| --- | ${REQUIRED_SCALES.map(() => '---').join(' | ')} |`;
  const body = LINE_ITEMS.map((item) => {
    const cells = REQUIRED_SCALES.map((a) =>
      money(item, round2(perScale.get(a).figures.get(item.label))),
    );
    return `| ${item.label} | ${cells.join(' | ')} |`;
  });
  for (const [label, rank] of Object.entries(DOMINANCE_ROWS)) {
    const cells = REQUIRED_SCALES.map((a) => {
      const ranked = [...perScale.get(a).components].sort((x, y) => y.value - x.value);
      return ranked[rank].label;
    });
    body.push(`| ${label} | ${cells.join(' | ')} |`);
  }
  // A non-finite crossover is said in words rather than printed as `∞`. This
  // output is pasted into the document as prose, and "at ∞ monthly actives" is
  // a sentence nobody would leave in a cost model — so it would be hand-edited,
  // which is the one thing `--print` exists to stop.
  const crossoverAt = crossover(inputs);
  const sentence = Number.isFinite(crossoverAt)
    ? `Tile requests overtake archive storage at ${Math.round(crossoverAt).toLocaleString('en-US')} monthly actives.`
    : 'Tile requests never overtake archive storage: at these inputs no tile request is billed.';
  return [head, rule, ...body, '', sentence].join('\n');
}

const entryPoint = process.argv[1];
const isEntryPoint = entryPoint !== undefined && import.meta.filename === realpathSync(entryPoint);
if (isEntryPoint) {
  const argv = process.argv.slice(2);
  const rootFlag = argv.indexOf('--root');
  const root = rootFlag === -1 ? process.cwd() : (argv[rootFlag + 1] ?? process.cwd());

  let problems = [];
  let checked = 0;
  try {
    const text = readFileSync(join(root, DOCUMENT), 'utf8');
    const read = readInputs(tableAfter(text, ANCHORS.inputs));
    problems = read.problems;
    // A model missing an input cannot be projected at all, and every figure
    // below would be reported as disagreeing with `NaN`. Report the cause
    // instead, and do not print a table of `$NaN` either.
    const readable = !problems.some((problem) => problem.startsWith('COST002'));
    if (readable && argv.includes('--print')) {
      console.log(printable(read.values));
      process.exit(0);
    }
    if (readable) {
      const projection = checkProjection(tableAfter(text, ANCHORS.projection), read.values);
      const donations = checkDonations(tableAfter(text, ANCHORS.donations), read.values);
      problems = [...problems, ...projection.problems, ...donations.problems];
      checked = projection.checked + donations.checked;
      for (const [name, count] of [
        ['projection', projection.checked],
        ['donations', donations.checked],
      ]) {
        if (count === 0) {
          problems.push(
            `COST005: the ${name} table yielded no comparison at all. A table whose rows this ` +
              'check skips reports no disagreement, and that is not agreement.',
          );
        }
      }
    }
  } catch (error) {
    const message = error.code === 'ENOENT' ? `COST001: ${DOCUMENT} is not there` : error.message;
    console.error(`check-cost-model: ${message}`);
    process.exit(1);
  }

  if (problems.length > 0) {
    console.error(`check-cost-model: ${DOCUMENT} does not agree with its own inputs.\n`);
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error(
      '\nRun `node scripts/check-cost-model.mjs --print` for the tables the model computes.' +
        '\nSee CLAUDE.md §4l and scripts/check-cost-model.mjs.',
    );
    process.exit(1);
  }
  console.log(
    `check-cost-model: ${DOCUMENT} agrees with its own inputs — ${String(checked)} figures checked ` +
      `at ${REQUIRED_SCALES.map((a) => a.toLocaleString('en-US')).join(', ')} monthly actives.`,
  );
}
