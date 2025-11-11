'use client';

import { useState, useRef, useCallback } from 'react';
import type { Station } from '@/lib/types';
import { searchStations } from '@/lib/user-actions';
import { findRoutePathBetweenStations } from '@/lib/route-path-finder';
import { useToast } from '@/lib/toast';

interface RouteNode {
  track_id: number;
  from_station: string;
  to_station: string;
  description: string;
  length_km: number;
}

interface SelectedStation {
  id: string | number;
  name: string;
}

type MaybeStation = SelectedStation | null;

interface MultiRouteLoggerProps {
  onHighlightRoutes?: (routeIds: number[]) => void;
  onClose?: () => void;
  onAddRoutesToSelection?: (routes: RouteNode[]) => void;
}

export default function MultiRouteLogger({ onHighlightRoutes, onClose, onAddRoutesToSelection }: MultiRouteLoggerProps) {
  const { showSuccess } = useToast();
  const [fromStation, setFromStation] = useState<SelectedStation | null>(null);
  const [viaStations, setViaStations] = useState<MaybeStation[]>([]);
  const [toStation, setToStation] = useState<SelectedStation | null>(null);

  const [foundPath, setFoundPath] = useState<RouteNode[]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const [pathError, setPathError] = useState<string | null>(null);
  const [isSearchingPath, setIsSearchingPath] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Station search for each input
  const [activeSearch, setActiveSearch] = useState<'from' | 'to' | number | null>(null); // number for via index
  const [fromSearchQuery, setFromSearchQuery] = useState('');
  const [viaSearchQueries, setViaSearchQueries] = useState<string[]>([]);
  const [toSearchQuery, setToSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Station[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Debounced station search
  const performSearch = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const results = await searchStations(query);
      setSearchResults(results);
    } catch (error) {
      console.error('Error searching stations:', error);
      setSearchResults([]);
    }
  }, []);

  // Handle search input change
  const handleSearchChange = (field: 'from' | 'to' | number, value: string) => {
    if (field === 'from') {
      setFromSearchQuery(value);
      // Clear selection when user edits
      if (value !== fromStation?.name) {
        setFromStation(null);
      }
    } else if (field === 'to') {
      setToSearchQuery(value);
      // Clear selection when user edits
      if (value !== toStation?.name) {
        setToStation(null);
      }
    } else {
      // Via station (field is the index)
      const newQueries = [...viaSearchQueries];
      newQueries[field] = value;
      setViaSearchQueries(newQueries);
      // Clear selection when user edits
      if (value !== viaStations[field]?.name) {
        const newStations = [...viaStations];
        newStations[field] = null; // Mark as unselected but keep the slot
        setViaStations(newStations);
      }
    }

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (value.trim().length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(value);
      }, 300);
    } else {
      setSearchResults([]);
      setSelectedIndex(-1);
    }
  };

  // Handle station selection
  const handleStationSelect = (station: Station) => {
    const selected = { id: station.id, name: station.name };

    if (activeSearch === 'from') {
      setFromStation(selected);
      setFromSearchQuery(station.name);
    } else if (activeSearch === 'to') {
      setToStation(selected);
      setToSearchQuery(station.name);
    } else if (typeof activeSearch === 'number') {
      // Via station
      const newStations = [...viaStations];
      newStations[activeSearch] = selected;
      setViaStations(newStations);
      const newQueries = [...viaSearchQueries];
      newQueries[activeSearch] = station.name;
      setViaSearchQueries(newQueries);
    }

    setSearchResults([]);
    setSelectedIndex(-1);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (searchResults.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => (prev < searchResults.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < searchResults.length) {
          handleStationSelect(searchResults[selectedIndex]);
        }
        break;
      case 'Escape':
        setSearchResults([]);
        setSelectedIndex(-1);
        break;
    }
  };

  // Find path
  const handleFindPath = async () => {
    if (!fromStation || !toStation) {
      setPathError('Please select both from and to stations');
      return;
    }

    // Check if all via stations are filled
    const hasEmptyVia = viaStations.some(s => s === null);
    if (hasEmptyVia) {
      setPathError('Please select all via stations or remove empty ones');
      return;
    }

    setIsSearchingPath(true);
    setPathError(null);
    setFoundPath([]);

    try {
      // Convert station IDs to numbers, filtering out nulls
      const fromId = typeof fromStation.id === 'string' ? parseInt(fromStation.id) : fromStation.id;
      const toId = typeof toStation.id === 'string' ? parseInt(toStation.id) : toStation.id;
      const viaIds = viaStations
        .filter((s): s is SelectedStation => s !== null) // Filter out nulls
        .map(s => typeof s.id === 'string' ? parseInt(s.id) : s.id);

      const result = await findRoutePathBetweenStations(fromId, toId, viaIds);

      if (result.error) {
        setPathError(result.error);
        setFoundPath([]);
        setTotalDistance(0);
        if (onHighlightRoutes) onHighlightRoutes([]);
      } else {
        setFoundPath(result.routes);
        setTotalDistance(result.totalDistance);
        setPathError(null);
        if (onHighlightRoutes) {
          onHighlightRoutes(result.routes.map(r => r.track_id));
        }
      }
    } catch (error) {
      console.error('Error finding path:', error);
      setPathError('An error occurred while finding the path');
      setFoundPath([]);
      setTotalDistance(0);
    } finally {
      setIsSearchingPath(false);
    }
  };

  // Add routes to selection
  const handleAddToSelection = () => {
    if (foundPath.length === 0 || !onAddRoutesToSelection) return;

    onAddRoutesToSelection(foundPath);

    // Reset form after adding to selection
    setFoundPath([]);
    setTotalDistance(0);
    setFromStation(null);
    setToStation(null);
    setViaStations([]);
    if (onHighlightRoutes) onHighlightRoutes([]);

    showSuccess(`${foundPath.length} route${foundPath.length !== 1 ? 's' : ''} added to selection!`);

    // Close the multi-route logger
    if (onClose) {
      onClose();
    }
  };

  // Add new via station
  const addViaStation = () => {
    setViaStations([...viaStations, null]);
    setViaSearchQueries([...viaSearchQueries, '']);
  };

  // Remove via station
  const removeViaStation = (index: number) => {
    setViaStations(viaStations.filter((_, i) => i !== index));
    setViaSearchQueries(viaSearchQueries.filter((_, i) => i !== index));
  };

  // Drag and drop handlers
  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();

    if (draggedIndex === null || draggedIndex === dropIndex) {
      setDraggedIndex(null);
      return;
    }

    // Reorder via stations
    const newViaStations = [...viaStations];
    const [draggedStation] = newViaStations.splice(draggedIndex, 1);
    newViaStations.splice(dropIndex, 0, draggedStation);
    setViaStations(newViaStations);

    // Reorder via search queries
    const newViaQueries = [...viaSearchQueries];
    const [draggedQuery] = newViaQueries.splice(draggedIndex, 1);
    newViaQueries.splice(dropIndex, 0, draggedQuery);
    setViaSearchQueries(newViaQueries);

    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className="absolute top-4 left-4 w-96 bg-white rounded-lg shadow-xl p-4 z-10 max-h-[90vh] overflow-y-auto text-black">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">Find Path</h3>
        {onClose && (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl leading-none"
          >
            ×
          </button>
        )}
      </div>

      {/* From Station */}
      <div className="mb-3">
        <label className="block text-sm font-medium mb-1">From Station</label>
        <div className="relative">
          <input
            type="text"
            value={fromSearchQuery}
            onChange={(e) => handleSearchChange('from', e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setActiveSearch('from');
              if (fromSearchQuery.length >= 2) performSearch(fromSearchQuery);
            }}
            onBlur={() => setTimeout(() => {
              setActiveSearch(null);
              setSearchResults([]);
              setSelectedIndex(-1);
            }, 200)}
            placeholder="Search from station..."
            className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${fromStation ? 'border-blue-300 bg-blue-50' : 'border-gray-300'
              }`}
          />
          {fromStation && (
            <button
              onClick={() => {
                setFromStation(null);
                setFromSearchQuery('');
              }}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
          )}
          {activeSearch === 'from' && searchResults.length > 0 && (
            <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto z-20">
              {searchResults.map((station, index) => (
                <button
                  key={station.id}
                  onClick={() => handleStationSelect(station)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0 ${selectedIndex === index ? 'bg-blue-50' : ''
                    }`}
                >
                  {station.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Via Stations */}
      {viaStations.map((station, viaIndex) => (
        <div
          key={viaIndex}
          className={`mb-3 flex items-center gap-2 ${draggedIndex === viaIndex ? 'opacity-50' : ''}`}
        >
          <div
            draggable
            onDragStart={() => handleDragStart(viaIndex)}
            onDragOver={(e) => handleDragOver(e, viaIndex)}
            onDrop={(e) => handleDrop(e, viaIndex)}
            onDragEnd={handleDragEnd}
            className="cursor-move text-gray-400 text-lg"
          >
            ☰
          </div>
          <div className="relative flex-1">
            <input
              type="text"
              value={viaSearchQueries[viaIndex] || ''}
              onChange={(e) => handleSearchChange(viaIndex, e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => {
                setActiveSearch(viaIndex);
                if ((viaSearchQueries[viaIndex] || '').length >= 2) performSearch(viaSearchQueries[viaIndex] || '');
              }}
              onBlur={() => setTimeout(() => {
                setActiveSearch(null);
                setSearchResults([]);
                setSelectedIndex(-1);
              }, 200)}
              placeholder={`Search via station ${viaIndex + 1}...`}
              className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${station ? 'border-green-300 bg-green-50' : 'border-gray-300'
                }`}
            />
            <button
              onClick={() => removeViaStation(viaIndex)}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
            {activeSearch === viaIndex && searchResults.length > 0 && (
              <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto z-20">
                {searchResults.map((searchStation, index) => (
                  <button
                    key={searchStation.id}
                    onClick={() => handleStationSelect(searchStation)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={`w-full px-3 py-2 text-left text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0 ${selectedIndex === index ? 'bg-blue-50' : ''
                      }`}
                  >
                    {searchStation.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Add Via Station Button */}
      <button
        onClick={addViaStation}
        className="w-full mb-3 px-3 py-2 border-2 border-dashed border-gray-300 rounded text-sm text-gray-600 hover:border-gray-400 hover:text-gray-800"
      >
        + Add via station
      </button>

      {/* To Station */}
      <div className="mb-3">
        <label className="block text-sm font-medium mb-1">To Station</label>
        <div className="relative">
          <input
            type="text"
            value={toSearchQuery}
            onChange={(e) => handleSearchChange('to', e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setActiveSearch('to');
              if (toSearchQuery.length >= 2) performSearch(toSearchQuery);
            }}
            onBlur={() => setTimeout(() => {
              setActiveSearch(null);
              setSearchResults([]);
              setSelectedIndex(-1);
            }, 200)}
            placeholder="Search to station..."
            className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${toStation ? 'border-blue-300 bg-blue-50' : 'border-gray-300'
              }`}
          />
          {toStation && (
            <button
              onClick={() => {
                setToStation(null);
                setToSearchQuery('');
              }}
              className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-gray-700"
            >
              ×
            </button>
          )}
          {activeSearch === 'to' && searchResults.length > 0 && (
            <div className="absolute top-full mt-1 w-full bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-y-auto z-20">
              {searchResults.map((station, index) => (
                <button
                  key={station.id}
                  onClick={() => handleStationSelect(station)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={`w-full px-3 py-2 text-left text-sm hover:bg-blue-50 border-b border-gray-100 last:border-b-0 ${selectedIndex === index ? 'bg-blue-50' : ''
                    }`}
                >
                  {station.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Find Path Button */}
      <button
        onClick={handleFindPath}
        disabled={!fromStation || !toStation || isSearchingPath}
        className={`w-full px-4 py-2 text-white rounded font-medium mb-3 ${!fromStation || !toStation || isSearchingPath
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 cursor-pointer'
          }`}
      >
        {isSearchingPath ? 'Finding path...' : 'Find Path'}
      </button>

      {/* Path Error */}
      {pathError && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {pathError}
        </div>
      )}

      {/* Found Path */}
      {foundPath.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 p-2 bg-green-50 border border-green-200 rounded text-xs">
            <span className="font-medium text-green-800">
              Found {foundPath.length} route{foundPath.length !== 1 ? 's' : ''} ({totalDistance.toFixed(1)} km)
            </span>
          </div>

          <div className="space-y-1 mb-3 max-h-64 overflow-y-auto  bg-gray-50 border border-gray-200 rounded">
            {foundPath.map((route, index) => (
              <div key={route.track_id} className="p-2 text-xs">
                <div className="font-medium">
                  {index + 1}. {route.from_station} ⟷ {route.to_station}
                  <span className="text-gray-600"> {route.length_km.toFixed(1)} km</span>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleAddToSelection}
            className="w-full px-4 py-2 text-white rounded font-medium bg-blue-600 hover:bg-blue-700 cursor-pointer"
          >
            Add Routes to Selection
          </button>
        </div>
      )}
    </div>
  );
}
