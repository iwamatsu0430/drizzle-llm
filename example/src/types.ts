import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type * as schema from "./schema";

export type Sqlite = BaseSQLiteDatabase<"async", Record<string, never>, typeof schema>;
