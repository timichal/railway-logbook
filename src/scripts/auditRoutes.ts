#!/usr/bin/env tsx
/**
 * The route data audit: candidate findings on the valid routes, for a review by
 * eye. Read-only. The procedure around it (fresh data first, what to drop, how
 * to report, where accepted findings go) is the `route-audit` skill
 * (`.claude/skills/route-audit/SKILL.md`), and the label conventions are in the
 * root CLAUDE.md ("Route labels").
 *
 * Every check here is a heuristic, so a list is a set of places to look, never a
 * set of errors. Findings the admin has already accepted are in
 * `ROUTE_DATA_AUDIT.md`, which this script does not read. The checks:
 *
 * - **Labels**: a label no station near either end matches; an end that sits on
 *   a station neither label names (a click one station off); two routes meeting
 *   at one point under different names; a route that should meet the others of
 *   its name and doesn't (a misclick on the wrong track, a gap a journey can't
 *   chain across); spellings that differ only in diacritics, case or separators;
 *   a label missing diacritics the OSM station has; malformed labels.
 * - **Geometry**: duplicates, overlaps, detours and stubs, unintended
 *   backtracking, gaps inside a named line.
 * - **Fields**: missing usage tags or line names where the region needs them,
 *   retired usage tags (`RETIRED_TAGS`), tags and line names that look like typos of a common one, a tag on a usage
 *   type it is otherwise never used with, stray whitespace, bad links.
 *
 * **Valid routes only** (`is_valid`), closed ones included: an invalid route is
 * the admin's to re-pick anyway, and the audit looks again once it is valid.
 *
 * **Incremental by default.** `--save-baseline` records a fingerprint of every
 * audited route (labels, fields, click points) in `data/route-audit-baseline.json`.
 * A later run reports only the findings that involve a route new or changed
 * since then, or valid again after a re-pick, so the accepted findings stay
 * quiet. `updated_at` can't serve for this: every recalculation after a map
 * deploy bumps it. `--all` ignores the baseline.
 *
 * Usage: npm run auditRoutes -- [--region=europe|japan] [--all] [--save-baseline]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import pool from "../lib/db";
import { withinMetersSql } from "../lib/mercatorDistance";
import { haversineDistance } from "../lib/shared/geoUtils";
import { JOIN_DISTANCE_M } from "../lib/shared/journeyChains";
import { isRegionId, REGIONS, type RegionId, regionContainsSql } from "../lib/shared/regions";

const BASELINE_FILE = path.join(process.cwd(), "data", "route-audit-baseline.json");

/** Stations this far from either end are what a label is checked against. */
const STATION_SEARCH_M = 2500;
/** An end this close to a station is at that station. */
const AT_STATION_M = 100;
/**
 * From/To say nothing of which end is which. A label is placed at the end with a
 * station of exactly its name within this distance, and its partner at the other;
 * where no label or both ends tell, a label may sit at either end.
 */
const ORIENTATION_STATION_M = 1000;
/** A label matching no station near its route at least this well is reported. */
const LABEL_MATCH = 0.5;
/** A station at an end matching neither label at least this well is reported. */
const STATION_MATCH = 0.4;
/** Two ends this close are one point, which carries one name. */
const SAME_POINT_M = 25;
/** Routes sharing a label are compared when their ends are this close. */
const SAME_NAME_RADIUS_M = 5000;
/** Labels differing in diacritics are compared when their ends are this close. */
const SPELLING_RADIUS_M = 20000;
/** Shared track up to this length is normal at stations and junctions. */
const OVERLAP_KM = 0.7;
/** A route this many times longer than the straight line, and long enough. */
const DETOUR_RATIO = 2;
const DETOUR_MIN_KM = 3;
/** Shorter than this, a route is probably a stray double click. */
const STUB_KM = 0.3;
/** Pieces of one named line this close are a near miss, not a missing stretch. */
const LINE_GAP_KM = 3;
/** Todo notes this close to a reported route are printed beside it. */
const TODO_NOTE_M = 500;
/** A tag at least this often on one usage type is out of place on another. */
const TAG_TYPE_MIN_USES = 5;
const TAG_TYPE_SHARE = 0.9;
/**
 * Usage tags from before the current tag set, never to be used on a valid route.
 * "Seasonal" says nothing of when: it became "Daily in summer", "Summer weekends"
 * and the like. Compared case and diacritics aside. Only checked in the regions
 * that require usage tags: that tag set is theirs, and Japan tags its own way
 * ("Seasonal" is fine there).
 */
const RETIRED_TAGS = ["Seasonal"];

interface Options {
  region: RegionId | null;
  all: boolean;
  saveBaseline: boolean;
}

interface Finding {
  /** The routes it is about; the first is the one to look at. */
  ids: number[];
  text: string;
  details?: string[];
}

interface Section {
  title: string;
  /** What to make of the list, printed under the title. */
  note: string;
  findings: Finding[];
}

interface Baseline {
  savedAt: string;
  fingerprints: Record<string, string>;
}

function parseOptions(argv: string[]): Options {
  const options: Options = { region: null, all: false, saveBaseline: false };
  for (const arg of argv) {
    if (arg === "--all") options.all = true;
    else if (arg === "--save-baseline") options.saveBaseline = true;
    else if (arg.startsWith("--region=")) {
      const region = arg.slice("--region=".length);
      if (!isRegionId(region)) throw new Error(`Unknown region "${region}"`);
      options.region = region;
    } else throw new Error(`Unknown argument "${arg}"`);
  }
  return options;
}

function readBaseline(): Baseline | null {
  if (!existsSync(BASELINE_FILE)) return null;
  return JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baseline;
}

/** Ground metres between two 3857 geometries, at the latitude `latSql`. */
const metersSql = (a: string, b: string, latSql: string) =>
  `ST_Distance(${a}, ${b}) * cos(radians(${latSql}))`;

