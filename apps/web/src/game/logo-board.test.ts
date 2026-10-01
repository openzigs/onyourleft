// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * `logo-board.ts` and `three-renderer.ts` §`LogoBelt` — the wordmark's board
 * on the start gate and on the billboards, #966.
 */

import { metres, type RouteProfile } from '@onyourleft/domain';
import { describe, expect, it } from 'vitest';

import type { Billboard } from './billboards';
import { cameraRig } from './camera';
import { GANTRY_BEAM_HEIGHT_METRES, GANTRY_BEAM_UNDERSIDE_METRES, standBoxes } from './gantry';
import {
  BILLBOARD_BOARD_BOTTOM_METRES,
  LOGO_BOARD_HEIGHT_METRES,
  LOGO_BOARD_WIDTH_METRES,
  carriesTheLogo,
  gateLogoPlace,
  logoBoxes,
} from './logo-board';
import { circuitRoute, northRoute } from './route-fixtures-testing';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import { GantryBelt, LOGO_BOARD_CAPACITY, LogoBelt } from './three-renderer';

function frameAt(profile: RouteProfile, distance: number): ReturnType<typeof sceneFrame> {
  const start = atStartLine(profile);
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: { ...start, ride: { ...start.ride, distance: metres(distance) } },
  });
}

/** An instance's three axes and its origin, from the mesh's matrices. */
function instance(
  belt: LogoBelt,
  at: number,
): { readonly x: number[]; readonly y: number[]; readonly z: number[]; readonly origin: number[] } {
  const elements = belt.mesh.instanceMatrix.array;
  const column = (index: number): number[] =>
    [0, 1, 2].map((row) => elements[at * 16 + index * 4 + row] ?? 0);
  return { x: column(0), y: column(1), z: column(2), origin: column(3) };
}

function foot(belt: LogoBelt, at: number): number {
  return belt.mesh.geometry.getAttribute('oylFoot').getX(at);
}

const loop = circuitRoute(500);
const approaching = frameAt(loop, (loop.totalDistance as number) - 40);

