// SPDX-License-Identifier: Apache-2.0

/**
 * The GPX and TCX half of the corpus.
 *
 * Both are XML, and XML is where this program's file import gets attacked.
 * `SECURITY.md` puts it plainly: *"Activity file parsing. FIT/GPX/TCX come from
 * user-supplied files. Malformed input must produce an error — never memory
 * corruption, a crash loop, resource exhaustion or code execution. XXE in GPX
 * and TCX is specifically in scope."* So the corpus carries a hostile document
 * in each format, and #32 has something to prove its rejection against rather
 * than a code comment claiming one.
 *
 * The tracks are the same synthetic tracks the FIT fixtures use, so a round trip
 * through either text format can be compared against the binary one point for
 * point.
 */

import type { GeographicPosition } from '@onyourleft/domain';

import type { TrackSpecification } from './ride';
import { positionAt, RIDE_START_UNIX_SECONDS } from './ride';
import { decimal, degrees, document, isoInstant, xmlText } from './xml-builder';

const GPX_NAMESPACE = 'http://www.topografix.com/GPX/1/1';
const GPX_TRACK_POINT_EXTENSION_NAMESPACE =
  'http://www.garmin.com/xmlschemas/TrackPointExtension/v1';
const TCX_NAMESPACE = 'http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2';
const TCX_ACTIVITY_EXTENSION_NAMESPACE = 'http://www.garmin.com/xmlschemas/ActivityExtension/v2';

/**
 * The creator string every document in this corpus carries.
 *
 * It says what produced the file, which is this repository, and it deliberately
 * does not impersonate a head unit. A fixture claiming to come from a real
 * device invites the next contributor to compare it against a real one.
 */
const CREATOR = xmlText('On Your Left synthetic fixture generator');

/** The track name every nominal document carries, escaped for the same reason. */
const TRACK_NAME = xmlText('Synthetic fixture ride');

/** A built text fixture: its text, and the positions it contains, in order. */
export interface XmlFixture {
  readonly text: string;
  readonly positions: readonly GeographicPosition[];
}

interface TrackPoint {
  readonly position: GeographicPosition;
  readonly unixSeconds: number;
  readonly altitudeMetres: number;
  readonly distanceMetres: number;
  readonly heartRate: number;
  readonly cadence: number;
  readonly power: number;
}

function trackPoints(track: TrackSpecification, count: number): readonly TrackPoint[] {
  return Array.from({ length: count }, (_, index) => ({
    position: positionAt(track, index),
    unixSeconds: RIDE_START_UNIX_SECONDS + index,
    altitudeMetres: 12 + ((index * 3) % 40) / 10,
    distanceMetres: index * 7 + ((index * 13) % 5),
    heartRate: 118 + ((index * 7) % 41),
    cadence: 76 + ((index * 3) % 19),
    power: 165 + ((index * 11) % 97),
  }));
}

