// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo page's Content-Security-Policy: allows each inline script by its
 * hash, computed at build time — #1645.
 *
 * `demo/index.html` carries the policy as a `<meta http-equiv>`, so the page
 * itself refuses the network wherever it is served from: `connect-src 'self'`
 * refuses a `fetch` to any other origin, whatever the code asks for. The one
 * inline script on the page is `tools/theme/theme-selection-plugin.ts`'s, and
 * a policy with no `'unsafe-inline'` blocks it — so this plugin, which runs
 * after every other HTML transform, hashes each inline script and adds
 * `'sha256-…'` to `script-src`. A changed theme script gets a new hash in the
 * same build, with nothing to keep in step by hand.
 *
 * It fails the build, rather than writing a page that half works, when the
 * page has no policy, no `script-src`, a policy that says `'unsafe-inline'`
 * or `'unsafe-eval'`, or a `<script>` before the policy. A `<meta>` policy
 * covers only what comes after it, so a script before it would run unchecked.
 *
 * ⚠️ `frame-ancestors` cannot be set from a `<meta>` (the CSP spec ignores it
 * there); it is a response header the hosting site sets.
 */

import { createHash } from 'node:crypto';

import type { Plugin } from 'vite';

const POLICY = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/i;
/**
 * The HTML spec wants the charset declared within the first 1024 bytes, and
 * the policy sits ahead of it; this is checked before the
 * hashes are added, so this leaves room for them.
 */
const CHARSET_WITHIN = 768;
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;

/** The CSP source expression a browser compares an inline script's text against. */
export function scriptHash(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`;
}

/** `html` with every inline script's hash added to its policy's `script-src`. */
export function withInlineScriptHashes(html: string): string {
  const policy = POLICY.exec(html);
  if (policy === null) {
    throw new Error('oyl-demo-csp: the page has no <meta http-equiv="Content-Security-Policy">');
  }
  const content = policy[1] ?? '';
  if (/'unsafe-(?:inline|eval)'/.test(content)) {
    throw new Error(
      "oyl-demo-csp: the policy says 'unsafe-inline' or 'unsafe-eval'; an inline script is " +
        'allowed by its hash',
    );
  }
  const firstScript = html.search(/<script[\s>]/i);
  if (firstScript !== -1 && firstScript < policy.index) {
    throw new Error('oyl-demo-csp: a <script> comes before the policy, which does not cover it');
  }
  const directives = content.split(';').map((each) => each.trim());
  const at = directives.findIndex((each) => /^script-src(?:\s|$)/.test(each));
  if (at === -1) {
    throw new Error('oyl-demo-csp: the policy has no script-src to add the hashes to');
  }
  const charset = html.search(/<meta\s+charset=/i);
  if (charset === -1 || charset > CHARSET_WITHIN) {
    throw new Error(
      `oyl-demo-csp: the <meta charset> must start within the first ${String(CHARSET_WITHIN)} ` +
        'bytes, and the policy ahead of it has pushed it out',
    );
  }
  const hashes = [...html.matchAll(INLINE_SCRIPT)].map((match) => scriptHash(match[1] ?? ''));
  if (hashes.length === 0) return html;
  directives[at] = [directives[at], ...new Set(hashes)].join(' ');
  const rewritten = policy[0].replace(content, directives.filter(Boolean).join('; '));
  return html.slice(0, policy.index) + rewritten + html.slice(policy.index + policy[0].length);
}

/** The plugin: `order: 'post'`, after the theme script is written in. */
export function inlineScriptHashes(): Plugin {
  return {
    name: 'oyl-demo-csp',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => withInlineScriptHashes(html),
    },
  };
}