/**
 * How well a folded label names a folded station name, 0–1: trigram similarity,
 * or 1 where one contains the other ("Kobe-Sannomiya" and OSM's "Sannomiya").
 * Both arguments are `search_key` folds, which drop the separators.
 */
const matchScoreSql = (label: string, station: string) => `GREATEST(
  similarity(${label}, ${station}),
  word_similarity(${label}, ${station}),
  word_similarity(${station}, ${label}),
  CASE WHEN (length(${label}) >= 4 AND strpos(${station}, ${label}) > 0)
         OR (length(${station}) >= 4 AND strpos(${label}, ${station}) > 0) THEN 1 ELSE 0 END)`;

/**
 * Stations a label can be compared with. A name in Japanese script (OSM had no
 * romanization) and pruneData's placeholder can match no label, so they would
 * only add noise.
 */
const COMPARABLE_STATION_SQL = `s.name ~ '[A-Za-z]' AND s.name <> 'Unknown Station'`;

/** The audited routes, their ends and their labels, as session temp tables. */
async function createWorkingTables(client: PoolClient, options: Options): Promise<void> {
  const regionIds = Object.keys(REGIONS) as RegionId[];
  const regionCase = `CASE ${regionIds
    .map((id) => `WHEN ${regionContainsSql(id, "starting_coordinate")} THEN '${id}'`)
    .join(" ")} END`;
  const scope = options.region
    ? `AND ${regionContainsSql(options.region, "starting_coordinate")}`
    : "";

  await client.query(`
    CREATE TEMP TABLE audit_routes AS
    SELECT
      track_id AS id, name, other_names, from_station AS f, to_station AS t,
      search_key(from_station) AS fk, search_key(to_station) AS tk,
      ARRAY(SELECT search_key(line) FROM unnest(array_remove(array_prepend(name, other_names), NULL)) line) AS line_keys,
      usage_type, usage_tags, link, link_name, description, closed, length_km::float8 AS length_km,
      has_backtracking AND NOT intended_backtracking AS backtracks,
      start_country, end_country,
      starting_coordinate AS s, ending_coordinate AS e,
      ST_Transform(starting_coordinate, 3857) AS s3, ST_Transform(ending_coordinate, 3857) AS e3,
      ST_Transform(ST_Collect(starting_coordinate, ending_coordinate), 3857) AS ends3,
      geometry_3857 AS g3, ST_Y(starting_coordinate) AS lat,
      ${regionCase} AS region,
      -- What the admin edits, plus what a recalculation can change without the
      -- click points moving: the length to 0.1 km (a detour, a path onto another
      -- route's track) and the backtracking flags. Not the geometry itself, which
      -- a moved OSM node changes under every route at each map deploy
      md5(row(from_station, to_station, name, other_names, usage_type, usage_tags, link, link_name,
              description, closed, ST_AsText(starting_coordinate), ST_AsText(ending_coordinate),
              round(length_km::numeric, 1), has_backtracking, intended_backtracking)::text) AS fingerprint,
      true AS changed
    FROM railway_routes
    WHERE is_valid ${scope}
  `);
  await client.query(`CREATE INDEX ON audit_routes USING gist (g3)`);
  await client.query(`
    CREATE TEMP TABLE audit_ends AS
    SELECT r.id, x.side, x.p, x.p3, ST_Y(x.p) AS lat
    FROM audit_routes r, LATERAL (VALUES ('start', r.s, r.s3), ('end', r.e, r.e3)) x(side, p, p3)
  `);
  await client.query(`CREATE INDEX ON audit_ends USING gist (p3)`);
  // `base` is the label without its bracketed note: the place a junction is named by
  await client.query(String.raw`
    CREATE TEMP TABLE audit_labels AS
    SELECT id, which, label, base, search_key(label) AS label_key, search_key(base) AS base_key,
      label ~ '\[[^\]]*\]\s*$' AS bracketed
    FROM (
      SELECT r.id, x.which, x.label, btrim(regexp_replace(x.label, '\s*\[[^\]]*\]\s*$', '')) AS base
      FROM audit_routes r, LATERAL (VALUES ('from', r.f), ('to', r.t)) x(which, label)
    ) l
  `);
  // How well each label names a station near each end, 0 where none is near
  const scoreAt = (end: string) => `coalesce((
      SELECT max(${matchScoreSql("l.base_key", "s.name_key")})
      FROM stations s
      WHERE ${withinMetersSql("s.coordinates_3857", end, STATION_SEARCH_M, "r.lat")}
        AND ${COMPARABLE_STATION_SQL}
    ), 0)`;
  // Whether a station of exactly the label's name (folded) is near an end
  const namedAt = (end: string) => `EXISTS (
      SELECT 1 FROM stations s
      WHERE ${withinMetersSql("s.coordinates_3857", end, ORIENTATION_STATION_M, "r.lat")}
        AND s.name_key = l.base_key
    )`;
  await client.query(`
    ALTER TABLE audit_labels
      ADD COLUMN score_start float8 NOT NULL DEFAULT 0, ADD COLUMN score_end float8 NOT NULL DEFAULT 0,
      ADD COLUMN named_start boolean NOT NULL DEFAULT false, ADD COLUMN named_end boolean NOT NULL DEFAULT false,
      ADD COLUMN side text, ADD COLUMN p3 geometry
  `);
  await client.query(`
    UPDATE audit_labels l
    SET score_start = ${scoreAt("r.s3")}, score_end = ${scoreAt("r.e3")},
      named_start = ${namedAt("r.s3")}, named_end = ${namedAt("r.e3")}
    FROM audit_routes r
    WHERE r.id = l.id AND l.base_key <> ''
  `);
  // The end each label sits at, where the stations tell (`side`), and the point
  // to measure it from: that end, or both ends where they don't. Told by exact
  // names alone: the fuzzy score fits either way round wherever names contain
  // each other ("Narita Airport Terminal 2·3" contains Narita, "Vatra Moldoviței"
  // nearly Moldovița), and a label placed at the wrong end reads as a misclick
  await client.query(`
    WITH way_round AS (
      SELECT id,
        count(*) FILTER (WHERE CASE WHEN which = 'from' THEN named_start AND NOT named_end
                                    ELSE named_end AND NOT named_start END) AS forward,
        count(*) FILTER (WHERE CASE WHEN which = 'from' THEN named_end AND NOT named_start
                                    ELSE named_start AND NOT named_end END) AS reverse
      FROM audit_labels GROUP BY id
    )
    UPDATE audit_labels l
    SET side = CASE
        WHEN (w.forward > 0) = (w.reverse > 0) THEN NULL
        WHEN (w.forward > 0) = (l.which = 'from') THEN 'start'
        ELSE 'end' END
    FROM way_round w
    WHERE w.id = l.id
  `);
  await client.query(`
    UPDATE audit_labels l
    SET p3 = CASE l.side WHEN 'start' THEN r.s3 WHEN 'end' THEN r.e3 ELSE r.ends3 END
    FROM audit_routes r
    WHERE r.id = l.id
  `);
  await client.query(`ANALYZE audit_routes; ANALYZE audit_ends; ANALYZE audit_labels`);
}

