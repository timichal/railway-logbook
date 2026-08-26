# Dark mode — what the beta left out

Dark mode shipped as a beta: the colour-scheme setting (Light / System / Dark, in
the menu), the palette re-pointing that carries the whole app with it, and the
basemap's dark style. `CLAUDE.md`'s **Dark mode** section documents all of that —
read it first. What is below is the rest: three things the beta deliberately did
not attempt, plus two found by using it. Each says why it costs more than it looks
like it should. The last of them — country borders — is not really a dark-mode item
at all: it is wanted in both schemes, and lives here because the dark map is where
it was noticed.

- [ ] **The route colours are still the light ones.** `COLORS.railwayRoutes` —
      visited green, partial orange, unvisited red, each with a darker highspeed
      shade — was picked against a white basemap. The saturated branch/main
      shades carry on the dark ground, but the highspeed ones (`#7a3633`,
      `#155e34`) are close to muddy on it. Re-picking them is not the hard part;
      *delivering* them is: `userMapLayers.ts` builds its paint configs as
      module-level constants at import time, on purpose (stable references for
      `useMapTileRefresh`, and both maps must draw identical lines), so a
      per-scheme palette means turning those constants into memoised functions
      and threading the scheme through `RailwayMap`'s tile-refresh configs too.
      The stations layers show the shape of it — they take the scheme as an
      argument because they were the only two whose colours depend on the ground
      under them rather than on the data in them.
- [ ] **Partial and unvisited are hard to tell apart on the dark ground.** They are
      two oranges to begin with — partial `#d97706`, unvisited `#b8554f` — and the
      distinction that carried them on white (one warm-orange, one brick-red) mostly
      goes when both sit on near-black; the highspeed pair (`#92400e` / `#7a3633`)
      is worse still. This is the same delivery problem as the item above and wants
      solving with it: pick a dark palette where the three states are three
      *hues* rather than three temperatures of one, rather than nudging the existing
      values. Whatever comes out has to keep working for the colour-blind readings
      the light palette was chosen against.
- [ ] **The popup badges stay bright.** The line-class, Scenic and frequency
      chips in `tooltipFormatting.ts` are pastel fills with dark text, and they
      read as chips on a dark popup rather than as a mistake — but they are the
      one thing in the app still lit from the light palette.
- [ ] **The admin page cannot change the scheme.** It has no menu (its hamburger
      opens the sidebar drawer), so the switch is not reachable there; it follows
      whatever the main map set. Either put a compact switch in the admin bar
      beside the region switch, or leave it — "Back to Main Map" is one click.
- [ ] **Country borders are not visible on either map.** The basemap styles draw
      boundaries themselves, but `createBasemapFadeLayer` sits above the whole
      basemap and washes them out along with everything else (0.25 toward white in
      light, 0.4 toward near-black in dark) — so on a map whose whole point is which
      country a line runs through, the borders are the one piece of context missing.
      Wanted in **both** schemes, not just dark. The fix has the shape the station
      labels already have: the boundary layers want to be lifted above the fade (or
      re-added over it) rather than left under it, which means finding them by what
      they draw in each of the two styles — liberty's ~110 layers and dark's 47 do
      not share an id list — and giving them a colour per scheme, since a border
      drawn above the fade is picked against the ground rather than washed into it.
