#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The app's third-party licence notices: generated from the installed tree,
 * committed, and checked for drift — #664.
 *
 * ## The defect, and why the licence gate could not see it
 *
 * MIT, ISC, the BSDs and Apache-2.0 all ask for their copyright and permission
 * notice — and, for Apache-2.0, any `NOTICE` file — to travel with copies. The
 * app ships React, three, MapLibre, Dexie, MediaPipe and thirty-odd more to
 * every browser that opens it and inside every APK, and until #664 it shipped
 * none of their notices. `check-dependency-licences.mjs` (`DEP001`, `DEP002`)
 * decides which licences are **admitted**; it reads each manifest's `license`
 * field and cannot say whether a notice is **carried**. Admitted is not the
 * same as noticed, and this is the gate for the second.
 *
 * ## What it produces
 *
 * `apps/web/public/licences/third-party.txt`, which Vite copies into `dist`
 * — so it is served beside the app, precached by the service worker like
 * everything else in `public/`, and inside the APK because the APK carries
 * `dist` (CLAUDE.md §4h). One document with four parts:
 *
 * 1. every package in the app's **distributed** closure, with its name,
 *    version, licence expression and the **verbatim** text of every
 *    `LICENSE`/`LICENCE`/`COPYING` and `NOTICE` file it ships;
 * 2. every native library the APK links, from the reviewed list in
 *    `apps/mobile/native-closure.json` (`src/android/native-closure.ts` holds
 *    that list to Gradle where Gradle has run);
 * 3. the files the build copies out of a package into `dist`, and which
 *    package each came from;
 * 4. the code the bundler itself writes into `dist` — see
 *    `WRITTEN_BY_THE_BUNDLER`.
 *
 * ## Shape (b): committed, and regenerated-and-diffed — not built
 *
 * #664 offered two shapes. This is (b), for three reasons that are about this
 * repository rather than taste:
 *
 * - **The closure is pnpm's answer, and a build should not have to ask.**
 *   The whole check is about 2 s on a warm install (4 s in CI) — the cost is
 *   not the reason. Doing it inside `vite build` would put seven `pnpm
 *   licenses list` calls in every build, including the two `test:browser`
 *   makes, and make a build depend on a package manager being on `PATH`.
 * - **A dependency bump then shows its licence text in the diff.** A new
 *   package, or one whose `LICENSE` changed, is a red check on the pull request
 *   that caused it and a hunk a reviewer reads — which is the point of a
 *   notices file. Built at build time, it would change silently.
 * - **The native half has to be committed anyway**, because CI cannot run
 *   Gradle, so shape (a) would still have needed a committed input.
 *
 * The price is the one `credits/source.ts` names about a generated, committed
 * file: a second copy of a source of truth. That is exactly what CLAUDE.md §4k
 * gates, and this checker is that gate's shape — **including its own
 * `pnpm install --frozen-lockfile` first**, for #298's reason: a regenerate-
 * and-diff over a `node_modules` nobody checked against the lockfile proves
 * only that two wrong things agree. It writes nothing in its checking mode, so
 * there is nothing to restore.
 *
 * ## The closure is the union, not `--filter @onyourleft/web`
 *
 * ⚠️ `pnpm licenses list --filter` does not follow workspace links (CLAUDE.md
 * §4g): `dexie` reaches the app only through `@onyourleft/store`, and a
 * notices file built from `--filter @onyourleft/web` alone would leave it out.
 * So the closure is the union of every workspace package's `--prod` closure,
 * read by **the same two functions** `check-dependency-licences.mjs` judges
 * the licences with — `discoverPackages` and `readClosure` are imported, not
 * re-derived, so the packages noticed and the packages admitted cannot be two
 * different lists. Every workspace package is reached from `@onyourleft/web`
 * today, so the union over all of them IS the app's closure; one that is not
 * would be over-noticed, which is the safe direction.
 *
 * ## The text is read from the files, never from the manifest
 *
 * A manifest's `license` field names a licence; it does not carry its text,
 * and it can be incomplete. Lucide's manifest says `ISC` while its `LICENSE`
 * is ISC **and** MIT, for the icons derived from Feather — a generator that
 * trusted the field would drop the MIT half. The field is printed as what the
 * package declares; the notice is every licence file the package ships.
 *
 * ## Fails closed
 *
 * A package with no licence file is a failure naming it, not an entry with a
 * name and no text. Three packages in today's closure ship none —
 * `@mediapipe/tasks-vision`, `murmurhash-js` and `pmtiles`, found by the first
 * run of this generator — and each has a reviewed entry in
 * `apps/web/third-party-notices.json` saying where its notice comes from
 * instead, keyed by name AND version, so a bump fails closed again until
 * somebody reads the new one. An entry nothing uses is a failure too
 * (`LIC006`'s reason: an exemption that has stopped meaning something stops
 * the build).
 *
 * Rules:
 *   NOT001  `pnpm install --frozen-lockfile` did not succeed
 *   NOT002  no workspace package was discovered, or the union of their
 *           distributed closures is empty — a gate over nothing is not a pass
 *   NOT003  a package in the closure ships no licence file and no reviewed
 *           entry supplies one
 *   NOT004  a reviewed entry is stale: its package is not in the closure, now
 *           ships its own licence file, or its excerpt marker is not there
 *   NOT005  the native list or the copied-file list names something this
 *           generator cannot render: a licence with no text here, a project
 *           whose package is not in the closure, a copied file not in its
 *           package
 *   NOT006  the committed document is not what the generator writes
 *   NOT007  the committed document is not there
 *   NOT008  a package whose code the bundler writes into the build (Vite's
 *           module-preload polyfill and preload helper, Rolldown's runtime) has
 *           no reviewed entry at its installed version
 *
 * Usage: node scripts/check-third-party-notices.mjs [--root <dir>] [--write]
 *                                                   [--assume-installed]
 * Exit:  0 clean (or written), 1 on any rule.
 *
 * ## Limits
 *
 * - `copiedIntoBuild` is a reviewed list this checker renders and cannot
 *   complete: it does not build. What holds it complete is the build itself —
 *   `apps/web/tools/notices/copied-into-build.ts`, a plugin in the product's
 *   `vite.config.ts`, fails `pnpm run build` over a package's non-code asset
 *   the list does not name. It reads the product build only.
 * - `WRITTEN_BY_THE_BUNDLER` is written down, not discovered: a second bundler,
 *   or a plugin that injects its own runtime, is noticed only once somebody
 *   adds it there.
 * - It notices what pnpm says ships. Code a package **vendors** under its own
 *   licence field — MediaPipe's bundle is one binary built from many projects
 *   — is noticed only as far as that package's own files notice it. The same
 *   limit §4g states for `DEP001`.
 * - A platform-specific optional dependency would make the closure differ
 *   between a Mac and the Linux runner. There is none in the distributed
 *   closure today; the day there is, this goes red on one of the two, which is
 *   loud rather than wrong.
 * - The native half is only as current as the review; `native-closure.test.ts`
 *   is what holds the review to Gradle, and it skips where Gradle has not run.
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import process from 'node:process';

import { differingLines } from './check-capacitor-generated.mjs';
import { discoverPackages, readClosure } from './check-dependency-licences.mjs';

/** The committed document, relative to the repository root. */
export const DOCUMENT = 'apps/web/public/licences/third-party.txt';

/**
 * The document's contents — everything before its first entry — committed a
 * second time where the Credits screen imports it.
 *
 * ⚠️ **Why twice.** The screen lists every package, and it renders
 * synchronously from what is in the bundle, like the rest of Credits (#358) —
 * so the accessibility gate audits the list rather than a loading state, and
 * the list is there offline and inside the APK with no second request. The
 * whole document is about 125 KiB of licence text, which would have gone into
 * the entry chunk every rider downloads on every launch to render a list of
 * names; the contents are about 5 KiB. Both files are this generator's
 * output and NOT006 compares both, so they cannot drift apart.
 */
export const CONTENTS = 'apps/web/src/credits/third-party-contents.txt';

/** The reviewed inputs for the web half. */
export const WEB_INPUTS = 'apps/web/third-party-notices.json';

/** The reviewed native closure. */
export const NATIVE_INPUTS = 'apps/mobile/native-closure.json';

/**
 * The licence texts this generator can append by name, relative to the root.
 * `LIC005` pins each byte for byte against the canonical text, so the copy a
 * rider reads is the licence rather than something like it.
 */
export const LICENCE_TEXTS = { 'Apache-2.0': 'LICENSES/Apache-2.0.txt' };

/**
 * The packages whose OWN code the bundler writes into `dist`, each as the chain
 * of names Node resolves from `apps/web` to reach it.
 *
 * ⚠️ **In no closure at all**, which is why this list exists (#676's review).
 * `vite` is a devDependency, so `--prod` never lists it — yet `vite build`
 * writes its module-preload polyfill and its `__vitePreload` helper into the
 * entry chunk, and Rolldown, which Vite builds with, writes its CommonJS
 * interop runtime (`__commonJS`, `__toESM`, `__export`) into a
 * `rolldown-runtime-*.js` chunk the entry chunk imports. Both are MIT and
 * both ship.
 * Read off a real `dist` on 2026-09-27: `grep -l modulepreload
 * apps/web/dist/assets/*.js` names the entry chunk, and
 * `dist/assets/rolldown-runtime-*.js` is those helpers and nothing else.
 *
 * Each needs a reviewed entry in `writtenByTheBundler`, keyed by the version
 * INSTALLED here — so a Vite or Rolldown bump fails closed (NOT008) until
 * somebody re-reads what the new version writes and what its licence file
 * says, the same posture as `noLicenceFile`. A new bundler is a new line here.
 */
export const WRITTEN_BY_THE_BUNDLER = [['vite'], ['vite', 'rolldown']];

/** Where the bundler chains above are resolved from: the app that is built. */
export const BUILT_APP = 'apps/web';

/** How the committed document is put right. It runs the frozen install itself. */
export const REPAIR = 'pnpm run notices:generate';

/** The line every entry opens with. Long enough that no licence text reproduces it. */
export const SEPARATOR = '='.repeat(72);

/**
 * A licence or notice file, by name, anywhere in the name and in any case:
 * `LICENSE`, `license`, `LICENCE`, `LICENSE-MIT`, `COPYING.md`, `NOTICE`, and
 * — since #676's review — `ThirdPartyNotices.txt` and tslib's
 * `CopyrightNotice.txt`, which a pattern anchored at the start of the name
 * read past. The word must END there (an `s` aside), so `licensed-material.txt`
 * and a `noticeable` helper are not licence files.
 */
const LICENCE_FILE = /(?:licen[cs]e|notice)s?(?![a-z])|copying(?![a-z])/i;
const NOTICE_FILE = /notice/i;

/**
 * A root directory some packages keep their licences in, one file per licence
 * (REUSE's `LICENSES/`). Every file in it is read, whatever its name.
 */
const LICENCE_DIRECTORY = /^licen[cs]es$/i;

/**
 * Source, never a licence, whatever it is called: a `license.js` helper, a
 * `notice.d.ts`, a source map. Read as a notice, it would put code in the
 * document and pass every check.
 */
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|map|json)$/i;

