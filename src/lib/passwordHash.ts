/**
 * The bcrypt cost, and the dummy hash that has to match it.
 *
 * A module of its own, with no database import, so `createAdmin.ts` can hash at
 * the same cost as registration without pulling in the app's pool. Raise
 * `SALT_ROUNDS` and `ABSENT_USER_HASH` together.
 */

import bcrypt from "bcryptjs";

/** Bcrypt cost. Unchanged from the original inline value. */
export const SALT_ROUNDS = 12;

/**
 * A real hash at `SALT_ROUNDS`, of a password no account has.
 *
 * An unknown email used to return before any bcrypt ran, so a miss answered in
 * a millisecond and a hit took the ~250ms a cost-12 compare takes — which is a
 * remote test for whether an address is registered. Comparing against this
 * makes both paths pay the same, and it is a constant rather than a hash
 * computed at startup so the cost is not also paid on boot.
 */
export const ABSENT_USER_HASH = "$2b$12$prcCwRuupfHvFFvT0nLEN.wp/pis0IEYblQpBUnOW061kZjKRk7H2";

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}
