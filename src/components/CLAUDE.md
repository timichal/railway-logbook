# Components and UI

One directory per part of the app (`logbook/` sidebar and tabs, `map/`, `sharing/`, `admin/`, `layout/`, `auth/`, `articles/`, `ui/`). Always import a component by its full path (`@/components/<dir>/<Name>`), from a sibling too. **Every icon goes through `ui/Icon`** by name: add a new glyph there, never an inline `<svg>`. Its stroke weight is set by its group, not the call site. `IconButton` is a label-less `iconBtn` around one.

## Styling

- **The palette is the token layer.** `html.dark` in `globals.css` re-points Tailwind's neutral ramp, so an ordinary `bg-gray-50` / `text-gray-700` / `border-gray-200` is dark-correct for free. Use `bg-surface` / `text-fg` rather than `bg-white` / `text-black`. Literal `white` and `black` mean the literal colour (text on a solid button, scrims, the toggle knob). Accent ramps flip only at their ends (50–300 and 700–950); 400–600 stay put, so `bg-blue-600 text-white` keeps working. A `hover:` meaning "a step deeper" needs a literal-hex `dark:` override (mostly in `buttonStyles.ts`).
- The scheme is a **setting** (Light / System / Dark, `ThemeSwitch`, `src/lib/theme`) kept in **localStorage**, not `user_preferences`, so the shared map follows the visitor. `THEME_INIT_SCRIPT` sets the class, `color-scheme` and `theme-color` before the first paint. A scheme change rebuilds the map.
- **Interactive states** (hover, active, focus-visible, disabled) are applied in two places and never by hand at a call site. One is `src/lib/ui/buttonStyles.ts`: a named class per button role (`btn(variant, size)`, `iconBtn`, `tabBtn`, `optionRow`, `LINK_BTN`). `active:` matters, because Tailwind v4's `hover:` never paints on a phone. Hover/active are `not-disabled:`, which (unlike `enabled:`) matches an `<a>`. The other is `globals.css` `@layer base`: `cursor: pointer` and the `:focus-visible` outline. Inside `overflow-hidden`, inset the outline (`focus-visible:-outline-offset-2`).
- **A call site adds layout only** (`w-full`, `flex-1`, margins). An appended appearance utility wins or loses by CSS source order. A new size goes in the table's `SIZES`.
- Mobile touch targets have a 44pt floor (`min-h-11`, `md:`-reset). **The navbar picks its layout with `md:` classes, not `useIsMobile`**, because it paints before the JS loads.

## Building blocks

- **Modals**: `ConfirmDialog`, `ShareMapDialog` and `MenuSheet` are native `<dialog>`s opened through `useModalDialog` (`showModal()`). Mount the component only while open. Escape is reported through `onDismiss`. A centred dialog needs `m-auto`. The scrim is the literal `backdrop:bg-[rgb(0_0_0/0.5)]` (older browsers' `::backdrop` didn't inherit custom properties). The top layer covers the toasts too.
- **Safe areas**: `viewportFit: "cover"` + the `safe-area` utility on the three `h-dvh` page roots. `absolute` map furniture needs nothing. Anything **`fixed`** must add its own inset (`MenuSheet`, the admin drawer, the toast stack via `safe-area-bottom`).
- **Suggestion dropdowns** use `useSearchCombobox`: 300ms debounce, a two-character floor counted without separators (`searchQueryLength`), a latest-request guard, ARIA combobox. The list `preventDefault`s on **pointerdown** so focus never leaves the input, which is why **selecting a result blurs the input explicitly** (or the on-screen keyboard stays up).
- Admin saves go through `useSingleFlight` (one at a time, failure toasted). Admin lists sort in the browser with a fixed `en` collation (`adminListSort.ts`).

## Main map layout

