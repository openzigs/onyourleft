// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The one place a missing mass is substituted, and the one place a typed one
 * becomes a kilogram (#325).
 *
 * The cases that matter are the two that a screen test cannot reach:
 *
 * - **"assumed" is carried, not inferred.** A caller that could not tell a
 *   default from a measurement would present a guess in the same typeface as a
 *   number the rider entered, which `analysis/thresholds.ts` records as the
 *   reason its own `assumed` flag exists.
 * - **The pound conversion happens once and in one direction.** The store's
 *   unit is a kilogram; a conversion applied twice, or not at all, produces a
 *   weight that is plausible and wrong, and the physics would ride it without
 *   complaint.
 */

import { kilograms, KILOGRAMS_PER_POUND } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RIDER_MASS_KILOGRAMS,
  MASS_REFUSAL,
  MAXIMUM_MASS_KILOGRAMS,
  MINIMUM_MASS_KILOGRAMS,
  massToSave,
  riderMassFor,
} from './mass';

describe('riderMassFor', () => {
  it('substitutes the documented default when the rider has never said', () => {
    expect(riderMassFor(undefined)).toEqual({
      mass: DEFAULT_RIDER_MASS_KILOGRAMS,
      assumed: true,
    });
  });

  it('uses what the rider entered, to the gram', () => {
    // ⚠️ The gram matters: a rider who typed 154 lb has 69.853 kg on the row,
    // and a substitution that rounded on its way past would be a change to
    // every gradient they ride with nothing saying so.
    const entered = kilograms(154 * KILOGRAMS_PER_POUND);

    expect(riderMassFor(entered)).toEqual({ mass: entered, assumed: false });
  });

  it('marks a rider who happens to weigh the default as having said so', () => {
    // ⚠️ The case a `mass === DEFAULT` check would get wrong. `assumed` is
    // about whether anybody answered, not about the number — and telling a
    // rider their entered weight is assumed teaches them to ignore the notice
    // on the rides where it really is.
    expect(riderMassFor(kilograms(DEFAULT_RIDER_MASS_KILOGRAMS)).assumed).toBe(false);
  });
});

describe('massToSave, in kilograms', () => {
  it('saves what was typed', () => {
    expect(massToSave('62.4', 'metric')).toEqual({ kind: 'save', mass: 62.4 });
  });

  it('treats a blank box as a clear, which is the only way back to the default', () => {
    expect(massToSave('', 'metric')).toEqual({ kind: 'save', mass: undefined });
    expect(massToSave('   ', 'metric')).toEqual({ kind: 'save', mass: undefined });
  });

  it('refuses what is not a number', () => {
    expect(massToSave('heavy', 'metric')).toEqual({ kind: 'refused', reason: MASS_REFUSAL });
    expect(massToSave('-70', 'metric').kind).toBe('refused');
    expect(massToSave('0', 'metric').kind).toBe('refused');
  });

  it('refuses a slipped decimal point in either direction', () => {
    // 6.5 for 65 and 800 for 80 are both numbers the physics would accept and
    // ride absurdly, which is what the bounds are for — `kilograms()` alone
    // refuses neither.
    expect(massToSave('6.5', 'metric').kind).toBe('refused');
    expect(massToSave('800', 'metric').kind).toBe('refused');
  });

  it('accepts the ends of the range', () => {
    expect(massToSave(String(MINIMUM_MASS_KILOGRAMS), 'metric').kind).toBe('save');
    expect(massToSave(String(MAXIMUM_MASS_KILOGRAMS), 'metric').kind).toBe('save');
  });
});

describe('massToSave, in pounds', () => {
  it('stores kilograms, whatever the rider typed in', () => {
    // ⚠️ The assertion this module exists for. 154 lb is 69.853 kg; a version
    // that stored 154 would be a 120 % error, and a version that multiplied
    // instead of dividing would store 339, which the bounds would refuse — so
    // the refusal is *not* what proves this, the value is.
    const decision = massToSave('154', 'imperial');

    expect(decision.kind).toBe('save');
    expect(decision.kind === 'save' ? decision.mass : undefined).toBeCloseTo(69.853, 3);
  });

  it('converts, rather than relabelling', () => {
    const metric = massToSave('70', 'metric');
    const imperial = massToSave('70', 'imperial');

    expect(metric.kind === 'save' ? metric.mass : undefined).not.toBe(
      imperial.kind === 'save' ? imperial.mass : undefined,
    );
  });

  it('applies the bounds after the conversion, not before', () => {
    // ⚠️ 154 lb is inside the range and 154 kg is too, so a bound checked
    // before the conversion would agree here and the case would prove nothing.
    // 25 lb is 11.3 kg — inside the range as a *number* and outside it as a
    // mass — and 600 lb is 272 kg, which is the mirror: outside as a number,
    // inside as a mass.
    expect(massToSave('25', 'imperial').kind).toBe('refused');
    expect(massToSave('600', 'imperial').kind).toBe('save');
  });

  it('does not convert a blank into a zero', () => {
    expect(massToSave('', 'imperial')).toEqual({ kind: 'save', mass: undefined });
  });
});

describe('what the refusal says', () => {
  it('names both ranges, because a rider reading in pounds cannot act on kilograms', () => {
    expect(MASS_REFUSAL).toContain(String(MINIMUM_MASS_KILOGRAMS));
    expect(MASS_REFUSAL).toContain(String(MAXIMUM_MASS_KILOGRAMS));
    expect(MASS_REFUSAL).toContain('pounds');
    expect(MASS_REFUSAL).toContain('blank');
  });
});
