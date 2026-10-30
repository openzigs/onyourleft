// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { THEME_SELECTION_SCRIPT } from '../../src/design/theme-selection';
import { withThemeSelection } from '../theme/theme-selection-plugin';
import { scriptHash, UNSAFE_EVAL_PAGE, withInlineScriptHashes } from './content-security';

const DEMO_PAGE = readFileSync(
  fileURLToPath(new URL('../../demo/index.html', import.meta.url)),
  'utf8',
);
/** Any page but the demo's, which may not say `'unsafe-eval'` (#1683). */
const ANOTHER_PAGE = fileURLToPath(new URL('../../index.html', import.meta.url));

/** The policy a page carries, directive by directive. */
function policyOf(html: string): Map<string, string[]> {
  const content =
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i.exec(html)?.[1] ?? '';
  return new Map(
    content
      .split(';')
      .map((each) => each.trim().split(/\s+/))
      .filter((words) => words[0] !== '')
      .map(([name = '', ...sources]) => [name, sources]),
  );
}

function page(policy: string, body = '<script>go()</script>'): string {
  return (
    `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}" />` +
    `<meta charset="UTF-8" /></head><body>${body}</body></html>`
  );
}

describe('the demo page refuses the network — #1645', () => {
  it('carries the policy the issues name, and nothing wider', () => {
    const policy = policyOf(DEMO_PAGE);
    expect(policy.get('default-src')).toEqual(["'self'"]);
    // #1683: `blob:` is the page's own memory — GLTFLoader's embedded textures.
    expect(policy.get('connect-src')).toEqual(["'self'", 'blob:']);
    expect(policy.get('worker-src')).toEqual(["'self'", 'blob:']);
    expect(policy.get('img-src')).toEqual(["'self'", 'blob:', 'data:']);
    // #1683: the owner's ruling lets the KTX2 transcoder run here.
    expect(policy.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'", "'unsafe-eval'"]);
    expect(DEMO_PAGE).not.toMatch(/'unsafe-inline'/);
  });

  it('allows the theme script, as the build writes it, by its hash', () => {
    const built = withInlineScriptHashes(
      withThemeSelection(DEMO_PAGE, '/index.html'),
      UNSAFE_EVAL_PAGE,
    );
    const text = /<script id="oyl-theme-selection">([\s\S]*?)<\/script>/.exec(built)?.[1];
    expect(text).toContain(THEME_SELECTION_SCRIPT);
    expect(policyOf(built).get('script-src')).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
      "'unsafe-eval'",
      scriptHash(text ?? ''),
    ]);
    // Nothing else about the policy moved.
    expect(policyOf(built).get('connect-src')).toEqual(["'self'", 'blob:']);
  });
});

describe('the hash a browser compares an inline script against', () => {
  it('is base64 SHA-256 over the exact text, whitespace and all', () => {
    // `printf 'go()' | openssl dgst -sha256 -binary | base64`
    expect(scriptHash('go()')).toBe("'sha256-5KYv+PUboo5h+0+YAtGRPbwv5d/QxzHslP4YGnUaxRw='");
    expect(scriptHash('go() ')).not.toBe(scriptHash('go()'));
  });

  it('is added for every inline script, once each, and never for a script with a src', () => {
    const html = page(
      "script-src 'self'",
      '<script>go()</script><script>go()</script><script type="module" src="./x.js"></script>',
    );
    expect(policyOf(withInlineScriptHashes(html, ANOTHER_PAGE)).get('script-src')).toEqual([
      "'self'",
      scriptHash('go()'),
    ]);
  });

  it('leaves a page with no inline script as it was', () => {
    const html = page("script-src 'self'", '<script src="./x.js"></script>');
    expect(withInlineScriptHashes(html, ANOTHER_PAGE)).toBe(html);
  });
});

describe('a page the plugin refuses, rather than half-allowing', () => {
  it('has no policy', () => {
    expect(() =>
      withInlineScriptHashes('<html><head><meta charset="UTF-8" /></head></html>', ANOTHER_PAGE),
    ).toThrow(/no <meta http-equiv="Content-Security-Policy">/);
  });

  it("says 'unsafe-inline', on any page, the demo's included", () => {
    for (const each of [ANOTHER_PAGE, UNSAFE_EVAL_PAGE]) {
      expect(() => withInlineScriptHashes(page("script-src 'self' 'unsafe-inline'"), each)).toThrow(
        /unsafe-inline/,
      );
    }
  });

  it("says 'unsafe-eval' on any page but the demo's — the owner's ruling on #1683", () => {
    const html = page("script-src 'self' 'unsafe-eval'");
    expect(() => withInlineScriptHashes(html, ANOTHER_PAGE)).toThrow(
      /says 'unsafe-eval', which only the demo page may \(the owner's ruling on #1683\)/,
    );
    expect(() => withInlineScriptHashes(html, '/somewhere/else/demo/index.html')).toThrow(
      /unsafe-eval/,
    );
    expect(policyOf(withInlineScriptHashes(html, UNSAFE_EVAL_PAGE)).get('script-src')).toEqual([
      "'self'",
      "'unsafe-eval'",
      scriptHash('go()'),
    ]);
  });

  it('has a script ahead of the policy, which the policy would not cover', () => {
    const html = `<html><head><script>go()</script>${page("script-src 'self'").slice(21)}`;
    expect(() => withInlineScriptHashes(html, ANOTHER_PAGE)).toThrow(/comes before the policy/);
  });

  it('has no script-src to add a hash to', () => {
    expect(() => withInlineScriptHashes(page("default-src 'self'"), ANOTHER_PAGE)).toThrow(
      /no script-src/,
    );
  });

  it('has pushed the charset past the bytes it must be declared in', () => {
    const html = page(`script-src 'self'; img-src ${'https://a.example '.repeat(60)}`);
    expect(() => withInlineScriptHashes(html, ANOTHER_PAGE)).toThrow(/charset/);
  });
});
