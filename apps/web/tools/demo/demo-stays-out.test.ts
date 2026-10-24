// SPDX-License-Identifier: AGPL-3.0-or-later

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Scanner } from '@tailwindcss/oxide';
import { describe, expect, it } from 'vitest';

import { shippedUtilities } from '../../src/a11y/tailwind-shipped-testing';
import { demoInProduct, demoStaysOut } from './demo-stays-out';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function runPlugin(bundle: Record<string, unknown>): void {
  (demoStaysOut(ROOT).generateBundle as unknown as (...args: unknown[]) => void).call(
    {
      error(message: string): never {
        throw new Error(message);
      },
    },
    {},
    bundle,
  );
}

describe('the rider app carries none of the demo — #1645', () => {
  it('finds a demo module in a chunk and a file emitted under demo/', () => {
    expect(
      demoInProduct(
        ROOT,
        [
          join(ROOT, 'src/main.tsx'),
          join(ROOT, 'src/demo/routes/climb.json?import'),
          join(ROOT, 'src/demonstration.ts'),
          join(ROOT, 'demo/index.html'),
        ],
        ['index.html', 'assets/index.js', 'demo/route.bin', 'assets/demo-abc.js'],
      ),
    ).toEqual(['src/demo/routes/climb.json', 'demo/index.html', 'demo/route.bin']);
  });

  it('fails the product build over one', () => {
    expect(() => {
      runPlugin({
        'assets/index.js': {
          type: 'chunk',
          fileName: 'assets/index.js',
          modules: { [join(ROOT, 'src/main.tsx')]: {}, [join(ROOT, 'src/demo/main.tsx')]: {} },
        },
      });
    }).toThrow(/oyl-demo-stays-out: [\s\S]*- src\/demo\/main\.tsx/);
  });

  it('lets a product build with none through', () => {
    expect(() => {
      runPlugin({
        'assets/index.js': {
          type: 'chunk',
          fileName: 'assets/index.js',
          modules: { [join(ROOT, 'src/main.tsx')]: {} },
        },
        'sw.js': { type: 'asset', fileName: 'sw.js' },
      });
    }).not.toThrow();
  });

  it('keeps the demo out of the stylesheet: Tailwind scans the app, and no file under src/demo/', async () => {
    const { compiler } = await shippedUtilities();
    const scanner = new Scanner({ sources: compiler.sources });
    scanner.scan();
    const files = scanner.files.map((file) => file.replace(/\\/g, '/'));
    // The control: the scan reaches the app's own components, so an empty
    // list could not pass this.
    expect(files).toContain(join(ROOT, 'src/views/AboutView.tsx').replace(/\\/g, '/'));
    expect(files.filter((file) => file.includes('/src/demo/'))).toEqual([]);
  });
});
