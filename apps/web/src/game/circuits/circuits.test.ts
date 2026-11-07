// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The shipped circuit files, read the way the game reads them — #2293,
 * ADR 0064 D-6.4: *"A test may read the real files to check their shape,
 * their licence fields and that they close."* This file draws nothing and
 * screenshots nothing, so it makes no Produced Work of them.
 *
 * It is also the check D-6.2 asks for beyond `ASSETS.toml`: the licence fields
 * are INSIDE each file and the notice is BESIDE them and copied, byte for byte,
 * into the app's `public/licences/`. `ASSETS.toml` pins each file's digest and
 * admits `ODbL-1.0` at this one directory (`ASSET004`); it cannot read a JSON
 * field, which is why this is a test and not a second repository rule.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LOOP_CLOSURE_METRES, routeProfile } from '@onyourleft/domain';
import { CIRCUIT_ROUTE_PREFIX, isCircuitRouteId } from '@onyourleft/store';

import { ODBL_LICENCE_URL, ODBL_NOTICE } from '../../map/basemap';
import { steepestClimbPercent } from '../StageChooser';
import {
  CIRCUIT_HEIGHTS_DATASET,
  CIRCUIT_LICENCE,
  CIRCUIT_LONGEST_METRES,
  CIRCUIT_SHORTEST_METRES,
  parseCircuitFile,
  type CircuitFile,
} from './circuit-file';
import { circuitRoute, loadBuiltInCircuits } from './circuits';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, 'data');
const WEB = join(HERE, '..', '..', '..');
const REPOSITORY = join(WEB, '..', '..');

const FILES = readdirSync(DATA)
  .filter((name) => name.endsWith('.json'))
  .sort();

function read(name: string): CircuitFile {
  return parseCircuitFile(JSON.parse(readFileSync(join(DATA, name), 'utf8')), name.slice(0, -5));
}

describe('the shipped circuits — #2293', () => {
  it('are three or four (the owner’s ruling), each a file the format reads', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(3);
    expect(FILES.length).toBeLessThanOrEqual(4);
    for (const name of FILES) expect(() => read(name), name).not.toThrow();
  });

  it('are about 3 to 8 km each, and close on themselves', () => {
    for (const name of FILES) {
      const file = read(name);
      expect(file.lengthMetres, name).toBeGreaterThanOrEqual(CIRCUIT_SHORTEST_METRES);
      expect(file.lengthMetres, name).toBeLessThanOrEqual(CIRCUIT_LONGEST_METRES);
      // The profile the game rides is a loop, which `routeProfile` refuses
      // for ends more than LOOP_CLOSURE_METRES apart.
      const profile = circuitRoute(file).profile;
      expect(profile.loop, name).toBe(true);
      expect(Math.abs(profile.totalDistance - file.lengthMetres), name).toBeLessThan(
        LOOP_CLOSURE_METRES,
      );
    }
  });

  it('carry the licence inside each file: ODbL 1.0, its URL, the source and the §4.3 notice', () => {
    for (const name of FILES) {
      const { licence } = read(name);
      expect(licence.id, name).toBe('ODbL-1.0');
      expect(licence.url, name).toBe(ODBL_LICENCE_URL);
      expect(licence.source, name).toBe('OpenStreetMap contributors');
      expect(licence.sourceUrl, name).toBe('https://www.openstreetmap.org/copyright');
      expect(licence.notice, name).toBe(ODBL_NOTICE);
      // Drawn through the project's own archive (ADR 0062), and recorded.
      expect(licence.through, name).toMatch(
        /^https:\/\/tiles\.openzigs\.com\/basemap-us-oyl-\d{8}\.pmtiles$/,
      );
      expect(licence).toStrictEqual({ ...CIRCUIT_LICENCE, through: licence.through });
    }
  });

  it('take their heights from USGS 3DEP and nothing else (ADR 0064 D-7.2)', () => {
    for (const name of FILES) {
      expect(read(name).heights.dataset, name).toBe(CIRCUIT_HEIGHTS_DATASET);
    }
  });

  it('carry no key the format does not name: no OSM id, no name of a street or place, no owner, no time', () => {
    for (const name of FILES) {
      const raw = JSON.parse(readFileSync(join(DATA, name), 'utf8')) as Record<string, unknown>;
      expect(Object.keys(raw).sort(), name).toStrictEqual([
        'drawn',
        'format',
        'heights',
        'id',
        'lengthMetres',
        'licence',
        'name',
        'points',
        'version',
      ]);
      // Every point is three numbers and nothing else.
      for (const point of raw.points as unknown[]) {
        expect(point).toHaveLength(3);
      }
    }
  });

  it('have names and ids of their own, all different', () => {
    const files = FILES.map(read);
    expect(new Set(files.map((file) => file.name)).size).toBe(files.length);
    expect(new Set(files.map((file) => file.id)).size).toBe(files.length);
  });

  it('are rideable: no grade a trainer would be sent that is a wall', () => {
    for (const name of FILES) {
      const profile = circuitRoute(read(name)).profile;
      expect(steepestClimbPercent(profile), name).toBeLessThan(15);
      expect(Math.min(...profile.grades), name).toBeGreaterThan(-15);
    }
  });

  it('have the notice beside them, and the same bytes in the app’s public licences', () => {
    const beside = readFileSync(join(DATA, 'LICENCE-ODbL.txt'), 'utf8');
    const shipped = readFileSync(join(WEB, 'public', 'licences', 'circuits-ODbL.txt'), 'utf8');
    expect(shipped).toBe(beside);
    expect(beside).toContain(ODBL_NOTICE.replace('here under the Open', 'here under the\nOpen'));
    expect(beside).toContain(ODBL_LICENCE_URL);
    expect(beside).toContain('https://www.openstreetmap.org/copyright');
    // §4.6 a: where the whole database is offered.
    expect(beside).toContain(
      'https://github.com/openzigs/onyourleft/tree/main/apps/web/src/game/circuits/data',
    );
  });

  it('are each named in ASSETS.toml under ODbL-1.0, with the digest ASSET003 checks', () => {
    const manifest = readFileSync(join(REPOSITORY, 'ASSETS.toml'), 'utf8');
    for (const name of FILES) {
      const path = `apps/web/src/game/circuits/data/${name}`;
      const entry = manifest.split('[[asset]]').find((block) => block.includes(`path = "${path}"`));
      expect(entry, path).toBeDefined();
      expect(entry, path).toContain('licence = "ODbL-1.0"');
      expect(entry, path).toContain('script = "apps/web/tools/circuits/author-circuit.ts"');
    }
  });
});

