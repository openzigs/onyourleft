// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The terms of service an instance publishes (#909): the operator's own file,
 * served at `/terms` with the date it took effect, linked from the legal page,
 * and named in `GET /instance` so a rider's app can tell them when it changes.
 */

import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { readConfig } from './config.ts';
import { startTestInstance, type TestInstance } from './instance-testing.ts';
import { readTermsSettings, renderTerms, TERMS_MARKER, type TermsSettings } from './terms.ts';

const COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';

let instance: TestInstance | undefined;
afterEach(async () => {
  await instance?.listening.close();
  instance = undefined;
});

async function serve(terms: TermsSettings | null): Promise<string> {
  instance = await startTestInstance({ config: { terms, name: 'Club' } });
  return instance.url;
}

const TERMS: TermsSettings = {
  version: '2026-11-01',
  text: '# Terms of service\n\nRide **kindly**.\n\n## 1. Rules\n\n- No <script>abuse</script>\n- Be fair\n',
};

describe('the terms page (#909)', () => {
  it('serves the operator’s terms with the date they took effect, escaped, with no script', async () => {
    const url = await serve(TERMS);
    const response = await fetch(`${url}/terms`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain(
      '<h1>Terms of service</h1>\n<p><strong>In force since 2026-11-01.</strong></p>',
    );
    expect(html).toContain('<p>Ride <strong>kindly</strong>.</p>');
    expect(html).toContain('<h2>1. Rules</h2>');
    expect(html).toContain('<li>No &lt;script&gt;abuse&lt;/script&gt;</li>');
    expect(html).not.toContain('<script');
  });

  it('says plainly when the instance publishes none — never the project’s as a default', async () => {
    const url = await serve(null);
    const html = await (await fetch(`${url}/terms`)).text();
    expect(html).toContain('This instance has published no terms of service.');
    expect(html).not.toContain('In force since');
  });

  it('is named in GET /instance by its date, and linked from the legal page, only when published', async () => {
    const withTerms = await serve(TERMS);
    expect(await (await fetch(`${withTerms}/instance`)).json()).toEqual({
      name: 'Club',
      termsVersion: '2026-11-01',
    });
    expect(await (await fetch(`${withTerms}/legal`)).text()).toContain(
      '<a href="/terms">Terms of service</a>',
    );
    await instance?.listening.close();
    const without = await serve(null);
    expect(await (await fetch(`${without}/instance`)).json()).toEqual({
      name: 'Club',
      termsVersion: null,
    });
    expect(await (await fetch(`${without}/legal`)).text()).toContain(
      'This instance has published no terms of service.',
    );
  });
});

describe('the terms settings (#909)', () => {
  it('publishes only what follows the marker, so the notes for the owner above it are not', () => {
    const problems: string[] = [];
    const settings = readTermsSettings(
      {
        termsText: `# Draft\nNotes for the owner.\n${TERMS_MARKER}\n# Terms\nRide.`,
        termsVersion: '2026-11-01',
      },
      problems,
    );
    expect(problems).toEqual([]);
    expect(settings).toEqual({ text: '# Terms\nRide.', version: '2026-11-01' });
  });

  it('publishes nothing when neither is set, and refuses to start on half of it, a bad date, a file it cannot read, or a control character', () => {
    expect(readConfig({ commit: COMMIT }).ok && readConfig({ commit: COMMIT })).toMatchObject({
      config: { terms: null },
    });
    for (const [raw, problem] of [
      [{ termsText: '# Terms' }, 'together'],
      [{ termsVersion: '2026-11-01' }, 'together'],
      [{ termsText: '# Terms', termsVersion: '1 November' }, 'YYYY-MM-DD'],
      [{ termsText: '# Terms', termsVersion: '2026-13-01' }, 'YYYY-MM-DD'],
      [{ termsFileUnreadable: true }, 'could not be read'],
      [{ termsText: 'Ride\u0007.', termsVersion: '2026-11-01' }, 'control character'],
      [{ termsText: `${TERMS_MARKER}\n  `, termsVersion: '2026-11-01' }, 'at most'],
    ] as const) {
      const result = readConfig({ commit: COMMIT, ...raw });
      expect(result.ok, JSON.stringify(raw)).toBe(false);
      expect(result.ok ? '' : result.problems.join(' ')).toContain(problem);
    }
  });

  it('renders the project’s own draft — everything below the marker — as the page will show it', () => {
    const draft = readFileSync(
      new URL('../../../docs/moderation/terms-of-service.md', import.meta.url),
      'utf8',
    );
    const problems: string[] = [];
    const settings = readTermsSettings({ termsText: draft, termsVersion: '2026-11-01' }, problems);
    expect(problems).toEqual([]);
    const html = renderTerms(settings?.text ?? '');
    expect(html.startsWith('<h1>Terms of service</h1>')).toBe(true);
    expect(html).toContain('<h2>2. Who can use it</h2>');
    expect(html).toContain('<strong>Public rooms are for people aged 18 or over.</strong>');
    expect(html).not.toContain('A draft, pending the owner');
    expect(html).not.toContain('#909');
    // A placeholder must never be published, and a waiting account can still export and erase.
    expect(html).not.toContain('Not settled yet');
    expect(html).not.toContain('and nothing else');
  });
});

describe('the rendering (#909)', () => {
  it('turns numbered lists, indented continuations and code into markup, and nothing else', () => {
    expect(renderTerms('1. One\n2. Two\n   continued\n\nUse `/report`.')).toBe(
      '<ol><li>One</li><li>Two continued</li></ol>\n<p>Use <code>/report</code>.</p>',
    );
    expect(renderTerms('[a link](https://example.com) <b>x</b>')).toBe(
      '<p>[a link](https://example.com) &lt;b&gt;x&lt;/b&gt;</p>',
    );
  });
});
