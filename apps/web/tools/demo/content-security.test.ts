// SPDX-License-Identifier: AGPL-3.0-or-later

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { THEME_SELECTION_SCRIPT } from '../../src/design/theme-selection';
import { withThemeSelection } from '../theme/theme-selection-plugin';
import { scriptHash, withInlineScriptHashes } from './content-security';

const DEMO_PAGE = readFileSync(
  fileURLToPath(new URL('../../demo/index.html', import.meta.url)),
  'utf8',
);

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
  it('carries the policy the issue names, and nothing wider', () => {
    const policy = policyOf(DEMO_PAGE);
    expect(policy.get('default-src')).toEqual(["'self'"]);
    expect(policy.get('connect-src')).toEqual(["'self'"]);
    expect(policy.get('worker-src')).toEqual(["'self'", 'blob:']);
    expect(policy.get('img-src')).toEqual(["'self'", 'blob:', 'data:']);
    expect(policy.get('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(DEMO_PAGE).not.toMatch(/'unsafe-(?:inline|eval)'/);
  });

  it('allows the theme script, as the build writes it, by its hash', () => {
    const built = withInlineScriptHashes(withThemeSelection(DEMO_PAGE, '/index.html'));
    const text = /<script id="oyl-theme-selection">([\s\S]*?)<\/script>/.exec(built)?.[1];
    expect(text).toContain(THEME_SELECTION_SCRIPT);
    expect(policyOf(built).get('script-src')).toEqual([
      "'self'",
      "'wasm-unsafe-eval'",
      scriptHash(text ?? ''),
    ]);
    // Nothing else about the policy moved.
    expect(policyOf(built).get('connect-src')).toEqual(["'self'"]);
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
    expect(policyOf(withInlineScriptHashes(html)).get('script-src')).toEqual([
      "'self'",
      scriptHash('go()'),
    ]);
  });

  it('leaves a page with no inline script as it was', () => {
    const html = page("script-src 'self'", '<script src="./x.js"></script>');
    expect(withInlineScriptHashes(html)).toBe(html);
  });
});

describe('a page the plugin refuses, rather than half-allowing', () => {
  it('has no policy', () => {
    expect(() =>
      withInlineScriptHashes('<html><head><meta charset="UTF-8" /></head></html>'),
    ).toThrow(/no <meta http-equiv="Content-Security-Policy">/);
  });

  it("says 'unsafe-inline' or 'unsafe-eval'", () => {
    expect(() => withInlineScriptHashes(page("script-src 'self' 'unsafe-inline'"))).toThrow(
      /unsafe-inline/,
    );
    expect(() => withInlineScriptHashes(page("script-src 'self' 'unsafe-eval'"))).toThrow(
      /unsafe-eval/,
    );
  });

  it('has a script ahead of the policy, which the policy would not cover', () => {
    const html = `<html><head><script>go()</script>${page("script-src 'self'").slice(21)}`;
    expect(() => withInlineScriptHashes(html)).toThrow(/comes before the policy/);
  });

  it('has no script-src to add a hash to', () => {
    expect(() => withInlineScriptHashes(page("default-src 'self'"))).toThrow(/no script-src/);
  });

  it('has pushed the charset past the bytes it must be declared in', () => {
    const html = page(`script-src 'self'; img-src ${'https://a.example '.repeat(60)}`);
    expect(() => withInlineScriptHashes(html)).toThrow(/charset/);
  });
});
