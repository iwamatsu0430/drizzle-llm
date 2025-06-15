import type { Sqlite } from "@/types";
import { llm } from "drizzle-llm";
import type { Product } from "./types";

// Middle: Filtering, ordering, and basic aggregations
export async function findActiveProducts(db: Sqlite): Promise<Product[]> {
  return await db.all<Product>(llm`アクティブな商品を名前順で取得する`);
}

export async function searchByPriceRange(db: Sqlite, minPrice: number, maxPrice: number): Promise<Product[]> {
  return await db.all<Product>(llm`価格が ${minPrice} 円以上 ${maxPrice} 円以下の商品を検索`);
}

export async function findLowStock(db: Sqlite, threshold: number = 10): Promise<Product[]> {
  return await db.all<Product>(llm`在庫が${threshold}個以下のアクティブな商品を在庫の少ない順で表示`);
}

export async function getProductsWithCategories(db: Sqlite): Promise<Array<Product & { categoryName?: string }>> {
  return await db.all<Product & { categoryName?: string }>(
    llm`すべての商品をカテゴリ名と一緒に表示する`
  );
}