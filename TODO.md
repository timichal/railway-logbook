# TODO.md

Audit of the codebase on 2026-09-25 (at `87eed52`). **Delete an item once it is
done**; if one turns out to be wrong or deliberate, delete it too and, where the
reasoning is worth keeping, move a sentence into `CLAUDE.md`. Delete the file when
it is empty. Line numbers are as of that commit and will drift.

Baseline: `npx tsc --noEmit` and `npm run lint` are clean. The items the previous
audit (`AUDIT.md`, closed in `7932aa7`) raised are not repeated here.

---

## Refactoring

- [ ] **There are no tests at all.** The riskiest logic is pure and easy to cover:
      - `routeCoverage.ts`: `isRouteFullyRidden` must agree with the SQL
        function.
      - `parsePgTextArray`.
      - `mergeLinearChain`: a start click on a shared node must not reverse the
        chain.
      - `geojsonFeatureStream`: input cut right after a feature's `},` must
        read as truncated.
      - `normalizeCountryCodes`.
      - The planner's search (`planner/routeSearch.ts`) on a network built by
        hand with `buildRouteGraph`, and `planVisits`/`planTrims`
        (`planner/routeVisits.ts`).
      - The part geometry in `scripts/lib/partGeometry.ts` (orientation,
        `findBacktracking`, edge truncation).

      `node --test` with tsx needs no new dependency.

## Frontend: accessibility

- [ ] **Changing view inside the menu drops focus.** `MenuSheet.tsx`: a drill-down
      (footer Sign in / Create account, How To Use, Railway Notes) or "Back to
      menu" unmounts the focused button and moves focus nowhere, so it falls to
      `<body>` and the next Tab starts over from the dialog's first control.
      **Fix:** on a view change, focus the new view's first field (the email input
      on the auth forms) or its heading (`tabIndex={-1}`), and on the way back the
      row that was opened.

## Docs

- [ ] **CLAUDE.md's station label sizes are stale.** CLAUDE.md says "size 10
      stepping to 11 at z16". `LABELS.station.size` in `src/lib/shared/map/style.ts` is
      13/14.

## Possible, needs checking

- [ ] A map rebuilt for a region or scheme change builds its route source with
      no `v`, although `useMapTileRefresh` may have moved on to a later one: the
      initial `appliedRef` claims construction stands for the current refresh.
      Harmless while the route tile handler answers `private, no-store` and
      `sw.js` never caches tiles; stale colours the moment either changes.
      **Fix, if needed:** reset `appliedRef` when the map instance changes (one
      extra reload per rebuild), or thread the cache buster into construction.
- [ ] `CountriesStatsTab.tsx:29-43` reloads `getProgressByCountry()` on every
      checkbox toggle, although the result doesn't depend on the selection.
- [ ] `localStorage.ts:55-56`, `:218-219` parse inside try/catch but don't check
      the shape. A stored `{"journeys":{}}` would crash `.filter` in the tabs.
- [ ] `loadBasemapStyle` shares its memoised layer *objects* across every map
      instance (`useMapLibre` spreads the array, not the objects). If MapLibre
      mutates specs in place, state leaks between the admin and user maps.
