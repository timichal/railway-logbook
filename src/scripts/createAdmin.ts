#!/usr/bin/env tsx
/**
 * Create the admin account (user id 1), or reset its credentials.
 *
 *   npm run createAdmin -- <email> [name]           # a fresh deployment
 *   npm run createAdmin -- <email> [name] --reset   # replace an existing admin's
 *                                                   # email and password (and name,
 *                                                   # if given), signing out every
 *                                                   # session and app login it had
 *
 * The schema seeds no user: id 1 is reserved (`users_id_seq` starts at 2) and
 * this is the one way to fill it. The password is prompted for, never taken as
 * an argument, so it does not end up in shell history or a process listing.
 */

import dotenv from "dotenv";
import { Pool } from "pg";
import { getDbConfig } from "../lib/dbConfig";
import { hashPassword } from "../lib/passwordHash";

dotenv.config();

const MIN_PASSWORD_LENGTH = 12;
const USAGE = "Usage: npm run createAdmin -- <email> [name] [--reset]";

/**
 * A terminal escape sequence: CSI (arrows, Home, End, Delete — `ESC [ … final`),
 * SS3 (arrows in application mode — `ESC O x`), or a lone Escape. Dropped whole,
 * or the bytes after the ESC would land in the password as ordinary characters.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching ESC is what this is for.
const ESCAPE_SEQUENCE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|O.)?/g;

/**
 * Hidden line input from the terminal, one `read` per line.
 *
 * Lines are queued rather than read one prompt at a time, so pasting both
 * passwords at once answers both prompts instead of losing the second.
 * Backspace deletes, Ctrl+U clears the line, Ctrl+C quits, and every other
 * control character is ignored rather than becoming part of a password that
 * could then never be typed on the login form.
 */
function hiddenLineReader() {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) {
    throw new Error("Run this from an interactive terminal (the password is prompted for).");
  }

  const lines: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let current = "";
  let afterCR = false;

  const onData = (chunk: string) => {
    for (const ch of chunk.replace(ESCAPE_SEQUENCE, "")) {
      const wasCR = afterCR;
      afterCR = ch === "\r";
      if (ch === "\u0003") {
        stdout.write("\n");
        process.exit(130);
      } else if (ch === "\r" || ch === "\n") {
        // A pasted CRLF is one line end, not an empty line after it.
        if (ch === "\n" && wasCR) continue;
        const resolve = waiting.shift();
        if (resolve) {
          stdout.write("\n");
          resolve(current);
        } else {
          lines.push(current);
        }
        current = "";
      } else if (ch === "\u007f" || ch === "\b") {
        current = current.slice(0, -1);
      } else if (ch === "\u0015") {
        current = "";
      } else if (ch >= " ") {
        current += ch;
      }
    }
  };

  stdin.setRawMode(true);
  stdin.setEncoding("utf8");
  stdin.on("data", onData);
  stdin.resume();

  return {
    read(question: string): Promise<string> {
      stdout.write(question);
      const queued = lines.shift();
      if (queued !== undefined) {
        stdout.write("\n");
        return Promise.resolve(queued);
      }
      return new Promise((resolve) => {
        waiting.push(resolve);
      });
    },
    close() {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    },
  };
}

async function createAdmin() {
  const args = process.argv.slice(2);
  const flags = args.filter((arg) => arg.startsWith("-"));
  const positionals = args.filter((arg) => !arg.startsWith("-"));
  const unknownFlags = flags.filter((flag) => flag !== "--reset");
  if (unknownFlags.length > 0 || positionals.length === 0 || positionals.length > 2) {
    if (unknownFlags.length > 0) console.error(`Unknown option: ${unknownFlags.join(" ")}`);
    console.error(USAGE);
    process.exit(1);
  }

  const reset = flags.includes("--reset");
  // Stored as lower(btrim(...)) in SQL, exactly as authQueries.ts folds it, so
  // the admin signs in with the address as typed
  const email = positionals[0].trim();
  const name = positionals[1]?.trim() || null;
  if (!email.includes("@") || /\s/.test(email)) {
    console.error(`Not an email address: "${email}"`);
    process.exit(1);
  }

  const pool = new Pool(getDbConfig());
  // The connection sits idle while the password is typed; if it dies then, the
  // pool reports it here and reconnects for the insert instead of crashing.
  pool.on("error", (error) => {
    console.error("Idle database connection failed:", error.message);
  });

  try {
    const existing = await pool.query("SELECT email FROM users WHERE id = 1");
    if (existing.rows.length > 0 && !reset) {
      console.error(
        `The admin (user 1) already exists as ${existing.rows[0].email}. Pass --reset to replace its email and password.`,
      );
      process.exit(1);
    }

    const reader = hiddenLineReader();
    const password = await reader.read("Admin password: ");
    const repeated = await reader.read("Repeat password: ");
    reader.close();
    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error(`The password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      process.exit(1);
    }
    if (repeated !== password) {
      console.error("The passwords do not match.");
      process.exit(1);
    }

    // password_changed_at on a fresh admin too: a token for user 1 signed with
    // this JWT_SECRET may outlive the database it was issued against.
    await pool.query(
      `INSERT INTO users (id, email, name, password, password_changed_at)
       VALUES (1, lower(btrim($1)), $2, $3, now())
       ON CONFLICT (id) DO UPDATE
         SET email = EXCLUDED.email,
             name = COALESCE(EXCLUDED.name, users.name),
             password = EXCLUDED.password,
             password_changed_at = EXCLUDED.password_changed_at`,
      [email, name, await hashPassword(password)],
    );

    console.log(
      existing.rows.length > 0
        ? `✓ Admin (user 1) reset: ${email}. Every session signed in as it is now signed out.`
        : `✓ Admin (user 1) created: ${email}`,
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      console.error(`${email} is already registered to another account.`);
      process.exit(1);
    }
    throw error;
  } finally {
    await pool.end();
  }
}

createAdmin().catch((error) => {
  console.error("Script error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
