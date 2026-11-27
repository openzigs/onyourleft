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
   * route runs. With it each letter is laid rigid on the road's own height
   * ({@link streetNamesInView}'s `heightAlong`), not on the ground under its
   * corners.
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

/** Whether a letter's four corners make edges no longer than {@link STREET_NAME_MAX_STRETCH} times its painted size. */
function paintedSize(quad: readonly number[]): boolean {
  const edge = (a: number, b: number): number =>
    Math.hypot(
      (quad[b * 3] as number) - (quad[a * 3] as number),
      (quad[b * 3 + 1] as number) - (quad[a * 3 + 1] as number),
      (quad[b * 3 + 2] as number) - (quad[a * 3 + 2] as number),
    );
  const along = STREET_NAME_GLYPH_ADVANCE_METRES * STREET_NAME_MAX_STRETCH;
  const across = STREET_NAME_GLYPH_HEIGHT_METRES * STREET_NAME_MAX_STRETCH;
  return edge(0, 1) <= along && edge(3, 2) <= along && edge(0, 3) <= across && edge(1, 2) <= across;
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
   * stands on `heightAt`.
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
    const letters = Array.from(label.text);
    if (cells.length + letters.length > STREET_NAME_GLYPHS_PER_FRAME) continue;
    const y = heightAt(label.x, label.z);
    if (y === undefined) continue;
    // The letters' tops away from the rider: `up` across the street, the
    // reading direction a quarter turn from it (`x` is WEST: east is −x).
    // #3261's tablet check: a route ride's label always away from a rider
    // keeping right on the way the route runs, so it is never turned over
    // as the rider passes it or moves across the road.
    let upX = -label.alongZ;
    let upZ = label.alongX;
    if (
      label.along === undefined ? upX * (label.x - rider.x) + upZ * (label.z - rider.z) < 0 : true
    ) {
      upX = -upX;
      upZ = -upZ;
    }
    const readX = -upZ;
    const readZ = upX;
    const width = STREET_NAME_GLYPH_ADVANCE_METRES;
    const height = STREET_NAME_GLYPH_HEIGHT_METRES;
    const start = -paintedLength(label.text) / 2;
    // Which way the name reads along the route: +1 the way the route runs.
    const reads = readX * label.alongX + readZ * label.alongZ < 0 ? -1 : 1;
    const along = label.along;
    const quad: number[] = [];
    let any = false;
    for (const [index, letter] of letters.entries()) {
      const cell = glyphCell(letter) as number;
      const from = start + index * width;
      quad.length = 0;
      for (const [offset, up] of [
        [from, -height / 2],
        [from + width, -height / 2],
        [from + width, height / 2],
        [from, height / 2],
      ] as const) {
        const x = label.x + readX * offset + upX * up;
        const z = label.z + readZ * offset + upZ * up;
        // Rigid on a route ride: each edge across the road at one height,
        // the road's own there. Otherwise each corner on the ground under it.
        const level =
          along !== undefined && route !== undefined
            ? route.heightAt(along + reads * offset)
            : (heightAt(x, z) ?? y);
        quad.push(x, level + STREET_NAME_LIFT_METRES, z);
      }
      // The last guard: a letter drawn much larger than it is painted is not drawn.
      if (!paintedSize(quad)) continue;
      corners.push(...quad);
      cells.push(cell);
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
