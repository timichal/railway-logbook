import { copyFileSync, mkdirSync } from "node:fs";

/**
 * MapLibre GL JS v6 is ESM-only. Its web worker (`maplibre-gl-worker.mjs`)
 * does a relative `import "./maplibre-gl-shared.mjs"` at runtime. Next.js
 * (webpack/Turbopack) emits a worker referenced via `new URL(...)` as a bare
 * asset without bundling that sibling, so the shared chunk 404s and no tiles
 * render. Copying both files to `public/maplibre/` keeps them as siblings on a
 * stable same-origin path, so the relative import resolves. `setWorkerUrl` in
 * useMapLibre.ts points at the copied worker.
 *
 * Runs automatically via `predev` / `prebuild`; re-run manually with
 * `npm run copyMaplibreWorker` after bumping maplibre-gl.
 */
const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];
const SRC_DIR = "node_modules/maplibre-gl/dist";
const DEST_DIR = "public/maplibre";

mkdirSync(DEST_DIR, { recursive: true });
for (const file of FILES) {
  copyFileSync(`${SRC_DIR}/${file}`, `${DEST_DIR}/${file}`);
  console.log(`Copied ${file} -> ${DEST_DIR}/${file}`);
}