/** A nominal GPX 1.1 track with the extension channels a cycling file carries. */
export function nominalGpx(track: TrackSpecification, count: number): XmlFixture {
  const points = trackPoints(track, count);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="${CREATOR}" xmlns="${GPX_NAMESPACE}" xmlns:gpxtpx="${GPX_TRACK_POINT_EXTENSION_NAMESPACE}">`,
    '  <metadata>',
    `    <time>${isoInstant(RIDE_START_UNIX_SECONDS)}</time>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${TRACK_NAME}</name>`,
    '    <type>cycling</type>',
    '    <trkseg>',
    ...points.flatMap((point) => [
      `      <trkpt lat="${degrees(point.position.latitude)}" lon="${degrees(point.position.longitude)}">`,
      `        <ele>${decimal(point.altitudeMetres, 1)}</ele>`,
      `        <time>${isoInstant(point.unixSeconds)}</time>`,
      '        <extensions>',
      '          <gpxtpx:TrackPointExtension>',
      `            <gpxtpx:hr>${String(point.heartRate)}</gpxtpx:hr>`,
      `            <gpxtpx:cad>${String(point.cadence)}</gpxtpx:cad>`,
      '          </gpxtpx:TrackPointExtension>',
      '        </extensions>',
      '      </trkpt>',
    ]),
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
  ];
  return { text: document(lines), positions: points.map((point) => point.position) };
}

/** A nominal TCX v2 activity with one lap. */
export function nominalTcx(track: TrackSpecification | undefined, count: number): XmlFixture {
  const points = track ? trackPoints(track, count) : trackPoints(NO_TRACK_PLACEHOLDER, count);
  const last = points.at(-1);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<TrainingCenterDatabase xmlns="${TCX_NAMESPACE}" xmlns:ns3="${TCX_ACTIVITY_EXTENSION_NAMESPACE}">`,
    '  <Activities>',
    '    <Activity Sport="Biking">',
    `      <Id>${isoInstant(RIDE_START_UNIX_SECONDS)}</Id>`,
    `      <Lap StartTime="${isoInstant(RIDE_START_UNIX_SECONDS)}">`,
    `        <TotalTimeSeconds>${decimal(count - 1, 1)}</TotalTimeSeconds>`,
    `        <DistanceMeters>${decimal(last ? last.distanceMetres : 0, 1)}</DistanceMeters>`,
    '        <Intensity>Active</Intensity>',
    '        <TriggerMethod>Manual</TriggerMethod>',
    '        <Track>',
    ...points.flatMap((point) => [
      '          <Trackpoint>',
      `            <Time>${isoInstant(point.unixSeconds)}</Time>`,
      ...(track
        ? [
            '            <Position>',
            `              <LatitudeDegrees>${degrees(point.position.latitude)}</LatitudeDegrees>`,
            `              <LongitudeDegrees>${degrees(point.position.longitude)}</LongitudeDegrees>`,
            '            </Position>',
            `            <AltitudeMeters>${decimal(point.altitudeMetres, 1)}</AltitudeMeters>`,
          ]
        : []),
      `            <DistanceMeters>${decimal(point.distanceMetres, 1)}</DistanceMeters>`,
      '            <HeartRateBpm>',
      `              <Value>${String(point.heartRate)}</Value>`,
      '            </HeartRateBpm>',
      `            <Cadence>${String(point.cadence)}</Cadence>`,
      '            <Extensions>',
      '              <ns3:TPX>',
      `                <ns3:Watts>${String(point.power)}</ns3:Watts>`,
      '              </ns3:TPX>',
      '            </Extensions>',
      '          </Trackpoint>',
    ]),
    '        </Track>',
    '      </Lap>',
    `      <Creator xsi:type="Device_t" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`,
    `        <Name>${CREATOR}</Name>`,
    '      </Creator>',
    '    </Activity>',
    '  </Activities>',
    '</TrainingCenterDatabase>',
  ];
  return {
    text: document(lines),
    positions: track ? points.map((point) => point.position) : [],
  };
}

// Only ever used to generate the non-position channels of an indoor TCX; its
// coordinates are never written into a document.
const NO_TRACK_PLACEHOLDER: TrackSpecification = {
  startLatitudeE7: 0,
  startLongitudeE7: 0,
  latitudeStepE7: 0,
  longitudeStepE7: 0,
};

/**
 * The XXE payload both hostile fixtures carry.
 *
 * An external general entity pointing at a local file, referenced from a text
 * node. A parser that resolves external entities substitutes the contents of
 * `/etc/passwd` into the track name; a parser that has disabled them either
 * errors or leaves the reference unexpanded, and #32 must do one of those two.
 *
 * The document is otherwise well-formed and its coordinates are inside
 * `NULL-ISLAND`, so it exercises the entity handling and nothing else. A file
 * that was hostile in two ways at once would not tell you which defence failed.
 */
const XXE_DOCTYPE = (rootElement: string) => [
  `<!DOCTYPE ${rootElement} [`,
  '  <!ELEMENT name (#PCDATA)>',
  '  <!ENTITY xxe SYSTEM "file:///etc/passwd">',
  ']>',
];

/**
 * A GPX whose DOCTYPE declares nested entities — the billion-laughs shape.
 *
 * Six levels of ten, so `&lol6;` expands to a million copies of `lol`: three
 * megabytes out of a document under a kilobyte. Ten levels is the classic
 * demonstration and would be a billion; six is chosen because it is already
 * three orders of magnitude and a parser that *does* expand entities should
 * fail this test by taking three megabytes, not by hanging a CI runner for
 * minutes before anyone sees a result.
 *
 * #32's revision block asks for this specifically: *"Billion-laughs / entity
 * expansion is the same class and is not covered by the two [XXE] fixtures —
 * add one."* It is the same class because both need a DTD, and the defence is
 * therefore the same one; carrying both files is what proves the defence was
 * not written against one example.
 *
 * The document is otherwise well-formed and carries no coordinates at all, so
 * it exercises the entity handling and nothing else.
 */
