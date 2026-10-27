// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The licence texts the Credits screen renders are the files the app ships —
 * #1744.
 *
 * Read back through the loader the screen uses and compared byte for byte
 * with the committed file `SHIPPED_LICENCE_TEXTS` names, which
 * `credits.test.ts` holds to the canonical text. A loader that read another
 * copy, or none, would show a rider a licence nothing checked.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { LICENCE_COPY_LICENCES, SHIPPED_LICENCE_TEXTS } from './credits';
import { loadShippedLicence, READABLE_LICENCES } from './licence-documents';

const PUBLIC = new URL('../../public/', import.meta.url);

describe('loadShippedLicence (#1744)', () => {
  it('reads every shipped licence text, verbatim, from the file the app serves', async () => {
    const shipped = Object.entries(SHIPPED_LICENCE_TEXTS);
    expect(shipped.length).toBeGreaterThan(0);
    for (const [licence, link] of shipped) {
      const committed = readFileSync(fileURLToPath(new URL(link.slice(2), PUBLIC)), 'utf8');
      expect(await loadShippedLicence(licence), `${licence} is not ${link}`).toBe(committed);
    }
  });

  it('can read every licence a credit asks to travel with its work', () => {
    expect([...READABLE_LICENCES].sort()).toEqual([...LICENCE_COPY_LICENCES].sort());
    expect([...READABLE_LICENCES].sort()).toEqual(Object.keys(SHIPPED_LICENCE_TEXTS).sort());
  });

  it('reads the right text for each licence, not one for both', async () => {
    expect(await loadShippedLicence('Apache-2.0')).toMatch(
      /^\s*Apache License\s+Version 2\.0, January 2004/,
    );
    expect(await loadShippedLicence('OFL-1.1')).toContain('SIL OPEN FONT LICENSE');
  });

  it('rejects a licence it ships no copy of', async () => {
    await expect(loadShippedLicence('MIT')).rejects.toThrow('ships no copy of the MIT licence');
  });
});
