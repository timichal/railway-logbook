"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RouteEditForm from "@/components/admin/RouteEditForm";
import RoutesList from "@/components/admin/RoutesList";
import {
  deleteRailwayRoute,
  duplicateRailwayRoute,
  getAllRailwayRoutes,
  getRailwayRoute,
  setRouteUnderRepair,
  updateRailwayRoute,
} from "@/lib/adminRouteActions";
import { useRegion } from "@/lib/regionContext";
import type { LineClass, UsageType } from "@/lib/shared/constants";
import type { RailwayRoute } from "@/lib/shared/types";
import { ConfirmDialog, useToast } from "@/lib/toast";

interface EditForm {
  name: string;
  from_station: string;
  to_station: string;
  description: string;
  usage_type: UsageType;
  frequency: string[];
  link: string;
  scenic: boolean;
  line_class: LineClass;
  intended_backtracking: boolean;
}

function editFormFromRoute(route: RailwayRoute): EditForm {
  return {
    name: route.name || "",
    from_station: route.from_station,
    to_station: route.to_station,
    description: route.description || "",
    usage_type: route.usage_type,
    frequency: route.frequency || [],
    link: route.link || "",
    scenic: route.scenic || false,
    line_class: route.line_class || "branch",
    intended_backtracking: route.intended_backtracking || false,
  };
}

interface AdminRoutesTabProps {
  selectedRouteId?: number | null;
  onRouteSelect?: (routeId: number | null) => void;
  onRouteDeleted?: () => void;
  onRouteUpdated?: () => void;
  onEditGeometry?: (trackId: number) => void;
  onRouteFocus?: (geometry: string) => void;
  availableTags?: string[];
  onTagsChanged?: () => void;
}

