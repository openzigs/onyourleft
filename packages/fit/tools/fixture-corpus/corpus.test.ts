// SPDX-License-Identifier: Apache-2.0

/**
 * The corpus is closed, byte-stable, documented and inside its budget.
 *
 * These four are one test file because they are one argument: what is committed
 * is exactly what the generator produces, nothing else is in the directory, the
 * README says what each file is for, and the whole thing fits in the space the
 * repository has agreed to give it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildCorpus, CORPUS_BYTE_BUDGET } from './corpus';
import {
  CORPUS_DIRECTORY,
  manifestOf,
  MANIFEST_PATH,
  README_PATH,
  README_TABLE_BEGIN,
  README_TABLE_END,
  renderManifest,
  renderReadmeTable,
  sha256,
} from './corpus-files';

const corpus = buildCorpus();

const committedBytes = (name: string): Uint8Array =>
  Uint8Array.from(readFileSync(join(CORPUS_DIRECTORY, name)));

describe('the corpus directory is closed', () => {
  it('contains exactly the generated fixtures, and nothing else', () => {
    // The check that catches a real ride file dropped in beside the synthetic
    // ones, whatever its coordinates are — and the check that catches a fixture
    // deleted from the generator but left on disk.
    expect(readdirSync(CORPUS_DIRECTORY).sort()).toEqual(corpus.map((entry) => entry.name).sort());
  });

  it('gives every fixture a distinct name', () => {
    const names = corpus.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('names every fixture with the extension of its format', () => {
    for (const entry of corpus) {
      expect(entry.name.endsWith(`.${entry.format}`)).toBe(true);
    }
  });
});

describe('the corpus is byte-stable', () => {
  it.each(corpus.map((entry) => [entry.name] as const))(
    '%s on disk is byte-identical to a fresh generation',
    (name) => {
      const built = corpus.find((entry) => entry.name === name);
      expect(built).toBeDefined();
      expect([...committedBytes(name)]).toEqual([...(built?.bytes ?? new Uint8Array(0))]);
    },
  );

  it('generates identical bytes when built twice in one process', () => {
    // Catches the traps that survive a single build: a clock read, an unseeded
    // random source, a `Map` or `Set` iteration order, or a counter that
    // accumulates across calls.
    const again = buildCorpus();
    expect(again.map((entry) => sha256(entry.bytes))).toEqual(
      corpus.map((entry) => sha256(entry.bytes)),
    );
    expect(again.map((entry) => entry.name)).toEqual(corpus.map((entry) => entry.name));
  });

  it('contains no clock read and no random source anywhere in the generator', () => {
    // A direct check on the generator's source rather than on its output,
    // because a clock read in a rarely-taken branch would not show up in a diff
    // of two builds a millisecond apart — and by then the failure looks like a
    // decoder bug in #30 rather than a corpus bug here.
    //
    // Comments are stripped first. Both this file and `ride.ts` explain the
    // rule in prose that names the very calls it forbids, and a check that
    // fired on its own documentation would be turned off within a week.
    const withoutComments = (source: string) =>
      source.replaceAll(/\/\*[\s\S]*?\*\//g, ' ').replaceAll(/\/\/.*$/gm, ' ');

    const sources = readdirSync(import.meta.dirname).filter(
      (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
    );
    expect(sources.length).toBeGreaterThan(5);
    for (const name of sources) {
      const code = withoutComments(readFileSync(join(import.meta.dirname, name), 'utf8'));
      expect(code, `${name} must not read the clock`).not.toMatch(/\bDate\.now\b/);
      expect(code, `${name} must not use a random source`).not.toMatch(/\bMath\.random\b/);
      expect(code, `${name} must not read the environment`).not.toMatch(/\bprocess\.env\b/);
    }
  });
});

describe('the manifest', () => {
  it('is exactly what the generator would write for this corpus', () => {
    expect(readFileSync(MANIFEST_PATH, 'utf8')).toBe(renderManifest(manifestOf(corpus)));
  });

  it('records a digest that reproduces from the committed bytes', () => {
    const manifest = manifestOf(corpus);
    for (const fixture of manifest.fixtures) {
      expect(sha256(committedBytes(fixture.name))).toBe(fixture.sha256);
    }
  });
});

describe('the README', () => {
  it('contains the generated fixture table verbatim', () => {
    // "Every case is present, each with a README entry saying what it is for"
    // is an acceptance criterion, and a hand-maintained table satisfies it
    // exactly once — on the day it is written.
    expect(readFileSync(README_PATH, 'utf8')).toContain(renderReadmeTable(corpus));
  });

  it('has exactly one generated block, so a second could not go stale unnoticed', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    expect(readme.split(README_TABLE_BEGIN)).toHaveLength(2);
    expect(readme.split(README_TABLE_END)).toHaveLength(2);
  });

  it('gives every fixture a purpose long enough to be a purpose', () => {
    for (const entry of corpus) {
      expect(entry.purpose.length, entry.name).toBeGreaterThan(80);
    }
  });
});

describe('the size budget', () => {
  it('holds the whole corpus under 256 KiB', () => {
    const total = corpus.reduce((bytes, entry) => bytes + entry.bytes.length, 0);
    expect(CORPUS_BYTE_BUDGET).toBe(262144);
    expect(total).toBeLessThanOrEqual(CORPUS_BYTE_BUDGET);
  });

  it('records the current total in the README, regenerated so it cannot drift', () => {
    const total = corpus.reduce((bytes, entry) => bytes + entry.bytes.length, 0);
    expect(readFileSync(README_PATH, 'utf8')).toContain(
      `${String(corpus.length)} fixtures, ${String(total)} bytes of the ${String(CORPUS_BYTE_BUDGET)} byte budget`,
    );
  });

  it('keeps any single fixture from taking more than a fifth of the budget', () => {
    for (const entry of corpus) {
      expect(entry.bytes.length, entry.name).toBeLessThan(CORPUS_BYTE_BUDGET / 5);
    }
  });
});

describe('the cases the issue requires', () => {
  const named = (name: string) => corpus.find((entry) => entry.name === name);

  it.each([
    ['nominal-outdoor-ride.fit'],
    ['indoor-trainer-no-position.fit'],
    ['paused-laps.fit'],
    ['sensor-dropout-30s.fit'],
    ['antimeridian-crossing.fit'],
    ['point-nemo-southern-western.fit'],
    ['truncated-mid-record.fit'],
    ['developer-fields.fit'],
    ['heart-rate-16-bit.fit'],
    ['zero-length.fit'],
    ['header-only.fit'],
    ['timestamp-epoch-boundary.fit'],
    ['event-timestamp-1024-wrap.fit'],
    ['nominal-ride.gpx'],
    ['point-nemo.gpx'],
    ['xxe-external-entity.gpx'],
    ['nominal-ride.tcx'],
    ['indoor-no-position.tcx'],
    ['xxe-external-entity.tcx'],
  ])('%s is present', (name) => {
    expect(named(name)).toBeDefined();
  });

  it('covers all three formats', () => {
    expect([...new Set(corpus.map((entry) => entry.format))].sort()).toEqual(['fit', 'gpx', 'tcx']);
  });

  it('has a zero-length file that really is zero bytes', () => {
    expect(named('zero-length.fit')?.bytes.length).toBe(0);
  });

  it('has a header-only file that is a header and a CRC and nothing else', () => {
    expect(named('header-only.fit')?.bytes.length).toBe(16);
  });

  it('carries an external entity declaration in both XML formats', () => {
    for (const name of ['xxe-external-entity.gpx', 'xxe-external-entity.tcx']) {
      const text = new TextDecoder().decode(committedBytes(name));
      expect(text, name).toContain('<!ENTITY xxe SYSTEM "file:///etc/passwd">');
      expect(text, name).toContain('&xxe;');
    }
  });

  it('carries a nested entity expansion in the billion-laughs fixture', () => {
    const text = new TextDecoder().decode(committedBytes('billion-laughs.gpx'));
    expect(text).toContain('<!DOCTYPE gpx [');
    expect(text).toContain('<!ENTITY lol6 ');
    expect(text).toContain('&lol6;');
    // Small on disk, enormous expanded: that asymmetry is the attack. A fixture
    // that had lost its nesting would still contain the strings above.
    expect(text.length).toBeLessThan(1024);
  });

  it('carries a structural nest in both deep-nesting fixtures', () => {
    // The class of attack a fuzz of this corpus cannot invent for itself: its
    // cases are byte substitutions and truncations, and neither produces three
    // hundred levels of nesting. #149.
    for (const [name, element] of [
      ['deep-nesting.gpx', 'deep'],
      ['deep-nesting.tcx', 'Deep'],
    ] as const) {
      const text = new TextDecoder().decode(committedBytes(name));
      const opens = text.split(`<${element}>`).length - 1;
      const closes = text.split(`</${element}>`).length - 1;
      expect(opens, name).toBe(closes);
      // Deeper than `src/xml/parse.ts`'s `MAXIMUM_DEPTH`, which is 256. Checked
      // against the number rather than the constant, so that raising the
      // constant without regenerating the corpus is a red test rather than a
      // fixture that quietly stops attacking anything.
      expect(opens, name).toBeGreaterThan(256);
      // And it is nesting rather than a flat run of siblings.
      expect(text, name).toContain(`<${element}><${element}>`);
      expect(text, name).toContain(`</${element}></${element}>`);
    }
  });

  it('has a truncated GPX that really is cut off mid-element', () => {
    const text = new TextDecoder().decode(committedBytes('truncated-mid-trackpoint.gpx'));
    expect(text).not.toContain('</gpx>');
    expect(text).not.toContain('</trkseg>');
    expect(text.endsWith('\n')).toBe(false);
    // Past the last trkpt's coordinates, so every coordinate still pairs and
    // the region guard can see all of them. See `truncatedGpx`.
    expect(text.endsWith('<time>2024-06-')).toBe(true);
  });

  it('carries no entity declaration in any fixture that is not one of the three hostile ones', () => {
    // An allowlist by exact name rather than by prefix. `xxe-` was a prefix and
    // a prefix is a rule a future fixture can join by accident; these three are
    // the documents that are *meant* to carry a DTD and nothing else may.
    const hostile = new Set([
      'xxe-external-entity.gpx',
      'xxe-external-entity.tcx',
      'billion-laughs.gpx',
    ]);
    for (const entry of corpus) {
      if (hostile.has(entry.name)) continue;
      expect(new TextDecoder().decode(entry.bytes), entry.name).not.toContain('<!ENTITY');
      expect(new TextDecoder().decode(entry.bytes), entry.name).not.toContain('<!DOCTYPE');
    }
  });
});