/**
 * Whether two routes' names should agree: they are on one line, or neither has a
 * line name. Two operators' stations often stand side by side under different
 * names (Meitetsu Ichinomiya, Owari-Ichinomiya), and their platforms hundreds of
 * metres apart under one name (Kintetsu and JR at Tsuruhashi).
 */
const sameLineSql = (a: string, b: string) =>
  `((${a}.line_keys && ${b}.line_keys) OR (cardinality(${a}.line_keys) = 0 AND cardinality(${b}.line_keys) = 0))`;

/** Marks the routes the baseline doesn't know in this form; returns how many. */
async function markChanged(client: PoolClient, baseline: Baseline): Promise<number> {
  const { rows } = await client.query<{ id: number; fingerprint: string }>(
    `SELECT id, fingerprint FROM audit_routes`,
  );
  const changed = rows
    .filter((row) => baseline.fingerprints[row.id] !== row.fingerprint)
    .map((row) => row.id);
  await client.query(`UPDATE audit_routes SET changed = (id = ANY($1::int[]))`, [changed]);
  return changed.length;
}

// ---------------------------------------------------------------- labels

async function labelsNotAtEnds(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{ id: number; label: string; score: number | null }>(`
    SELECT l.id, l.label, round(greatest(l.score_start, l.score_end)::numeric, 2)::float8 AS score
    FROM audit_labels l
    JOIN audit_routes r ON r.id = l.id AND r.changed
    WHERE NOT l.bracketed AND l.base_key <> '' AND greatest(l.score_start, l.score_end) < ${LABEL_MATCH}
    ORDER BY l.id, l.which
  `);
  const nearest = await nearestStations(
    client,
    rows.map((row) => row.id),
  );
  return {
    title: "Label matches no station near either end",
    note: `Typos, wrong pastes, a click at the wrong place, or a station missing from OSM (common: "An endpoint with no OSM station nearby"). Junction labels are left out. Best match score in brackets.`,
    findings: rows.map((row) => ({
      ids: [row.id],
      text: `"${row.label}" (${row.score ?? 0})`,
      details: nearest.get(row.id),
    })),
  };
}

async function endsAtOtherStation(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{ id: number; side: string; station: string; m: number }>(`
    SELECT e.id, e.side, n.name AS station, n.m
    FROM audit_ends e
    JOIN audit_routes r ON r.id = e.id AND r.changed
    CROSS JOIN LATERAL (
      SELECT s.name, s.name_key, round(${metersSql("s.coordinates_3857", "e.p3", "e.lat")})::int AS m
      FROM stations s
      WHERE ${withinMetersSql("s.coordinates_3857", "e.p3", AT_STATION_M, "e.lat")}
        AND ${COMPARABLE_STATION_SQL}
      ORDER BY s.coordinates_3857 <-> e.p3
      LIMIT 1
    ) n
    WHERE NOT EXISTS (
      SELECT 1 FROM audit_labels l
      WHERE l.id = e.id AND l.base_key <> '' AND ${matchScoreSql("l.base_key", "n.name_key")} >= ${STATION_MATCH}
    )
    ORDER BY e.id, e.side
  `);
  return {
    title: `End sits on a station neither label names (within ${AT_STATION_M} m)`,
    note: "A click one station off, or a junction label at a point that is really a station.",
    findings: rows.map((row) => ({
      ids: [row.id],
      text: `${row.side} is ${row.m} m from ${row.station}`,
    })),
  };
}

async function samePointDifferentNames(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{ a: number; b: number; m: number }>(`
    SELECT a.id AS a, b.id AS b, round(min(${metersSql("a.p3", "b.p3", "a.lat")}))::int AS m
    FROM audit_ends a
    JOIN audit_ends b ON a.id < b.id AND ${withinMetersSql("b.p3", "a.p3", SAME_POINT_M, "a.lat")}
    JOIN audit_routes ra ON ra.id = a.id
    JOIN audit_routes rb ON rb.id = b.id
    WHERE (ra.changed OR rb.changed) AND ${sameLineSql("ra", "rb")}
      -- No label the two have in common sits at these ends. A label whose end
      -- the stations don't tell may sit at either
      AND NOT EXISTS (
        SELECT 1 FROM audit_labels la JOIN audit_labels lb ON la.label_key = lb.label_key
        WHERE la.id = a.id AND lb.id = b.id
          AND coalesce(la.side, a.side) = a.side AND coalesce(lb.side, b.side) = b.side
      )
    GROUP BY a.id, b.id
    ORDER BY a.id, b.id
  `);
  return {
    title: `Routes meeting at one point (within ${SAME_POINT_M} m) share no label`,
    note: "One point has one name across every route that ends there. Routes on different named lines are not compared.",
    findings: rows.map((row) => ({ ids: [row.a, row.b], text: `ends ${row.m} m apart` })),
  };
}

