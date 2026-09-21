// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The riders' contact shadows — #426. Where each goes, who casts one, and that
 * the belt draws exactly that, in one mesh.
 *
 * What this cannot say is that a blob reaches the drawing buffer over an unlit
 * road — its depth handling is a property of a real rasteriser.
 * `browser/game.browser.spec.ts` §"draws each of the three in its own colour"
 * reads it back, with the shadows off as its control.
 */

import { describe, expect, it } from 'vitest';

import { BICYCLE_FRONT_METRES, BICYCLE_LENGTH_METRES, RIDER_HEIGHT_METRES } from './bicycle';
import {
  CASTS_CONTACT_SHADOW,
  CONTACT_SHADOW_DARKNESS,
  CONTACT_SHADOW_LIFT_METRES,
  placeContactShadow,
  type ContactShadow,
} from './contact-shadow';
import type { RiderMarker } from './port';
import { ContactShadowBelt, RiderBelt, ScatterBelt, WorldLamps } from './three-renderer';
import type { SunStyle } from './world';

const blank = (): ContactShadow => ({ x: 0, y: 0, z: 0, yaw: 0, halfAlong: 0, halfAcross: 0 });

const marker = (kind: RiderMarker['kind'], x = 0, z = 0): RiderMarker => ({
  kind,
  x,
  y: 12,
  z,
  headingX: 0,
  headingZ: 1,
});

/**
 * A sun 60° up, at an azimuth of 150°. ⚠️ Deliberately NOT `world.ts`'s 135°:
 * at 135° the east and north components are equal in size, so a mutation that
 * flips only one of them leaves the offset exactly perpendicular to the sun
 * and the "away from the sun" assertion passing — measured, not guessed.
 */
const SUN = (() => {
  const elevation = (60 * Math.PI) / 180;
  const azimuth = (150 * Math.PI) / 180;
  return {
    x: Math.cos(elevation) * Math.sin(azimuth),
    y: Math.sin(elevation),
    z: Math.cos(elevation) * Math.cos(azimuth),
  };
})();

describe('who casts a contact shadow — #426', () => {
  it('is the rider and the pacer, and NOT the ghost', () => {
    // The decision #426 asked to be recorded: a ghost with no shadow reads as
    // "not really here", which helps #93's at-a-glance criterion for nothing.
    expect(CASTS_CONTACT_SHADOW).toEqual({ rider: true, bot: true, ghost: false });
    expect(placeContactShadow(marker('rider'), SUN, blank())).toBe(true);
    expect(placeContactShadow(marker('bot'), SUN, blank())).toBe(true);
    expect(placeContactShadow(marker('ghost'), SUN, blank())).toBe(false);
  });

  it('casts nothing under a sun at or below the horizon rather than a shadow of infinite length', () => {
    expect(placeContactShadow(marker('rider'), { x: 1, y: 0, z: 0 }, blank())).toBe(false);
    expect(placeContactShadow(marker('rider'), { x: 0.9, y: -0.1, z: 0 }, blank())).toBe(false);
  });
});

describe('where it lies — from the one sun `world.ts` already has', () => {
  it('lies on the side AWAY from the sun, by the shadow of the rider’s middle', () => {
    const into = blank();
    placeContactShadow(marker('rider'), SUN, into);
    // Away from the sun horizontally: the dot product with the sun's own
    // horizontal direction is negative.
    const offsetX = into.x - 0;
    const offsetZ = into.z - 0;
    expect(offsetX * SUN.x + offsetZ * SUN.z).toBeLessThan(0);
    // …exactly: the shadow of the point half the rider up, `h / tan(elev)`
    // along the sun's horizontal direction reversed, from the bicycle's own
    // middle — which is a centimetre ahead of the marker, along its heading.
    const middle = BICYCLE_FRONT_METRES - BICYCLE_LENGTH_METRES / 2;
    const h = RIDER_HEIGHT_METRES / 2;
    expect(into.x).toBeCloseTo((-SUN.x / SUN.y) * h, 9);
    expect(into.z).toBeCloseTo(middle + (-SUN.z / SUN.y) * h, 9);
  });

  it('follows the sun: a different route’s sun puts it somewhere else', () => {
    const a = blank();
    const b = blank();
    placeContactShadow(marker('rider'), SUN, a);
    placeContactShadow(marker('rider'), { x: -SUN.x, y: SUN.y, z: -SUN.z }, b);
    expect(Math.sign(a.x)).toBe(-Math.sign(b.x));
  });

  it('follows the rider, at the road’s height there, lifted clear of it', () => {
    const here = blank();
    const there = blank();
    placeContactShadow(marker('rider', 0, 0), SUN, here);
    placeContactShadow(marker('rider', 40, 25), SUN, there);
    expect(there.x - here.x).toBeCloseTo(40, 9);
    expect(there.z - here.z).toBeCloseTo(25, 9);
    expect(here.y).toBeCloseTo(12 + CONTACT_SHADOW_LIFT_METRES, 9);
  });

  it('is at least the bicycle long, lengthened by the shadow the sun throws', () => {
    const overhead = blank();
    const slanted = blank();
    placeContactShadow(marker('rider'), { x: 0, y: 1, z: 0 }, overhead);
    placeContactShadow(marker('rider'), SUN, slanted);
    expect(overhead.halfAlong).toBeCloseTo(BICYCLE_LENGTH_METRES / 2, 9);
    expect(slanted.halfAlong).toBeGreaterThan(overhead.halfAlong);
    expect(slanted.halfAcross).toBeGreaterThan(overhead.halfAcross);
  });

  it('turns with the rider', () => {
    const into = blank();
    placeContactShadow({ ...marker('rider'), headingX: 1, headingZ: 0 }, SUN, into);
    expect(into.yaw).toBeCloseTo(Math.PI / 2, 9);
  });
});

