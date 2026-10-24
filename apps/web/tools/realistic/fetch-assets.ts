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
 * and the network: about 150 MB, most of it the tree scans' geometry — and
 * since #623 MakeHuman's CC0 system assets archive, 281 MB, of which six files
 * are taken (`zip-member.ts`) after each one's own row on the pack's page is
 * read as CC0 by MakeHuman's own author (`sources.ts` §`systemAssetVerdict`).
 * Since #1274 an ambientCG asset is fetched the same way: its one archive,
 * about 7 MB at 1K, after its own page is held to `sources.ts`
 * §`ambientCgVerdict`.
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
  admission,
  archiveOf,
  licenceVerdict,
  lockFault,
  polyHavenAuthors,
  polyHavenFiles,
  safeRelativePath,
  SOURCES,
  systemAssetVerdict,
  type AssetSource,
  type InputLock,
  type LockedFile,
  type LockedSource,
  type ResolvedFile,
} from './sources';
import { zipMember } from './zip-member';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Where the downloads go. Ignored; see the header. */
export const RAW = join(HERE, 'build', 'raw');
/** The committed record of what the inputs are. */
export const LOCK = join(HERE, 'inputs.lock.json');

/**
 * How a request is made: `fetch`, or a fake under test — #1278. Asked with
 * `redirect: 'manual'`, so a redirect comes back as itself and its target is
 * asked of {@link admission} before it is requested.
 */
export type Fetch = (url: string, init: { readonly redirect: 'manual' }) => Promise<Response>;

/** What {@link readSource} reads with and writes to, so a test can hand it a fake. */
export interface FetchRun {
  readonly fetch: Fetch;
  /** Where the downloads go: {@link RAW}, or a directory a test made. */
  readonly raw: string;
  /** `--lock`: rewrite the lock from what was read, rather than hold the reads to it. */
  readonly relock: boolean;
  /** The date a re-locked source records as `read`, `YYYY-MM-DD`. */
  readonly today: string;
  readonly log: (line: string) => void;
}

/** More than this many redirects for one request is refused. */
export const MAXIMUM_REDIRECTS = 5;

/** Every request this script makes is for an address the list admits (ADR 0049 D-11). */
function admitted(url: string, as: 'licence' | 'file'): void {
  const verdict = admission(url, as);
  if (!verdict.admitted) throw new Error(verdict.reason);
}

/**
 * The answer at `url`, after asking {@link admission} of it — and, since
 * #1278, of every address a redirect sends the request on to, before that one
 * is requested. Measured on 2026-10-20: ambientCG's `get?file=` answers 302 to
 * its own download host, which its row admits; `dl.polyhaven.org`,
 * `api.polyhaven.com`, MakeHuman's hosts and the licence pages answer without
 * one.
 */
async function get(run: FetchRun, url: string, as: 'licence' | 'file'): Promise<Response> {
  let address = url;
  for (let hops = 0; ; hops += 1) {
    admitted(address, as);
    const response = await run.fetch(address, { redirect: 'manual' });
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location !== null) {
      if (hops === MAXIMUM_REDIRECTS) {
        throw new Error(`${url}: more than ${String(MAXIMUM_REDIRECTS)} redirects`);
      }
      address = new URL(location, address).href;
      continue;
    }
    if (!response.ok) throw new Error(`${address}: HTTP ${String(response.status)}`);
    return response;
  }
}

async function text(run: FetchRun, url: string, as: 'licence' | 'file' = 'file'): Promise<string> {
  return (await get(run, url, as)).text();
}

async function bytes(run: FetchRun, url: string): Promise<Buffer> {
  return Buffer.from(await (await get(run, url, 'file')).arrayBuffer());
}

async function resolve(run: FetchRun, source: AssetSource): Promise<readonly ResolvedFile[]> {
  if (source.origin.from === 'urls') return source.origin.files;
  if (source.origin.from !== 'polyhaven') {
    throw new Error(`${source.id}: an archive is not resolved`);
  }
  const answer = JSON.parse(
    await text(run, `https://api.polyhaven.com/files/${source.id}`),
  ) as Record<string, unknown>;
  return polyHavenFiles(source.id, source.origin.select, answer);
}

async function authorsOf(run: FetchRun, source: AssetSource): Promise<string> {
  if (source.origin.from !== 'polyhaven') {
    if (source.author === undefined) throw new Error(`${source.id}: no author recorded`);
    return source.author;
  }
  const info = JSON.parse(await text(run, `https://api.polyhaven.com/info/${source.id}`)) as Record<
    string,
    unknown
  >;
  return polyHavenAuthors(source.id, info);
}