/** Line endings and a byte-order mark normalised; the words untouched. */
function normalised(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+$/, '');
}

/** Code-point order, so the document cannot depend on the machine's locale. */
const byCodePoint = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

/**
 * The union of every workspace package's distributed closure, one entry per
 * `name@version`, each with the directory pnpm installed it in.
 */
export function distributedUnion(root) {
  const union = new Map();
  for (const workspacePackage of discoverPackages(root)) {
    for (const dependency of readClosure(root, workspacePackage.name, true)) {
      dependency.versions.forEach((version, index) => {
        const key = `${dependency.name}@${version}`;
        if (union.has(key)) return;
        union.set(key, {
          name: dependency.name,
          version,
          licence: dependency.license,
          directory: dependency.paths[index],
        });
      });
    }
  }
  return [...union.values()].sort(
    (left, right) => byCodePoint(left.name, right.name) || byCodePoint(left.version, right.version),
  );
}

/**
 * Every licence and notice file in a package directory, licences first: those
 * at its root, then everything in a root `LICENSES/` directory, named by their
 * path inside the package.
 */
export function licenceFiles(directory) {
  if (directory === undefined || !existsSync(directory)) return [];
  const isFile = (path) => statSync(join(directory, path)).isFile();
  const found = [];
  for (const name of readdirSync(directory)) {
    if (SOURCE_FILE.test(name)) continue;
    if (LICENCE_FILE.test(name) && isFile(name)) {
      found.push(name);
      continue;
    }
    if (LICENCE_DIRECTORY.test(name) && statSync(join(directory, name)).isDirectory()) {
      for (const inner of readdirSync(join(directory, name))) {
        const path = `${name}/${inner}`;
        if (!SOURCE_FILE.test(inner) && isFile(path)) found.push(path);
      }
    }
  }
  return found.sort((left, right) => {
    const notice = Number(NOTICE_FILE.test(left)) - Number(NOTICE_FILE.test(right));
    return notice || byCodePoint(left, right);
  });
}

