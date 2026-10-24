// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo page refuses the network, in the pinned Chromium — #1645.
 *
 * The page is `demo/index.html` with the two transforms the demo build makes
 * to it, `withThemeSelection` and then `withInlineScriptHashes`, served by
 * `page.route` at an origin of its own: it needs no build and no server, so it
 * adds neither to the gate. Its module script is answered with a 404, because
 * what is measured is the page's policy and not the demo's code.
 *
 * Each claim has its control. `fetch('https://example.org')` is refused under
 * the policy and reaches the (routed) network without it, so it is the policy
 * that refused it; the theme script runs under the policy with its hash and
 * is blocked when the hash is left out, so it is the hash that allowed it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { withInlineScriptHashes } from '../tools/demo/content-security';
import { withThemeSelection } from '../tools/theme/theme-selection-plugin';

const DEMO_ORIGIN = 'http://demo.test';
const SOURCE = readFileSync(fileURLToPath(new URL('../demo/index.html', import.meta.url)), 'utf8');
const BUILT = withInlineScriptHashes(withThemeSelection(SOURCE, '/index.html'));
const POLICY = /<meta\s+http-equiv="Content-Security-Policy"[^>]*\/>/;

interface Load {
  readonly reachedTheNetwork: () => boolean;
}

/** Serve `html` at the demo origin, and record every policy violation the page sees. */
async function load(page: Page, html: string): Promise<Load> {
  let reached = false;
  await page.route('https://example.org/**', (route) => {
    reached = true;
    return route.fulfill({
      status: 200,
      body: 'reached',
      headers: { 'access-control-allow-origin': '*' },
    });
  });
  await page.route(`${DEMO_ORIGIN}/**`, (route) =>
    new URL(route.request().url()).pathname === '/'
      ? route.fulfill({ status: 200, contentType: 'text/html', body: html })
      : route.fulfill({ status: 404, body: '' }),
  );
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { violations: string[] }).violations = seen;
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`);
    });
  });
  await page.goto(`${DEMO_ORIGIN}/`);
  return { reachedTheNetwork: () => reached };
}

/** What a `fetch` to another origin came to, from inside the page. */
function fetchElsewhere(page: Page): Promise<string> {
  return page.evaluate(async () => {
    try {
      return await (await fetch('https://example.org/')).text();
    } catch (error) {
      return `refused: ${String(error)}`;
    }
  });
}

function violations(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { violations: string[] }).violations);
}

test.describe('the demo page’s Content-Security-Policy — #1645', () => {
  test('refuses a fetch to another origin, before it reaches the network', async ({ page }) => {
    const served = await load(page, BUILT);
    expect(await fetchElsewhere(page)).toMatch(/^refused: TypeError/);
    expect(served.reachedTheNetwork()).toBe(false);
    await expect.poll(() => violations(page)).toContain('connect-src https://example.org/');
  });

  test('control: without the policy the same fetch reaches the network', async ({ page }) => {
    const served = await load(page, BUILT.replace(POLICY, ''));
    expect(await fetchElsewhere(page)).toBe('reached');
    expect(served.reachedTheNetwork()).toBe(true);
  });

  test('runs the theme script, which it allows by its hash alone', async ({ page }) => {
    await load(page, BUILT);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toMatch(
      /^(?:light|dark)$/,
    );
    expect((await violations(page)).filter((each) => each.startsWith('script-src'))).toEqual([]);
  });

  test('control: without the hash the theme script is blocked', async ({ page }) => {
    const unhashed = withThemeSelection(SOURCE, '/index.html');
    await load(page, unhashed);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe(
      null,
    );
  });
});
