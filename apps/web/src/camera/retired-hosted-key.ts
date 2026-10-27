// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * **No hosted key left on any device** — [#1103](https://github.com/openzigs/onyourleft/issues/1103),
 * ADR 0046 D-1.
 *
 * From #518 to #1103 a rider could type a hosted model service's key on the
 * Camera page, and this device kept it in `localStorage` under
 * {@link RETIRED_HOSTED_MODEL_STORAGE_KEY}. #1103 removed that path: a
 * write-up is asked of the rider's instance only, and a hosted service is
 * used on a key the rider stores THERE (`ride-analysis/hosted-settings.ts`).
 *
 * ## What happens on the first launch after the update
 *
 * `main.tsx` calls {@link retireDeviceHostedKey} before it renders anything.
 * A key this device still holds is deleted, and a note is left so the rider is
 * told once, in one sentence ({@link RETIRED_KEY_BEFORE}), on the Camera page
 * where they typed it. The note holds no key, address or model — only that
 * there was one. The Camera page reads it and takes it away
 * ({@link readRetiredKeyNotice}, {@link forgetRetiredKeyNotice}), so the next
 * visit says nothing.
 *
 * Nothing else is deleted: the rider's rides, write-ups and settings are
 * untouched, and a write-up saved by the old path still renders.
 */

/** Where this device kept the hosted key before #1103. Read here only to delete it. */
export const RETIRED_HOSTED_MODEL_STORAGE_KEY = 'oyl.hosted-model.v1';

/** The note that a key was deleted, until the Camera page has said so once. */
export const RETIRED_KEY_NOTICE_STORAGE_KEY = 'oyl.hosted-model-retired.v1';

/**
 * #1104 A1, around a link to the Connect screen whose words are that route's
 * title, as #1104 B4 does.
 */
export const RETIRED_KEY_BEFORE =
  'Write-ups are now written on your instance. The key you entered on this device for a hosted ' +
  'service has been deleted from this device; to use a service, store your own key on your ' +
  'instance in';
export const RETIRED_KEY_AFTER = '.';

/** The parts of a `Storage` this uses, so a test can hand it a double. */
export type RetiredKeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** This device's storage, or `undefined` where the browser refuses it. */
export function deviceRetiredKeyStorage(): RetiredKeyStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Delete a hosted key this device still holds, and leave the note that it did.
 * Does nothing where there is none. Never throws: a device that will not let
 * go of it cannot be made to.
 */
export function retireDeviceHostedKey(storage: RetiredKeyStorage | undefined): void {
  try {
    if (storage === undefined || storage.getItem(RETIRED_HOSTED_MODEL_STORAGE_KEY) === null) return;
    storage.removeItem(RETIRED_HOSTED_MODEL_STORAGE_KEY);
    storage.setItem(RETIRED_KEY_NOTICE_STORAGE_KEY, 'yes');
  } catch {
    // Refused storage: there is nothing more this can do.
  }
}

/** Whether the rider is still to be told that their key was deleted. Reads only. */
export function readRetiredKeyNotice(storage: RetiredKeyStorage | undefined): boolean {
  try {
    return storage?.getItem(RETIRED_KEY_NOTICE_STORAGE_KEY) === 'yes';
  } catch {
    return false;
  }
}

/** The rider has been told: the note goes. */
export function forgetRetiredKeyNotice(storage: RetiredKeyStorage | undefined): void {
  try {
    storage?.removeItem(RETIRED_KEY_NOTICE_STORAGE_KEY);
  } catch {
    // Refused storage: the sentence may show again, which tells the rider twice and hides nothing.
  }
}

/**
 * What an erase calls (`transfer/erase-device.ts` §`eraseDevice`): the key, if
 * it is somehow still here, and the note. Neither is a store row, so
 * `deleteAthlete` cannot see them.
 */
export function retiredHostedKeyEraser(storage: RetiredKeyStorage | undefined): {
  forget(): void;
} {
  return {
    forget: () => {
      try {
        storage?.removeItem(RETIRED_HOSTED_MODEL_STORAGE_KEY);
      } catch {
        // A device that will not forget cannot be made to.
      }
      forgetRetiredKeyNotice(storage);
    },
  };
}
