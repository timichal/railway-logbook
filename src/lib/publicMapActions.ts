"use server";

/**
 * Public map sharing.
 *
 * A user can publish their map read-only at `/shared/<token>`: the same routes,
 * coloured by what they have ridden, with no sidebar and nothing to click.
 * Two columns on `user_preferences` carry it — `public_map_enabled` (off by
 * default) and `public_map_token`.
 *
 * The token and the switch are deliberately separate. The token is minted once
 * and kept, so a link already copied or bookmarked keeps working across
 * enable/disable cycles; the switch is the only thing that grants access, and
 * every read below joins on `public_map_enabled = TRUE`. Turning sharing off
 * therefore breaks the link immediately without invalidating it.
 */

import { randomBytes } from "node:crypto";
import { getUser } from "./authActions";
import { SUPPORTED_COUNTRIES } from "./constants";
import { query } from "./db";
import {
  coveredStretchesForUser,
  type ProgressByCountry,
  progressByCountryForUser,
  progressForUser,
  type UserProgress,
} from "./progressQueries";
import type { RegionId } from "./regions";
import type { CoveredStretch } from "./types";

export interface PublicMapSettings {
  enabled: boolean;
  /** URL slug for /shared/<token>. Stable once minted. */
  token: string;
}

/** The owner of a shared map, as resolved from a token. */
export interface PublicMapOwner {
  userId: number;
  /** Display name, falling back to the part of the email before the @. */
  displayName: string;
  /** The owner's country filter — the public view is shown exactly as they see it. */
  selectedCountries: string[];
}

/** 16 bytes of base64url: unguessable, and short enough to paste into a chat. */
function mintToken(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * The current user's sharing settings, minting the token on first read.
 *
 * A token is created even while sharing is off, so enabling it is a single
 * write and the link shown in the dialog is the same one every time.
 */
export async function getPublicMapSettings(): Promise<PublicMapSettings> {
  const user = await getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }

  // One statement for the three cases: no preferences row yet, a row without a
  // token, and a row that already has one (left untouched by the DO UPDATE).
  const result = await query(
    `INSERT INTO user_preferences (user_id, public_map_token, selected_countries)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET public_map_token = COALESCE(user_preferences.public_map_token, EXCLUDED.public_map_token)
     RETURNING public_map_enabled, public_map_token`,
    // The country list is only used when this call is what creates the row;
    // getUserPreferences() writes the same default, and never relies on the
    // column's SQL default either.
    [user.id, mintToken(), SUPPORTED_COUNTRIES.map((country) => country.code)],
  );

  const row = result.rows[0];
  return { enabled: row.public_map_enabled, token: row.public_map_token };
}

/** Turn public sharing on or off for the current user. */
export async function setPublicMapEnabled(enabled: boolean): Promise<PublicMapSettings> {
  const user = await getUser();
  if (!user) {
    throw new Error("User not authenticated");
  }

  // Enabling needs a token, and a row may not exist yet, so this goes through
  // the same upsert — the token it mints is only used if there isn't one.
  const settings = await getPublicMapSettings();
  await query(
    `UPDATE user_preferences SET public_map_enabled = $2, updated_at = NOW() WHERE user_id = $1`,
    [user.id, enabled],
  );

  return { ...settings, enabled };
}

/**
 * The owner of a shared map, or null if the token is unknown or sharing is off.
 *
 * Every other public action goes through this, so "sharing switched off" is
 * checked in exactly one place.
 */
export async function getPublicMapOwner(token: string): Promise<PublicMapOwner | null> {
  if (!token || token.length > 64) return null;

  const result = await query(
    `SELECT up.user_id, up.selected_countries, u.name, u.email
     FROM user_preferences up
     JOIN users u ON u.id = up.user_id
     WHERE up.public_map_token = $1 AND up.public_map_enabled = TRUE`,
    [token],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    userId: row.user_id,
    displayName: row.name || String(row.email).split("@")[0],
    selectedCountries: row.selected_countries,
  };
}

/** Progress figures for a shared map. Empty-ish zeros if the link is dead. */
export async function getPublicProgress(
  token: string,
  region: RegionId,
  selectedCountries?: string[],
): Promise<UserProgress> {
  const owner = await getPublicMapOwner(token);
  if (!owner) {
    return {
      totalKm: 0,
      completedKm: 0,
      percentage: 0,
      routePercentage: 0,
      totalRoutes: 0,
      completedRoutes: 0,
    };
  }

  return progressForUser(owner.userId, region, selectedCountries);
}

/** Per-country progress for a shared map. */
export async function getPublicProgressByCountry(
  token: string,
  region: RegionId,
): Promise<ProgressByCountry> {
  const owner = await getPublicMapOwner(token);
  if (!owner) {
    return { byCountry: [], total: { totalKm: 0, completedKm: 0 } };
  }

  return progressByCountryForUser(owner.userId, region);
}

/** Ridden stretches of unfinished routes, for the shared map's overlay. */
export async function getPublicCoveredStretches(token: string): Promise<CoveredStretch[]> {
  const owner = await getPublicMapOwner(token);
  if (!owner) return [];

  return coveredStretchesForUser(owner.userId);
}
