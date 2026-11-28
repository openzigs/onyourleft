// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * The field life's shapes and its belt — #3286 (`field-life-shapes.ts`,
 * `three-renderer.ts` §`FieldLifeBelt`), read back off the one mesh the belt
 * fills:
 *
 * - every shape inside its class's ceiling (`realistic-budget.ts`
 *   §`REALISTIC_TRIANGLES`' `animal`, `animal-far` and `bale`), and the far
 *   level a few boxes;
 * - ONE mesh, so one draw call, hidden on a frame with none;
 * - the frame's worst inside §`REALISTIC_FIELD_LIFE_TRIANGLES`;
 * - a piece drawn where the frame says, facing its heading, standing on the
 *   ground it is given;
 * - the bales only in the season clock's late summer and autumn, as the view
 *   was told it through `port.ts` §`GameView.setSeason`.
 *
 * jsdom, for `threeGameRenderer.create`'s canvas; no WebGL, so nothing here
 * renders a frame. Nothing here imports three (`three-seam.test.ts`).
 */

import { describe, expect, it } from 'vitest';

import {
  FIELD_ANIMALS_MAX,
  FIELD_ANIMALS_NEAR_MAX,
  FIELD_BALES_MAX,
  NO_FIELD_LIFE,
  balesInSeason,
  type FieldLife,
  type FieldLifeInView,
  type FieldLifeKind,
  type FieldLifeLevel,
  type FieldLifePose,
} from './field-life';
import { BALE_SIZE, COW_COATS, fieldLifeShape } from './field-life-shapes';
import { qualitySettings } from './quality';
import {
  REALISTIC_FIELD_LIFE_DRAW_CALLS,
  REALISTIC_FIELD_LIFE_TRIANGLES,
  REALISTIC_TRIANGLES,
} from './realistic-budget';
import { NO_SEASON, seasonOn, type CalendarDay, type Season } from './season';
import {
  FieldLifeBelt,
  fieldLifeWorstTriangles,
  seasonOf,
  threeGameRenderer,
} from './three-renderer';

const KINDS: readonly FieldLifeKind[] = ['cow', 'sheep', 'bale'];
const POSES: readonly FieldLifePose[] = ['grazing', 'head-up', 'lying'];
const LEVELS: readonly FieldLifeLevel[] = ['near', 'far'];

/** One piece, where `more` says. */
function piece(more: Partial<FieldLife> = {}): FieldLife {
  return {
    kind: 'cow',
    pose: 'grazing',
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    level: 'near',
    look: 0,
    ...more,
  };
}

/** The belt's one mesh's geometry's attribute, as a flat array. */
function attributeOf(belt: FieldLifeBelt, name: string): Float32Array {
  const attribute = belt.mesh.geometry.getAttribute(name);
  return attribute.array as Float32Array;
}

/** The season a northern route at 50° has on `day`, as `GameView` works it out. */
function northernSeason(day: CalendarDay): Season {
  return seasonOn(day, 'north', 50, true);
}

/** The season a view holds once it has been told the one on `day`. @see GameView.setSeason */
function toldThrough(day: CalendarDay): Season {
  const view = threeGameRenderer.create(document.createElement('canvas'), qualitySettings(0));
  try {
    view.setSeason(northernSeason(day));
    const held = seasonOf(view);
    if (held === undefined) throw new Error('the view holds no season');
    return held;
  } finally {
    view.destroy();
  }
}

const SEPTEMBER_20 = { year: 2026, month: 9, day: 20 };
const OCTOBER_25 = { year: 2026, month: 10, day: 25 };
const JANUARY_20 = { year: 2027, month: 1, day: 20 };
const APRIL_20 = { year: 2026, month: 4, day: 20 };
const JULY_1 = { year: 2026, month: 7, day: 1 };

