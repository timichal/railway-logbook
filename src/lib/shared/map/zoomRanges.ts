/**
 * The zooms each tile source is served at.
 *
 * A module of its own, with no imports, because the server needs it too: the
 * per-user route tile handler (`src/app/api/tiles`) validates `z` against
 * `railwayRoutes`, and importing `src/lib/map` there would pull the basemap and
 * layer factories into a route handler. One copy, so the handler cannot start
 * refusing zooms the map asks for. Martin's own ranges (`martin/configuration.yml`)
 * are the other side of the same numbers and have to be kept in step by hand.
 */
export const ZOOM_RANGES = {
  railwayRoutes: { min: 4, max: 18 }, // Matches Martin configuration
  railwayParts: { min: 4, max: 18 }, // Matches Martin configuration
  stations: { min: 9, max: 18 }, // Matches Martin configuration
  adminNotes: { min: 4, max: 18 }, // Admin notes visible at all zooms
  publicNotes: { min: 7, max: 18 }, // Public Usage notes on the user map (from moderate zoom)
} as const;
