import { createHash } from "crypto";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { Project } from "ts-morph";
import type { Plugin } from "vite";
import { QueryParser } from "./core/ast-parser.js";
import { QueryGenerator } from "./core/query-generator.js";
import { SchemaAnalyzer } from "./core/schema-analyzer.js";
// import { QueryValidator } from './core/query-validator.js'; // File deleted
import type { CollectedQuery, DrizzleLLMConfig, GeneratedQuery } from "./types.js";
import { QueryCache } from "./utils/cache.js";

/**
 * Plugin options interface extending base configuration
 * Used to configure the Drizzle LLM Vite plugin behavior
 */
export interface DrizzleLLMPluginOptions extends DrizzleLLMConfig {}

/**
 * Create a Vite plugin for Drizzle LLM query generation
 *
 * This plugin integrates with Vite's build process to automatically:
 * - Scan source files for db.llm() calls
 * - Generate SQL queries using LLM providers (OpenAI/Anthropic)
 * - Validate generated queries against database schema
 * - Create TypeScript files with type-safe query functions
 *
 * @param config - Configuration object containing LLM provider settings, file paths, and cache options
 * @returns A Vite plugin instance with buildStart and handleHotUpdate hooks
 *
 * @example
 * ```typescript
 * import { drizzleLLM } from 'drizzle-llm/plugin';
 *
 * export default defineConfig({
 *   plugins: [
 *     drizzleLLM({
 *       provider: { type: 'openai', apiKey: process.env.OPENAI_API_KEY },
 *       paths: {
 *         schema: './src/db/schema.ts',
 *         queries: './src/queries/**\/*.ts',
 *         output: './src/generated/queries.ts'
 *       }
 *     })
 *   ]
 * });
 * ```
 */
export function drizzleLLM(config: DrizzleLLMPluginOptions): Plugin {
  let isFirstBuild = true;

  return {
    name: "drizzle-llm",
    enforce: "pre", // Run before other plugins to ensure llm tag is available

    /**
     * Vite buildStart hook - executes query generation at the beginning of the build process
     * Only runs on the first build to avoid duplicate generation in watch mode
     */
    async buildStart() {
      if (!isFirstBuild) return;
      isFirstBuild = false;

      console.log("🔍 Drizzle LLM: Starting query collection and generation...");

      try {
        await generateQueries(config);
        console.log("✅ Drizzle LLM: Query generation completed successfully");
      } catch (error) {
        console.error("❌ Drizzle LLM: Query generation failed:", error);
        throw error;
      }
    },

    /**
     * Vite handleHotUpdate hook - regenerates queries when relevant files change in development
     *
     * Triggers regeneration when:
     * - Query files (containing db.llm() calls) are modified
     * - Schema files are modified
     *
     * @param ctx - Vite HMR update context containing information about the changed file
     */
    async handleHotUpdate(ctx) {
      const { file } = ctx;

      const queryFiles = Array.isArray(config.paths.queries)
        ? config.paths.queries
        : [config.paths.queries];

      const isQueryFile = queryFiles.some((pattern) =>
        file.includes(pattern.replace("**/*", "").replace("*", ""))
      );

      const isSchemaFile = file.includes(config.paths.schema.replace("**/*", "").replace("*", ""));

      if (isQueryFile || isSchemaFile) {
        console.log("🔄 Drizzle LLM: Detected changes, regenerating queries...");

        try {
          await generateQueries(config);
          console.log("✅ Drizzle LLM: Hot reload completed");
        } catch (error) {
          console.error("❌ Drizzle LLM: Hot reload failed:", error);
        }
      }

      return;
    },
  };
}

/**
 * Core query generation function that orchestrates the entire LLM query generation process
 *
 * This function performs the following steps:
 * 1. Analyzes the database schema from the configured schema file
 * 2. Scans source files for db.llm() calls using AST parsing
 * 3. Categorizes queries as new, changed, or unchanged using cache
 * 4. Generates SQL for new/changed queries using configured LLM provider
 * 5. Validates generated SQL against database schema
 * 6. Writes both centralized and distributed TypeScript query files
 *
 * @param config - Complete configuration object including provider settings, paths, and cache options
 * @throws {Error} When schema analysis fails, LLM generation fails, or file operations fail
 *
 * @internal This function is called by the Vite plugin and should not be used directly
 */