/**
 * A route that carries a label its neighbours carry, yet meets none of them,
 * while they meet each other, measured between the ends that carry the label
 * (both ends, where the stations don't tell which): the misclick on a parallel track or a siding, which
 * leaves a gap no journey chains across (`JOIN_DISTANCE_M`). Two routes alone
 * under one name prove nothing, except for a bracketed name, which marks one
 * point. A Heritage & tourist route is compared only with others of its kind:
 * a narrow-gauge or forest railway has its own station beside the main one
 * (Balatonfenyves, Kismaros, Gryfice, Stare Bojanowo). Routes on different named
 * lines are not compared: in Japan two operators' platforms often lie hundreds of
 * metres apart under one name.
 */
async function sameNameNotMeeting(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{
    a: number;
    b: number;
    key: string;
    label: string;
    bracketed: boolean;
    m: number;
    comparable: boolean;
  }>(`
    SELECT DISTINCT ON (la.id, lb.id, la.label_key)
      la.id AS a, lb.id AS b, la.label_key AS key, la.label, la.bracketed,
      ${metersSql("la.p3", "lb.p3", "ra.lat")} AS m,
      ${sameLineSql("ra", "rb")} AND (ra.usage_type = 1) = (rb.usage_type = 1) AS comparable
    FROM audit_labels la
    JOIN audit_labels lb ON la.label_key = lb.label_key AND la.id <> lb.id
    JOIN audit_routes ra ON ra.id = la.id
    JOIN audit_routes rb ON rb.id = lb.id
    WHERE la.label_key <> '' AND ${withinMetersSql("rb.ends3", "ra.ends3", SAME_NAME_RADIUS_M, "ra.lat")}
  `);
  const changed = await changedIds(client);

  const pairDistance = new Map<string, number>();
  const byRouteAndName = new Map<string, typeof rows>();
  for (const row of rows) {
    pairDistance.set(`${row.key}|${row.a}|${row.b}`, row.m);
    const group = `${row.a}|${row.key}`;
    byRouteAndName.set(group, [...(byRouteAndName.get(group) ?? []), row]);
  }

  const findings: Finding[] = [];
  for (const group of byRouteAndName.values()) {
    const { a, key, label, bracketed } = group[0];
    const others = group.filter((row) => row.comparable);
    if (others.some((row) => row.m <= JOIN_DISTANCE_M)) continue;
    const meetingPair = others.flatMap((b) =>
      others
        .filter(
          (c) =>
            c.b !== b.b &&
            (pairDistance.get(`${key}|${b.b}|${c.b}`) ?? Infinity) <= JOIN_DISTANCE_M,
        )
        .map((c) => [b, c]),
    )[0];
    if (!meetingPair && !(bracketed && others.length > 0)) continue;
    const closest = [...others].sort((x, y) => x.m - y.m)[0];
    const ids = [a, ...(meetingPair ? meetingPair.map((row) => row.b) : [closest.b])];
    // Reported when any of them is new: two routes added beside an old one that
    // misses them are what make its misclick visible
    if (!ids.some((id) => changed.has(id))) continue;
    findings.push({
      ids,
      text: meetingPair
        ? `"${label}": ${Math.round(Math.min(...meetingPair.map((row) => row.m)))} m from where the others meet`
        : `"${label}": ${Math.round(closest.m)} m from the other end of that name`,
    });
  }
  return {
    title: `Route doesn't meet the others of its name (further than ${JOIN_DISTANCE_M} m)`,
    note: "A misclick on another track, or a point named twice. Journeys don't chain across the gap.",
    findings,
  };
}

async function spellingVariants(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{
    a: number;
    b: number;
    x: string;
    y: string;
    kind: string;
  }>(`
    SELECT DISTINCT ON (la.base, lb.base) la.id AS a, lb.id AS b, la.base AS x, lb.base AS y,
      CASE WHEN lower(immutable_unaccent(la.base)) = lower(immutable_unaccent(lb.base))
        THEN 'diacritics' ELSE 'case or separators' END AS kind
    FROM audit_labels la
    JOIN audit_labels lb ON la.base_key = lb.base_key AND la.base < lb.base
    JOIN audit_routes ra ON ra.id = la.id
    JOIN audit_routes rb ON rb.id = lb.id
    WHERE la.base_key <> '' AND (ra.changed OR rb.changed)
      AND (
        -- Diacritics differ: a missing one, wherever the two are near
        (lower(immutable_unaccent(la.base)) = lower(immutable_unaccent(lb.base))
          AND lower(la.base) <> lower(lb.base)
          AND ${withinMetersSql("rb.ends3", "ra.ends3", SPELLING_RADIUS_M, "ra.lat")})
        -- Case or separators differ: only at one point on one line, since
        -- operators romanize differently (Japan) and that is kept
        OR (NOT (lower(immutable_unaccent(la.base)) = lower(immutable_unaccent(lb.base))
                 AND lower(la.base) <> lower(lb.base))
          AND ${sameLineSql("ra", "rb")}
          AND ${withinMetersSql("lb.p3", "la.p3", JOIN_DISTANCE_M, "ra.lat")})
      )
    ORDER BY la.base, lb.base, la.id, lb.id
  `);
  return {
    title: "One place spelled two ways",
    note: "A missing diacritic or macron (Europe: the OSM name is the reference; Japan: add macrons, keep the operator's hyphens and case), or one point spelled two ways on one line.",
    findings: rows.map((row) => ({
      ids: [row.a, row.b],
      text: `${row.kind}: "${row.x}" / "${row.y}"`,
    })),
  };
}

