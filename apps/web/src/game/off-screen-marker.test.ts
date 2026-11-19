// SPDX-License-Identifier: AGPL-3.0-or-later
// @vitest-environment jsdom

/**
 * #2755 — a marker at the frame's edge for a pacer or a ghost the camera
 * cannot show. Every frame here is built by the product's `scene.ts`
 * §`sceneFrame` and seen through `camera.ts` §`cameraRig`, the path
 * `GameView` draws by; the gap is the HUD's own (`hud/fields.ts`
 * §`chasedGapText`). `off-screen-marker-wiring.test.tsx` rides it through
 * `GameView`, and `browser/off-screen-marker.browser.spec.ts` measures it
 * against the HUD at 1024×600 and at the owner's tablet, 1280×800.
 */

import { buildGhostTrack, metres, metresPerSecond, pacerGap } from '@onyourleft/domain';
import { describe, expect, it, vi } from 'vitest';

import { contrastRatio } from '../design/contrast';
import { paletteColours, THEMES } from '../design/tokens';
import { RIDER_HEIGHT_METRES } from './bicycle';
import { CAMERA_BEHIND_METRES, cameraRig, fromTheEye, projectToFrame } from './camera';
import { chasedGapText, gapAgainst, type ChasedGap } from './hud/fields';
import {
  OFF_SCREEN_COLOURS,
  OFF_SCREEN_MARKER_CLASS,
  OFF_SCREEN_MARKER_MARGIN_PX,
  OFF_SCREEN_MARKER_PX,
  HUD_PANELS_SELECTOR,
  boxesOver,
  layOffScreenMarkers,
  offScreenMarkers,
  type OffScreenMarker,
  type PageBox,
} from './off-screen-marker';
import type { SceneFrame } from './port';
import { emptyRiderFadeLine, riderFadeLine, riderFaded } from './rider-fade';
import {
  hillRoute,
  northRoute,
  plannerCornerRoute,
  rollingRoute,
  steepValleyRoute,
} from './route-fixtures-testing';
import { sceneFrame, type SceneInput } from './scene';
import { atStartLine, type GameState } from './simulation';
import { corridorOrigin } from './terrain';

/** The owner's small laptop window, the size #2755 names. */
const SIZE = { width: 1024, height: 600 } as const;

const NO_HUD = (): readonly PageBox[] => [];

const STRAIGHT = northRoute(2_000, () => 10);
const RIDER_AT = 400;

function stateAt(riderAt: number, botAt?: number): GameState {
  const start = atStartLine(STRAIGHT);
  return {
    ...start,
    ride: { speed: metresPerSecond(9), distance: metres(riderAt) },
    ...(botAt === undefined
      ? {}
      : {
          bot: {
            state: { speed: metresPerSecond(8), distance: metres(botAt) },
          } as unknown as NonNullable<GameState['bot']>,
        }),
  };
}

/** A frame as `GameView` builds it, on `profile`, with the pacer at `botAt`. */
function frameWith(
  botAt: number | undefined,
  over: Partial<SceneInput> = {},
  profile = STRAIGHT,
  riderAt = RIDER_AT,
): SceneFrame {
  return sceneFrame({
    profile,
    origin: corridorOrigin(profile),
    state: stateAt(riderAt, botAt),
    ...(botAt === undefined ? {} : { botDistance: botAt }),
    ...over,
  });
}

/** The pacer's gap, as `GameView` §`chasedGaps` hands the HUD. */
function pacer(botAt: number, riderAt = RIDER_AT): ChasedGap {
  return { to: 'bot', gap: pacerGap(gapAgainst(stateAt(riderAt), botAt)) };
}

function only(markers: readonly OffScreenMarker[]): OffScreenMarker {
  expect(markers).toHaveLength(1);
  return markers[0] as OffScreenMarker;
}

