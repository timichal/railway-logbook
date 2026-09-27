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
