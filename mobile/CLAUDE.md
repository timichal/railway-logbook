# mobile/ (React Native / Expo)

A second app with its own `package.json` and `node_modules`. The plan and its status are in `MOBILE_APP_PLAN.md`, and the HTTP API it shares with the web app is in `API.md`.

- **Separate TypeScript program.** The root `tsconfig.json` excludes `mobile/` (RN's global `setTimeout` breaks the web app's `Timeout` types), so root `npx tsc --noEmit` doesn't check it. Run `npm run typecheck` inside `mobile/`.
- **Nested Biome config** (`mobile/biome.json`, `"root": false`): the root `npm run lint` covers both apps. It forbids relative imports into `src/lib` and `@shared/..`.
- **It imports `src/lib/shared/` as source**, as `@shared/*` (Metro `watchFolders`). A change there is a change to both apps. The rules for what may live there are in the root CLAUDE.md ("`src/lib/shared/` is shared"). The rules for what the map draws are in `src/lib/shared/map/CLAUDE.md`.
- `mobile/tsconfig.json` maps `@maplibre/maplibre-gl-style-spec` to `mobile/node_modules`, so the native program sees one copy (two copies' recursive `ExpressionSpecification` aren't assignable to each other).
- The app has its own `src/map/fitCamera.ts` (a bounds stop takes no max zoom). A fit request waits in its `HighlightContext` until the map tab is in view and loaded.
- Every request names its `region`. The API never defaults it.
- Country selection screen: `app/countries.tsx`.
