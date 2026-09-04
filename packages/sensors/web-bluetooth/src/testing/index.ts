// SPDX-License-Identifier: Apache-2.0

/**
 * `@onyourleft/sensors/web-bluetooth/testing` — the scripted Web Bluetooth stack.
 *
 * A named entry point rather than a re-export, for the reason
 * `@onyourleft/sensors/simulator` is one: nothing that ships should carry a test
 * double, and an entry point nobody imports is not in the bundle.
 *
 * #41–#43 are its intended users. Each of them writes a decoder for bytes that
 * arrive from a device, and `createFakeBluetooth` is how a decoder gets driven
 * through a whole link lifecycle — connect, notify, drop, reconnect — without a
 * trainer on the desk.
 */

export type {
  FakeBluetooth,
  FakeBluetoothBench,
  FakeBluetoothOptions,
  FakeChooser,
  FakeDeviceHandle,
  FakeDeviceSpec,
  FakeGattOperation,
  FakeServiceSpec,
  HeldOperation,
  RequestInspection,
} from './fake-bluetooth';

export { createFakeBluetooth, domError } from './fake-bluetooth';

export {
  heartRateFrame,
  multiFrame,
  singleFrame,
  STUB_HEART_RATE_CHARACTERISTIC,
  STUB_HEART_RATE_SERVICE,
  STUB_MULTI_CHARACTERISTIC,
  STUB_MULTI_SERVICE,
  STUB_SINGLE_CHARACTERISTIC,
  STUB_SINGLE_SERVICE,
  stubEmptyDevice,
  stubGattlessDevice,
  stubHeartRateProfile,
  stubMultiProfile,
  stubSingleProfile,
  stubNamelessDevice,
  stubStrapDevice,
  stubTrainerDevice,
} from './profiles';
