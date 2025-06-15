import { TestDb } from "@/test/db";
import { describe, expect, it } from "vitest";
import { findById, findByAge, list } from "./user";
import "./user.query"; // Import to register queries

describe("User Queries", () => {
  describe("findById", () => {
    it("should find user by id", async () => {
      await TestDb.using(async (db) => {
        const result = await findById(db, "1");
        expect(result).toEqual({ id: "1", name: "Alice", age: 30 });
      });
    });

    it("should return undefined for non-existent id", async () => {
      await TestDb.using(async (db) => {
        const result = await findById(db, "999");
        expect(result).toBeUndefined();
      });
    });
  });

  describe("list", () => {
    it("should return all users", async () => {
      await TestDb.using(async (db) => {
        const result = await list(db);
        expect(result).toEqual([
          { id: "1", name: "Alice", age: 30 },
          { id: "2", name: "Bob", age: 25 },
          { id: "3", name: "Charlie", age: 35 },
        ]);
      });
    });
  });

  describe("findByAge", () => {
    it("should find users with specific age", async () => {
      await TestDb.using(async (db) => {
        const result = await findByAge(db, 30);
        expect(result).toEqual([
          { id: "1", name: "Alice", age: 30 },
        ]);
      });
    });

    it("should return empty array for non-existent age", async () => {
      await TestDb.using(async (db) => {
        const result = await findByAge(db, 99);
        expect(result).toEqual([]);
      });
    });
  });
});
