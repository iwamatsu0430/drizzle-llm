import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "@/schema";

export type Sqlite = BaseSQLiteDatabase<any, any, typeof schema>;
