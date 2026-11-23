# mobile/ (React Native / Expo)

A second app with its own `package.json` and `node_modules`. The plan and its status are in `MOBILE_APP_PLAN.md`, and the HTTP API it shares with the web app is in `API.md`.

- **Separate TypeScript program.** The root `tsconfig.json` excludes `mobile/` (RN's global `setTimeout` breaks the web app's `Timeout` types), so root `npx tsc --noEmit` doesn't check it. Run `npm run typecheck` inside `mobile/`.
- **Nested Biome config** (`mobile/biome.json`, `"root": false`): the root `npm run lint` covers both apps. It forbids relative imports into `src/lib` and `@shared/..`.
- **It imports `src/lib/shared/` as source**, as `@shared/*` (Metro `watchFolders`). A change there is a change to both apps. The rules for what may live there are in the root CLAUDE.md ("`src/lib/shared/` is shared"). The rules for what the map draws are in `src/lib/shared/map/CLAUDE.md`.
- `mobile/tsconfig.json` maps `@maplibre/maplibre-gl-style-spec` to `mobile/node_modules`, so the native program sees one copy (two copies' recursive `ExpressionSpecification` aren't assignable to each other).
- **Key every child of a map source** (`<VectorSource>`, `<GeoJSONSource>`) where any sibling is conditional. A source drops null children and keys the rest by position, so a layer switched on shifts the others, and a `<Layer>` handed another's id throws "`id` cannot be changed" (see the route source in `RailwayMap.tsx`).
- **A press is hit-tested per source, over every layer inside it**, in that source's `hitbox` (44pt square by default), and the topmost source wins. A layer that shouldn't take presses (station labels) goes outside its source, naming it by `source`, and a source drawn over others gets a smaller `hitbox` (stations, `STATION_HITBOX` in `RailwayMap.tsx`).
- The app has its own `src/map/fitCamera.ts` (a bounds stop takes no max zoom). A fit request waits in its `HighlightContext` until the map tab is in view and loaded.
- Every request names its `region`. The API never defaults it.
- **Warnings are only in React Native DevTools** (`j` in the Metro terminal), never in LogBox or Metro's terminal (RN 0.77+). The "Open debugger to view warnings." toast that replaces them is ignored in `src/devWarnings.ts`, because here it renders blank and can't be closed. The `ImageBackground is deprecated` warning at startup is NativeWind's runtime (`react-native-css-interop` 0.2.7) touching it as it loads: harmless, and it goes with NativeWind 5.
- Country selection screen: `app/countries.tsx`.
- **The planner is a half-height `formSheet` over a live map** (`src/logbook/plannerSheet.ts`). The map tab loses focus under it but stays in view: anything on the map gated on focus must also accept `PlannerContext.sheetOpen`, anything along the map's bottom edge sits above `plannerSheetCover` while it is up, and a station tapped there fills the planner's target slot (`pickOnMap`) instead of opening a sheet.
