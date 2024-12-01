K filtraci a exportu dat je potřeba [Osmium Tool](https://osmcode.org/osmium-tool/). Na Windowsu se stáhne přes [conda-forge](https://conda-forge.org/download/): `conda install conda-forge::osmium-tool`

Zdrojová data z OpenStreetMap: https://download.geofabrik.de/europe.html

Poslední stažení dumpů: 1. 12. 2024

Zatím procesování dat z Česka. Používá se [defaultní OpenRailwayMap filtr](https://github.com/OpenRailwayMap/OpenRailwayMap-CartoCSS/blob/master/SETUP.md#load-osm-data-into-the-database) pro všechna vlaková data, až následně se osekává geojson - OSM formát se špatně filtruje vzhledem k relacím dat.

Proces:
- `npm run prepare` stáhne a připraví data
- `npm run combine cz` spojí tratě a uloží do `cz-combined.geojson`

Skripty v `osmium-scripts` volané při `npm run prepare`:
- `prepare.sh` volá přímo npm. Zatím natvrdo vepsané parametry
- `download.sh` stáhne aktuální kompletní data pro dané země v osm.pbf formátu, výstup např. `cz.osm.pbf`
- `filterRailFeatures.sh` uplatní na data filtr z OpenRailwayMap, výstup např. `cz-rail.osm.pbf`
- `merge.sh` mergne data z různých zemí kvůli mezinárodním tratím, výstup např. `at-cz-rail.osm.pbf`
- `convertToGeojson.sh` převede data do geojsonu, výstup např. `cz-rail.geojson`
- `pruneData.ts` aplikuje custom filtry a uloží do `cz-pruned.geojson`


- JOSM si s moc velkými daty neporadí
- vždycky export jedné země pro tratě v rámci jedné země
- pro mezinárodní tratě merge daných zemí

Mapy tratí + řády:
- ČR: https://www.cd.cz/jizdni-rad/tratove-jizdni-rady
- ÖBB: https://www.oebb.at/en/fahrplan/fahrplanbilder


Aktuálně se pak výsledný geojson vkládá sem, kde se vykreslí na mapě (po loginu edit link): https://umap.openstreetmap.fr/en/map/railroad-map_1140579#9/49.9290/13.9595
