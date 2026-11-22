// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The AI pacer's power on the HUD — #2864, the owner's ruling of 2026-11-20:
 * *"Show the pacer's power on the ride screen: its current watts and what it
 * is doing"*. Rendered by the HUD the game mounts and read back as a screen
 * reader hears it: one reading, its term then its watts and what the pacer is
 * doing, in the description list with every other reading, and the HUD audits
 * clean. Absent on a ride with no AI pacer.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  altitudeMetres,
  degreesLatitude,
  degreesLongitude,
  geographicPosition,
  routeProfile,
  type RoutePoint,
} from '@onyourleft/domain';

import { auditAccessibility, formatViolations } from '../../a11y/audit';
import { mount, type Mounted } from '../../testing/mount';
import { PACER_DOING_TEXT, type PacerDoing } from '../pacer-doing';
import { atStartLine } from '../simulation';
import { PACER_POWER_LABEL } from './fields';
import { HudPanel } from './HudPanel';

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
});

function route(): ReturnType<typeof routeProfile> {
  const points: RoutePoint[] = [];
  for (let index = 0; index <= 20; index += 1) {
    points.push({
      position: geographicPosition(
        degreesLatitude(51.5 + (index * 10) / 111_320),
        degreesLongitude(-0.12),
      ),
      elevation: altitudeMetres(10),
    });
  }
  return routeProfile(points);
}

async function hud(
  aiPacer:
    { readonly watts: number | undefined; readonly doing: PacerDoing | undefined } | undefined,
): Promise<void> {
  const profile = route();
  mounted = await mount(
    <main>
      <h1>Ride</h1>
      <HudPanel
        profile={profile}
        state={atStartLine(profile)}
        cadence={{ value: 88, live: true }}
        heartRate={{ value: 150, live: true }}
        onPause={() => undefined}
        onEnd={() => undefined}
        paused={false}
        announcement=""
        {...(aiPacer === undefined ? {} : { aiPacer })}
      />
    </main>,
  );
}

const text = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** The field labelled `label`, as a screen reader hears it: its term, then its definition. */
function field(label: string): string | undefined {
  const found = [...document.querySelectorAll('.oyl-hud__field')].find(
    (each) => text(each.querySelector('dt')) === label,
  );
  return found === undefined
    ? undefined
    : `${text(found.querySelector('dt'))} ${text(found.querySelector('dd'))}`;
}

describe('the AI pacer’s power on the HUD — #2864', () => {
  it('reads as one reading: its watts and what the pacer is doing, and audits clean', async () => {
    await hud({ watts: 184.6, doing: 'waiting' });
    expect(field(PACER_POWER_LABEL)).toBe(`Pacer power 185 W ${PACER_DOING_TEXT.waiting}`);
    // A term and its definition, inside the HUD's description list.
    const term = [...document.querySelectorAll('dt')].find(
      (each) => text(each) === PACER_POWER_LABEL,
    );
    expect(term?.closest('dl')).not.toBeNull();
    expect(term?.nextElementSibling?.tagName).toBe('DD');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('says the chase, the owner’s second example', async () => {
    await hud({ watts: 215, doing: 'chasing' });
    expect(field(PACER_POWER_LABEL)).toBe('Pacer power 215 W chasing');
    expect(formatViolations(auditAccessibility(document))).toBe('');
  });

  it('is absent on a ride with no AI pacer', async () => {
    await hud(undefined);
    expect(field(PACER_POWER_LABEL)).toBeUndefined();
  });
});