async function missingDiacritics(client: PoolClient): Promise<Section> {
  // Counted as the characters outside printable ASCII
  const { rows } = await client.query<{ id: number; label: string; station: string }>(`
    SELECT DISTINCT ON (l.id, l.base) l.id, l.base AS label, s.name AS station
    FROM audit_labels l
    JOIN audit_routes r ON r.id = l.id AND r.changed
    JOIN audit_ends e ON e.id = l.id
    JOIN stations s ON ${withinMetersSql("s.coordinates_3857", "e.p3", STATION_SEARCH_M, "e.lat")}
    WHERE lower(immutable_unaccent(l.base)) = lower(immutable_unaccent(s.name))
      AND lower(l.base) <> lower(s.name)
      AND length(regexp_replace(l.base, '[ -~]', '', 'g')) < length(regexp_replace(s.name, '[ -~]', '', 'g'))
    ORDER BY l.id, l.base
  `);
  return {
    title: "Label lacks diacritics the OSM station has",
    note: "Europe keeps the local spelling with its diacritics; Japan adds macrons.",
    findings: rows.map((row) => ({
      ids: [row.id],
      text: `"${row.label}" (OSM: "${row.station}")`,
    })),
  };
}

async function malformedLabels(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{ id: number; label: string; problem: string }>(String.raw`
    SELECT l.id, l.label, p.problem
    FROM audit_labels l
    JOIN audit_routes r ON r.id = l.id AND r.changed
    CROSS JOIN LATERAL (VALUES
      (l.label <> btrim(l.label) OR l.label ~ '\s{2,}', 'stray whitespace'),
      (l.label ~ '[\u00A0\u200B-\u200D\u2060\uFEFF]', 'invisible or non-breaking character'),
      (l.label ~ '[\[\]]' AND l.label !~ '^[^\[\]]*[^\s\[\]] \[[a-z]+( [a-z]+)*\]$', 'malformed bracket note'),
      (l.label ~* '\m(junction|jct)\M' AND l.label !~ '\[[a-z ]*junction\]$', 'junction outside brackets'),
      (l.label ~ '\(\s*junction\s*\)', 'junction in parentheses')
    ) p(hit, problem)
    WHERE p.hit
    UNION ALL
    SELECT id, f || ' / ' || t, 'From and To are the same' FROM audit_routes WHERE changed AND fk = tk
    ORDER BY 1
  `);
  return {
    title: "Malformed labels",
    note: 'A point that is not a station is "<Place> [junction]", "[north junction]"…',
    findings: rows.map((row) => ({ ids: [row.id], text: `${row.problem}: "${row.label}"` })),
  };
}

// ---------------------------------------------------------------- geometry

async function duplicates(client: PoolClient): Promise<Section> {
  // Two joins rather than one condition with OR, which no index serves
  const { rows } = await client.query<{ a: number; b: number; reason: string }>(`
    WITH same_labels AS (
      SELECT a.id AS a, b.id AS b FROM audit_routes a
      JOIN audit_routes b ON a.id < b.id AND least(a.fk, a.tk) = least(b.fk, b.tk)
        AND greatest(a.fk, a.tk) = greatest(b.fk, b.tk)
    ), same_ends AS (
      SELECT ea.id AS a, eb.id AS b FROM audit_ends ea
      JOIN audit_ends eb ON ea.id < eb.id AND ${withinMetersSql("eb.p3", "ea.p3", 50, "ea.lat")}
      GROUP BY ea.id, eb.id
      HAVING count(DISTINCT ea.side) = 2 AND count(DISTINCT eb.side) = 2
    )
    SELECT p.a, p.b, CASE WHEN l.a IS NULL THEN 'same ends, different labels' ELSE 'same From/To' END AS reason
    FROM (SELECT a, b FROM same_labels UNION SELECT a, b FROM same_ends) p
    LEFT JOIN same_labels l ON l.a = p.a AND l.b = p.b
    JOIN audit_routes a ON a.id = p.a
    JOIN audit_routes b ON b.id = p.b
    WHERE (a.changed OR b.changed) AND a.closed = b.closed AND ${sameLineSql("a", "b")}
    ORDER BY p.a, p.b
  `);
  const routes = await routeFacts(
    client,
    rows.flatMap((row) => [row.a, row.b]),
  );
  return {
    title: "Two routes between the same points",
    note: "A forgotten split after Duplicate (it double-counts), or an intended alternative (then tagged apart). Same From/To on two named lines is two lines and is not listed.",
    findings: rows.map((row) => ({
      ids: [row.a, row.b],
      text: row.reason,
      details: [row.a, row.b].map((id) => `[${id}] ${routes.get(id)}`),
    })),
  };
}

async function overlaps(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{ a: number; b: number; km: number }>(`
    SELECT a, b, round(km::numeric, 2)::float8 AS km FROM (
      SELECT a.id AS a, b.id AS b,
        ST_Length(ST_CollectionExtract(ST_Intersection(a.g3, b.g3), 2)) * cos(radians(a.lat)) / 1000 AS km
      FROM audit_routes a
      JOIN audit_routes b ON a.id < b.id AND a.g3 && b.g3
      WHERE NOT a.closed AND NOT b.closed AND (a.changed OR b.changed) AND ST_Intersects(a.g3, b.g3)
    ) x
    WHERE km > ${OVERLAP_KM}
    ORDER BY km DESC
  `);
  return {
    title: `Open routes sharing more than ${OVERLAP_KM} km of track`,
    note: "Counted twice in every statistic. A wrong end point, a missed split, or track OSM draws too few of.",
    findings: rows.map((row) => ({ ids: [row.a, row.b], text: `${row.km} km shared` })),
  };
}

async function detoursAndStubs(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{ id: number; km: number; straight: number }>(`
    SELECT id, round(length_km::numeric, 1)::float8 AS km,
      round((ST_Distance(s::geography, e::geography) / 1000)::numeric, 1)::float8 AS straight
    FROM audit_routes
    WHERE changed AND (
      length_km < ${STUB_KM}
      OR (length_km > ${DETOUR_MIN_KM} AND length_km > ${DETOUR_RATIO} * ST_Distance(s::geography, e::geography) / 1000)
    )
    ORDER BY length_km / greatest(ST_Distance(s::geography, e::geography) / 1000, 0.01) DESC
  `);
  return {
    title: `Detours (over ${DETOUR_RATIO}× the straight line) and stubs (under ${STUB_KM} km)`,
    note: "A path that found a way round, or a double click. Many are real: lines around a peninsula, spirals, short stubs into a station.",
    findings: rows.map((row) => ({
      ids: [row.id],
      text: `${row.km} km for ${row.straight} km straight`,
    })),
  };
}

