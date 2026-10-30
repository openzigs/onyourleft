// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * Other riders' names on the road — #783 (`name-tags.ts`): which riders are
 * named, where the name goes, and that it reaches the page as text. Whether
 * the name lands over the rider the RENDERER drew is the browser gate's
 * (`game.browser.spec.ts` §"#783").
 */

import { describe, expect, it } from 'vitest';

import { metres } from '@onyourleft/domain';

import { RIDER_HEIGHT_METRES } from './bicycle';
import { REFERENCE_ASPECT, cameraRig, projectToFrame } from './camera';
import {
  MAXIMUM_NAME_TAGS,
  NAME_TAG_ABOVE_METRES,
  NAME_TAG_CLASS,
  NAME_TAG_HEIGHT_PX,
  NAME_TAG_METRES,
  NAMED_RIDERS_DRAWN,
  layNameTags,
  nameTagWidthPx,
  nameTags,
} from './name-tags';
import type { RiderMarker, SceneFrame } from './port';
import { northRoute } from './route-fixtures-testing';
import type { RemoteRiderInput } from './scene';
import { sceneFrame } from './scene';
import { atStartLine } from './simulation';
import { corridorOrigin } from './terrain';
import { realisticRemoteSplit } from './three-renderer';

const PROFILE = northRoute(3_000, () => 40);
const AT = 1_000;
/** A 16 : 9 stage — `REFERENCE_ASPECT` — and a square one, in CSS pixels. */
const FRAME = { width: 1280, height: 720 };
const SQUARE = { width: 800, height: 800 };

/** `marker` moved `ahead` metres along its heading and `across` toward its right, named `label`. */
function moved(marker: RiderMarker, ahead: number, across: number, label: string): RiderMarker {
  return {
    ...marker,
    x: marker.x + marker.headingX * ahead - marker.headingZ * across,
    z: marker.z + marker.headingZ * ahead + marker.headingX * across,
    label,
  };
}

function frameWith(remote: readonly RemoteRiderInput[]): SceneFrame {
  const start = atStartLine(PROFILE);
  return sceneFrame({
    profile: PROFILE,
    origin: corridorOrigin(PROFILE),
    state: { ...start, ride: { ...start.ride, distance: metres(AT) } },
    remoteRiders: remote,
  });
}

const rider = (riderId: number, ahead: number, label?: string): RemoteRiderInput => ({
  riderId,
  distanceMetres: AT + ahead,
  speedMetresPerSecond: 9,
  ...(label === undefined ? {} : { label }),
});

