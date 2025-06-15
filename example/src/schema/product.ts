import * as t from "drizzle-orm/sqlite-core";

export const product = t.sqliteTable("product", {
  id: t.text("id", { length: 26 }).primaryKey().notNull(),
  name: t.text("name", { length: 100 }).notNull(),
  price: t.integer("price").notNull(),
  categoryId: t.text("category_id", { length: 26 }),
  stock: t.integer("stock").default(0).notNull(),
  description: t.text("description"),
  isActive: t.integer("is_active", { mode: "boolean" }).default(true).notNull(),
  createdAt: t.text("created_at").default("CURRENT_TIMESTAMP").notNull(),
});

export const category = t.sqliteTable("category", {
  id: t.text("id", { length: 26 }).primaryKey().notNull(),
  name: t.text("name", { length: 50 }).notNull(),
  parentId: t.text("parent_id", { length: 26 }),
});