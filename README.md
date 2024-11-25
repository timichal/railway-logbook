K filtraci a exportu dat je potřeba [Osmium Tool](https://osmcode.org/osmium-tool/). Na Windowsu se stáhne přes [conda-forge](https://conda-forge.org/download/): `conda install conda-forge::osmium-tool`

Zdrojová data z OpenStreetMap: https://download.geofabrik.de/europe.html

Poslední stažení dumpů: 25. 11. 2024

Zatím procesování dat z Česka. Používá se [defaultní OpenRailwayMap filtr](https://github.com/OpenRailwayMap/OpenRailwayMap-CartoCSS/blob/master/SETUP.md#load-osm-data-into-the-database) pro všechna vlaková data, až následně se osekává geojson - OSM formát se špatně filtruje vzhledem k relacím dat.

Proces:
- `npm run download cz` stáhne aktuální kompletní data za Česko v osm.pbf formátu
- `npm run filter cz` uplatní na data filtr z OpenRailwayMap a uloží do `cz-rail.osm.pbf`
- `npm run merge cz at li` mergne data z Česka, Rakouska a Lichtenštenjska
- `npm run convert cz` převede data do geojsonu `cz-rail.geojson`
- `npm run prune cz` aplikuje další filtry a uloží do `cz-pruned.geojson`
- `npm run combine cz` spojí tratě a uloží do `cz-combined.geojson`

- JOSM si s moc velkými daty neporadí
- vždycky export jedné země pro tratě v rámci jedné země
- pro mezinárodní tratě merge daných zemí


Aktuálně se pak výsledný geojson vkládá sem, kde se vykreslí na mapě (po loginu edit link): https://umap.openstreetmap.fr/en/map/railroad-map_1140579#9/49.9290/13.9595
