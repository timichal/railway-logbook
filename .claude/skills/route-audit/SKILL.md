---

name: route-audit
description: Audit the route data (valid routes only) for typos and wrong labels in From/To, badly filled fields, misclicked end points, gaps, duplicates and overlaps. Use when the user asks for a route audit, a route data audit, or to check newly added routes.
---

# Route data audit

The admin adds routes on the server and asks for an audit every so often. The audit covers the **valid routes only** (`is_valid`, closed ones included). Never report an invalid route: the admin re-picks those anyway, and they get audited once they're valid again.

`npm run auditRoutes` (`src/scripts/auditRoutes.ts`) finds the candidates. Every check is a heuristic, so its output is a list of places to look, and you decide what goes in the report. The label rules are in the root CLAUDE.md ("Route labels"). Read that section before judging anything.

## 1. Fresh data

The audit reads the local database, but the routes are edited on the server. Compare the newest local route (`SELECT max(created_at) FROM railway_routes`) with what the user says they added. Unless the user already said to pull, ask before running `npm run pullRouteData`, because it replaces the local route data and the local accounts. Postgres has to be running (`docker-compose up -d db`; start Docker Desktop first if needed).

## 2. Run it

```
npm run auditRoutes > <scratchpad>/audit.txt
```

- **Incremental by default.** With a baseline (`data/route-audit-baseline.json`, local, from the last audit's step 6), it reports only findings that involve a route that is new, changed, or valid again since then. Those routes are marked `*`. Its first line says how many there are.
- `--all` ignores the baseline (a full pass, or when there is none). `--region=europe|japan` narrows the run.
- **Run `--all` once after a check is added or changed** in `auditRoutes.ts` (check `git log` on it since the baseline date). The baseline only knows which routes changed, so a new check would never look at the old ones.
- About 10 seconds, read-only.

The sections: labels that match no nearby station, ends sitting on another station, routes meeting at one point under different names, routes that don't meet the others of their name (a misclick on a parallel track or siding, a gap that journeys can't chain across), spelling variants, missing diacritics or macrons, malformed labels, duplicates, overlaps, detours and stubs, unintended backtracking, gaps inside a named line, missing region fields, retired usage tags (Seasonal), whitespace and bad links, and tag or line-name typos.

## 3. Judge each candidate

Drop a candidate when:

- **`ROUTE_DATA_AUDIT.md` already accepts it**, the same route or the same kind of case. Report it again only if it has grown (a longer overlap, a new route in the same spot).
- **A Todo note sits beside it.** The script prints these under the route (`Todo note … m away`). A note such as "osm fix nov 15" means the admin has fixed OSM there and will re-pick the route after a map deploy.
- **It is a label convention, not an error**: Japanese operator spellings (hyphen or space, "-mae"/"-Mae"), same-named stations far apart, an operator's stop name beating OSM's on a small heritage line, an endpoint with no OSM station nearby (usually a station missing from OSM: note it, don't call it an error).
- **The station side is the problem.** OSM station names in Japan are often a transcription of the Japanese ("Haneda kūkō dai-san tāminaru", "Beisaido sutēshon") that no English label will match.

Check before reporting. Use SQL against the local database (`docker exec -i db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB'` with the query on stdin; `audit_*` tables exist only inside the script, so query `railway_routes`), with things like the nearest stations to each end, the routes passing an end, or the stations along a route in order (`ST_LineLocatePoint`). Use `npm run inspectPath` for a suspected gap and `npm run showBacktracking` for backtracking. Where it matters, look at the place on OpenStreetMap or OpenRailwayMap.

What the script can't judge, so read the new routes' rows yourself:

- **Usage type**: 0 Regular (in the national timetable), 1 Heritage & tourist (its own line, outside the timetable), 2 Special (national track used irregularly). Root CLAUDE.md has the line between 1 and 2.
- **Usage tags** that contradict the type or each other (Diversions on a Regular route, Daily beside Weekends).
- **Labels that read wrong**: a pasted label from the neighbouring route, a station name in the wrong language, or a junction named after a place that isn't next to it.

## 4. Report

Only findings that survived step 3, numbered so the user can answer by number. Give each one:

- the route as **From → To**, with the line name first in Japan, plus `[track_id]` (the admin searches by From/To, never by id alone)
- what is wrong and what you checked
- the fix you suggest (the corrected label, "re-pick the end at …", "split", "mark intended")
- an OpenStreetMap link at the point where a place helps: `https://www.openstreetmap.org/#map=17/<lat>/<lon>`

Put the probable errors first, then a short "for you to decide" group. State how many candidates you dropped and why, in one line, not one by one.

## 5. Record the answers

The user fixes things on the server and answers per finding:

- **Accepted as it is** → add it to `ROUTE_DATA_AUDIT.md` under the fitting heading, dated, with the reason the user gave, written as a rule wherever it generalises.
- **Fixed on the server** → nothing to record. The next pull brings the fix, and the changed route gets audited again.
- **Deferred** → `TODO.md`, written so it can be acted on cold.
- **A false positive the script should not produce** → tune the check in `auditRoutes.ts` (its thresholds are named constants at the top), not `ROUTE_DATA_AUDIT.md`.

## 6. Save the baseline

Once every finding is fixed, accepted, or in `TODO.md`:

```
npm run auditRoutes -- --save-baseline
```

This records what was audited, so the next run shows only what changed after it. Don't save it while findings are still open, or they go quiet. Save it against the same local data you audited: a route fixed on the server afterwards differs from the baseline after the next pull, so it gets checked again.
