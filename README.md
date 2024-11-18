data z: https://download.geofabrik.de/europe.html

Česko: používáme defaultní openrailwaymap filtr a až pak filtrujeme geojson kvůli maglajzu s relacemi v OSM formátu

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
    
osmium export filtered-cz.osm.pbf -f geojson > data-cz.geojson

node filtergeo.js

https://umap.openstreetmap.fr/en/map/new/#8/49.829/15.447
