// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The trees and bushes grown in code — #3252: that the same numbers are the
 * same tree to the bit, that each is inside its budget at every level, that
 * its middle level is its full level's skeleton, and that what it hands the
 * renderer is a mesh a material can wear.
 */

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  GROWN_CROWN_SHADE,
  GROWN_NORMAL_LEAN,
  GROWN_SPECIES,
  growTree,
  type GrownLevel,
  type GrownMesh,
  type GrownTree,
} from './grown-trees';
import { REALISTIC_GROWN_TRIANGLES, REALISTIC_TRIANGLES } from './realistic-budget';

const PARTS = ['bark', 'leaves'] as const;
const ARRAYS = ['positions', 'normals', 'uvs', 'colours', 'indices'] as const;

/** SHA-256 of every array of every level a grown tree has, with its name and length. */
function digestOf(tree: GrownTree): string {
  const hash = createHash('sha256');
  for (const level of ['full', 'middle'] as const) {
    const made = tree[level];
    if (made === undefined) continue;
    for (const part of PARTS) {
      for (const name of ARRAYS) {
        const array = made[part][name];
        hash.update(`${level}.${part}.${name} ${String(array.length)}\n`);
        hash.update(new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
      }
    }
  }
  return hash.digest('hex');
}

/**
 * What each species' numbers make, recorded: change a parameter on purpose
 * and this is the line that says the tree moved.
 */
const RECORDED: Readonly<Record<string, string>> = {
  grown_lime: 'cf50adeec8169ef01f88ac252adf44f5198425a1955f3c52bf6dc22ea14bf25d',
  grown_field_maple: 'e2dcc7ecf353ebce1a9c1b096441b51a65533cdbe91d20b668f447018d69cbed',
  grown_poplar: '02528cc57ed2b7231c2cedfcc0db6170a7a9980e680011a23ef5bb147327f306',
  grown_spruce: '3af8722839816f6a8b17484e00e52bed6a28f8c364a81e190f79c8caf47bc125',
  grown_thorn: 'f0adc72034f9cd38d95a574493a05164d02278fc068012d89bbe15dd126534b9',
  grown_laurel: 'ddbcf7d3366512acff54a844274ff897163d1dfe12623ef928fef413a7af5c07',
};

const GROWN = GROWN_SPECIES.map((species) => ({ species, tree: growTree(species) }));

const trianglesOf = (mesh: GrownMesh): number => mesh.indices.length / 3;

describe('a species is its numbers: the same seed is the same tree — #3252', () => {
  it.each(GROWN)('grows $species.id to the arrays recorded for it', ({ species, tree }) => {
    expect(digestOf(tree)).toBe(RECORDED[species.id]);
    // And again, from nothing: no state is kept between two trees.
    expect(digestOf(growTree(species))).toBe(RECORDED[species.id]);
  });

  it('grows a different tree from a different seed, and only then', () => {
    const lime = GROWN_SPECIES.find((species) => species.id === 'grown_lime');
    if (lime === undefined) throw new Error('no lime');
    expect(digestOf(growTree({ ...lime }))).toBe(RECORDED['grown_lime']);
    expect(digestOf(growTree({ ...lime, seed: lime.seed + 1 }))).not.toBe(RECORDED['grown_lime']);
  });

  it('records every species, and no species that is not grown', () => {
    expect(Object.keys(RECORDED).sort()).toEqual(GROWN_SPECIES.map((species) => species.id).sort());
    expect(new Set(GROWN_SPECIES.map((species) => species.seed)).size).toBe(GROWN_SPECIES.length);
  });
});

describe('each grown species is inside its budget, at every level — #3252, ADR 0099 D-4', () => {
  it.each(GROWN)('$species.id', ({ species, tree }) => {
    const ceiling = REALISTIC_GROWN_TRIANGLES[species.kind];
    expect(tree.full.triangles).toBe(trianglesOf(tree.full.bark) + trianglesOf(tree.full.leaves));
    expect(tree.full.triangles).toBeLessThanOrEqual(ceiling.full);
    if (species.kind === 'shrub') {
      expect(tree.middle).toBeUndefined();
      return;
    }
    const middle = tree.middle;
    if (middle === undefined) throw new Error(`${species.id}: a tree has a middle level`);
    expect(middle.triangles).toBe(trianglesOf(middle.bark) + trianglesOf(middle.leaves));
    expect(middle.triangles).toBeLessThanOrEqual((ceiling as { readonly middle: number }).middle);
    // The middle level is the level it is for: under a third of the full one.
    expect(middle.triangles).toBeLessThan(tree.full.triangles / 3);
  });

  it('holds the class no heavier than the model classes it stands among', () => {
    expect(REALISTIC_GROWN_TRIANGLES['tree-broadleaf'].full).toBeLessThanOrEqual(
      REALISTIC_TRIANGLES['tree-broadleaf'],
    );
    expect(REALISTIC_GROWN_TRIANGLES['tree-conifer'].full).toBeLessThanOrEqual(
      REALISTIC_TRIANGLES['tree-conifer'],
    );
    for (const kind of ['tree-broadleaf', 'tree-conifer'] as const) {
      expect(REALISTIC_GROWN_TRIANGLES[kind].middle).toBeLessThanOrEqual(
        REALISTIC_TRIANGLES['tree-middle'],
      );
    }
    expect(REALISTIC_GROWN_TRIANGLES.shrub.full).toBeLessThanOrEqual(REALISTIC_TRIANGLES.shrub / 3);
  });
});

describe('what a grown level hands the renderer — #3252', () => {
  const levels: { readonly name: string; readonly level: GrownLevel }[] = GROWN.flatMap(
    ({ species, tree }) => [
      { name: `${species.id} full`, level: tree.full },
      ...(tree.middle === undefined ? [] : [{ name: `${species.id} middle`, level: tree.middle }]),
    ],
  );

  it.each(levels)(
    '$name: every array the same length of vertices, every index inside them',
    ({ level }) => {
      for (const part of PARTS) {
        const mesh = level[part];
        const vertices = mesh.positions.length / 3;
        expect(vertices).toBeGreaterThan(0);
        expect(mesh.normals).toHaveLength(vertices * 3);
        expect(mesh.colours).toHaveLength(vertices * 3);
        expect(mesh.uvs).toHaveLength(vertices * 2);
        expect(mesh.indices.length % 3).toBe(0);
        expect(Math.max(...mesh.indices)).toBeLessThan(vertices);
        for (const name of ['positions', 'normals', 'uvs', 'colours'] as const) {
          expect(mesh[name].every((value) => Number.isFinite(value))).toBe(true);
        }
      }
    },
  );

  it.each(levels)(
    '$name: unit normals, and a shade a vertex no darker than the crown’s deepest',
    ({ level }) => {
      for (const part of PARTS) {
        const { normals, colours } = level[part];
        for (let at = 0; at < normals.length; at += 3) {
          const length = Math.hypot(
            normals[at] as number,
            normals[at + 1] as number,
            normals[at + 2] as number,
          );
          expect(length).toBeCloseTo(1, 4);
        }
        // 0.85: the underside's share of the deepest shade.
        expect(Math.min(...colours)).toBeGreaterThanOrEqual(GROWN_CROWN_SHADE * 0.85 - 1e-6);
        expect(Math.max(...colours)).toBeLessThanOrEqual(1);
      }
      // A crown is shaded: its outside is lit and its middle is not.
      const shades = level.leaves.colours;
      expect(Math.max(...shades) - Math.min(...shades)).toBeGreaterThan(0.25);
    },
  );

  it.each(levels)('$name: each leaf card’s root at the foot of its picture', ({ level }) => {
    const { uvs, positions } = level.leaves;
    // Four corners a card face: the two at the root read v = 1, the two at the tip v = 0.
    for (let corner = 0; corner < uvs.length / 2; corner += 4) {
      expect([0, 1, 2, 3].map((each) => uvs[(corner + each) * 2 + 1])).toEqual([1, 1, 0, 0]);
      expect([0, 1, 2, 3].map((each) => uvs[(corner + each) * 2])).toEqual([0, 1, 1, 0]);
    }
    expect(positions.length / 3).toBe(uvs.length / 2);
  });

  it.each(GROWN)(
    '$species.id stands on the ground, upright, at the size it records',
    ({ species, tree }) => {
      let lowest = Infinity;
      let highest = -Infinity;
      let reach = 0;
      for (const part of PARTS) {
        const { positions } = tree.full[part];
        for (let at = 0; at < positions.length; at += 3) {
          lowest = Math.min(lowest, positions[at + 1] as number);
          highest = Math.max(highest, positions[at + 1] as number);
          reach = Math.max(reach, Math.hypot(positions[at] as number, positions[at + 2] as number));
        }
      }
      expect(tree.heightMetres).toBeCloseTo(highest, 5);
      expect(tree.widthMetres).toBeCloseTo(reach * 2, 5);
      // Its foot on the ground, give or take a leaf that hangs: never buried, never floating.
      expect(lowest).toBeGreaterThan(-0.6);
      expect(tree.full.bark.positions[1]).toBeCloseTo(0, 6);
      // A tree is taller than a bush, and a poplar is a column.
      if (species.kind === 'shrub') expect(tree.heightMetres).toBeLessThan(2.2);
      else expect(tree.heightMetres).toBeGreaterThan(4.5);
    },
  );

  it('gives each species its own outline: a column, a cone, a dome and a low wide crown', () => {
    const shape = (id: string): number => {
      const tree = GROWN.find((each) => each.species.id === id)?.tree;
      if (tree === undefined) throw new Error(id);
      return tree.heightMetres / tree.widthMetres;
    };
    expect(shape('grown_poplar')).toBeGreaterThan(3);
    expect(shape('grown_lime')).toBeGreaterThan(1.2);
    expect(shape('grown_field_maple')).toBeLessThan(1);
    expect(shape('grown_lime')).toBeGreaterThan(shape('grown_field_maple') * 1.4);
    expect(shape('grown_thorn')).toBeLessThan(0.8);
  });
});

describe('the middle level is the full level’s own skeleton — #3252', () => {
  const trees = GROWN.filter(({ tree }) => tree.middle !== undefined);

  it.each(trees)('$species.id: the stem’s foot is one point in both levels', ({ tree }) => {
    const middle = tree.middle as GrownLevel;
    // The first vertex of the first ring: the same point of the same stem.
    for (const axis of [0, 1, 2]) {
      expect(middle.bark.positions[axis]).toBe(tree.full.bark.positions[axis]);
    }
  });

  it.each(trees)(
    '$species.id: every card it keeps grows from a full card’s own root, enlarged',
    ({ species, tree }) => {
      const plan = species.middle;
      const middle = tree.middle as GrownLevel;
      if (plan === undefined) throw new Error('no middle plan');
      const perCard = species.leaves.crossed ? 8 : 4;
      const rootOf = (mesh: GrownMesh, card: number): number[] =>
        [0, 1, 2].map(
          (axis) =>
            ((mesh.positions[card * perCard * 3 + axis] as number) +
              (mesh.positions[(card * perCard + 1) * 3 + axis] as number)) /
            2,
        );
      const sideOf = (mesh: GrownMesh, card: number): number => {
        const first = card * perCard * 3;
        return Math.hypot(
          (mesh.positions[first + 3] as number) - (mesh.positions[first] as number),
          (mesh.positions[first + 4] as number) - (mesh.positions[first + 1] as number),
          (mesh.positions[first + 5] as number) - (mesh.positions[first + 2] as number),
        );
      };
      const fullCards = tree.full.leaves.positions.length / 3 / perCard;
      const kept = middle.leaves.positions.length / 3 / perCard;
      expect(kept).toBe(Math.ceil(fullCards / plan.leafEvery));
      for (let card = 0; card < kept; card += 1) {
        const from = rootOf(tree.full.leaves, card * plan.leafEvery);
        const to = rootOf(middle.leaves, card);
        for (const axis of [0, 1, 2]) expect(to[axis]).toBeCloseTo(from[axis] as number, 5);
        expect(sideOf(middle.leaves, card)).toBeCloseTo(
          sideOf(tree.full.leaves, card * plan.leafEvery) * plan.leafGrowth,
          5,
        );
      }
    },
  );

  it.each(trees)(
    '$species.id: its wood is thinned, and its twigs’ wood is left out',
    ({ tree }) => {
      const middle = tree.middle as GrownLevel;
      expect(trianglesOf(middle.bark)).toBeLessThan(trianglesOf(tree.full.bark) / 2);
      expect(trianglesOf(middle.leaves)).toBeLessThan(trianglesOf(tree.full.leaves) / 2);
    },
  );
});

describe('a leaf card is lit from both of its sides — #3252', () => {
  const levels = GROWN.flatMap(({ species, tree }) => [
    { name: `${species.id} full`, species, leaves: tree.full.leaves },
    ...(tree.middle === undefined
      ? []
      : [{ name: `${species.id} middle`, species, leaves: tree.middle.leaves }]),
  ]);

  it.each(levels)(
    '$name: no normal leans far off level, so neither side faces the dark',
    ({ leaves }) => {
      const { normals } = leaves;
      for (let at = 0; at < normals.length; at += 3) {
        const run = Math.hypot(normals[at] as number, normals[at + 2] as number);
        const rise = (normals[at + 1] as number) / run;
        expect(run).toBeGreaterThan(0.9);
        expect(rise).toBeLessThanOrEqual(GROWN_NORMAL_LEAN.up + 1e-4);
        expect(rise).toBeGreaterThanOrEqual(-GROWN_NORMAL_LEAN.down - 1e-4);
      }
    },
  );

  it.each(levels)(
    '$name: each card’s FRONT, by its winding, is the side its normal is on',
    ({ leaves }) => {
      const { positions, normals, indices } = leaves;
      let fronted = 0;
      const point = (vertex: number): number[] =>
        [0, 1, 2].map((axis) => positions[vertex * 3 + axis] as number);
      for (let at = 0; at < indices.length; at += 3) {
        const [a, b, c] = [indices[at], indices[at + 1], indices[at + 2]].map((vertex) =>
          point(vertex as number),
        ) as [number[], number[], number[]];
        const ab = [0, 1, 2].map((axis) => (b[axis] as number) - (a[axis] as number));
        const ac = [0, 1, 2].map((axis) => (c[axis] as number) - (a[axis] as number));
        const wound = [
          (ab[1] as number) * (ac[2] as number) - (ab[2] as number) * (ac[1] as number),
          (ab[2] as number) * (ac[0] as number) - (ab[0] as number) * (ac[2] as number),
          (ab[0] as number) * (ac[1] as number) - (ab[1] as number) * (ac[0] as number),
        ];
        const first = (indices[at] as number) * 3;
        const area = Math.hypot(...(wound as [number, number, number])) || 1;
        // The cosine between the two: never behind its own face.
        const agrees =
          ((wound[0] as number) * (normals[first] as number) +
            (wound[1] as number) * (normals[first + 1] as number) +
            (wound[2] as number) * (normals[first + 2] as number)) /
          area;
        expect(agrees).toBeGreaterThanOrEqual(-1e-6);
        if (agrees > 0) fronted += 1;
      }
      expect(fronted).toBeGreaterThan((indices.length / 3) * 0.99);
    },
  );

  it('lays a conifer’s one card across its bough as a frond, within 50 degrees of level', () => {
    const spruce = GROWN.find(({ species }) => species.id === 'grown_spruce');
    if (spruce === undefined) throw new Error('no spruce');
    const { positions } = spruce.tree.full.leaves;
    let fronds = 0;
    let steep = 0;
    for (let card = 0; card < positions.length / 12; card += 1) {
      const first = card * 12;
      const edge = [0, 1, 2].map(
        (axis) => (positions[first + 3 + axis] as number) - (positions[first + axis] as number),
      );
      const tilt = Math.abs(edge[1] as number) / Math.hypot(...(edge as [number, number, number]));
      fronds += 1;
      if (tilt > Math.sin(0.88)) steep += 1;
    }
    expect(fronds).toBeGreaterThan(900);
    // All but the leader's, which stands on the stem's tip and has no level across it.
    expect(steep).toBeLessThan(fronds * 0.02);
  });
});
