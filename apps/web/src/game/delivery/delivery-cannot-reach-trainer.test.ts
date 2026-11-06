// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **Delivery's code cannot reach the trainer** — the owner's ruling DL5 of
 * 2026-10-27, recorded as ADR 0059 D-2, held as a red test (#1807).
 *
 * A smart trainer applies resistance to a person who is pedalling (CLAUDE.md
 * §6), and DL5 says no Delivery event — a hit, a miss, an obstacle, a
 * delivery — may ever change what the trainer is sent. `check:wiring` cannot
 * hold that: it proves a module is *reached*, never that one is *not*
 * (`docs/agents/wiring-gate.md` §4j). So this walks the static import graph
 * from every module under `game/delivery/` and fails, naming the chain, when
 * it reaches any of {@link forbiddenModules}: the trainer-command seam **as
 * `scripts/check-wiring.mjs` §`TRAINER_COMMAND_SEAM` lists it** (read off that
 * file, never copied), the game's trainer port, the gradient driver, the
 * ride's trainer opener, and **every module that writes to a trainer**, found
 * by {@link writesToATrainer} over the whole tree rather than written down
 * (ADR 0059 §Amendments, 2026-10-28). `tools/demo/forbidden-modules.ts`
 * (#1645) is the precedent, over the demo's bundle rather than its sources.
 *
 *
 * The walk itself, the trainer-control writer rules W1–W4, what it follows
 * and what it cannot see are in `../cannot-reach-trainer-testing.ts`, shared
 * with the lap race's test since #1898 so that both forbid the same set. This
 * file names Delivery's root and holds the walk's own cases.
 */

import { describe, expect, it } from 'vitest';

import {
  forbiddenInTheTree,
  forbiddenModules,
  GAME_TRAINER_MODULES,
  KNOWN_TRAINER_CONTROL_WRITERS,
  modulesUnder,
  plantedOver,
  seamViolations,
  trainerCommandSeam,
  walk,
  WIRING_SOURCE,
  WRITERS_ON_DISK,
  writesToATrainer,
  type ReadSource,
} from '../cannot-reach-trainer-testing';

/** Delivery's code, as a path from the repository root. */
const DELIVERY_ROOT = 'apps/web/src/game/delivery';

describe('Delivery cannot reach the trainer-command seam (DL5, ADR 0059 D-2, #1807)', () => {
  it('reaches no trainer module from any Delivery module, by any static import chain', () => {
    expect(seamViolations(modulesUnder(DELIVERY_ROOT), forbiddenInTheTree())).toEqual([]);
  });

  it('reads the seam off scripts/check-wiring.mjs, every module of it', () => {
    const seam = trainerCommandSeam(WIRING_SOURCE);
    // The five modules #363 named; more is a seam that grew, fewer is a lost entry.
    expect(seam.length).toBeGreaterThanOrEqual(5);
    expect(seam).toContain('packages/sensors/protocol/src/fitness-machine-control.ts');
    const forbidden = forbiddenInTheTree();
    for (const path of [...seam, ...GAME_TRAINER_MODULES]) {
      expect(forbidden).toContain(path);
    }
  });

  it('refuses a forbidden path that names no file, rather than passing over nothing', () => {
    const renamed = WIRING_SOURCE.replace(
      "'packages/sensors/protocol/src/erg-writer.ts',",
      "'packages/sensors/protocol/src/erg-writer-renamed.ts',",
    );
    expect(renamed).not.toBe(WIRING_SOURCE);
    expect(() => forbiddenModules(renamed)).toThrow(
      /name no file[\s\S]*packages\/sensors\/protocol\/src\/erg-writer-renamed\.ts/,
    );
    const lostPort = plantedOver({});
    expect(() =>
      forbiddenModules(WIRING_SOURCE, (path) =>
        path === 'apps/web/src/game/trainer-port.ts' ? undefined : lostPort(path),
      ),
    ).toThrow(/apps\/web\/src\/game\/trainer-port\.ts/);
  });

  it('reads files: every Delivery module is visited, so an empty or wrong root is red', () => {
    const roots = modulesUnder(DELIVERY_ROOT);
    expect(roots.length).toBeGreaterThan(0);
    const { modules } = walk(roots);
    for (const path of roots) {
      expect(modules, path).toContain(path);
    }
    // Past one hop on the real tree: the week's progress is built on the round.
    expect(walk([`${DELIVERY_ROOT}/delivery-progress.ts`]).modules).toContain(
      `${DELIVERY_ROOT}/round.ts`,
    );
    expect(() => walk([`${DELIVERY_ROOT}/no-such-module.ts`])).toThrow(/is not there/);
  });

  it('finds a planted violation through an intermediate module, and names both hops', () => {
    const read = plantedOver({
      [`${DELIVERY_ROOT}/planted-entry.ts`]: "import { hop } from './planted-hop';\nvoid hop;\n",
      [`${DELIVERY_ROOT}/planted-hop.ts`]:
        "import { gameTrainerPort } from '../trainer-port';\nexport const hop = gameTrainerPort;\n",
    });
    const found = seamViolations(
      [...modulesUnder(DELIVERY_ROOT), `${DELIVERY_ROOT}/planted-entry.ts`],
      forbiddenInTheTree(),
      read,
    );
    expect(found).toContain(
      `${DELIVERY_ROOT}/planted-entry.ts → ${DELIVERY_ROOT}/planted-hop.ts → apps/web/src/game/trainer-port.ts`,
    );
  });

  it('follows a workspace import into the package, through its barrel, to the seam', () => {
    const read = plantedOver({
      [`${DELIVERY_ROOT}/planted-entry.ts`]:
        "import { chooseTrainerControl } from '@onyourleft/sensors/protocol';\nvoid chooseTrainerControl;\n",
    });
    expect(
      seamViolations([`${DELIVERY_ROOT}/planted-entry.ts`], forbiddenInTheTree(), read),
    ).toEqual([
      `${DELIVERY_ROOT}/planted-entry.ts → packages/sensors/protocol/src/index.ts → packages/sensors/protocol/src/trainer-control-choice.ts`,
    ]);
  });

  it('lets Delivery take a value from @onyourleft/domain, but not #90’s setpoint driver', () => {
    // The town's mapped buildings, streets and doorsteps (#1808's targets) all
    // reach the domain barrel, and the barrel re-exports `trainer/simulation.ts`.
    const violations = (code: string): string[] =>
      seamViolations(
        [`${DELIVERY_ROOT}/planted-entry.ts`],
        forbiddenInTheTree(),
        plantedOver({ [`${DELIVERY_ROOT}/planted-entry.ts`]: code }),
      );
    expect(violations("import { METRES_PER_MILE } from '@onyourleft/domain';")).toEqual([]);
    expect(violations("import { createSimulationDriver } from '@onyourleft/domain';")).toEqual([
      `${DELIVERY_ROOT}/planted-entry.ts → packages/domain/src/index.ts → packages/domain/src/trainer/simulation.ts`,
    ]);
    // A type from it is erased, so it is not a way in.
    expect(violations("import type { SimulationDriver } from '@onyourleft/domain';")).toEqual([]);
  });

  it('follows every value spelling of an import, and skips only the type-only ones', () => {
    const reaches = (code: string): boolean =>
      seamViolations(
        [`${DELIVERY_ROOT}/planted-entry.ts`],
        forbiddenInTheTree(),
        plantedOver({ [`${DELIVERY_ROOT}/planted-entry.ts`]: code }),
      ).length > 0;
    // Value spellings: each reaches the port.
    for (const code of [
      "import { gameTrainerPort } from '../trainer-port';",
      "import * as port from '../trainer-port';",
      "import '../trainer-port';",
      "export { gameTrainerPort } from '../trainer-port';",
      "export * from '../trainer-port';",
      "export * as port from '../trainer-port';",
      "const port = await import('../trainer-port');",
      "import port = require('../trainer-port');",
      // Kept as `import {} from '…'` under verbatimModuleSyntax: the module still runs.
      "import { type GameTrainerPort } from '../trainer-port';",
    ]) {
      expect(reaches(code), code).toBe(true);
    }
    // Type-only spellings: erased before anything runs.
    for (const code of [
      "import type { GameTrainerPort } from '../trainer-port';",
      "export type { GameTrainerPort } from '../trainer-port';",
      "export type * from '../trainer-port';",
      "let port: import('../trainer-port').GameTrainerPort;",
      "import type port = require('../trainer-port');",
    ]) {
      expect(reaches(code), code).toBe(false);
    }
  });

  it('follows a barrel only for the names asked of it', () => {
    const read = plantedOver({
      [`${DELIVERY_ROOT}/planted-barrel.ts`]: [
        "export { hop } from './planted-hop';",
        "export { gameTrainerPort } from '../trainer-port';",
      ].join('\n'),
      [`${DELIVERY_ROOT}/planted-hop.ts`]: 'export const hop = 1;\n',
      [`${DELIVERY_ROOT}/planted-entry.ts`]: "import { hop } from './planted-barrel';\nvoid hop;\n",
      [`${DELIVERY_ROOT}/planted-whole.ts`]:
        "import * as all from './planted-barrel';\nvoid all;\n",
      // Meets the barrel first for nothing, then through a second module for the port.
      [`${DELIVERY_ROOT}/planted-later.ts`]: [
        "import './planted-barrel';",
        "import { viaOther } from './planted-other';",
      ].join('\n'),
      [`${DELIVERY_ROOT}/planted-other.ts`]:
        "export { gameTrainerPort as viaOther } from './planted-barrel';\n",
    });
    const forbidden = forbiddenInTheTree();
    expect(seamViolations([`${DELIVERY_ROOT}/planted-entry.ts`], forbidden, read)).toEqual([]);
    expect(walk([`${DELIVERY_ROOT}/planted-entry.ts`], read).modules).toContain(
      `${DELIVERY_ROOT}/planted-hop.ts`,
    );
    expect(seamViolations([`${DELIVERY_ROOT}/planted-whole.ts`], forbidden, read)).toContain(
      `${DELIVERY_ROOT}/planted-whole.ts → ${DELIVERY_ROOT}/planted-barrel.ts → apps/web/src/game/trainer-port.ts`,
    );
    // The chain named is the one that carried the port, not the first that met the barrel.
    expect(seamViolations([`${DELIVERY_ROOT}/planted-later.ts`], forbidden, read)).toContain(
      `${DELIVERY_ROOT}/planted-later.ts → ${DELIVERY_ROOT}/planted-other.ts → ${DELIVERY_ROOT}/planted-barrel.ts → apps/web/src/game/trainer-port.ts`,
    );
  });

  it('passes a named ask on through an `export *` barrel', () => {
    // `packages/domain/src/index.ts` has `export * from './workout'`: a seam
    // module re-exported by star must still be seen when a name is asked of it.
    const read = plantedOver({
      [`${DELIVERY_ROOT}/planted-star.ts`]: "export * from '../trainer-port';\n",
      [`${DELIVERY_ROOT}/planted-entry.ts`]:
        "import { gameTrainerPort } from './planted-star';\nvoid gameTrainerPort;\n",
      // Conservative: the walk does not read which names the target has.
      [`${DELIVERY_ROOT}/planted-unknown.ts`]:
        "import { nothingThere } from './planted-star';\nvoid nothingThere;\n",
      // `export *` never passes `default` on, so asking for it alone reaches nothing.
      [`${DELIVERY_ROOT}/planted-default.ts`]: "import port from './planted-star';\nvoid port;\n",
    });
    const forbidden = forbiddenInTheTree();
    const chain = (entry: string): string =>
      `${DELIVERY_ROOT}/${entry} → ${DELIVERY_ROOT}/planted-star.ts → apps/web/src/game/trainer-port.ts`;
    expect(seamViolations([`${DELIVERY_ROOT}/planted-entry.ts`], forbidden, read)).toContain(
      chain('planted-entry.ts'),
    );
    expect(seamViolations([`${DELIVERY_ROOT}/planted-unknown.ts`], forbidden, read)).toContain(
      chain('planted-unknown.ts'),
    );
    expect(seamViolations([`${DELIVERY_ROOT}/planted-default.ts`], forbidden, read)).toEqual([]);
  });

  it('refuses what it cannot follow, rather than leaving it out', () => {
    const fails = (code: string): (() => void) => {
      const read = plantedOver({ [`${DELIVERY_ROOT}/planted-entry.ts`]: code });
      return () => walk([`${DELIVERY_ROOT}/planted-entry.ts`], read);
    };
    expect(fails("import { a } from './no-such-module';")).toThrow(/cannot resolve/);
    expect(fails("import { a } from '@onyourleft/no-such-package';")).toThrow(
      /no workspace package exports/,
    );
    expect(fails("import Worker from './round?worker';")).toThrow(/cannot resolve/);
    expect(fails('const lazy = await import(name);')).toThrow(/cannot name/);
  });

  it('refuses import.meta.glob in every spelling, and any import.meta member that may load', () => {
    const fails = (code: string): (() => void) => {
      const read = plantedOver({ [`${DELIVERY_ROOT}/planted-entry.ts`]: code });
      return () => walk([`${DELIVERY_ROOT}/planted-entry.ts`], read);
    };
    for (const code of [
      // Vite inlines an eager glob as a static import of the same module instance.
      "const all = import.meta.glob('../trainer-port.ts', { eager: true });",
      "const lazy = import.meta.glob('./*.ts');",
      "const lazy = import.meta.glob(['../*.ts', '!../gradient.ts'], { import: 'gameTrainerPort' });",
      'const glob = import.meta.glob;',
      "const eager = import.meta.globEager('../trainer-port.ts');",
    ]) {
      expect(fails(code), code).toThrow(/uses import\.meta\.glob/);
    }
    for (const code of [
      "const all = import.meta['glob']('../trainer-port.ts', { eager: true });",
      'const meta = import.meta;\nmeta.glob("../trainer-port.ts");',
    ]) {
      expect(fails(code), code).toThrow(/import\.meta other than by a member name/);
    }
    expect(fails("const r = import.meta.resolve('../trainer-port');")).toThrow(
      /uses import\.meta\.resolve/,
    );
    // The members that load nothing are not refused.
    expect(
      fails(
        'const here = import.meta.url;\nconst dev = import.meta.env.DEV;\nimport.meta.hot?.accept();',
      ),
    ).not.toThrow();
  });

  it('follows a worker into the module it runs, and refuses one it cannot name', () => {
    const plant = (code: string): ReadSource =>
      plantedOver({
        [`${DELIVERY_ROOT}/planted-entry.ts`]: code,
        [`${DELIVERY_ROOT}/planted-picture.png`]: 'not a module',
      });
    const violations = (code: string): string[] =>
      seamViolations([`${DELIVERY_ROOT}/planted-entry.ts`], forbiddenInTheTree(), plant(code));
    const port = `${DELIVERY_ROOT}/planted-entry.ts → apps/web/src/game/trainer-port.ts`;
    for (const code of [
      "const w = new Worker(new URL('../trainer-port.ts', import.meta.url), { type: 'module' });",
      "const w = new SharedWorker(new URL('../trainer-port', import.meta.url));",
      "const w = new globalThis.Worker(new URL('../trainer-port.ts', import.meta.url));",
      // A module's URL is how Vite is told to bundle it, whoever uses it later.
      "const script = new URL('../trainer-port.ts', import.meta.url);",
    ]) {
      expect(violations(code), code).toContain(port);
    }
    // A URL to a file that is not a module runs nothing.
    expect(violations("const p = new URL('./planted-picture.png', import.meta.url);")).toEqual([]);
    const fails =
      (code: string): (() => void) =>
      () =>
        walk([`${DELIVERY_ROOT}/planted-entry.ts`], plant(code));
    for (const code of [
      'const w = new Worker(script);',
      "const w = new Worker('/assets/worker.js');",
      'const w = new SharedWorker(new URL(name, import.meta.url));',
      'const w = new Worker(new URL(`../${name}.ts`, import.meta.url));',
      'const w = new window.SharedWorker(url);',
    ]) {
      expect(fails(code), code).toThrow(/cannot follow|by a value/);
    }
    for (const code of [
      "const w = new Worker(new URL('./no-such-worker.ts', import.meta.url));",
      "const w = new Worker(new URL('/public/worker.js', import.meta.url));",
      "const p = new URL('./no-such-picture.png', import.meta.url);",
    ]) {
      expect(fails(code), code).toThrow(/cannot resolve/);
    }
  });

  it('finds every trainer-control writer by rule, and has lost none it found on 2026-10-28', () => {
    for (const path of KNOWN_TRAINER_CONTROL_WRITERS) {
      expect(WRITERS_ON_DISK, path).toContain(path);
    }
    const forbidden = forbiddenInTheTree();
    for (const path of WRITERS_ON_DISK) {
      expect(forbidden, path).toContain(path);
    }
    // Each rule on its own, so a rule deleted is red here and not only above.
    const finds = (code: string): boolean => writesToATrainer(code, 'planted.ts');
    for (const [rule, code] of [
      ['W1', 'await characteristic.writeValueWithResponse(bytes);'],
      ['W1', 'void handle.writeValueWithoutResponse(bytes);'],
      ['W1', 'await BleClient.write(id, service, characteristic, view);'],
      ['W2', 'await port.write(id, FITNESS_MACHINE_SERVICE, FITNESS_MACHINE_CONTROL_POINT, view);'],
      ['W2', 'controlPoint.write(request);'],
      ['W3', 'export const c = { setTargetPower: async (watts) => send(watts) };'],
      ['W3', 'export class C { letGo() { return send(); } }'],
      ['W3', 'export const c = { writeControlPoint: async (bytes) => send(bytes) };'],
      [
        'W4',
        'export interface VendorControlPoint { write(r: R): void }\nexport const p = { write(r) { log.push(r); } };',
      ],
    ] as const) {
      expect(finds(code), `${rule}: ${code}`).toBe(true);
    }
    // Neither a declared shape nor a function that is not a trainer command.
    for (const code of [
      'export interface Channel { writeControlPoint(bytes: Uint8Array): Promise<void>; setTargetPower(w: number): Promise<void> }',
      'function letGo(peer) { peer.close(); }',
      'export const store = { write(record) { rows.push(record); } };',
      'keep.current.write(draft);',
    ]) {
      expect(finds(code), code).toBe(false);
    }
  });

  it('refuses every trainer-control writer when a Delivery module imports it', () => {
    const violations = (code: string): string[] =>
      seamViolations(
        [`${DELIVERY_ROOT}/planted-entry.ts`],
        forbiddenInTheTree(),
        plantedOver({ [`${DELIVERY_ROOT}/planted-entry.ts`]: code }),
      );
    // Each by the specifier its real consumers use, and the module the chain must end at.
    for (const [code, writer] of [
      [
        "import { createFitnessMachineChannel } from '@onyourleft/sensors/web-bluetooth';",
        'packages/sensors/web-bluetooth/src/fitness-machine-channel.ts',
      ],
      [
        // The transport opens the control point and builds the channel above.
        "import { createWebBluetoothTransport } from '@onyourleft/sensors/web-bluetooth';",
        'packages/sensors/web-bluetooth/src/fitness-machine-channel.ts',
      ],
      [
        "import { createCapacitorFitnessMachineChannel } from '@onyourleft/mobile';",
        'apps/mobile/src/ble/fitness-machine-channel.ts',
      ],
      [
        "import { capacitorBlePort } from '@onyourleft/mobile';",
        'apps/mobile/src/ble/ble-client.ts',
      ],
      [
        "import { createTrainerControl } from '@onyourleft/sensors/protocol';",
        'packages/sensors/protocol/src/fitness-machine-control.ts',
      ],
      [
        "import { connectSimulatedTrainer } from '@onyourleft/sensors/protocol/testing';",
        'packages/sensors/protocol/src/simulator-bridge.ts',
      ],
      [
        "import { createSimulator } from '@onyourleft/sensors/simulator';",
        'packages/sensors/src/simulator/ftms.ts',
      ],
      [
        "import { createVendorControlPoint } from '@onyourleft/sensors/simulator';",
        'packages/sensors/src/simulator/vendor-control.ts',
      ],
      [
        "import { recordingBluetooth } from '../../validation/capture';",
        'apps/web/src/validation/capture.ts',
      ],
      [
        "import { rideInProgress } from '../../ride/controller';",
        'apps/web/src/ride/controller.ts',
      ],
      ["import { createGradientSession } from '../gradient';", 'apps/web/src/game/gradient.ts'],
    ] as const) {
      const found = violations(code);
      expect(
        found.some(
          (chain) =>
            chain.startsWith(`${DELIVERY_ROOT}/planted-entry.ts → `) &&
            chain.endsWith(` → ${writer}`),
        ),
        `${code}\n${found.join('\n')}`,
      ).toBe(true);
    }
  });
});