describe('loadBuiltInCircuits — #2293', () => {
  it('reads every shipped file as a ridable loop keyed in the circuit namespace, shortest first', async () => {
    const circuits = await loadBuiltInCircuits();
    expect(circuits).toHaveLength(FILES.length);
    for (const circuit of circuits) {
      expect(isCircuitRouteId(circuit.id)).toBe(true);
      expect(circuit.id.startsWith(CIRCUIT_ROUTE_PREFIX)).toBe(true);
      expect(circuit.profile.loop).toBe(true);
      expect(circuit.attempts).toBe(0);
    }
    const lengths = circuits.map((circuit) => circuit.profile.totalDistance);
    expect(lengths).toStrictEqual([...lengths].sort((a, b) => a - b));
    expect(circuits.map((circuit) => circuit.id).sort()).toStrictEqual(
      FILES.map((name) => `circuit:${name.slice(0, -5)}`).sort(),
    );
  });

  it('leaves out a file that does not read as a circuit, and offers the rest', async () => {
    const good = JSON.parse(readFileSync(join(DATA, FILES[0] as string), 'utf8')) as unknown;
    const id = (FILES[0] as string).slice(0, -5);
    const circuits = await loadBuiltInCircuits({
      [`./data/${id}.json`]: () => Promise.resolve(good),
      './data/broken.json': () => Promise.resolve({ format: 'something else' }),
      './data/failing.json': () => Promise.reject(new Error('chunk failed to load')),
      // A good file under another name: its id is not its file's.
      './data/renamed.json': () => Promise.resolve(good),
    });
    expect(circuits.map((circuit) => circuit.id)).toStrictEqual([`circuit:${id}`]);
  });

  it('builds the profile from the file’s own points and heights', () => {
    const file = read(FILES[0] as string);
    const profile = circuitRoute(file).profile;
    const direct = routeProfile(
      file.points.map(([latitude, longitude, height]) => ({
        position: { latitude, longitude } as never,
        elevation: height as never,
      })),
      { loop: true },
    );
    expect(profile.totalAscent).toBe(direct.totalAscent);
    expect(profile.elevations[0]).toBe(direct.elevations[0]);
  });
});
