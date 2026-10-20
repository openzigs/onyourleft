// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `realistic:fetch`'s guards where they are called — #1278.
 *
 * `sources.ts` tests each guard as a pure function: the admitted-source check,
 * the licence verdict, the digest lock, the path check. Until this file nothing
 * tested that `fetch-assets.ts` calls them, and the reviews of #1276 and #1277
 * removed each call in turn with the whole suite green. Here `readSource`, the
 * script's loop body, runs against a fake web and a directory of its own, and
 * every assertion is on what it requested, what it threw, or what it wrote.
 *
 * ⚠️ What it cannot cover: whether the real sites still answer the way the
 * fakes do. That is the hand run against the live sites, which `--lock` is.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MAXIMUM_REDIRECTS, readSource, type Fetch, type FetchRun } from './fetch-assets';
import { AMBIENTCG_PHRASE, type AssetSource, type LockedSource } from './sources';

const sha256 = (data: Uint8Array | string): string =>
  createHash('sha256').update(data).digest('hex');
const md5 = (data: Uint8Array | string): string => createHash('md5').update(data).digest('hex');

/** A ZIP of `files`, each stored, written to the format's own layout. */
function zipOf(files: Readonly<Record<string, string>>): Uint8Array {
  const parts: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const [fileName, text] of Object.entries(files)) {
    const name = new TextEncoder().encode(fileName);
    const body = new TextEncoder().encode(text);
    const crc = crc32(body);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, body.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const ev = new DataView(entry.buffer);
    ev.setUint32(0, 0x02014b50, true);
    ev.setUint32(16, crc, true);
    ev.setUint32(20, body.length, true);
    ev.setUint32(24, body.length, true);
    ev.setUint16(28, name.length, true);
    ev.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local, body);
    directory.push(entry);
    offset += local.length + body.length;
  }
  const size = directory.reduce((sum, each) => sum + each.length, 0);
  const end = new Uint8Array(22);
  const dv = new DataView(end.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, directory.length, true);
  dv.setUint16(10, directory.length, true);
  dv.setUint32(12, size, true);
  dv.setUint32(16, offset, true);
  return Buffer.concat([...parts, ...directory, end]);
}

/** What the fake web answers at an address: a body, or a redirect. */
type Answer = string | Uint8Array | { readonly status: number; readonly location: string };

/** A fake `fetch` over `web`, recording every address requested; anything else is a 404. */
function fakeWeb(web: Readonly<Record<string, Answer>>): {
  readonly fetch: Fetch;
  readonly requested: string[];
} {
  const requested: string[] = [];
  const fetch: Fetch = (url, init) => {
    expect(init.redirect).toBe('manual');
    requested.push(url);
    const answer = web[url];
    if (answer === undefined) return Promise.resolve(new Response('not here', { status: 404 }));
    if (typeof answer === 'string' || answer instanceof Uint8Array) {
      return Promise.resolve(
        new Response(typeof answer === 'string' ? answer : new Uint8Array(answer)),
      );
    }
    return Promise.resolve(
      new Response(null, { status: answer.status, headers: { location: answer.location } }),
    );
  };
  return { fetch, requested };
}

let raw: string;
beforeEach(() => {
  raw = mkdtempSync(join(tmpdir(), 'oyl-fetch-assets-'));
});
afterEach(() => {
  rmSync(raw, { recursive: true, force: true });
});

const runWith = (fetch: Fetch, relock: boolean): FetchRun => ({
  fetch,
  raw,
  relock,
  today: '2026-10-20',
  log: () => undefined,
});

/** Everything written under the run's directory, relative to it. */
const written = (): readonly string[] =>
  readdirSync(raw, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(raw.length + 1))
    .sort();