async function backtracking(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{ id: number }>(
    `SELECT id FROM audit_routes WHERE changed AND backtracks AND NOT closed ORDER BY id`,
  );
  return {
    title: "Unintended backtracking",
    note: "`npm run showBacktracking` shows where each one turns back. Mark an intended one as such in the admin.",
    findings: rows.map((row) => ({ ids: [row.id], text: "backtracks" })),
  };
}

/**
 * A named line whose routes fall apart into pieces that come close: the gap is a
 * misclick, or a short stretch not yet added. Pieces further apart are a line
 * still being filled in, and are not listed.
 */
async function lineGaps(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{
    line: string;
    id: number;
    changed: boolean;
    sx: number;
    sy: number;
    ex: number;
    ey: number;
  }>(`
    SELECT line, id, changed, ST_X(s) AS sx, ST_Y(s) AS sy, ST_X(e) AS ex, ST_Y(e) AS ey
    FROM audit_routes, unnest(array_remove(array_prepend(name, other_names), NULL)) line
    WHERE NOT closed
  `);
  const lines = new Map<string, typeof rows>();
  for (const row of rows) lines.set(row.line, [...(lines.get(row.line) ?? []), row]);

  const findings: Finding[] = [];
  for (const [line, routes] of lines) {
    if (routes.length < 2 || !routes.some((route) => route.changed)) continue;
    const ends = routes.map((route) => [
      [route.sx, route.sy] as [number, number],
      [route.ex, route.ey] as [number, number],
    ]);
    const gap = (i: number, j: number) =>
      Math.min(...ends[i].flatMap((p) => ends[j].map((q) => haversineDistance(p, q))));

    // Union-find over the routes whose ends meet
    const parent = routes.map((_, i) => i);
    const root = (i: number): number => {
      while (parent[i] !== i) i = parent[i];
      return i;
    };
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        if (gap(i, j) <= JOIN_DISTANCE_M) parent[root(i)] = root(j);
      }
    }
    let closest: { i: number; j: number; m: number } | null = null;
    for (let i = 0; i < routes.length; i++) {
      for (let j = i + 1; j < routes.length; j++) {
        if (root(i) === root(j)) continue;
        const m = gap(i, j);
        if (!closest || m < closest.m) closest = { i, j, m };
      }
    }
    if (!closest || closest.m > LINE_GAP_KM * 1000) continue;
    const pieces = new Set(routes.map((_, i) => root(i))).size;
    findings.push({
      ids: [routes[closest.i].id, routes[closest.j].id],
      text: `${line}: ${pieces} pieces, closest ${Math.round(closest.m)} m apart`,
    });
  }
  return {
    title: `Named line in pieces under ${LINE_GAP_KM} km apart`,
    note: "Ends that miss each other, or a short stretch not added yet.",
    findings,
  };
}

// ---------------------------------------------------------------- fields

async function regionRequirements(client: PoolClient): Promise<Section> {
  const needTags = (Object.keys(REGIONS) as RegionId[]).filter(
    (id) => REGIONS[id].requiresUsageTags,
  );
  const needNames = (Object.keys(REGIONS) as RegionId[]).filter((id) => REGIONS[id].hasRouteNames);
  const { rows } = await client.query<{ id: number; problem: string }>(
    `
    SELECT id, 'no usage tags' AS problem FROM audit_routes
      -- Outside every region counts as needing them, as usageTagsRequiredAt has it
      WHERE changed AND coalesce(region = ANY($1::text[]), true) AND cardinality(usage_tags) = 0
    UNION ALL
    SELECT id, 'no line name' FROM audit_routes
      WHERE changed AND region = ANY($2::text[]) AND name IS NULL
    UNION ALL
    SELECT id, 'a line name in a region without them' FROM audit_routes
      WHERE changed AND region IS NOT NULL AND NOT (region = ANY($2::text[])) AND name IS NOT NULL
    UNION ALL
    SELECT id, 'starts outside every region' FROM audit_routes
      WHERE changed AND region IS NULL
    UNION ALL
    SELECT id, 'an other line name repeats the name' FROM audit_routes
      WHERE changed AND cardinality(other_names) > 0
        AND (SELECT count(DISTINCT search_key(n)) FROM unnest(array_prepend(name, other_names)) n)
            < cardinality(other_names) + 1
    UNION ALL
    SELECT id, 'no country at an end' FROM audit_routes
      WHERE changed AND (start_country IS NULL OR end_country IS NULL)
    ORDER BY 1
  `,
    [needTags, needNames],
  );
  return {
    title: "Fields the region requires",
    note: "",
    findings: rows.map((row) => ({ ids: [row.id], text: row.problem })),
  };
}

async function textHygiene(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{
    id: number;
    field: string;
    value: string;
    problem: string;
  }>(String.raw`
    WITH texts AS (
      SELECT id, 'name' AS field, name AS value FROM audit_routes WHERE changed
      UNION ALL SELECT id, 'other line name', n FROM audit_routes, unnest(other_names) n WHERE changed
      UNION ALL SELECT id, 'usage tag', tag FROM audit_routes, unnest(usage_tags) tag WHERE changed
      UNION ALL SELECT id, 'link', link FROM audit_routes WHERE changed
      UNION ALL SELECT id, 'link name', link_name FROM audit_routes WHERE changed
      UNION ALL SELECT id, 'description', description FROM audit_routes WHERE changed
    )
    SELECT id, field, value, p.problem
    FROM texts
    CROSS JOIN LATERAL (VALUES
      (value <> btrim(value) OR value ~ '[^\S\n]{2,}', 'stray whitespace'),
      (value ~ '[\u00A0\u200B-\u200D\u2060\uFEFF]', 'invisible or non-breaking character'),
      (value = '', 'empty'),
      (field = 'link' AND value !~ '^https?://[^\s]+$', 'not a web address')
    ) p(hit, problem)
    WHERE value IS NOT NULL AND p.hit
    ORDER BY id
  `);
  return {
    title: "Stray whitespace and bad links",
    note: "",
    findings: rows.map((row) => ({
      ids: [row.id],
      text: `${row.field} ${row.problem}: "${row.value}"`,
    })),
  };
}