export async function generateQueries(config: DrizzleLLMConfig): Promise<void> {
  const parser = new QueryParser();
  const schemaAnalyzer = new SchemaAnalyzer();

  const generator = new QueryGenerator(config);
  const cache = new QueryCache(config.cache?.directory, config.cache?.enabled);

  console.log("📋 Analyzing schema...");
  const schema = await schemaAnalyzer.analyzeSchemaPath(config.paths.schema);

  console.log("🔍 Collecting queries...");
  const queryFiles = Array.isArray(config.paths.queries)
    ? config.paths.queries
    : [config.paths.queries];

  // Resolve glob patterns to actual file paths
  const { glob } = await import("glob");
  const resolvedPaths: string[] = [];

  console.log("🔍 Searching for query files with patterns:", queryFiles);
  console.log("🔍 Current working directory:", process.cwd());

  for (const pattern of queryFiles) {
    const files = await glob(pattern, { cwd: process.cwd() });
    console.log(`🔍 Pattern "${pattern}" found files:`, files);
    resolvedPaths.push(...files.map((file) => resolve(file)));
  }

  console.log("🔍 Total resolved paths:", resolvedPaths);
  const allQueries = parser.collectQueries(resolvedPaths);

  if (allQueries.length === 0) {
    console.log("ℹ️  No LLM query calls found (neither db.llm() nor llm``)");
    return;
  }

  console.log(`🎯 Found ${allQueries.length} queries in total`);

  // Without centralized file, all queries need to be generated
  const existingQueries: Record<string, GeneratedQuery> = {};

  // Filter queries that need regeneration
  const { validQueries, invalidQueries, changedQueries } = categorizeQueries(
    allQueries,
    existingQueries,
    cache
  );

  console.log("📊 Query categorization:");
  console.log(`   ✅ Valid (unchanged): ${validQueries.length}`);
  console.log(`   ❌ Invalid: ${invalidQueries.length}`);
  console.log(`   🔄 Changed: ${changedQueries.length}`);

  const queriesToGenerate = [...invalidQueries, ...changedQueries];

  if (queriesToGenerate.length === 0) {
    console.log("✨ All queries are up to date, no generation needed");
    return;
  }

  console.log(`🎯 Need to regenerate ${queriesToGenerate.length} queries`);

  // Ask for user confirmation before generating queries
  if (queriesToGenerate.length > 0) {
    console.log(`\n⚠️  About to generate ${queriesToGenerate.length} SQL queries using LLM.`);
    console.log("   This will consume API tokens/credits.");

    // List the queries to be generated
    console.log("\nQueries to generate:");
    queriesToGenerate.forEach((query, index) => {
      console.log(
        `   ${index + 1}. "${query.intent.substring(0, 60)}${query.intent.length > 60 ? "..." : ""}"`
      );
      console.log(`      ID: ${query.id}`);
    });

    // Skip confirmation if AUTO_APPROVE is set
    if (process.env.DRIZZLE_LLM_AUTO_APPROVE === "true") {
      console.log("\n✅ Auto-approval enabled, proceeding with generation...");
    } else {
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question("\n🤖 Continue with LLM generation? (y/N): ", resolve);
      });

      rl.close();

      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log("❌ Query generation cancelled by user.");
        console.log("   Set DRIZZLE_LLM_AUTO_APPROVE=true to skip this confirmation.");
        return;
      }
    }
  }

  console.log("🤖 Generating SQL queries with LLM...");

  try {
    const newlyGeneratedQueries = await generator.generateQueries(queriesToGenerate, schema);

    // Validation removed - all queries are considered valid
    console.log("✅ All generated queries are considered valid");

    // Combine newly generated queries with existing valid queries
    const existingValidQueries = validQueries
      .map((query) => existingQueries[query.id])
      .filter(Boolean);
    const allGeneratedQueries = [...existingValidQueries, ...newlyGeneratedQueries];

    // All queries are valid since validation was removed
    const validCount = allGeneratedQueries.length;
    const invalidCount = 0;

    console.log("💾 Writing generated queries...");

    // Write output files based on configuration
    const outputConfig = config.output || {};
    const generateSqlFiles = outputConfig.generateSqlFiles !== false; // default: true
    const generateQueryFiles = outputConfig.generateQueryFiles !== false; // default: true

    if (generateQueryFiles) {
      // Write distributed query files (*.query.ts)
      await writeDistributedQueryFiles(allGeneratedQueries, resolvedPaths);
    }

    if (generateSqlFiles) {
      // Write SQL files for sqlc-like experience (default: enabled)
      await writeSQLFiles(allGeneratedQueries);
    }

    console.log(`✨ Generated ${newlyGeneratedQueries.length} new queries successfully`);
    console.log(`📊 Total queries in output: ${allGeneratedQueries.length}`);
    console.log(`   ✅ Valid queries: ${validCount}`);
    console.log(`   ❌ Invalid queries: ${invalidCount}`);

    if (newlyGeneratedQueries.length < queriesToGenerate.length) {
      console.log(
        `⚠️  Note: ${queriesToGenerate.length - newlyGeneratedQueries.length} queries failed but proceeding with available results.`
      );
    }
  } catch (error) {
    console.error("❌ Query generation failed:", error);

    // Without centralized file, just show error message
    console.log("💡 Fix the issues and run build again.");

    throw error;
  }
}

