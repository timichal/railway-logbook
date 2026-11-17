-- Rows for CI's empty database (.github/workflows/deploy.yml). A local database
-- already has the real ones and never runs this.
--
-- Routes: the `*.sql.test.ts` files that write to railway_routes inside a
-- rolled-back transaction need rows to write to (dataVersions.sql.test.ts wants
-- two).
INSERT INTO railway_routes
  (from_station, to_station, usage_type, geometry, length_km, starting_coordinate, ending_coordinate)
VALUES
  ('Praha', 'Kolín', 0,
   ST_GeomFromText('LINESTRING(14.43 50.08, 15.20 50.03)', 4326), 55.3,
   ST_SetSRID(ST_MakePoint(14.43, 50.08), 4326), ST_SetSRID(ST_MakePoint(15.20, 50.03), 4326)),
  ('Kolín', 'Pardubice', 0,
   ST_GeomFromText('LINESTRING(15.20 50.03, 15.78 50.03)', 4326), 41.4,
   ST_SetSRID(ST_MakePoint(15.20, 50.03), 4326), ST_SetSRID(ST_MakePoint(15.78, 50.03), 4326));

-- Stations: searchText.sql.test.ts checks every station's stored folds
-- (name_key, name_words) against search_key/search_words, which an empty table
-- passes without checking anything. Names that exercise the folding: diacritics,
-- separators, brackets and slashes, Japanese romanization with macrons, and a
-- negated id (a station mapped as an area).
INSERT INTO stations (id, name, coordinates, near_route) VALUES
  (1, 'Praha hlavní nádraží', ST_SetSRID(ST_MakePoint(14.435, 50.083), 4326), TRUE),
  (2, 'Praha-Dejvice', ST_SetSRID(ST_MakePoint(14.393, 50.100), 4326), TRUE),
  (3, 'Warszawa Starołęka', ST_SetSRID(ST_MakePoint(21.099, 52.198), 4326), FALSE),
  (4, 'Rīga (Centrālā stacija)', ST_SetSRID(ST_MakePoint(24.121, 56.946), 4326), FALSE),
  (5, 'Kato Acharnai/Αχαρνές', ST_SetSRID(ST_MakePoint(23.733, 38.081), 4326), FALSE),
  (6, 'Ōmiya', ST_SetSRID(ST_MakePoint(139.624, 35.906), 4326), FALSE),
  (7, 'Owari-Seto, Aichi', ST_SetSRID(ST_MakePoint(137.084, 35.228), 4326), FALSE),
  (-8, 'Vácrátót', ST_SetSRID(ST_MakePoint(19.235, 47.708), 4326), FALSE);
