# Database files (`database/init/`)

- `01-schema.sql`: tables and indexes. **Never re-run on deploy**, so a schema change also needs a migration script (see `src/scripts/CLAUDE.md`). For a new user-data table, see "Data model" in the root CLAUDE.md.
- `02-vector-tiles.sql`: tile functions, the 3857 columns and their triggers, `user_fully_ridden_routes`, `immutable_unaccent`, `search_key`. **Every app deploy re-applies it** in one transaction before the containers are replaced (locally: `npm run applyVectorTiles`). So it must stay **idempotent**. A change `CREATE OR REPLACE` can't make (a new return type) needs its `DROP FUNCTION IF EXISTS` in the file.

## Tile functions

- Which functions Martin may publish: "Vector tiles" in the root CLAUDE.md.
- Line tiles are simplified by one tile unit (`tile_unit(z)`, the grid `ST_AsMVTGeom` snaps to). That keeps them within about a quarter pixel of the full-resolution overlays drawn over them. Don't raise it.
- `user_fully_ridden_routes` is the server's definition of "ridden whole", behind both the map colour (`has_complete_trip`) and the progress numbers. It returns a set joined once per tile, so don't turn it into a per-route call. Its client twin is `src/lib/shared/routeCoverage.ts`, and `tests/routeCoverage.sql.test.ts` keeps the two in agreement. That test shadows the tables the function reads with temp tables, so a new table the function reads needs a temp twin there.
- `search_key` is the SQL twin of `foldForSearch` (`src/lib/searchText.ts`), checked by `tests/searchText.sql.test.ts`. Call it on both sides of a comparison, or the trigram index goes unused.
- Region filters take a point column: `starting_coordinate` (routes, scenic lines), `coordinates` (stations), `coordinate` (notes). `geometry &&` detoasts every route's line, ~100ms.
