import * as localStore from "./localStorage";
import { type JourneyMigrationResult, migrateLocalJourneys } from "./migrationActions";
import { plural } from "./plural";
import type { ToastType } from "./toast/types";

/**
 * Send the journeys stored in this browser to the account just signed into, and
 * clear them once the account has them. Resolves to the toast to show, led by
 * `outcome` ("Signed in", "Account created"), and never rejects: a failed migration
 * leaves the journeys where they were and says so in a warning.
 *
 * A plain module rather than beside `migrateLocalJourneys`: every export of a
 * "use server" file must be an async server function.
 */
export async function migrateLocalJourneysToAccount(
  outcome: string,
): Promise<{ message: string; type: Extract<ToastType, "success" | "warning"> }> {
  try {
    const { journeys, parts } = localStore.exportJourneysData();
    const result = await migrateLocalJourneys(journeys, parts);
    localStore.clearAll();
    return { message: `${outcome}. ${describeJourneyMigration(result)}`, type: "success" };
  } catch (err) {
    console.error("Error migrating journeys:", err);
    return {
      message: `${outcome}, but journey migration failed. Your local journeys are still saved.`,
      type: "warning",
    };
  }
}

function describeJourneyMigration(result: JourneyMigrationResult): string {
  let message: string;
  if (result.journeysMigrated > 0) {
    message = `${plural(result.journeysMigrated, "journey")} and ${plural(result.partsMigrated, "route")} merged.`;
  } else if (result.partsMigrated > 0) {
    // Every journey was already on the account, but not every route on it
    message = `${plural(result.partsMigrated, "route")} added to journeys already on your account.`;
  } else {
    message = "Everything was already on your account; nothing to merge.";
  }

  if (result.missingRoutes > 0) {
    const one = result.missingRoutes === 1;
    message += ` ${plural(result.missingRoutes, "route")} you logged ${one ? "no longer exists and was" : "no longer exist and were"} left out.`;
  }
  return message;
}
