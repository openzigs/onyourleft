// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The arithmetic of the realistic riders' bike-shaped shadow — #626. The real
 * rider's silhouette is measured in `realistic-textures.test.ts`, where the
 * committed body loads; these hold the pieces to shapes whose answer is known.
 */

import { describe, expect, it } from 'vitest';

import type { RiderMarker } from './port';
import { isConstructedMaterial, RiderSilhouetteBelt } from './three-renderer';
import type { SunStyle } from './world';
import { REALISTIC_RIDER_SILHOUETTE_BYTES } from './realistic-budget';
import {
  rasteriseSilhouette,
  silhouetteCoverage,
  silhouetteFootprint,
  silhouetteThrow,
  SILHOUETTE_ALONG_TEXELS,
  SILHOUETTE_TEXTURE_BYTES,
  SILHOUETTE_UP_TEXELS,
  type RiderSilhouette,
} from './rider-silhouette';

/** A flat, thin panel across nothing: `z` from `z0` to `z1`, `y` from 0 to `top`, at `x`. */
function panel(z0: number, z1: number, top: number, x = 0): number[] {
  return [x, 0, z0, x, 0, z1, x, top, z1, x, 0, z0, x, top, z1, x, top, z0];
}

/** A rider facing north (+Z) with the sun somewhere. */
function facingNorth(kind: RiderMarker['kind'] = 'rider', lean = 0): RiderMarker {
  return {
    kind,
    x: 0,
    y: 0,
    z: 0,
    headingX: 0,
    headingZ: 1,
    lean,
    bodyLean: 0,
    pedalling: 0,
    rideSeconds: 0,
  };
}

describe('rasteriseSilhouette — #626', () => {
  it('fills what a triangle covers from the side, and keeps how far across it reaches', () => {
    // A post from z −0.5 to 0.5 and 1 m tall, 0.2 m across; a thin panel
    // beside it spans the picture's full length so the bounds are known.
    const silhouette = rasteriseSilhouette(
      new Float32Array([...panel(-1, 1, 0.1, 0.05), ...panel(-0.05, 0.05, 1, 0.2)]),
    );
    expect(silhouette.bounds.zMin).toBe(-1);
    expect(silhouette.bounds.zMax).toBe(1);
    expect(silhouette.bounds.height).toBeCloseTo(1, 6);
    expect(silhouette.bounds.reach).toBeCloseTo(0.2, 6);
    expect(silhouette.texels).toHaveLength(SILHOUETTE_ALONG_TEXELS * SILHOUETTE_UP_TEXELS * 2);
    const texel = (z: number, y: number): readonly [number, number] => {
      const column = Math.floor(((z + 1) / 2) * SILHOUETTE_ALONG_TEXELS);
      const row = Math.floor(y * SILHOUETTE_UP_TEXELS);
      const at = (row * SILHOUETTE_ALONG_TEXELS + column) * 2;
      return [silhouette.texels[at] as number, silhouette.texels[at + 1] as number];
    };
    // The post, and its reach: the whole of the picture's.
    expect(texel(0, 0.5)).toEqual([255, 255]);
    // The low panel, reaching a quarter of it.
    expect(texel(-0.8, 0.05)).toEqual([255, Math.round(0.25 * 255)]);
    // Where the two overlap, the further reach.
    expect(texel(0, 0.05)).toEqual([255, 255]);
    // Beside the post above the panel: nothing.
    expect(texel(0.5, 0.5)).toEqual([0, 0]);
  });

  it('refuses what is not whole triangles', () => {
    expect(() => rasteriseSilhouette(new Float32Array(0))).toThrow(/whole triangles/);
    expect(() => rasteriseSilhouette(new Float32Array(8))).toThrow(/whole triangles/);
  });

  it('is one texture inside #626’s 128 KiB', () => {
    expect(SILHOUETTE_TEXTURE_BYTES).toBe(64 * 1024);
    expect(SILHOUETTE_TEXTURE_BYTES).toBeLessThanOrEqual(REALISTIC_RIDER_SILHOUETTE_BYTES);
    expect(REALISTIC_RIDER_SILHOUETTE_BYTES).toBe(128 * 1024);
  });
});