/**
 * Usage tags and line names spelled two ways (case or diacritics), a tag that
 * looks like a typo of a more common one (rarely used, and close to it), and a
 * tag otherwise always seen with another usage type. Line names are not compared
 * by similarity: "Sakai Line" beside "Sakurai Line" is the rule there, not a typo.
 */
async function vocabulary(client: PoolClient): Promise<Section> {
  const { rows } = await client.query<{ ids: number[]; problem: string }>(`
    WITH tags AS (
      SELECT tag AS term, 'tag' AS kind, array_agg(id ORDER BY id) AS ids, bool_or(changed) AS changed
      FROM audit_routes, unnest(usage_tags) tag GROUP BY tag
    ), names AS (
      SELECT line AS term, 'line name' AS kind, array_agg(id ORDER BY id) AS ids, bool_or(changed) AS changed
      FROM audit_routes, unnest(array_remove(array_prepend(name, other_names), NULL)) line GROUP BY line
    ), terms AS (SELECT * FROM tags UNION ALL SELECT * FROM names)
    SELECT DISTINCT ON (a.kind, a.term) a.ids,
      a.kind || ' "' || a.term || '" (' || cardinality(a.ids) || '×) next to "' || b.term || '" (' || cardinality(b.ids) || '×)' AS problem
    FROM terms a
    JOIN terms b ON a.kind = b.kind AND a.term <> b.term
    WHERE a.changed AND (
      lower(immutable_unaccent(a.term)) = lower(immutable_unaccent(b.term)) AND cardinality(a.ids) <= cardinality(b.ids)
      OR (a.kind = 'tag' AND cardinality(a.ids) <= 2 AND cardinality(b.ids) > cardinality(a.ids)
          AND similarity(a.term, b.term) >= 0.6 AND search_key(a.term) <> search_key(b.term))
    )
    ORDER BY a.kind, a.term, similarity(a.term, b.term) DESC
  `);
  const { rows: misplaced } = await client.query<{ id: number; problem: string }>(`
    WITH uses AS (
      SELECT tag, usage_type, count(*) AS n FROM audit_routes, unnest(usage_tags) tag GROUP BY 1, 2
    ), usual AS (
      SELECT DISTINCT ON (tag) tag, usage_type, n, sum(n) OVER (PARTITION BY tag) AS total
      FROM uses ORDER BY tag, n DESC
    )
    SELECT r.id, 'tag "' || u.tag || '" on usage type ' || r.usage_type
      || ' (elsewhere ' || u.n || ' of ' || u.total || ' are type ' || u.usage_type || ')' AS problem
    FROM usual u
    JOIN audit_routes r ON r.changed AND u.tag = ANY(r.usage_tags) AND r.usage_type <> u.usage_type
    WHERE u.total >= ${TAG_TYPE_MIN_USES} AND u.n >= ${TAG_TYPE_SHARE} * u.total
    ORDER BY r.id
  `);
  return {
    title: "Tags and line names that look like typos, or sit on an unusual usage type",
    note: "Usage type 0 Regular, 1 Heritage & tourist, 2 Special (see CLAUDE.md for the line between 1 and 2).",
    findings: [
      ...rows.map((row) => ({ ids: row.ids.slice(0, 5), text: row.problem })),
      ...misplaced.map((row) => ({ ids: [row.id], text: row.problem })),
    ],
  };
}

async function retiredTags(client: PoolClient): Promise<Section> {
  const tagSetRegions = (Object.keys(REGIONS) as RegionId[]).filter(
    (id) => REGIONS[id].requiresUsageTags,
  );
  const { rows } = await client.query<{ id: number; tag: string }>(
    `
    SELECT id, tag FROM audit_routes, unnest(usage_tags) tag
    WHERE changed
      -- Outside every region counts as the tag set's, as in regionRequirements
      AND coalesce(region = ANY($2::text[]), true)
      AND lower(immutable_unaccent(tag)) = ANY(
        SELECT lower(immutable_unaccent(retired)) FROM unnest($1::text[]) retired
      )
    ORDER BY id
  `,
    [RETIRED_TAGS, tagSetRegions],
  );
  return {
    title: "Retired usage tags",
    note: `${RETIRED_TAGS.join(", ")}: from before the current tag set. Replace with the tags saying when the line runs.`,
    findings: rows.map((row) => ({ ids: [row.id], text: `tag "${row.tag}"` })),
  };
}

// ---------------------------------------------------------------- output

async function changedIds(client: PoolClient): Promise<Set<number>> {
  const { rows } = await client.query<{ id: number }>(`SELECT id FROM audit_routes WHERE changed`);
  return new Set(rows.map((row) => row.id));
}

/** The three nearest stations at each end, for a label that matched none. */
async function nearestStations(client: PoolClient, ids: number[]): Promise<Map<number, string[]>> {
  const { rows } = await client.query<{ id: number; side: string; nearest: string | null }>(
    `
    SELECT e.id, e.side, (
      SELECT string_agg(z.name || ' ' || z.m || ' m', ', ') FROM (
        SELECT s.name, round(${metersSql("s.coordinates_3857", "e.p3", "e.lat")})::int AS m
        FROM stations s
        WHERE ${withinMetersSql("s.coordinates_3857", "e.p3", STATION_SEARCH_M, "e.lat")}
          AND ${COMPARABLE_STATION_SQL}
        ORDER BY s.coordinates_3857 <-> e.p3 LIMIT 3
      ) z
    ) AS nearest
    FROM audit_ends e WHERE e.id = ANY($1::int[])
    ORDER BY e.id, e.side DESC
  `,
    [ids],
  );
  const result = new Map<number, string[]>();
  for (const row of rows) {
    const line = `${row.side} near: ${row.nearest ?? `no station within ${STATION_SEARCH_M} m`}`;
    result.set(row.id, [...(result.get(row.id) ?? []), line]);
  }
  return result;
}

