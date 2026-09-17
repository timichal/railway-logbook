/**
 * What a press on the map turned out to have hit.
 *
 * The properties come off an MVT feature, so everything is read defensively and
 * nothing is trusted to be present. The web app builds the same three bodies as HTML
 * strings and has to escape every one of them (`tooltipFormatting.ts`); here they
 * become `<Text>` children, which is the whole of why `escapeHtml` does not port.
 * `safeHref` does: it still guards `Linking.openURL` against a route link or a note
 * source edited by a third party.
 */

import type { UsageType } from "@shared/constants";
import type { RouteFeatureProperties } from "@shared/map/routeFeature";

export interface RouteFeature extends RouteFeatureProperties {
  kind: "route";
  trackId: number;
  description: string | null;
  link: string | null;
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

export function toRouteFeature(properties: Properties, id: unknown): RouteFeature | null {
  if (!properties) return null;
  // `track_id` is the feature id on the tile, not a property. A route with no id is
  // one nothing can be done with.
  const trackId = Number(id);
  if (!Number.isFinite(trackId) || trackId === 0) return null;

  const date = text(properties.date);
  const journeyName = text(properties.journey_name);

  return {
    kind: "route",
    trackId,
    from_station: properties.from_station,
    to_station: properties.to_station,
    name: properties.name,
    usage_type: Number(properties.usage_type ?? 0) as UsageType,
    scenic: properties.scenic === true,
    line_class: properties.line_class as RouteFeatureProperties["line_class"],
    frequency: typeof properties.frequency === "string" ? properties.frequency : undefined,
    description: text(properties.description),
    link: safeUrl(properties.link),
    lengthKm: Number(properties.length_km) || 0,
    // Populated together from the most-recent logged journey (both NOT NULL in
    // user_journeys), so either both are present or neither is.
    lastJourney: date && journeyName ? { date, name: journeyName } : null,
  };
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
