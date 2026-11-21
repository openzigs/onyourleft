// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **A marker at the frame's edge for a pacer or a ghost the camera cannot
 * show** — #2755, the owner's ruling of 2026-11-16: *"Yes pacer should get a
 * marker. Figure out the best way to do that."*
 *
 * ## Why
 *
 * The chase camera stands `camera.ts` §`CAMERA_BEHIND_METRES` (4.5 m) behind
 * the rider. A pacer the rider has dropped is brought into their lane
 * (`scene.ts`) and faded out as it passes under the camera (`rider-fade.ts`),
 * then it is behind the eye, where nothing is drawn. Round a bend a pacer far
 * ahead is off the side of the frame. Either way only the HUD's *Pacer, 3 s
 * behind you* said where it was (#2723's screenshots).
 *
 * ## The design, and the ones not taken
 *
 * | Option | Verdict | Why |
 * |---|---|---|
 * | **An edge marker** | **chosen** | DOM laid over the world, as `name-tags.ts` lays names: no draw call, no triangle and no second render pass, the same in both worlds because both are seen through the same camera. It says which way and how far at a glance, and costs nothing while the pacer is in view |
 * | A ghosted outline drawn through the camera | rejected | a pacer behind the eye is not in front of the camera to be drawn; an outline of one between the eye and the rider is the very thing #2596 fades out, because it filled the bottom of the tablet's screen |
 * | A mirror strip | rejected | a second render pass, which the issue rules out, and a second picture a rider must read on a bar-mounted phone |
 *
 * ## Where it goes
 *
 * The pacer's middle (half {@link RIDER_HEIGHT_METRES} up) is taken into the
 * camera's own axes (`camera.ts` §`fromTheEye`), and its direction in the
 * frame is read from the middle of the frame:
 *
 * - **In front of the eye**, toward where the camera projects it — so one
 *   round a bend ahead is on a SIDE, one far up a climb on the TOP, and one
 *   faded out between the eye and the rider (below the frame) on the BOTTOM.
 * - **Behind the eye, toward the BOTTOM edge**, across it by how far to the
 *   side it is for how far back: what the projection would give a point that
 *   far in FRONT, kept on the side it is on. So a pacer dropped behind the
 *   rider is on the bottom edge, and one passing the eye to one side is at
 *   the bottom of that side for the moment it takes. ⚠️ Not the true direction
 *   to it: at the bottom of a steep valley a pacer up the slope behind is
 *   metres ABOVE the eye, and the true direction put its marker on the TOP
 *   edge, which reads as "ahead of you" (`off-screen-marker.test.ts` §"over
 *   hills"). Behind is the bottom edge, as #2755 asks.
 *
 * The marker is put where that ray from the middle meets the edge, inset by
 * {@link OFF_SCREEN_MARKER_MARGIN_PX}. ⚠️ **It never covers the HUD**: if the
 * HUD's panels are there, it moves IN along the same ray, so it still points
 * the right way, until it is clear of every panel. The middle of the frame is
 * where the rider is, which every layout keeps clear (`browser/ride-stage.ts`
 * §`layoutFaults`, "over the rider"), so the walk ends before it. A second
 * marker on the same ray (a pacer and a ghost both behind) moves in past the
 * first, so the two are stacked rather than one over the other.
 *
 * ## When it shows
 *
 * Exactly while the pacer is not drawn in view: wholly off the frame (neither
 * its wheels nor its helmet inside it) or behind the eye, it is shown whole;
 * with any of it inside the frame it is shown as much as
 * `rider-fade.ts` has faded the pacer out, so as the dropped pacer fades under
 * the camera the marker fades in by the same share, and a pacer drawn whole in
 * view has none. A settled race against a ghost (#259) has no gap left to
 * point at, so it has no marker either.
 *
 * ## The ghost
 *
 * The rider's own ghost (#93, ADR 0066) behaves the same way: it is dropped
 * the same way, and the HUD gives its gap the same way. It wears the slate it
 * is tinted with on the road (`three-renderer.ts` §`RIDER_TINTS`), where the
 * pacer's marker wears {@link PACER_KIT}'s blue, so the two are told apart
 * when both are behind.
 *
 * ## For a screen reader
 *
 * Nothing: the layer is `aria-hidden`, and there is no live region. The HUD's
 * gap field already says the same thing as text.
 *
 * ⚠️ **Drawing only.** Nothing here is read by the simulation, a draft or a
 * trainer: `off-screen-marker-wiring.test.tsx` rides the same ride with and
 * without a view that draws and compares what the trainer was sent.
 */

import { PACER_KIT, RIDER_HEIGHT_METRES } from './bicycle';
import {
  NEAR_PLANE_METRES,
  cameraRig,
  fromTheEye,
  projectToFrame,
  verticalHalfTangent,
  type CameraRig,
} from './camera';
import { chasedGapText, type ChasedGap } from './hud/fields';
import type { RiderMarker, SceneFrame } from './port';
import { emptyRiderFadeLine, riderFadeLine, riderFaded } from './rider-fade';

/**
 * How big a marker is on the page, in CSS pixels: an arrow and the gap, `12 s`
 * or `Level`, in the HUD's small text. Set on each marker from here, so the
 * box {@link offScreenMarkers} keeps clear of the HUD is the box drawn.
 */
export const OFF_SCREEN_MARKER_PX = { width: 72, height: 32 } as const;

/** How far in from the frame's edge a marker sits, in CSS pixels. Chosen. */
export const OFF_SCREEN_MARKER_MARGIN_PX = 12;

/** How far in along its ray a marker is moved at a time to clear the HUD, in CSS pixels. */
const STEP_PX = 4;

/** Less shown than this is not drawn at all. */
const LEAST_SHOWN = 0.01;

/**
 * The ghost's slate: `three-renderer.ts` §`RIDER_TINTS.ghost`, the tint it
 * wears on the road. Restated rather than imported, because that file is the
 * one that names `three`, and this one is laid out on every frame without it.
 */
const GHOST_SLATE = 0x64748b;

/**
 * The colour each marker wears: the pacer's kit (`bicycle.ts` §`PACER_KIT`),
 * and the ghost's slate. Each is at least 3 : 1 against the HUD's surface the
 * marker is drawn on (`off-screen-marker.test.ts`), WCAG 1.4.11's bound for a
 * graphic.
 */
export const OFF_SCREEN_COLOURS: Readonly<Record<ChasedGap['to'], number>> = {
  bot: PACER_KIT.jersey,
  ghost: GHOST_SLATE,
};

/** Which edge of the frame a marker is on. */
export type FrameEdge = 'top' | 'right' | 'bottom' | 'left';

/** A box on the page, in CSS pixels from the frame's top left. */
export interface PageBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** One marker at the frame's edge. */
export interface OffScreenMarker {
  /** Whose it is. */
  readonly to: ChasedGap['to'];
  /** The edge its ray from the frame's middle meets. */
  readonly edge: FrameEdge;
  /** Its middle, in CSS pixels from the frame's top left. */
  readonly x: number;
  readonly y: number;
  /** Which way it points, in radians on the page: 0 to the right, π/2 down. */
  readonly angle: number;
  /** How much of it is drawn, 0 to 1: as much as the pacer is not. */
  readonly shown: number;
  /** The gap, as the HUD writes it. @see chasedGapText */
  readonly gap: string;
}

/** The marker on the road a chased rider is drawn as: the one pacer, never a lap race's bot. */
function drawnAs(frame: SceneFrame, to: ChasedGap['to']): RiderMarker | undefined {
  return frame.markers.find((marker) =>
    to === 'bot' ? marker.kind === 'bot' && marker.racer !== true : marker.kind === 'ghost',
  );
}

/**
 * Whether any of the rider is inside the frame: their tyres on the road or the
 * top of their helmet, each where the camera projects it. Either is enough —
 * a pacer dropping back under the camera leaves the frame by its wheels first
 * while its head is still drawn, and one up a climb by its head first.
 */
function inTheFrame(rig: CameraRig, aspect: number, marker: RiderMarker): boolean {
  return [0, RIDER_HEIGHT_METRES].some((up) => {
    const at = projectToFrame(rig, aspect, { x: marker.x, y: marker.y + up, z: marker.z });
    return at !== undefined && at.left >= 0 && at.left <= 1 && at.top >= 0 && at.top <= 1;
  });
}

function overlaps(one: PageBox, other: PageBox): boolean {
  return (
    one.left < other.right &&
    other.left < one.right &&
    one.top < other.bottom &&
    other.top < one.bottom
  );
}

/**
 * The markers to lay over this frame, for a frame of this size on the page.
 * Empty while every chased rider is drawn in view.
 *
 * `hud` is asked for the HUD's boxes only when a marker is to be placed, so a
 * ride with its pacer in view reads nothing off the page.
 */
export function offScreenMarkers(
  frame: SceneFrame,
  size: { readonly width: number; readonly height: number },
  chases: readonly ChasedGap[],
  hud: () => readonly PageBox[],
): readonly OffScreenMarker[] {
  const { width, height } = size;
  if (!(width > 0 && height > 0) || chases.length === 0) return [];
  const aspect = width / height;
  const rig = cameraRig(frame.camera);
  const fade = riderFadeLine(frame.camera, frame.markers, emptyRiderFadeLine());
  const lens = verticalHalfTangent(aspect);
  const halfWide = width / 2 - OFF_SCREEN_MARKER_MARGIN_PX - OFF_SCREEN_MARKER_PX.width / 2;
  const halfHigh = height / 2 - OFF_SCREEN_MARKER_MARGIN_PX - OFF_SCREEN_MARKER_PX.height / 2;
  if (halfWide <= 0 || halfHigh <= 0) return [];
  let taken: PageBox[] | undefined;
  const placed: OffScreenMarker[] = [];
  for (const chase of chases) {
    const gap = chasedGapText(chase);
    const marker = drawnAs(frame, chase.to);
    if (gap === undefined || marker === undefined) continue;
    const middle = { x: marker.x, y: marker.y + RIDER_HEIGHT_METRES / 2, z: marker.z };
    const shown = inTheFrame(rig, aspect, marker) ? riderFaded(marker, fade) : 1;
    if (shown < LEAST_SHOWN) continue;
    const seen = fromTheEye(rig, middle);
    if (seen === undefined) continue;
    // Which way from the frame's middle, in pixels. @see this file's header
    const behind = seen.depth < NEAR_PLANE_METRES;
    const depth = Math.max(Math.abs(seen.depth), NEAR_PLANE_METRES);
    let across = (seen.right / (depth * lens * aspect)) * (width / 2);
    let down = behind ? height / 2 : (-seen.up / (depth * lens)) * (height / 2);
    const length = Math.hypot(across, down);
    if (length === 0) {
      across = 0;
      down = 1;
    } else {
      across /= length;
      down /= length;
    }
    const reachAcross = across === 0 ? Infinity : halfWide / Math.abs(across);
    const reachDown = down === 0 ? Infinity : halfHigh / Math.abs(down);
    const reach = Math.min(reachAcross, reachDown);
    const edge: FrameEdge =
      reachAcross < reachDown ? (across > 0 ? 'right' : 'left') : down > 0 ? 'bottom' : 'top';
    taken ??= [...hud()];
    const clear = clearAlong(width / 2, height / 2, across, down, reach, taken);
    if (clear === undefined) continue;
    taken.push(clear.box);
    placed.push({
      to: chase.to,
      edge,
      x: clear.x,
      y: clear.y,
      angle: Math.atan2(down, across),
      shown,
      gap,
    });
  }
  return placed;
}

/**
 * The first place clear of every box in `taken`, walking in from `reach`
 * along the ray from (`x`, `y`) toward (`across`, `down`); `undefined` when
 * there is none, which leaves the marker out rather than over the HUD.
 */
function clearAlong(
  x: number,
  y: number,
  across: number,
  down: number,
  reach: number,
  taken: readonly PageBox[],
): { readonly x: number; readonly y: number; readonly box: PageBox } | undefined {
  const halfWidth = OFF_SCREEN_MARKER_PX.width / 2;
  const halfHeight = OFF_SCREEN_MARKER_PX.height / 2;
  const steps = Math.ceil(reach / STEP_PX);
  for (let step = 0; step <= steps; step += 1) {
    const out = steps === 0 ? 0 : reach * (1 - step / steps);
    const centreX = x + across * out;
    const centreY = y + down * out;
    const box = {
      left: centreX - halfWidth,
      top: centreY - halfHeight,
      right: centreX + halfWidth,
      bottom: centreY + halfHeight,
    };
    if (!taken.some((each) => overlaps(box, each))) return { x: centreX, y: centreY, box };
  }
  return undefined;
}

/**
 * The HUD's panels a marker keeps clear of: every direct child of `.oyl-hud`
 * but its visually hidden live region and #2600's `.oyl-hud__tabs` — what
 * `browser/ride-harness.tsx` §`measure` counts as a panel — and the two rows a
 * short phone lifts out of the actions panel into panels of their own.
 *
 * ⚠️ **`.oyl-hud__tabs` is a layer over the whole stage on a tablet**, which a
 * panel's keyboard control stands on, and it covers nothing. Taken for a
 * panel it covered every place on every ray, so no marker was laid: the
 * owner's tablet on 2026-11-17, *Pacer 4 s behind you* and no marker.
 */
export const HUD_PANELS_SELECTOR =
  '.oyl-hud > :not([data-oyl-announcer], .oyl-hud__tabs), .oyl-hud__side-camera-row, .oyl-hud__actions > .oyl-sound';

/**
 * Where each of `covers` is on the page, as a {@link PageBox} from the top left
 * of `frame` — the world's canvas the markers are laid over. A cover laid out
 * at no size (a panel the layout gave way) is left out.
 */
export function boxesOver(frame: Element, covers: Iterable<Element>): readonly PageBox[] {
  const origin = frame.getBoundingClientRect();
  const boxes: PageBox[] = [];
  for (const cover of covers) {
    const box = cover.getBoundingClientRect();
    if (box.width * box.height <= 1) continue;
    boxes.push({
      left: box.left - origin.left,
      top: box.top - origin.top,
      right: box.right - origin.left,
      bottom: box.bottom - origin.top,
    });
  }
  return boxes;
}

/** The class each marker on the page carries. */
export const OFF_SCREEN_MARKER_CLASS = 'oyl-game__off-screen';

function cssColour(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}

/**
 * Lay `markers` into `layer`, which is put exactly over `frame` — the world's
 * canvas, in the same offset parent — as `name-tags.ts` §`layNameTags` does.
 * One element a marker, reused frame to frame: an arrow and the gap, written
 * as text. Nothing is read from the page when there are none.
 */
export function layOffScreenMarkers(
  layer: HTMLElement,
  frame: Pick<HTMLElement, 'offsetLeft' | 'offsetTop' | 'clientWidth' | 'clientHeight'>,
  markers: readonly OffScreenMarker[],
): void {
  while (layer.childElementCount > markers.length) layer.lastElementChild?.remove();
  if (markers.length === 0) return;
  layer.style.left = `${String(frame.offsetLeft)}px`;
  layer.style.top = `${String(frame.offsetTop)}px`;
  layer.style.width = `${String(frame.clientWidth)}px`;
  layer.style.height = `${String(frame.clientHeight)}px`;
  const document = layer.ownerDocument;
  while (layer.childElementCount < markers.length) {
    const element = document.createElement('span');
    element.className = OFF_SCREEN_MARKER_CLASS;
    element.style.width = `${String(OFF_SCREEN_MARKER_PX.width)}px`;
    element.style.height = `${String(OFF_SCREEN_MARKER_PX.height)}px`;
    const arrow = document.createElement('span');
    arrow.className = `${OFF_SCREEN_MARKER_CLASS}-arrow`;
    const gap = document.createElement('span');
    gap.className = `${OFF_SCREEN_MARKER_CLASS}-gap`;
    element.append(arrow, gap);
    layer.append(element);
  }
  markers.forEach((marker, index) => {
    const element = layer.children[index] as HTMLElement;
    element.dataset.to = marker.to;
    element.dataset.edge = marker.edge;
    element.style.setProperty('--oyl-off-screen-colour', cssColour(OFF_SCREEN_COLOURS[marker.to]));
    element.style.opacity = String(Math.round(marker.shown * 100) / 100);
    const x = Math.round(marker.x - OFF_SCREEN_MARKER_PX.width / 2);
    const y = Math.round(marker.y - OFF_SCREEN_MARKER_PX.height / 2);
    element.style.transform = `translate(${String(x)}px, ${String(y)}px)`;
    const [arrow, gap] = [...element.children] as HTMLElement[];
    if (arrow !== undefined) {
      // The chevron is two sides of a square, pointing up and right until it
      // is turned an eighth of a turn more than the marker's own way.
      arrow.style.transform = `rotate(${(marker.angle + Math.PI / 4).toFixed(3)}rad)`;
    }
    if (gap !== undefined && gap.textContent !== marker.gap) gap.textContent = marker.gap;
  });
}