describe('other riders’ names on the road — #783', () => {
  it('names a rider the room named, and nobody it did not', () => {
    const tags = nameTags(frameWith([rider(1, 12, 'Bea Ng'), rider(2, 18)]), FRAME);
    expect(tags.map((tag) => tag.label)).toEqual(['Bea Ng']);
    expect(nameTags(frameWith([rider(2, 18)]), FRAME)).toEqual([]);
    expect(nameTags(frameWith([]), FRAME)).toEqual([]);
  });

  it('hangs the name just over the rider’s helmet, where the camera sees it', () => {
    const frame = frameWith([rider(1, 15, 'Bea Ng')]);
    const marker = frame.markers.find((each) => each.kind === 'remote') as RiderMarker;
    const [tag] = nameTags(frame, FRAME);
    const rig = cameraRig(frame.camera);
    const helmet = projectToFrame(rig, REFERENCE_ASPECT, {
      x: marker.x,
      y: marker.y + RIDER_HEIGHT_METRES,
      z: marker.z,
    });
    const feet = projectToFrame(rig, REFERENCE_ASPECT, marker);
    expect(tag).toBeDefined();
    expect(helmet).toBeDefined();
    // Above the helmet, and by less than the rider is tall on the screen.
    const tall = (feet?.top ?? 0) - (helmet?.top ?? 0);
    expect(tag?.top).toBeLessThan(helmet?.top ?? 0);
    expect((helmet?.top ?? 0) - (tag?.top ?? 0)).toBeLessThan(
      (tall * NAME_TAG_ABOVE_METRES * 2) / RIDER_HEIGHT_METRES,
    );
    // Over them across the frame too: on their own side of the middle.
    expect(Math.abs((tag?.left ?? 0) - (helmet?.left ?? 0))).toBeLessThan(0.02);
  });

  it('moves the name with a leaning rider, toward the side they lean to', () => {
    const frame = frameWith([rider(1, 15, 'Bea Ng')]);
    const marker = frame.markers.find((each) => each.kind === 'remote') as RiderMarker;
    const upright = nameTags({ ...frame, markers: [{ ...marker, lean: 0, bodyLean: 0 }] }, SQUARE);
    const leaning = nameTags(
      { ...frame, markers: [{ ...marker, lean: 0.5, bodyLean: -0.1 }] },
      SQUARE,
    );
    // A positive lean tips the top toward the normal, the rider's RIGHT.
    expect((leaning[0]?.left ?? 0) - (upright[0]?.left ?? 0)).toBeGreaterThan(0.02);
  });

  it('names nobody past NAME_TAG_METRES, behind the camera, or outside the frame', () => {
    expect(nameTags(frameWith([rider(1, NAME_TAG_METRES + 10, 'Far')]), FRAME)).toEqual([]);
    expect(nameTags(frameWith([rider(1, -20, 'Behind')]), FRAME)).toEqual([]);
    const frame = frameWith([rider(1, 15, 'Beside')]);
    const marker = frame.markers.find((each) => each.kind === 'remote') as RiderMarker;
    // 40 m to the side of the road, 15 m ahead: outside a 16 : 9 frame.
    const aside = {
      ...marker,
      x: marker.x + 40 * -marker.headingZ,
      z: marker.z + 40 * marker.headingX,
    };
    expect(nameTags({ ...frame, markers: [aside] }, FRAME)).toEqual([]);
  });

  it('names at most MAXIMUM_NAME_TAGS, the nearest, painted farthest first', () => {
    const frame = frameWith([rider(1, 20, 'R')]);
    const own = frame.markers[0] as RiderMarker;
    const base = frame.markers.find((each) => each.kind === 'remote') as RiderMarker;
    // Twenty riders spread two metres apart across the road, each half a metre
    // further up it than the last, so no two names meet on a 16 : 9 stage.
    const many = Array.from({ length: 20 }, (_, index) =>
      moved(base, index * 0.5, (index - 10) * 2, `R${String(index)}`),
    );
    const tags = nameTags({ ...frame, markers: [own, ...many] }, FRAME);
    expect(tags).toHaveLength(MAXIMUM_NAME_TAGS);
    expect(tags.map((tag) => tag.label)).toEqual(
      Array.from({ length: MAXIMUM_NAME_TAGS }, (_, index) => `R${String(index)}`).reverse(),
    );
  });

  it('keeps the nearer rider’s name where two would cover each other', () => {
    const frame = frameWith([rider(1, 12, 'R')]);
    const own = frame.markers[0] as RiderMarker;
    const base = frame.markers.find((each) => each.kind === 'remote') as RiderMarker;
    // One straight behind the other up the road: their names would meet.
    const inLine = nameTags(
      { ...frame, markers: [own, moved(base, 4, 0, 'Farther'), moved(base, 0, 0, 'Nearer')] },
      FRAME,
    );
    expect(inLine.map((tag) => tag.label)).toEqual(['Nearer']);
    // The control: the same two three metres apart across the road keep both.
    const apart = nameTags(
      { ...frame, markers: [own, moved(base, 4, 3, 'Farther'), moved(base, 0, 0, 'Nearer')] },
      FRAME,
    );
    expect(apart.map((tag) => tag.label)).toEqual(['Farther', 'Nearer']);
    // And a frame with no size names nobody.
    expect(nameTags(frame, { width: 0, height: 0 })).toEqual([]);
  });

  it('keeps the followed rider’s name over a nearer one it would meet', () => {
    const frame = frameWith([rider(1, 12, 'R')]);
    const own = frame.markers[0] as RiderMarker;
    const base = frame.markers.find((each) => each.kind === 'remote') as RiderMarker;
    const followed = { ...moved(base, 4, 0, 'Followed'), followed: true };
    const tags = nameTags(
      { ...frame, markers: [own, followed, moved(base, 0, 0, 'Nearer')] },
      FRAME,
    );
    expect(tags.map((tag) => tag.label)).toEqual(['Followed']);
  });

  it('estimates a name’s width up to the twelve ems `theme.css` cuts it at', () => {
    expect(nameTagWidthPx('Bea')).toBeLessThan(nameTagWidthPx('Bea Ng'));
    expect(nameTagWidthPx('W'.repeat(32))).toBe(nameTagWidthPx('W'.repeat(20)));
    expect(NAME_TAG_HEIGHT_PX).toBeGreaterThan(16);
  });

  it('names only riders the realistic world draws as well — never one past its split', () => {
    // A crowd right behind the rider, out of shot, and one named rider ahead:
    // the realistic world draws the nearest NAMED_RIDERS_DRAWN by straight-line
    // distance, and the one ahead is not among them.
    const behind = Array.from({ length: NAMED_RIDERS_DRAWN }, (_, index) =>
      rider(100 + index, -1 - index * 0.2),
    );
    const frame = frameWith([...behind, rider(1, 30, 'Not drawn')]);
    const split = realisticRemoteSplit(frame.markers);
    const drawnInRealistic = new Set([...split.realistic, ...split.stylised]);
    const ahead = frame.markers.find((marker) => marker.label === 'Not drawn');
    expect(ahead).toBeDefined();
    expect(drawnInRealistic.has(ahead as RiderMarker)).toBe(false);
    expect(nameTags(frame, FRAME)).toEqual([]);
    // With the crowd one rider smaller, they are drawn — and named.
    const fewer = frameWith([...behind.slice(1), rider(1, 30, 'Drawn')]);
    expect(nameTags(fewer, FRAME).map((tag) => tag.label)).toEqual(['Drawn']);
  });
});

