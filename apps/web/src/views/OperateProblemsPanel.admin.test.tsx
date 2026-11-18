// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * **The same words as the app** (#2651, ADR 0069 D-7): the app's
 * `OperateProblemsPanel` and the instance's admin Recent problems page,
 * drawn from ONE fixture, say the same sentence for every line and show the
 * same raw line under the same label — pinned below, so a sentence changed
 * in `@onyourleft/operate-text` turns both comparisons with the pin red.
 *
 * The admin page is drawn by the instance's own renderer
 * (`apps/instance/src/admin/pages.ts` §`problemsBody`), reached by a
 * computed path for `testing/operate-instance-testing.ts`'s reason.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { SCRIPTED_PROBLEMS, scriptedOperate } from '../instance/testing';
import { mount, settle, type Mounted } from '../testing/mount';
import { OperateProblemsPanel } from './OperateProblemsPanel';

/** `apps/instance` §`admin/pages.ts`, as far as it is used here. */
interface AdminPages {
  problemsBody(view: {
    readonly problems:
      | { readonly since: string; readonly lines: readonly { at: string; line: string }[] }
      | undefined;
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

const squash = (text: string | null | undefined): string =>
  (text ?? '').replace(/\s+/g, ' ').trim();

/** Each item's line, its disclosure's label and its raw line. */
function said(items: Iterable<Element>): (readonly [string, string, string])[] {
  return [...items].map((item) => {
    const copy = item.cloneNode(true) as HTMLElement;
    const details = copy.querySelector('details');
    details?.remove();
    return [
      squash(copy.textContent),
      squash(details?.querySelector('summary')?.textContent),
      squash(details?.querySelector('code')?.textContent),
    ] as const;
  });
}

describe('the app’s Recent problems panel and the admin page say the same thing (#2651)', () => {
  it('draws the same sentence and raw line for every problem, from one fixture', async () => {
    const scripted = scriptedOperate();
    mounted = await mount(<OperateProblemsPanel port={scripted.port} />);
    await settle();
    const app = said(mounted.container.querySelectorAll('.oyl-operate__problems > li'));
    const read = await scripted.port.problems();
    if (read.kind !== 'problems') throw new Error('the scripted port read no problems');
    const html = pages.problemsBody({
      problems: {
        since: read.since,
        lines: SCRIPTED_PROBLEMS.map(({ at, line }) => ({ at, line })),
      },
    });
    const doc = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
    // Since #2771 a problem is a table row: its When column, then its sentence
    // and the disclosure, joined with the ": " the table took away.
    const admin = [...doc.querySelectorAll<HTMLTableRowElement>('table tbody tr')].map((row) => {
      const [line, label, raw] = said([row.cells[1]!])[0]!;
      return [`${squash(row.cells[0]?.textContent)}: ${line}`, label, raw] as const;
    });
    expect(admin).toEqual(app);
    expect(admin[0]?.[0]).toBe(
      '2026-11-14 20:45 UTC: A request to /v1/rooms/{roomId}/route was answered 503.',
    );
    expect(admin.map(([, label]) => label)).toEqual(
      SCRIPTED_PROBLEMS.map(() => 'The line as logged'),
    );
    expect(admin.map(([, , line]) => line)).toEqual(SCRIPTED_PROBLEMS.map((each) => each.line));
  });
});