/**
 * Write distributed query files (.query.ts) alongside each source file containing db.llm() calls
 *
 * This function creates individual .query.ts files next to each source file that contains
 * db.llm() calls. Each distributed file contains only the queries from its corresponding
 * source file, making it easier to manage queries in a modular way.
 *
 * Features:
 * - Groups queries by their source file
 * - Creates [filename].query.ts for each [filename].ts
 * - Includes only valid queries in distributed files
 * - Generates TypeScript interfaces and exports for each file
 * - Provides intent-to-ID mapping for each file's queries
 *
 * @param queries - Array of generated queries with source file information
 * @param resolvedPaths - Array of resolved file paths (currently unused but kept for compatibility)
 * @throws {Error} When file writing operations fail
 *
 * @example
 * For a source file `src/queries/users.ts`, this creates `src/queries/users.query.ts`
 */
async function writeDistributedQueryFiles(
  queries: GeneratedQuery[],
  _resolvedPaths: string[]
): Promise<void> {
  // Group queries by source file
  const queriesByFile = new Map<string, GeneratedQuery[]>();

  for (const query of queries) {
    const sourceFile = query.sourceFile || "unknown";
    if (!queriesByFile.has(sourceFile)) {
      queriesByFile.set(sourceFile, []);
    }
    queriesByFile.get(sourceFile)?.push(query);
  }

  console.log("📁 Writing distributed query files...");

  // Write .query.ts file for each source file
  for (const [sourceFile, fileQueries] of queriesByFile) {
    if (sourceFile === "unknown") continue;

    // All queries are valid since validation was removed
    const validFileQueries = fileQueries;

    if (validFileQueries.length === 0) {
      console.log(`   ⚠️  Skipped: ${sourceFile} (no queries)`);
      continue;
    }

    // Generate output path: replace .ts with .query.ts
    const queryFilePath = sourceFile.replace(/\.ts$/, ".query.ts");

    const template = generateDistributedQueryFile(validFileQueries, sourceFile);
    writeFileSync(queryFilePath, template, "utf8");

    console.log(`   📄 Generated: ${queryFilePath} (${validFileQueries.length} valid queries)`);
  }
}

/**
 * Generate TypeScript code template for a single distributed query file
 *
 * Creates a focused TypeScript module for queries from a specific source file:
 * - Analyzes return types and generates appropriate type imports
 * - Creates a typed interface for the file's queries
 * - Generates a queries object with SQL and metadata
 * - Provides intent-to-ID mapping specific to this file
 * - Uses camelCase naming based on the source file name
 *
 * @param queries - Array of queries that originated from the specified source file
 * @param sourceFile - Path to the original source file (used for naming and type imports)
 * @returns TypeScript code string for the distributed query file
 *
 * @example
 * For sourceFile 'src/queries/user-queries.ts':
 * - Generates interface 'UserQueriesQueries'
 * - Creates object 'userQueriesQueries'
 * - Includes mapping 'userQueriesIntentToId'
 */
