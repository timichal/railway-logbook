// Loaded here, ahead of the first read of the environment below, so a script gets
// its .env just by importing the pool: imports are evaluated before the importing
// module's own code, so a `dotenv.config()` call in the script would run too late.
// Next has loaded .env itself by now, and dotenv never overrides a variable already
// set, so in the app this changes nothing.
import "dotenv/config";
import { types } from "pg";

// A DATE (journey dates) is a calendar day, not an instant. pg's default parser
// turns it into a `Date` at the *server's* local midnight, which then serialises
// as the previous day's evening in UTC (`"2026-09-24T22:00:00.000Z"` at UTC+2) and
// is shifted again by whichever timezone reads it. Keep Postgres' own YYYY-MM-DD.
// The parser table is global to `pg`; it is set here because every pool, the
// app's, the tile pool and the scripts' alike, is built from this module.
types.setTypeParser(types.builtins.DATE, (value) => value);

interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** Every pool's connection settings: the app's, the tile pool and the scripts'. */
export const dbConfig: DbConfig = {
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432", 10),
  database: process.env.POSTGRES_DB || "",
  user: process.env.DB_USER || "",
  password: process.env.DB_PASSWORD || "",
};