describe('silhouetteThrow — #626', () => {
  it('throws along the bicycle with the sun behind it, and across with the sun abeam', () => {
    const thrown = { x: 0, z: 0 };
    // A sun due south, 45° up: a shadow one metre per metre, due north —
    // straight ahead of a rider facing north.
    expect(
      silhouetteThrow(facingNorth(), { x: 0, y: Math.SQRT1_2, z: -Math.SQRT1_2 }, thrown),
    ).toBe(true);
    expect(thrown.x).toBeCloseTo(0, 12);
    expect(thrown.z).toBeCloseTo(1, 12);
    // A sun in the east (world −X since #583), 45° up: thrown west, to +X,
    // which is the bicycle's own +X — its left — for a rider facing north.
    expect(
      silhouetteThrow(facingNorth(), { x: -Math.SQRT1_2, y: Math.SQRT1_2, z: 0 }, thrown),
    ).toBe(true);
    expect(thrown.x).toBeCloseTo(1, 12);
    expect(thrown.z).toBeCloseTo(0, 12);
  });

  it('leans with the rider: a leaning rider under a sun overhead casts toward the inside of the bend', () => {
    const thrown = { x: 0, z: 0 };
    // A lean of +φ takes the top toward −X, so the shadow of a point `y` up
    // lands `y·sin φ` toward −X.
    expect(silhouetteThrow(facingNorth('rider', 0.3), { x: 0, y: 1, z: 0 }, thrown)).toBe(true);
    expect(thrown.x).toBeLessThan(-0.25);
    expect(thrown.z).toBeCloseTo(0, 12);
  });

  it('casts nothing for the ghost, or under a sun on the horizon', () => {
    const thrown = { x: 3, z: 3 };
    expect(silhouetteThrow(facingNorth('ghost'), { x: 0, y: 1, z: 0 }, thrown)).toBe(false);
    expect(silhouetteThrow(facingNorth(), { x: 0, y: 0, z: -1 }, thrown)).toBe(false);
    expect(thrown).toEqual({ x: 3, z: 3 });
    // The pacer casts one.
    expect(silhouetteThrow(facingNorth('bot'), { x: 0, y: 1, z: 0 }, thrown)).toBe(true);
  });
});

describe('silhouetteCoverage — the shader’s arithmetic — #626', () => {
  // A thin post 1 m tall at z = 0, 2 cm across, and two specks a metre either
  // side that set the bounds; seen from the side.
  const post: RiderSilhouette = rasteriseSilhouette(
    new Float32Array([
      ...panel(-1, -0.98, 0.02, 0.01),
      ...panel(0.98, 1, 0.02, 0.01),
      ...panel(-0.02, 0.02, 1, 0.01),
    ]),
  );

  it('casts a post along the throw: its shadow runs from its foot to its top’s shadow', () => {
    const thrown = { x: 0, z: 0.5 };
    expect(silhouetteCoverage(post, thrown, 0, 0.25)).toBeGreaterThan(0.5);
    expect(silhouetteCoverage(post, thrown, 0, 0.45)).toBeGreaterThan(0.5);
    // Past the top's shadow, and behind the foot: nothing.
    expect(silhouetteCoverage(post, thrown, 0, 0.6)).toBe(0);
    expect(silhouetteCoverage(post, thrown, 0, -0.2)).toBe(0);
    // Beside it: nothing.
    expect(silhouetteCoverage(post, thrown, 0.2, 0.25)).toBe(0);
  });

  it('casts it across when the sun is abeam, and covers nothing a metre off', () => {
    const thrown = { x: 0.5, z: 0 };
    expect(silhouetteCoverage(post, thrown, 0.25, 0)).toBeGreaterThan(0.5);
    expect(silhouetteCoverage(post, thrown, -0.25, 0)).toBe(0);
    expect(silhouetteCoverage(post, thrown, 0.25, 1)).toBe(0);
  });

  it('never covers a point outside the footprint the quad is drawn over', () => {
    for (const thrown of [
      { x: 0.7, z: 0 },
      { x: 0, z: -0.7 },
      { x: -0.3, z: 0.4 },
    ]) {
      const area = silhouetteFootprint(post.bounds, thrown, {
        acrossMin: 0,
        acrossMax: 0,
        alongMin: 0,
        alongMax: 0,
      });
      let inside = 0;
      for (let a = -3; a <= 3; a += 0.05) {
        for (let c = -3; c <= 3; c += 0.05) {
          const covered = silhouetteCoverage(post, thrown, a, c) > 0;
          const within =
            a >= area.acrossMin && a <= area.acrossMax && c >= area.alongMin && c <= area.alongMax;
          if (covered) {
            expect(within, `${String(a)}, ${String(c)}`).toBe(true);
            inside += 1;
          }
        }
      }
      expect(inside).toBeGreaterThan(5);
    }
  });
});

