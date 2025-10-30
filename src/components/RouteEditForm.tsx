'use client';

import { usageOptions } from '@/lib/constants';

interface RouteDetail {
  track_id: string;
  from_station: string;
  to_station: string;
  track_number?: string | null;
  description: string | null;
  usage_type: string;
  is_valid?: boolean;
  error_message?: string | null;
  length_km?: number;
}

interface EditFormData {
  from_station: string;
  to_station: string;
  track_number: string;
  description: string;
  usage_type: string;
}

interface RouteEditFormProps {
  selectedRoute: RouteDetail | null;
  editForm: EditFormData | null;
  isLoading: boolean;
  onEditFormChange: (form: EditFormData) => void;
  onSave: () => void;
  onDelete: () => void;
  onEditGeometry: (trackId: string) => void;
  onUnselect: () => void;
}

export default function RouteEditForm({
  selectedRoute,
  editForm,
  isLoading,
  onEditFormChange,
  onSave,
  onDelete,
  onEditGeometry,
  onUnselect
}: RouteEditFormProps) {
  if (!selectedRoute) {
    return (
      <div style={{ width: '250px' }} className="overflow-y-auto flex-shrink-0 p-4 text-center text-gray-500">
        Select a route to edit
      </div>
    );
  }

  if (!editForm) {
    return null;
  }

  return (
    <div style={{ width: '250px' }} className="overflow-y-auto flex-shrink-0">
      <div className="p-4">
        {/* Header */}
        <div className="mb-4 flex justify-between items-center">
          <h4 className="font-semibold text-gray-900">Edit Route</h4>
          <button
            onClick={onUnselect}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md border border-gray-300"
          >
            Unselect
          </button>
        </div>

        <div className="space-y-4">
          {/* Invalid Route Alert */}
          {selectedRoute.is_valid === false && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">
                    Invalid Route
                  </h3>
                  {selectedRoute.error_message && (
                    <div className="mt-2 text-sm text-red-700">
                      <p className="mt-1 font-mono text-xs">{selectedRoute.error_message}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Track Number */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Local route number(s)
            </label>
            <input
              type="text"
              value={editForm.track_number}
              onChange={(e) => onEditFormChange({ ...editForm, track_number: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
              placeholder="e.g., 310, 102"
            />
          </div>

          {/* From Station */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              From *
            </label>
            <input
              type="text"
              value={editForm.from_station}
              onChange={(e) => onEditFormChange({ ...editForm, from_station: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
            />
          </div>

          {/* To Station */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              To *
            </label>
            <input
              type="text"
              value={editForm.to_station}
              onChange={(e) => onEditFormChange({ ...editForm, to_station: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={editForm.description}
              onChange={(e) => onEditFormChange({ ...editForm, description: e.target.value })}
              rows={5}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black"
            />
          </div>

          {/* Usage Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Usage Type *
            </label>
            <select
              value={editForm.usage_type}
              onChange={(e) => onEditFormChange({ ...editForm, usage_type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black bg-white"
            >
              <option value="">Select usage type</option>
              {usageOptions.map((option) => (
                <option key={option.key} value={option.id.toString()}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Action Buttons */}
          <div className="pt-4 border-t border-gray-200 space-y-2">
            <button
              onClick={onSave}
              disabled={isLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
            >
              {isLoading ? 'Saving...' : 'Save Metadata'}
            </button>

            <button
              onClick={() => onEditGeometry(selectedRoute.track_id)}
              disabled={isLoading}
              className="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
            >
              Edit Route Geometry
            </button>

            <button
              onClick={onDelete}
              disabled={isLoading}
              className="w-full bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded-md text-sm cursor-pointer"
            >
              {isLoading ? 'Deleting...' : 'Delete Route'}
            </button>

            <p className="text-xs text-gray-500 text-center">
              Deletion is permanent and cannot be undone
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
