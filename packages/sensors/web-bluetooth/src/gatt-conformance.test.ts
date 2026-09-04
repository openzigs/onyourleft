// SPDX-License-Identifier: Apache-2.0

/**
 * The port in `gatt.ts` is checked against the real Web Bluetooth API.
 *
 * `gatt.ts` declares its own six interfaces rather than importing the browser's,
 * for reasons its header sets out — chiefly that a fake satisfying six small
 * structural interfaces is twenty lines, and a fake satisfying five
 * `EventTarget` subclasses is a fake nobody writes. The cost of that choice is
 * drift: a port that no longer describes the browser is a bug that appears on
 * somebody's trainer and nowhere else.
 *
 * This file is what stops it. `@types/web-bluetooth` (MIT, types only, no
 * dependencies, and in `packages/sensors/tsconfig.json`'s `types` for this one
 * purpose) supplies the real declarations, and each assignment below fails to
 * compile if the port asks for something the browser does not offer, or asks for
 * it in a shape the browser does not use.
 *
 * ## Direction matters, and only one direction is right
 *
 * The assertions are **real → port**: a `Bluetooth` must be usable as a
 * `BluetoothPort`, because that is what the adapter does with `navigator.bluetooth`.
 * The reverse would be wrong and would pass nothing useful — the port is a
 * deliberate subset, and `BluetoothPort` is not a `Bluetooth`.
 *
 * There is no runtime assertion here and there cannot be: these types have no
 * values under Node. `expect(true)` at the end is not the test — the test is
 * that this file compiles, which `pnpm run typecheck` decides.
 */

import { describe, expect, it } from 'vitest';

import type {
  BluetoothDevicePort,
  BluetoothPort,
  GattCharacteristicPort,
  GattServerPort,
  GattServicePort,
} from './gatt';

/**
 * `true` when the browser's type can stand in for the port's, and `never`
 * otherwise — so the assignment below is the assertion and the failure is
 * `Type 'boolean' is not assignable to type 'never'`.
 *
 * Type-level rather than a `declare function` that is never called: a
 * declaration has no runtime, and a test file that references one throws
 * `ReferenceError` before a single assertion runs. That was the first version of
 * this file, and it failed loudly, which is the only reason it is not still
 * here.
 */
type StandsInFor<Real, Port> = Real extends Port ? true : never;

const bluetooth: StandsInFor<Bluetooth, BluetoothPort> = true;
const device: StandsInFor<BluetoothDevice, BluetoothDevicePort> = true;
const server: StandsInFor<BluetoothRemoteGATTServer, GattServerPort> = true;
const service: StandsInFor<BluetoothRemoteGATTService, GattServicePort> = true;
const characteristic: StandsInFor<BluetoothRemoteGATTCharacteristic, GattCharacteristicPort> = true;

/**
 * And `navigator.bluetooth` itself, which is the actual expression the adapter
 * reads. `@types/web-bluetooth` augments `Navigator`, so this is the assignment
 * `defaultBluetooth()` performs, checked rather than cast.
 */
const fromNavigator: StandsInFor<Navigator['bluetooth'], BluetoothPort> = true;

describe('the Web Bluetooth port', () => {
  it('describes the browser API it stands in for', () => {
    // Every binding above is a compile-time assertion; this keeps the runner
    // from reporting a file with no tests, and touching them keeps
    // `noUnusedLocals` satisfied without a disable directive.
    expect([bluetooth, device, server, service, characteristic, fromNavigator]).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});