/** The translation of one instance, read out of the buffer three uploads. */
function translationOf(belt: ContactShadowBelt, slot: number): readonly number[] {
  const matrix = belt.mesh.instanceMatrix.array;
  return [matrix[slot * 16 + 12], matrix[slot * 16 + 13], matrix[slot * 16 + 14]].map(Number);
}

describe('the contact shadow belt — one instanced transparent draw', () => {
  const sun: SunStyle = { ...SUN, ambient: 0.4, direct: 0.6 / SUN.y };

  it('draws one blob per rider who casts one, in ONE mesh, and none for the ghost', () => {
    const belt = new ContactShadowBelt();
    belt.place([marker('rider'), marker('bot', 0, 50), marker('ghost', 0, -20)], sun);
    expect(belt.mesh.count).toBe(2);
    expect(belt.mesh.visible).toBe(true);

    // Read back through the buffer, against the pure placement.
    for (const [slot, each] of [marker('rider'), marker('bot', 0, 50)].entries()) {
      const into = blank();
      placeContactShadow(each, sun, into);
      const [x, y, z] = translationOf(belt, slot);
      expect(x).toBeCloseTo(into.x, 5);
      expect(y).toBeCloseTo(into.y, 5);
      expect(z).toBeCloseTo(into.z, 5);
    }
    // …and flagged for upload: three's setter bumps the version, and a
    // matrix written but never uploaded is the half nobody can see.
    expect(belt.mesh.instanceMatrix.version).toBeGreaterThan(0);
  });

  it('draws nothing, and is not submitted, for a frame with only a ghost', () => {
    const belt = new ContactShadowBelt();
    belt.place([marker('ghost')], sun);
    expect(belt.mesh.count).toBe(0);
    expect(belt.mesh.visible).toBe(false);
  });

  it('is taken off entirely on a rung that draws the shadow map instead', () => {
    const belt = new ContactShadowBelt();
    belt.place([marker('rider')], sun);
    belt.setShown(false);
    expect(belt.mesh.visible).toBe(false);
    belt.place([marker('rider'), marker('bot')], sun);
    expect(belt.mesh.count).toBe(0);
    belt.setShown(true);
    belt.place([marker('rider')], sun);
    expect(belt.mesh.count).toBe(1);
  });

  it('is transparent, writes no depth, and is still depth-TESTED', () => {
    // Transparent: drawn after every opaque thing, so over the road. No depth
    // write: it hides no wheel. Tested: a crest in front of it still hides it.
    const material = belt().mesh.material as unknown as {
      transparent: boolean;
      depthWrite: boolean;
      depthTest: boolean;
      vertexColors: boolean;
      map: unknown;
    };
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    // A soft edge from vertex ALPHA, never a texture (#366's no-texture rule).
    expect(material.vertexColors).toBe(true);
    expect(material.map).toBeNull();
  });

  it('is black, darkest at the middle and clear at the rim, and faces UP', () => {
    const geometry = belt().mesh.geometry;
    const colour = geometry.getAttribute('color');
    expect(colour.itemSize).toBe(4);
    const alphas: number[] = [];
    for (let index = 0; index < colour.count; index += 1) {
      expect([colour.getX(index), colour.getY(index), colour.getZ(index)]).toEqual([0, 0, 0]);
      alphas.push(colour.getW(index));
    }
    expect(alphas[0]).toBeCloseTo(CONTACT_SHADOW_DARKNESS, 6);
    expect(Math.min(...alphas)).toBe(0);
    expect(Math.max(...alphas)).toBeCloseTo(CONTACT_SHADOW_DARKNESS, 6);

    // Every triangle's normal points +Y: a disc wound the other way is culled
    // from above, which is every camera this program has.
    const position = geometry.getAttribute('position');
    const index = geometry.getIndex();
    expect(index).not.toBeNull();
    for (let at = 0; at < (index?.count ?? 0); at += 3) {
      const [a, b, c] = [0, 1, 2].map((offset) => index?.getX(at + offset) ?? 0);
      const ux = position.getX(b ?? 0) - position.getX(a ?? 0);
      const uz = position.getZ(b ?? 0) - position.getZ(a ?? 0);
      const vx = position.getX(c ?? 0) - position.getX(a ?? 0);
      const vz = position.getZ(c ?? 0) - position.getZ(a ?? 0);
      // The y component of u × v.
      expect(uz * vx - ux * vz).toBeGreaterThan(0);
    }
  });
});

