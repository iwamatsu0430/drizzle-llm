import { llm } from "drizzle-llm";
import type { Sqlite } from "@/types";
import type { User } from "./types";

export async function findName(db: Sqlite, id: string): Promise<string | undefined> {
  return await db.get<string>(llm`Find the user name by id ${id}`);
}

export async function list(db: Sqlite): Promise<User[]> {
  return await db.all<User>(llm`ユーザーを全件取得する`);
}

export async function getAverageOfAge(db: Sqlite): Promise<number> {
  return await db.get<number>(llm`ユーザーの平均年齢を取得する`).then((value: number) => value ?? -1);
}
