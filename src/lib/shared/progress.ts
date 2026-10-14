/**
 * The progress figures' shapes and rounding. Kept free of the database so the
 * localStorage count in `dataAccess.ts` rounds as the server does
 * (`progressQueries.ts`), and the native app reads the API's answers as these types.
 */

import type { UsageType } from "./constants";

export interface UserProgress {
  totalKm: number;
  completedKm: number;
  percentage: number;
  routePercentage: number;
  totalRoutes: number;
  completedRoutes: number;
}

export interface CountryProgress {
  countryCode: string;
  countryName: string;
  totalKm: number;
  completedKm: number;
}

/** One usage type's share of the region — Japan's JR lines against its non-JR ones. */
export interface UsageProgress {
  usageType: UsageType;
  totalKm: number;
  completedKm: number;
}

export interface ProgressByCountry {
  byCountry: CountryProgress[];
  /**
   * One row per usage type the region counts (`ordinaryUsageTypes`), ridden or not.
   * A single row equal to the total where only Regular counts, as in Europe.
   */
  byUsage: UsageProgress[];
  total: {
    totalKm: number;
    completedKm: number;
  };
}

export const EMPTY_PROGRESS: Readonly<UserProgress> = Object.freeze({
  totalKm: 0,
  completedKm: 0,
  percentage: 0,
  routePercentage: 0,
  totalRoutes: 0,
  completedRoutes: 0,
});

/** Kilometres as every progress figure shows them: one decimal. */
export const round1 = (km: number) => Math.round(km * 10) / 10;

/** The rounded figures, percentages included, from unrounded totals. */
export function toUserProgress(totals: {
  totalKm: number;
  completedKm: number;
  totalRoutes: number;
  completedRoutes: number;
}): UserProgress {
  const { totalKm, completedKm, totalRoutes, completedRoutes } = totals;
  return {
    totalKm: round1(totalKm),
    completedKm: round1(completedKm),
    percentage: totalKm > 0 ? Math.round((completedKm / totalKm) * 100) : 0,
    routePercentage: totalRoutes > 0 ? Math.round((completedRoutes / totalRoutes) * 100) : 0,
    totalRoutes,
    completedRoutes,
  };
}
