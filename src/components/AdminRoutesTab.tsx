'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getAllRailwayRoutes, getRailwayRoute, updateRailwayRoute, deleteRailwayRoute } from '@/lib/admin-route-actions';
import RoutesList from './RoutesList';
import RouteEditForm from './RouteEditForm';
import { useToast, ConfirmDialog } from '@/lib/toast';
import type { RailwayRoute } from '@/lib/types';
import type { UsageType } from '@/lib/constants';

interface AdminRoutesTabProps {
  selectedRouteId?: string | null;
  onRouteSelect?: (routeId: string) => void;
  onRouteDeleted?: () => void;
  onRouteUpdated?: () => void;
  onEditGeometry?: (trackId: string) => void;
  onRouteFocus?: (geometry: string) => void;
}

export default function AdminRoutesTab({
  selectedRouteId,
  onRouteSelect,
  onRouteDeleted,
  onRouteUpdated,
  onEditGeometry,
  onRouteFocus
}: AdminRoutesTabProps) {
  const { showError, showSuccess } = useToast();

  // State
  const [routes, setRoutes] = useState<RailwayRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RailwayRoute | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showInvalidOnly, setShowInvalidOnly] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const itemsPerPage = 100;
  const [editForm, setEditForm] = useState<{
    from_station: string;
    to_station: string;
    track_number: string;
    description: string;
    usage_type: UsageType;
    frequency: string[];
    link: string;
  } | null>(null);

  // Data loading
  const loadRoutes = async () => {
    try {
      setIsLoading(true);
      const routesData = await getAllRailwayRoutes();
      setRoutes(routesData);
    } catch (error) {
      console.error('Error loading routes:', error);
      showError(`Failed to load routes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadRoutes();
  }, []);

  // Filtering and pagination
  const filteredRoutes = useMemo(() => {
    let filtered = routes;

    if (showInvalidOnly) {
      filtered = filtered.filter(route => route.is_valid === false);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((route) => {
        const trackIdMatch = route.track_number?.toLowerCase().includes(query);
        const fromMatch = route.from_station.toLowerCase().includes(query);
        const toMatch = route.to_station.toLowerCase().includes(query);
        return trackIdMatch || fromMatch || toMatch;
      });
    }

    return filtered;
  }, [routes, searchQuery, showInvalidOnly]);

  const totalPages = Math.ceil(filteredRoutes.length / itemsPerPage);
  const paginatedRoutes = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredRoutes.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredRoutes, currentPage]);

  const invalidRouteCount = routes.filter(route => route.is_valid === false).length;

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, showInvalidOnly]);

  // Route selection
  const handleRouteClick = useCallback(async (trackId: string) => {
    try {
      setIsLoading(true);
      const routeDetail = await getRailwayRoute(trackId);
      setSelectedRoute(routeDetail);
      setEditForm({
        from_station: routeDetail.from_station,
        to_station: routeDetail.to_station,
        track_number: routeDetail.track_number || '',
        description: routeDetail.description || '',
        usage_type: routeDetail.usage_type,
        frequency: routeDetail.frequency || [],
        link: routeDetail.link || ''
      });

      if (onRouteSelect) {
        onRouteSelect(trackId);
      }

      if (onRouteFocus && routeDetail.geometry) {
        onRouteFocus(routeDetail.geometry);
      }
    } catch (error) {
      console.error('Error loading route detail:', error);
      showError(`Failed to load route details: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  }, [onRouteSelect, onRouteFocus, showError]);

  useEffect(() => {
    if (selectedRouteId && selectedRouteId !== selectedRoute?.track_id) {
      handleRouteClick(selectedRouteId);
    } else if (!selectedRouteId) {
      setSelectedRoute(null);
      setEditForm(null);
    }
  }, [selectedRouteId, selectedRoute?.track_id, handleRouteClick]);

  // Route actions
  const handleSaveRoute = async () => {
    if (!selectedRoute || !editForm) return;

    try {
      setIsLoading(true);
      await updateRailwayRoute(
        selectedRoute.track_id,
        editForm.from_station,
        editForm.to_station,
        editForm.track_number || null,
        editForm.description || null,
        editForm.usage_type,
        editForm.frequency,
        editForm.link || null
      );

      await loadRoutes();

      setSelectedRoute({
        ...selectedRoute,
        ...editForm,
        track_number: editForm.track_number || null,
        description: editForm.description || null
      });

      if (onRouteUpdated) {
        onRouteUpdated();
      }

      showSuccess('Route updated successfully!');
    } catch (error) {
      console.error('Error updating route:', error);
      showError(`Failed to update route: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
        onRouteSelect('');
      }

      if (onRouteDeleted) {
        onRouteDeleted();
      }

      showSuccess(`Route "${selectedRoute.from_station} ⟷ ${selectedRoute.to_station}" has been deleted successfully.`);
    } catch (error) {
      console.error('Error deleting route:', error);
      showError(`Error deleting route: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnselect = () => {
    setSelectedRoute(null);
    setEditForm(null);
    if (onRouteSelect) {
      onRouteSelect('');
    }
  };

  return (
    <>
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title="Delete Railway Route"
        message={selectedRoute ?
          `Are you sure you want to delete the route "${selectedRoute.from_station} ⟷ ${selectedRoute.to_station}"?\n\nTrack ID: ${selectedRoute.track_id}\n\nThis action cannot be undone.`
          : ''
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
        isLoading={isLoading && !selectedRoute}
        selectedRouteId={selectedRouteId}
        searchQuery={searchQuery}
        showInvalidOnly={showInvalidOnly}
        currentPage={currentPage}
        totalPages={totalPages}
        filteredCount={filteredRoutes.length}
        onSearchChange={setSearchQuery}
        onInvalidOnlyChange={setShowInvalidOnly}
        onRouteClick={handleRouteClick}
        onPageChange={setCurrentPage}
      />

      <RouteEditForm
        selectedRoute={selectedRoute}
        editForm={editForm}
        isLoading={isLoading}
        onEditFormChange={setEditForm}
        onSave={handleSaveRoute}
        onDelete={handleDeleteRoute}
        onEditGeometry={onEditGeometry || (() => {})}
        onUnselect={handleUnselect}
      />
      </div>
    </>
  );
}
