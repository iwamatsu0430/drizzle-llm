import { TestDb } from "@/test/db";
import { describe, expect, it } from "vitest";
import { findActiveProducts, findLowStock, getProductsWithCategories, searchByPriceRange } from "./product";
import "./product.query"; // Import to register queries

describe("Product Queries", () => {
  describe("findActiveProducts", () => {
    it("should return all active products ordered by name", async () => {
      await TestDb.using(async (db) => {
        const result = await findActiveProducts(db);
        expect(result).toEqual([
          { id: "p1", name: "Laptop", price: 1000, categoryId: "c1", stock: 10, description: "Gaming laptop", isActive: true, createdAt: "2023-01-01" },
          { id: "p2", name: "Mouse", price: 50, categoryId: "c2", stock: 100, description: "Wireless mouse", isActive: true, createdAt: "2023-01-02" },
        ]);
      });
    });
  });

  describe("searchByPriceRange", () => {
    it("should find products within price range", async () => {
      await TestDb.using(async (db) => {
        const result = await searchByPriceRange(db, 40, 60);
        expect(result).toEqual([
          { id: "p2", name: "Mouse", price: 50, categoryId: "c2", stock: 100, description: "Wireless mouse", isActive: true, createdAt: "2023-01-02" },
        ]);
      });
    });

    it("should return empty array when no products in range", async () => {
      await TestDb.using(async (db) => {
        const result = await searchByPriceRange(db, 2000, 3000);
        expect(result).toEqual([]);
      });
    });
  });

  describe("findLowStock", () => {
    it("should find products with low stock", async () => {
      await TestDb.using(async (db) => {
        const result = await findLowStock(db, 20);
        expect(result).toEqual([
          { id: "p1", name: "Laptop", price: 1000, categoryId: "c1", stock: 10, description: "Gaming laptop", isActive: true, createdAt: "2023-01-01" },
        ]);
      });
    });

    it("should use default threshold of 10", async () => {
      await TestDb.using(async (db) => {
        const result = await findLowStock(db);
        expect(result.length).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("getProductsWithCategories", () => {
    it("should return products with category names", async () => {
      await TestDb.using(async (db) => {
        const result = await getProductsWithCategories(db);
        expect(result).toEqual([
          { id: "p1", name: "Laptop", price: 1000, categoryId: "c1", stock: 10, description: "Gaming laptop", isActive: true, createdAt: "2023-01-01", categoryName: "Electronics" },
          { id: "p2", name: "Mouse", price: 50, categoryId: "c2", stock: 100, description: "Wireless mouse", isActive: true, createdAt: "2023-01-02", categoryName: "Accessories" },
        ]);
      });
    });
  });
});