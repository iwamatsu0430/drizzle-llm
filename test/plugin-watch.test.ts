import { describe, expect, it } from "vitest";
import { isWatchedFile } from "../src/plugin";

const cwd = "/project";
const paths = (queries: string | string[], schema = "./src/db/schema.ts") => ({
  paths: { queries, schema },
});

describe("isWatchedFile", () => {
  it("matches query files against glob patterns with nested directories", () => {
    const config = paths("./src/**/*.ts");
    expect(isWatchedFile("/project/src/queries/users.ts", config, cwd)).toBe(true);
    expect(isWatchedFile("/project/src/a/b/c.ts", config, cwd)).toBe(true);
    expect(isWatchedFile("/project/src/a/b/c.js", config, cwd)).toBe(false);
    expect(isWatchedFile("/project/other/c.ts", config, cwd)).toBe(false);
  });

  it("handles patterns with several wildcards and arrays of patterns", () => {
    const config = paths(["src/**/*.query.ts", "lib/*/llm-*.ts"]);
    expect(isWatchedFile("/project/src/x/users.query.ts", config, cwd)).toBe(true);
    expect(isWatchedFile("/project/lib/a/llm-users.ts", config, cwd)).toBe(true);
    expect(isWatchedFile("/project/src/x/users.ts", config, cwd)).toBe(false);
    expect(isWatchedFile("/project/lib/a/b/llm-users.ts", config, cwd)).toBe(false);
  });

  it("matches the schema file itself", () => {
    const config = paths("src/queries/*.ts", "./src/db/schema.ts");
    expect(isWatchedFile("/project/src/db/schema.ts", config, cwd)).toBe(true);
    expect(isWatchedFile("/project/src/db/schema.test.ts", config, cwd)).toBe(false);
  });

  it("matches files inside a schema directory", () => {
    const config = paths("src/queries/*.ts", "./src/schema");
    expect(isWatchedFile("/project/src/schema/users.ts", config, cwd)).toBe(true);
    expect(isWatchedFile("/project/src/schema-old/users.ts", config, cwd)).toBe(false);
    expect(isWatchedFile("/project/src/other.ts", config, cwd)).toBe(false);
  });

  it("supports absolute query patterns", () => {
    const config = paths("/project/src/**/*.ts");
    expect(isWatchedFile("/project/src/q.ts", config, cwd)).toBe(true);
    expect(isWatchedFile("/elsewhere/src/q.ts", config, cwd)).toBe(false);
  });
});