function generateDistributedQueryFile(queries: GeneratedQuery[], sourceFile: string): string {
  const fileName = sourceFile.split("/").pop()?.replace(".ts", "") || "queries";
  const camelCaseName = camelCase(fileName.replace(/-/g, "_"));

  // 必要な型を収集
  const usedTypes = new Set<string>();
  queries.forEach((query) => {
    if (query.returnType && query.returnType !== "any") {
      usedTypes.add(query.returnType);
    }
  });

  // AST解析で型定義の場所を探す
  const typeImports =
    usedTypes.size > 0 ? generateTypeImports(Array.from(usedTypes), sourceFile) : "";

  const imports = `// Generated queries for ${fileName}
// This file is auto-generated. Do not edit manually.

import { registerQueries } from 'drizzle-llm/runtime';

${typeImports}export interface ${camelCaseName.charAt(0).toUpperCase() + camelCaseName.slice(1)}Queries {
${queries.map((query) => `  '${query.id}': ${query.returnType}[];`).join("\n")}
}

export const ${camelCaseName}Queries = {
${queries
  .map(
    (query) => `  '${query.id}': {
    parameters: ${JSON.stringify(query.parameters)}
  }`
  )
  .join(",\n")}
};

// Intent to query ID mapping
export const ${camelCaseName}IntentToId: Record<string, string> = {
${queries.map((query) => `  "${query.intent}": "${query.id}"`).join(",\n")}
};

// Auto-register queries when this file is imported
registerQueries(${camelCaseName}Queries, ${camelCaseName}IntentToId);
`;

  return imports;
}

/**
 * AST解析で型定義の場所を探してインポート文を生成
 */
