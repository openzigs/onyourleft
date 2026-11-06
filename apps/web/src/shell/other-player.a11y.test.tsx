// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The rider's own music player's controls, in the accessibility gate — #2073.
 *
 * Named `*.a11y.test.tsx` because the filename is the gate
 * (docs/agents/accessibility.md §4e). No route renders the controls on its
 * own: they show only inside the Android shell once other audio was heard, so
 * `routes.a11y.test.tsx` never sees them. This mounts the whole `AppShell`
 * with them showing, for `camera/indicator.a11y.test.tsx`'s reason: the audit
 * is of a document, and the header is the shell's.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { auditAccessibility, formatViolations } from '../a11y/audit';
import type { CapabilityProbe } from '../support/bluetooth-support';
import { mount, settle, type Mounted } from '../testing/mount';

import { AppShell } from './AppShell';
import { OtherPlayer } from './other-player';
import { manualOtherPlayerClock, scriptedOtherPlayerPort } from './other-player-testing';
import { OTHER_PLAYER_GROUP_NAME } from './OtherPlayerControls';

const NO_BLUETOOTH: CapabilityProbe = { bluetooth: undefined, secureContext: true };

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

describe('the rider’s own music player’s controls', () => {
  it('pass the audit while showing, in the page they are rendered in', async () => {
    const player = new OtherPlayer(
      scriptedOtherPlayerPort(true).port,
      manualOtherPlayerClock().clock,
    );
    mounted = await mount(<AppShell capabilities={NO_BLUETOOTH} otherPlayer={player} />);
    await act(async () => {
      await player.poll();
    });
    await settle();
    const group = document.querySelector(`header [aria-label="${OTHER_PLAYER_GROUP_NAME}"]`);
    expect(group?.querySelectorAll('button')).toHaveLength(3);
    // The words are the names; the icons say nothing.
    for (const icon of group?.querySelectorAll('svg') ?? []) {
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
    const violations = auditAccessibility(document);
    expect(
      violations.length === 0 ? '' : formatViolations(violations),
      'the music player controls have accessibility violations',
    ).toBe('');
  });
});
