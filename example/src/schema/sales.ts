import * as t from "drizzle-orm/sqlite-core";

export const sales = t.sqliteTable("sales", {
  id: t.text("id", { length: 26 }).primaryKey().notNull(),
  userId: t.text("user_id", { length: 26 }).notNull(),
  productId: t.text("product_id", { length: 26 }).notNull(),
  quantity: t.integer("quantity").notNull(),
  unitPrice: t.integer("unit_price").notNull(),
  totalAmount: t.integer("total_amount").notNull(),
  saleDate: t.text("sale_date").default("CURRENT_TIMESTAMP").notNull(),
  status: t.text("status", { enum: ["pending", "completed", "cancelled"] }).default("pending").notNull(),
});

export const salesSummary = t.sqliteTable("sales_summary", {
  id: t.text("id", { length: 26 }).primaryKey().notNull(),
  userId: t.text("user_id", { length: 26 }).notNull(),
  totalSales: t.integer("total_sales").default(0).notNull(),
  totalAmount: t.integer("total_amount").default(0).notNull(),
  lastSaleDate: t.text("last_sale_date"),
});