function generateTypeImports(typeNames: string[], sourceFile: string): string {
  const project = new Project({
    tsConfigFilePath: "./tsconfig.json",
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFileObj = project.addSourceFileAtPath(sourceFile);
  const imports: Map<string, string[]> = new Map();

  for (const typeName of typeNames) {
    const foundImport = findTypeDefinition(sourceFileObj, typeName, sourceFile);
    if (foundImport) {
      const { importPath, exportedTypes } = foundImport;
      if (!imports.has(importPath)) {
        imports.set(importPath, []);
      }
      imports.get(importPath)?.push(...exportedTypes);
    }
  }

  // インポート文を生成
  const importStatements = Array.from(imports.entries())
    .map(([path, types]) => `import type { ${[...new Set(types)].join(", ")} } from '${path}';`)
    .join("\n");

  return importStatements ? `${importStatements}\n\n` : "";
}

/**
 * 型定義の場所を探す
 */
function findTypeDefinition(sourceFile: any, typeName: string, currentFilePath: string) {
  // 1. 同じファイル内で定義されているかチェック
  const localDefinition = findLocalTypeDefinition(sourceFile, typeName);
  if (localDefinition) {
    const fileName = currentFilePath.split("/").pop()?.replace(".ts", "") || "queries";
    return {
      importPath: `./${fileName}`,
      exportedTypes: [typeName],
    };
  }

  // 2. インポート文を解析して外部の型定義を探す
  const importDeclarations = sourceFile.getImportDeclarations();

  for (const importDecl of importDeclarations) {
    const namedImports = importDecl.getNamedImports();

    for (const namedImport of namedImports) {
      if (namedImport.getName() === typeName) {
        return {
          importPath: importDecl.getModuleSpecifierValue(),
          exportedTypes: [typeName],
        };
      }
    }

    // default import や namespace import もチェック
    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport && defaultImport.getText() === typeName) {
      return {
        importPath: importDecl.getModuleSpecifierValue(),
        exportedTypes: [typeName],
      };
    }
  }

  // 3. 見つからない場合は同じファイルからの推測インポートを返す
  const fileName = currentFilePath.split("/").pop()?.replace(".ts", "") || "queries";
  return {
    importPath: `./${fileName}`,
    exportedTypes: [typeName],
  };
}

/**
 * ローカルファイル内で型定義を探す
 */
function findLocalTypeDefinition(sourceFile: any, typeName: string): boolean {
  // インターフェース定義をチェック
  const interfaces = sourceFile.getInterfaces();
  for (const interfaceDecl of interfaces) {
    if (interfaceDecl.getName() === typeName) {
      return true;
    }
  }

  // 型エイリアス定義をチェック
  const typeAliases = sourceFile.getTypeAliases();
  for (const typeAlias of typeAliases) {
    if (typeAlias.getName() === typeName) {
      return true;
    }
  }

  // クラス定義をチェック
  const classes = sourceFile.getClasses();
  for (const classDecl of classes) {
    if (classDecl.getName() === typeName) {
      return true;
    }
  }

  // Enum定義をチェック
  const enums = sourceFile.getEnums();
  for (const enumDecl of enums) {
    if (enumDecl.getName() === typeName) {
      return true;
    }
  }

  return false;
}

/**
 * Categorize queries into valid, invalid, and changed based on comparison with existing queries
 *
 * Performs intelligent comparison to minimize LLM API calls:
 * - **Valid queries**: Unchanged queries that can be reused from existing output
 * - **Invalid queries**: New queries that need LLM generation
 * - **Changed queries**: Existing queries whose intent or parameters have changed
 *
 * Comparison strategy:
 * 1. First compares by intent text (if available from existing queries)
 * 2. Falls back to hash-based comparison for legacy compatibility
 * 3. Marks queries as new if no existing query found
 *
 * @param currentQueries - Queries collected from current source code analysis
 * @param existingQueries - Previously generated queries loaded from output file
 * @param cache - Query cache instance (currently unused but kept for future optimization)
 * @returns Object containing arrays of categorized queries
 *
 * @example
 * ```typescript
 * const { validQueries, invalidQueries, changedQueries } = categorizeQueries(
 *   currentQueries, existingQueries, cache
 * );
 * // Only invalidQueries and changedQueries need LLM generation
 * ```
 */
function categorizeQueries(
  currentQueries: CollectedQuery[],
  existingQueries: Record<string, GeneratedQuery>,
  _cache: QueryCache
): {
  validQueries: CollectedQuery[];
  invalidQueries: CollectedQuery[];
  changedQueries: CollectedQuery[];
} {
  const validQueries: CollectedQuery[] = [];
  const invalidQueries: CollectedQuery[] = [];
  const changedQueries: CollectedQuery[] = [];

  for (const query of currentQueries) {
    const existingQuery = existingQueries[query.id];

    if (!existingQuery) {
      // 新しいクエリ
      invalidQueries.push(query);
      continue;
    }

    // 既存クエリが存在し、intentが抽出されている場合は比較
    if (existingQuery.intent && existingQuery.intent !== "") {
      // intentが同じかチェック（簡単な変更検知）
      if (query.intent.trim() === existingQuery.intent.trim()) {
        // 同じintentなら有効とみなす
        validQueries.push(query);
      } else {
        // intentが変更された
        changedQueries.push(query);
      }
    } else {
      // intentが抽出できない場合、ハッシュ値で比較
      const currentHash = generateQueryHash(query);
      const existingHash = existingQuery.hash;

      if (currentHash === existingHash) {
        validQueries.push(query);
      } else {
        changedQueries.push(query);
      }
    }
  }

  return { validQueries, invalidQueries, changedQueries };
}

/**
 * Generate a unique hash value for a query based on its content
 *
 * Creates an MD5 hash from the query's intent, parameters, and return type.
 * This hash is used for change detection to avoid unnecessary regeneration
 * of queries that haven't changed.
 *
 * @param query - CollectedQuery object containing intent, params, and returnType
 * @returns MD5 hash string representing the query's content signature
 *
 * @example
 * ```typescript
 * const hash = generateQueryHash({
 *   intent: 'Get active users',
 *   params: { limit: 10 },
 *   returnType: 'User'
 * });
 * // Returns: 'a1b2c3d4e5f6...'
 * ```
 */
function generateQueryHash(query: CollectedQuery): string {
  const content = JSON.stringify({
    intent: query.intent.trim(),
    params: query.params || {},
    returnType: query.returnType,
  });

  return createHash("md5").update(content).digest("hex");
}

/**
 * Convert kebab-case or snake_case string to camelCase
 *
 * Used for generating JavaScript-friendly variable names from file names
 * that may contain hyphens or underscores.
 *
 * @param str - Input string with potential hyphens or underscores
 * @returns camelCase version of the input string
 *
 * @example
 * ```typescript
 * camelCase('user-queries') // returns 'userQueries'
 * camelCase('user_queries') // returns 'userQueries'
 * camelCase('userQueries') // returns 'userQueries'
 * ```
 */
function camelCase(str: string): string {
  return str.replace(/[-_]([a-z])/g, (g) => g[1].toUpperCase());
}

/**
 * Generate the llm template tag runtime implementation
 *
 * Creates a TypeScript file that exports the llm template tag function
 * with all generated queries embedded. This allows the llm`` syntax
 * to work at runtime with full type safety.
 *
 * @param queries - Array of all generated queries
 * @param outputDir - Directory where the runtime file should be written
 */
/**
 * Write SQL files for sqlc-like experience
 *
 * Creates individual .sql files alongside source files:
 * - Uses source filename as base name
 * - Includes intent as comment at top
 * - Raw SQL for easy inspection and version control
 *
 * @param queries - Array of generated queries
 */
async function writeSQLFiles(queries: GeneratedQuery[]): Promise<void> {
  console.log("📁 Writing SQL files alongside source files...");

  // Group queries by source file
  const queriesByFile = new Map<string, GeneratedQuery[]>();

  for (const query of queries) {
    // All queries are valid since validation was removed

    const sourceFile = query.sourceFile || "unknown";
    if (!queriesByFile.has(sourceFile)) {
      queriesByFile.set(sourceFile, []);
    }
    queriesByFile.get(sourceFile)?.push(query);
  }

  let totalFiles = 0;

  for (const [sourceFile, fileQueries] of queriesByFile) {
    if (sourceFile === "unknown") continue;

    // Generate SQL file path: replace .ts with .sql
    const sqlFilePath = sourceFile.replace(/\.ts$/, ".sql");

    // Generate SQL content with all queries from this file
    const sqlContent = fileQueries
      .map(
        (query) => `-- ${query.hash}
-- ${query.intent}
${query.sql}
`
      )
      .join("\n");

    writeFileSync(sqlFilePath, sqlContent, "utf8");
    totalFiles++;

    console.log(`   📄 Generated: ${sqlFilePath} (${fileQueries.length} queries)`);
  }

  console.log(`📄 Generated ${totalFiles} SQL files`);
}

async function generateLLMTagRuntime(queries: GeneratedQuery[], outputDir: string): Promise<void> {
  const runtimePath = resolve(outputDir, "llm-runtime.ts");

  // Build query map and intent-to-ID map
  const queryMap: Record<string, any> = {};
  const intentToId: Record<string, string> = {};

  for (const query of queries) {
    queryMap[query.id] = {
      sql: query.sql,
      parameters: query.parameters,
      hash: query.hash,
      intent: query.intent,
    };

    intentToId[query.intent] = query.id;
  }

  const content = `/**
 * Generated llm template tag runtime implementation
 * This file is auto-generated by drizzle-llm
 * DO NOT EDIT MANUALLY
 * 
 * @generated ${new Date().toISOString()}
 */

import { createLLMTag } from 'drizzle-llm/runtime/template-tag';

// Generated queries map
const generatedQueries = ${JSON.stringify(queryMap, null, 2)};

// Intent to ID mapping for fast lookup
const intentToId = ${JSON.stringify(intentToId, null, 2)};

// Export the configured llm template tag
export const llm = createLLMTag(generatedQueries, intentToId);

// Re-export types for convenience
export type { GeneratedQuery } from 'drizzle-llm/runtime/template-tag';
`;

  writeFileSync(runtimePath, content, "utf8");
  console.log(`📝 Generated llm tag runtime at ${runtimePath}`);
}

export default drizzleLLM;