export default function AdminRoutesTab({
  selectedRouteId,
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
  const [routes, setRoutes] = useState<RailwayRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RailwayRoute | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [showInvalidOnly, setShowInvalidOnly] = useState(false);
  const [showUnderRepairOnly, setShowUnderRepairOnly] = useState(false);
  const [showUnintendedBacktrackingOnly, setShowUnintendedBacktrackingOnly] = useState(false);
  const [showWithoutNameOnly, setShowWithoutNameOnly] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const itemsPerPage = 100;
  const [editForm, setEditForm] = useState<EditForm | null>(null);

  // Data loading
  const loadRoutes = async () => {
    try {
      setIsLoading(true);
      const routesData = await getAllRailwayRoutes(regionId);
      setRoutes(routesData);
    } catch (error) {
      console.error("Error loading routes:", error);
      showError(
        `Failed to load routes: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
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

  // Route selection. Only the latest click may apply: click A then B, and A's
  // detail landing last would otherwise select A and fly the map there.
  const routeRequestRef = useRef(0);
  const handleRouteClick = useCallback(
    async (trackId: number, { skipFocus = false } = {}) => {
      const requestId = ++routeRequestRef.current;
      try {
        setIsLoading(true);
        const routeDetail = await getRailwayRoute(trackId);
        if (requestId !== routeRequestRef.current) return;
        setSelectedRoute(routeDetail);
        setEditForm(editFormFromRoute(routeDetail));

        if (onRouteSelect) {
          onRouteSelect(trackId);
        }

        if (!skipFocus && onRouteFocus && routeDetail.geometry) {
          onRouteFocus(routeDetail.geometry);
        }
      } catch (error) {
        if (requestId !== routeRequestRef.current) return;
        console.error("Error loading route detail:", error);
        showError(
          `Failed to load route details: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      } finally {
        if (requestId === routeRequestRef.current) setIsLoading(false);
      }
    },
    [onRouteSelect, onRouteFocus, showError],
  );

  // Clearing the selection counts as a newer request too, or a detail still in
  // flight lands afterwards and selects its route again
  const cancelRouteLoad = () => {
    routeRequestRef.current++;
    setIsLoading(false);
  };

  // Only a transition to "nothing selected" cancels: the effect below also runs
  // with no selection whenever `handleRouteClick` changes identity, which must
  // not cancel a list click still loading
  const prevSelectedRouteIdRef = useRef(selectedRouteId);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cancelRouteLoad only touches a ref and a state setter; it is redefined every render and must not re-run this.
  useEffect(() => {
    // Only (re)load when the externally-selected id differs from the loaded route.
    // Both are numbers (the DB track_id and String→Number(feature.id) from the map),
    // so a plain compare is reliable and won't re-fetch and clobber in-progress edits.
    if (selectedRouteId && selectedRouteId !== selectedRoute?.track_id) {
      handleRouteClick(selectedRouteId, { skipFocus: true });
    } else if (!selectedRouteId) {
      if (prevSelectedRouteIdRef.current) cancelRouteLoad();
      setSelectedRoute(null);
      setEditForm(null);
    }
    prevSelectedRouteIdRef.current = selectedRouteId;
  }, [selectedRouteId, selectedRoute?.track_id, handleRouteClick]);

  // Route actions
  const handleSaveRoute = async () => {
    if (!selectedRoute || !editForm) return;
    const trackId = selectedRoute.track_id;

    setIsLoading(true);
    try {
      await updateRailwayRoute(
        trackId,
        editForm.name.trim() || null,
        editForm.from_station.trim(),
        editForm.to_station.trim(),
        editForm.description || null,
        editForm.usage_type,
        editForm.frequency,
        editForm.link || null,
        editForm.scenic,
        editForm.line_class,
        editForm.intended_backtracking,
      );
    } catch (error) {
      console.error("Error updating route:", error);
      showError(
        `Failed to update route: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      setIsLoading(false);
      return;
    }

    // The save stands from here on, whatever happens to the reads below.
    onRouteUpdated?.();
    // Editing a route may add new tags or drop the last use of an existing one.
    onTagsChanged?.();
    showSuccess("Route updated successfully!");

    // Re-read the route rather than merging the form into it: the save also marks
    // it valid and clears its error and under-repair flag, and a merge would leave
    // the Invalid Route banner (and its toggle, which the server now refuses) on
    // screen. One after the other, so the list reload's own `setIsLoading(false)`
    // is the last thing to run and the form stays disabled until both are in.
    try {
      const routeDetail = await getRailwayRoute(trackId);
      setSelectedRoute(routeDetail);
      setEditForm(editFormFromRoute(routeDetail));
    } catch (error) {
      console.error("Error reloading route after save:", error);
      showError(
        `Route saved, but reloading it failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
    await loadRoutes();
  };

  const handleToggleUnderRepair = async (underRepair: boolean) => {
    if (!selectedRoute) return;

    try {
      setIsLoading(true);
      await setRouteUnderRepair(selectedRoute.track_id, underRepair);

      setSelectedRoute({ ...selectedRoute, under_repair: underRepair });
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
      showError(
        `Failed to update under repair flag: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
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
      await deleteRailwayRoute(selectedRoute.track_id);

      await loadRoutes();

      setSelectedRoute(null);
      setEditForm(null);

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
      showError(
        `Error deleting route: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuplicateRoute = async () => {
    if (!selectedRoute) return;

    try {
      setIsLoading(true);
      const newTrackId = await duplicateRailwayRoute(selectedRoute.track_id);

      await loadRoutes();

      // Select the new copy so the admin can immediately edit it.
      await handleRouteClick(newTrackId, { skipFocus: true });

      if (onRouteUpdated) {
        onRouteUpdated();
      }

      showSuccess(
        `Route "${selectedRoute.from_station} ⟷ ${selectedRoute.to_station}" duplicated successfully.`,
      );
    } catch (error) {
      console.error("Error duplicating route:", error);
      showError(
        `Error duplicating route: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnselect = () => {
    cancelRouteLoad();
    setSelectedRoute(null);
    setEditForm(null);
    if (onRouteSelect) {
      onRouteSelect(null);
    }
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
          isLoading={isLoading}
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
