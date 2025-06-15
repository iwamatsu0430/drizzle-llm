import type { Sqlite } from "@/types";
import { llm } from "drizzle-llm";
import type { User } from "./types";

// Easy: Simple SELECT queries
export async function findById(db: Sqlite, id: string): Promise<User | undefined> {
  return await db.get<User>(llm`ユーザーIDが ${id} のユーザーを取得`);
}

export async function list(db: Sqlite): Promise<User[]> {
  return await db.all<User>(llm`すべてのユーザーを取得する`);
}

export async function findByAge(db: Sqlite, age: number): Promise<User[]> {
  return await db.all<User>(llm`Find users with age ${age}`);
}