describe('the pacer behind the camera — #2755', () => {
  it('is marked on the bottom edge, in the middle, pointing down, whole, with the HUD’s gap', () => {
    const botAt = RIDER_AT - 12;
    const chase = pacer(botAt);
    const marker = only(offScreenMarkers(frameWith(botAt), SIZE, [chase], NO_HUD));
    expect(marker.to).toBe('bot');
    expect(marker.edge).toBe('bottom');
    expect(marker.shown).toBe(1);
    expect(marker.y).toBeCloseTo(
      SIZE.height - OFF_SCREEN_MARKER_MARGIN_PX - OFF_SCREEN_MARKER_PX.height / 2,
      6,
    );
    expect(Math.abs(marker.x - SIZE.width / 2)).toBeLessThan(SIZE.width * 0.1);
    expect(Math.abs(marker.angle - Math.PI / 2)).toBeLessThan(0.3);
    expect(marker.gap).toBe(chasedGapText(chase));
    expect(marker.gap).toMatch(/^\d+ s$/);
  });

  it('is behind the eye there, where the camera’s own projection shows nothing — the case it exists for', () => {
    const frame = frameWith(RIDER_AT - 12);
    const bot = frame.markers.find((each) => each.kind === 'bot');
    if (bot === undefined) throw new Error('no pacer drawn');
    const rig = cameraRig(frame.camera);
    expect(projectToFrame(rig, SIZE.width / SIZE.height, bot)).toBeUndefined();
    expect(fromTheEye(rig, bot)?.depth).toBeLessThan(0);
  });

  it('is marked through every metre it drops back from the rider’s wheel to well behind the eye, once it fades', () => {
    for (let back = 0; back <= 40; back += 0.5) {
      const botAt = RIDER_AT - back;
      const frame = frameWith(botAt);
      const bot = frame.markers.find((each) => each.kind === 'bot');
      if (bot === undefined) throw new Error(`no pacer ${String(back)} m back`);
      const faded = riderFaded(
        bot,
        riderFadeLine(frame.camera, frame.markers, emptyRiderFadeLine()),
      );
      const markers = offScreenMarkers(frame, SIZE, [pacer(botAt)], NO_HUD);
      // Any of it in the frame — its wheels on the road or its helmet.
      const inFrame = [0, RIDER_HEIGHT_METRES].some((up) => {
        const at = projectToFrame(cameraRig(frame.camera), SIZE.width / SIZE.height, {
          x: bot.x,
          y: bot.y + up,
          z: bot.z,
        });
        return at !== undefined && at.left >= 0 && at.left <= 1 && at.top >= 0 && at.top <= 1;
      });
      const owed = inFrame ? faded : 1;
      if (owed < 0.01) {
        expect(markers, `${String(back)} m back`).toEqual([]);
      } else {
        const marker = only(markers);
        // As much as the pacer is not drawn: the marker fades in as it fades out.
        expect(marker.shown, `${String(back)} m back`).toBeCloseTo(owed, 9);
        expect(marker.edge, `${String(back)} m back`).toBe('bottom');
      }
    }
    // Both ends are reached: drawn whole beside the rider, and marked whole behind the eye.
    expect(offScreenMarkers(frameWith(RIDER_AT), SIZE, [pacer(RIDER_AT)], NO_HUD)).toEqual([]);
    expect(
      only(
        offScreenMarkers(
          frameWith(RIDER_AT - CAMERA_BEHIND_METRES - 3),
          SIZE,
          [pacer(RIDER_AT - CAMERA_BEHIND_METRES - 3)],
          NO_HUD,
        ),
      ).shown,
    ).toBe(1);
  });

  it('fades in by the share the pacer fades out while its helmet is still in the frame, never whole at once', () => {
    // Find a place on the ramp: neither whole nor gone. Its wheels have left
    // the bottom of the frame there and its helmet has not.
    let found = false;
    for (let back = 0.5; back <= 4; back += 0.05) {
      const frame = frameWith(RIDER_AT - back);
      const bot = frame.markers.find((each) => each.kind === 'bot');
      if (bot === undefined) continue;
      const faded = riderFaded(
        bot,
        riderFadeLine(frame.camera, frame.markers, emptyRiderFadeLine()),
      );
      if (faded <= 0.1 || faded >= 0.9) continue;
      found = true;
      const marker = only(offScreenMarkers(frame, SIZE, [pacer(RIDER_AT - back)], NO_HUD));
      expect(marker.shown).toBeCloseTo(faded, 9);
    }
    expect(found, 'the drop back crosses the fade’s ramp').toBe(true);
  });
});

