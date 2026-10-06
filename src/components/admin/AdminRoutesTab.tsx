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
import { ConfirmDialog, useToast } from "@/lib/toast";

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
  onRouteDeleted?: () => void;
  onRouteUpdated?: () => void;
  onEditGeometry?: (trackId: number) => void;
  onRouteFocus?: (geometry: string) => void;
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
  onRouteDeleted,
  onRouteUpdated,
  onEditGeometry,
  onRouteFocus,
  availableTags = [],
  onTagsChanged,
}: AdminRoutesTabProps) {
  const region = useRegion();
  const regionId = region.id;
  const { showError, showSuccess } = useToast();

  // State
  const [routes, setRoutes] = useState<AdminRouteSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showInvalidOnly, setShowInvalidOnly] = useState(false);
  const [showUnderRepairOnly, setShowUnderRepairOnly] = useState(false);
  const [showUnintendedBacktrackingOnly, setShowUnintendedBacktrackingOnly] = useState(false);
  const [showWithoutNameOnly, setShowWithoutNameOnly] = useState(false);
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

  // Data loading
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

  // Filtering and pagination
  const filteredRoutes = useMemo(() => {
    let filtered = routes;

    // The two invalid filters split the failing routes between them: "invalid"
    // is the plain worklist, "under repair" the ones parked pending OSM works.
    // Ticking both is how you see every invalid route.
    if (showInvalidOnly || showUnderRepairOnly) {
      filtered = filtered.filter((route) => {
        if (route.is_valid !== false) return false;
        return route.under_repair === true ? showUnderRepairOnly : showInvalidOnly;
      });
    }

    if (showUnintendedBacktrackingOnly) {
      filtered = filtered.filter(
        (route) => route.has_backtracking === true && route.intended_backtracking !== true,
      );
    }

    // Only offered where the region names its lines — the worklist of routes
    // still waiting for a name.
    if (showWithoutNameOnly) {
      filtered = filtered.filter((route) => !route.name?.trim());
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((route) => {
        const fromMatch = route.from_station.toLowerCase().includes(query);
        const toMatch = route.to_station.toLowerCase().includes(query);
        return fromMatch || toMatch;
      });
    }

    return filtered;
  }, [
    routes,
    searchQuery,
    showInvalidOnly,
    showUnderRepairOnly,
    showUnintendedBacktrackingOnly,
    showWithoutNameOnly,
  ]);

  const totalPages = Math.ceil(filteredRoutes.length / itemsPerPage);
  const paginatedRoutes = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredRoutes.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredRoutes, currentPage]);

  const invalidRouteCount = routes.filter(
    (route) => route.is_valid === false && route.under_repair !== true,
  ).length;
  const underRepairCount = routes.filter(
    (route) => route.is_valid === false && route.under_repair === true,
  ).length;
  const unintendedBacktrackingCount = routes.filter(
    (route) => route.has_backtracking === true && route.intended_backtracking !== true,
  ).length;
  const withoutNameCount = routes.filter((route) => !route.name?.trim()).length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the filter states are intentional triggers to reset pagination to page 1 when filtering changes.
  useEffect(() => {
    setCurrentPage(1);
  }, [
    searchQuery,
    showInvalidOnly,
    showUnderRepairOnly,
    showUnintendedBacktrackingOnly,
    showWithoutNameOnly,
  ]);

  // Route selection. The page flies the map to a route picked here once it has
  // loaded; one already loaded has nothing to wait for.
  const handleRouteClick = (trackId: number) => {
    if (selectedRoute?.track_id === trackId) {
      if (selectedRoute.geometry) onRouteFocus?.(selectedRoute.geometry);
      return;
    }
    onRouteSelect?.(trackId, { focus: true });
  };

  // Route actions
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
    onRouteUpdated?.();
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
      if (onRouteUpdated) {
        onRouteUpdated();
      }

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

      if (onRouteSelect) {
        onRouteSelect(null);
      }

      if (onRouteDeleted) {
        onRouteDeleted();
      }

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

      if (onRouteUpdated) {
        onRouteUpdated();
      }

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
          routes={routes}
          paginatedRoutes={paginatedRoutes}
          totalRoutes={routes.length}
          invalidRouteCount={invalidRouteCount}
          underRepairCount={underRepairCount}
          unintendedBacktrackingCount={unintendedBacktrackingCount}
          withoutNameCount={withoutNameCount}
          hasRouteNames={region.hasRouteNames}
          isLoading={isLoading && !selectedRoute}
          selectedRouteId={selectedRouteId}
          selectedRouteLoading={selectedRouteLoading}
          searchQuery={searchQuery}
          showInvalidOnly={showInvalidOnly}
          showUnderRepairOnly={showUnderRepairOnly}
          showUnintendedBacktrackingOnly={showUnintendedBacktrackingOnly}
          showWithoutNameOnly={showWithoutNameOnly}
          currentPage={currentPage}
          totalPages={totalPages}
          filteredCount={filteredRoutes.length}
          onSearchChange={setSearchQuery}
          onInvalidOnlyChange={setShowInvalidOnly}
          onUnderRepairOnlyChange={setShowUnderRepairOnly}
          onUnintendedBacktrackingOnlyChange={setShowUnintendedBacktrackingOnly}
          onWithoutNameOnlyChange={setShowWithoutNameOnly}
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
          onEditGeometry={onEditGeometry || (() => {})}
          onToggleUnderRepair={handleToggleUnderRepair}
          onUnselect={handleUnselect}
        />
      </div>
    </>
  );
}