function belt(): ContactShadowBelt {
  return new ContactShadowBelt();
}

describe('the shadow MAP casters — #426, the map rung only', () => {
  it('lets the riders cast when asked and not otherwise', () => {
    const riders = new RiderBelt();
    const { bodies, cranksets, limbs } = riders.meshes;
    expect([bodies, cranksets, limbs].map((mesh) => mesh.castShadow)).toEqual([
      false,
      false,
      false,
    ]);
    riders.setCasting(true);
    expect([bodies, cranksets, limbs].map((mesh) => mesh.castShadow)).toEqual([true, true, true]);
    expect([bodies, cranksets, limbs].map((mesh) => mesh.receiveShadow)).toEqual([
      false,
      false,
      false,
    ]);
    riders.setCasting(false);
    expect([bodies, cranksets, limbs].map((mesh) => mesh.castShadow)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('never lets the scenery cast or receive — "for the riders only"', () => {
    const scenery = new ScatterBelt();
    for (const mesh of scenery.meshes.values()) {
      expect((mesh as unknown as { castShadow: boolean }).castShadow).toBe(false);
      expect((mesh as unknown as { receiveShadow: boolean }).receiveShadow).toBe(false);
    }
  });
});

describe('the sun as the shadow map’s camera — #426, the map rung only', () => {
  const sun: SunStyle = { ...SUN, ambient: 0.4, direct: 0.6 / SUN.y };

  it('casts only when asked, from a frame around the rider rather than the whole world', () => {
    const lamps = new WorldLamps();
    const [ambient, directional] = lamps.lamps;
    expect(directional.castShadow).toBe(false);
    lamps.setCasting(true);
    expect(directional.castShadow).toBe(true);
    expect(ambient.castShadow).toBe(false);
    const frame = directional.shadow.camera;
    expect([frame.left, frame.right, frame.top, frame.bottom]).toEqual([-6, 6, 6, -6]);
    expect(directional.shadow.mapSize.x).toBe(512);
    lamps.setCasting(false);
    expect(directional.castShadow).toBe(false);
  });

  it('moves both ends to the rider and keeps the ONE sun’s direction', () => {
    const lamps = new WorldLamps();
    const directional = lamps.lamps[1];
    lamps.apply(sun);
    lamps.aimShadowAt(100, 7, -40, sun);
    const along = [
      directional.position.x - directional.target.position.x,
      directional.position.y - directional.target.position.y,
      directional.position.z - directional.target.position.z,
    ];
    const length = Math.hypot(...along);
    expect([directional.target.position.x, directional.target.position.y]).toEqual([100, 7]);
    expect(along.map((each) => each / length)).toEqual([
      expect.closeTo(sun.x, 9),
      expect.closeTo(sun.y, 9),
      expect.closeTo(sun.z, 9),
    ]);
    // …and `apply` on the next frame of a rung WITHOUT the map puts the target
    // back at the origin, so the direction it documents is the one it has.
    lamps.apply(sun);
    expect([
      directional.target.position.x,
      directional.target.position.y,
      directional.target.position.z,
    ]).toEqual([0, 0, 0]);
  });
});
