"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import AdminList, { usePagedList } from "@/components/admin/AdminList";
import RouteEditForm, { type RouteEditAction } from "@/components/admin/RouteEditForm";
import { type EditRouteData, NO_ROUTE_SUGGESTIONS } from "@/components/admin/RouteMetadataFields";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import {
  type AdminRouteDetail,
  type AdminRouteSummary,
  deleteRailwayRoute,
  duplicateRailwayRoute,
  getAllRailwayRoutes,
  markRouteInvalid,
  type RouteSuggestions,
  setRouteUnderRepair,
  updateRailwayRoute,
} from "@/lib/adminRouteActions";
import { useRegion } from "@/lib/regionContext";
import { foldForSearch } from "@/lib/searchText";
import { routeTitle } from "@/lib/shared/map/routeFeature";
import type { RouteBounds } from "@/lib/shared/types";
import { ConfirmDialog, useToast } from "@/lib/toast";
import { compareByEndpoints, compareText } from "@/lib/ui/adminListSort";
import { useSingleFlight } from "@/lib/ui/useSingleFlight";

type RouteFilterKey =
  | "invalid"
  | "underRepair"
  | "closed"
  | "unintendedBacktracking"
  | "withoutUsageTags";

interface RouteFilter {
  key: RouteFilterKey;
  label: string;
  predicate: (route: AdminRouteSummary) => boolean;
  /** Ticked filters sharing a group are OR'd; groups are AND'd. Defaults to the key. */
  group?: string;
}

const ROUTE_FILTERS: RouteFilter[] = [
  // The two invalid filters split the failing routes between them: "invalid" is
  // the plain worklist, "under repair" the ones parked pending OSM works. Ticking
  // both is how you see every invalid route that still runs. A closed route is in
  // neither: it is no longer recalculated, so there is nothing to fix.
  {
    key: "invalid",
    label: "Invalid",
    predicate: (route) =>
      route.is_valid === false && route.under_repair !== true && route.closed !== true,
    group: "invalid",
  },
  {
    key: "underRepair",
    label: "Under repair",
    predicate: (route) => route.is_valid === false && route.under_repair === true,
    group: "invalid",
  },
  {
    key: "closed",
    label: "Closed",
    predicate: (route) => route.closed === true,
  },
  // Invalid and closed routes are left out: their has_backtracking flag is left
  // over from whenever they last recalculated. Same set as `showBacktracking`.
  {
    key: "unintendedBacktracking",
    label: "Unintended backtracking",
    predicate: (route) =>
      route.has_backtracking === true &&
      route.intended_backtracking !== true &&
      route.is_valid !== false &&
      route.closed !== true,
  },
  // The worklist of routes stored before a tag was required (`routeUsageTags`):
  // none of them can have an edit saved until one is added.
  {
    key: "withoutUsageTags",
    label: "Without usage tags",
    predicate: (route) => route.usage_tags.length === 0,
  },
];

const routeKey = (route: AdminRouteSummary) => route.track_id;

function editFormFromRoute(route: AdminRouteDetail): EditRouteData {
  return {
    name: route.name || "",
    other_names: route.other_names,
    from_station: route.from_station,
    to_station: route.to_station,
    description: route.description || "",
    usage_type: route.usage_type,
    usage_tags: route.usage_tags,
    link: route.link || "",
    link_name: route.link_name || "",
    line_class: route.line_class,
    intended_backtracking: route.intended_backtracking,
    closed: route.closed,
    closed_on: route.closed_on ?? "",
  };
}

interface AdminRoutesTabProps {
  selectedRouteId?: number | null;
  /** The selected route's detail, loaded by the page. */
  selectedRoute: AdminRouteDetail | null;
  selectedRouteLoading: boolean;
  /**
   * A write returned the route as stored: it replaces the selected route's detail
   * if that is still this route. Returns whether it did.
   */
  onRouteStored: (route: AdminRouteDetail) => boolean;
  /** `focus` flies the map to the route once it has loaded. */
  onRouteSelect?: (routeId: number | null, options?: { focus?: boolean }) => void;
  /** A route was changed or deleted: the map's route tiles are stale. */
  onRoutesChanged: () => void;
  onEditGeometry: (route: AdminRouteDetail) => void;
  onRouteFocus: (bounds: RouteBounds) => void;
  suggestions?: RouteSuggestions;
  onSuggestionsChanged?: () => void;
  /** Heads the list: the Routes / Scenic switch. */
  toolbar?: ReactNode;
}

