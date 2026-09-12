// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * How a component finds out which units to render in (#238).
 *
 * ## Why a context rather than a prop
 *
 * Distance and speed are rendered on nine of this client's routes, several of
 * them three components deep. Threading a `units` prop through every one would
 * put the preference in the signature of components that do not render a
 * number at all, and a component that forgot to pass it down would render
 * *metric* — which is the silent half-conversion #238 exists to stop, arriving
 * by a new route.
 *
 * So the **pure** functions take the unit system as an ordinary parameter
 * (`format.ts`, `library/rows.ts`, `game/hud/fields.ts`), because a pure
 * function that reaches for a React context is not testable as a pure function
 * — and the **components** read it from here.
 *
 * ## The default is a real answer, not a placeholder
 *
 * A component rendered with no provider reads {@link DEFAULT_UNIT_SYSTEM}.
 * That is what the accessibility suite gets — it renders every route with no
 * ports and no providers — and it is what a rider who has never chosen gets,
 * so the two agree by construction rather than by coincidence. `AppShell`
 * supplies the provider for the real client.
 */

import { createContext, useContext, type JSX, type ReactNode } from 'react';

import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from '@onyourleft/store';

const UnitsContext = createContext<UnitSystem>(DEFAULT_UNIT_SYSTEM);

export interface UnitsProviderProps {
  readonly units: UnitSystem;
  readonly children: ReactNode;
}

/** Makes `units` the answer {@link useUnits} gives anywhere below it. */
export function UnitsProvider({ units, children }: UnitsProviderProps): JSX.Element {
  return <UnitsContext value={units}>{children}</UnitsContext>;
}

/** The units this subtree renders in. {@link DEFAULT_UNIT_SYSTEM} with no provider. */
export function useUnits(): UnitSystem {
  return useContext(UnitsContext);
}
