// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **The software this app includes, read out of its own notices document** —
 * #664.
 *
 * `scripts/check-third-party-notices.mjs` writes the document the app ships
 * at {@link THIRD_PARTY_NOTICES_URL} — every package in the app's
 * distributed closure and every native library in the APK, each with the
 * verbatim licence and notice text it carries — and writes its **contents**
 * a second time where `notices-source.ts` imports it. This reads the
 * contents: which packages, at which versions, under which declared licence,
 * so the Credits screen can list them and link the full text.
 *
 * ⚠️ **It reads what the generator wrote and nothing else.** Nothing here
 * decides what ships; the generator does, from pnpm's own answer, and
 * `check:notices` fails when the committed files are not what it writes. A
 * line this cannot read is reported, never skipped: a package missing from
 * the screen is a notice a rider cannot reach, which is the defect #664
 * exists to close.
 */

/**
 * The full document, relative to the page — for `map/basemap.ts`
 * §`GLYPHS_URL`'s reason, as `credits.ts` §`SHIPPED_LICENCE_TEXTS` is: it
 * resolves against this deployment's own origin, and inside the Android shell
 * against the APK's own assets, so it opens with the network off.
 */
export const THIRD_PARTY_NOTICES_URL = './licences/third-party.txt';

/** One package or library the app ships. */
export interface IncludedSoftware {
  readonly name: string;
  readonly version: string;
  /** The licence expression it declares, as the document states it. */
  readonly licence: string;
}

/** What the contents say, and anything in them this could not read. */
export interface SoftwareNotices {
  /** Part 1: in the app itself, which the Android app carries too. */
  readonly app: readonly IncludedSoftware[];
  /** Part 2: native libraries only the Android app contains. */
  readonly android: readonly IncludedSoftware[];
  readonly problems: readonly string[];
}

/** `Part 1 — in the app (40 packages)` and its siblings. */
const PART = /^Part (\d) — .*?(?:\((\d+) (?:packages|libraries)\))?$/;

/** `  react 19.3.0 — MIT`: a name and a version with no space in either. */
const PACKAGE_LINE = /^ {2}(\S+) (\S+) — (.+)$/;

/** `  androidx.core:core:1.17.0 — Apache-2.0`: the version is after the last colon. */
const LIBRARY_LINE = /^ {2}(\S+):([^:\s]+) — (.+)$/;

/**
 * The two lists in a notices document, or in its contents.
 *
 * Stops at the first entry separator, so the whole document and the contents
 * file read the same. Each part's declared count is checked against the lines
 * read under it, so a list cut short says so rather than looking complete.
 */
export function parseNotices(text: string): SoftwareNotices {
  const app: IncludedSoftware[] = [];
  const android: IncludedSoftware[] = [];
  const problems: string[] = [];
  const declared = new Map<string, number>();
  let part: string | undefined;

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^={20,}$/.test(line)) {
      break;
    }
    const heading = PART.exec(line);
    if (heading !== null) {
      part = heading[1];
      if (heading[2] !== undefined && part !== undefined) {
        declared.set(part, Number(heading[2]));
      }
      continue;
    }
    if (part !== '1' && part !== '2') {
      continue;
    }
    // A blank line, the projects' sub-heading and the projects themselves
    // (`  :capacitor-android — …`) are not packages of their own: each project
    // is built from a package already listed in part 1.
    if (line.trim() === '' || !line.startsWith('  ') || line.startsWith('  :')) {
      continue;
    }
    if (line.startsWith('   ') || /^ {2}Built into/.test(line)) {
      continue;
    }
    const match = (part === '1' ? PACKAGE_LINE : LIBRARY_LINE).exec(line);
    if (match === null) {
      problems.push(`This line of the notices could not be read: ${line.trim()}`);
      continue;
    }
    const [, name = '', version = '', licence = ''] = match;
    (part === '1' ? app : android).push({ name, version, licence });
  }

  for (const [which, list] of [
    ['1', app],
    ['2', android],
  ] as const) {
    const expected = declared.get(which);
    if (expected === undefined) {
      problems.push(`The notices do not say how many entries part ${which} has.`);
    } else if (expected !== list.length) {
      problems.push(
        `Part ${which} of the notices says it has ${String(expected)} entries and ` +
          `${String(list.length)} could be read.`,
      );
    }
  }
  return { app, android, problems };
}
