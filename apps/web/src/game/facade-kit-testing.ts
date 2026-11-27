// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The committed downtown kit, read off disk for the tests — #3334.
 *
 * `facade-kit.ts` says what each piece is; the pipeline wrote the GLB. This
 * reads the GLB from glTF 2.0's own container (`model-bytes-testing.ts`,
 * `realistic-bytes-testing.ts`) and never through the renderer, so a test
 * holds the table and the belt to the bytes rather than to each other.
 *
 * ⚠️ `-testing.ts`, so `check-wiring.mjs` §`isTestSupport` treats it as what it
 * is rather than as product code nothing imports.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KIT_PIECES, kitCardOf, type KitGeometry } from './facade-kit';
import { readGlb } from './model-bytes-testing';
import { REALISTIC_DOWNTOWN_KIT } from './realistic-assets';
import { accessorValues } from './realistic-bytes-testing';

/** Where the realistic world's committed files are. */
export const SHIPPED_REALISTIC = fileURLToPath(new URL('../../public/realistic/', import.meta.url));

/** The part of the kit's glTF document this reads. */
interface KitDocument {
  readonly nodes?: readonly { readonly name?: string; readonly mesh?: number }[];
  readonly meshes?: readonly {
    readonly primitives: readonly {
      readonly attributes: Readonly<Record<string, number>>;
      readonly indices?: number;
    }[];
  }[];
}

/** One committed piece: its triangles as the belt copies them, and what its mesh declares. */
export interface CommittedKitPiece extends KitGeometry {
  /** The attributes its one primitive carries. */
  readonly attributes: readonly string[];
}

/**
 * Every piece of `facade-kit.ts` §`KIT_PIECES` out of the committed GLB, by
 * its node's name, its one primitive's indices followed so that it is three
 * vertices a triangle. Refuses a piece that is missing or has more than one
 * primitive.
 */
export function committedKitPieces(): readonly CommittedKitPiece[] {
  const { json, binary } = readGlb(join(SHIPPED_REALISTIC, REALISTIC_DOWNTOWN_KIT.model));
  const document = json as unknown as KitDocument & Parameters<typeof accessorValues>[0];
  return KIT_PIECES.map((piece) => {
    const node = document.nodes?.find((each) => each.name === piece.id);
    const mesh = node?.mesh === undefined ? undefined : document.meshes?.[node.mesh];
    const [primitive, ...rest] = mesh?.primitives ?? [];
    if (primitive === undefined || rest.length > 0) {
      throw new Error(`${piece.id}: not one primitive in the committed kit`);
    }
    const values = (name: string): Float64Array => {
      const accessor = primitive.attributes[name];
      if (accessor === undefined) throw new Error(`${piece.id}: no ${name}`);
      return accessorValues(document, binary, accessor).values;
    };
    const position = values('POSITION');
    const normal = values('NORMAL');
    const uv = values('TEXCOORD_0');
    const indices =
      primitive.indices === undefined
        ? Float64Array.from({ length: position.length / 3 }, (_, at) => at)
        : accessorValues(document, binary, primitive.indices).values;
    const expand = (from: Float64Array, size: number): Float32Array => {
      const out = new Float32Array(indices.length * size);
      indices.forEach((index, at) => {
        for (let component = 0; component < size; component += 1) {
          out[at * size + component] = from[index * size + component] as number;
        }
      });
      return out;
    };
    return {
      position: expand(position, 3),
      normal: expand(normal, 3),
      uv: expand(uv, 2),
      triangles: indices.length / 3,
      attributes: Object.keys(primitive.attributes).sort(),
    };
  });
}

/** The committed kit as the belt is handed it, less its atlas: every piece, and its card. */
export function committedKit(): {
  readonly pieces: readonly KitGeometry[];
  readonly cards: readonly KitGeometry[];
} {
  return {
    pieces: committedKitPieces(),
    cards: KIT_PIECES.map((_, index) => kitCardOf(index)),
  };
}
