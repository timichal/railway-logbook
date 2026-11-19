/**
 * What a press on the map turned out to have hit.
 *
 * The properties come off an MVT feature, so everything is read defensively and
 * nothing is trusted to be present. A route's tile carries only what the layers
 * draw with, so a pressed route is read by id (`toRouteTrackId`, then
 * `routeFeatureFromMetadata`). The web app builds the same three bodies as HTML
 * strings and has to escape every one of them (`tooltipFormatting.ts`); here they
 * become `<Text>` children, which is the whole of why `escapeHtml` does not port.
 * `safeHref` does: it still guards `Linking.openURL` against a route link or a note
 * source edited by a third party.
 */

import { type RouteFeatureProperties, routeLinkLabel } from "@shared/map/routeFeature";
import type { RouteRide } from "@shared/map/routeRides";
import type { RailwayRoute, Station } from "@shared/types";

export interface RouteFeature extends RouteFeatureProperties {
  kind: "route";
  trackId: number;
  description: string | null;
  link: string | null;
  /** What the link is called (`routeLinkLabel`): "Website" unless the admin named it. */
  linkLabel: string;
  lengthKm: number;
  /** The most recent journey over this route, both fields or neither. */
  lastJourney: { date: string; name: string } | null;
}

export interface StationFeature {
  kind: "station";
  name: string;
  /**
   * The station as the planner takes it, or null when the press carried no usable
   * id or point: then the sheet can still name it, but has nothing to plan with.
   */
  station: Station | null;
}

export interface NoteFeature {
  kind: "note";
  text: string;
  source: string | null;
}

export type MapFeature = RouteFeature | StationFeature | NoteFeature;

type Properties = Record<string, unknown> | null | undefined;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Only `http(s)` survives, so a `javascript:` or `data:` URL cannot be smuggled
 * through a route link into `Linking.openURL`. The web app's `safeHref` in every
 * respect except the HTML escaping, which has no meaning here.
 */
export function safeUrl(value: unknown): string | null {
  const raw = text(value);
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  return raw;
}

/**
 * Which route a press hit. `track_id` is the feature id on the tile, not a
 * property, and a route with no id is one nothing can be done with.
 */
export function toRouteTrackId(id: unknown): number | null {
  const trackId = Number(id);
  return Number.isFinite(trackId) && trackId !== 0 ? trackId : null;
}

/**
 * The most recent journey over a route, from the user's ride on it (`useRides`):
 * both fields or neither, as they come together from one journey.
 */
export function lastJourneyOf(ride: RouteRide | undefined): RouteFeature["lastJourney"] {
  const date = text(ride?.date);
  const name = text(ride?.journey_name);
  return date && name ? { date, name } : null;
}

/**
 * A pressed station. The tile's `id` is a property, not the feature id, and may be
 * negative (an area reduced to its centroid); the point is the press hit's geometry,
 * which is where the circle is drawn.
 */
export function toStationFeature(
  properties: Properties,
  geometry: GeoJSON.Geometry | null | undefined,
): StationFeature | null {
  const name = text(properties?.name);
  if (!name) return null;
  const id = Number(properties?.id);
  const point =
    geometry?.type === "Point" && geometry.coordinates.length >= 2
      ? ([geometry.coordinates[0], geometry.coordinates[1]] as [number, number])
      : null;
  const station =
    Number.isFinite(id) && id !== 0 && point ? { id, name, coordinates: point } : null;
  return { kind: "station", name, station };
}

export function toNoteFeature(properties: Properties): NoteFeature | null {
  const body = text(properties?.text);
  if (!body) return null;
  return { kind: "note", text: body, source: safeUrl(properties?.source) };
}

/**
 * A route feature, from the HTTP API's route row (`POST /routes/metadata`).
 *
 * Both a tapped route and the journey planner's go through here: the tile holds
 * only what the layers draw with, and the planner identifies its routes by id. So a
 * route is described by exactly the same `routeTitle` and `routeBadges` wherever it
 * came from.
 *
 * `lastJourney` is the one thing a row cannot answer: it is the user's, and this
 * endpoint is public. A tap passes it from the rides (`lastJourneyOf`); nothing
 * reading a planner result asks for it — a plan is about where you are going, not
 * where you have been.
 */
export function routeFeatureFromMetadata(
  route: RailwayRoute,
  lastJourney: RouteFeature["lastJourney"] = null,
): RouteFeature {
  return {
    kind: "route",
    trackId: route.track_id,
    from_station: route.from_station,
    to_station: route.to_station,
    name: route.name,
    other_names: route.other_names,
    usage_type: route.usage_type,
    line_class: route.line_class ?? undefined,
    usage_tags: route.usage_tags,
    description: text(route.description),
    link: safeUrl(route.link),
    linkLabel: routeLinkLabel(route.link_name),
    lengthKm: route.length_km ?? 0,
    closed: route.closed === true,
    closed_on: route.closed_on ?? null,
    lastJourney,
  };
}