/** Whether two lists of locked files are the same files with the same bytes. */
export function sameFiles(
  was: readonly { readonly path: string; readonly sha256: string }[],
  now: readonly { readonly path: string; readonly sha256: string }[],
): boolean {
  const key = (files: typeof was): string =>
    files
      .map((file) => `${file.path} ${file.sha256}`)
      .sort()
      .join('\n');
  return was.length === now.length && key(was) === key(now);
}

const md5 = (data: Buffer): string => createHash('md5').update(data).digest('hex');
const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

/**
 * A placed archive's files, as the lock records them — #1585: the archive
 * under `run.raw/<id>/`, which must be there (nothing here downloads it) and,
 * unless `run.relock`, be the archive the lock records; then each member taken
 * out of it, held to the lock and to any phrase it must carry.
 */
export function placedFiles(
  id: string,
  origin: Extract<AssetSource['origin'], { readonly from: 'placed' }>,
  expected: LockedSource | undefined,
  run: Pick<FetchRun, 'raw' | 'relock' | 'log'>,
): LockedFile[] {
  const { relock } = run;
  if (!safeRelativePath(origin.archive)) throw new Error(`${id}: refused path ${origin.archive}`);
  const target = join(run.raw, id, origin.archive);
  if (!existsSync(target)) {
    throw new Error(
      `${id}: ${target} is not there. It is the owner's own download of ${origin.page} (an account is needed, so this script never fetches it); place it there and run again`,
    );
  }
  const archive = readFileSync(target);
  const archiveDigest = sha256(archive);
  if (!relock) {
    const fault = lockFault(id, origin.archive, archiveDigest, expected);
    if (fault !== undefined) throw new Error(fault);
  }
  const files: LockedFile[] = [
    { path: origin.archive, url: origin.page, bytes: archive.length, sha256: archiveDigest },
  ];
  for (const member of origin.members) {
    if (!safeRelativePath(member.path)) throw new Error(`${id}: refused path ${member.path}`);
    const body = Buffer.from(zipMember(archive, member.path));
    if (member.mustContain !== undefined && !body.toString('utf8').includes(member.mustContain)) {
      throw new Error(`${id}/${member.path}: it does not state "${member.mustContain}"`);
    }
    const digest = sha256(body);
    if (!relock) {
      const fault = lockFault(id, member.path, digest, expected);
      if (fault !== undefined) throw new Error(fault);
    }
    const memberTarget = join(run.raw, id, member.path);
    mkdirSync(dirname(memberTarget), { recursive: true });
    writeFileSync(memberTarget, body);
    files.push({
      path: member.path,
      url: `${origin.page}#${member.path}`,
      bytes: body.length,
      sha256: digest,
    });
    run.log(`${id}/${member.path} ${String(body.length)} bytes`);
  }
  return files;
}

/**
 * One source, read: its licence page held to {@link licenceVerdict}, its files
 * downloaded into `run.raw` and, unless `run.relock`, each held to `expected`,
 * the lock's entry for it. Returns what the lock records for it.
 *
 * `main()`'s loop body until #1278, which made it take its fetch and its lock
 * so that every guard runs under test where it is called, not only as a pure
 * function in `sources.ts` (`fetch-assets.test.ts`).
 */
