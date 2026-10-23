# OSM pipeline and map data deploy

`prepare.sh` (the pipeline behind `npm run prepareMapData`), `extracts.txt` (add a line to add a country), `deploy.sh` / `remote-deploy.sh` (`npm run deployMapData`), and `deployed-extracts.txt` (written by a deploy; commit it).

## prepare.sh

- Output: `data/pruned.geojson` for every region (a region is a bbox applied on read), plus `pruned.sources` (each extract's cut date). Naming extracts, or a path prefix ending at `/` (`-- asia/japan`), builds `data/pruned-partial.geojson` instead. Importing that still replaces the whole map.
- Always each extract's latest (`-latest` resolved to the dated file it redirects to). The next download runs in the background while one is filtered, disk permitting.
- Merged with `osmium merge -H` + `time-filter`. Neighbouring extracts overlap and carry the same way in two versions, which a plain merge writes as two `railway_parts` rows with one id.
- Europe's list mirrors Geofabrik's Europe page, one extract per country (the continent won't fit the server's disk). The exceptions are the combination regions, Iceland and the Azores, and Russia goes in as federal districts. That way there is track everywhere on the admin map. A route crossing a region missing from the list goes invalid on import. Japan is one extract.
- Filtered extracts are **kept** under `data/extracts/<geofabrik path>` beside a `.source` (dated file + `RAIL_FILTER`). They are re-downloaded only when `-latest` points elsewhere or the filter changed. An extract removed from `extracts.txt` is deleted (unless `EXTRACTS_FILE` names a trial list); `--fresh` deletes them all.

## Deploy (`deploy.sh` → `remote-deploy.sh`)

- Run locally. The work happens **on the server**, one plink call per step.
- Pulls the server's checkout of `main`. It refuses while local commits are unpushed or `osmium-scripts/`, `src/scripts/` or `package*.json` have uncommitted changes (`src/lib` only warns). Runs `npm ci` when `node_modules` wasn't installed from the current lockfile.
- Prepares the map there (no date: always the latest extracts) and imports it. The log (`data/deploy.log`) streams over `plink -t`, and **the deploy stops when that session ends**. Windows plink never forwards Ctrl+C, so the hangup is the only signal. Rerunning resumes: a pruned file prepared from the current extract list since the last successful deploy is reused. `--follow` shows a running deploy (Ctrl+C there stops it too) or the last log. `--fresh` discards prepared files.
- `remote-deploy.sh --state` is how pulls detect a running deploy.
- The server needs `osmium-tool` (apt) and swap (osmium needs ~2GB to filter a country).
