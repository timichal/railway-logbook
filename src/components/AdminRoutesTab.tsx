'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { getAllRailwayRoutes, getRailwayRoute, updateRailwayRoute } from '@/lib/railway-actions';
import { deleteRailwayRoute } from '@/lib/route-delete-actions';
import RoutesList from './RoutesList';
import RouteEditForm from './RouteEditForm';

interface RailwayRoute {
  track_id: string;
  from_station: string;
  to_station: string;
  track_number?: string | null;
  description: string | null;
  usage_type: string;
  starting_part_id?: string | null;
  ending_part_id?: string | null;
  is_valid?: boolean;
  error_message?: string | null;
}

interface RouteDetail extends RailwayRoute {
  geometry: string;
  length_km?: number;
}

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
  // State
  const [routes, setRoutes] = useState<RailwayRoute[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [showInvalidOnly, setShowInvalidOnly] = useState(false);
  const itemsPerPage = 100;
  const [editForm, setEditForm] = useState<{
    from_station: string;
    to_station: string;
    track_number: string;
    description: string;
    usage_type: string;
  } | null>(null);

  // Data loading
  const loadRoutes = async () => {
    try {
      setIsLoading(true);
      const routesData = await getAllRailwayRoutes();
      setRoutes(routesData);
    } catch (error) {
      // Error loading routes
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
        usage_type: routeDetail.usage_type
      });

      if (onRouteSelect) {
        onRouteSelect(trackId);
      }

      if (onRouteFocus && routeDetail.geometry) {
        onRouteFocus(routeDetail.geometry);
      }
    } catch (error) {
      // Error loading route detail
    } finally {
      setIsLoading(false);
    }
  }, [onRouteSelect, onRouteFocus]);

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
        editForm.usage_type
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
    } catch (error) {
      // Error updating route
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteRoute = async () => {
    if (!selectedRoute) return;

    const confirmDelete = confirm(
      `Are you sure you want to delete the route "${selectedRoute.from_station} ⟷ ${selectedRoute.to_station}"?\n\n` +
      `Track ID: ${selectedRoute.track_id}\n` +
      `This action cannot be undone.`
    );

    if (!confirmDelete) return;

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

      alert(`Route "${selectedRoute.from_station} ⟷ ${selectedRoute.to_station}" has been deleted successfully.`);
    } catch (error) {
      alert(`Error deleting route: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
  );
}