export async function readSource(
  source: AssetSource,
  expected: LockedSource | undefined,
  run: FetchRun,
): Promise<LockedSource> {
  const { relock } = run;
  const page = await text(run, source.licencePage, 'licence');
  const verdict = licenceVerdict(source, page);
  if (!verdict.kept) throw new Error(verdict.reason);
  // #1278: how the page says the asset was made is part of what the lock
  // pins, so a page that now says something else stops the run even where
  // every byte is the same.
  if (!relock && expected !== undefined && expected.technique !== verdict.technique) {
    throw new Error(
      `${source.id}: its page now says it was made by "${verdict.technique ?? 'nothing'}", not "${expected.technique ?? 'nothing'}" as the lock records; run with --lock only if re-basing on new inputs is intended`,
    );
  }
  const files = [];
  const origin = source.origin;
  // #1585: an archive the owner downloaded with their own account and placed
  // by hand. Nothing is fetched for it; it is held to the lock's digest, and
  // only its members are taken out.
  if (origin.from === 'placed') {
    files.push(...placedFiles(source.id, origin, expected, run));
  }
  // An archive downloaded whole and pinned by its digest: MakeHuman's pack
  // (#623), or an ambientCG asset (#1274), whose own page `licenceVerdict`
  // has just held to `sources.ts` §`ambientCgVerdict`.
  const archived = archiveOf(source);
  if (archived !== undefined) {
    if (origin.from === 'archive') {
      // #623: every member's OWN entry on the pack's page must read CC0 by
      // MakeHuman's own author before a byte of the archive is written.
      for (const member of origin.members) {
        const own = systemAssetVerdict(page, member.asset);
        if (!own.kept) throw new Error(`${source.id}/${member.path}: ${own.reason}`);
      }
    }
    for (const member of archived.members) {
      if (!safeRelativePath(member.path))
        throw new Error(`${source.id}: refused path ${member.path}`);
    }
    const name = archived.name;
    if (!safeRelativePath(name)) throw new Error(`${source.id}: refused path ${name}`);
    const target = join(run.raw, source.id, name);
    const was = expected?.files.find((each) => each.path === name);
    const archive =
      existsSync(target) && was !== undefined && sha256(readFileSync(target)) === was.sha256
        ? readFileSync(target)
        : await bytes(run, archived.url);
    const archiveDigest = sha256(archive);
    if (!relock) {
      const fault = lockFault(source.id, name, archiveDigest, expected);
      if (fault !== undefined) throw new Error(fault);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, archive);
    files.push({ path: name, url: archived.url, bytes: archive.length, sha256: archiveDigest });
    for (const member of archived.members) {
      const body = Buffer.from(zipMember(archive, member.path));
      if (member.mustContain !== undefined && !body.toString('utf8').includes(member.mustContain)) {
        throw new Error(
          `${source.id}/${member.path}: its header does not state "${member.mustContain}"`,
        );
      }
      const memberTarget = join(run.raw, source.id, member.path);
      mkdirSync(dirname(memberTarget), { recursive: true });
      writeFileSync(memberTarget, body);
      const digest = sha256(body);
      if (!relock) {
        const fault = lockFault(source.id, member.path, digest, expected);
        if (fault !== undefined) throw new Error(fault);
      }
      files.push({
        path: member.path,
        url: `${archived.url}#${member.path}`,
        bytes: body.length,
        sha256: digest,
      });
      run.log(`${source.id}/${member.path} ${String(body.length)} bytes`);
    }
  }
  for (const file of archived !== undefined || origin.from === 'placed'
    ? []
    : await resolve(run, source)) {
    if (!safeRelativePath(file.path)) throw new Error(`${source.id}: refused path ${file.path}`);
    const target = join(run.raw, source.id, file.path);
    let body: Buffer;
    if (existsSync(target) && file.md5 !== undefined && md5(readFileSync(target)) === file.md5) {
      body = readFileSync(target);
    } else {
      body = await bytes(run, file.url);
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
      const fault = lockFault(source.id, file.path, digest, expected);
      if (fault !== undefined) throw new Error(fault);
    }
    files.push({ path: file.path, url: file.url, bytes: body.length, sha256: digest });
    run.log(`${source.id}/${file.path} ${String(body.length)} bytes`);
  }
  if (!relock && expected !== undefined && expected.files.length !== files.length) {
    throw new Error(`${source.id}: the source now lists a different set of files than the lock`);
  }
  return {
    id: source.id,
    licence: verdict.licence,
    licencePage: source.licencePage,
    evidence: verdict.evidence,
    // ⚠️ **Re-locking re-dates only what moved** (#475). A source whose
    // files are exactly the ones the lock already records keeps the date its
    // licence was read; before, adding one source re-dated every other and
    // moved the `read` of every committed asset's record with it.
    read:
      relock && (expected === undefined || !sameFiles(expected.files, files))
        ? run.today
        : (expected?.read ?? run.today),
    authors: await authorsOf(run, source),
    // #1274: how the asset's own page said it was made, read with its licence.
    ...(verdict.technique === undefined ? {} : { technique: verdict.technique }),
    files,
  };
}

async function main(): Promise<void> {
  const relock = process.argv.includes('--lock');
  const locked: InputLock | undefined = existsSync(LOCK)
    ? (JSON.parse(readFileSync(LOCK, 'utf8')) as InputLock)
    : undefined;
  if (!relock && locked === undefined) {
    throw new Error(`${LOCK} does not exist; run with --lock to write it`);
  }
  const run: FetchRun = {
    fetch: (url, init) => fetch(url, init),
    raw: RAW,
    relock,
    today: new Date().toISOString().slice(0, 10),
    log: (line) => {
      console.log(line);
    },
  };
  const sources: LockedSource[] = [];
  for (const source of SOURCES) {
    const expected = locked?.sources.find((each) => each.id === source.id);
    sources.push(await readSource(source, expected, run));
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
