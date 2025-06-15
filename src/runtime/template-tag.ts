/**
 * Template tag function for defining LLM queries
 *
 * This module provides the `llm` template tag that allows developers to write
 * natural language queries that get compiled to SQL at build time.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
// Import SQL types directly from drizzle-orm instead of deleted drizzle-types.js
import type { SQL, SQLWrapper } from "drizzle-orm";
import { generateRuntimeQueryId } from "../utils/hash.js";

/**
 * Interface for generated query metadata
 */
export interface GeneratedQueryConfig {
  parameters: string[];
  sql?: string; // For backward compatibility - will be removed
}

/**
 * Interface for a generated query that can be executed
 */
export interface GeneratedQuery<_T = unknown> {
  readonly sql: string;
  readonly params: string[];
  readonly intent: string;
  readonly _brand: "GeneratedQuery";
  toSQL(): SQL;
}

/**
 * Cache for loaded SQL files to avoid repeated file reads
 */
const sqlFileCache = new Map<string, string>();

/**
 * Load SQL from .sql file by query ID
 */
function loadSqlFromFile(queryId: string): string {
  if (sqlFileCache.has(queryId)) {
    return sqlFileCache.get(queryId)!;
  }

  // Find SQL files in common locations
  const commonPaths = ["./src/query/user.sql", "./query/user.sql", "./user.sql"];

  let sqlFilePath: string | null = null;
  let content = "";

  // Try to find and read the SQL file
  for (const path of commonPaths) {
    try {
      content = readFileSync(resolve(process.cwd(), path), "utf8");
      sqlFilePath = path;
      break;
    } catch {
      // Continue to next path
    }
  }

  if (!sqlFilePath) {
    throw new Error(
      `Could not find SQL file for query ${queryId}. Searched: ${commonPaths.join(", ")}`
    );
  }

  // Parse SQL file and find the query by ID (hash)
  const lines = content.split("\n");
  let currentHash = "";
  let sqlLines: string[] = [];
  let foundQuery = false;

  for (const line of lines) {
    if (line.startsWith("-- ") && line.length > 10 && !line.startsWith("-- ユーザー")) {
      // Save previous query if we found a match
      if (foundQuery && currentHash === queryId) {
        const sql = sqlLines.join("\n").trim();
        sqlFileCache.set(queryId, sql);
        return sql;
      }

      // Start new query
      currentHash = line.substring(3).trim();
      sqlLines = [];
      foundQuery = currentHash === queryId;
    } else if (foundQuery && !line.startsWith("--")) {
      sqlLines.push(line);
    }
  }

  // Check the last query
  if (foundQuery && currentHash === queryId) {
    const sql = sqlLines.join("\n").trim();
    sqlFileCache.set(queryId, sql);
    return sql;
  }

  throw new Error(`SQL query with ID ${queryId} not found in ${sqlFilePath}`);
}

/**
 * Placeholder implementation that throws an error but returns SQL type
 * This is used before queries are generated
 */
export function llmPlaceholder(strings: TemplateStringsArray, ...values: any[]): SQLWrapper {
  const intent = strings.reduce((acc, str, i) => {
    return acc + str + (values[i] || "");
  }, "");

  throw new Error(
    `[Drizzle-LLM] Query not generated for intent: "${intent}"\nPlease run 'npm run build' or 'vite build' to generate SQL queries.\nEnsure your vite.config.ts includes the drizzleLLM plugin.`
  );
}

/**
 * Create the actual llm template tag implementation
 * This is used after queries are generated
 */
