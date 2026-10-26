// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * The demo page — #1647: a preset ridden in the product's world, with play,
 * pause and stop, and the source offer (#1645).
 *
 * ## WCAG 2.2 SC 2.2.2, Pause, Stop, Hide
 *
 * The demo moves for longer than five seconds, so it can be paused and
 * stopped — with the ride HUD's own two controls (#1650), *Pause* and the one
 * a ride calls *End ride*, here *Play* and *Stop*. A visitor who asked for
 * reduced motion is shown a still frame and a Play button: the demo does not
 * move until they press it.
 *
 * ## The stats are the ride HUD's — #1650
 *
 * Over the world is `game/hud/HudCore.tsx`, the HUD every ride shows, which
 * `HudPanel` renders on a rider's own ride: the same readings, elevation
 * strip and route plan, read from the lead rider's simulation state and
 * scripted sensors as a ride reads a rider's. Not `HudPanel` itself, which
 * carries a room's and a workout's controls the demo build may not bundle
 * (`HudCore.tsx` says which). No trainer line, workout strip, standings or
 * room report is ever passed to it, and its one live region stays empty.
 *
 * The stage is the game's own (`oyl-game--riding`), held to the box between
 * the page's heading and its source offer rather than to the viewport, so
 * the offer (#1645) is never under it.
 *
 * ## A baked route's map data, and what is owed for it — #1652
 *
 * `?route=<id>` rides the preset on a baked route (`baked-route.ts`), read
 * into memory through {@link DemoPageProps.readFile} before the stage starts.
 * Whenever the run was given that map data — for the whole run, whichever
 * world is drawn, as ADR 0054 D-3.6 keys a ride's credit on its corridor and
 * ADR 0056 D-8.1 keys the demo's — the HUD carries `OSM_ATTRIBUTION` in its
 * corner, and a "Map data" disclosure beside the stage gives the ODbL §4.3
 * notice, the licence and the file itself (§4.6 a, ADR 0056 D-4). On the
 * synthetic road neither is shown: nothing is owed. A file that cannot be
 * read rides the synthetic road and says so in the status line.
 *
 * ## Hidden means paused
 *
 * `visibilitychange` and an `IntersectionObserver` on the canvas tell the
 * stage when nobody can see it, and the stage then requests no frames
 * (`stage.ts`). Every browser seam arrives as a prop, so `DemoPage.test.tsx`
 * drives each one and `main.tsx` is the only place the real ones are named.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { RouteProfile } from '@onyourleft/domain';

import { HudCore } from '../game/hud/HudCore';
import { ODBL_LICENCE_URL, OSM_ATTRIBUTION } from '../map/basemap';
import { OSM_COPYRIGHT_URL } from '../../tools/demo/route-bundle';
import { PlanTrace } from '../game/hud/PlanTrace';
import type { GameRenderer, GameView } from '../game/port';
import type { QualitySettings } from '../game/quality';
import type { GameSensors } from '../game/sensors';
import type { GameState } from '../game/simulation';
import {
  BAKED_ROUTE_NOTICE_FILE,
  BAKED_ROUTES_PATH,
  loadBakedRoute,
  type BakedRouteLoad,
  type ReadDemoFile,
} from './baked-route';
import { createDemoPlayer, type DemoStatus } from './player';
import { parseDemoQuery } from './query';
import { DemoSourceOffer } from './SourceOffer';
import { startDemoStage, type DemoSnapshot, type DemoStage, type FrameScheduler } from './stage';

export interface DemoPageProps {
  /** `location.search`. */
  readonly search: string;
  readonly renderer: GameRenderer;
  readonly drawnWorld: (view: GameView) => QualitySettings['world'];
  readonly frames: FrameScheduler;
  /** Whether the visitor asked for reduced motion (`prefers-reduced-motion: reduce`). */
  readonly reducedMotion: boolean;
  /** Watch whether `element` is on screen; returns the way to stop watching. */
  readonly observeInView: (element: Element, onChange: (inView: boolean) => void) => () => void;
  /** Where each snapshot goes — `window.__oylDemo` in `main.tsx`. */
  readonly publish: (snapshot: DemoSnapshot) => void;
  /** Reads one of the demo's own files, relative to the page — a baked route's (#1652). */
  readonly readFile: ReadDemoFile;
}

/** What the HUD's two controls say on the demo. */
const DEMO_LABELS = { resume: 'Play', end: 'Stop' } as const;

/** What the demo says on screen about whose numbers these are — #1650. */
export const DEMO_LABEL = 'Demo: scripted riders, not a real ride';

/** What the HUD reads, refreshed with every published snapshot. */
interface HudView {
  readonly state: GameState;
  readonly sensors: GameSensors;
  readonly profile: RouteProfile;
  readonly rideSeconds: number;
  /** Whether the run was given a baked route's map data — what the credit is keyed on. */
  readonly mapData: boolean;
}

/** Where a baked route's load is: none asked for, being read, or settled. */
type RouteLoad = { readonly kind: 'none' } | { readonly kind: 'loading' } | BakedRouteLoad;

/** The ODbL §4.3 notice, its links, and the offer of the file itself (§4.6 a) — #1652. */
function MapDataNotice(props: { readonly bundlePath: string }) {
  return (
    <details className="oyl-demo__map-data">
      <summary>Map data</summary>
      <p>
        Contains information from{' '}
        <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
        , which is made available here under the{' '}
        <a href={ODBL_LICENCE_URL} target="_blank" rel="noreferrer">
          Open Database License
        </a>{' '}
        (ODbL).
      </p>
      <p>
        Licence: <a href={ODBL_LICENCE_URL}>{ODBL_LICENCE_URL}</a>
      </p>
      <p>
        <a href={props.bundlePath} download>
          This route’s map data
        </a>
        , the whole database the demo draws, under the ODbL ·{' '}
        <a href={`${BAKED_ROUTES_PATH}${BAKED_ROUTE_NOTICE_FILE}`}>Its licence notice</a>
      </p>
    </details>
  );
}

/** The page. */
export function DemoPage(props: DemoPageProps) {
  const query = useMemo(() => parseDemoQuery(props.search), [props.search]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<DemoStage | undefined>(undefined);
  const [status, setStatus] = useState<DemoStatus>(props.reducedMotion ? 'paused' : 'playing');
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [hud, setHud] = useState<HudView | undefined>(undefined);
  const { renderer, drawnWorld, frames, reducedMotion, observeInView, publish, readFile } = props;
  const asked = query.ok ? query.route : undefined;
  const [load, setLoad] = useState<RouteLoad>(
    asked === undefined ? { kind: 'none' } : { kind: 'loading' },
  );

  useEffect(() => {
    // The same state kept, never an equal new one: the stage restarts on a new one.
    if (asked === undefined) {
      setLoad((was) => (was.kind === 'none' ? was : { kind: 'none' }));
      return undefined;
    }
    let current = true;
    setLoad((was) => (was.kind === 'loading' ? was : { kind: 'loading' }));
    void loadBakedRoute(asked, readFile).then((loaded) => {
      if (current) setLoad(loaded);
    });
    return () => {
      current = false;
    };
  }, [asked, readFile]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!query.ok || canvas === null || load.kind === 'loading') return undefined;
    const route = load.kind === 'ready' ? load.route : undefined;
    const player = createDemoPlayer(query.preset, { reducedMotion, route });
    if (!reducedMotion) player.play();
    const stage = startDemoStage({
      canvas,
      renderer,
      drawnWorld,
      player,
      frames,
      publish: (snapshot) => {
        setStatus(snapshot.state);
        setNotice(snapshot.notice);
        setHud({
          state: player.state,
          sensors: player.sensors,
          profile: player.profile,
          rideSeconds: player.rideMs / 1000,
          mapData: player.mapData !== undefined,
        });
        publish(snapshot);
      },
    });
    stageRef.current = stage;
    const onVisibility = (): void => stage.setPageVisible(document.visibilityState !== 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);
    const stopObserving = observeInView(canvas, (inView) => stage.setInView(inView));
    const onResize = (): void => stage.resize(canvas.clientWidth, canvas.clientHeight);
    addEventListener('resize', onResize);
    return () => {
      removeEventListener('resize', onResize);
      stopObserving();
      document.removeEventListener('visibilitychange', onVisibility);
      stage.destroy();
      stageRef.current = undefined;
    };
  }, [query, load, renderer, drawnWorld, frames, reducedMotion, observeInView, publish]);

  const playing = status === 'playing';
  const routeNotice = load.kind === 'failed' ? load.notice : undefined;
  return (
    <main style={{ display: 'flex', flexDirection: 'column', height: '100dvh', margin: 0 }}>
      <h1>On Your Left</h1>
      {query.ok ? (
        <>
          <p
            className="oyl-demo__label"
            style={{
              background: 'var(--oyl-color-hud-surface)',
              color: 'var(--oyl-color-hud-ink)',
              margin: 0,
              padding: 'var(--oyl-space-xs) var(--oyl-space-sm)',
            }}
          >
            {DEMO_LABEL}
          </p>
          <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <section
              className="oyl-game oyl-game--riding"
              aria-label="Demo ride"
              // The game's stage, held to this box rather than the viewport.
              style={{ position: 'absolute' }}
            >
              <canvas
                ref={canvasRef}
                className="oyl-game__world"
                role="img"
                aria-label={`A demo ride in the game: the ${query.preset.id} preset, ridden by scripted riders.`}
              />
              {hud === undefined ? null : (
                <HudCore
                  state={hud.state}
                  profile={hud.profile}
                  cadence={hud.sensors.cadence}
                  heartRate={hud.sensors.heartRate}
                  // The ride clock: it stops while the demo is paused.
                  movingSeconds={hud.rideSeconds}
                  units="metric"
                  labels={DEMO_LABELS}
                  touchLock={false}
                  // The demo has no pacer: no *Pacer —* (owner, 2026-10-25).
                  withoutPacer
                  paused={!playing}
                  onPause={() => (playing ? stageRef.current?.pause() : stageRef.current?.play())}
                  onEnd={() => stageRef.current?.stop()}
                  // The HUD's one live region stays off in the demo (#1650).
                  announcement=""
                  routeFigure={
                    <PlanTrace profile={hud.profile} distance={hud.state.ride.distance} />
                  }
                  // #1652: keyed on the run being given map data, never on the world drawn.
                  attribution={hud.mapData ? OSM_ATTRIBUTION : undefined}
                />
              )}
            </section>
          </div>
          {load.kind === 'ready' && hud?.mapData === true ? (
            <MapDataNotice bundlePath={load.route.bundlePath} />
          ) : null}
          {/* Mounted before it has text, so a screen reader announces the change. */}
          <p role="status">
            {[routeNotice, notice].filter((each) => each !== undefined).join(' ')}
          </p>
        </>
      ) : (
        <p>{query.message}</p>
      )}
      <DemoSourceOffer />
    </main>
  );
}
