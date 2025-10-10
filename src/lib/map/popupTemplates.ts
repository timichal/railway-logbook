/**
 * HTML popup templates for map features
 */

/**
 * Generate popup HTML for railway parts
 */
export function getRailwayPartPopup(
  osmId: string | number,
  zoomLevel: number,
  isStartingPart?: boolean,
  isEndingPart?: boolean
): string {
  let roleInfo = '';

  if (isStartingPart) {
    roleInfo = '<div class="mb-2 p-2 bg-green-100 border border-green-300 rounded"><strong class="text-green-800">🟢 STARTING PART</strong><br/><span class="text-sm text-green-700">Selected as route starting point</span></div>';
  } else if (isEndingPart) {
    roleInfo = '<div class="mb-2 p-2 bg-red-100 border border-red-300 rounded"><strong class="text-red-800">🔴 ENDING PART</strong><br/><span class="text-sm text-red-700">Selected as route ending point</span></div>';
  }

  return `
    <div class="railway-popup">
      <h3 class="font-bold text-lg mb-2">Railway Part</h3>
      ${roleInfo}
      <div class="mb-2">
        <strong>OSM ID:</strong> ${osmId}<br/>
        <strong>Zoom Level:</strong> ${zoomLevel}<br/>
        <span class="text-sm text-gray-600">Raw railway segment from OpenStreetMap data</span>
      </div>
    </div>
  `;
}

/**
 * Generate popup HTML for railway routes
 */
export function getRoutePopup(
  name: string,
  trackId: string,
  primaryOperator: string,
  description?: string | null
): string {
  return `
    <div class="route-popup">
      <h3 class="font-bold text-lg mb-2">${name}</h3>
      <div class="mb-2">
        <strong>Track ID:</strong> ${trackId}<br/>
        <strong>Operator:</strong> ${primaryOperator}<br/>
        ${description ? `<strong>Description:</strong> ${description}<br/>` : ''}
        <span class="text-sm text-gray-600">Railway Route</span>
      </div>
    </div>
  `;
}

/**
 * Generate popup HTML for preview route parts
 */
export function getPreviewPartPopup(
  partId: string,
  positionIndex: number,
  totalParts: number
): string {
  return `
    <div class="preview-part-popup">
      <h4 class="font-bold text-md mb-2">🟠 Preview Route Part</h4>
      <div class="mb-2">
        <strong>Part ID:</strong> ${partId}<br/>
        <strong>Position in route:</strong> ${positionIndex + 1} of ${totalParts}<br/>
        <span class="text-sm text-gray-600">This railway part is included in the route</span>
      </div>
    </div>
  `;
}
