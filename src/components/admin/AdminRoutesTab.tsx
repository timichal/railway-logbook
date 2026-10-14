"use client";

import { useEffect, useMemo, useState } from "react";
import RouteEditForm from "@/components/admin/RouteEditForm";
import type { EditRouteData } from "@/components/admin/RouteMetadataFields";
import RoutesList from "@/components/admin/RoutesList";
import { actionErrorMessage, unwrap } from "@/lib/actionResult";
import {
  type AdminRouteDetail,
  type AdminRouteSummary,
  deleteRailwayRoute,
  duplicateRailwayRoute,
  getAllRailwayRoutes,
  setRouteUnderRepair,
  updateRailwayRoute,
} from "@/lib/adminRouteActions";
import { useRegion } from "@/lib/regionContext";
import type { Region } from "@/lib/shared/regions";
import type { RouteBounds } from "@/lib/shared/types";
import { ConfirmDialog, useToast } from "@/lib/toast";
import { compareByEndpoints, compareText } from "@/lib/ui/adminListSort";

type RouteFilterKey = "invalid" | "underRepair" | "unintendedBacktracking" | "withoutName";

interface RouteFilter {
  key: RouteFilterKey;
  label: string;
  predicate: (route: AdminRouteSummary) => boolean;
  /** Ticked filters sharing a group are OR'd; groups are AND'd. Defaults to the key. */
  group?: string;
  /** Offered only in the regions this returns true for. */
  onlyWhen?: (region: Region) => boolean;
}

const ROUTE_FILTERS: RouteFilter[] = [
  // The two invalid filters split the failing routes between them: "invalid" is
  // the plain worklist, "under repair" the ones parked pending OSM works. Ticking
  // both is how you see every invalid route.
  {
    key: "invalid",
    label: "Invalid",
    predicate: (route) => route.is_valid === false && route.under_repair !== true,
    group: "invalid",
  },
  {
    key: "underRepair",
    label: "Under repair",
    predicate: (route) => route.is_valid === false && route.under_repair === true,
    group: "invalid",
  },
  {
    key: "unintendedBacktracking",
    label: "Unintended backtracking",
    predicate: (route) => route.has_backtracking === true && route.intended_backtracking !== true,
  },
  // The worklist of routes still waiting for a name; only regions that name
  // their lines have one to miss.
  {
    key: "withoutName",
    label: "Without name",
    predicate: (route) => !route.name?.trim(),
    onlyWhen: (region) => region.hasRouteNames,
  },
];

function editFormFromRoute(route: AdminRouteDetail): EditRouteData {
  return {
    name: route.name || "",
    from_station: route.from_station,
    to_station: route.to_station,
    description: route.description || "",
    usage_type: route.usage_type,
    frequency: route.frequency,
    link: route.link || "",
    line_class: route.line_class,
    intended_backtracking: route.intended_backtracking,
  };
}

interface AdminRoutesTabProps {
  selectedRouteId?: number | null;
  /** The selected route's detail, loaded by the page. */
  selectedRoute: AdminRouteDetail | null;
  selectedRouteLoading: boolean;
  onSelectedRouteChange: React.Dispatch<React.SetStateAction<AdminRouteDetail | null>>;
  /** Re-reads the selected route after a save; resolves the detail, or null if superseded. */
  onReloadSelectedRoute: () => Promise<AdminRouteDetail | null>;
  /** `focus` flies the map to the route once it has loaded. */
  onRouteSelect?: (routeId: number | null, options?: { focus?: boolean }) => void;
  /** A route was changed or deleted: the map's route tiles are stale. */
  onRoutesChanged: () => void;
  onEditGeometry: (route: AdminRouteDetail) => void;
  onRouteFocus: (bounds: RouteBounds) => void;
  availableTags?: string[];
  onTagsChanged?: () => void;
}

