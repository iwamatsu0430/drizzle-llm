import type { Sqlite } from "@/types";
import { llm } from "drizzle-llm";

export async function getDashboardMetrics(db: Sqlite): Promise<{
  totalUsers: number;
  totalProducts: number;
  totalSales: number;
  totalRevenue: number;
}> {
  return await db.get<{
    totalUsers: number;
    totalProducts: number;
    totalSales: number;
    totalRevenue: number;
  }>(llm`Get dashboard metrics: count of users, active products, completed sales, and total revenue in a single query`);
}

export async function getCategoryPerformance(db: Sqlite): Promise<Array<{
  categoryId: string;
  categoryName: string;
  productCount: number;
  totalRevenue: number;
  avgProductPrice: number;
}>> {
  return await db.all<{
    categoryId: string;
    categoryName: string;
    productCount: number;
    totalRevenue: number;
    avgProductPrice: number;
  }>(llm`Analyze performance by category showing product count, total revenue, and average product price`);
}

export async function getInventoryAlerts(db: Sqlite): Promise<Array<{
  productId: string;
  productName: string;
  currentStock: number;
  salesLastMonth: number;
  estimatedDaysLeft: number;
}>> {
  return await db.all<{
    productId: string;
    productName: string;
    currentStock: number;
    salesLastMonth: number;
    estimatedDaysLeft: number;
  }>(llm`Generate inventory alerts for products that might run out soon based on current stock and sales velocity from last 30 days`);
}