describe('an ambientCG asset: an archive through a redirect, its member, its technique', () => {
  const rock: AssetSource = {
    id: 'Rock999',
    licencePage: 'https://ambientcg.com/view?id=Rock999',
    licencePhrase: AMBIENTCG_PHRASE,
    licence: 'CC0-1.0',
    author: 'ambientCG',
    origin: { from: 'ambientcg', attribute: '1K-JPG', maps: ['Color'] },
  };
  const archiveUrl = 'https://ambientcg.com/get?file=Rock999_1K-JPG.zip';
  const downloadUrl =
    'https://acg-download.struffelproductions.com/file/ambientCG-Web/download/Rock999_x/Rock999_1K-JPG.zip';
  const colour = 'the colour map';
  const archive = zipOf({ 'Rock999_1K-JPG_Color.jpg': colour });
  const page = (techniques: readonly string[] = ['Surface Photogrammetry']): string => `
<a class="asset-download" href="${archiveUrl}">download</a>
<div id="techniques"><div class="detail-value">${techniques.map((each) => `<span>${each}</span>`).join('')}</div></div>
<div id="dimensions"><span>ca. 240 cm</span></div>
<p>Yes. ${AMBIENTCG_PHRASE}, making them free to use.</p>`;
  const web = (techniques?: readonly string[]): Record<string, Answer> => ({
    [rock.licencePage]: page(techniques),
    // As measured on 2026-10-20: `get?file=` answers 302 to ambientCG's download host.
    [archiveUrl]: { status: 302, location: downloadUrl },
    [downloadUrl]: archive,
  });
  /** The lock as #1274 wrote it before any technique was recorded. */
  const unrecorded: LockedSource = {
    id: 'Rock999',
    licence: 'CC0-1.0',
    licencePage: rock.licencePage,
    evidence: AMBIENTCG_PHRASE,
    read: '2026-10-12',
    authors: 'ambientCG',
    files: [
      {
        path: 'Rock999_1K-JPG.zip',
        url: archiveUrl,
        bytes: archive.length,
        sha256: sha256(archive),
      },
      {
        path: 'Rock999_1K-JPG_Color.jpg',
        url: `${archiveUrl}#Rock999_1K-JPG_Color.jpg`,
        bytes: colour.length,
        sha256: sha256(colour),
      },
    ],
  };
  const lock: LockedSource = { ...unrecorded, technique: 'Surface Photogrammetry' };

  it('writes the technique its page states into the lock, and the member to disk (--lock)', async () => {
    const { fetch, requested } = fakeWeb(web());
    const read = await readSource(rock, undefined, runWith(fetch, true));
    expect(read).toEqual({ ...lock, read: '2026-10-20' });
    expect(requested).toEqual([rock.licencePage, archiveUrl, downloadUrl]);
    expect(readFileSync(join(raw, 'Rock999', 'Rock999_1K-JPG_Color.jpg'), 'utf8')).toBe(colour);
  });

  it('passes a run whose archive, member and technique are the ones the lock records', async () => {
    const { fetch } = fakeWeb(web());
    await expect(readSource(rock, lock, runWith(fetch, false))).resolves.toEqual(lock);
  });

  it('stops a run whose page now names another technique than the lock, bytes unchanged', async () => {
    const { fetch } = fakeWeb(web(['Surface Photogrammetry', 'Photometric Stereo']));
    await expect(readSource(rock, lock, runWith(fetch, false))).rejects.toThrow(
      'Rock999: its page now says it was made by "Surface Photogrammetry, Photometric Stereo", not "Surface Photogrammetry"',
    );
    // A lock written before #1274 recorded no technique: that is a difference too.
    await expect(
      readSource(rock, unrecorded, runWith(fakeWeb(web()).fetch, false)),
    ).rejects.toThrow('not "nothing" as the lock records');
    // With --lock the new technique is the decision being made, and is recorded.
    const relocked = await readSource(
      rock,
      lock,
      runWith(fakeWeb(web(['Surface Photogrammetry', 'Photometric Stereo'])).fetch, true),
    );
    expect(relocked.technique).toBe('Surface Photogrammetry, Photometric Stereo');
  });

  it('stops a run whose archive is not the one the lock records', async () => {
    const moved = {
      ...lock,
      files: lock.files.map((file) =>
        file.path.endsWith('.zip') ? { ...file, sha256: sha256('another archive') } : file,
      ),
    };
    const { fetch } = fakeWeb(web());
    await expect(readSource(rock, moved, runWith(fetch, false))).rejects.toThrow(
      `Rock999/Rock999_1K-JPG.zip: not the input the lock records (${sha256('another archive')}, got ${sha256(archive)})`,
    );
  });

  it('stops a run whose member is not the one the lock records, the archive unchanged', async () => {
    const moved = {
      ...lock,
      files: lock.files.map((file) =>
        file.path.endsWith('.jpg') ? { ...file, sha256: sha256('another map') } : file,
      ),
    };
    const { fetch } = fakeWeb(web());
    await expect(readSource(rock, moved, runWith(fetch, false))).rejects.toThrow(
      `Rock999/Rock999_1K-JPG_Color.jpg: not the input the lock records (${sha256('another map')}, got ${sha256(colour)})`,
    );
  });

  it('refuses a member whose path leaves its directory, before the archive is requested', async () => {
    const climbing: AssetSource = {
      ...rock,
      origin: { from: 'ambientcg', attribute: '1K-JPG', maps: ['/../../escape'] },
    };
    const { fetch, requested } = fakeWeb(web());
    await expect(readSource(climbing, undefined, runWith(fetch, true))).rejects.toThrow(
      'Rock999: refused path Rock999_1K-JPG_/../../escape.jpg',
    );
    expect(requested).toEqual([rock.licencePage]);
    expect(written()).toEqual([]);
  });

  it('refuses a redirect to an address no admitted source owns, before requesting it', async () => {
    const elsewhere = 'https://cdn.example.net/Rock999_1K-JPG.zip';
    const { fetch, requested } = fakeWeb({
      ...web(),
      [archiveUrl]: { status: 302, location: elsewhere },
      [elsewhere]: archive,
    });
    await expect(readSource(rock, undefined, runWith(fetch, true))).rejects.toThrow(
      `${elsewhere} is not from a source ADR 0049 D-10 admits`,
    );
    expect(requested).not.toContain(elsewhere);
    expect(written()).toEqual([]);
  });
});

