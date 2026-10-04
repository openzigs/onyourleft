// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `shared-load.ts`'s failure screenshot — #1076, from #1075's review.
 *
 * A case that reads a shared page never touches Playwright's `page` fixture,
 * so the config's own failure screenshot shows nothing it read. These drive
 * the module with stand-ins for a browser, a page and a case's `TestInfo`, and
 * read back what was attached.
 */

import type { Browser, Page, TestInfo } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';

import { attachSharedPageOnFailure, releaseSharedPage, sharedPage } from './shared-load';

interface FakePage {
  shots: number;
  closed: boolean;
  drawable: boolean;
  /** A page whose screenshot never settles unless it is given a timeout. */
  hung: boolean;
  /** The timeout each screenshot was asked for. */
  timeouts: (number | undefined)[];
}

function fakeBrowser(pages: FakePage[]): Browser {
  return {
    newContext: () =>
      Promise.resolve({
        newPage: () => {
          const page: FakePage = {
            shots: 0,
            closed: false,
            drawable: true,
            hung: false,
            timeouts: [],
          };
          pages.push(page);
          return Promise.resolve({
            isClosed: () => page.closed,
            screenshot: (options?: { timeout?: number }) => {
              page.timeouts.push(options?.timeout);
              if (page.hung) {
                // Playwright rejects once a bounded screenshot runs out of
                // time, and waits on an unbounded one for as long as it hangs.
                return options?.timeout === undefined || options.timeout === 0
                  ? new Promise<Buffer>(() => undefined)
                  : Promise.reject(new Error(`Timeout ${String(options.timeout)}ms exceeded`));
              }
              if (!page.drawable) return Promise.reject(new Error('the target closed'));
              page.shots += 1;
              return Promise.resolve(Buffer.from(`shot ${String(page.shots)}`));
            },
          } as unknown as Page);
        },
        close: () => {
          for (const page of pages) page.closed = true;
          return Promise.resolve();
        },
      }),
  } as unknown as Browser;
}

interface Attached {
  readonly name: string;
  readonly contentType: string | undefined;
}

function fakeCase(
  testId: string,
  ended: { status: TestInfo['status']; expectedStatus: TestInfo['expectedStatus'] } = {
    status: 'passed',
    expectedStatus: 'passed',
  },
): Pick<TestInfo, 'testId' | 'status' | 'expectedStatus' | 'attach'> & { attached: Attached[] } {
  const attached: Attached[] = [];
  return {
    testId,
    ...ended,
    attached,
    attach: (name, options) => {
      attached.push({ name, contentType: options?.contentType });
      return Promise.resolve();
    },
  };
}

const RED = { status: 'failed', expectedStatus: 'passed' } as const;

afterEach(async () => {
  await releaseSharedPage();
});

describe('a shared page is screenshot when the case that read it fails — #1076', () => {
  it('attaches the page the failing case read', async () => {
    const pages: FakePage[] = [];
    const reader = fakeCase('case-1', RED);
    await sharedPage(fakeBrowser(pages), 'ride.html at 390×844', () => Promise.resolve(), reader);
    await attachSharedPageOnFailure(reader);
    expect(reader.attached).toEqual([
      { name: 'the shared page ride.html at 390×844', contentType: 'image/png' },
    ]);
    expect(pages[0]?.shots).toBe(1);
  });

  it('attaches nothing to a case that passed', async () => {
    const reader = fakeCase('case-1');
    await sharedPage(fakeBrowser([]), 'key', () => Promise.resolve(), reader);
    await attachSharedPageOnFailure(reader);
    expect(reader.attached).toEqual([]);
  });

  it('attaches nothing to a failing case that did not read the shared page', async () => {
    await sharedPage(fakeBrowser([]), 'key', () => Promise.resolve(), fakeCase('case-1'));
    const other = fakeCase('case-2', RED);
    await attachSharedPageOnFailure(other);
    expect(other.attached).toEqual([]);
  });

  it('attaches the page a load that threw left, and still throws', async () => {
    const reader = fakeCase('case-1');
    await expect(
      sharedPage(fakeBrowser([]), 'key', () => Promise.reject(new Error('no stage')), reader),
    ).rejects.toThrow('no stage');
    expect(reader.attached.map((each) => each.name)).toEqual([
      'the shared load of key, which threw',
    ]);
  });

  it('never replaces the failure with its own when the page cannot be drawn', async () => {
    const pages: FakePage[] = [];
    const reader = fakeCase('case-1', RED);
    await sharedPage(fakeBrowser(pages), 'key', () => Promise.resolve(), reader);
    for (const page of pages) page.drawable = false;
    await attachSharedPageOnFailure(reader);
    expect(reader.attached).toEqual([]);
  });

  it('bounds the screenshot, so a hung page cannot hold the hook — #1078', async () => {
    const pages: FakePage[] = [];
    const reader = fakeCase('case-1', RED);
    await sharedPage(fakeBrowser(pages), 'key', () => Promise.resolve(), reader);
    for (const page of pages) page.hung = true;
    await attachSharedPageOnFailure(reader);
    expect(reader.attached).toEqual([]);
    const asked = pages[0]?.timeouts ?? [];
    expect(asked).toHaveLength(1);
    expect(asked[0]).toBeGreaterThan(0);
    expect(asked[0]).toBeLessThanOrEqual(5_000);
  }, 2_000);
});
