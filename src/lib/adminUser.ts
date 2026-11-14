/**
 * Who the admin is: user 1, reserved (`users_id_seq` starts at 2, so only
 * `createAdmin` can make it). Every admin check, on the server and in the UI,
 * goes through here. A plain module with no imports, so client components can
 * read it too.
 *
 * The UI's checks only decide what to show; the server's (`asAdmin`, `adminRead`,
 * the admin page and the admin notes tiles) are what refuse anyone else.
 */

export const ADMIN_USER_ID = 1;

/**
 * Whether `user` is the admin. True narrows away a missing user; false leaves a
 * signed-in one as it was (a guard of plain `U` would narrow it to `never`).
 */
export function isAdmin<U extends { id: number }>(
  user: U | null | undefined,
): user is U & { id: typeof ADMIN_USER_ID } {
  return user?.id === ADMIN_USER_ID;
}
