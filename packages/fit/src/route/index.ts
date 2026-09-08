// SPDX-License-Identifier: Apache-2.0

/** Route import — #89, `gpx-route.ts` — and route export — #74. */

export type { DecodedRoute } from './gpx-route';
export { decodeGpxRoute } from './gpx-route';

export type {
  ExportableRoute,
  RouteExportFault,
  RouteExportFaultCode,
  RouteExportOptions,
  RouteExportResult,
} from './course';

export {
  courseSampleCount,
  GRADIENT_FAULT,
  ODBL_LICENCE_URL,
  OSM_ATTRIBUTION,
  ROUTE_CREATOR,
} from './course';

export { encodeGpxRoute } from './gpx-course';

export { encodeTcxRoute, TCX_COURSE_NAME_LIMIT } from './tcx-course';
