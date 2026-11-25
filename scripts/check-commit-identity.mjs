#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Fail when a commit's identity metadata contains a private term (#3205).
 *
 * ## Why the tree checks are not enough
 *
 * Every other gate here reads the TREE. A commit's author, committer and
 * trailers are not in the tree: they are in the commit object, and a push
 * publishes them on a public repository as surely as a file. A commit made on
 * a private machine once put that machine's hostname into a `Co-authored-by:`
 * trailer here; it was scrubbed from history, and this is the check that stops
 * the next one.
 *
 * ## What it reads
 *
 * For every commit in the range: the author name and email, the committer name
 * and email, every trailer (`Co-authored-by`, `Signed-off-by` and the rest, as
 * git itself parses them), and the full message. The range is
 *
 *   --base B --head H   B..H: a pull request's base..head, a push's
 *                       before..after, a merge-queue entry's base..head;
 *   no usable base      the last FALLBACK_COUNT commits of H instead, when B is
 *                       absent, all zeros (the first push of a branch), not a
 *                       commit this clone holds, or `--forced true` (a forced
 *                       push, whose `before` is not history any more).
 *
 * The clone must hold the history: CI unshallows it first (rules.yml).
 *
 * ## The terms are NOT in this repository
 *
 * A published list of banned words is the disclosure the check exists to
 * prevent. The list comes from `PRIVATE_TERMS` (a repository secret in CI; one
 * term per line, `#` starts a comment, a leading `=` forces a whole-token
 * match) or, for a local run, from the file named by `PRIVATE_TERMS_FILE`. The
 * suite uses invented words.
 *
 * ## How a term matches -- the same rule as Metis's private-vocabulary gate
 *
 * - **collapsed** (a term of 5 or more alphanumerics): text and term are
 *   lowercased and stripped to alphanumerics, then compared by substring, so
 *   `Foo_Bar`, `foo-bar`, `FOOBAR` and `x.foobar.example` all match `foo-bar`.
 * - **token** (a shorter term, or one written `=term`): the text is split into
 *   lowercase tokens at non-alphanumerics and at camelCase joins, and the
 *   term's words must equal a consecutive run of them. A short term must not
 *   fire inside an ordinary word, which a substring match would do constantly.
 *
 * No RegExp is built from a term: a pattern that arrives as data is a ReDoS
 * surface, and plain string comparison needs none.
 *
 * ## Never print what matched
 *
 * The Actions log of a public repository is public. A hit is reported as the
 * commit SHA and the FIELD (`author email`, `Co-authored-by trailer`, ...) and
 * nothing else: not the term, not the matched text, not a trailer key git did
 * not come with, since the key is text from the commit too.
 *
 * ## When there is no list
 *
 * A fork's pull request cannot read the secret, and must still be able to
 * pass. So without a list the check SKIPS, saying so. Where the secret must
 * exist -- a push, a merge-queue entry, a pull request from this repository --
 * CI sets `REQUIRE_PRIVATE_TERMS=true`, and the skip becomes a failure: a
 * missing secret there means the check was disarmed, not withheld. A list that
 * parses to no terms is a failure either way: it checked nothing.
 *
 * Usage:
 *   node scripts/check-commit-identity.mjs [--base <sha>] [--head <rev>] [--forced true|false]
 *
 * Exit codes: 0 clean, or skipped while not required; 1 a hit, an empty list,
 * a required list absent, or a range git cannot read.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Terms shorter than this (after collapsing) always match as whole tokens. */
const MIN_COLLAPSED_LENGTH = 5;

/** How many commits a range with no usable base falls back to. */
const FALLBACK_COUNT = 50;

const SKIP_MESSAGE = 'private-terms secret not available: identity check skipped';

/**
 * Trailer keys whose NAME may be printed. Any other key is text that came from
 * the commit, so it is reported by position only.
 */
const NAMED_TRAILERS = new Map(
  [
    'Co-authored-by',
    'Signed-off-by',
    'Reviewed-by',
    'Acked-by',
    'Tested-by',
    'Reported-by',
    'Suggested-by',
    'Helped-by',
    'Co-developed-by',
    'Cc',
    'Claude-Session',
    'Change-Id',
    'Refs',
    'Fixes',
    'Closes',
    'Resolves',
  ].map((key) => [key.toLowerCase(), key]),
);

