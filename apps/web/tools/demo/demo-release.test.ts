// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo's route data as a GitHub release asset — #1932, ADR 0056 D-4.2.
 *
 * `demo-release.yml` runs by hand, after review, and is never a required
 * check, so nothing in a pull request would see it rot. Two halves are held
 * here instead:
 *
 * - **What is staged**, against the synthetic corridor fixture baked by the
 *   real bake (never OpenStreetMap data, ADR 0056 D-9). Every check reads the
 *   staged files back from disk.
 * - **The workflow, read as text**: its only trigger, its runners, its pins,
 *   its permissions, its one token and its one secret (the archive's R2 read
 *   token, #2275), and that it bakes and stages through the scripts this file
 *   tests.
 *
 * ⚠️ What this file does NOT claim: that the release is published. That is
 * settled by running the workflow from `main`, and never by a pull request.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { buildCorridorFixtureArchive, corridorFixtureRoute } from '../../browser/corridor-fixture';
import { ODBL_NOTICE } from '../../src/map/basemap';
import { countingSource } from '../../src/world-data/archive-testing';
import { corridorArchiveFrom } from '../../src/world-data/corridor-source';

import { bakeRoute, strippedGpx, writeBakedRoute } from './bake-route';
import {
  parseReleaseArguments,
  presetRouteIds,
  PRESET_ROUTES_DIRECTORY,
  releaseAssets,
  releaseNotes,
  releaseTag,
  stageRelease,
} from './demo-release';
import { ODBL_NOTICE_FILE, ROUTE_MANIFEST_FILE } from './demo-routes';
import { R2_ARCHIVE_VARIABLES } from './r2-archive';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = join(WEB, '..', '..');
const WORKFLOW = readFileSync(join(ROOT, '.github', 'workflows', 'demo-release.yml'), 'utf8');

const scratch = mkdtempSync(join(tmpdir(), 'oyl-demo-release-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** The lines of one of demo-release.yml's jobs, from its key to the next job's. */
function job(name: string): string {
  const lines = WORKFLOW.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  expect(start, `demo-release.yml has no job ${name}`).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The fixture route, baked by the real bake into a fresh `routes/` as `id`. Returns the directory. */
async function bakedRoutes(ids: readonly string[]): Promise<string> {
  const directory = mkdtempSync(join(scratch, 'routes-'));
  const bytes = await buildCorridorFixtureArchive();
  const profile = corridorFixtureRoute();
  const gpx = strippedGpx(
    profile.positions.map(
      (position, index) =>
        [position.latitude, position.longitude, profile.elevations[index] ?? null] as const,
    ),
  );
  for (const routeId of ids) {
    writeBakedRoute(
      directory,
      await bakeRoute({
        routeId,
        gpx,
        archive: corridorArchiveFrom(countingSource(bytes)),
        archiveUrl: 'file:corridor-fixture.pmtiles',
      }),
    );
  }
  return directory;
}

function manifestOf(directory: string): {
  routes: Record<string, { file: string; sha256: string }>;
} {
  return JSON.parse(readFileSync(join(directory, ROUTE_MANIFEST_FILE), 'utf8')) as {
    routes: Record<string, { file: string; sha256: string }>;
  };
}

describe('demo:release stages what the bake wrote, unchanged — #1932, ADR 0056 D-4.2', () => {
  it('stages each preset’s bundle, the manifest and the ODbL notice, byte for byte', async () => {
    const routes = await bakedRoutes(['fixture']);
    const stage = join(scratch, 'stage-whole');
    const notes = join(scratch, 'notes-whole', 'notes.md');
    const staged = stageRelease({
      tag: 'demo-2026-11-07',
      routesDirectory: routes,
      presets: ['fixture'],
      stage,
      notes,
    });
    const { file } = manifestOf(routes).routes.fixture ?? { file: '' };
    expect(file).toMatch(/^fixture\.[0-9a-f]{16}\.bin$/);
    expect(staged).toStrictEqual([file, ROUTE_MANIFEST_FILE, ODBL_NOTICE_FILE]);
    expect(readdirSync(stage).sort()).toStrictEqual([...staged].sort());
    for (const name of staged) {
      expect(sha256(readFileSync(join(stage, name))), name).toBe(
        sha256(readFileSync(join(routes, name))),
      );
    }
    expect(sha256(readFileSync(join(stage, file)))).toBe(manifestOf(routes).routes.fixture?.sha256);
    expect(readFileSync(join(stage, ODBL_NOTICE_FILE), 'utf8')).toContain(ODBL_NOTICE);
  });

  it('writes notes that carry the ODbL notice and each route’s file and digest', async () => {
    const routes = await bakedRoutes(['fixture']);
    const notes = join(scratch, 'notes-read', 'notes.md');
    stageRelease({
      tag: 'demo-2026-11-07',
      routesDirectory: routes,
      presets: ['fixture'],
      stage: join(scratch, 'stage-notes'),
      notes,
    });
    const text = readFileSync(notes, 'utf8');
    const entry = manifestOf(routes).routes.fixture;
    expect(text).toContain('`demo-2026-11-07`');
    expect(text).toContain(ODBL_NOTICE);
    expect(text).toContain('https://www.openstreetmap.org/copyright');
    expect(text).toContain('https://opendatacommons.org/licenses/odbl/1-0/');
    expect(text).toContain(`\`${entry?.file ?? 'none'}\``);
    expect(text).toContain(`\`${entry?.sha256 ?? 'none'}\``);
    expect(text).toBe(releaseNotes('demo-2026-11-07', routes, ['fixture']));
  });

  it('refuses a preset that was not baked, and a baked route that is not a preset', async () => {
    const routes = await bakedRoutes(['fixture', 'other']);
    expect(() => releaseAssets(routes, ['fixture'])).toThrow(/lists other, which is not a preset/);
    expect(() => releaseAssets(routes, ['fixture', 'other', 'missing'])).toThrow(
      /missing has not been baked/,
    );
    expect(releaseAssets(routes, ['fixture', 'other'])).toHaveLength(4);
  });

  it('refuses a bundle whose bytes are not the digest the manifest names', async () => {
    const routes = await bakedRoutes(['fixture']);
    const { file } = manifestOf(routes).routes.fixture ?? { file: '' };
    const bytes = readFileSync(join(routes, file));
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    writeFileSync(join(routes, file), bytes);
    expect(() => releaseAssets(routes, ['fixture'])).toThrow(/is not the file routes\.json names/);
  });

  it('refuses an output with no notice, no manifest, no bundle, or no preset at all', async () => {
    const noNotice = await bakedRoutes(['fixture']);
    rmSync(join(noNotice, ODBL_NOTICE_FILE));
    expect(() => releaseAssets(noNotice, ['fixture'])).toThrow(/no LICENCE-ODbL\.txt/);

    const noManifest = await bakedRoutes(['fixture']);
    rmSync(join(noManifest, ROUTE_MANIFEST_FILE));
    expect(() => releaseAssets(noManifest, ['fixture'])).toThrow(/no routes\.json/);

    const noBundle = await bakedRoutes(['fixture']);
    rmSync(join(noBundle, manifestOf(noBundle).routes.fixture?.file ?? ''));
    expect(() => releaseAssets(noBundle, ['fixture'])).toThrow(/fixture: .* is missing/);

    expect(() => releaseAssets(noNotice, [])).toThrow(/no preset route/);
  });

  it('stages nothing for a tag that is not a demo release’s', async () => {
    const routes = await bakedRoutes(['fixture']);
    const stage = join(scratch, 'stage-refused');
    expect(() =>
      stageRelease({
        tag: 'v1.0.0',
        routesDirectory: routes,
        presets: ['fixture'],
        stage,
        notes: join(scratch, 'notes-refused.md'),
      }),
    ).toThrow(/demo-YYYY-MM-DD/);
    expect(() => readdirSync(stage)).toThrow(/ENOENT/);
  });
});

describe('demo:release’s tag, presets and arguments — #1932', () => {
  it('takes demo-YYYY-MM-DD and a later one that day, and nothing the Android release uses', () => {
    for (const tag of ['demo-2026-11-07', 'demo-2026-11-07.2', 'demo-2026-12-31.10']) {
      expect(releaseTag(tag)).toBe(tag);
    }
    for (const tag of [
      'v1.0.0',
      'demo-latest',
      'demo-2026-13-01',
      'demo-2026-11-32',
      'demo-2026-11-07.1',
      'demo-2026-11-07; rm -rf /',
      ' demo-2026-11-07',
    ]) {
      expect(() => releaseTag(tag), tag).toThrow(/demo-YYYY-MM-DD/);
    }
  });

  it('finds each preset route by its GPX and its record, and nothing with only one', () => {
    const directory = mkdtempSync(join(scratch, 'presets-'));
    for (const name of [
      'b.gpx',
      'b.bake.json',
      'a.gpx',
      'a.bake.json',
      'gpx-only.gpx',
      'record-only.bake.json',
    ]) {
      writeFileSync(join(directory, name), '');
    }
    expect(presetRouteIds(directory)).toStrictEqual(['a', 'b']);
  });

  it('finds the committed preset routes, so the workflow bakes something', () => {
    expect(presetRouteIds(PRESET_ROUTES_DIRECTORY)).toContain('upstate-climb');
  });

  it('reads --list, or all of --tag, --stage and --notes, past pnpm’s --', () => {
    expect(parseReleaseArguments(['--', '--list'])).toStrictEqual({ list: true });
    expect(
      parseReleaseArguments(['--', '--tag', 't', '--stage', 's', '--notes', 'n']),
    ).toStrictEqual({ list: false, tag: 't', stage: 's', notes: 'n' });
    expect(() => parseReleaseArguments(['--tag', 't', '--stage', 's'])).toThrow(
      /--notes is required/,
    );
    expect(() => parseReleaseArguments(['--list', '--tag', 't'])).toThrow(/--list takes no other/);
    expect(() => parseReleaseArguments(['--tag', '--stage', 's'])).toThrow(/--tag needs a value/);
    expect(() => parseReleaseArguments(['--force'])).toThrow(/unknown argument --force/);
  });

  it('runs under node as package.json spells it, and lists the preset routes', () => {
    const manifest = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const [node, ...words] = (manifest.scripts['demo:release'] ?? '').split(/\s+/);
    expect(node).toBe('node');
    const run = spawnSync(process.execPath, [...words, '--', '--list'], {
      cwd: WEB,
      encoding: 'utf8',
      timeout: 30_000,
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout.trim().split('\n')).toStrictEqual(presetRouteIds(PRESET_ROUTES_DIRECTORY));
  });
});

describe('demo-release.yml — #1932, ADR 0056 D-4.2 and D-9', () => {
  it('runs by hand only: no pull request, push or schedule can bake real map data', () => {
    const on = /^on:\n((?:[ \t]+[^\n]*\n)+)/m.exec(WORKFLOW)?.[1] ?? '';
    const triggers = [...on.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]);
    expect(triggers).toStrictEqual(['workflow_dispatch']);
    expect(WORKFLOW).not.toMatch(/pull_request/);
  });

  it('runs on the standard runner only, which is free on a public repository', () => {
    const runners = [...WORKFLOW.matchAll(/^\s*runs-on:\s*(\S+)/gm)].map((match) => match[1]);
    expect(runners).toStrictEqual(['ubuntu-latest', 'ubuntu-latest', 'ubuntu-latest']);
  });

  it('pins every action to a full commit SHA rather than a tag', () => {
    const uses = [...WORKFLOW.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map((match) => match[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const reference of uses) expect(reference).toMatch(/@[0-9a-f]{40}$/);
  });

  it('reads one secret, the archive’s R2 read token, in the bake step alone — #2275', () => {
    // The public host answers a runner 403, so the bake reads the archive
    // through R2 (`r2-archive.ts`); the token is the four variables that
    // module reads, from an environment that deploys from `main`.
    const bake = job('bake');
    expect(bake).toMatch(/^ {4}environment: basemap-archive$/m);
    const step = /- name: Bake the preset routes\n((?: {8}.*\n)+)/.exec(bake)?.[1] ?? '';
    const secrets = Object.values(R2_ARCHIVE_VARIABLES).map(
      (name) => `          ${name}: \${{ secrets.${name} }}\n`,
    );
    expect(step.startsWith(`        env:\n${secrets.join('')}        run: |\n`)).toBe(true);
    const code = WORKFLOW.split('\n').filter((line) => !line.trimStart().startsWith('#'));
    expect(code.join('\n').match(/secrets\./g)).toHaveLength(secrets.length);
  });

  it('writes only from the job that runs no repository code', () => {
    expect(/^permissions:\n {2}contents: read\n/m.test(WORKFLOW)).toBe(true);
    expect(job('bake')).not.toMatch(/permissions:/);
    const publish = job('publish');
    expect(publish).toMatch(/permissions:\n {6}contents: write\n/);
    expect(publish).not.toMatch(/actions\/checkout|pnpm|node /);
    expect(publish).toMatch(/GH_TOKEN: \$\{\{ github\.token \}\}/);
  });

  it('bakes the listed presets, builds the demo, and stages through demo:release', () => {
    const bake = job('bake');
    const order = [
      'run demo:release -- --list',
      'run demo:bake -- --route "$route"',
      'run build:demo',
      '--tag "$TAG" --stage',
      'name: demo-release',
    ].map((text) => bake.indexOf(text));
    for (const at of order) expect(at).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toStrictEqual(order);
    expect(bake).not.toMatch(/--record|--archive|--gpx/);
  });

  it('passes the tag as an environment variable, never into a script', () => {
    const uses = [...WORKFLOW.matchAll(/\$\{\{\s*inputs\.tag\s*\}\}/g)];
    expect(uses).toHaveLength(2);
    for (const line of WORKFLOW.split('\n').filter((text) => text.includes('inputs.tag'))) {
      expect(line.trim()).toBe('TAG: ${{ inputs.tag }}');
    }
  });

  it('publishes the staged files with their notes, and is never the latest release', () => {
    const publish = job('publish');
    expect(publish).toMatch(/gh release create "\$TAG" assets\/\*/);
    expect(publish).toMatch(/--notes-file notes\.md/);
    expect(publish).toMatch(/--latest=false/);
    expect(publish).toMatch(/--target "\$TARGET"/);
  });
});

describe('demo-release.yml deploys the demo to GitHub Pages — #2264', () => {
  it('uploads the whole demo output as the Pages artefact, after the build reads the routes back', () => {
    const bake = job('bake');
    const build = bake.indexOf('run build:demo');
    const upload = bake.search(/uses: actions\/upload-pages-artifact@[0-9a-f]{40}/);
    expect(build).toBeGreaterThan(0);
    expect(upload).toBeGreaterThan(build);
    expect(bake.slice(upload)).toMatch(/^\s+path: apps\/web\/demo\/dist\/$/m);
  });

  it('deploys only after the release is published, so the hosted routes are on a release too', () => {
    const pages = job('pages');
    expect(pages).toMatch(/^ {4}needs: \[bake, publish\]$/m);
    expect(pages).toMatch(/uses: actions\/deploy-pages@[0-9a-f]{40}/);
    expect(pages).toMatch(/^ {6}name: github-pages$/m);
  });

  it('holds pages: write and id-token: write in the deploy job alone, which runs no repository code', () => {
    const pages = job('pages');
    expect(pages).toMatch(/^ {4}permissions:\n {6}pages: write\n {6}id-token: write\n {4}\S/m);
    expect(pages).not.toMatch(/actions\/checkout|pnpm|node |run:/);
    const elsewhere = WORKFLOW.replace(pages, '')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'));
    expect(elsewhere.join('\n')).not.toMatch(/pages: write|id-token:/);
  });
});