describe('the wordmark’s board — #966', () => {
  it('stands on the start gate — a loop’s lap line — and not on the finish’s', () => {
    const gate = approaching.lines.find(carriesTheLogo);
    expect(gate?.stand.kind).toBe('gantry');
    expect(gate?.stand.distance).toBe(0);
    const route = northRoute(3_000, () => 0);
    const finish = frameAt(route, (route.totalDistance as number) - 40).lines;
    // Non-vacuity: a gantry is in reach there, and it is not the start.
    expect(finish.some((line) => line.stand.kind === 'gantry')).toBe(true);
    expect(finish.filter(carriesTheLogo)).toEqual([]);
    // And at a point-to-point route's start, the start's.
    const start = frameAt(route, 0).lines.filter(carriesTheLogo);
    expect(start).toHaveLength(1);
  });

  it('sits on the gate’s beam, over the road’s middle, its posts folded away', () => {
    const gate = approaching.lines.find(carriesTheLogo);
    if (gate === undefined) throw new Error('no gate in reach');
    const belt = new LogoBelt(undefined, 'stylised');
    belt.update(approaching.lines, []);
    expect(belt.mesh.count).toBe(1);
    expect(belt.mesh.visible).toBe(true);
    const { origin } = instance(belt, 0);
    const beamTop = GANTRY_BEAM_UNDERSIDE_METRES + GANTRY_BEAM_HEIGHT_METRES;
    // The board's lower edge is the beam's top.
    expect((origin[1] ?? 0) + BILLBOARD_BOARD_BOTTOM_METRES).toBeCloseTo(gate.y + beamTop, 6);
    expect(origin[0]).toBeCloseTo(gate.x, 6);
    expect(origin[2]).toBeCloseTo(gate.z, 6);
    // Every vertex is held at or above the board's lower edge: the posts fold.
    expect(foot(belt, 0)).toBe(BILLBOARD_BOARD_BOTTOM_METRES);
    // And it is no wider than the beam it sits on.
    const beam = standBoxes('gantry').find(
      (box) => box.role === 'metal' && box.across === 0 && box.along === 0,
    );
    expect(LOGO_BOARD_WIDTH_METRES).toBeLessThan(beam?.width ?? 0);
    belt.dispose();
  });

  it('faces the rider riding at the gate, as a proper rotation, reading left to right', () => {
    const gate = approaching.lines.find(carriesTheLogo);
    if (gate === undefined) throw new Error('no gate in reach');
    const belt = new LogoBelt(undefined, 'stylised');
    belt.update(approaching.lines, []);
    const { x, y, z } = instance(belt, 0);
    // Across: the road's normal, the rider's right. Out of its face: against the heading.
    expect(x[0]).toBeCloseTo(-gate.headingZ, 6);
    expect(x[2]).toBeCloseTo(gate.headingX, 6);
    expect(z[0]).toBeCloseTo(-gate.headingX, 6);
    expect(z[2]).toBeCloseTo(-gate.headingZ, 6);
    // Not a mirror: x × y points along z.
    const cross = [
      (x[1] ?? 0) * (y[2] ?? 0) - (x[2] ?? 0) * (y[1] ?? 0),
      (x[2] ?? 0) * (y[0] ?? 0) - (x[0] ?? 0) * (y[2] ?? 0),
      (x[0] ?? 0) * (y[1] ?? 0) - (x[1] ?? 0) * (y[0] ?? 0),
    ];
    expect(
      (cross[0] ?? 0) * (z[0] ?? 0) + (cross[1] ?? 0) * (z[1] ?? 0) + (cross[2] ?? 0) * (z[2] ?? 0),
    ).toBeCloseTo(1, 6);
    // From the chase camera, the board's `u = 0` end is on the left.
    const place = gateLogoPlace(gate);
    const half = LOGO_BOARD_WIDTH_METRES / 2;
    const left = { x: place.x - place.acrossX * half, z: place.z - place.acrossZ * half };
    const right = { x: place.x + place.acrossX * half, z: place.z + place.acrossZ * half };
    const { eye, target } = cameraRig(approaching.camera);
    const forward = { x: target.x - eye.x, z: target.z - eye.z };
    const cameraRight = { x: -forward.z, z: forward.x };
    const across = (point: { x: number; z: number }): number =>
      (point.x - eye.x) * cameraRight.x + (point.z - eye.z) * cameraRight.z;
    expect(across(left)).toBeLessThan(across(right));
    // And its face is toward the camera.
    expect(place.faceX * forward.x + place.faceZ * forward.z).toBeLessThan(0);
    belt.dispose();
  });

  it('stands a billboard on its posts, facing as it was turned', () => {
    const board: Billboard = { x: 3, y: 1.5, z: -7, rotation: 0.6, along: 900, side: 1 };
    const belt = new LogoBelt(undefined, 'realistic');
    belt.update([], [board]);
    expect(belt.mesh.count).toBe(1);
    const { x, z, origin } = instance(belt, 0);
    expect(origin).toEqual([3, 1.5, -7]);
    expect(z[0]).toBeCloseTo(Math.sin(0.6), 6);
    expect(z[2]).toBeCloseTo(Math.cos(0.6), 6);
    expect(x[0]).toBeCloseTo(Math.cos(0.6), 6);
    expect(x[2]).toBeCloseTo(-Math.sin(0.6), 6);
    // Its posts reach into the ground: nothing is folded.
    expect(foot(belt, 0)).toBe(Number.NEGATIVE_INFINITY);
    belt.dispose();
  });

  it('draws nothing where a frame holds neither, and never more than its capacity', () => {
    const belt = new LogoBelt(undefined, 'stylised');
    belt.update([], []);
    expect(belt.mesh.visible).toBe(false);
    expect(belt.mesh.count).toBe(0);
    const many: Billboard[] = Array.from({ length: LOGO_BOARD_CAPACITY + 3 }, (_, at) => ({
      x: at,
      y: 0,
      z: 0,
      rotation: 0,
      along: at,
      side: 1,
    }));
    belt.update(approaching.lines, many);
    expect(belt.mesh.count).toBe(LOGO_BOARD_CAPACITY);
    // Shown off, by the world or the browser gate's control, it draws nothing.
    belt.switchOn(false);
    belt.update(approaching.lines, many);
    expect(belt.mesh.visible).toBe(false);
    belt.switchOn(true);
    belt.setShown(false);
    belt.update(approaching.lines, many);
    expect(belt.mesh.visible).toBe(false);
    belt.dispose();
  });

  it('carries the wordmark on the board’s front face alone, the whole texture across it', () => {
    const belt = new LogoBelt(undefined, 'stylised');
    const geometry = belt.mesh.geometry;
    const face = geometry.getAttribute('oylFace');
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const position = geometry.getAttribute('position');
    let flagged = 0;
    let lowU = 1;
    let highU = 0;
    for (let at = 0; at < face.count; at += 1) {
      if (face.getX(at) !== 1) continue;
      flagged += 1;
      expect(normal.getZ(at)).toBeCloseTo(1, 6);
      // On the board, not a post: at the board's height.
      expect(position.getY(at)).toBeGreaterThanOrEqual(BILLBOARD_BOARD_BOTTOM_METRES - 1e-6);
      expect(position.getY(at)).toBeLessThanOrEqual(
        BILLBOARD_BOARD_BOTTOM_METRES + LOGO_BOARD_HEIGHT_METRES + 1e-6,
      );
      lowU = Math.min(lowU, uv.getX(at));
      highU = Math.max(highU, uv.getX(at));
    }
    // One face, two triangles.
    expect(flagged).toBe(6);
    expect([lowU, highU]).toEqual([0, 1]);
    // The board and both posts.
    expect(logoBoxes().map((box) => box.role)).toEqual(['board', 'post', 'post']);
    belt.dispose();
  });

  it('gives up its shading on the floor rung, as every stylised belt does (#966’s review)', () => {
    const stylised = new LogoBelt(undefined, 'stylised');
    const lit = stylised.mesh.material;
    expect((lit as { type: string }).type).toBe('MeshLambertMaterial');
    stylised.setShading('flat');
    const flat = stylised.mesh.material;
    expect((flat as { type: string }).type).toBe('MeshBasicMaterial');
    // Both exist from construction: back up is the same object, not a new one.
    stylised.setShading('lit');
    expect(stylised.mesh.material).toBe(lit);
    stylised.dispose();
    const gantries = new GantryBelt(undefined, 'stylised');
    expect((gantries.meshes.boxes.material as { type: string }).type).toBe('MeshLambertMaterial');
    gantries.setShading('flat');
    expect((gantries.meshes.boxes.material as { type: string }).type).toBe('MeshBasicMaterial');
    gantries.dispose();
    // The realistic world has no flat rung: its board keeps its one material.
    const realistic = new LogoBelt(undefined, 'realistic');
    const standard = realistic.mesh.material;
    realistic.setShading('flat');
    expect(realistic.mesh.material).toBe(standard);
    realistic.dispose();
  });
});