describe('the pacer far behind, over hills — #2755', () => {
  it('is above the eye at the bottom of a steep valley — the case the rule is for', () => {
    const frame = frameWith(940, {}, steepValleyRoute(), 1_000);
    const bot = frame.markers.find((each) => each.kind === 'bot');
    if (bot === undefined) throw new Error('no pacer drawn');
    const seen = fromTheEye(cameraRig(frame.camera), bot);
    expect(seen?.depth).toBeLessThan(0);
    expect(seen?.up).toBeGreaterThan(2);
  });

  it('is on the bottom edge however far back it is, whatever the hills between put it above or below the eye', () => {
    for (const [name, profile, riderAt] of [
      ['a 10 % climb', hillRoute(), 700],
      ['a 10 % descent', hillRoute(), 1_200],
      ['rolling hills', rollingRoute(), 1_500],
      // The bottom of a steep valley: a pacer up the slope behind is metres
      // ABOVE the eye — the true direction to it is up the frame — and is
      // still behind the rider, so still on the bottom edge.
      ['the bottom of a steep valley', steepValleyRoute(), 1_000],
    ] as const) {
      for (const back of [6, 20, 60, 150, 300, 600]) {
        const botAt = riderAt - back;
        const frame = frameWith(botAt, {}, profile, riderAt);
        const marker = only(offScreenMarkers(frame, SIZE, [pacer(botAt, riderAt)], NO_HUD));
        expect(marker.edge, `${name}, ${String(back)} m back`).toBe('bottom');
        expect(Math.sin(marker.angle), `${name}, ${String(back)} m back`).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('the pacer in view — #2755', () => {
  it('has no marker while it is drawn whole ahead, and reads nothing off the page', () => {
    const hud = vi.fn(NO_HUD);
    for (const ahead of [3, 10, 25, 60, 150]) {
      expect(
        offScreenMarkers(frameWith(RIDER_AT + ahead), SIZE, [pacer(RIDER_AT + ahead)], hud),
        `${String(ahead)} m ahead`,
      ).toEqual([]);
    }
    expect(hud).not.toHaveBeenCalled();
  });

  it('has none with no chase, on a frame of no size, or once the race against a ghost is settled', () => {
    const frame = frameWith(RIDER_AT - 12);
    expect(offScreenMarkers(frame, SIZE, [], NO_HUD)).toEqual([]);
    expect(
      offScreenMarkers(frame, { width: 0, height: 0 }, [pacer(RIDER_AT - 12)], NO_HUD),
    ).toEqual([]);
  });
});

describe('the pacer out of view ahead, round a bend — #2755', () => {
  it('is marked on the side the road turns to, pointing that way', () => {
    // A right-angle corner 1 500 m along; the rider 60 m short of it, the
    // pacer 80 m past it, off to the right of a camera still looking north.
    for (const [hand, side] of [
      ['right', 'right'],
      ['left', 'left'],
    ] as const) {
      const profile = plannerCornerRoute(90, hand);
      const riderAt = 1_440;
      const botAt = 1_580;
      const frame = frameWith(botAt, {}, profile, riderAt);
      const marker = only(offScreenMarkers(frame, SIZE, [pacer(botAt, riderAt)], NO_HUD));
      expect(marker.edge, hand).toBe(side);
      expect(marker.shown).toBe(1);
      expect(Math.cos(marker.angle) * (side === 'right' ? 1 : -1), hand).toBeGreaterThan(0.5);
    }
  });
});

describe('the ghost — #2755', () => {
  const ghostAt = (distance: number) =>
    buildGhostTrack({ elapsedSeconds: [0, 3_600], distanceMetres: [distance, distance + 1] });

  it('is marked the same way, in its own colour, and stacked inward past the pacer when both are behind', () => {
    // Both dropped into the rider's lane, one behind the other: one ray.
    const botAt = RIDER_AT - 12;
    const frame = frameWith(botAt, { ghost: ghostAt(RIDER_AT - 20) });
    const ghost: ChasedGap = { to: 'ghost', gap: pacerGap(gapAgainst(stateAt(RIDER_AT), 380)) };
    const markers = offScreenMarkers(frame, SIZE, [pacer(botAt), ghost], NO_HUD);
    expect(markers.map((each) => [each.to, each.edge])).toEqual([
      ['bot', 'bottom'],
      ['ghost', 'bottom'],
    ]);
    const [first, second] = markers as [OffScreenMarker, OffScreenMarker];
    // Not one over the other: the second walked in, up the frame, just clear.
    expect(second.x).toBeCloseTo(first.x, 6);
    expect(first.y - second.y).toBeGreaterThanOrEqual(OFF_SCREEN_MARKER_PX.height);
    expect(first.y - second.y).toBeLessThan(OFF_SCREEN_MARKER_PX.height + 6);
    expect(OFF_SCREEN_COLOURS.ghost).not.toBe(OFF_SCREEN_COLOURS.bot);
  });

  it('has none once the race against it is settled — there is no gap left to point at', () => {
    const frame = frameWith(undefined, { ghost: ghostAt(RIDER_AT - 15) });
    const settled: ChasedGap = {
      to: 'ghost',
      gap: pacerGap(gapAgainst(stateAt(RIDER_AT), 385)),
      outcome: 'beaten',
    };
    expect(offScreenMarkers(frame, SIZE, [settled], NO_HUD)).toEqual([]);
    expect(
      offScreenMarkers(frame, SIZE, [{ ...settled, outcome: undefined }], NO_HUD),
    ).toHaveLength(1);
  });

  it('is never a lap race’s bot taken for the pacer', () => {
    const frame = frameWith(undefined, {
      raceBots: [
        { distanceMetres: RIDER_AT - 12, speedMetresPerSecond: 9, lateralMetres: 0, laidOut: true },
      ],
      steeredLateral: 0,
    });
    expect(frame.markers.some((each) => each.kind === 'bot')).toBe(true);
    expect(offScreenMarkers(frame, SIZE, [pacer(RIDER_AT - 12)], NO_HUD)).toEqual([]);
  });
});

describe('clear of the HUD — #2755', () => {
  it('moves in along its ray, still pointing the same way, until it is clear of a panel over its edge', () => {
    const frame = frameWith(RIDER_AT - 12);
    const free = only(offScreenMarkers(frame, SIZE, [pacer(RIDER_AT - 12)], NO_HUD));
    // A panel across the whole bottom 120 px.
    const panel: PageBox = {
      left: 0,
      top: SIZE.height - 120,
      right: SIZE.width,
      bottom: SIZE.height,
    };
    const moved = only(offScreenMarkers(frame, SIZE, [pacer(RIDER_AT - 12)], () => [panel]));
    expect(moved.edge).toBe('bottom');
    expect(moved.angle).toBe(free.angle);
    expect(moved.y + OFF_SCREEN_MARKER_PX.height / 2).toBeLessThanOrEqual(panel.top);
    // On the same ray from the middle, and no further in than it had to go.
    const outX = moved.x - SIZE.width / 2;
    const outY = moved.y - SIZE.height / 2;
    expect(Math.atan2(outY, outX)).toBeCloseTo(free.angle, 6);
    expect(panel.top - (moved.y + OFF_SCREEN_MARKER_PX.height / 2)).toBeLessThan(6);
  });

  it('is left out rather than laid over the HUD when nowhere on its ray is clear', () => {
    const frame = frameWith(RIDER_AT - 12);
    const everywhere: PageBox = { left: 0, top: 0, right: SIZE.width, bottom: SIZE.height };
    expect(offScreenMarkers(frame, SIZE, [pacer(RIDER_AT - 12)], () => [everywhere])).toEqual([]);
  });

  it('reads the boxes of the HUD’s panels from the world’s top left', () => {
    const world = document.createElement('canvas');
    const panel = document.createElement('div');
    const hidden = document.createElement('div');
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
    world.getBoundingClientRect = () => rect(10, 20, 1024, 600);
    panel.getBoundingClientRect = () => rect(706, 489, 320, 123);
    hidden.getBoundingClientRect = () => rect(0, 0, 0, 0);
    expect(boxesOver(world, [panel, hidden])).toEqual([
      { left: 696, top: 469, right: 1016, bottom: 592 },
    ]);
  });

  it('counts a layer over the whole stage as no panel, so a pacer dropped on the owner’s tablet is still marked', () => {
    // The owner's tablet, 2026-11-17: *PACER 4 s behind you* at 21.5 mph,
    // about 38 m back, and an empty marker layer. #2600's panel tabs stand on
    // `.oyl-hud__tabs`, a direct child of the HUD drawn over the whole stage
    // on a tablet (`theme.css` §".oyl-hud__tabs"); taken for a panel, it
    // covered every place on every ray, so the marker was left out. These
    // are the boxes the browser laid out at 2560×1600 (CSS pixels).
    const size = { width: 2560, height: 1600 } as const;
    const rect = (left: number, top: number, width: number, height: number) =>
      ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
    const stage = document.createElement('div');
    const world = document.createElement('canvas');
    world.getBoundingClientRect = () => rect(0, 0, size.width, size.height);
    const hud = document.createElement('section');
    hud.className = 'oyl-hud';
    const child = (className: string, box: DOMRect): HTMLElement => {
      const element = document.createElement('div');
      element.className = className;
      element.getBoundingClientRect = () => box;
      hud.append(element);
      return element;
    };
    child('oyl-hud__panel oyl-hud__fields oyl-hud__fields--primary', rect(8, 8, 520, 164));
    child('oyl-hud__panel oyl-hud__fields oyl-hud__fields--secondary', rect(1784, 8, 768, 171));
    child('oyl-hud__panel oyl-hud__route', rect(8, 1254, 288, 338));
    child('oyl-hud__panel oyl-hud__actions', rect(2232, 1469, 320, 123));
    child('oyl-hud__tabs', rect(0, 0, size.width, size.height));
    child('oyl-visually-hidden', rect(0, 0, 2, 2)).setAttribute('data-oyl-announcer', '');
    stage.append(world, hud);
    const boxes = boxesOver(world, stage.querySelectorAll(HUD_PANELS_SELECTOR));
    // The four panels, and neither the layer nor the announcer.
    expect(boxes).toHaveLength(4);
    const botAt = RIDER_AT - 38;
    const marker = only(offScreenMarkers(frameWith(botAt), size, [pacer(botAt)], () => boxes));
    expect(marker.to).toBe('bot');
    expect(marker.edge).toBe('bottom');
    expect(marker.gap).toMatch(/^\d+ s$/);
  });
});

describe('the marker’s colours — #2755', () => {
  it('are each at least 3 : 1 on the HUD’s surface they are drawn on, in every theme (WCAG 1.4.11)', () => {
    for (const theme of THEMES) {
      const surface = paletteColours(theme).hudSurface;
      for (const [to, colour] of Object.entries(OFF_SCREEN_COLOURS)) {
        const hex = `#${colour.toString(16).padStart(6, '0')}`;
        expect(contrastRatio(hex, surface), `${to}, ${theme}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe('layOffScreenMarkers — #2755', () => {
  const world = { offsetLeft: 0, offsetTop: 0, clientWidth: 1024, clientHeight: 600 };
  const bottom: OffScreenMarker = {
    to: 'bot',
    edge: 'bottom',
    x: 512,
    y: 572,
    angle: Math.PI / 2,
    shown: 1,
    gap: '4 s',
  };

  it('writes one marker a chase over the world, its gap as text, and takes them away again', () => {
    const layer = document.createElement('div');
    layOffScreenMarkers(layer, world, [bottom, { ...bottom, to: 'ghost', y: 530, shown: 0.5 }]);
    const laid = [...layer.querySelectorAll<HTMLElement>(`.${OFF_SCREEN_MARKER_CLASS}`)];
    expect(laid.map((each) => [each.dataset.to, each.dataset.edge, each.textContent])).toEqual([
      ['bot', 'bottom', '4 s'],
      ['ghost', 'bottom', '4 s'],
    ]);
    expect(layer.style.width).toBe('1024px');
    expect(laid[0]?.style.transform).toBe(
      `translate(${String(512 - OFF_SCREEN_MARKER_PX.width / 2)}px, ${String(572 - OFF_SCREEN_MARKER_PX.height / 2)}px)`,
    );
    expect(laid[0]?.style.getPropertyValue('--oyl-off-screen-colour')).toBe('#2f6fed');
    expect(laid[1]?.style.opacity).toBe('0.5');
    // Pointing down: the chevron, up and right as drawn, turned three eighths.
    expect(laid[0]?.querySelector<HTMLElement>('span')?.style.transform).toBe(
      `rotate(${((3 * Math.PI) / 4).toFixed(3)}rad)`,
    );
    layOffScreenMarkers(layer, world, []);
    expect(layer.childElementCount).toBe(0);
  });
});
