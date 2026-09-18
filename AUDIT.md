# AUDIT.md

Findings from a read-only sweep of the codebase on 2026-09-17. Nothing here has
been changed yet.

**How to use this file:** each item is self-contained — location, what is wrong,
why it matters, and a suggested fix. Work them in any order. **Delete an item
once it is done**; when the file is empty, delete the file. If an item turns out
to be wrong or deliberate, delete it too and (if the reasoning is worth keeping)
move a sentence into `CLAUDE.md` instead.

Baseline: `npx tsc --noEmit` and `npm run lint` are clean (items 1-15 and 20
have since been fixed or dismissed and removed).

---

## Refactors

### 17. Asymmetric validation on the preferences endpoint

`src/app/api/v1/preferences/route.ts`

`GET` filters country codes through `/^[A-Z]{2}$/` (`optionalCountries` in
`src/lib/api/params.ts`); `PUT` accepts up to 2000 arbitrary strings of any length
via `requireStringArray` and stores them in `selected_countries`. Same list, two
standards.

**Fix:** validate on write with the same regex.

---

## Documentation nits

### 18. Stale country count in CLAUDE.md

`CLAUDE.md`, the `user_preferences` bullet, says the default is "(20 codes)". It
is 21, in both `src/lib/constants.ts` (`SUPPORTED_COUNTRIES`) and
`database/init/01-schema.sql`.

---

### 19. Comment contradicts the code on the backtracking allowance

`src/scripts/lib/railwayPathFinder.ts` and `src/lib/routePathFinder.ts`

```ts
// Allow searching for paths up to 10% longer or +5km
const searchDistance = Math.min(firstDistance * 1.1, firstDistance + 5000);
```

`Math.min` takes the **more** restrictive of the two, while "10% longer or +5km"
reads as the more permissive. Same phrasing around
`Math.min(best.cost * 2, best.cost + 20)` in `routePathFinder.ts`. The code is
probably right; the comments should say "whichever is smaller".

---