export function createLLMTag(
  generatedQueries: Record<string, GeneratedQueryConfig>,
  intentToId: Record<string, string>
): <_T = unknown>(strings: TemplateStringsArray, ...values: any[]) => SQLWrapper {
  return function llm<_T = unknown>(strings: TemplateStringsArray, ...values: any[]): SQLWrapper {
    // Reconstruct the template pattern with placeholders for lookup
    const intentPattern = strings.reduce((acc, str, i) => {
      if (i < values.length) {
        return `${acc + str}\${${i}}`;
      }
      return acc + str;
    }, "");

    // Also reconstruct the full intent with actual values for error messages
    const fullIntent = strings.reduce((acc, str, i) => {
      return acc + str + (values[i] || "");
    }, "");

    // Look up the query using the pattern
    const queryId = intentToId[intentPattern] || hashIntent(intentPattern);
    const queryConfig = generatedQueries[queryId];

    if (!queryConfig) {
      throw new Error(
        `[Drizzle-LLM] No query found for intent: "${fullIntent}" (pattern: "${intentPattern}")\nThis query may have been added after the last generation.\nRun 'npm run build' to update.`
      );
    }

    // Query validation is now handled by the cache system during build

    // Load SQL from .sql file using query ID
    let processedSql: string;
    try {
      processedSql = loadSqlFromFile(queryId);
    } catch (error) {
      // Fallback to sql property for backward compatibility
      if (queryConfig.sql) {
        processedSql = queryConfig.sql;
      } else {
        throw new Error(`[Drizzle-LLM] No SQL found for query "${fullIntent}": ${error}`);
      }
    }

    // Return as Drizzle SQL object with proper parameter binding
    // Use dynamic import to ensure we use the consumer's drizzle-orm instance
    const { sql: consumerSql } = require("drizzle-orm");
    const { sql } = consumerSql; // Extract sql helper

    if (values.length > 0) {
      // SQL can have either ? placeholders (SQLite) or $1, $2, etc. (PostgreSQL)
      // Handle both formats
      let result = consumerSql``;

      if (processedSql.includes("$1")) {
        // PostgreSQL-style placeholders ($1, $2, ...)
        let sqlWithParameters = processedSql;
        for (let i = 0; i < values.length; i++) {
          const placeholder = `$${i + 1}`;
          if (sqlWithParameters.includes(placeholder)) {
            const parts = sqlWithParameters.split(placeholder);
            result = consumerSql`${result}${consumerSql.raw(parts[0])}${values[i]}`;
            sqlWithParameters = parts.slice(1).join(placeholder);
          }
        }
        result = consumerSql`${result}${consumerSql.raw(sqlWithParameters)}`;
      } else {
        // SQLite-style placeholders (?)
        const sqlParts = processedSql.split("?");
        for (let i = 0; i < sqlParts.length; i++) {
          result = consumerSql`${result}${consumerSql.raw(sqlParts[i])}`;
          if (i < values.length) {
            result = consumerSql`${result}${values[i]}`;
          }
        }
      }

      return result;
    }
    return consumerSql.raw(processedSql);
  };
}

/**
 * Hash an intent string to create a stable query ID
 * Uses the same logic as build-time for consistency
 */
function hashIntent(intent: string): string {
  // Use same logic as AST parser - include params and location (even if undefined)
  return generateRuntimeQueryId(intent);
}

/**
 * Registry for all generated queries across the application
 */
const globalQueryRegistry: Record<string, GeneratedQueryConfig> = {};
const globalIntentToId: Record<string, string> = {};

/**
 * Register queries from a distributed .query.ts file
 * This is called automatically when .query.ts files are imported
 */
export function registerQueries(
  queries: Record<string, GeneratedQueryConfig>,
  intentToId: Record<string, string>
): void {
  Object.assign(globalQueryRegistry, queries);
  Object.assign(globalIntentToId, intentToId);
}

/**
 * Get the current llm implementation based on registered queries
 */
function createCurrentLLMInstance(): <_T = unknown>(
  strings: TemplateStringsArray,
  ...values: any[]
) => SQLWrapper {
  if (Object.keys(globalQueryRegistry).length === 0) {
    return llmPlaceholder as any;
  }
  return createLLMTag(globalQueryRegistry, globalIntentToId);
}

/**
 * The main llm template tag function
 * Dynamically uses registered queries or placeholder
 */
export const llm: <_T = unknown>(strings: TemplateStringsArray, ...values: any[]) => SQLWrapper = (
  strings: TemplateStringsArray,
  ...values: any[]
) => {
  const currentInstance = createCurrentLLMInstance();
  return currentInstance(strings, ...values);
};
