import type { Sqlite } from "@/types";
import { llm } from "drizzle-llm";
import type { SalesReport, ProductSalesReport } from "./types";

// Hard: Complex JOINs, aggregations, window functions, and analytics
export async function getUserSalesAnalytics(db: Sqlite): Promise<SalesReport[]> {
  return await db.all<SalesReport>(
    llm`ユーザー別の売上分析（総売上件数、総売上金額、平均注文金額）をユーザー名と共に売上金額降順で取得`
  );
}

export async function getTopSellingProductsWithTrend(db: Sqlite, days: number = 30): Promise<ProductSalesReport[]> {
  return await db.all<ProductSalesReport>(
    llm`過去${days}日間で最も売れた商品を、売上数量・売上金額・売上回数と前期比成長率と一緒に表示`
  );
}

export async function getMonthlySalesGrowth(db: Sqlite, year: number): Promise<Array<{
  month: string;
  revenue: number;
  previousMonthRevenue: number;
  growthRate: number;
  cumulativeRevenue: number;
}>> {
  return await db.all<{
    month: string;
    revenue: number;
    previousMonthRevenue: number;
    growthRate: number;
    cumulativeRevenue: number;
  }>(llm`${year}年の月別売上を取得し、前月比の成長率と年累計売上も一緒に表示`);
}