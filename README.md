K filtraci a exportu dat je potřeba [Osmium Tool](https://osmcode.org/osmium-tool/). Na Windowsu se stáhne přes [conda-forge](https://conda-forge.org/download/): `conda install conda-forge::osmium-tool`

Zdrojová data z OpenStreetMap: https://download.geofabrik.de/europe.html

Zatím procesování dat z Česka. Používá se [defaultní OpenRailwayMap filtr](https://github.com/OpenRailwayMap/OpenRailwayMap-CartoCSS/blob/master/SETUP.md#load-osm-data-into-the-database) pro všechna vlaková data, až následně se osekává geojson - OSM formát se špatně filtruje vzhledem k relacím dat.

Výchozí filtr + export:
```
./filterAndConvertPbf.sh czech-republic-latest.osm.pbf data-cz.geojson
```

Čištění dat:
```
node filtergeo.js ./data-cz.geojson
```

Geojson se dá následně vložit sem: https://umap.openstreetmap.fr/en/map/new/#8/49.829/15.447
