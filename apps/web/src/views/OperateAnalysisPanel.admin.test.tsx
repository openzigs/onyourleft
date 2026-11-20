// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The same words as the app** (#2648, ADR 0069 D-7): the app's
 * `OperateAnalysisPanel` and the instance's admin AI backend page, drawn from
 * ONE fixture, say the same thing in every row — the Now lines, the three
 * switches, each model, the owner's own key, the queue's counts and each job
 * — and both say the rows pinned below, so a word changed in
 * `@onyourleft/operate-text` turns both comparisons with the pin red, not
 * neither.
 *
 * The admin page is drawn by the instance's own renderer
 * (`apps/instance/src/admin/pages.ts` §`analysisBody`), reached by a computed
 * path for `testing/operate-instance-testing.ts`'s reason; the shape it is
 * used through is written down here.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  scriptedOperate,
  SCRIPTED_ANALYSIS,
  SCRIPTED_JOBS,
  SCRIPTED_MODELS,
} from '../instance/testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { OperateAnalysisPanel } from './OperateAnalysisPanel';

/** `apps/instance` §`admin/pages.ts`, as far as it is used here. */
interface AdminPages {
  analysisBody(view: {
    readonly analysis: unknown;
    readonly models: unknown;
    readonly jobs: unknown;
    readonly strength: 'code' | 'passkey';
    readonly csrf: string;
    readonly notice: null;
  }): string;
}

const PAGES = join(dirname(fileURLToPath(import.meta.url)), '../../../instance/src/admin/pages.ts');

let pages: AdminPages;
beforeAll(async () => {
  pages = (await import(/* @vite-ignore */ PAGES)) as AdminPages;
});

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

/** A model saved in the app, the owner's key held, and other riders let in: every row has something in it. */
const ANALYSIS = {
  ...SCRIPTED_ANALYSIS,
  local: {
    ...SCRIPTED_ANALYSIS.local,
    model: 'alpha:14b',
    setIn: 'app',
    state: 'on',
    othersMayUse: true,
  },
  hosted: { offered: false, operatorKey: 'held', operatorKeyOrigin: 'https://models.example' },
} as const;

interface Rows {
  readonly headings: readonly string[];
  readonly now: readonly string[];
  readonly offers: readonly string[];
  readonly models: readonly string[];
  readonly ownKey: readonly string[];
  readonly counts: readonly string[];
  readonly jobs: readonly string[];
}

const squash = (text: string | null | undefined): string =>
  (text ?? '').replace(/\s+/g, ' ').trim();

const texts = (root: ParentNode, selector: string): string[] =>
  [...root.querySelectorAll(selector)].map((each) => squash(each.textContent));

/** The app's rows: its section's h3s, its lists, its switches' labels and its model radios'. */
async function appRows(): Promise<Rows> {
  const scripted = scriptedOperate({
    analysis: ANALYSIS,
    models: SCRIPTED_MODELS,
    jobs: SCRIPTED_JOBS,
  });
  mounted = await mount(<OperateAnalysisPanel timeZone="UTC" port={scripted.port} />);
  await settle();
  const root = mounted.container;
  const ownKey = [...root.querySelectorAll('h3')].find(
    (each) => each.textContent === 'Your own hosted key',
  );
  return {
    headings: texts(root, 'h3'),
    now: texts(root, '[data-oyl-ai-now] li'),
    offers: texts(root, '.oyl-operate__offers label span'),
    models: texts(root, '.oyl-operate__models li label'),
    ownKey:
      ownKey?.nextElementSibling === null || ownKey === undefined
        ? []
        : texts(ownKey.nextElementSibling, 'li'),
    counts: texts(root, '[data-oyl-ai-counts] li'),
    jobs: texts(root, '.oyl-operate__jobs li'),
  };
}

/** The admin page's rows, from the same fixture. */
function adminRows(strength: 'code' | 'passkey'): Rows {
  const html = pages.analysisBody({
    analysis: ANALYSIS,
    models: SCRIPTED_MODELS,
    jobs: SCRIPTED_JOBS,
    strength,
    csrf: 'a'.repeat(64),
    notice: null,
  });
  const doc = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  return {
    headings: texts(doc, 'h2').filter((heading) => heading !== 'Local server address'),
    now: texts(doc, 'ul.now li'),
    offers: texts(doc, 'ul.offers li strong'),
    models: texts(doc, strength === 'passkey' ? 'ul.models li label' : 'ul.models li'),
    ownKey: texts(doc, 'ul.own-key li'),
    counts: texts(doc, 'ul.counts li'),
    jobs: texts(doc, 'ol.jobs li'),
  };
}

/** What both must say, written out: the pin a change to the package's words breaks. */
const PINNED: Rows = {
  headings: [
    'What the instance offers riders',
    'Now',
    'Pick a local model',
    'Your own hosted key',
    'Jobs',
    'Return to .env',
  ],
  now: [
    'Local server: http://ollama:11434/v1 (set here)',
    'Model: alpha:14b',
    'On: write-ups can run on it.',
    'Ollama 0.12.6',
  ],
  offers: [
    'A model on this instance',
    'Riders other than you may use the model on this instance',
    'A hosted service, on each rider’s own key',
  ],
  models: [
    'alpha:14b: 14.8B, Q4_K_M, 9.0 GB, lists tool support, in GPU memory: all',
    'beta:32b: 32.8B, Q4_K_M, 19.9 GB, lists tool support, in GPU memory: part, 62 %',
    'gamma:26b: 25.8B, Q8_0, 17.0 GB, tool support not reported, in GPU memory: not known until loaded',
  ],
  ownKey: ['Your key is held for https://models.example, and this instance’s secret opens it.'],
  counts: [
    '1 waiting, 0 running',
    'Last seven days: 4 done, 1 failed, 0 withheld, 0 cancelled',
    'Failed model-without-tools: 1',
  ],
  jobs: [
    'Write-up, on this instance’s model, another rider’s: waiting, 2026-11-14 10:05 UTC',
    'Re-plan, on a hosted service, another rider’s: failed (model-without-tools), 2026-11-14 09:50 UTC',
    'Write-up, on this instance’s model, yours: done, 2026-11-14 09:00 UTC',
  ],
};

describe('the app’s AI backend panel and the admin AI backend page say the same thing (#2648)', () => {
  it.each(['passkey', 'code'] as const)(
    'draws the same rows from one fixture, in a %s session',
    async (strength) => {
      expect(adminRows(strength)).toEqual(await appRows());
    },
  );

  it('the app’s panel says the pinned rows', async () => {
    expect(await appRows()).toEqual(PINNED);
  });

  it('the admin page says the pinned rows', () => {
    expect(adminRows('passkey')).toEqual(PINNED);
  });

  it('says each switch’s state as the instance read it back', () => {
    const html = pages.analysisBody({
      analysis: ANALYSIS,
      models: SCRIPTED_MODELS,
      jobs: SCRIPTED_JOBS,
      strength: 'passkey',
      csrf: 'a'.repeat(64),
      notice: null,
    });
    const doc = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
    expect(texts(doc, 'ul.offers li > p')).toEqual([
      'A model on this instance: on.',
      'Riders other than you may use the model on this instance: on.',
      'A hosted service, on each rider’s own key: off.',
    ]);
  });
});
