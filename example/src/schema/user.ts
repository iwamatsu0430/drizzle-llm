import * as t from "drizzle-orm/sqlite-core";

export const user = t.sqliteTable("user", {
	id: t.text("id", { length: 26 }).primaryKey().notNull(),
	name: t.text("name", { length: 20 }),
	age: t.integer("age").notNull(),
});
