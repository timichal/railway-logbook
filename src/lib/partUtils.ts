/**
 * Utility functions for railway part ID handling
 * These are client-safe utility functions that don't require server actions
 */

/**
 * Check if a part ID is a compound ID (split part)
 */
export function isCompoundId(id: string): boolean {
  return id.includes('-');
}

/**
 * Parse a compound ID into parent ID and segment number
 */
export function parseCompoundId(id: string): { parentId: string; segmentNumber: number } | null {
  if (!isCompoundId(id)) return null;

  const parts = id.split('-');
  if (parts.length !== 2) return null;

  const parentId = parts[0];
  const segmentNumber = parseInt(parts[1], 10);

  if (isNaN(segmentNumber) || (segmentNumber !== 1 && segmentNumber !== 2)) {
    return null;
  }

  return { parentId, segmentNumber };
}
