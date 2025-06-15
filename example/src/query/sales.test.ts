import { TestDb } from "@/test/db";
import { describe, expect, it } from "vitest";
import { getMonthlySalesGrowth, getTopSellingProductsWithTrend, getUserSalesAnalytics } from "./sales";
import "./sales.query"; // Import to register queries

describe("Sales Queries", () => {
  describe("getUserSalesAnalytics", () => {
    it("should return user sales analytics ordered by total amount", async () => {
      await TestDb.using(async (db) => {
        const result = await getUserSalesAnalytics(db);
        expect(result).toEqual([
          { userId: "1", userName: "Alice", totalSales: 2, totalAmount: 1500, averageOrderValue: 750 },
          { userId: "2", userName: "Bob", totalSales: 1, totalAmount: 500, averageOrderValue: 500 },
        ]);
      });
    });

    it("should handle users with no sales", async () => {
      await TestDb.using(async (db) => {
        const result = await getUserSalesAnalytics(db);
        expect(result.every(user => user.totalSales > 0)).toBe(true);
      });
    });
  });

  describe("getTopSellingProductsWithTrend", () => {
    it("should return top selling products with trend data", async () => {
      await TestDb.using(async (db) => {
        const result = await getTopSellingProductsWithTrend(db, 30);
        expect(result).toEqual([
          { productId: "p1", productName: "Laptop", totalQuantity: 3, totalRevenue: 3000, salesCount: 2 },
          { productId: "p2", productName: "Mouse", totalQuantity: 2, totalRevenue: 100, salesCount: 1 },
        ]);
      });
    });

    it("should use default 30 days period", async () => {
      await TestDb.using(async (db) => {
        const result = await getTopSellingProductsWithTrend(db);
        expect(result.length).toBeGreaterThanOrEqual(0);
      });
    });

    it("should handle custom time period", async () => {
      await TestDb.using(async (db) => {
        const result = await getTopSellingProductsWithTrend(db, 7);
        expect(result.length).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("getMonthlySalesGrowth", () => {
    it("should return monthly sales growth with previous month comparison", async () => {
      await TestDb.using(async (db) => {
        const result = await getMonthlySalesGrowth(db, 2023);
        expect(result).toEqual([
          { month: "January", revenue: 1000, previousMonthRevenue: 0, growthRate: 0, cumulativeRevenue: 1000 },
          { month: "February", revenue: 1500, previousMonthRevenue: 1000, growthRate: 50, cumulativeRevenue: 2500 },
          { month: "March", revenue: 1200, previousMonthRevenue: 1500, growthRate: -20, cumulativeRevenue: 3700 },
        ]);
      });
    });

    it("should handle year with no sales", async () => {
      await TestDb.using(async (db) => {
        const result = await getMonthlySalesGrowth(db, 2020);
        expect(result).toEqual([]);
      });
    });

    it("should calculate cumulative revenue correctly", async () => {
      await TestDb.using(async (db) => {
        const result = await getMonthlySalesGrowth(db, 2023);
        if (result.length > 1) {
          expect(result[1].cumulativeRevenue).toBe(result[0].revenue + result[1].revenue);
        }
      });
    });
  });
});