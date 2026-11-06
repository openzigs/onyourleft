// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The rider's kit palette — #623's second half, in the STYLISED world and in
 * the arithmetic every world shares. The realistic half of the same measure is
 * `realistic-textures.test.ts` §"#623 — every palette entry", which needs the
 * committed world loaded.
 *
 * What is held for EVERY entry, because a palette is only as safe as its worst
 * colour and a new entry must not need a new test:
 *
 * - it is bounded by the light, like every other lit colour (`LIT_COLOURS`);
 * - its limb is darker than its jersey, so the pedalling reads (#349);
 * - drawn through the real `RiderBelt`, the rider in it is told from the
 *   pacer and the ghost by #368's measure (`kit-palette-testing.ts`), each of
 *   the three held to its OWN hue in both directions;
 * - and a jersey equal to the bot's tint fails that measure — the control;
 * - its jersey is held 40 degrees of hue from every other entry's jersey, so
 *   no two choices are near-duplicates (#2123). Since #2255 no pair is short
 *   of it, so {@link SHORT_PAIRS} is empty.
 */

import { KIT_COLOURS, parseKitColour } from '@onyourleft/store';
import { describe, expect, it } from 'vitest';

import {
  BICYCLE_COLOURS,
  HOUSE_KIT,
  KIT_PALETTE,
  PACER_KIT,
  riderKitFor,
  type RiderKit,
} from './bicycle';
import {
  albedoBytes,
  hueApart,
  linearOf,
  TOLD_APART,
  toldApartFaults,
  toldApartFigures,
  type Bytes,
  type ThreeJerseys,
} from './kit-palette-testing';
import type { RiderMarker } from './port';
import { MAXIMUM_LIT_CHANNEL } from './scenery-palette';
import { qualitySettings } from './quality';
import { LIT_COLOURS, RiderBelt, riderKitsOf, threeGameRenderer } from './three-renderer';

/**
 * The pairs of entries whose jerseys are closer than
 * `TOLD_APART.HUE_APART_DEGREES`, each named with its gap and the issue that
 * owns it. ⚠️ **Not a place to put a new entry that fails**: the test below
 * also fails a pair listed here that is no longer short, so the list can only
 * shrink. The house kit is in no pair, which is #2123's ruling: it is its own
 * colour.
 */
const SHORT_PAIRS: ReadonlySet<string> = new Set<string>([
  // Empty since #2255. Green and Lime were 31.0 apart; the owner ruled on
  // 2026-11-06 (#2123) to move the Lime kit to a yellow-green. It shipped at
  // hue 78, not 60; bicycle.ts §KIT_PALETTE says why 60 was rejected.
]);

/** A colour's three 8-bit channels, from `0xrrggbb`. */
function bytesOf(hex: number): Bytes {
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
}

/** WCAG's relative luminance, from the linear channels. */
function luminance(hex: number): number {
  const [r, g, b] = linearOf(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function marker(kind: RiderMarker['kind'], z: number): RiderMarker {
  return {
    kind,
    x: 0,
    y: 0,
    z,
    headingX: 0,
    headingZ: 1,
    lean: 0,
    bodyLean: 0,
    pedalling: 0,
    rideSeconds: 0,
    crankAngle: 0,
  };
}

/**
 * The three jerseys as the stylised belt draws them, the rider in `kit`: each
 * instance's jersey (the `oylKitJersey` attribute, linear) times its tint (the
 * instance colour, linear) — what `withKitPerInstance`'s splice puts in
 * `vColor` for a jersey vertex.
 */
function stylisedJerseys(kit: RiderKit): ThreeJerseys {
  const belt = new RiderBelt();
  try {
    belt.setRiderKit(kit);
    belt.place([marker('rider', 0), marker('bot', 40), marker('ghost', 80)]);
    const torsos = belt.meshes.torsos;
    const jersey = torsos.geometry.getAttribute('oylKitJersey');
    const tints = torsos.instanceColor?.array ?? [];
    const at = (slot: number) =>
      albedoBytes(
        [jersey.getX(slot), jersey.getY(slot), jersey.getZ(slot)],
        [tints[slot * 3] ?? 0, tints[slot * 3 + 1] ?? 0, tints[slot * 3 + 2] ?? 0],
      );
    // The belt puts the shadow casters first (#547); the ghost casts none, so
    // the order the frame carried is the slot order.
    return { rider: at(0), bot: at(1), ghost: at(2), chosen: kit.jersey };
  } finally {
    belt.dispose();
  }
}

describe('the kit palette — #623', () => {
  it('is fixed, named, at most eight, the house kit first, and a key for every entry', () => {
    expect(KIT_COLOURS.length).toBeLessThanOrEqual(8);
    expect(Object.keys(KIT_PALETTE)).toEqual([...KIT_COLOURS]);
    expect(KIT_PALETTE.house.kit).toBe(HOUSE_KIT);
    expect(HOUSE_KIT.jersey).toBe(0x0b5c55);
    for (const key of KIT_COLOURS) expect(KIT_PALETTE[key].name.length, key).toBeGreaterThan(2);
    expect(new Set(Object.values(KIT_PALETTE).map((entry) => entry.name)).size).toBe(
      KIT_COLOURS.length,
    );
    expect(new Set(Object.values(KIT_PALETTE).map((entry) => entry.kit.jersey)).size).toBe(
      KIT_COLOURS.length,
    );
  });

  it('reads an absent choice, and anything off the palette, as the house kit and nothing else', () => {
    expect(riderKitFor(undefined)).toBe(HOUSE_KIT);
    for (const stranger of ['chartreuse', 'HOUSE', 'toString', 'constructor', '#ad1457', 3, null]) {
      expect(riderKitFor(stranger), String(stranger)).toBe(HOUSE_KIT);
    }
    for (const key of KIT_COLOURS) expect(riderKitFor(key)).toBe(KIT_PALETTE[key].kit);
    // Non-vacuity: a non-default key really is another kit.
    expect(riderKitFor('magenta')).not.toBe(HOUSE_KIT);
  });

  it('dresses a rider who saved Lime before #2255 in the yellow-green, under the same key', () => {
    // The key a row already holds still decodes, and now names the moved kit.
    const saved = parseKitColour('lime');
    expect(saved).toBe('lime');
    expect(KIT_PALETTE[saved].name).toBe('Yellow-green');
    expect(riderKitFor(saved)).toBe(KIT_PALETTE.lime.kit);
  });

  it('holds every entry under the light and in the list that bounds it', () => {
    for (const key of KIT_COLOURS) {
      const { jersey, limb } = KIT_PALETTE[key].kit;
      for (const colour of [jersey, limb]) {
        expect(Math.max(...linearOf(colour)), `${key} ${colour.toString(16)}`).toBeLessThan(
          MAXIMUM_LIT_CHANNEL,
        );
        expect(BICYCLE_COLOURS, key).toContain(colour);
        expect(LIT_COLOURS, key).toContain(colour);
      }
    }
  });

  it('keeps every entry’s limb darker than its jersey, so the pedalling reads', () => {
    for (const key of KIT_COLOURS) {
      const { jersey, limb } = KIT_PALETTE[key].kit;
      expect(luminance(limb), key).toBeLessThan(luminance(jersey));
    }
  });

  it('holds every entry’s jersey 40 degrees of hue from every other entry’s — #2123', () => {
    // The owner's ruling of 2026-11-05: the house kit stays teal, its own
    // colour, and is not the page's Hi-Vis accent, an olive that sat 13
    // degrees from the Lime kit as #2123 found it. So no entry may sit beside
    // another, the house kit included.
    const short: string[] = [];
    for (const [i, a] of KIT_COLOURS.entries()) {
      for (const b of KIT_COLOURS.slice(i + 1)) {
        const degrees = hueApart(
          bytesOf(KIT_PALETTE[a].kit.jersey),
          bytesOf(KIT_PALETTE[b].kit.jersey),
        );
        console.log(`#2123 ${a}–${b}: ${degrees.toFixed(1)} of hue apart`);
        if (!(degrees >= TOLD_APART.HUE_APART_DEGREES)) short.push(`${a}–${b}`);
      }
    }
    expect(short.filter((pair) => pair.includes('house'))).toEqual([]);
    // Both ways: no new pair is short, and no listed pair has stopped being.
    expect(new Set(short)).toEqual(SHORT_PAIRS);
  });

  it('tells the rider in every entry from the pacer and the ghost, each in its own hue — the stylised belt', () => {
    for (const key of KIT_COLOURS) {
      const jerseys = stylisedJerseys(KIT_PALETTE[key].kit);
      console.log(`#623 stylised, ${key}: ${toldApartFigures(jerseys)}`);
      expect(toldApartFaults(jerseys), key).toEqual([]);
    }
  });

  it('THE CONTROL: a jersey in the bot’s own tint is not told apart from the bot', () => {
    // `0xc2410c` is `three-renderer.ts` §`RIDER_TINTS`' bot. It is 161 bytes
    // from the bot's drawn jersey, so the byte measure alone would pass it;
    // the hue measure is what fails it.
    const jerseys = stylisedJerseys({ jersey: 0xc2410c, limb: 0x8a2e08 });
    console.log(`#623 stylised, the control: ${toldApartFigures(jerseys)}`);
    const faults = toldApartFaults(jerseys);
    expect(
      faults.some((fault) => fault.includes('of hue from the bot')),
      faults.join('; '),
    ).toBe(true);
  });

  it('dresses only the rider: the pacer and the ghost keep the pacer’s kit whatever the choice', () => {
    const belt = new RiderBelt();
    try {
      belt.setRiderKit(KIT_PALETTE.magenta.kit);
      belt.place([marker('rider', 0), marker('bot', 40), marker('ghost', 80)]);
      const jersey = belt.meshes.torsos.geometry.getAttribute('oylKitJersey');
      const limbs = belt.meshes.torsos.geometry.getAttribute('oylKitLimb');
      const expectAt = (slot: number, hex: number, channels = jersey): void => {
        linearOf(hex).forEach((value, channel) => {
          const read = [channels.getX(slot), channels.getY(slot), channels.getZ(slot)][channel];
          expect(read).toBeCloseTo(value, 5);
        });
      };
      expectAt(0, KIT_PALETTE.magenta.kit.jersey);
      expectAt(0, KIT_PALETTE.magenta.kit.limb, limbs);
      expectAt(1, PACER_KIT.jersey);
      expectAt(2, PACER_KIT.jersey);
      // And back: the house kit is a choice like any other.
      belt.setRiderKit(HOUSE_KIT);
      belt.place([marker('rider', 0), marker('bot', 40), marker('ghost', 80)]);
      expectAt(0, HOUSE_KIT.jersey);
    } finally {
      belt.dispose();
    }
  });

  it('a view hands the choice to its riders, and draws anything off the palette as the house kit', () => {
    // `ThreeGameView.setRiderKit`, through the renderer the product ships. No
    // realistic world loads in jsdom, so what is held here is the stylised
    // belt and the kit the view keeps for a realistic world that arrives later
    // (`RealisticDrawing`'s required `riderKit`); the browser gate reads the
    // realistic rider's back.
    const view = threeGameRenderer.create(document.createElement('canvas'), qualitySettings(0));
    try {
      expect(riderKitsOf(view)?.stylised).toBe(HOUSE_KIT);
      view.setRiderKit('purple');
      expect(riderKitsOf(view)).toEqual({
        held: KIT_PALETTE.purple.kit,
        stylised: KIT_PALETTE.purple.kit,
      });
      view.setRiderKit(undefined);
      expect(riderKitsOf(view)?.stylised).toBe(HOUSE_KIT);
      view.setRiderKit('#ff0000' as never);
      expect(riderKitsOf(view)).toEqual({ held: HOUSE_KIT, stylised: HOUSE_KIT });
    } finally {
      view.destroy();
    }
  });
});
