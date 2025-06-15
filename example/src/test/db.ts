import * as schema from "@/schema";
import type { Sqlite } from "@/types";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export const TestDb = {
  using: async (fn: (db: Sqlite) => Promise<void>) => {
    return async () => {
      // Create in-memory database
      const sqlite = new Database(":memory:");
      const db = drizzle(sqlite, { schema });

      // Create tables
      db.run(`
        CREATE TABLE IF NOT EXISTS "user" (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL
          age INTEGER NOT NULL
        );
      `);

      // Insert test data
      db.run(`
        INSERT INTO "user" (id, name, age) VALUES
          ('1', 'Alice', 30),
          ('2', 'Bob', 25),
          ('3', 'Charlie', 35);
      `);

      try {
        await fn(db);
      } finally {
        sqlite.close();
      }
    };
  },
};
