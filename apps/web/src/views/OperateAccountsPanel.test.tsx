// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The Operate area's Accounts (#2605) over a scripted status: the counts, the
 * registration mode in words for every mode the instance accepts, the steps to
 * change it, and links — never a control of its own — to the Moderation
 * screen's sections. Over the real instance, and the landing on the Moderation
 * screen, in `OperateView.test.tsx`.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { SECTION_LINE_CHARACTERS } from '../a11y/section-lines';
import type { OperateStatus } from '../instance/operate-port';
import { SCRIPTED_STATUS } from '../instance/testing';
import { hrefFor, hrefForModerationSection, routeById } from '../shell/routes';
import { mount, type Mounted } from '../testing/mount';
import {
  ACCOUNTS_LINE,
  ACCOUNTS_PURPOSE,
  ACCOUNTS_UNREADABLE_TEXT,
  MODERATORS_ALWAYS_JOIN,
  OperateAccountsPanel,
  REGISTRATION_MODE_TEXT,
  type RegistrationMode,
} from './OperateAccountsPanel';

/** `apps/instance`'s config, by a computed path: `testing/operate-instance-testing.ts` says why. */
const INSTANCE_CONFIG = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../instance/src/config.ts',
);

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

async function show(status: OperateStatus | { kind: 'unreachable' }): Promise<void> {
  mounted = await mount(<OperateAccountsPanel status={status} />);
}

function text(): string {
  return (mounted?.container.textContent ?? '').replace(/\s+/g, ' ');
}

function links(): { readonly name: string; readonly href: string | null }[] {
  return [...(mounted?.container.querySelectorAll('a') ?? [])].map((each) => ({
    name: each.textContent,
    href: each.getAttribute('href'),
  }));
}

describe('the Accounts section — #2605', () => {
  it('counts the accounts awaiting approval and suspended, each with its link to Moderation', async () => {
    await show({
      ...SCRIPTED_STATUS,
      counts: { ...SCRIPTED_STATUS.counts, athletes: { active: 4, pending: 2, suspended: 1 } },
    });
    expect(text()).toContain(ACCOUNTS_LINE);
    expect(text()).toContain(ACCOUNTS_PURPOSE);
    expect(text()).toContain('2 awaiting approval');
    expect(text()).toContain('1 suspended');
    expect(links()).toEqual([
      { name: 'Go to approvals', href: '#/settings/instance/moderation?section=approvals' },
      { name: 'Go to suspended accounts', href: hrefForModerationSection('suspended') },
    ]);
  });

  it('has no control of its own: no button, no field, and every link opens the Moderation screen', async () => {
    for (const registration of ['approval', 'invite'] as const) {
      await show({ ...SCRIPTED_STATUS, registration });
      const section = mounted?.container.querySelector('section');
      expect(section?.querySelectorAll('button, input, select, textarea, form')).toHaveLength(0);
      for (const link of links()) {
        expect(link.href?.startsWith(hrefFor(routeById('moderation')))).toBe(true);
      }
      mounted?.unmount();
    }
  });

  it('links to the invitation only when the instance takes riders by invitation', async () => {
    await show({ ...SCRIPTED_STATUS, registration: 'invite' });
    expect(links().map((each) => each.name)).toContain('Go to invitations');
    expect(links().find((each) => each.name === 'Go to invitations')?.href).toBe(
      hrefForModerationSection('invite'),
    );
    for (const registration of ['approval', 'open', 'closed'] as const) {
      mounted?.unmount();
      await show({ ...SCRIPTED_STATUS, registration });
      expect(links().map((each) => each.name)).not.toContain('Go to invitations');
    }
  });

  it('has a sentence for every mode the instance’s config accepts, and nothing more', async () => {
    const { REGISTRATION_MODES } = (await import(/* @vite-ignore */ INSTANCE_CONFIG)) as {
      REGISTRATION_MODES: readonly string[];
    };
    expect(Object.keys(REGISTRATION_MODE_TEXT).sort()).toEqual([...REGISTRATION_MODES].sort());
    for (const mode of REGISTRATION_MODES as readonly RegistrationMode[]) {
      mounted?.unmount();
      await show({ ...SCRIPTED_STATUS, registration: mode });
      expect(mounted?.container.querySelector('h3')?.textContent).toBe(
        `Registration mode: ${mode}`,
      );
      const meaning = REGISTRATION_MODE_TEXT[mode].meaning;
      expect(meaning).not.toBe('');
      // One short line, as every section keeps (#1013).
      expect(meaning.length).toBeLessThanOrEqual(SECTION_LINE_CHARACTERS);
      expect(text()).toContain(meaning);
      expect(text()).toContain(MODERATORS_ALWAYS_JOIN);
    }
  });

  it('gives the steps to change the mode on the host, naming every mode', async () => {
    await show(SCRIPTED_STATUS);
    const steps = [...(mounted?.container.querySelectorAll('ol > li') ?? [])].map((each) =>
      (each.textContent ?? '').replace(/\s+/g, ' '),
    );
    expect(steps).toEqual([
      'Open the .env file beside compose.yaml.',
      'Set OYL_INSTANCE_REGISTRATION to approval, invite, open or closed.',
      'In that folder, run docker compose up -d instance, which starts the instance again with ' +
        'the new mode. docker compose restart does not read .env again.',
    ]);
  });

  it('says the counts could not be read, and still links to the Moderation screen', async () => {
    await show({ kind: 'unreachable' });
    expect(text()).toContain(ACCOUNTS_UNREADABLE_TEXT);
    expect(text()).not.toContain('awaiting approval');
    expect(links()).toEqual([
      { name: 'Go to the Moderation screen', href: '#/settings/instance/moderation' },
    ]);
  });
});
