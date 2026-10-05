import type { JourneyMigrationResult } from "./migrationActions";
import { plural } from "./plural";

/**
 * What a local-journey migration did, for the toast after sign-in or sign-up.
 *
 * A plain module rather than beside `migrateLocalJourneys`: every export of a
 * "use server" file must be an async server function.
 */
export function describeJourneyMigration(result: JourneyMigrationResult): string {
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
