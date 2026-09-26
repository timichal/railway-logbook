/**
 * Rate limiting for the unauthenticated auth endpoints.
 *
 * Checking a password costs a bcrypt at cost 12 — ~250ms of CPU that anyone can
 * spend without an account, on the one process that also serves the map. So
 * login and registration are capped per client, in the two transports alike:
 * the API handlers under `src/app/api/v1/auth` and the web form's server
 * actions in `authActions.ts`. Limiting only the API would be theatre, since a
 * server action is an ordinary POST to the page and reaches the same bcrypt.
 *
 * **Counters live in memory**, because the app is one container talking to one
 * Postgres (`docker-compose.yml`) and a table would put a write on the path of
 * every failed guess. A restart forgets them, which is the honest cost: this
 * raises the price of guessing, it is not an account lockout.
 *
 * **Keyed on the client address alone, never on the email.** An email key is
 * the better fit for credential stuffing, and it also hands anyone a way to
 * lock a named account out by burning its budget on purpose — a real harm
 * traded against an attack (many addresses, one account) that a personal
 * logbook is not the target of. The price of an address key is that everyone
 * behind one address shares a budget, a mobile carrier's NAT included.
 */

import { RateLimitError } from "./errors";

interface Policy {
  /** Attempts allowed per window. */
  readonly limit: number;
  readonly windowMs: number;
  /** Named in the message the caller is shown. */
  readonly what: string;
}

/**
 * Ten sign-ins per five minutes, **successes included**. The limit caps how much
 * bcrypt an address can buy, and a correct password costs exactly as much as a
 * wrong one — refunding successes let anyone with an account run bcrypt without
 * end by logging into it in a loop, and clearing the count on success (as this
 * once did) also let them reset it between guesses at someone else's password.
 * Ten buys ~2.5s of bcrypt per five minutes, and is still far more sign-ins than
 * anyone makes by hand: the web session and the native app's tokens both last.
 */
const LOGIN_POLICY: Policy = { limit: 10, windowMs: 5 * 60_000, what: "sign-in attempts" };

/** Registration is rarer and its cost is a bcrypt *hash*, so the budget is tighter. */
const REGISTER_POLICY: Policy = { limit: 5, windowMs: 60 * 60_000, what: "sign-up attempts" };

interface Counter {
  count: number;
  /** When the window ends, in `Date.now()` terms. */
  resetAt: number;
}

const counters = new Map<string, Counter>();

/**
 * The ceiling on tracked clients. Reaching it means thousands of distinct
 * addresses attempting auth inside one window, i.e. an attack — the map is
 * swept of expired entries first, and only then does a new client evict the
 * counter closest to expiring anyway.
 */
const MAX_TRACKED_CLIENTS = 10_000;

function makeRoom(now: number): void {
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) counters.delete(key);
  }
  if (counters.size < MAX_TRACKED_CLIENTS) return;

  let soonestKey: string | null = null;
  let soonest = Number.POSITIVE_INFINITY;
  for (const [key, counter] of counters) {
    if (counter.resetAt < soonest) {
      soonest = counter.resetAt;
      soonestKey = key;
    }
  }
  if (soonestKey !== null) counters.delete(soonestKey);
}

/** Seconds to wait, or 0 when the attempt is within budget. */
function consume(key: string, policy: Policy): number {
  const now = Date.now();
  const existing = counters.get(key);

  if (!existing || existing.resetAt <= now) {
    if (counters.size >= MAX_TRACKED_CLIENTS) makeRoom(now);
    counters.set(key, { count: 1, resetAt: now + policy.windowMs });
    return 0;
  }

  existing.count += 1;
  // The window is not extended by attempts made over the limit: a client that
  // keeps knocking waits out the window it started, not a fresh one each time.
  if (existing.count <= policy.limit) return 0;
  return Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
}

function describeWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * The client an attempt came from.
 *
 * Production runs behind Caddy (`MOBILE_APP_PLAN.md`), so the address arrives in
 * a header. `X-Forwarded-For` is read from the **right**: with no
 * `trusted_proxies` configured, Caddy replaces the header with the peer it
 * actually accepted the connection from, and a proxy that appends instead still
 * leaves anything a client invented to the left of it, where it is ignored.
 *
 * `X-Real-IP` is deliberately not read. Caddy's `reverse_proxy` never sets it and
 * passes a client's own copy through untouched, so trusting it would let a caller
 * name a fresh address on every request; its safety would rest on a
 * `header_up` line in a Caddyfile that is not in this repo.
 *
 * Without a proxy the header is still there: Next fills it in from the socket's
 * peer address when a request arrives without one (`base-server.js`), so
 * `npm run dev` is keyed on localhost. The `"unknown"` bucket is only a backstop.
 */
function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    const peer = hops[hops.length - 1]?.trim();
    if (peer) return clientBucket(peer);
  }

  return "unknown";
}

/**
 * The budget an address draws on: an IPv4 address is its own, an IPv6 address
 * shares one with the rest of its /64 block.
 *
 * A /64 is the smallest block an ISP hands a subscriber, and every address in it
 * is theirs to send from — keyed on the full address, an IPv6 client could take a
 * fresh budget per request just by rotating the low 64 bits. An IPv4 address
 * written in IPv6 form (`::ffff:1.2.3.4`, as Node reports an IPv4 peer on a
 * dual-stack socket) is keyed as the IPv4 address it is. Anything that does not
 * parse is keyed verbatim.
 */
function clientBucket(address: string): string {
  // A zone index (`fe80::1%eth0`) names an interface, not a host.
  const bare = address.split("%")[0].toLowerCase();
  if (!bare.includes(":")) return bare;

  const embeddedIpv4 = bare.lastIndexOf(":");
  if (bare.includes(".", embeddedIpv4)) return bare.slice(embeddedIpv4 + 1);

  const halves = bare.split("::");
  if (halves.length > 2) return bare;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return bare;

  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return bare;
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(":")}::/64`;
}

function enforce(headers: Headers, prefix: string, policy: Policy): void {
  const waitSeconds = consume(`${prefix}:${clientAddress(headers)}`, policy);
  if (waitSeconds > 0) {
    throw new RateLimitError(
      waitSeconds,
      `Too many ${policy.what}. Please try again in ${describeWait(waitSeconds)}.`,
    );
  }
}

/** Charge a sign-in attempt to its client, or throw a `RateLimitError`. */
export function enforceLoginRateLimit(headers: Headers): void {
  enforce(headers, "login", LOGIN_POLICY);
}

/** Charge a registration attempt to its client, or throw a `RateLimitError`. */
export function enforceRegisterRateLimit(headers: Headers): void {
  enforce(headers, "register", REGISTER_POLICY);
}