/** Length, usage type and tags, for telling two near-identical routes apart. */
async function routeFacts(client: PoolClient, ids: number[]): Promise<Map<number, string>> {
  const { rows } = await client.query<{ id: number; facts: string }>(
    `SELECT id, round(length_km::numeric, 1) || ' km, type ' || usage_type
       || CASE WHEN cardinality(usage_tags) > 0 THEN ', ' || array_to_string(usage_tags, ', ') ELSE '' END AS facts
     FROM audit_routes WHERE id = ANY($1::int[])`,
    [ids],
  );
  return new Map(rows.map((row) => [row.id, row.facts]));
}

async function routeTitles(client: PoolClient, ids: number[]): Promise<Map<number, string>> {
  const { rows } = await client.query<{ id: number; title: string }>(
    `SELECT id, coalesce(name || ': ', '') || f || ' → ' || t
       || CASE WHEN closed THEN ' (closed)' ELSE '' END AS title
     FROM audit_routes WHERE id = ANY($1::int[])`,
    [ids],
  );
  return new Map(rows.map((row) => [row.id, row.title]));
}

/** The admin's Todo notes near each route: a known OSM fix awaiting a re-pick. */
async function todoNotes(client: PoolClient, ids: number[]): Promise<Map<number, string[]>> {
  const { rows } = await client.query<{ id: number; m: number; text: string }>(
    `
    SELECT r.id, round(${metersSql("n.coordinate_3857", "r.g3", "r.lat")})::int AS m, n.text
    FROM audit_routes r
    JOIN admin_notes n ON n.note_type = 'Todo'
      AND ${withinMetersSql("r.g3", "n.coordinate_3857", TODO_NOTE_M, "r.lat")}
    WHERE r.id = ANY($1::int[])
    ORDER BY r.id, m
  `,
    [ids],
  );
  const result = new Map<number, string[]>();
  for (const row of rows) {
    const line = `Todo note ${row.m} m away: ${row.text.replace(/\s+/g, " ").slice(0, 160)}`;
    result.set(row.id, [...(result.get(row.id) ?? []), line]);
  }
  return result;
}

/** `starChanged`: mark the new and changed routes, which only a baseline tells. */
async function printSections(
  client: PoolClient,
  sections: Section[],
  starChanged: boolean,
): Promise<void> {
  const ids = [...new Set(sections.flatMap((section) => section.findings.flatMap((f) => f.ids)))];
  // One after another: a client runs one query at a time
  const titles = await routeTitles(client, ids);
  const notes = await todoNotes(client, ids);
  const changed = await changedIds(client);
  const label = (id: number) =>
    `[${id}]${starChanged && changed.has(id) ? "*" : ""} ${titles.get(id) ?? "?"}`;

  for (const section of sections) {
    console.log(`\n=== ${section.title} (${section.findings.length})`);
    if (section.note) console.log(`    ${section.note}`);
    for (const finding of section.findings) {
      const [first, ...rest] = finding.ids;
      const also = rest.length > 0 ? `  ↔  ${rest.map(label).join("  ↔  ")}` : "";
      console.log(`- ${label(first)}${also}: ${finding.text}`);
      for (const detail of finding.details ?? []) console.log(`    ${detail}`);
      for (const id of finding.ids) {
        for (const note of notes.get(id) ?? []) console.log(`    [${id}] ${note}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const baseline = options.all ? null : readBaseline();
  const client = await pool.connect();

  try {
    // Temp tables and their reads stay on this one session
    await createWorkingTables(client, options);
    const total = (await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_routes`))
      .rows[0].n;
    const scope = options.region ? REGIONS[options.region].label : "all regions";
    if (baseline) {
      const changed = await markChanged(client, baseline);
      console.log(
        `${total} valid routes (${scope}); ${changed} new or changed since the baseline of ${baseline.savedAt}. Findings involve at least one of them (marked *).`,
      );
    } else {
      console.log(
        `${total} valid routes (${scope}), all audited${options.all ? "" : " (no baseline yet)"}.`,
      );
    }

    const checks = [
      labelsNotAtEnds,
      endsAtOtherStation,
      samePointDifferentNames,
      sameNameNotMeeting,
      spellingVariants,
      missingDiacritics,
      malformedLabels,
      duplicates,
      overlaps,
      detoursAndStubs,
      backtracking,
      lineGaps,
      regionRequirements,
      textHygiene,
      vocabulary,
      retiredTags,
    ];
    const sections: Section[] = [];
    for (const check of checks) {
      const started = Date.now();
      sections.push(await check(client));
      process.stderr.write(`  ${check.name}: ${Date.now() - started} ms\n`);
    }
    await printSections(client, sections, baseline !== null);

    if (options.saveBaseline) {
      const { rows } = await client.query<{ id: number; fingerprint: string }>(
        `SELECT id, fingerprint FROM audit_routes`,
      );
      // Merged, so a region-scoped run keeps the other region's fingerprints
      const fingerprints = { ...readBaseline()?.fingerprints };
      for (const row of rows) fingerprints[row.id] = row.fingerprint;
      mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
      // The local date: an audit late in the evening belongs to that day
      const now = new Date();
      const savedAt = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map((part) => String(part).padStart(2, "0"))
        .join("-");
      const saved: Baseline = { savedAt, fingerprints };
      writeFileSync(BASELINE_FILE, `${JSON.stringify(saved)}\n`);
      console.log(`\nBaseline saved: ${rows.length} routes (${BASELINE_FILE}).`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