export function billionLaughsGpx(): XmlFixture {
  const levels = Array.from({ length: 6 }, (_, index) => {
    const name = `lol${String(index + 1)}`;
    const inner = index === 0 ? 'lol' : `lol${String(index)}`;
    return `  <!ENTITY ${name} "${`&${inner};`.repeat(10)}">`;
  });
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE gpx [',
    '  <!ELEMENT name (#PCDATA)>',
    '  <!ENTITY lol "lol">',
    ...levels,
    ']>',
    `<gpx version="1.1" creator="${CREATOR}" xmlns="${GPX_NAMESPACE}">`,
    '  <trk>',
    '    <name>&lol6;</name>',
    '    <trkseg/>',
    '  </trk>',
    '</gpx>',
  ];
  return { text: document(lines), positions: [] };
}

/**
 * The nominal GPX, cut off in the middle of its last track point's `<time>`.
 *
 * The FIT half of the corpus has `truncated-mid-record.fit` and the text half
 * had nothing equivalent, so #32's criterion — *"a truncated XML file produces
 * a structured error, not a partial silent success"* — had only a
 * string-slicing test to assert against. This is the committed artefact.
 *
 * The cut is deliberately **past** the final `<trkpt>`'s `lat` and `lon`
 * attributes, so every coordinate in the file still pairs and the ADR 0004
 * decision G region guard can see all of them. A file whose coordinates did not
 * pair would fail that guard for a reason that has nothing to do with
 * truncation.
 */
export function truncatedGpx(track: TrackSpecification, count: number): XmlFixture {
  const full = nominalGpx(track, count);
  const marker = '<time>';
  const lastTime = full.text.lastIndexOf(marker);
  return { text: full.text.slice(0, lastTime + marker.length + 8), positions: full.positions };
}

export function xxeGpx(track: TrackSpecification, count: number): XmlFixture {
  const points = trackPoints(track, count);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    ...XXE_DOCTYPE('gpx'),
    `<gpx version="1.1" creator="${CREATOR}" xmlns="${GPX_NAMESPACE}">`,
    '  <trk>',
    '    <name>&xxe;</name>',
    '    <trkseg>',
    ...points.flatMap((point) => [
      `      <trkpt lat="${degrees(point.position.latitude)}" lon="${degrees(point.position.longitude)}">`,
      `        <time>${isoInstant(point.unixSeconds)}</time>`,
      '      </trkpt>',
    ]),
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
  ];
  return { text: document(lines), positions: points.map((point) => point.position) };
}

export function xxeTcx(track: TrackSpecification, count: number): XmlFixture {
  const points = trackPoints(track, count);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    ...XXE_DOCTYPE('TrainingCenterDatabase'),
    `<TrainingCenterDatabase xmlns="${TCX_NAMESPACE}">`,
    '  <Activities>',
    '    <Activity Sport="Biking">',
    '      <Id>&xxe;</Id>',
    `      <Lap StartTime="${isoInstant(RIDE_START_UNIX_SECONDS)}">`,
    '        <Intensity>Active</Intensity>',
    '        <TriggerMethod>Manual</TriggerMethod>',
    '        <Track>',
    ...points.flatMap((point) => [
      '          <Trackpoint>',
      `            <Time>${isoInstant(point.unixSeconds)}</Time>`,
      '            <Position>',
      `              <LatitudeDegrees>${degrees(point.position.latitude)}</LatitudeDegrees>`,
      `              <LongitudeDegrees>${degrees(point.position.longitude)}</LongitudeDegrees>`,
      '            </Position>',
      '          </Trackpoint>',
    ]),
    '        </Track>',
    '      </Lap>',
    '    </Activity>',
    '  </Activities>',
    '</TrainingCenterDatabase>',
  ];
  return { text: document(lines), positions: points.map((point) => point.position) };
}