/**
 * Node's own lookup, one name at a time: from `from`, each ancestor's
 * `node_modules/<name>`, the real path of the first that exists. Under pnpm a
 * package's dependencies are its siblings in `.pnpm/<it>/node_modules`, which
 * this reaches as the first ancestor's `node_modules`. The walk stops at
 * `root`: a `vite` in a home directory's `node_modules` is not this build's.
 */
export function resolveChain(root, from, chain) {
  let directory = from;
  for (const name of chain) {
    let found;
    for (let at = directory; ; at = dirname(at)) {
      if (basename(at) !== 'node_modules') {
        const candidate = join(at, 'node_modules', name);
        if (existsSync(join(candidate, 'package.json'))) {
          found = realpathSync(candidate);
          break;
        }
      }
      if (at === root || dirname(at) === at) break;
    }
    if (found === undefined) return undefined;
    directory = found;
  }
  return directory;
}

/** Lines `from` (inclusive) through `through` (inclusive), or to the end. */
function excerptOf(text, { from, through }) {
  const lines = normalised(text).split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === from);
  if (start === -1) return undefined;
  if (through === undefined) return lines.slice(start).join('\n');
  const end = lines.findIndex((line, index) => index > start && line.trimEnd() === through);
  if (end === -1) return undefined;
  return lines.slice(start, end + 1).join('\n');
}