describe('the names on the page — #783', () => {
  const canvas = { offsetLeft: 10, offsetTop: 20, clientWidth: 400, clientHeight: 200 };

  it('lays the layer over the canvas and one name per tag, as text and never as markup', () => {
    const layer = document.createElement('div');
    layNameTags(layer, canvas, [
      { label: '<b>Bea</b>', left: 0.5, top: 0.25 },
      { label: 'Cai', left: 0.1, top: 0.9 },
    ]);
    expect(layer.style.left).toBe('10px');
    expect(layer.style.top).toBe('20px');
    expect(layer.style.width).toBe('400px');
    expect(layer.style.height).toBe('200px');
    const names = [...layer.querySelectorAll(`.${NAME_TAG_CLASS}`)];
    expect(names.map((name) => name.textContent)).toEqual(['<b>Bea</b>', 'Cai']);
    expect(layer.querySelector('b')).toBeNull();
    expect((names[0] as HTMLElement).style.transform).toBe(
      'translate(200px, 50px) translate(-50%, -100%)',
    );
    expect((names[1] as HTMLElement).style.transform).toBe(
      'translate(40px, 180px) translate(-50%, -100%)',
    );
  });

  it('reuses the elements frame to frame, and takes every name away when there are none', () => {
    const layer = document.createElement('div');
    layNameTags(layer, canvas, [
      { label: 'Bea', left: 0.5, top: 0.5 },
      { label: 'Cai', left: 0.6, top: 0.5 },
    ]);
    const first = layer.children[0];
    layNameTags(layer, canvas, [{ label: 'Dee', left: 0.4, top: 0.5 }]);
    expect(layer.childElementCount).toBe(1);
    expect(layer.children[0]).toBe(first);
    expect(layer.textContent).toBe('Dee');
    layNameTags(layer, canvas, []);
    expect(layer.childElementCount).toBe(0);
  });
});