export default function AdminRoutesTab({
  selectedRouteId,
  selectedRoute,
  selectedRouteLoading,
  onRouteStored,
  onRouteSelect,
  onRoutesChanged,
  onEditGeometry,
  onRouteFocus,
  suggestions = NO_ROUTE_SUGGESTIONS,
  onSuggestionsChanged,
  toolbar,
}: AdminRoutesTabProps) {
  const region = useRegion();
  const regionId = region.id;
  const { showError, showSuccess } = useToast();
  // One write at a time. The tag names the button's action, for its label, and
  // the route it was started on, so a route selected meanwhile doesn't show it.
  const { busy, running, run } = useSingleFlight<{
    action: RouteEditAction;
    trackId: number;
  }>();

  const [routes, setRoutes] = useState<AdminRouteSummary[]>([]);
  const [listLoading, setListLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [checkedFilters, setCheckedFilters] = useState<ReadonlySet<RouteFilterKey>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [markInvalidConfirmOpen, setMarkInvalidConfirmOpen] = useState(false);
  const [editForm, setEditForm] = useState<EditRouteData | null>(null);
  // The form is filled once per route loaded, not on every change to its detail:
  // the under-repair toggle and Mark Invalid replace the detail too, and refilling
  // then would throw away edits still in progress.
  const [formRouteId, setFormRouteId] = useState<number | null>(null);
  const loadedRouteId = selectedRoute?.track_id ?? null;
  if (loadedRouteId !== formRouteId) {
    setFormRouteId(loadedRouteId);
    setEditForm(selectedRoute ? editFormFromRoute(selectedRoute) : null);
  }

  const loadRoutes = async () => {
    try {
      setListLoading(true);
      const routesData = unwrap(await getAllRailwayRoutes(regionId));
      setRoutes(routesData);
    } catch (error) {
      console.error("Error loading routes:", error);
      showError(`Failed to load routes: ${actionErrorMessage(error)}`);
    } finally {
      setListLoading(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadRoutes is redefined every render; regionId is the only thing that should reload the list (plus the initial mount).
  useEffect(() => {
    loadRoutes();
  }, [regionId]);

  // The list arrives unordered (see getAllRailwayRoutes) and is sorted here, by
  // from/to — or, where the region names its lines, by name first, the ones
  // still unnamed after them. track_id last, so two routes between the same
  // stations (two lines, say) keep their order from one reload to the next.
  const hasRouteNames = region.hasRouteNames;
  const orderedRoutes = useMemo(() => {
    return routes.toSorted((a, b) => {
      if (hasRouteNames) {
        const aName = a.name?.trim();
        const bName = b.name?.trim();
        if (!aName !== !bName) return aName ? -1 : 1;
        if (aName && bName) {
          const byName = compareText(aName, bName);
          if (byName !== 0) return byName;
        }
      }
      return compareByEndpoints(a, b) || a.track_id - b.track_id;
    });
  }, [routes, hasRouteNames]);

  // What the search box matches a route by — its endpoints, and its line names where
  // the region names lines — folded once per load rather than on every keystroke.
  // Folded as the map's search box folds ("chuo" finds "Chūō", "owariseto" "Owari Seto").
  const searchKeys = useMemo(() => {
    const keys = new Map<number, string[]>();
    for (const route of routes) {
      const texts = [route.from_station, route.to_station];
      if (hasRouteNames) {
        if (route.name) texts.push(route.name);
        texts.push(...route.other_names);
      }
      keys.set(route.track_id, texts.map(foldForSearch));
    }
    return keys;
  }, [routes, hasRouteNames]);

  const filteredRoutes = useMemo(() => {
    const groups = new Map<string, RouteFilter["predicate"][]>();
    for (const filter of ROUTE_FILTERS) {
      if (!checkedFilters.has(filter.key)) continue;
      const group = filter.group ?? filter.key;
      groups.set(group, [...(groups.get(group) ?? []), filter.predicate]);
    }
    const ticked = [...groups.values()];
    let filtered = orderedRoutes.filter((route) =>
      ticked.every((predicates) => predicates.some((predicate) => predicate(route))),
    );

    if (searchQuery.trim()) {
      const query = foldForSearch(searchQuery.trim());
      filtered = filtered.filter((route) =>
        searchKeys.get(route.track_id)?.some((key) => key.includes(query)),
      );
    }

    return filtered;
  }, [orderedRoutes, searchKeys, searchQuery, checkedFilters]);

  // Back to page 1 on a new search, filter or region
  const paged = usePagedList(
    filteredRoutes,
    `${regionId}|${searchQuery}|${[...checkedFilters].join()}`,
    routeKey,
    selectedRouteId ?? null,
  );

  const filterCounts = useMemo(
    () => ROUTE_FILTERS.map((filter) => routes.filter(filter.predicate).length),
    [routes],
  );
  const filterOptions = ROUTE_FILTERS.map((filter, i) => ({
    key: filter.key,
    label: filter.label,
    count: filterCounts[i],
    checked: checkedFilters.has(filter.key),
    onChange: (checked: boolean) =>
      setCheckedFilters((prev) => {
        const next = new Set(prev);
        if (checked) next.add(filter.key);
        else next.delete(filter.key);
        return next;
      }),
  }));

  // Route selection. The page flies the map to a route picked here once it has
  // loaded; one already loaded has nothing to wait for.
  const handleRouteClick = ({ track_id: trackId }: AdminRouteSummary) => {
    if (selectedRoute?.track_id === trackId) {
      onRouteFocus(selectedRoute.bounds);
      return;
    }
    onRouteSelect?.(trackId, { focus: true });
  };

  // What is current when a write comes back, which may be after the admin moved
  // on: delete and duplicate change the selection only if theirs is still the
  // selected route, and a copy joins the list only of the region it was made in.
  const currentRef = useRef({ regionId, selectedRouteId });
  currentRef.current = { regionId, selectedRouteId };

  // A write returns the route as stored, which goes into the list row and, while
  // it is still selected, the detail: no read back, and no reload of the list.
  const storeRoute = (route: AdminRouteDetail) => {
    setRoutes((prev) => prev.map((row) => (row.track_id === route.track_id ? route : row)));
    return onRouteStored(route);
  };

  const handleSaveRoute = () => {
    if (!selectedRoute || !editForm) return;
    const trackId = selectedRoute.track_id;
    const form = editForm;

    run(
      "update route",
      async () => {
        const route = unwrap(
          await updateRailwayRoute(
            trackId,
            form.name.trim() || null,
            form.other_names,
            form.from_station.trim(),
            form.to_station.trim(),
            form.description || null,
            form.usage_type,
            form.usage_tags,
            form.link || null,
            form.link_name || null,
            form.line_class,
            form.intended_backtracking,
            form.closed,
            form.closed_on || null,
          ),
        );
        // The form shows what the server stored (trimmed, names deduplicated),
        // unless another route was selected meanwhile, with a form of its own,
        // or the admin typed on while it saved: the fields stay editable, and
        // what was typed since is newer than the save.
        if (storeRoute(route)) {
          setEditForm((current) => (current === form ? editFormFromRoute(route) : current));
        }
        onRoutesChanged();
        // Editing a route may add new tags or names, or drop the last use of one.
        onSuggestionsChanged?.();
        showSuccess("Route updated successfully!");
      },
      { action: "save", trackId },
    );
  };

  const handleToggleUnderRepair = (underRepair: boolean) => {
    if (!selectedRoute) return;
    const trackId = selectedRoute.track_id;

    run("update under repair flag", async () => {
      storeRoute(unwrap(await setRouteUnderRepair(trackId, underRepair)));
      // Repaints the admin map: the flag decides violet vs grey.
      onRoutesChanged();
      showSuccess(
        underRepair ? "Route marked as under repair." : "Route no longer marked as under repair.",
      );
    });
  };

  const handleDeleteRoute = () => {
    if (!selectedRoute) return;
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteRoute = () => {
    if (!selectedRoute) return;
    setDeleteConfirmOpen(false);
    const route = selectedRoute;

    run(
      "delete route",
      async () => {
        unwrap(await deleteRailwayRoute(route.track_id));
        setRoutes((prev) => prev.filter((row) => row.track_id !== route.track_id));
        if (currentRef.current.selectedRouteId === route.track_id) onRouteSelect?.(null);
        onRoutesChanged();
        // Deleting a route may have removed the last use of a tag or name.
        onSuggestionsChanged?.();
        showSuccess(`Route "${routeLabel(route)}" has been deleted successfully.`);
      },
      { action: "delete", trackId: route.track_id },
    );
  };

  const handleDuplicateRoute = () => {
    if (!selectedRoute) return;
    const route = selectedRoute;
    const startRegionId = regionId;

    run(
      "duplicate route",
      async () => {
        const copy = unwrap(await duplicateRailwayRoute(route.track_id));
        // A list reloaded meanwhile (a region switch and back) may have it already
        if (currentRef.current.regionId === startRegionId) {
          setRoutes((prev) =>
            prev.some((row) => row.track_id === copy.track_id) ? prev : [...prev, copy],
          );
        }
        // Select the new copy so the admin can immediately edit it.
        if (currentRef.current.selectedRouteId === route.track_id) {
          onRouteSelect?.(copy.track_id);
        }
        onRoutesChanged();
        showSuccess(`Route "${routeLabel(route)}" duplicated successfully.`);
      },
      { action: "duplicate", trackId: route.track_id },
    );
  };

  const confirmMarkInvalid = () => {
    if (!selectedRoute) return;
    setMarkInvalidConfirmOpen(false);
    const trackId = selectedRoute.track_id;

    run(
      "mark route invalid",
      async () => {
        storeRoute(unwrap(await markRouteInvalid(trackId)));
        // Repaints the admin map (grey) and its km counter.
        onRoutesChanged();
        showSuccess("Route marked as invalid.");
      },
      { action: "markInvalid", trackId },
    );
  };

  // How the dialogs and toasts name the route: where lines are named (Japan), two
  // parallel lines between the same stations differ only by their name.
  const routeLabel = (route: AdminRouteDetail) => {
    const { name, endpoints } = routeTitle(route, regionId);
    return name ? `${name} (${endpoints})` : endpoints;
  };

  const handleUnselect = () => {
    onRouteSelect?.(null);
  };

  return (
    <>
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete Railway Route"
        message={
          selectedRoute
            ? `Are you sure you want to delete the route "${routeLabel(selectedRoute)}"?\n\nTrack ID: ${selectedRoute.track_id}\n\nThis action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={confirmDeleteRoute}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <ConfirmDialog
        isOpen={markInvalidConfirmOpen}
        title="Mark Route as Invalid"
        message={
          selectedRoute
            ? `Mark the route "${routeLabel(selectedRoute)}" as invalid?

It is no longer recalculated, and becomes valid again only by re-picking its geometry.`
            : ""
        }
        confirmLabel="Mark Invalid"
        cancelLabel="Cancel"
        variant="warning"
        onConfirm={confirmMarkInvalid}
        onCancel={() => setMarkInvalidConfirmOpen(false)}
      />

      <div className="h-full flex">
        <AdminList
          toolbar={toolbar}
          filters={filterOptions}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder={
            region.hasRouteNames ? "Search by name, from or to..." : "Search by from or to..."
          }
          noun="route"
          total={routes.length}
          items={paged.items}
          filteredCount={filteredRoutes.length}
          currentPage={paged.currentPage}
          totalPages={paged.totalPages}
          onPageChange={paged.setCurrentPage}
          getKey={routeKey}
          selectedKey={selectedRouteId ?? null}
          onItemClick={handleRouteClick}
          renderItem={(route) => (
            <RouteRow
              route={route}
              hasRouteNames={region.hasRouteNames}
              loading={selectedRouteLoading && selectedRouteId === route.track_id}
            />
          )}
          isLoading={listLoading && !selectedRoute}
          emptyText="No routes in this region yet."
        />

        <RouteEditForm
          selectedRoute={selectedRoute}
          editForm={editForm}
          // With no route loaded the form has no buttons, and only that load matters.
          // The list loading keeps them disabled too: a write patched into the list
          // would be overwritten by the older rows it brings.
          isLoading={selectedRoute ? busy || listLoading : selectedRouteLoading}
          busyAction={
            running && running.trackId === selectedRoute?.track_id ? running.action : null
          }
          suggestions={suggestions}
          onEditFormChange={setEditForm}
          onSave={handleSaveRoute}
          onDelete={handleDeleteRoute}
          onDuplicate={handleDuplicateRoute}
          onMarkInvalid={() => setMarkInvalidConfirmOpen(true)}
          onEditGeometry={onEditGeometry}
          onToggleUnderRepair={handleToggleUnderRepair}
          onUnselect={handleUnselect}
        />
      </div>
    </>
  );
}

/**
 * A routes list row. A naming region leads with the line name (and the other lines
 * sharing the route), endpoints beneath; a route still missing its name falls back
 * to the endpoints.
 */
function RouteRow({
  route,
  hasRouteNames,
  loading,
}: {
  route: AdminRouteSummary;
  hasRouteNames: boolean;
  /** The route is selected and its detail is still loading. */
  loading: boolean;
}) {
  return (
    <>
      {hasRouteNames && route.name ? (
        <>
          <div className="font-medium text-sm text-gray-900 truncate">
            {route.name}
            {route.other_names.length > 0 && (
              <span className="font-normal text-gray-500"> + {route.other_names.join(", ")}</span>
            )}
          </div>
          <div className="text-xs text-gray-500 truncate">
            {route.from_station} ⟷ {route.to_station}
          </div>
        </>
      ) : (
        <div className="font-medium text-sm text-gray-900 truncate">
          {route.from_station} ⟷ {route.to_station}
        </div>
      )}
      {loading && <div className="text-xs text-gray-500">Loading…</div>}
    </>
  );
}