describe('the shapes — #3286, generated in code', () => {
  it('holds every kind, pose, level and coat to its class’s ceiling, and the far level to a few boxes', () => {
    for (const kind of KINDS) {
      for (const pose of POSES) {
        for (const level of LEVELS) {
          for (let coat = 0; coat < COW_COATS.length; coat += 1) {
            const shape = fieldLifeShape(kind, pose, level, coat);
            const ceiling =
              kind === 'bale'
                ? REALISTIC_TRIANGLES.bale
                : level === 'near'
                  ? REALISTIC_TRIANGLES.animal
                  : REALISTIC_TRIANGLES['animal-far'];
            expect(shape.triangles, `${kind} ${pose} ${level}`).toBeLessThanOrEqual(ceiling);
            // Non-vacuity: a real shape, every corner written.
            expect(shape.triangles).toBeGreaterThanOrEqual(20);
            expect(shape.position).toHaveLength(shape.triangles * 9);
            expect(shape.normal).toHaveLength(shape.triangles * 9);
            expect(shape.colour).toHaveLength(shape.triangles * 3);
          }
        }
      }
    }
    // The issue's proposal, and a far level that is a few boxes (ten triangles a box).
    expect(REALISTIC_TRIANGLES.animal).toBe(600);
    expect(REALISTIC_TRIANGLES['animal-far']).toBe(60);
    expect(fieldLifeShape('cow', 'grazing', 'far', 0).triangles).toBeLessThanOrEqual(40);
    // The near level is more than the far one: two levels, not one shape twice.
    expect(fieldLifeShape('cow', 'grazing', 'near', 0).triangles).toBeGreaterThan(
      fieldLifeShape('cow', 'grazing', 'far', 0).triangles,
    );
  });

  it('stands every shape on the ground, its head down at the grass when grazing', () => {
    for (const kind of KINDS) {
      for (const pose of POSES) {
        const { position } = fieldLifeShape(kind, pose, 'near', 0);
        const heights = position.filter((_, at) => at % 3 === 1);
        expect(Math.min(...heights), `${kind} ${pose}`).toBeCloseTo(0, 6);
      }
    }
    // A grazing cow's lowest point ahead of its body is its muzzle in the grass;
    // a cow with its head up holds it above its back.
    const headTop = (pose: FieldLifePose): number => {
      const { position } = fieldLifeShape('cow', pose, 'near', 0);
      let top = Number.NEGATIVE_INFINITY;
      for (let at = 0; at < position.length; at += 3) {
        if ((position[at + 2] as number) > 1.25) top = Math.max(top, position[at + 1] as number);
      }
      return top;
    };
    expect(headTop('grazing')).toBeLessThan(0.6);
    expect(headTop('head-up')).toBeGreaterThan(1.5);
  });

  it('winds every triangle to face the way its normal says, so none is culled from outside', () => {
    for (const kind of KINDS) {
      for (const pose of POSES) {
        for (const level of LEVELS) {
          const { position, normal, triangles } = fieldLifeShape(kind, pose, level, 0);
          for (let t = 0; t < triangles; t += 1) {
            const p = (corner: number, axis: number): number =>
              position[(t * 3 + corner) * 3 + axis] as number;
            const u = [0, 1, 2].map((axis) => p(1, axis) - p(0, axis));
            const v = [0, 1, 2].map((axis) => p(2, axis) - p(0, axis));
            const cross = [
              (u[1] as number) * (v[2] as number) - (u[2] as number) * (v[1] as number),
              (u[2] as number) * (v[0] as number) - (u[0] as number) * (v[2] as number),
              (u[0] as number) * (v[1] as number) - (u[1] as number) * (v[0] as number),
            ];
            const facing = cross.reduce(
              (sum, each, axis) => sum + each * (normal[t * 9 + axis] as number),
              0,
            );
            expect(facing, `${kind} ${pose} ${level} triangle ${String(t)}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('rolls a bale on its side: 1.5 m across its corners, a flat side down', () => {
    const { position } = fieldLifeShape('bale', 'lying', 'far', 0);
    const along = (axis: number): readonly number[] => [
      ...position.filter((_, at) => at % 3 === axis),
    ];
    expect(Math.max(...along(1)) - Math.min(...along(1))).toBeCloseTo(
      2 * BALE_SIZE.radius * Math.cos(Math.PI / 8),
      6,
    );
    expect(Math.max(...along(0)) - Math.min(...along(0))).toBeCloseTo(2 * BALE_SIZE.halfWidth, 6);
    expect(along(1).filter((y) => Math.abs(y) < 1e-6).length).toBeGreaterThanOrEqual(6);
  });
});

describe('the belt — #3286', () => {
  it('is one mesh, so one draw call, and hidden until a frame carries a piece', () => {
    const belt = new FieldLifeBelt();
    const added: unknown[] = [];
    belt.addTo({ add: (mesh: unknown) => added.push(mesh) } as never);
    expect(added).toHaveLength(REALISTIC_FIELD_LIFE_DRAW_CALLS);
    expect(REALISTIC_FIELD_LIFE_DRAW_CALLS).toBe(1);
    expect(belt.mesh.visible).toBe(false);
    belt.update(NO_FIELD_LIFE, NO_SEASON);
    expect(belt.mesh.visible).toBe(false);
    belt.update({ pieces: [piece(), piece({ kind: 'sheep', x: 5 })] }, NO_SEASON);
    expect(belt.mesh.visible).toBe(true);
    expect(belt.stats.animals).toBe(2);
    belt.update(undefined, NO_SEASON);
    expect(belt.mesh.visible).toBe(false);
    belt.dispose();
  });

  it('holds its worst frame inside REALISTIC_FIELD_LIFE_TRIANGLES, whatever it is handed', () => {
    const worst = fieldLifeWorstTriangles();
    expect(worst).toBeLessThanOrEqual(REALISTIC_FIELD_LIFE_TRIANGLES);
    // The ceiling is the caps at their classes' ceilings, exactly.
    expect(REALISTIC_FIELD_LIFE_TRIANGLES).toBe(
      FIELD_ANIMALS_NEAR_MAX * REALISTIC_TRIANGLES.animal +
        (FIELD_ANIMALS_MAX - FIELD_ANIMALS_NEAR_MAX) * REALISTIC_TRIANGLES['animal-far'] +
        FIELD_BALES_MAX * REALISTIC_TRIANGLES.bale,
    );
    // Handed far more than the caps, every one near and every bale in season,
    // it draws no more than the worst.
    const belt = new FieldLifeBelt();
    const flood: FieldLife[] = [];
    for (let at = 0; at < 200; at += 1) {
      flood.push(piece({ x: at * 3, kind: at % 2 === 0 ? 'cow' : 'sheep', pose: 'head-up' }));
      flood.push(piece({ x: at * 3, z: 50, kind: 'bale', pose: 'lying' }));
    }
    belt.update({ pieces: flood }, northernSeason(OCTOBER_25));
    expect(belt.stats.animals).toBe(FIELD_ANIMALS_MAX);
    expect(belt.stats.near).toBe(FIELD_ANIMALS_NEAR_MAX);
    expect(belt.stats.bales).toBe(FIELD_BALES_MAX);
    expect(belt.stats.triangles).toBe(attributeOf(belt, 'position').length / 9);
    expect(belt.stats.triangles).toBeLessThanOrEqual(worst);
    // Non-vacuity: the flood filled the caps, so the count is a real frame's.
    expect(belt.stats.triangles).toBeGreaterThan(worst / 2);
    belt.dispose();
  });

  it('stands each piece where the frame says, turned to its heading, on the ground it is given', () => {
    const belt = new FieldLifeBelt();
    const alone = fieldLifeShape('cow', 'head-up', 'near', 0);
    belt.update(
      { pieces: [piece({ pose: 'head-up', x: 30, y: 4, z: -12, heading: Math.PI / 2 })] },
      NO_SEASON,
    );
    const position = attributeOf(belt, 'position');
    expect(position).toHaveLength(alone.position.length);
    let lowest = Number.POSITIVE_INFINITY;
    let reach = 0;
    for (let at = 0; at < position.length; at += 3) {
      lowest = Math.min(lowest, position[at + 1] as number);
      // A quarter turn: its nose, +z in its own frame, points along +x.
      reach = Math.max(reach, (position[at] as number) - 30);
      expect(Math.abs((position[at + 2] as number) + 12)).toBeLessThan(0.5);
    }
    expect(lowest).toBeCloseTo(4, 5);
    expect(reach).toBeGreaterThan(1.3);
    belt.dispose();
  });

  it('draws an animal past the near cap at its far level, whatever the list says', () => {
    const belt = new FieldLifeBelt();
    const many = Array.from({ length: FIELD_ANIMALS_NEAR_MAX + 3 }, (_, at) =>
      piece({ x: at * 4 }),
    );
    belt.update({ pieces: many }, NO_SEASON);
    const near = fieldLifeShape('cow', 'grazing', 'near', 0).triangles;
    const far = fieldLifeShape('cow', 'grazing', 'far', 0).triangles;
    expect(belt.stats.near).toBe(FIELD_ANIMALS_NEAR_MAX);
    expect(belt.stats.triangles).toBe(FIELD_ANIMALS_NEAR_MAX * near + 3 * far);
    belt.dispose();
  });

  it('rebuilds its mesh only when the pieces are not the last frame’s, or the bales’ season turns', () => {
    const belt = new FieldLifeBelt();
    const view: FieldLifeInView = {
      pieces: [piece(), piece({ kind: 'bale', pose: 'lying', x: 9 })],
    };
    belt.update(view, NO_SEASON);
    expect(belt.stats.rebuilds).toBe(1);
    belt.update(view, NO_SEASON);
    belt.update(view, northernSeason(APRIL_20));
    expect(belt.stats.rebuilds).toBe(1);
    belt.update(view, northernSeason(OCTOBER_25));
    expect(belt.stats.rebuilds).toBe(2);
    belt.update({ pieces: [...view.pieces] }, northernSeason(OCTOBER_25));
    expect(belt.stats.rebuilds).toBe(3);
    belt.dispose();
  });
});

describe('the bales by the season clock — #3286, through GameView.setSeason', () => {
  const baled: FieldLifeInView = {
    pieces: [
      piece({ kind: 'sheep', x: -20 }),
      ...Array.from({ length: 5 }, (_, at) => piece({ kind: 'bale', pose: 'lying', x: at * 4 })),
    ],
  };
  const balesDrawnOn = (day: CalendarDay): number => {
    const belt = new FieldLifeBelt();
    try {
      belt.update(baled, toldThrough(day));
      // The sheep whatever the season.
      expect(belt.stats.animals).toBe(1);
      return belt.stats.bales;
    } finally {
      belt.dispose();
    }
  };

  it('draws the bales in late summer and autumn', () => {
    expect(balesDrawnOn(SEPTEMBER_20)).toBe(5);
    expect(balesDrawnOn(OCTOBER_25)).toBe(5);
    // The clock's first day of autumn colour, 1 September, is late summer; the
    // day before it has none, and no bale.
    expect(balesInSeason(northernSeason({ year: 2026, month: 9, day: 1 }))).toBe(true);
    expect(balesInSeason(northernSeason({ year: 2026, month: 8, day: 31 }))).toBe(false);
  });

  it('draws none in winter, in spring or in high summer', () => {
    expect(balesDrawnOn(JANUARY_20)).toBe(0);
    expect(balesDrawnOn(APRIL_20)).toBe(0);
    expect(balesDrawnOn(JULY_1)).toBe(0);
    // Winter has begun by late November, autumn colour or not.
    expect(balesInSeason(northernSeason({ year: 2026, month: 11, day: 25 }))).toBe(false);
  });

  it('follows the route’s hemisphere, and draws none where the clock has no season', () => {
    // 25 October is spring on a southern route; 20 March is its autumn.
    expect(balesInSeason(seasonOn(OCTOBER_25, 'south', 40, true))).toBe(false);
    expect(balesInSeason(seasonOn({ year: 2026, month: 3, day: 20 }, 'south', 40, true))).toBe(
      true,
    );
    expect(balesInSeason(seasonOn(OCTOBER_25, 'north', 10, true))).toBe(false);
    expect(balesInSeason(seasonOn(OCTOBER_25, 'unknown', 50, true))).toBe(false);
    expect(balesInSeason(NO_SEASON)).toBe(false);
    // The decorations switch is the holiday's, never the fields'.
    expect(balesInSeason(seasonOn(OCTOBER_25, 'north', 50, false))).toBe(true);
  });
});
