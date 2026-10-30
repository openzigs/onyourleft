// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Other riders' names, on the road** — #783: *"up to K nearest remote riders
 * on the road with their names, in both the stylised and realistic worlds"*.
 *
 * ## How they are drawn, and why not by the renderer
 *
 * A name is DOM laid over the world, placed each drawn frame where
 * `camera.ts` §`projectToFrame` puts the point above that rider's helmet. The
 * renderer draws no text: a name drawn into the scene would be a texture and
 * a draw call (the stylised world's budget is draw calls, held at
 * `SCENE_DRAW_CALLS`) or triangles (the realistic world's), and as DOM it is
 * neither — and it is the same in both worlds, because both are seen through
 * the same camera.
 *
 * ## Whose name
 *
 * Only what {@link RiderMarker.label} carries: the room's public name for a
 * rider (#774), which only a race's room sends (ADR 0051 D-3, so a group ride
 * names nobody), and the seat label of the one rider *Follow* chose. Nothing
 * else about a rider is written here — no figure at all, so neither watts nor
 * W/kg (ruling Q17 is about what is beside a name; here nothing is).
 *
 * ## Which riders
 *
 * 1. **Only riders the frame draws in either world.** The realistic world
 *    draws the nearest {@link NAMED_RIDERS_DRAWN} remote riders and no more
 *    (`three-renderer.ts` §`realisticRemoteSplit`), by straight-line
 *    distance from the rider's own marker; this ranks by the same measure and
 *    names none past it, so a name never floats over a rider who is not there.
 * 2. **In front of the eye, inside the frame, and within**
 *    {@link NAME_TAG_METRES} of it.
 * 3. **At most {@link MAXIMUM_NAME_TAGS}**, the nearest to the eye, and
 * 4. **none over another**: the followed rider's first, then nearest first,
 *    a name that would cover one already kept is left out.
 *
 * ⚠️ **Nothing here is a standing.** The ranking is internal, like the
 * interest set's; what reaches the page is where each name is, and the page
 * has them in painting order — the farthest first, so a nearer rider's name
 * is over a farther one's, as their bodies are — which is the depth of the
 * picture and not who is winning. The layer is `aria-hidden`: everything it
 * says is on the HUD as text (the followed rider's name, a race's standings).
 */

import { cameraRig, projectToFrame } from './camera';
import { RIDER_HEIGHT_METRES, RIDER_HELMET_AHEAD_METRES } from './bicycle';
import type { RiderMarker, SceneFrame } from './port';
import { REALISTIC_REMOTE_RIDERS, REALISTIC_REMOTE_STYLISED_RIDERS } from './realistic-budget';

/**
 * How far from the camera a rider is still named: **60 m**. Chosen: past it a
 * rider is a few pixels tall on a phone, and a name the size of the HUD's
 * smallest text over them would be larger than they are.
 */
export const NAME_TAG_METRES = 60;

/**
 * The most names on the road at once: **8**. Chosen: a bunch of riders drawn
 * close together would otherwise be a stack of labels hiding the road.
 */
export const MAXIMUM_NAME_TAGS = 8;

/** How far above the top of the helmet a name sits, in metres. Chosen. */
export const NAME_TAG_ABOVE_METRES = 0.15;

/**
 * The most remote riders a frame draws in BOTH worlds — the realistic world's
 * two realistic bodies and its stylised riders beside them
 * (`realistic-budget.ts`); the stylised world draws every one. A name is only
 * ever over one of these. @see nameTags
 */
export const NAMED_RIDERS_DRAWN = REALISTIC_REMOTE_RIDERS + REALISTIC_REMOTE_STYLISED_RIDERS;

/** One name on the road. */
export interface NameTag {
  readonly label: string;
  /** Where the bottom middle of the name goes, as fractions of the frame from its top left. */
  readonly left: number;
  readonly top: number;
}

/**
 * The point a rider's name hangs from: {@link NAME_TAG_ABOVE_METRES} over the
 * top of their helmet, rolled with them. The helmet is where `camera.ts`
 * §`riderFrameBox` takes it; the roll is the bicycle's lean and the body's
 * own roll on top of it, applied to the whole height — a little more than the
 * body really moves, which is too small to see on a name.
 */
function hangsFrom(marker: RiderMarker): {
  readonly x: number;
  readonly y: number;
  readonly z: number;
} {
  const height = RIDER_HEIGHT_METRES + NAME_TAG_ABOVE_METRES;
  const roll = marker.lean + marker.bodyLean;
  // The road's normal, the rider's right: positive lean tips the top toward it.
  const normalX = -marker.headingZ;
  const normalZ = marker.headingX;
  const across = height * Math.sin(roll);
  return {
    x: marker.x + marker.headingX * RIDER_HELMET_AHEAD_METRES + normalX * across,
    y: marker.y + height * Math.cos(roll),
    z: marker.z + marker.headingZ * RIDER_HELMET_AHEAD_METRES + normalZ * across,
  };
}

/**
 * The HUD's small text, `theme.css` `--oyl-font-size-sm` (0.8 rem), in CSS
 * pixels at the default 16 px root — what `.oyl-game__name` is set in.
 */
const NAME_TAG_FONT_PX = 12.8;

/** About how tall a name is on the page: its line (1.3) and its border. */
export const NAME_TAG_HEIGHT_PX = Math.ceil(NAME_TAG_FONT_PX * 1.3) + 2;

/**
 * About how wide a name is on the page: 0.6 em a character, at most the
 * 12 em `.oyl-game__name` cuts it at, with its padding and border. An
 * estimate, so that two names are kept apart without reading the page.
 */
export function nameTagWidthPx(label: string): number {
  return Math.min([...label].length * 0.6, 12) * NAME_TAG_FONT_PX + 10;
}

/** A frame's size on the page, in CSS pixels. */
export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The names to lay over this frame, in painting order (the farthest first),
 * for a frame of this size. Empty when no drawn rider carries a label.
 *
 * Nearest first, a name that would cover one already kept is left out — the
 * nearer rider keeps theirs — so riders drawn close together on the screen,
 * one behind another up the road, are not a pile of labels.
 */
export function nameTags(frame: SceneFrame, size: FrameSize): readonly NameTag[] {
  if (!(size.width > 0 && size.height > 0)) return [];
  const aspect = size.width / size.height;
  const remote = frame.markers.filter((marker) => marker.kind === 'remote');
  if (!remote.some((marker) => marker.label !== undefined)) return [];
  const own = frame.markers.find((marker) => marker.kind === 'rider');
  const far = (marker: RiderMarker): number =>
    own === undefined ? 0 : Math.hypot(marker.x - own.x, marker.y - own.y, marker.z - own.z);
  // The rule `realisticRemoteSplit` draws by, so a name is over a drawn rider.
  const drawn = remote
    .map((marker) => ({ marker, far: far(marker) }))
    .sort((a, b) => a.far - b.far)
    .slice(0, NAMED_RIDERS_DRAWN)
    .map((each) => each.marker);
  const rig = cameraRig(frame.camera);
  const seen: { readonly tag: NameTag; readonly depth: number; readonly first: boolean }[] = [];
  for (const marker of drawn) {
    const label = marker.label;
    if (label === undefined || label === '') continue;
    const at = projectToFrame(rig, aspect, hangsFrom(marker));
    if (at === undefined || at.depth > NAME_TAG_METRES) continue;
    if (at.left < 0 || at.left > 1 || at.top < 0 || at.top > 1) continue;
    seen.push({
      tag: { label, left: at.left, top: at.top },
      depth: at.depth,
      first: marker.followed === true,
    });
  }
  const kept: { readonly tag: NameTag; readonly box: Box; readonly depth: number }[] = [];
  // The followed rider's name first, then the nearest.
  for (const each of seen.sort((a, b) => Number(b.first) - Number(a.first) || a.depth - b.depth)) {
    if (kept.length === MAXIMUM_NAME_TAGS) break;
    const box = boxOf(each.tag, size);
    if (kept.some((other) => overlaps(box, other.box))) continue;
    kept.push({ tag: each.tag, box, depth: each.depth });
  }
  // Painted farthest first, so a nearer name is over a farther one.
  return kept.sort((a, b) => b.depth - a.depth).map((each) => each.tag);
}

/** Where a name is on the page, in CSS pixels. */
interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

/** A name's box: centred over its anchor, which is its bottom middle. */
function boxOf(tag: NameTag, size: FrameSize): Box {
  const x = tag.left * size.width;
  const y = tag.top * size.height;
  const half = nameTagWidthPx(tag.label) / 2;
  return { left: x - half, right: x + half, top: y - NAME_TAG_HEIGHT_PX, bottom: y };
}

function overlaps(one: Box, other: Box): boolean {
  return (
    one.left < other.right &&
    other.left < one.right &&
    one.top < other.bottom &&
    other.top < one.bottom
  );
}

/** The class each name on the page carries. */
export const NAME_TAG_CLASS = 'oyl-game__name';

/**
 * Lay `tags` into `layer`, which is put exactly over `frame` — the world's
 * canvas, in the same offset parent. One element a name, reused frame to
 * frame; the words are set as TEXT, never as markup, because a name is a
 * string another rider chose. Nothing is read from the page when there are no
 * names, so an ordinary ride pays nothing for this.
 */
export function layNameTags(
  layer: HTMLElement,
  frame: Pick<HTMLElement, 'offsetLeft' | 'offsetTop' | 'clientWidth' | 'clientHeight'>,
  tags: readonly NameTag[],
): void {
  while (layer.childElementCount > tags.length) layer.lastElementChild?.remove();
  if (tags.length === 0) return;
  const width = frame.clientWidth;
  const height = frame.clientHeight;
  layer.style.left = `${String(frame.offsetLeft)}px`;
  layer.style.top = `${String(frame.offsetTop)}px`;
  layer.style.width = `${String(width)}px`;
  layer.style.height = `${String(height)}px`;
  while (layer.childElementCount < tags.length) {
    const name = layer.ownerDocument.createElement('span');
    name.className = NAME_TAG_CLASS;
    layer.append(name);
  }
  tags.forEach((tag, index) => {
    const name = layer.children[index] as HTMLElement;
    if (name.textContent !== tag.label) name.textContent = tag.label;
    const x = Math.round(tag.left * width);
    const y = Math.round(tag.top * height);
    name.style.transform = `translate(${String(x)}px, ${String(y)}px) translate(-50%, -100%)`;
  });
}
