import { Plugin } from 'vite';
import { resolve } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { QueryParser } from './core/ast-parser.js';
import { SchemaAnalyzer } from './core/schema-analyzer.js';
import { QueryGenerator } from './core/query-generator.js';
import { QueryCache } from './utils/cache.js';
import { QueryValidator } from './core/query-validator.js';
import { DrizzleLLMConfig, CollectedQuery, GeneratedQuery, SchemaInfo } from './types.js';

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
    name: 'drizzle-llm',
    
    /**
     * Vite buildStart hook - executes query generation at the beginning of the build process
     * Only runs on the first build to avoid duplicate generation in watch mode
     */
    async buildStart() {
      if (!isFirstBuild) return;
      isFirstBuild = false;
      
      console.log('🔍 Drizzle LLM: Starting query collection and generation...');
      
      try {
        await generateQueries(config);
        console.log('✅ Drizzle LLM: Query generation completed successfully');
      } catch (error) {
        console.error('❌ Drizzle LLM: Query generation failed:', error);
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
      
      const isQueryFile = queryFiles.some(pattern => 
        file.includes(pattern.replace('**/*', '').replace('*', ''))
      );
      
      const isSchemaFile = file.includes(config.paths.schema.replace('**/*', '').replace('*', ''));
      
      if (isQueryFile || isSchemaFile) {
        console.log('🔄 Drizzle LLM: Detected changes, regenerating queries...');
        
        try {
          await generateQueries(config);
          console.log('✅ Drizzle LLM: Hot reload completed');
        } catch (error) {
          console.error('❌ Drizzle LLM: Hot reload failed:', error);
        }
      }
      
      return;
    }
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
async function generateQueries(config: DrizzleLLMConfig): Promise<void> {
  const parser = new QueryParser();
  const schemaAnalyzer = new SchemaAnalyzer();
  
  // Get output directory for progress tracking
  const outputPath = resolve(config.paths.output);
  const outputDir = outputPath.substring(0, outputPath.lastIndexOf('/'));
  
  const generator = new QueryGenerator(config);
  const cache = new QueryCache(config.cache?.directory, config.cache?.enabled);

  console.log('📋 Analyzing schema...');
  const schema = schemaAnalyzer.analyzeSchema(resolve(config.paths.schema));
  
  console.log('🔍 Collecting queries...');
  const queryFiles = Array.isArray(config.paths.queries) 
    ? config.paths.queries 
    : [config.paths.queries];
  
  // Resolve glob patterns to actual file paths
  const { glob } = await import('glob');
  const resolvedPaths: string[] = [];
  
  console.log('🔍 Searching for query files with patterns:', queryFiles);
  console.log('🔍 Current working directory:', process.cwd());
  
  for (const pattern of queryFiles) {
    const files = await glob(pattern, { cwd: process.cwd() });
    console.log(`🔍 Pattern "${pattern}" found files:`, files);
    resolvedPaths.push(...files.map(file => resolve(file)));
  }
  
  console.log('🔍 Total resolved paths:', resolvedPaths);
  const allQueries = parser.collectQueries(resolvedPaths);
  
  if (allQueries.length === 0) {
    console.log('ℹ️  No db.llm() calls found');
    return;
  }
  
  console.log(`🎯 Found ${allQueries.length} queries in total`);
  
  // Load existing generated queries to compare
  const existingQueries = await loadExistingQueries(config.paths.output);
  
  console.log(`📋 Loaded ${Object.keys(existingQueries).length} existing queries from output file`);
  
  // Filter queries that need regeneration
  const { validQueries, invalidQueries, changedQueries } = categorizeQueries(allQueries, existingQueries, cache);
  
  console.log(`📊 Query categorization:`);
  console.log(`   ✅ Valid (unchanged): ${validQueries.length}`);
  console.log(`   ❌ Invalid: ${invalidQueries.length}`);
  console.log(`   🔄 Changed: ${changedQueries.length}`);
  
  const queriesToGenerate = [...invalidQueries, ...changedQueries];
  
  if (queriesToGenerate.length === 0) {
    console.log('✨ All queries are up to date, no generation needed');
    return;
  }
  
  console.log(`🎯 Need to regenerate ${queriesToGenerate.length} queries`);
  
  // Ask for user confirmation before generating queries
  if (queriesToGenerate.length > 0) {
    console.log(`\n⚠️  About to generate ${queriesToGenerate.length} SQL queries using LLM.`);
    console.log('   This will consume API tokens/credits.');
    
    // List the queries to be generated
    console.log('\nQueries to generate:');
    queriesToGenerate.forEach((query, index) => {
      console.log(`   ${index + 1}. "${query.intent.substring(0, 60)}${query.intent.length > 60 ? '...' : ''}"`);
      console.log(`      ID: ${query.id}`);
    });
    
    // Skip confirmation if AUTO_APPROVE is set
    if (process.env.DRIZZLE_LLM_AUTO_APPROVE === 'true') {
      console.log('\n✅ Auto-approval enabled, proceeding with generation...');
    } else {
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise<string>((resolve) => {
        rl.question('\n🤖 Continue with LLM generation? (y/N): ', resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log('❌ Query generation cancelled by user.');
        console.log('   Set DRIZZLE_LLM_AUTO_APPROVE=true to skip this confirmation.');
        return;
      }
    }
  }
  
  console.log('🤖 Generating SQL queries with LLM...');
  
  try {
    const newlyGeneratedQueries = await generator.generateQueries(queriesToGenerate, schema);
    
    // Validate newly generated queries
    console.log('🔍 Validating generated queries...');
    const validator = new QueryValidator(schema);
    
    for (const query of newlyGeneratedQueries) {
      const validationResult = validator.validateSingleQuery(query);
      query.isValid = validationResult.isValid;
      
      if (!validationResult.isValid) {
        query.validationErrors = validationResult.errors.map(e => e.message);
      }
    }
    
    // Combine newly generated queries with existing valid queries
    const allGeneratedQueries = [...getExistingValidQueries(existingQueries, validQueries), ...newlyGeneratedQueries];
    
    // Count valid and invalid queries
    const validCount = allGeneratedQueries.filter(q => q.isValid !== false).length;
    const invalidCount = allGeneratedQueries.filter(q => q.isValid === false).length;
    
    console.log('💾 Writing generated queries...');
    
    // Write distributed query files (*.query.ts)
    await writeDistributedQueryFiles(allGeneratedQueries, resolvedPaths);
    
    // Also write centralized file for backward compatibility
    await writeGeneratedQueries(allGeneratedQueries, config.paths.output);
    
    console.log(`✨ Generated ${newlyGeneratedQueries.length} new queries successfully`);
    console.log(`📊 Total queries in output: ${allGeneratedQueries.length}`);
    console.log(`   ✅ Valid queries: ${validCount}`);
    console.log(`   ❌ Invalid queries: ${invalidCount}`);
    
    if (newlyGeneratedQueries.length < queriesToGenerate.length) {
      console.log(`⚠️  Note: ${queriesToGenerate.length - newlyGeneratedQueries.length} queries failed but proceeding with available results.`);
    }
  } catch (error) {
    console.error('❌ Query generation failed:', error);
    
    // Check if we have any partial results to save
    const outputExists = existsSync(resolve(config.paths.output));
    if (outputExists) {
      console.log('📄 Keeping existing generated queries file.');
    } else {
      console.log('💡 No generated queries available. Fix the issues and run build again.');
    }
    
    throw error;
  }
}

/**
 * Write generated queries to a centralized TypeScript file
 * 
 * Creates a single TypeScript file containing all generated queries with:
 * - Type-safe interfaces for each query
 * - Exported query objects with SQL, parameters, and metadata
 * - Intent-to-ID mapping for runtime query lookup
 * - QueryClient class for executing queries
 * 
 * @param queries - Array of generated query objects containing SQL, parameters, and validation results
 * @param outputPath - Absolute or relative path where the TypeScript file should be written
 * @throws {Error} When directory creation or file writing fails
 */
async function writeGeneratedQueries(queries: GeneratedQuery[], outputPath: string): Promise<void> {
  const resolvedPath = resolve(outputPath);
  const outputDir = resolvedPath.substring(0, resolvedPath.lastIndexOf('/'));
  
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const template = generateTypeScriptCode(queries);
  
  writeFileSync(resolvedPath, template, 'utf8');
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
async function writeDistributedQueryFiles(queries: GeneratedQuery[], resolvedPaths: string[]): Promise<void> {
  // Group queries by source file
  const queriesByFile = new Map<string, GeneratedQuery[]>();
  
  for (const query of queries) {
    const sourceFile = query.sourceFile || 'unknown';
    if (!queriesByFile.has(sourceFile)) {
      queriesByFile.set(sourceFile, []);
    }
    queriesByFile.get(sourceFile)!.push(query);
  }
  
  console.log('📁 Writing distributed query files...');
  
  // Write .query.ts file for each source file
  for (const [sourceFile, fileQueries] of queriesByFile) {
    if (sourceFile === 'unknown') continue;
    
    // Filter valid queries only for distributed files
    const validFileQueries = fileQueries.filter(q => q.isValid !== false);
    
    if (validFileQueries.length === 0) {
      console.log(`   ⚠️  Skipped: ${sourceFile} (no valid queries)`);
      continue;
    }
    
    // Generate output path: replace .ts with .query.ts
    const queryFilePath = sourceFile.replace(/\.ts$/, '.query.ts');
    
    const template = generateDistributedQueryFile(validFileQueries, sourceFile);
    writeFileSync(queryFilePath, template, 'utf8');
    
    console.log(`   📄 Generated: ${queryFilePath} (${validFileQueries.length} valid queries)`);
  }
}

/**
 * Generate complete TypeScript code for the centralized queries file
 * 
 * Creates a comprehensive TypeScript module containing:
 * - Type imports and basic type definitions
 * - GeneratedQueries interface mapping query IDs to return types
 * - generatedQueries object with SQL, parameters, and metadata
 * - intentToId mapping for runtime query resolution
 * - QueryClient class with type-safe query execution methods
 * 
 * @param queries - Array of generated query objects
 * @returns Complete TypeScript code as a string ready to be written to file
 * 
 * @example
 * ```typescript
 * const code = generateTypeScriptCode([
 *   { id: 'q1', intent: 'Get users', sql: 'SELECT * FROM users', parameters: [], returnType: 'User' }
 * ]);
 * // Returns TypeScript code with interfaces, objects, and QueryClient class
 * ```
 */
function generateTypeScriptCode(queries: GeneratedQuery[]): string {
  const imports = `import { QueryExecutor } from 'drizzle-llm/runtime';

// Type imports - add your actual types here
type User = any;
type Product = any; 
type Order = any;

export interface GeneratedQueries {\n`;

  const interfaces = queries.map(query => 
    `  '${query.id}': ${query.returnType}[];`
  ).join('\n');

  const queriesObject = `
}

export const generatedQueries = {
${queries.map(query => `  '${query.id}': {
    sql: \`${query.sql}\`,
    parameters: ${JSON.stringify(query.parameters)},
    hash: '${query.hash}',
    isValid: ${query.isValid !== false},
    validationErrors: ${JSON.stringify(query.validationErrors || [])}
  }`).join(',\n')}
};

// Intent to query ID mapping for runtime lookup
export const intentToId: Record<string, string> = {
${queries.map(query => `  "${query.intent}": "${query.id}"`).join(',\n')}
};

export class QueryClient {
  private executor: QueryExecutor;

  constructor(executor: QueryExecutor) {
    this.executor = executor;
  }

  // Find query by intent (used by runtime client)
  findQueryByIntent(intent: string): { sql: string; parameters: string[]; hash: string } | null {
    const queryId = intentToId[intent];
    if (!queryId) {
      return null;
    }
    return generatedQueries[queryId] || null;
  }

${queries.map((query, index) => `  async query${index + 1}(params: Record<string, any> = {}): Promise<${query.returnType}[]> {
    const queryConfig = generatedQueries['${query.id}'];
    return this.executor.execute<${query.returnType}>(queryConfig.sql, params);
  }`).join('\n\n')}
}

export default QueryClient;
`;

  return imports + interfaces + queriesObject;
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
  const fileName = sourceFile.split('/').pop()?.replace('.ts', '') || 'queries';
  const camelCaseName = camelCase(fileName.replace(/-/g, '_'));
  
  // 必要な型を収集
  const usedTypes = new Set<string>();
  queries.forEach(query => {
    if (query.returnType && query.returnType !== 'any') {
      usedTypes.add(query.returnType);
    }
  });
  
  // 型のimport文を生成
  const typeImports = usedTypes.size > 0 
    ? `import type { ${Array.from(usedTypes).join(', ')} } from '../db';\n\n`
    : '';
  
  const imports = `// Generated queries for ${fileName}
// This file is auto-generated. Do not edit manually.

${typeImports}export interface ${camelCaseName.charAt(0).toUpperCase() + camelCaseName.slice(1)}Queries {
${queries.map(query => `  '${query.id}': ${query.returnType}[];`).join('\n')}
}

export const ${camelCaseName}Queries = {
${queries.map(query => `  '${query.id}': {
    sql: \`${query.sql}\`,
    parameters: ${JSON.stringify(query.parameters)},
    hash: '${query.hash}',
    isValid: ${query.isValid !== false},
    validationErrors: ${JSON.stringify(query.validationErrors || [])}
  }`).join(',\n')}
};

// Intent to query ID mapping
export const ${camelCaseName}IntentToId: Record<string, string> = {
${queries.map(query => `  "${query.intent}": "${query.id}"`).join(',\n')}
};
`;

  return imports;
}

/**
 * Load and parse existing generated queries from the output file
 * 
 * Reads the previously generated TypeScript queries file and extracts:
 * - Query objects with SQL, parameters, and metadata
 * - Intent-to-ID mappings for query lookup
 * - Validation status and error information
 * 
 * This enables incremental generation by comparing existing queries
 * with current source code to determine what needs regeneration.
 * 
 * @param outputPath - Absolute or relative path to the generated queries file
 * @returns Map where keys are query IDs and values are GeneratedQuery objects
 * @throws {Error} When file reading or parsing fails (logged as warning, returns empty object)
 * 
 * @example
 * ```typescript
 * const existing = await loadExistingQueries('./src/generated/queries.ts');
 * // Returns: { 'q1': { id: 'q1', sql: '...', intent: '...', ... }, ... }
 * ```
 */
async function loadExistingQueries(outputPath: string): Promise<Record<string, GeneratedQuery>> {
  const resolvedPath = resolve(outputPath);
  
  if (!existsSync(resolvedPath)) {
    return {};
  }

  try {
    const content = readFileSync(resolvedPath, 'utf8');
    const { extractQueriesWithIntent } = await import('./utils/query-extractor.js');
    return extractQueriesWithIntent(content);
  } catch (error) {
    console.warn('⚠️  Failed to load existing queries:', error);
    return {};
  }
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
  cache: QueryCache
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
    if (existingQuery.intent && existingQuery.intent !== '') {
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
 * Validate and categorize generated queries into valid and invalid groups
 * 
 * Runs comprehensive validation on generated queries including:
 * - SQL syntax validation
 * - Schema consistency checks
 * - Security vulnerability detection
 * - Performance optimization warnings
 * 
 * Invalid queries are logged with detailed error information to help
 * with debugging and LLM prompt improvement.
 * 
 * @param queries - Array of generated queries to validate
 * @param schema - Database schema information for validation
 * @returns Object containing arrays of valid and invalid queries
 * 
 * @example
 * ```typescript
 * const { validQueries, invalidQueries } = validateAndCategorizeQueries(
 *   generatedQueries, schemaInfo
 * );
 * // validQueries can be used in the application
 * // invalidQueries need regeneration or manual fixing
 * ```
 * 
 * @deprecated This function is currently unused but kept for potential future use
 */
function validateAndCategorizeQueries(
  queries: GeneratedQuery[], 
  schema: SchemaInfo
): {
  validQueries: GeneratedQuery[];
  invalidQueries: GeneratedQuery[];
} {
  const validator = new QueryValidator(schema);
  const validQueries: GeneratedQuery[] = [];
  const invalidQueries: GeneratedQuery[] = [];

  for (const query of queries) {
    const validationResult = validator.validateSingleQuery(query);
    
    if (validationResult.isValid) {
      validQueries.push(query);
    } else {
      console.log(`❌ Invalid query detected: ${query.id}`);
      console.log(`   Intent: "${query.intent}"`);
      
      // エラーの詳細を表示
      validationResult.errors.forEach(error => {
        console.log(`   Error: ${error.message}`);
        if (error.suggestion) {
          console.log(`   Suggestion: ${error.suggestion}`);
        }
      });
      
      invalidQueries.push(query);
    }
  }

  return { validQueries, invalidQueries };
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
    returnType: query.returnType
  });
  
  return createHash('md5').update(content).digest('hex');
}

/**
 * Extract existing valid generated queries that correspond to valid collected queries
 * 
 * Filters the existing generated queries to include only those that:
 * 1. Have corresponding entries in the validQueries list
 * 2. Were previously generated and validated successfully
 * 3. Don't need regeneration based on change detection
 * 
 * This allows reusing previously generated SQL without calling the LLM again,
 * significantly reducing API costs and build time.
 * 
 * @param existingQueries - Map of all previously generated queries (ID -> GeneratedQuery)
 * @param validQueries - Array of collected queries that are considered unchanged
 * @returns Array of GeneratedQuery objects that can be reused in the output
 * 
 * @example
 * ```typescript
 * const reusableQueries = getExistingValidQueries(existingMap, validCollectedQueries);
 * const allQueries = [...reusableQueries, ...newlyGeneratedQueries];
 * ```
 */
function getExistingValidQueries(
  existingQueries: Record<string, GeneratedQuery>, 
  validQueries: CollectedQuery[]
): GeneratedQuery[] {
  return validQueries
    .map(query => existingQueries[query.id])
    .filter(Boolean);
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

export default drizzleLLM;