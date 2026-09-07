// SPDX-License-Identifier: AGPL-3.0-or-later

/** Throwaway. Proves CI's Typecheck step can go red. Never merged. */
export function probe(): number {
  const wrong: number = 'not a number';
  return wrong;
}
