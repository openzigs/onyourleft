// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2644 (ADR 0069 D-7): the Status panel draws `@onyourleft/operate-text`'s
 * rows and nothing of its own. Every term and value on screen is read back
 * and held to {@link statusRows} over the same answer, so the app and the
 * instance's admin Status page (#2645), which draws the same rows, say the
 * same thing — and a row the panel dropped, reordered, or drew without its
 * code or its warning is red here.
 */

import { statusRows } from '@onyourleft/operate-text';
import { afterEach, describe, expect, it } from 'vitest';

import type { OperateStatus } from '../instance/operate-port';
import { SCRIPTED_STATUS } from '../instance/testing';
import { mount, type Mounted } from '../testing/mount';
import { OperateStatusPanel } from './OperateStatusPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

const NOW = Date.parse('2026-11-14T21:00:00.000Z');

/** Thirteen hours old on a six-hour interval: a row with a warning beside the low disk's. */
const STATUS: OperateStatus = {
  ...SCRIPTED_STATUS,
  lastBackup: { at: '2026-11-14T08:00:00.000Z', offBox: 'copied', intervalSeconds: 6 * 3600 },
};

const squash = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ');

/** One fact as drawn: its term, its value without the warning, its code, and its warning. */
function drawn(fact: Element) {
  const value = fact.querySelector('dd')?.cloneNode(true) as HTMLElement | undefined;
  // A warning is a `StatusMessage`: the element its glyph is in.
  const message = value?.querySelector('.oyl-status__glyph')?.parentElement ?? null;
  message?.remove();
  message?.querySelector('.oyl-status__glyph')?.remove();
  const label = message?.querySelector('.oyl-status__label')?.textContent ?? '';
  return {
    label: fact.querySelector('dt')?.textContent,
    value: squash(value?.textContent),
    code: value?.querySelector(':scope > code')?.textContent ?? null,
    warning:
      message === null
        ? null
        : {
            label: label.replace(/: $/, ''),
            text: squash(message.textContent).trim().slice(label.length),
          },
  };
}

describe('the Status panel draws operate-text’s rows — #2644', () => {
  it('shows every row, in order, with its value, its code and its warning', async () => {
    mounted = await mount(<OperateStatusPanel timeZone="UTC" status={STATUS} now={() => NOW} />);
    const shown = [...mounted.container.querySelectorAll('dl.oyl-operate__status > div')].map(
      drawn,
    );
    const rows = statusRows(STATUS, NOW, 'UTC');
    expect(rows.some((row) => row.code)).toBe(true);
    expect(rows.filter((row) => row.warning !== null).length).toBe(2);
    expect(shown).toEqual(
      rows.map((row) => ({
        label: row.label,
        value: row.value,
        code: row.code ? row.value : null,
        warning: row.warning,
      })),
    );
  });
});
