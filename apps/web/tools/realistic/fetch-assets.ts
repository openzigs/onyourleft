// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Download the realistic world's upstream inputs into `build/raw/` — #430.
 *
 * ```bash
 * node apps/web/tools/realistic/fetch-assets.ts          # verify against the lock
 * node apps/web/tools/realistic/fetch-assets.ts --lock   # re-read and rewrite the lock
 * ```
 *
 * Needs Node 24 (it runs this `.ts` file directly, as `icons:generate` does)
 * and the network: about 150 MB, most of it the tree scans' geometry.
 * `build/` is ignored by the root `.gitignore` and pruned by
 * `check-repo-rules.sh`, so nothing downloaded can be staged without forcing
 * past an ignore rule, which CLAUDE.md §7 forbids.
 *
 * For every source in `sources.ts` §`SOURCES`: read its licence page and
 * refuse it unless `licenceVerdict` keeps it; resolve its files; download each,
 * checking Poly Haven's published MD5 and any header the file must carry.
 *
 * - **Without `--lock`** every file must match `inputs.lock.json`'s SHA-256. A
 *   re-run on another machine, or a year later, either reproduces the inputs
 *   the committed assets were made from or stops and says which file moved.
 * - **With `--lock`** the lock is rewritten from what was just read, dated
 *   today. That is a decision to re-base the realistic world on new inputs,
 *   and every derived asset's `inputsha256` in `ASSETS.toml` then has to move
 *   with it — `provenance.test.ts` fails until it does.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  licenceVerdict,
  polyHavenAuthors,
  polyHavenFiles,
  safeRelativePath,
  SOURCES,
  type AssetSource,
  type InputLock,
  type LockedSource,
  type ResolvedFile,
} from './sources';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Where the downloads go. Ignored; see the header. */
export const RAW = join(HERE, 'build', 'raw');
/** The committed record of what the inputs are. */
export const LOCK = join(HERE, 'inputs.lock.json');

async function text(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  return response.text();
}

async function bytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${String(response.status)}`);
  return Buffer.from(await response.arrayBuffer());
}

async function resolve(source: AssetSource): Promise<readonly ResolvedFile[]> {
  if (source.origin.from === 'urls') return source.origin.files;
  const answer = JSON.parse(await text(`https://api.polyhaven.com/files/${source.id}`)) as Record<
    string,
    unknown
  >;
  return polyHavenFiles(source.id, source.origin.select, answer);
}

async function authorsOf(source: AssetSource): Promise<string> {
  if (source.origin.from === 'urls') {
    if (source.author === undefined) throw new Error(`${source.id}: no author recorded`);
    return source.author;
  }
  const info = JSON.parse(await text(`https://api.polyhaven.com/info/${source.id}`)) as Record<
    string,
    unknown
  >;
  return polyHavenAuthors(source.id, info);
}

const md5 = (data: Buffer): string => createHash('md5').update(data).digest('hex');
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

async function main(): Promise<void> {
  const relock = process.argv.includes('--lock');
  const locked: InputLock | undefined = existsSync(LOCK)
    ? (JSON.parse(readFileSync(LOCK, 'utf8')) as InputLock)
    : undefined;
  if (!relock && locked === undefined) {
    throw new Error(`${LOCK} does not exist; run with --lock to write it`);
  }
  const read = new Date().toISOString().slice(0, 10);
  const sources: LockedSource[] = [];
  for (const source of SOURCES) {
    const verdict = licenceVerdict(source, await text(source.licencePage));
    if (!verdict.kept) throw new Error(verdict.reason);
    const expected = locked?.sources.find((each) => each.id === source.id);
    const files = [];
    for (const file of await resolve(source)) {
      if (!safeRelativePath(file.path)) throw new Error(`${source.id}: refused path ${file.path}`);
      const target = join(RAW, source.id, file.path);
      let body: Buffer;
      if (existsSync(target) && file.md5 !== undefined && md5(readFileSync(target)) === file.md5) {
        body = readFileSync(target);
      } else {
        body = await bytes(file.url);
        if (file.md5 !== undefined && md5(body) !== file.md5) {
          throw new Error(`${source.id}/${file.path}: MD5 does not match the one published`);
        }
        if (file.mustContain !== undefined && !body.toString('utf8').includes(file.mustContain)) {
          throw new Error(
            `${source.id}/${file.path}: its header does not state "${file.mustContain}"`,
          );
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, body);
      }
      const digest = sha256(body);
      if (!relock) {
        const was = expected?.files.find((each) => each.path === file.path);
        if (was === undefined || was.sha256 !== digest) {
          throw new Error(
            `${source.id}/${file.path}: not the input the lock records (${was?.sha256 ?? 'absent'}, got ${digest}); run with --lock only if re-basing on new inputs is intended`,
          );
        }
      }
      files.push({ path: file.path, url: file.url, bytes: body.length, sha256: digest });
      console.log(`${source.id}/${file.path} ${String(body.length)} bytes`);
    }
    if (!relock && expected !== undefined && expected.files.length !== files.length) {
      throw new Error(`${source.id}: the source now lists a different set of files than the lock`);
    }
    sources.push({
      id: source.id,
      licence: verdict.licence,
      licencePage: source.licencePage,
      evidence: verdict.evidence,
      read: relock ? read : (expected?.read ?? read),
      authors: await authorsOf(source),
      files,
    });
  }
  if (relock) {
    writeFileSync(LOCK, `${JSON.stringify({ sources }, null, 2)}\n`);
    console.log(`wrote ${LOCK}`);
  } else {
    console.log('every input matches the lock');
  }
}

if (process.argv[1]?.endsWith('fetch-assets.ts') === true) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
