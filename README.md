K filtraci a exportu dat je potřeba [Osmium Tool](https://osmcode.org/osmium-tool/). Na Windowsu se stáhne přes [conda-forge](https://conda-forge.org/download/): `conda install conda-forge::osmium-tool`

Zdrojová data z OpenStreetMap: https://download.geofabrik.de/europe.html

Dump českých dat ke: 2024-11-20T21:21:02Z

Zatím procesování dat z Česka. Používá se [defaultní OpenRailwayMap filtr](https://github.com/OpenRailwayMap/OpenRailwayMap-CartoCSS/blob/master/SETUP.md#load-osm-data-into-the-database) pro všechna vlaková data, až následně se osekává geojson - OSM formát se špatně filtruje vzhledem k relacím dat.

Stažení aktuálních dat + výchozí filtr + export:
```
./filterAndConvertPbf.sh cz
```

Čištění dat:
```
node filtergeo.js ./cz.geojson
```

Aktuálně se pak výsledný geojson vkládá sem, kde se vykreslí na mapě (po loginu edit link): https://umap.openstreetmap.fr/en/map/railroad-map_1140579#9/49.9290/13.9595
