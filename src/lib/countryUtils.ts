/**
 * Country detection utilities using @rapideditor/country-coder
 * Provides worldwide country boundary detection from coordinates
 */

import * as countryCoder from '@rapideditor/country-coder';

/**
 * Determines the ISO 3166-1 alpha-2 country code from geographic coordinates
 * @param lng - Longitude in decimal degrees
 * @param lat - Latitude in decimal degrees
 * @returns Two-letter country code (e.g., 'CZ', 'AT', 'SK') or null if not found
 */
export function getCountryFromCoordinates(lng: number, lat: number): string | null {
  try {
    // country-coder uses [longitude, latitude] format
    const feature = countryCoder.feature([lng, lat]);

    if (!feature || !feature.properties) {
      console.warn(`No country found for coordinates: ${lng}, ${lat}`);
      return null;
    }

    // Get ISO 3166-1 alpha-2 code (2-letter country code)
    const countryCode = feature.properties.iso1A2;

    if (!countryCode) {
      console.warn(`Country feature found but no ISO code for coordinates: ${lng}, ${lat}`);
      return null;
    }

    return countryCode;
  } catch (error) {
    console.error(`Error determining country from coordinates ${lng}, ${lat}:`, error);
    return null;
  }
}

/**
 * Extracts the first coordinate from a GeoJSON LineString geometry
 * @param geometry - PostGIS geometry object or GeoJSON geometry
 * @returns [lng, lat] or null if extraction fails
 */
export function getStartCoordinate(geometry: any): [number, number] | null {
  try {
    if (!geometry) return null;

    // Handle GeoJSON format
    if (geometry.type === 'LineString' && geometry.coordinates && geometry.coordinates.length > 0) {
      const [lng, lat] = geometry.coordinates[0];
      return [lng, lat];
    }

    // Handle parsed geometry
    if (Array.isArray(geometry) && geometry.length > 0) {
      const [lng, lat] = geometry[0];
      return [lng, lat];
    }

    console.warn('Unable to extract start coordinate from geometry:', geometry);
    return null;
  } catch (error) {
    console.error('Error extracting start coordinate:', error);
    return null;
  }
}

/**
 * Extracts the last coordinate from a GeoJSON LineString geometry
 * @param geometry - PostGIS geometry object or GeoJSON geometry
 * @returns [lng, lat] or null if extraction fails
 */
export function getEndCoordinate(geometry: any): [number, number] | null {
  try {
    if (!geometry) return null;

    // Handle GeoJSON format
    if (geometry.type === 'LineString' && geometry.coordinates && geometry.coordinates.length > 0) {
      const coords = geometry.coordinates;
      const [lng, lat] = coords[coords.length - 1];
      return [lng, lat];
    }

    // Handle parsed geometry
    if (Array.isArray(geometry) && geometry.length > 0) {
      const [lng, lat] = geometry[geometry.length - 1];
      return [lng, lat];
    }

    console.warn('Unable to extract end coordinate from geometry:', geometry);
    return null;
  } catch (error) {
    console.error('Error extracting end coordinate:', error);
    return null;
  }
}

/**
 * Determines both start and end country codes from a route geometry
 * @param geometry - GeoJSON LineString geometry or coordinate array
 * @returns Object with startCountry and endCountry (2-letter codes or null)
 */
export function getRouteCountries(geometry: any): { startCountry: string | null; endCountry: string | null } {
  const startCoord = getStartCoordinate(geometry);
  const endCoord = getEndCoordinate(geometry);

  const startCountry = startCoord ? getCountryFromCoordinates(startCoord[0], startCoord[1]) : null;
  const endCountry = endCoord ? getCountryFromCoordinates(endCoord[0], endCoord[1]) : null;

  return { startCountry, endCountry };
}

/**
 * Converts a country code to flag emoji using Unicode regional indicators
 * @param countryCode - ISO 3166-1 alpha-2 country code (e.g., "CZ", "IT")
 * @returns Flag emoji (e.g., "🇨🇿", "🇮🇹")
 */
export function getCountryFlag(countryCode: string): string {
  return countryCode
    .toUpperCase()
    .replace(/./g, char => String.fromCodePoint(127397 + char.charCodeAt(0)));
}
