/**
 * What a press on the map turned out to have hit.
 *
 * The properties come off an MVT feature, so everything is read defensively and
 * nothing is trusted to be present. A route's tile carries only what the layers
 * draw with, so a pressed route is read by id (`toRouteTap`, then
 * `routeFeatureFromMetadata`). The web app builds the same three bodies as HTML
 * strings and has to escape every one of them (`tooltipFormatting.ts`); here they
 * become `<Text>` children, which is the whole of why `escapeHtml` does not port.
 * `safeHref` does: it still guards `Linking.openURL` against a route link or a note
 * source edited by a third party.
 */

import { type RouteFeatureProperties, routeLinkLabel } from "@shared/map/routeFeature";
import type { RailwayRoute } from "@shared/types";

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

/** What a pressed route's tile feature says: which route, and the last ride on it. */
export interface RouteTap {
  trackId: number;
  lastJourney: RouteFeature["lastJourney"];
}

export function toRouteTap(properties: Properties, id: unknown): RouteTap | null {
  if (!properties) return null;
  // `track_id` is the feature id on the tile, not a property. A route with no id is
  // one nothing can be done with.
  const trackId = Number(id);
  if (!Number.isFinite(trackId) || trackId === 0) return null;

  const date = text(properties.date);
  const journeyName = text(properties.journey_name);
  // Populated together from the most-recent logged journey (both NOT NULL in
  // user_journeys), so either both are present or neither is.
  return { trackId, lastJourney: date && journeyName ? { date, name: journeyName } : null };
}

export function toStationFeature(properties: Properties): StationFeature | null {
  const name = text(properties?.name);
  return name ? { kind: "station", name } : null;
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
 * `lastJourney` is the one thing a row cannot answer: it is a per-user join the tile
 * carries and this endpoint, being public, does not. A tap passes the tile's
 * (`toRouteTap`); nothing reading a planner result asks for it — a plan is about
 * where you are going, not where you have been.
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
