# Phase 0 spike — throwaway

This is **not** the mobile app. It is the two-to-three-day gate described in
`../MOBILE_APP_PLAN.md` (Phase 0), and it exists to answer two questions before
anyone spends a week on the HTTP API layer:

1. **Does the tile server behave against MapLibre Native?** Production Martin
   over HTTPS, the real `railway_routes_tile` and `public_stations_tile`, the real
   style expressions, the real OpenFreeMap basemap.
2. **Does a z4 tile of ~5000 routes render at an acceptable frame rate on a
   phone?** A z4 route tile is **789 KB** of protobuf, measured from
   `https://railmap.zlatkovsky.cz/tiles/railway_routes_tile/4/8/5`.

If either answer is bad, that is worth three days rather than three weeks.
**Delete this whole directory once the answers are recorded** in the plan.

---

## What it does, and what that proves

Everything visual comes from `src/railwayStyle.ts` and `src/basemapStyle.ts`,
which are ports of the web app's `style.ts`, `userRouteStyling.ts`,
`userMapLayers.ts` and `basemap.ts`. Nothing is styled by hand. So **if the map
looks like the web app, the plan's "ports nearly verbatim" claim is confirmed**,
and Phase 3 is the three weeks it is budgeted at rather than five.

The layer stack is the real one, bottom to top: scenic outline, regular routes,
dotted heritage, dashed special, station dots, station labels.

Two things it deliberately leaves out: the invisible `railway_routes_click` hit
area (nothing in the spike is tappable) and the `feature-state` branches of the
colour expression (they serve the web app's anonymous localStorage path, which
has no equivalent here).

---

## Running it

### You cannot use Expo Go

`@maplibre/maplibre-react-native` ships native code and is not part of the Expo
SDK, so it needs a **development build**. That is the single biggest practical
difference from anything you have run before.

### iOS, on the Mac (the recommended path)

The plan was written assuming Windows-only and argues at length that you do not
need a Mac. You have one, so use it — a local build is faster than EAS and needs
no subscription.

One-time setup on the Mac:

1. **Xcode** from the App Store, then launch it once to accept the licence and
   let it install its components.
2. `xcode-select --install` (command line tools).
3. **CocoaPods**: `sudo gem install cocoapods` (or `brew install cocoapods`).
4. **Node 20+**: `brew install node`.

Then:

```bash
git clone <this repo>            # or git pull, if already cloned
cd railway-logbook/mobile-spike
npm install
npx expo run:ios --device        # pick your iPhone when prompted
```

`expo run:ios` runs `expo prebuild` for you, generating the `ios/` folder (which
is gitignored — it is disposable output, not source). The first build takes
10–20 minutes; later ones are much faster.

For a physical iPhone you need a free Apple ID signed into Xcode
(Xcode → Settings → Accounts). A free account's provisioning profile expires
after 7 days, which is plenty for a spike. The iOS **Simulator** also works
(`npx expo run:ios` with no `--device`) and is fine for a first look — but it
renders on the Mac's GPU, so **any frame-rate number from the Simulator is
meaningless**. Only the physical iPhone answers question 2.

### Android

You have no Android device, so this is emulator-only for now — and an emulator's
frame rate is as untrustworthy as the Simulator's. What the emulator *can* still
answer is question 1: whether the tiles load, the expressions parse, and the
glyphs resolve on the Android SDK, which is a genuinely different renderer from
iOS's.

1. Install **Android Studio** (either machine), and through its SDK Manager the
   Android SDK + platform tools.
2. Create a device in the Device Manager (any recent Pixel image, API 34+).
3. `npx expo run:android` with the emulator running.

Treat Android frame rate as **unanswered** until a device exists. Say so in the
findings rather than reporting an emulator number.

### If Metro complains about React

`metro.config.js` pins `nodeModulesPaths` and sets
`disableHierarchicalLookup` precisely because this project sits inside the
Next.js repo, whose `node_modules` one level up carries a different React. If you
see a "two copies of React" invariant or a version mismatch, that file is the
first place to look.

---

## Reading the HUD

Top-left: **fps** over the last 500 ms, and in brackets the lowest window seen
since the last reset. Below it: current zoom, how long the basemap style took to
fetch and process, its layer count, and whether the map has reported a full
render.

**The meter perturbs what it measures.** Every completed frame crosses the RN
bridge as an event. So take each reading twice — once with `meter` on for the
number, once with it off for how it actually feels — and report both. An idle map
renders no frames at all, so a `0 fps` reading means nothing was moving; the low
watermark ignores those windows for that reason.

The chips along the bottom:

| Chip | What it isolates |
| --- | --- |
| `reset meter` | Clears fps and the low watermark before a fresh pan/zoom run |
| `→ Japan` / `→ Europe` | The other region — the plan asks whether tile volumes behave for both |
| `routes` | Unmounts the route source entirely. **This is the key comparison**: basemap-only vs basemap+routes is the whole of question 2 |
| `my rides` | Adds `?user_id=1` to the tile URL, which turns on the per-user LATERAL join and `user_fully_ridden_routes` — the most expensive part of the tile query, and the reason routes are green/orange rather than all red |
| `heritage` / `special` / `scenic` | The dotted, dashed and amber-outline layers. Dash arrays and round line-caps are exactly the kind of thing that renders differently across SDKs |
| `stations` / `labels` | The dots, and the glyph path |
| `meter` | The counter itself |

---

## What to report back

Paste the answers into the **Phase 0** section of `../MOBILE_APP_PLAN.md`; that
file is the handoff document between sessions.

**Question 1 — tiles and styling**

- Do route tiles load at all over HTTPS? Any `onDidFailLoadingMap`?
- Does the map look like the web app — same reds/greens/oranges, same relative
  line weights? (Screenshot beside the web app is the fastest way to tell.)
- Do the **station labels** render in bold Noto Sans, or in something that looks
  like a system font? A system font means the glyph endpoint is not being used and
  `text-font` needs revisiting on native.
- Do the **Latin labels** work? Switch to Japan and zoom into Honshu. Place names
  in Latin script means the `latinizeLabels` port did its job; kanji means it did
  not. This one matters: the plan wrongly assumed native handles it for free.
- Does the dotted `heritage` layer render as **round dots**, and `special` as
  dashes?
- Anything in the console that the web app does not also print?

**Question 2 — frame rate**

For each of Europe z4-ish (whole continent), Europe z8 (a country), and Japan z6,
on the physical iPhone:

- fps while panning, `routes` off → \_\_\_
- fps while panning, `routes` on → \_\_\_
- fps while pinch-zooming, `routes` on → \_\_\_
- with `my rides` on, does the first paint take visibly longer? → \_\_\_
- Subjective, meter off: smooth / acceptable / bad → \_\_\_

**Anything else that surprised you.** A spike's most valuable output is usually
the thing nobody thought to ask about.
