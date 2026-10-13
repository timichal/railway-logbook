import { readFileSync } from "node:fs";
import { join } from "node:path";
import pool from "../lib/db";

async function applyVectorTilesSql() {
  try {
    // Read the SQL file
    const sqlPath = join(process.cwd(), "database", "init", "02-vector-tiles.sql");
    console.log(`Reading SQL file: ${sqlPath}`);
    const sql = readFileSync(sqlPath, "utf-8");

    console.log("Executing SQL...");
    await pool.query(sql);
    console.log("✓ Vector tiles SQL applied successfully");
  } catch (error) {
    console.error("Error applying vector tiles SQL:", error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the script
applyVectorTilesSql();
