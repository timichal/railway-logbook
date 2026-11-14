import { ValidationError } from "./errors";
import { isRegionId, type RegionId } from "./shared/regions";

/**
 * Refuses a region id that isn't one. A server action's `region: RegionId` is
 * only a type: a client can send any string, and `REGIONS[region]` is then
 * undefined, so `regionContainsSql` would fail with a TypeError (an opaque server
 * error) rather than a refusal. Nothing is interpolated from the string, so this
 * is about the error, not a leak. Every server action taking a region calls it
 * first, inside `asUser` / `asAdmin` where it has one, so the refusal comes back
 * as `{ error }`. The actions without a wrapper (the public reads in
 * `userActions` and `publicMapActions`) throw, and a production build masks a
 * thrown message, so there the client still sees a generic error; what the check
 * buys is that nothing runs first. The HTTP API checks the same in
 * `requireRegion`.
 */
export function assertRegionId(region: unknown): asserts region is RegionId {
  if (!isRegionId(region)) {
    throw new ValidationError("Unknown region");
  }
}
