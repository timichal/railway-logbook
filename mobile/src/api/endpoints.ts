/**
 * The endpoints the app calls, one function each.
 *
 * Thin by design: the client owns auth and refresh, so these say only what the
 * path and the shape are. `API.md` is the reference for both.
 *
 * The response types are declared here rather than imported from `@shared/*`,
 * because the shapes they mirror (`UserProgress` and friends) live in the query
 * modules alongside `pg` — server-only code. Only dependency-free modules cross
 * over; see `@shared` in `tsconfig.json`.
 */
import type { RegionId } from "@shared/regions";
import { type AuthResponse, request } from "./client";

export interface ApiUser {
  id: number;
  email: string;
  name?: string;
}

export interface Progress {
  totalKm: number;
  completedKm: number;
  percentage: number;
  routePercentage: number;
  totalRoutes: number;
  completedRoutes: number;
}

export function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", {
    method: "POST",
    body: { email, password },
    auth: false,
  });
}

export function register(input: {
  email: string;
  password: string;
  confirmPassword: string;
  name?: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", { method: "POST", body: input, auth: false });
}

export async function me(): Promise<ApiUser> {
  const { user } = await request<{ user: ApiUser }>("/auth/me");
  return user;
}

export function progress(region: RegionId, countries?: string[]): Promise<Progress> {
  // `countries` absent means no filter; an empty string means "filter everything
  // out", which is a real state and answers zeros. So an empty list must still be
  // sent as an empty value rather than dropped.
  return request<Progress>("/progress", {
    query: { region, countries: countries === undefined ? undefined : countries.join(",") },
  });
}

export async function preferences(): Promise<string[]> {
  const { selectedCountries } = await request<{ selectedCountries: string[] }>("/preferences");
  return selectedCountries;
}

export function savePreferences(selectedCountries: string[]): Promise<void> {
  return request("/preferences", { method: "PUT", body: { selectedCountries } });
}
