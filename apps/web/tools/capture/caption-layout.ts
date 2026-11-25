// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Where a caption of the demo video goes on the frame — #3156, epic #3151.
 *
 * The capture tool measures the frame in the page — the caption's own size,
 * the HUD panel a callout explains, the map credit and every other HUD panel
 * — and asks {@link placeCaption} where to draw it. The answer is from those
 * boxes alone, so a callout lines up with its panel at any frame size, and a
 * frame where the rules cannot be kept is refused rather than drawn:
 *
 * - **inside the title-safe area**, {@link TITLE_SAFE_SHARE} in from each edge;
 * - **never over the panel it explains or the map credit** (the epic's rule):
 *   those are `hard` boxes, never crossed;
 * - over no other HUD panel either where the frame has room (`soft` boxes),
 *   so a caption does not hide a reading it is not about.
 *
 * Pure: no DOM, no clock. `render-script.ts` measures and draws.
 */

/** A box on the frame, in CSS pixels from its top left. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A point on the frame. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** How far in from each edge the title-safe area starts: 5 % (the epic's). */
export const TITLE_SAFE_SHARE = 0.05;

/** The space between a callout and the panel it explains, as a share of the frame's height. */
export const CALLOUT_GAP_SHARE = 0.04;

/** Whether `a` and `b` share any area: boxes that only touch do not. */
export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Whether `inner` lies wholly inside `outer`. */
export function inside(inner: Box, outer: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The title-safe area of a `width` × `height` frame. */
export function titleSafe(width: number, height: number): Box {
  const x = width * TITLE_SAFE_SHARE;
  const y = height * TITLE_SAFE_SHARE;
  return { x, y, width: width - 2 * x, height: height - 2 * y };
}

/** The point of `box` nearest `point`. */
export function nearestPoint(box: Box, point: Point): Point {
  return {
    x: Math.min(box.x + box.width, Math.max(box.x, point.x)),
    y: Math.min(box.y + box.height, Math.max(box.y, point.y)),
  };
}

/** The least box holding both `a` and `b`. */
function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function centre(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** What {@link placeCaption} is asked. */
export interface CaptionRequest {
  readonly frame: { readonly width: number; readonly height: number };
  /** The caption's size, as the page laid it out. */
  readonly size: { readonly width: number; readonly height: number };
  /**
   * - `title`: centred, above the middle;
   * - `lower-third`: centred, low in the frame;
   * - `callout`: beside {@link target}, with a leader line to it;
   * - `card`: the whole frame.
   */
  readonly placement: 'title' | 'lower-third' | 'callout' | 'card';
  /** The HUD panel a callout explains. */
  readonly target?: Box | undefined;
  /** Boxes the caption may never cross: the map credit. */
  readonly hard: readonly Box[];
  /** Boxes the caption crosses only when the frame has no room clear of them: the other HUD panels. */
  readonly soft: readonly Box[];
}

/** Where a caption is drawn, and its leader line when it is a callout. */
export interface CaptionPlace {
  readonly box: Box;
  /** From the caption's edge to the panel's, for a callout. */
  readonly leader?: { readonly from: Point; readonly to: Point } | undefined;
}

/** The boxes, in the order they are tried, where a caption of `request` might go. */
function candidates(request: CaptionRequest, safe: Box): Box[] {
  const { width, height } = request.size;
  const at = (x: number, y: number): Box => ({ x, y, width, height });
  const middle = safe.x + (safe.width - width) / 2;
  const bottom = safe.y + safe.height - height;
  const step = Math.max(1, request.frame.height * 0.02);
  const found: Box[] = [];
  if (request.placement === 'title') {
    // Above the middle, then a step at a time further up, then down.
    const top = request.frame.height * 0.4 - height / 2;
    for (let y = top; y >= safe.y; y -= step) found.push(at(middle, y));
    for (let y = top + step; y <= bottom; y += step) found.push(at(middle, y));
    return found;
  }
  if (request.placement === 'lower-third') {
    for (let y = bottom; y >= safe.y; y -= step) found.push(at(middle, y));
    return found;
  }
  if (request.target === undefined) return found;
  // A callout: below its panel, then above, then right, then left, each as
  // near the panel as the gap allows and slid along it toward the middle of
  // the frame until a place is clear. A reading inside a larger panel is
  // called out from outside that panel, so the gap is from both together.
  const target = request.soft
    .filter((panel) => inside(request.target as Box, panel))
    .reduce(union, request.target);
  const gap = request.frame.height * CALLOUT_GAP_SHARE;
  const along = (from: number, to: number, fixed: (offset: number) => Box): void => {
    const span = Math.abs(to - from);
    for (let moved = 0; moved <= span; moved += step) {
      found.push(fixed(from + Math.sign(to - from) * moved));
    }
  };
  const frameMiddle = centre({ x: 0, y: 0, ...request.frame });
  const xNear = Math.min(
    safe.x + safe.width - width,
    Math.max(safe.x, centre(request.target).x - width / 2),
  );
  const yNear = Math.min(
    safe.y + safe.height - height,
    Math.max(safe.y, centre(request.target).y - height / 2),
  );
  along(xNear, frameMiddle.x - width / 2, (x) => at(x, target.y + target.height + gap));
  along(xNear, frameMiddle.x - width / 2, (x) => at(x, target.y - gap - height));
  along(yNear, frameMiddle.y - height / 2, (y) => at(target.x + target.width + gap, y));
  along(yNear, frameMiddle.y - height / 2, (y) => at(target.x - gap - width, y));
  return found;
}

/**
 * Where to draw a caption of `request`, or `undefined` when the frame has no
 * place that keeps the rules: a caption is never drawn over the panel it
 * explains or the map credit, nor outside the title-safe area. A `card` is
 * the whole frame, so it is refused over a frame that shows a hard box.
 */
export function placeCaption(request: CaptionRequest): CaptionPlace | undefined {
  const { width, height } = request.frame;
  if (request.placement === 'card') {
    const box = { x: 0, y: 0, width, height };
    return request.hard.some((each) => intersects(box, each)) ? undefined : { box };
  }
  const safe = titleSafe(width, height);
  // A callout's places are all a gap outside its panel (`candidates`), so
  // none crosses the panel it explains; `caption-layout.test.ts` sweeps it.
  const allowed = candidates(request, safe).filter(
    (box) => inside(box, safe) && !request.hard.some((each) => intersects(box, each)),
  );
  const box =
    allowed.find((each) => !request.soft.some((panel) => intersects(each, panel))) ?? allowed[0];
  if (box === undefined) return undefined;
  if (request.placement !== 'callout' || request.target === undefined) return { box };
  const from = nearestPoint(box, centre(request.target));
  return { box, leader: { from, to: nearestPoint(request.target, from) } };
}

/**
 * The least width, in whole pixels, at which a caption that is `natural` in
 * size at its widest is still no taller — #3175's review. A caption that
 * wraps is drawn at it, so its lines are even and its box has no empty side;
 * one that fits on a line keeps its own width.
 *
 * `heightAt` lays the caption out at a width and answers its height.
 */
export async function balancedWidth(
  natural: { readonly width: number; readonly height: number },
  heightAt: (width: number) => Promise<number>,
): Promise<number> {
  let fits = Math.ceil(natural.width);
  let tooNarrow = 0;
  while (fits - tooNarrow > 1) {
    const middle = Math.floor((fits + tooNarrow) / 2);
    if ((await heightAt(middle)) <= natural.height + 0.5) fits = middle;
    else tooNarrow = middle;
  }
  return fits;
}