export default function AdminRoutesTab({
  selectedRouteId,
  selectedRoute,
  selectedRouteLoading,
  onSelectedRouteChange,
  onReloadSelectedRoute,
  onRouteSelect,
  onRoutesChanged,
  onEditGeometry,
  onRouteFocus,
  availableTags = [],
  onTagsChanged,
}: AdminRoutesTabProps) {
  const region = useRegion();
  const regionId = region.id;
  const { showError, showSuccess } = useToast();

  const [routes, setRoutes] = useState<AdminRouteSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [checkedFilters, setCheckedFilters] = useState<ReadonlySet<RouteFilterKey>>(new Set());
  const regionFilters = useMemo(
    () => ROUTE_FILTERS.filter((filter) => filter.onlyWhen?.(region) ?? true),
    [region],
  );
  // A region switch goes back to page 1 and unticks the filters the new region
  // doesn't offer, so none is left applying unseen or comes back on return.
  const [filtersRegionId, setFiltersRegionId] = useState(regionId);
  if (filtersRegionId !== regionId) {
    setFiltersRegionId(regionId);
    setCurrentPage(1);
    setCheckedFilters(
      (prev) => new Set(regionFilters.filter((f) => prev.has(f.key)).map((f) => f.key)),
    );
  }
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const itemsPerPage = 100;
  const [editForm, setEditForm] = useState<EditRouteData | null>(null);
  // The form is filled once per route loaded, not on every change to its detail:
  // the under-repair toggle patches the detail in place, and refilling then would
  // throw away edits still in progress.
  const [formRouteId, setFormRouteId] = useState<number | null>(null);
  const loadedRouteId = selectedRoute?.track_id ?? null;
  if (loadedRouteId !== formRouteId) {
    setFormRouteId(loadedRouteId);
    setEditForm(selectedRoute ? editFormFromRoute(selectedRoute) : null);
  }

  const loadRoutes = async () => {
    try {
      setIsLoading(true);
      const routesData = unwrap(await getAllRailwayRoutes(regionId));
      setRoutes(routesData);
    } catch (error) {
      console.error("Error loading routes:", error);
      showError(`Failed to load routes: ${actionErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
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
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((route) => {
        const fromMatch = route.from_station.toLowerCase().includes(query);
        const toMatch = route.to_station.toLowerCase().includes(query);
        const nameMatch = hasRouteNames && !!route.name?.toLowerCase().includes(query);
        return fromMatch || toMatch || nameMatch;
      });
    }

    return filtered;
  }, [orderedRoutes, hasRouteNames, searchQuery, checkedFilters]);

  const totalPages = Math.ceil(filteredRoutes.length / itemsPerPage);
  const paginatedRoutes = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredRoutes.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredRoutes, currentPage]);

  const filterCounts = useMemo(
    () => regionFilters.map((filter) => routes.filter(filter.predicate).length),
    [regionFilters, routes],
  );
  const filterOptions = regionFilters.map((filter, i) => ({
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

  // biome-ignore lint/correctness/useExhaustiveDependencies: the filter states are intentional triggers to reset pagination to page 1 when filtering changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, checkedFilters]);

  // Route selection. The page flies the map to a route picked here once it has
  // loaded; one already loaded has nothing to wait for.
  const handleRouteClick = (trackId: number) => {
    if (selectedRoute?.track_id === trackId) {
      onRouteFocus(selectedRoute.bounds);
      return;
    }
    onRouteSelect?.(trackId, { focus: true });
  };

  const handleSaveRoute = async () => {
    if (!selectedRoute || !editForm) return;
    const trackId = selectedRoute.track_id;

    setIsLoading(true);
    try {
      unwrap(
        await updateRailwayRoute(
          trackId,
          editForm.name.trim() || null,
          editForm.from_station.trim(),
          editForm.to_station.trim(),
          editForm.description || null,
          editForm.usage_type,
          editForm.frequency,
          editForm.link || null,
          editForm.line_class,
          editForm.intended_backtracking,
        ),
      );
    } catch (error) {
      console.error("Error updating route:", error);
      showError(`Failed to update route: ${actionErrorMessage(error)}`);
      setIsLoading(false);
      return;
    }

    // The save stands from here on, whatever happens to the reads below.
    onRoutesChanged();
    // Editing a route may add new tags or drop the last use of an existing one.
    onTagsChanged?.();
    showSuccess("Route updated successfully!");

    // Re-read the route rather than merging the form into it, so the detail shows
    // what the server stored. One after the other, so the list reload's own
    // `setIsLoading(false)` is the last thing to run and the form stays disabled
    // until both are in.
    try {
      // Null when another route was selected meanwhile, which has a detail of its own
      const routeDetail = await onReloadSelectedRoute();
      if (routeDetail) setEditForm(editFormFromRoute(routeDetail));
    } catch (error) {
      console.error("Error reloading route after save:", error);
      showError(`Route saved, but reloading it failed: ${actionErrorMessage(error)}`);
    }
    await loadRoutes();
  };

  const handleToggleUnderRepair = async (underRepair: boolean) => {
    if (!selectedRoute) return;
    const trackId = selectedRoute.track_id;

    try {
      setIsLoading(true);
      unwrap(await setRouteUnderRepair(trackId, underRepair));

      onSelectedRouteChange((prev) =>
        prev?.track_id === trackId ? { ...prev, under_repair: underRepair } : prev,
      );
      await loadRoutes();

      // Repaints the admin map: the flag decides violet vs grey.
      onRoutesChanged();

      showSuccess(
        underRepair ? "Route marked as under repair." : "Route no longer marked as under repair.",
      );
    } catch (error) {
      console.error("Error updating under repair flag:", error);
      showError(`Failed to update under repair flag: ${actionErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteRoute = async () => {
    if (!selectedRoute) return;
    setDeleteConfirmOpen(true);
  };

  const confirmDeleteRoute = async () => {
    if (!selectedRoute) return;
    setDeleteConfirmOpen(false);

    try {
      setIsLoading(true);
      unwrap(await deleteRailwayRoute(selectedRoute.track_id));

      await loadRoutes();

      onRouteSelect?.(null);
      onRoutesChanged();

      // Deleting a route may have removed the last use of a tag.
      onTagsChanged?.();

      showSuccess(
        `Route "${selectedRoute.from_station} ⟷ ${selectedRoute.to_station}" has been deleted successfully.`,
      );
    } catch (error) {
      console.error("Error deleting route:", error);
      showError(`Error deleting route: ${actionErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuplicateRoute = async () => {
    if (!selectedRoute) return;

    try {
      setIsLoading(true);
      const newTrackId = unwrap(await duplicateRailwayRoute(selectedRoute.track_id));

      await loadRoutes();

      // Select the new copy so the admin can immediately edit it.
      onRouteSelect?.(newTrackId);

      onRoutesChanged();

      showSuccess(
        `Route "${selectedRoute.from_station} ⟷ ${selectedRoute.to_station}" duplicated successfully.`,
      );
    } catch (error) {
      console.error("Error duplicating route:", error);
      showError(`Error duplicating route: ${actionErrorMessage(error)}`);
    } finally {
      setIsLoading(false);
    }
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
            ? `Are you sure you want to delete the route "${selectedRoute.from_station} ⟷ ${selectedRoute.to_station}"?\n\nTrack ID: ${selectedRoute.track_id}\n\nThis action cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={confirmDeleteRoute}
        onCancel={() => setDeleteConfirmOpen(false)}
      />

      <div className="h-full flex">
        <RoutesList
          paginatedRoutes={paginatedRoutes}
          totalRoutes={routes.length}
          filters={filterOptions}
          hasRouteNames={region.hasRouteNames}
          isLoading={isLoading && !selectedRoute}
          selectedRouteId={selectedRouteId}
          selectedRouteLoading={selectedRouteLoading}
          searchQuery={searchQuery}
          currentPage={currentPage}
          totalPages={totalPages}
          filteredCount={filteredRoutes.length}
          onSearchChange={setSearchQuery}
          onRouteClick={handleRouteClick}
          onPageChange={setCurrentPage}
        />

        <RouteEditForm
          selectedRoute={selectedRoute}
          editForm={editForm}
          // With no route loaded the form has no buttons, and only that load matters
          isLoading={selectedRoute ? isLoading : selectedRouteLoading}
          availableTags={availableTags}
          onEditFormChange={setEditForm}
          onSave={handleSaveRoute}
          onDelete={handleDeleteRoute}
          onDuplicate={handleDuplicateRoute}
          onEditGeometry={onEditGeometry}
          onToggleUnderRepair={handleToggleUnderRepair}
          onUnselect={handleUnselect}
        />
      </div>
    </>
  );
}