describe('the silhouette belt — one instanced transparent draw — #626', () => {
  const silhouette = rasteriseSilhouette(new Float32Array(panel(-0.8, 0.8, 1.5, 0.2)));
  const sun: SunStyle = { x: 0.3, y: 0.8, z: -0.4, ambient: 0.4, direct: 0.75 };
  const at = (kind: RiderMarker['kind'], z: number): RiderMarker => ({
    ...facingNorth(kind),
    z,
    y: 3,
  });

  it('draws one silhouette per rider who casts one, none for the ghost, each with its own throw', () => {
    const belt = new RiderSilhouetteBelt(silhouette);
    belt.setShown(true);
    belt.place([at('rider', 0), at('ghost', -20), at('bot', 50)], sun);
    expect(belt.mesh.count).toBe(2);
    expect(belt.mesh.visible).toBe(true);
    const throws = belt.mesh.geometry.getAttribute('oylThrow');
    for (const [slot, each] of [at('rider', 0), at('bot', 50)].entries()) {
      const thrown = { x: 0, z: 0 };
      silhouetteThrow(each, sun, thrown);
      expect(throws.getX(slot)).toBeCloseTo(thrown.x, 5);
      expect(throws.getY(slot)).toBeCloseTo(thrown.z, 5);
      // Placed on the rider, lifted as the blob is.
      const matrix = belt.mesh.instanceMatrix.array;
      expect(matrix[slot * 16 + 13]).toBeCloseTo(3.02, 5);
      expect(matrix[slot * 16 + 14]).toBeCloseTo(each.z, 5);
    }
    expect(belt.mesh.instanceMatrix.version).toBeGreaterThan(0);
    expect((throws as unknown as { version: number }).version).toBeGreaterThan(0);
  });

  it('draws nothing until it is shown, and nothing once it is hidden', () => {
    const belt = new RiderSilhouetteBelt(silhouette);
    belt.place([at('rider', 0)], sun);
    expect(belt.mesh.count).toBe(0);
    expect(belt.mesh.visible).toBe(false);
    belt.setShown(true);
    belt.place([at('rider', 0)], sun);
    expect(belt.mesh.count).toBe(1);
    belt.setShown(false);
    expect(belt.mesh.count).toBe(0);
    expect(belt.mesh.visible).toBe(false);
  });

  it('wears one constructed material: transparent, writing no depth, depth-TESTED, unfogged, with the silhouette as its one texture', () => {
    const belt = new RiderSilhouetteBelt(silhouette);
    const material = belt.mesh.material as unknown as {
      transparent: boolean;
      depthWrite: boolean;
      depthTest: boolean;
      fog: boolean;
      uniforms: Record<
        string,
        { value: { image?: { data: Uint8Array; width: number; height: number } } }
      >;
    };
    expect(isConstructedMaterial(belt.mesh.material as never)).toBe(true);
    expect(belt.wears(belt.mesh.material as never)).toBe(true);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.fog).toBe(false);
    const image = material.uniforms['oylSilhouette']?.value.image;
    expect(image?.width).toBe(SILHOUETTE_ALONG_TEXELS);
    expect(image?.height).toBe(SILHOUETTE_UP_TEXELS);
    expect(image?.data).toBe(silhouette.texels);
    expect(image?.data.byteLength).toBe(SILHOUETTE_TEXTURE_BYTES);
  });
});