/** @param {string} text */
function collapse(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** @param {string} text */
function tokenize(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * @param {string} raw
 * @returns {{ mode: "collapsed" | "token", collapsed: string, words: string[] }[]}
 */
function parseTerms(raw) {
  const terms = [];
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;
    const forcedToken = line.startsWith('=');
    const body = forcedToken ? line.slice(1).trim() : line;
    const collapsed = collapse(body);
    // A term with no alphanumerics would collapse to "" and match everything.
    if (collapsed.length === 0) continue;
    terms.push({
      mode: forcedToken || collapsed.length < MIN_COLLAPSED_LENGTH ? 'token' : 'collapsed',
      collapsed,
      words: tokenize(body),
    });
  }
  return terms;
}

/** @param {string[]} tokens @param {string[]} words */
function hasTokenRun(tokens, words) {
  if (words.length === 0) return false;
  for (let start = 0; start + words.length <= tokens.length; start += 1) {
    if (words.every((word, offset) => tokens[start + offset] === word)) return true;
  }
  return false;
}

/** @param {string} text @param {ReturnType<typeof parseTerms>} terms */
function containsTerm(text, terms) {
  const collapsed = collapse(text);
  const tokens = tokenize(text);
  return terms.some((term) =>
    term.mode === 'collapsed'
      ? collapsed.includes(term.collapsed)
      : hasTokenRun(tokens, term.words),
  );
}

/** @param {string} message @param {number} code */
function fail(message, code = 1) {
  console.error(`check-commit-identity: ${message}`);
  process.exit(code);
}

/** @param {string[]} args */
function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** @param {string} rev */
function isCommit(rev) {
  try {
    git(['cat-file', '-e', `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const options = { base: '', head: 'HEAD', forced: '' };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    const name = flag?.replace(/^--/, '');
    if (!name || !(name in options) || !flag.startsWith('--') || value === undefined) {
      fail(`unknown or incomplete argument: ${flag ?? ''}`, 2);
    }
    options[name] = value;
  }
  return options;
}

function loadTerms() {
  const inline = process.env.PRIVATE_TERMS ?? '';
  if (inline.trim().length > 0) return { source: 'PRIVATE_TERMS', raw: inline };
  const file = process.env.PRIVATE_TERMS_FILE ?? '';
  if (file.length > 0) {
    let raw;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (error) {
      fail(`PRIVATE_TERMS_FILE could not be read (${/** @type {Error} */ (error).message})`);
    }
    if (raw.trim().length > 0) return { source: 'PRIVATE_TERMS_FILE', raw };
  }
  return null;
}

const options = parseArgs(process.argv.slice(2));

const loaded = loadTerms();
if (loaded === null) {
  const required = ['1', 'true'].includes(
    (process.env.REQUIRE_PRIVATE_TERMS ?? '').trim().toLowerCase(),
  );
  if (required) {
    fail(
      'private-terms secret not available, and REQUIRE_PRIVATE_TERMS is set: ' +
        'NOTHING WAS CHECKED. On a push, a merge-queue entry or a pull request from this ' +
        'repository the PRIVATE_TERMS secret must exist: restore it, do not unset the requirement.',
    );
  }
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::warning::${SKIP_MESSAGE}`);
  console.log(SKIP_MESSAGE);
  process.exit(0);
}

const terms = parseTerms(loaded.raw);
if (terms.length === 0) {
  fail(`the list in ${loaded.source} has no terms, only comments or blanks: nothing was checked.`);
}

if (!isCommit(options.head)) fail('--head is not a commit this clone holds.');

const base = options.base.trim();
let range;
let rangeLabel;
let fallbackReason = '';
if (base.length === 0) fallbackReason = 'no base was given';
else if (/^0+$/.test(base)) fallbackReason = "the base is all zeros (a branch's first push)";
else if (options.forced.trim().toLowerCase() === 'true') fallbackReason = 'the push was forced';
else if (!isCommit(base)) fallbackReason = 'the base is not a commit this clone holds';
if (fallbackReason) {
  range = [`--max-count=${FALLBACK_COUNT}`, options.head];
  rangeLabel = `the last ${FALLBACK_COUNT} commits, because ${fallbackReason}`;
} else {
  range = [`${base}..${options.head}`];
  rangeLabel = 'base..head';
}

// One record per commit (-z ends each with NUL). Within a record the fields are
// split by US (0x1f) and the trailers by GS (0x1d); the message is the LAST
// field so a stray separator inside it stays inside it. %an/%ae/%cn/%ce are the
// raw identities, not .mailmap's rewrite of them: the raw ones are what a push
// publishes.
const FORMAT = [
  '%H',
  '%an',
  '%ae',
  '%cn',
  '%ce',
  '%(trailers:only=true,unfold=true,separator=%x1d)',
  '%B',
].join('%x1f');

let output;
try {
  output = git(['log', '-z', '--no-color', `--format=${FORMAT}`, ...range, '--']);
} catch {
  fail(`git log could not read ${rangeLabel}. Is the clone shallow?`);
}

const records = output.split('\0').filter((record) => record.length > 0);
/** @type {{ sha: string, field: string }[]} */
const hits = [];
for (const record of records) {
  const parts = record.split('\x1f');
  const sha = parts[0] ?? '';
  if (parts.length < 7 || !/^[0-9a-f]{40,64}$/.test(sha)) {
    // Fail closed: a record this script cannot take apart is not a clean one.
    fail('git log printed a record this script could not parse, so it was NOT checked.');
  }
  const [, authorName, authorEmail, committerName, committerEmail, trailerBlock] = parts;
  const message = parts.slice(6).join('\x1f');

  /** @type {[string, string][]} */
  const fields = [
    ['author name', authorName],
    ['author email', authorEmail],
    ['committer name', committerName],
    ['committer email', committerEmail],
  ];
  trailerBlock
    .split('\x1d')
    .filter((trailer) => trailer.trim().length > 0)
    .forEach((trailer, index) => {
      const key = trailer
        .slice(0, Math.max(0, trailer.indexOf(':')))
        .trim()
        .toLowerCase();
      const named = NAMED_TRAILERS.get(key);
      fields.push([named ? `${named} trailer` : `trailer ${index + 1} (key not shown)`, trailer]);
    });
  fields.push(['commit message', message]);

  for (const [field, text] of fields) {
    if (containsTerm(text, terms)) hits.push({ sha, field });
  }
}

if (hits.length > 0) {
  console.error('Private terms found in commit identity metadata:\n');
  for (const hit of hits) {
    console.error(`  ${hit.sha}  ${hit.field}`);
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.error(`::error::commit ${hit.sha}: private term in its ${hit.field}`);
    }
  }
  console.error(
    '\nThe matched text is deliberately not shown: this log may be public. Rewrite the ' +
      "commit's identity or message (git commit --amend --reset-author, or an interactive " +
      'rebase) before it reaches main; once it is there, it is history.',
  );
  process.exit(1);
}

console.log(
  `check-commit-identity: ${records.length} commit(s) in ${rangeLabel} scanned against ` +
    `${terms.length} private term(s) from ${loaded.source}, none found.`,
);
