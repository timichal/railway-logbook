K filtraci a exportu dat je potřeba [Osmium Tool](https://osmcode.org/osmium-tool/). Na Windowsu se stáhne přes [conda-forge](https://conda-forge.org/download/): `conda install conda-forge::osmium-tool`

Zdrojová data z OpenStreetMap: https://download.geofabrik.de/europe.html

Zatím procesování dat z Česka. Používá se [defaultní OpenRailwayMap filtr](https://github.com/OpenRailwayMap/OpenRailwayMap-CartoCSS/blob/master/SETUP.md#load-osm-data-into-the-database) pro všechna vlaková data, až následně se osekává geojson - OSM formát se špatně filtruje vzhledem k relacím dat.

Výchozí filtr:
```
osmium tags-filter \
    -o filtered-cz.osm.pbf \
    data-cz.osm.pbf \
    nwr/railway \
    nwr/disused:railway \
    nwr/abandoned:railway \
    nwr/razed:railway \
    nwr/construction:railway \
    nwr/proposed:railway \
    n/public_transport=stop_position \
    nwr/public_transport=platform \
    r/route=train \
    r/route=tram \
    r/route=light_rail \
    r/route=subway
```

Export:
```    
osmium export filtered-cz.osm.pbf -f geojson > data-cz.geojson
```

Čištění dat:
```
node filtergeo.js
```

Geojson se dá následně vložit sem: https://umap.openstreetmap.fr/en/map/new/#8/49.829/15.447