describe('a Poly Haven asset: its licence page, the files its API names, their MD5', () => {
  const sky: AssetSource = {
    id: 'test_sky',
    licencePage: 'https://polyhaven.com/a/test_sky',
    licencePhrase: 'This asset is CC0',
    licence: 'CC0-1.0',
    origin: { from: 'polyhaven', select: { type: 'hdri', resolution: '1k' } },
  };
  const hdr = 'radiance';
  const fileUrl = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/test_sky_1k.hdr';
  const files = (url: string): string =>
    JSON.stringify({ hdri: { '1k': { hdr: { url, md5: md5(hdr), size: hdr.length } } } });
  const web = (url = fileUrl): Record<string, Answer> => ({
    [sky.licencePage]: '<p>This asset is CC0, by its authors.</p>',
    'https://api.polyhaven.com/files/test_sky': files(url),
    'https://api.polyhaven.com/info/test_sky': JSON.stringify({ authors: { Someone: 'All' } }),
    [url]: hdr,
  });

  it('reads the file the API names, held to its MD5, with its authors (--lock)', async () => {
    const { fetch, requested } = fakeWeb(web());
    const read = await readSource(sky, undefined, runWith(fetch, true));
    expect(read).toMatchObject({
      id: 'test_sky',
      authors: 'Someone (All)',
      files: [{ path: 'test_sky_1k.hdr', url: fileUrl, sha256: sha256(hdr) }],
    });
    expect(read).not.toHaveProperty('technique');
    expect(requested).toContain(fileUrl);
    expect(readFileSync(join(raw, 'test_sky', 'test_sky_1k.hdr'), 'utf8')).toBe(hdr);
  });

  it('stops a run whose file is not the one the lock records, or not the one the API published', async () => {
    const locked = await readSource(sky, undefined, runWith(fakeWeb(web()).fetch, true));
    await expect(readSource(sky, locked, runWith(fakeWeb(web()).fetch, false))).resolves.toEqual(
      locked,
    );
    const moved = {
      ...locked,
      files: locked.files.map((file) => ({ ...file, sha256: sha256('another sky') })),
    };
    await expect(readSource(sky, moved, runWith(fakeWeb(web()).fetch, false))).rejects.toThrow(
      `test_sky/test_sky_1k.hdr: not the input the lock records (${sha256('another sky')}, got ${sha256(hdr)})`,
    );
    rmSync(join(raw, 'test_sky'), { recursive: true });
    const { fetch } = fakeWeb({ ...web(), [fileUrl]: 'not the published bytes' });
    await expect(readSource(sky, undefined, runWith(fetch, true))).rejects.toThrow(
      'test_sky/test_sky_1k.hdr: MD5 does not match the one published',
    );
    expect(written()).toEqual([]);
  });

  it('follows a redirect that stays on an admitted host, relative or absolute', async () => {
    const moved = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/moved.hdr';
    const { fetch, requested } = fakeWeb({
      ...web(),
      [fileUrl]: { status: 301, location: '/file/ph-assets/HDRIs/hdr/1k/moved.hdr' },
      [moved]: hdr,
    });
    await readSource(sky, undefined, runWith(fetch, true));
    // The file, then where it moved to, then the authors.
    expect(requested.slice(-3, -1)).toEqual([fileUrl, moved]);
  });

  it(`gives up after ${String(MAXIMUM_REDIRECTS)} redirects`, async () => {
    const { fetch, requested } = fakeWeb({
      ...web(),
      [fileUrl]: { status: 302, location: fileUrl },
    });
    await expect(readSource(sky, undefined, runWith(fetch, true))).rejects.toThrow(
      `${fileUrl}: more than ${String(MAXIMUM_REDIRECTS)} redirects`,
    );
    expect(requested.filter((url) => url === fileUrl)).toHaveLength(MAXIMUM_REDIRECTS + 1);
  });

  it('refuses a file the API names on a host no admitted source owns, before requesting it', async () => {
    const stray = 'https://dl.polyhaven.example/test_sky_1k.hdr';
    const { fetch, requested } = fakeWeb(web(stray));
    await expect(readSource(sky, undefined, runWith(fetch, true))).rejects.toThrow(
      `${stray} is not from a source ADR 0049 D-10 admits`,
    );
    expect(requested).not.toContain(stray);
    expect(written()).toEqual([]);
  });

  it('refuses a licence page no admitted source owns, before requesting it', async () => {
    const stray = { ...sky, licencePage: 'https://polyhaven.example/a/test_sky' };
    const { fetch, requested } = fakeWeb({ ...web(), [stray.licencePage]: 'This asset is CC0' });
    await expect(readSource(stray, undefined, runWith(fetch, true))).rejects.toThrow(
      `${stray.licencePage} is not from a source ADR 0049 D-10 admits`,
    );
    expect(requested).toEqual([]);
  });

  it('downloads nothing when the licence page does not keep the asset', async () => {
    const { fetch, requested } = fakeWeb({
      ...web(),
      [sky.licencePage]: '<p>All rights reserved.</p>',
    });
    await expect(readSource(sky, undefined, runWith(fetch, true))).rejects.toThrow(
      `test_sky: ${sky.licencePage} does not state "This asset is CC0"`,
    );
    expect(requested).toEqual([sky.licencePage]);
    expect(written()).toEqual([]);
  });
});

describe('an archive whose own name is not a path under its directory', () => {
  it('is refused before it is requested', async () => {
    const pack: AssetSource = {
      id: 'pack',
      licencePage:
        'https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html',
      licencePhrase: 'CC0',
      licence: 'CC0-1.0',
      author: 'makehuman_system',
      // The archive's name is the last segment of its URL, and here there is none.
      origin: {
        from: 'archive',
        url: 'https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/',
        members: [],
      },
    };
    const { fetch, requested } = fakeWeb({ [pack.licencePage]: 'CC0' });
    await expect(readSource(pack, undefined, runWith(fetch, true))).rejects.toThrow(
      'pack: refused path ',
    );
    expect(requested).toEqual([pack.licencePage]);
    expect(existsSync(join(raw, 'pack'))).toBe(false);
  });
});
