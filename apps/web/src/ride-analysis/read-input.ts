// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * A saved ride, read as #809's {@link RideAnalysisInput} — for the post-ride
 * ask (`ride-analysis.ts`, #804) and for the ride summary a device syncs to
 * its rider's instance for their history (`ride-summary.ts`, #835). One
 * reader, so the two can never describe one ride from different reads.
 */

import type {
  ActivityId,
  ActivityRecord,
  AthleteId,
  AthleteRecord,
  LapRecord,
  RouteId,
  RouteRecord,
  SideCameraReportRecord,
  StreamSet,
} from '@onyourleft/store';

import type { SideSessionSummary } from '../camera/side-session-summary';
import { rideAnalysisInput, type RideAnalysisInput } from './input';

/** What reading a ride's input reads. `ActivityStore` satisfies it as it stands. */
export interface RideInputStore {
  getActivity(owner: AthleteId, id: ActivityId): Promise<ActivityRecord | undefined>;
  getStreamSet(owner: AthleteId, id: ActivityId): Promise<StreamSet | undefined>;
  getAthlete(id: AthleteId): Promise<AthleteRecord | undefined>;
  listLaps(owner: AthleteId, id: ActivityId): Promise<LapRecord[]>;
  getRoute(owner: AthleteId, id: RouteId): Promise<RouteRecord | undefined>;
  getSideCameraReport(
    owner: AthleteId,
    id: ActivityId,
  ): Promise<SideCameraReportRecord | undefined>;
}

/** A pose summary as the input reads it, copied field by field from the stored one. */
function poseFrom(report: SideCameraReportRecord | undefined): SideSessionSummary | undefined {
  const pose = report?.pose;
  if (pose === null || pose === undefined) {
    return undefined;
  }
  return {
    source: pose.source,
    differences: { ...pose.differences },
    posed: pose.posed,
    noRider: pose.noRider,
    unreadable: pose.unreadable,
  };
}

/**
 * Ride `activityId`'s input, or `undefined` when it cannot be read or is not
 * `owner`'s. Nothing of a store error is read: its messages name records.
 * The side-camera report is read only when `cameraConsented` — so a caller
 * that never sends the pose summary (the ride summary, ADR 0040 D-2 item 1)
 * never reads it either.
 */
export async function readRideInput(
  store: RideInputStore,
  owner: AthleteId,
  activityId: ActivityId,
  options: { readonly templateVersion: string; readonly cameraConsented: boolean },
): Promise<RideAnalysisInput | undefined> {
  try {
    const ride = await store.getActivity(owner, activityId);
    if (ride === undefined) {
      return undefined;
    }
    const [streams, athlete, laps, report, route] = await Promise.all([
      store.getStreamSet(owner, activityId),
      store.getAthlete(owner),
      store.listLaps(owner, activityId),
      options.cameraConsented ? store.getSideCameraReport(owner, activityId) : undefined,
      ride.routeId === undefined ? undefined : store.getRoute(owner, ride.routeId),
    ]);
    const pose = poseFrom(report);
    return rideAnalysisInput(ride, streams, athlete, {
      templateVersion: options.templateVersion,
      laps,
      ...(route === undefined ? {} : { route: route.profile }),
      ...(pose === undefined ? {} : { pose }),
      cameraConsented: options.cameraConsented,
    });
  } catch {
    return undefined;
  }
}