function readJson(root, file) {
  return JSON.parse(readFileSync(join(root, file), 'utf8'));
}

function licenceText(root, licence) {
  const file = LICENCE_TEXTS[licence];
  return file === undefined ? undefined : normalised(readFileSync(join(root, file), 'utf8'));
}

/** One rendered entry. `sections` are `{ heading, text }`. */
function entry({ name, version, licence, part, sections }) {
  const lines = [
    SEPARATOR,
    `Name: ${name}`,
    `Version: ${version}`,
    `Licence: ${licence}`,
    `Part: ${part}`,
  ];
  for (const section of sections) {
    lines.push('', `--- ${section.heading} ---`, '', section.text);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Build the document, or the problems that stop it being built.
 *
 * Pure over `root` and what pnpm says: it writes nothing, so the check and
 * `--write` render exactly the same text.
 */
export function renderNotices(root) {
  const problems = [];
  let union;
  try {
    union = distributedUnion(root);
  } catch (error) {
    return { problems: [`NOT002 the closure could not be read: ${error.message}`] };
  }
  if (union.length === 0) {
    return {
      problems: [
        'NOT002 the distributed closure of every workspace package is empty, so there is ' +
          'nothing to notice — a notices gate over nothing is not a pass (#142).',
      ],
    };
  }

  const web = readJson(root, WEB_INPUTS);
  const native = readJson(root, NATIVE_INPUTS);
  const supplied = web.noLicenceFile ?? {};
  const used = new Set();
  const appendices = new Set();
  const entries = [];

  for (const dependency of union) {
    const key = `${dependency.name}@${dependency.version}`;
    const files = licenceFiles(dependency.directory);
    const reviewed = supplied[key];
    const sections = files.map((file) => ({
      heading: `${file} (from the package)`,
      text: normalised(readFileSync(join(dependency.directory, file), 'utf8')),
    }));

    if (files.length > 0 && reviewed !== undefined) {
      used.add(key);
      problems.push(
        `NOT004 ${key} ships its own licence file now (${files.join(', ')}), so its reviewed ` +
          `entry in ${WEB_INPUTS} is stale — delete it.`,
      );
    }
    if (files.length === 0) {
      if (reviewed === undefined) {
        const others = Object.keys(supplied).filter((other) =>
          other.startsWith(`${dependency.name}@`),
        );
        problems.push(
          `NOT003 ${key} ships no LICENSE, LICENCE, COPYING or NOTICE file ` +
            `(looked in ${dependency.directory ?? '(pnpm gave no path)'}), and no reviewed entry ` +
            `in ${WEB_INPUTS} says where its notice comes from` +
            (others.length > 0
              ? `. There is one for ${others.join(', ')}; a new version is read again, not assumed.`
              : '. Read the package, then add one.'),
        );
        continue;
      }
      used.add(key);
      if (reviewed.excerpt !== undefined) {
        const path = join(dependency.directory, reviewed.excerpt.file);
        const text = existsSync(path)
          ? excerptOf(readFileSync(path, 'utf8'), reviewed.excerpt)
          : undefined;
        if (text === undefined) {
          problems.push(
            `NOT004 ${key}: the reviewed excerpt of ${reviewed.excerpt.file}, from ` +
              `\`${reviewed.excerpt.from}\`, is not in the installed package.`,
          );
          continue;
        }
        sections.push({
          heading: `from ${reviewed.excerpt.file} (the package ships no licence file)`,
          text,
        });
      }
      if (reviewed.upstream !== undefined) {
        sections.push({
          heading: `from ${reviewed.upstream.url}, read ${reviewed.upstream.read} (the package ships no licence text)`,
          text: normalised(reviewed.upstream.text),
        });
      }
      if (reviewed.licenceText !== undefined) {
        if (licenceText(root, reviewed.licenceText) === undefined) {
          problems.push(
            `NOT005 ${key} asks for the text of ${reviewed.licenceText}, which this generator does not hold.`,
          );
          continue;
        }
        appendices.add(reviewed.licenceText);
        sections.push({
          heading: `${reviewed.licenceText}`,
          text: `The full text of ${reviewed.licenceText} is reproduced once, at the end of this document.`,
        });
      }
      if (sections.length === 0) {
        problems.push(`NOT004 ${key}: its reviewed entry in ${WEB_INPUTS} supplies no text.`);
        continue;
      }
    }
    entries.push(
      entry({
        name: dependency.name,
        version: dependency.version,
        licence: dependency.licence || '(none declared)',
        part: 'app',
        sections,
      }),
    );
  }

  for (const key of Object.keys(supplied).sort(byCodePoint)) {
    if (!used.has(key)) {
      problems.push(
        `NOT004 ${key} has a reviewed entry in ${WEB_INPUTS} and is not in the app's ` +
          'distributed closure — delete the entry.',
      );
    }
  }

  // Code the bundler writes into the build, which no closure lists.
  const bundlerEntries = [];
  const bundlerLines = [];
  const written = web.writtenByTheBundler ?? {};
  const wanted = new Set();
  for (const chain of WRITTEN_BY_THE_BUNDLER) {
    const directory = resolveChain(realpathSync(root), realpathSync(join(root, BUILT_APP)), chain);
    const name = chain.at(-1);
    if (directory === undefined) {
      problems.push(
        `NOT008 ${chain.join(' → ')} could not be resolved from ${BUILT_APP}, so the code it ` +
          'writes into the build cannot be noticed.',
      );
      continue;
    }
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    const key = `${name}@${manifest.version}`;
    wanted.add(key);
    const reviewed = written[key];
    if (reviewed === undefined) {
      const others = Object.keys(written).filter((other) => other.startsWith(`${name}@`));
      problems.push(
        `NOT008 the build writes ${key}'s own code into dist and no reviewed entry in ` +
          `${WEB_INPUTS} \`writtenByTheBundler\` notices it` +
          (others.length > 0
            ? `. There is one for ${others.join(', ')}; a new version is read again, not assumed.`
            : '.'),
      );
      continue;
    }
    const sections = [];
    for (const file of reviewed.files ?? []) {
      const path = join(directory, file.file);
      const whole = existsSync(path) ? readFileSync(path, 'utf8') : undefined;
      const text = whole === undefined || file.from === undefined ? whole : excerptOf(whole, file);
      if (text === undefined) {
        problems.push(
          `NOT004 ${key}: ${file.file}` +
            (file.from === undefined ? '' : `, from \`${file.from}\`,`) +
            ' is not in the installed package.',
        );
        continue;
      }
      sections.push({
        heading:
          file.from === undefined
            ? `${file.file} (from the package)`
            : `${file.file}, from \`${file.from}\` (from the package)`,
        text: normalised(text),
      });
    }
    if (sections.length === 0) {
      problems.push(`NOT004 ${key}: its reviewed entry in ${WEB_INPUTS} supplies no text.`);
      continue;
    }
    const licence = manifest.license || '(none declared)';
    bundlerLines.push(`  ${name} ${manifest.version} — ${licence}: ${reviewed.what}`);
    bundlerEntries.push(
      entry({
        name,
        version: manifest.version,
        licence,
        part: 'bundler',
        sections: [{ heading: 'What the build carries', text: reviewed.what }, ...sections],
      }),
    );
  }
  for (const key of Object.keys(written).sort(byCodePoint)) {
    if (!wanted.has(key)) {
      problems.push(
        `NOT004 ${key} has a \`writtenByTheBundler\` entry in ${WEB_INPUTS} and is not a ` +
          'bundler this build is made with at that version — delete the entry.',
      );
    }
  }

  const names = new Set(union.map((dependency) => dependency.name));
  const copied = [];
  for (const file of web.copiedIntoBuild ?? []) {
    const source = union.find((dependency) => dependency.name === file.package);
    if (source === undefined) {
      problems.push(
        `NOT005 ${file.path} is copied out of ${file.package}, which is not in the closure.`,
      );
      continue;
    }
    if (!existsSync(join(source.directory, file.file))) {
      problems.push(
        `NOT005 ${file.path} is copied out of ${source.name}@${source.version}/${file.file}, ` +
          'which the installed package does not have.',
      );
      continue;
    }
    copied.push(`  ${file.path} — from ${source.name} ${source.version} (${file.by})`);
  }

  const nativeEntries = [];
  const nativeLibraries = [...(native.libraries ?? [])].sort((left, right) =>
    byCodePoint(left.coordinate, right.coordinate),
  );
  for (const library of nativeLibraries) {
    if (licenceText(root, library.licence) === undefined) {
      problems.push(
        `NOT005 ${library.coordinate} is ${library.licence}, whose text this generator does not ` +
          `hold. Add it to LICENCE_TEXTS with a pinned copy.`,
      );
      continue;
    }
    appendices.add(library.licence);
    const cut = library.coordinate.lastIndexOf(':');
    const sections = [
      {
        heading: library.licence,
        text:
          `The full text of ${library.licence} is reproduced once, at the end of this ` +
          `document. Its own POM declares: ${library.pom}.`,
      },
    ];
    if (library.notice !== undefined) {
      sections.push({
        heading: `NOTICE, from ${library.notice.source}, read ${library.notice.read}`,
        text: normalised(library.notice.text),
      });
    }
    nativeEntries.push(
      entry({
        name: library.coordinate.slice(0, cut),
        version: library.coordinate.slice(cut + 1),
        licence: library.licence,
        part: 'android',
        sections,
      }),
    );
  }
  const projects = [];
  for (const project of [...(native.projects ?? [])].sort((left, right) =>
    byCodePoint(left.project, right.project),
  )) {
    if (project.package !== null && !names.has(project.package)) {
      problems.push(
        `NOT005 the Android project ${project.project} is said to be ${project.package}, which ` +
          'is not in the closure, so nothing in this document notices it.',
      );
      continue;
    }
    projects.push(
      project.package === null
        ? `  ${project.project} — ${project.why}`
        : `  ${project.project} — built from ${project.package}, noticed in part 1`,
    );
  }

  if (problems.length > 0) return { problems };

  const appendixText = [...appendices]
    .sort(byCodePoint)
    .map((licence) =>
      [
        SEPARATOR,
        `Appendix: ${licence}`,
        `(${LICENCE_TEXTS[licence]} in this app's source repository)`,
        '',
        licenceText(root, licence),
        '',
      ].join('\n'),
    );

  const contents = [
    'THIRD-PARTY SOFTWARE IN ON YOUR LEFT',
    '',
    'This app includes software written by other people, each part under its own',
    "licence. This document reproduces every one of those licences' notices, as",
    'the packages themselves ship them.',
    '',
    'Part 1 is everything in the app itself: the web build a browser downloads,',
    'which the Android app carries too. Part 2 is the native libraries only the',
    'Android app contains. Part 3 names the files the build copies whole out of a',
    'package in part 1. Part 4 is code the build tools write into the app, which',
    'no package in part 1 accounts for.',
    '',
    'Generated from the installed dependency tree by',
    'scripts/check-third-party-notices.mjs. Do not edit it by hand.',
    '',
    `Part 1 — in the app (${String(union.length)} packages)`,
    ...union.map(
      (dependency) =>
        `  ${dependency.name} ${dependency.version} — ${dependency.licence || '(none declared)'}`,
    ),
    '',
    `Part 2 — in the Android app only (${String(nativeLibraries.length)} libraries)`,
    ...nativeLibraries.map((library) => `  ${library.coordinate} — ${library.licence}`),
    ...(projects.length > 0 ? ['', '  Built into the Android app from source:', ...projects] : []),
    '',
    'Part 3 — files copied out of a package into the build',
    ...(copied.length > 0 ? copied : ['  (none)']),
    '',
    'Part 4 — code the build tools write into the app',
    ...(bundlerLines.length > 0 ? bundlerLines : ['  (none)']),
  ].join('\n');
  const document = [
    contents,
    '',
    ...entries,
    ...bundlerEntries,
    ...nativeEntries,
    ...appendixText,
  ].join('\n');

  return {
    problems,
    document,
    contents,
    packages: union.length,
    bundled: bundlerEntries.length,
    libraries: nativeLibraries.length,
  };
}

/** The `Name`/`Version` pairs a document declares, for a drift message a person can act on. */
function declared(document) {
  const found = new Set();
  const lines = document.split('\n');
  lines.forEach((line, index) => {
    if (line !== SEPARATOR) return;
    const name = /^Name: (.+)$/.exec(lines[index + 1] ?? '');
    const version = /^Version: (.+)$/.exec(lines[index + 2] ?? '');
    if (name !== null && version !== null) found.add(`${name[1]}@${version[1]}`);
  });
  return found;
}

/**
 * Install, render and compare — or install, render and write.
 *
 * Returns `{ problems, summary }`.
 */
export function thirdPartyNotices({ root, write = false, assumeInstalled = false }) {
  if (!assumeInstalled) {
    const install = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (install.error !== undefined || install.status !== 0) {
      const said = `${install.stdout ?? ''}${install.stderr ?? ''}`.trim().split('\n');
      const detail =
        install.error?.message ??
        said.find((line) => /ERR_[A-Z0-9_]+/.test(line)) ??
        said.slice(-2).join(' / ');
      return {
        problems: [
          'NOT001 pnpm install --frozen-lockfile — the installed tree could not be verified ' +
            `against the lockfile, so no notice was read from it: ${detail}`,
        ],
      };
    }
  }

  const rendered = renderNotices(root);
  if (rendered.problems.length > 0) return { problems: rendered.problems };

  const summary =
    `${String(rendered.packages)} packages, ${String(rendered.bundled)} build tools ` +
    `and ${String(rendered.libraries)} native libraries`;
  const outputs = [
    { file: DOCUMENT, text: `${rendered.document}\n` },
    { file: CONTENTS, text: `${rendered.contents}\n` },
  ];
  if (write) {
    for (const output of outputs) writeFileSync(join(root, output.file), output.text);
    return { problems: [], summary: `wrote ${DOCUMENT} and ${CONTENTS}: ${summary}` };
  }

  const problems = [];
  for (const output of outputs) {
    const path = join(root, output.file);
    if (!existsSync(path)) {
      problems.push(`NOT007 ${output.file} is not there. Write it with \`${REPAIR}\`.`);
      continue;
    }
    const committed = readFileSync(path, 'utf8');
    if (committed === output.text) continue;
    problems.push(drift(output.file, committed, output.text));
  }
  if (problems.length > 0) return { problems };
  return { problems: [], summary: `both files are what the generator writes: ${summary}` };
}

/** A NOT006 message that says which packages moved, then where the text did. */
function drift(file, committed, generated) {
  const before = declared(committed);
  const after = declared(generated);
  const added = [...after].filter((key) => !before.has(key));
  const removed = [...before].filter((key) => !after.has(key));
  const lines = differingLines(committed, generated)
    .map((difference) =>
      difference.truncated
        ? '      …'
        : `      line ${String(difference.line)}: committed ` +
          `${JSON.stringify(difference.committed ?? null)}, generated ` +
          `${JSON.stringify(difference.generated ?? null)}`,
    )
    .join('\n');
  return (
    `NOT006 ${file} is not what the generator writes from the installed tree.` +
    (added.length > 0 ? `\n    not noticed yet: ${added.join(', ')}` : '') +
    (removed.length > 0 ? `\n    noticed and no longer shipped: ${removed.join(', ')}` : '') +
    `\n${lines}\n    Regenerate with \`${REPAIR}\` and read the diff before committing it.`
  );
}

// ----------------------------------------------------------------------- main

// Compared through `realpathSync`, for the `/var` → `/private/var` reason
// check-capacitor-generated.mjs records.
const invoked = process.argv[1];
if (invoked !== undefined && import.meta.filename === realpathSync(invoked)) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--root');
  const root = resolve(at === -1 ? process.cwd() : argv[at + 1]);
  const write = argv.includes('--write');
  // ⚠️ The fixture suite is the only caller that passes this, because a
  // throwaway tree has no lockfile. In CI it would reintroduce #298.
  const assumeInstalled = argv.includes('--assume-installed');

  let result;
  try {
    result = thirdPartyNotices({ root, write, assumeInstalled });
  } catch (error) {
    console.error(`check-third-party-notices: ${error.message}`);
    process.exit(1);
  }
  if (result.problems.length > 0) {
    console.error(
      `check-third-party-notices: the app's third-party notices ${write ? 'could not be written' : 'are not what the installed tree says'}.\n`,
    );
    for (const problem of result.problems) console.error(`  - ${problem}`);
    console.error(
      `\nSee CLAUDE.md §4g and scripts/check-third-party-notices.mjs. Root: ${relative(process.cwd(), root) || '.'}`,
    );
    process.exit(1);
  }
  console.log(`check-third-party-notices: ${result.summary}.`);
}