- **Desktop sidebar**: resizable, 360–1200px. Until dragged it is `clamp(360px, 40vw, 600px)`; after that, the dragged width, kept in localStorage per page and capped to leave 360px of map (`useResizableSidebar`, `SidebarResizer`).
- **Mobile `MobileBottomSheet`**: snaps collapsed / peek 120px / half / 90%. **It moves by `transform`, never by layout, and a drag renders nothing**: the position lives in a ref and is written to the DOM. What it covers is reported every frame (`onCoverChange` → `--sheet-visible`, lifting MapLibre's bottom controls and `MapProgressBox`). On settling it is reported as **camera padding** (`onSettled` → `handleSheetSettled`). Content pulled down from its top drags it through touch events, since the browser owns a pan on scrollable content. Content can move it with `useBottomSheet()?.snapTo(...)` (null on desktop). Below `MAP_FURNITURE_MIN_HEIGHT_PX` of visible map, the station search and top controls hide.
- **Tabs**: Route Logger, My Trips (auth) / My Journeys (anon), Map & Stats. `activeTab` lives in `MainLayout`. **The Route Logger tab is hidden, not unmounted**, so the planner and a half-filled form survive. `UserSidebar` bumps `tripsVersion` when My Trips changes something.
- **Menu** (`MenuSheet`, every width): its shape (full-screen on a phone, right-hand drawer on desktop) is chosen in CSS on `.menu-sheet`, not by React. Focus is moved explicitly on every view change (`data-opens`). The layer switches are not in the menu; they live in Map & Stats, because they are used while looking at the map. The navbar owns no form: its buttons call `onOpenMenu("login" | "register")`.
- Vias in the planner are reordered with ▲▼, not HTML5 drag-and-drop, which iOS never fires.

## My Trips / My Journeys

- A card opens to a **view**. Only **Edit** starts the map edit session (`onJourneyEditStart`).
- **An edit is a draft, not card state** (`useDraft`, `lib/ui/editGuard.tsx`, provided by `MainLayout`). The forms keep what is typed under the key of what they edit (`tripEditKey`, `journeyEditKey`, `NEW_TRIP_EDIT_KEY`), from Edit until Save or Cancel. So nothing that closes or unmounts a card loses an edit. That covers another card opening, a trip collapsing or deleted, a tab switch, a region switch, search, paging, reload, and the layout swap. A card opened again resumes its draft in edit mode, and a closed one shows **Unsaved**. **Don't add asking to any of those, and keep new form state in the draft.**
- A draft counts as changed only where Save would change something (name and description trimmed); one with no changes is dropped as its card closes. A resumed journey draft is rebased on the journey as loaded (`rebase`). It is dropped if the journey is gone (`ActionError.notFound`). Drafts go only with the page or the account. So only signing out, Sign in / Register and the Admin link ask (`confirmDiscard`), and a reload gets `beforeunload`. The exception is Sign in from the **Signed out** dialog (`useSessionKeepAlive`): signing back in is how the drafts get saved, so it doesn't ask, and they go only if a different account signs in.
- The store is read per key (`useSyncExternalStore`), so typing re-renders only its own form.
- Trip stats: `tripStatsSql` (`tripQueries.ts`). Journey and route stats are aggregated in **separate subqueries** (a direct join fans out), over `DISTINCT (trip_id, track_id)`. Distance is **what was travelled**: a known partial stretch counts its length (`LOGGED_KM_SQL`), a trip unions its journeys' stretches (`range_agg`), and an unknown extent counts the whole line. This is the same rule as the Route Logger's `loggedLengthKm`.

## Map & Stats

**Show on map** first: `LayerToggles` switches for lines drawn but never counted (Heritage, and Special where it isn't ordinary), plus the scenic highlight where `hasScenicHighlight`. Then, where `hasStatsView`, the counted rows. Ticked, an entry is hidden on the map _and_ left out of the numbers. In Europe that means countries (`getProgressByCountry`, one `GROUPING SETS` query), persisted in `user_preferences`. The admin map ignores it. Where `hasOrdinaryNonRegular` (Japan) there are per-type rows instead, whose checkboxes are that type's layer switch.

## Admin

- Where `hasRouteNames`, the route forms have a required Name field above From, and the routes list is sorted and searched by name, with a "Without name" filter. Other names show after the name in the list.
- While the Scenic tab is open, the admin map hides the routes so clicks reach the parts under them. A scenic line then shows a From/To popup and a click selects it, as a route does elsewhere (`onScenicLineSelect`, passed only then and not during its geometry re-pick). Its endpoints are drawn as violet dots that pick their coordinate (`getScenicLineEndpoints`), so a new line can still start where one ends.
- The route preview is derived from the picked points and dropped when they change. Its length is measured by the server with `lineLengthKmSql`.
- Admin notes are coloured by type (`Usage` blue, `UsageInternal` light blue, `Works` orange, `Todo` purple). Switching type in `AdminNotesTab` is publish / unpublish.
