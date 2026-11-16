# Route data audits

Findings from audits of the route data that were reviewed and **accepted as they are**. A later audit reports only what is new here, or what has grown. Label conventions are in `CLAUDE.md` ("Route labels").

**Check the admin's `Todo` notes before reporting a finding** (`admin_notes`, `note_type = 'Todo'`, within a few hundred metres of the route). A note such as "osm fix nov 15" means the admin has already fixed the OSM data there, and will re-pick the route once a map deploy brings the fix in. A route that ends short of its station, leaves a gap or carries a stop-gap label beside such a note is known and pending, so leave it out.

## Accepted overlaps between valid routes (2026-11-14)

- **Poznań Franowo [junction] → Kobylnica** and **Złotniki → Poznań Franowo [junction]** (3.3 km): intentional. Brief parallel running is fine for Special routes.
- **Ferencváros → Kőbánya-Kispest** and **Ferencváros → Ferencváros [junction]** (1.2 km): the OSM track layout allows no parallel path there.
- **Watarase Keikoku Line: Aioi → Kiryū** and **Ryōmō Line: Isesaki → Kiryū** (1.35 km): a pathfinder artefact, tolerable.
- **Hitahikosan Line: Jōno → Tagawa-Ita** and **Tagawa Line: Tagawa-Ita → Yukuhashi** (1 km): really shared single track.
- Approaches into Wrocław (**Kamieniec Ząbkowicki → Wrocław** and **Świdnica → Wrocław**; **Jaworzyna Śląska → Wrocław** and **Rudna Miasto → Wrocław**) and into Poznań (**Krzyż → Poznań** and **Złotniki → Poznań**), about 1.9 km each: too few tracks in OSM to draw them in parallel.
- Overlaps of 0.7 km or less at stations and junctions are normal.
- **Tomaszów Mazowiecki → Radzice [west junction]** and **Tomaszów Mazowiecki → Spała** (0.73 km, 2026-11-15): the shared stretch out of the station.

## Two routes between the same points (2026-11-15)

- **Ercsi [junction] → Százhalombatta** and **Lunca Budieni → Copăcioasa** each exist twice, on purpose: alternate routes on separate tracks, tagged "Long-distance trains" and "Regional trains".
- **Port Island Line: Naka-Kōen → Shimin Hiroba** exists twice, once direct (1.1 km) and once around the loop via Kita-Futō (2.5 km). Trains take the direct line in one direction and the loop in the other.
- In Japan, the same From → To on two differently named lines (a Shinkansen and the main line, JR and a private or third-sector line beside it) is two parallel lines, not a duplicate.

## Checked and fine

- **Sasebo → Imari** (Matsuura Railway) is 80.7 km for 18 km in a straight line: the line goes around the peninsula.
- Long, winding routes that are correct: **Oravița → Anina** (2.4× the straight line), **Pernik Razpredelitelna → Voluyak** (2×, by the Hrabarsko bypass), **Vidin → Brusartsi** (2.2×).
- **Csömödér → Csömödér [junction]** (0.24 km) is a real stub into the forest railway's station.
- **Inō / Ino** and **Narutō / Naruto** are four different stations (居能 / 井野, 成東 / 鳴門).
- **Moldovița → Vatra Moldoviței** and **Szilvásvárad Fatelep → Szalajka Fátyol-vízesés** use the stop names from the operators' websites. OSM has other names there ("Mănăstirea Moldovița", "Szalajka-Fatelep"), and the operator wins. This happens on small heritage and forest railways, where an operator's own name beats OSM's.
- Endpoints with no OSM station nearby (2026-11-15), probably stations missing from OSM, which is common. Not checked one by one: **Waliły**, **Żabno**, **Criscior**, **Vydrovo-Konečná**, and in Japan **Tenjimbashisuji Rokuchōme**, **Kira-Yoshida**, **Kannoura**, **Kōiki-kōen-mae**, **Torokko Kameoka**.
- Stations shared by a metro and trains (2026-11-16) are in OSM, but `pruneData` drops a `subway=yes` station whose `station` tag lists `subway` alone (`isMetroOnlyStation`). **Oshiage**, **Sengakuji**, **Kotake-Mukaihara**, **Misasagi**, **Kaizuka** and **Meinohama** are tagged that way (fix in OSM: `station=train;subway`). **Akaike** is a shared station too, not checked.
