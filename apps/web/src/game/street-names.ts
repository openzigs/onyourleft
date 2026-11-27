// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Street names painted on the road** — #3052, under ADR 0096.
 *
 * An open-world ride draws each mapped street's name on its own surface, so a
 * junction reads as named streets before the rider reaches it, as the owner
 * asked on 2026-11-22 ("Can put them on the pavement").
 *
 * ## Where a name is painted ({@link streetNameLabels})
 *
 * From the street graph's edges, each a street from one junction to the next
 * (`@onyourleft/map-features` §`StreetGraphEdge`), with its mapped `name`:
 *
 * - **at each mouth**: {@link STREET_NAME_MOUTH_METRES} clear of each end's
 *   junction, so the side street's name is in front of a rider waiting at it
 *   and the ridden street's is just past the junction;
 * - **and every {@link STREET_NAME_REPEAT_METRES}** between, on a long edge;
 * - **only where the whole name fits** on the edge, and only a name every
 *   character of which is in the glyph atlas ({@link paintable}). A name with
 *   any other is named by the junction prompt alone (#3052's i18n row).
 *
 * An edge with no name has no label: nothing invents one.
 *
 * ## What a frame draws ({@link streetNamesInView})
 *
 * The {@link STREET_NAMES_PER_FRAME} labels nearest the rider within
 * {@link STREET_NAME_VIEW_METRES}, chosen again only each
 * {@link STREET_NAME_REFRESH_METRES} ridden, so the one mesh that draws them
 * (`three-renderer.ts` §`StreetNameBelt`) is rebuilt every so often and not
 * every frame. Each label is laid along its street, letters
 * {@link STREET_NAME_GLYPH_HEIGHT_METRES} tall across it and
 * {@link STREET_NAME_GLYPH_ADVANCE_METRES} apart along it, read from the side
 * the rider is on when it is chosen: the letters' tops away from the rider,
 * as a name painted across a side street reads from the road it meets.
 *
 * ## A route ride's name reads across its lane ({@link routeNameLayout})
 *
 * A label with a route distance (`route-street-names.ts`, #3245) is painted
 * as a real road marking is — the owner's ruling of 2026-11-26 on #3344, as
 * "SLOW" or "BUS" is painted: in the rider's own lane, right of the centre
 * line, each letter upright to the approaching rider (its up along the way the
 * route runs) and {@link ROUTE_STREET_NAME_STRETCH} times as long along the
 * road as it is wide, so it reads at a shallow angle. The name reads left to
 * right across the lane; one too wide for it is wrapped at a space onto two
 * lines, stacked along the road with the first nearest the rider, and what is
 * still too wide is shrunk, never past the lane's lines. The open world's
 * labels keep their style above.
 *
 * ## Cost
 *
 * **One draw call** for every name in view, however many streets there are:
 * one mesh, one material and one texture, the glyph atlas
 * ({@link STREET_NAME_CHARSET}, drawn once). At most
 * {@link STREET_NAME_GLYPHS_PER_FRAME} quads, two triangles each.
 *
 * ⚠️ **A street name is map data, not the rider's place** (ADR 0096): it is
 * drawn and said, and never logged, stored or sent. Nothing here formats a
 * coordinate into a string.
 *
 * Pure, and names no rendering library.
 */

import { CENTRE_LINE_WIDTH_METRES, EDGE_LINE_WIDTH_METRES, ROAD_WIDTH_METRES } from './terrain';

/**
 * Every character the glyph atlas holds, in its cell order: printable ASCII,
 * the Latin-1 letters and a few typographic marks a US street name carries.
 */
export const STREET_NAME_CHARSET =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~' +
  'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÑÒÓÔÕÖØÙÚÛÜÝßàáâãäåæçèéêëìíîïñòóôõöøùúûüýÿ’‘“”–—·';

/** How many cells a row of the glyph atlas holds. */
export const STREET_NAME_ATLAS_COLUMNS = 16;

/** How many rows of cells the glyph atlas holds. */
export const STREET_NAME_ATLAS_ROWS = Math.ceil(
  Array.from(STREET_NAME_CHARSET).length / STREET_NAME_ATLAS_COLUMNS,
);

const CELLS = new Map<string, number>(
  Array.from(STREET_NAME_CHARSET, (character, index) => [character, index]),
);

/** A character's cell in the glyph atlas, or `undefined` for one it does not hold. */
export function glyphCell(character: string): number | undefined {
  return CELLS.get(character);
}

/** Whether every character of `text` is in the glyph atlas. */
export function paintable(text: string): boolean {
  return Array.from(text).every((character) => CELLS.has(character));
}

/** How tall a painted letter is, across its street, in metres: **2.6**. Inside a 5.5 m minor street. */
export const STREET_NAME_GLYPH_HEIGHT_METRES = 2.6;

/**
 * How far apart painted letters are, along their street, in metres: **1.5**.
 * Narrower than tall, as road paint is, and wide enough to read at the chase
 * camera's 25 m look-ahead.
 */
export const STREET_NAME_GLYPH_ADVANCE_METRES = 1.5;

/** How far a name's nearest letter is kept from the junction at each end of its street, metres: **6**. */
export const STREET_NAME_MOUTH_METRES = 6;

/** How far apart a long street's names are, metres: **200**. */
export const STREET_NAME_REPEAT_METRES = 200;

/** How far from the rider a name is drawn, metres: **160**, where its letters are still more than a pixel or two. */
export const STREET_NAME_VIEW_METRES = 160;

/** How many names a frame draws at most: **24**, the nearest first. */
export const STREET_NAMES_PER_FRAME = 24;

/** How many letters a frame draws at most: **720**, a full {@link STREET_NAMES_PER_FRAME} of 30-letter names. */
export const STREET_NAME_GLYPHS_PER_FRAME = 720;

/** How far the rider rides before the names in view are chosen again, metres: **20**. */
export const STREET_NAME_REFRESH_METRES = 20;

/** How far above the street's surface a name stands, metres: **0.03**, over the side roads' own lift. */
export const STREET_NAME_LIFT_METRES = 0.03;

/**
 * How much longer than its painted size a letter's drawn edge may be before
 * the letter is not drawn at all: **1.5** times — #3261's second tablet
 * check, a last guard, so no placement can ever paint a glyph many times its
 * size across the road.
 */
export const STREET_NAME_MAX_STRETCH = 1.5;

/**
 * How much further along the route than in a straight line a route ride's
 * label may be from the rider and still be on the rider's own pass, metres:
 * **30**. #3261's second tablet check: on an out-and-back the way back's
 * label lies beside the way out, at the way back's recorded height, where
 * only the way out's road is drawn (`landform.ts` §"A road ridden twice"); so
 * it floated over the rider, many times its size on the screen. It is drawn
 * when the rider is on its pass.
 */
export const STREET_NAME_PASS_SLACK_METRES = 30;

/**
 * How much longer along the road than across it a route ride's letter is
 * painted, against the glyph atlas's own square cell: **2.75** — #3344, the
 * owner's "about 2.5 to 3× tall", as road-marking type is stretched to read
 * at a shallow viewing angle.
 */
export const ROUTE_STREET_NAME_STRETCH = 2.75;

/**
 * How wide a route ride's letter is painted across its lane at the most,
 * metres: **0.7**, four to the lane, as "SLOW" is. A name wider than its lane
 * at that is wrapped, then shrunk ({@link routeNameLayout}).
 */
export const ROUTE_STREET_NAME_GLYPH_WIDTH_METRES = 0.7;

/** How far inside its lane's lines a route ride's name is kept, metres: **0.2**. */
export const ROUTE_STREET_NAME_LANE_MARGIN_METRES = 0.2;

/** How far apart a wrapped name's two lines are along the road, as a share of a letter's length: **0.5**. */
export const ROUTE_STREET_NAME_LINE_GAP_SHARE = 0.5;

/**
 * The near and far side of the room a route ride's name has, metres right of
 * the centreline: the rider's lane (`lanes.ts` keeps right), from the centre
 * line's right edge to the right edge line, each
 * {@link ROUTE_STREET_NAME_LANE_MARGIN_METRES} in.
 */
const LANE_INNER_METRES = CENTRE_LINE_WIDTH_METRES / 2 + ROUTE_STREET_NAME_LANE_MARGIN_METRES;
const LANE_OUTER_METRES =
  ROAD_WIDTH_METRES / 2 - EDGE_LINE_WIDTH_METRES - ROUTE_STREET_NAME_LANE_MARGIN_METRES;

/** How wide a line of a route ride's name may be, metres: **2.875**. */
export const ROUTE_STREET_NAME_LINE_WIDTH_METRES = LANE_OUTER_METRES - LANE_INNER_METRES;

/** How a route ride's name is laid across its lane — #3344. @see routeNameLayout */
export interface RouteNameLayout {
  /** One or two lines, the first nearest the approaching rider. */
  readonly lines: readonly string[];
  /** How many letters the lines hold. */
  readonly letters: number;
  /** How wide each letter is, across the lane, metres. */
  readonly width: number;
  /** How long each letter is, along the road, metres: {@link ROUTE_STREET_NAME_STRETCH} times its width. */
  readonly length: number;
  /** From the near edge of the first line to the far edge of the last, along the road, metres. */
  readonly extent: number;
}

/**
 * How a route ride's `text` is painted across the rider's lane — #3344: on
 * one line where it fits at {@link ROUTE_STREET_NAME_GLYPH_WIDTH_METRES} a
 * letter; else wrapped at the space that makes its longer line shortest; and
 * every letter shrunk alike until the longer line fits
 * {@link ROUTE_STREET_NAME_LINE_WIDTH_METRES}. A name with no space is shrunk.
 */
export function routeNameLayout(text: string): RouteNameLayout {
  const characters = Array.from(text.trim());
  let lines = [characters];
  if (
    characters.length * ROUTE_STREET_NAME_GLYPH_WIDTH_METRES >
    ROUTE_STREET_NAME_LINE_WIDTH_METRES
  ) {
    let longest = characters.length;
    for (const [index, character] of characters.entries()) {
      if (character !== ' ') continue;
      const first = Array.from(characters.slice(0, index).join('').trim());
      const second = Array.from(
        characters
          .slice(index + 1)
          .join('')
          .trim(),
      );
      const longer = Math.max(first.length, second.length);
      if (first.length > 0 && second.length > 0 && longer < longest) {
        longest = longer;
        lines = [first, second];
      }
    }
  }
  const longest = Math.max(1, ...lines.map((line) => line.length));
  const width = Math.min(
    ROUTE_STREET_NAME_GLYPH_WIDTH_METRES,
    ROUTE_STREET_NAME_LINE_WIDTH_METRES / longest,
  );
  const length = ROUTE_STREET_NAME_STRETCH * width;
  return {
    lines: lines.map((line) => line.join('')),
    letters: lines.reduce((sum, line) => sum + line.length, 0),
    width,
    length,
    extent: length * (lines.length + (lines.length - 1) * ROUTE_STREET_NAME_LINE_GAP_SHARE),
  };
}

/** A route ride's road, as its labels are laid on it (@see streetNamesInView). */
export interface RouteLabelRoad {
  /** The road's height at a route distance, metres. */
  readonly heightAt: (metres: number) => number;
  /** How far apart two route distances are along the route, metres: round a loop's line the short way. */
  readonly gap: (from: number, to: number) => number;
}

/** A street as the labels read it: its line in local metres and its mapped name, if any. */
export interface NamedStreetLine {
  /** Unique per street: a label's key is made from it. */
  readonly id: string;
  /** `x0, z0, x1, z1, …` in local metres (`x` WEST, `z` north). */
  readonly line: ArrayLike<number>;
  readonly name?: string | undefined;
}

/** One name to paint: where its middle is, and which way its street runs there. */
export interface StreetNameLabel {
  /** Unique across a ride's labels, and the same for the same street and place. */
  readonly key: string;
  readonly text: string;
  readonly x: number;
  readonly z: number;
  /** The street's direction at the label, a unit vector in the ground plane. */
  readonly alongX: number;
  readonly alongZ: number;
  /**
   * A route ride's label only (#3245, `route-street-names.ts`): the route
   * distance of its middle, metres, `alongX, alongZ` pointing the way the
   * route runs. With it the name is painted across the rider's lane
   * ({@link routeNameLayout}, #3344) and each letter laid rigid on the road's
   * own height ({@link streetNamesInView}'s `route`), not on the ground under
   * its corners.
   */
  readonly along?: number | undefined;
}

/** How long `text` is painted, metres. */
export function paintedLength(text: string): number {
  return Array.from(text).length * STREET_NAME_GLYPH_ADVANCE_METRES;
}

/** The point and direction `at` metres along `line`, or `undefined` past its end. */
function along(
  line: ArrayLike<number>,
  at: number,
): { x: number; z: number; alongX: number; alongZ: number } | undefined {
  let travelled = 0;
  for (let index = 0; index + 3 < line.length; index += 2) {
    const ax = line[index] as number;
    const az = line[index + 1] as number;
    const bx = line[index + 2] as number;
    const bz = line[index + 3] as number;
    const length = Math.hypot(bx - ax, bz - az);
    if (!(length > 0)) continue;
    if (travelled + length >= at) {
      const share = (at - travelled) / length;
      return {
        x: ax + (bx - ax) * share,
        z: az + (bz - az) * share,
        alongX: (bx - ax) / length,
        alongZ: (bz - az) / length,
      };
    }
    travelled += length;
  }
  return undefined;
}

function lengthOf(line: ArrayLike<number>): number {
  let total = 0;
  for (let index = 0; index + 3 < line.length; index += 2) {
    total += Math.hypot(
      (line[index + 2] as number) - (line[index] as number),
      (line[index + 3] as number) - (line[index + 1] as number),
    );
  }
  return total;
}

/**
 * Every label of `streets` — #3052: a named street's name at each mouth and
 * every {@link STREET_NAME_REPEAT_METRES} between, where the whole name fits
 * clear of both junctions; none for an unnamed street or a name the atlas
 * cannot paint. @see the header
 */
export function streetNameLabels(streets: Iterable<NamedStreetLine>): StreetNameLabel[] {
  const labels: StreetNameLabel[] = [];
  for (const street of streets) {
    const text = street.name?.trim();
    if (text === undefined || text.length === 0 || !paintable(text)) continue;
    const length = lengthOf(street.line);
    const half = paintedLength(text) / 2;
    const first = STREET_NAME_MOUTH_METRES + half;
    const last = length - first;
    if (last < first) continue;
    const stations = [first];
    for (let at = first + STREET_NAME_REPEAT_METRES; at < last - STREET_NAME_REPEAT_METRES / 2;) {
      stations.push(at);
      at += STREET_NAME_REPEAT_METRES;
    }
    if (last - first > 2 * half + STREET_NAME_MOUTH_METRES) stations.push(last);
    for (const [index, at] of stations.entries()) {
      const place = along(street.line, at);
      if (place === undefined) continue;
      labels.push({ key: `${street.id}:${String(index)}`, text, ...place });
    }
  }
  return labels;
}

/**
 * The names a frame draws: each letter as a quad on the street's surface,
 * four corners of `x, y, z` in local metres, and its cell in the atlas.
 * Corners go bottom-left, bottom-right, top-right, top-left as the letter
 * reads.
 */
export interface StreetNamesInView {
  /** The labels drawn, the nearest the rider first. */
  readonly labels: readonly StreetNameLabel[];
  /** Twelve floats a letter. */
  readonly corners: Float32Array;
  /** One cell a letter. */
  readonly cells: Uint16Array;
}

/** No names: the frame of every ride that has none. */
export const NO_STREET_NAMES: StreetNamesInView = Object.freeze({
  labels: [],
  corners: new Float32Array(0),
  cells: new Uint16Array(0),
});

/**
 * Whether a letter's four corners make edges no longer than
 * {@link STREET_NAME_MAX_STRETCH} times its painted size: `width` from its
 * bottom-left corner to its bottom-right and top-left to top-right, `height`
 * from bottom to top on each side.
 */
export function paintedSize(quad: readonly number[], width: number, height: number): boolean {
  const edge = (a: number, b: number): number =>
    Math.hypot(
      (quad[b * 3] as number) - (quad[a * 3] as number),
      (quad[b * 3 + 1] as number) - (quad[a * 3 + 1] as number),
      (quad[b * 3 + 2] as number) - (quad[a * 3 + 2] as number),
    );
  const wide = width * STREET_NAME_MAX_STRETCH;
  const tall = height * STREET_NAME_MAX_STRETCH;
  return edge(0, 1) <= wide && edge(3, 2) <= wide && edge(0, 3) <= tall && edge(1, 2) <= tall;
}

/** One letter to draw: its cell, its four corners and the size it is painted at. */
interface Letter {
  readonly cell: number;
  /** Twelve floats, as {@link StreetNamesInView.corners} holds them. */
  readonly quad: readonly number[];
  readonly width: number;
  readonly height: number;
}

/**
 * An open-world label's letters (#3052): laid along its street, read from the
 * side the rider is on, each corner standing on the ground under it.
 */
function openWorldLetters(
  label: StreetNameLabel,
  rider: { readonly x: number; readonly z: number },
  heightAt: (x: number, z: number) => number | undefined,
  y: number,
): Letter[] {
  // The letters' tops away from the rider: `up` across the street, the
  // reading direction a quarter turn from it (`x` is WEST: east is −x).
  let upX = -label.alongZ;
  let upZ = label.alongX;
  if (upX * (label.x - rider.x) + upZ * (label.z - rider.z) < 0) {
    upX = -upX;
    upZ = -upZ;
  }
  const readX = -upZ;
  const readZ = upX;
  const width = STREET_NAME_GLYPH_ADVANCE_METRES;
  const height = STREET_NAME_GLYPH_HEIGHT_METRES;
  const start = -paintedLength(label.text) / 2;
  return Array.from(label.text, (letter, index) => {
    const from = start + index * width;
    const quad: number[] = [];
    for (const [offset, up] of [
      [from, -height / 2],
      [from + width, -height / 2],
      [from + width, height / 2],
      [from, height / 2],
    ] as const) {
      const x = label.x + readX * offset + upX * up;
      const z = label.z + readZ * offset + upZ * up;
      quad.push(x, (heightAt(x, z) ?? y) + STREET_NAME_LIFT_METRES, z);
    }
    return { cell: glyphCell(letter) as number, quad, width, height };
  });
}

/**
 * A route ride's label's letters — #3344, as a road marking reads: in the
 * rider's lane, right of the centre line; each letter upright to the
 * approaching rider, its up the way the route runs and its bottom edge
 * across the lane; the lines of {@link routeNameLayout} left to right across
 * the lane, the first line nearest. Each letter rigid on the road's height at
 * its route distance (#3261's tablet checks): level across the road, tilted
 * only with its grade, the same on every frame. With no `route`, each corner
 * stands on the ground under it.
 */
function routeLetters(
  label: StreetNameLabel,
  layout: RouteNameLayout,
  heightAt: (x: number, z: number) => number | undefined,
  y: number,
  route: RouteLabelRoad | undefined,
): Letter[] {
  const along = label.along as number;
  // The rider's right, keeping right on the way the route runs (`x` is WEST).
  const rightX = -label.alongZ;
  const rightZ = label.alongX;
  const { width, length } = layout;
  const middle = (LANE_INNER_METRES + LANE_OUTER_METRES) / 2;
  const letters: Letter[] = [];
  for (const [line, text] of layout.lines.entries()) {
    const characters = Array.from(text);
    const near = -layout.extent / 2 + line * length * (1 + ROUTE_STREET_NAME_LINE_GAP_SHARE);
    const left = middle - (characters.length * width) / 2;
    for (const [index, letter] of characters.entries()) {
      const from = left + index * width;
      const quad: number[] = [];
      for (const [across, ahead] of [
        [from, near],
        [from + width, near],
        [from + width, near + length],
        [from, near + length],
      ] as const) {
        const x = label.x + rightX * across + label.alongX * ahead;
        const z = label.z + rightZ * across + label.alongZ * ahead;
        const level = route === undefined ? (heightAt(x, z) ?? y) : route.heightAt(along + ahead);
        quad.push(x, level + STREET_NAME_LIFT_METRES, z);
      }
      letters.push({ cell: glyphCell(letter) as number, quad, width, height: length });
    }
  }
  return letters;
}

/** The last choice, by labels: reused until the rider moves on. */
const chosen = new WeakMap<
  readonly StreetNameLabel[],
  { readonly at: number; readonly view: StreetNamesInView }
>();

/**
 * The names in view of a rider standing at `rider` (local metres), each laid
 * on the street's surface as `heightAt` gives it — #3052. The same object
 * until the rider is {@link STREET_NAME_REFRESH_METRES} farther on, so the
 * mesh is not rebuilt between. @see the header
 */
export function streetNamesInView(
  labels: readonly StreetNameLabel[],
  rider: { readonly x: number; readonly z: number },
  riderMetres: number,
  heightAt: (x: number, z: number) => number | undefined,
  /**
   * A route ride's road — #3261's tablet checks. A label with
   * {@link StreetNameLabel.along} is drawn only while the rider is on its
   * pass ({@link STREET_NAME_PASS_SLACK_METRES}), and laid on the road's
   * height there: every letter a rigid rectangle, level across the road and
   * tilted only with its grade, at the same place on every frame. Without
   * it, or for a label with no `along` (an open-world street's), each corner
   * stands on `heightAt`. A label with `along` reads across the rider's lane
   * either way (#3344, {@link routeNameLayout}).
   */
  route?: RouteLabelRoad,
): StreetNamesInView {
  if (labels.length === 0) return NO_STREET_NAMES;
  const at = Math.floor(riderMetres / STREET_NAME_REFRESH_METRES);
  const last = chosen.get(labels);
  if (last?.at === at) return last.view;
  const near: { label: StreetNameLabel; gap: number }[] = [];
  for (const label of labels) {
    const gap = Math.hypot(label.x - rider.x, label.z - rider.z);
    if (gap > STREET_NAME_VIEW_METRES) continue;
    // A route label on another pass of the road than the rider's is not drawn.
    if (
      label.along !== undefined &&
      route !== undefined &&
      route.gap(riderMetres, label.along) > gap + STREET_NAME_PASS_SLACK_METRES
    ) {
      continue;
    }
    near.push({ label, gap });
  }
  near.sort((a, b) => a.gap - b.gap || (a.label.key < b.label.key ? -1 : 1));
  const drawn: StreetNameLabel[] = [];
  const corners: number[] = [];
  const cells: number[] = [];
  for (const { label } of near) {
    if (drawn.length >= STREET_NAMES_PER_FRAME) break;
    const layout = label.along === undefined ? undefined : routeNameLayout(label.text);
    const count = layout?.letters ?? Array.from(label.text).length;
    if (cells.length + count > STREET_NAME_GLYPHS_PER_FRAME) continue;
    const y = heightAt(label.x, label.z);
    if (y === undefined) continue;
    const letters =
      layout === undefined
        ? openWorldLetters(label, rider, heightAt, y)
        : routeLetters(label, layout, heightAt, y, route);
    let any = false;
    for (const letter of letters) {
      // The last guard: a letter drawn much larger than it is painted is not drawn.
      if (!paintedSize(letter.quad, letter.width, letter.height)) continue;
      corners.push(...letter.quad);
      cells.push(letter.cell);
      any = true;
    }
    if (any) drawn.push(label);
  }
  const view: StreetNamesInView =
    drawn.length === 0
      ? NO_STREET_NAMES
      : { labels: drawn, corners: Float32Array.from(corners), cells: Uint16Array.from(cells) };
  chosen.set(labels, { at, view });
  return view;
}
