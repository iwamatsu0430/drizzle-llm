/**
 * Configuration for Drizzle LLM plugin
 * 
 * This configuration object controls all aspects of the LLM query generation process,
 * from provider settings to file paths and caching behavior.
 */
export interface DrizzleLLMConfig {
  /** LLM provider configuration */
  provider: {
    /** LLM provider type - currently supports OpenAI and Anthropic */
    type: 'openai' | 'anthropic';
    /** API key for the LLM provider */
    apiKey: string;
    /** Optional model name (e.g., 'gpt-4', 'claude-3-sonnet') */
    model?: string;
  };
  /** File path configuration */
  paths: {
    /** 
     * Path to Drizzle schema file or directory
     * 
     * Supports:
     * - Single file: './src/db/schema.ts'
     * - Directory with barrel file: './src/schema' (uses index.ts)
     * - Directory auto-discovery: './src/schema' (scans all .ts files if no index.ts)
     */
    schema: string;
    /** Path(s) to scan for db.llm() calls - supports glob patterns */
    queries: string | string[];
  };
  /** Optional caching configuration to reduce LLM API calls */
  cache?: {
    /** Whether to enable query caching */
    enabled: boolean;
    /** Directory to store cache files */
    directory: string;
  };
  /** Optional output configuration for generated files */
  output?: {
    /** Whether to generate .sql files alongside source files (default: true) */
    generateSqlFiles?: boolean;
    /** Whether to generate distributed .query.ts files (default: true) */
    generateQueryFiles?: boolean;
  };
  /** Optional debug configuration */
  debug?: {
    /** Enable verbose logging */
    verbose?: boolean;
    /** Log LLM prompts sent to the provider */
    logPrompts?: boolean;
    /** Log LLM responses received from the provider */
    logResponses?: boolean;
    /** Log token usage for each query */
    logTokenUsage?: boolean;
    /** Output debug logs to a file */
    logFile?: string;
  };
}

/**
 * Query collected from source code analysis
 * 
 * Represents a db.llm() call found during AST parsing, containing all
 * information needed to generate the corresponding SQL query.
 */
export interface CollectedQuery {
  /** Unique identifier for the query (generated from intent hash) */
  id: string;
  /** Natural language intent describing the desired query */
  intent: string;
  /** Optional parameters extracted from the db.llm() call */
  params?: Record<string, any>;
  /** Optional TypeScript return type annotation */
  returnType?: string;
  /** Source code location information */
  location: {
    /** File path where the query was found */
    file: string;
    /** Line number in the source file */
    line: number;
    /** Column number in the source file */
    column: number;
  };
  /** Database method information (get/all) for result expectation */
  methodInfo?: {
    method: string;
    expectsMultiple: boolean;
  };
  /** Source file path (used for distributed query generation) */
  sourceFile?: string;
}

/**
 * Generated SQL query with metadata and validation results
 * 
 * Represents the final output of the LLM generation process, including
 * the generated SQL, validation results, and all metadata needed for runtime execution.
 */
export interface GeneratedQuery {
  /** Unique identifier matching the original CollectedQuery */
  id: string;
  /** Original natural language intent */
  intent: string;
  /** Generated SQL query string with parameter placeholders */
  sql: string;
  /** Array of parameter names in the order they appear in the SQL */
  parameters: string[];
  /** TypeScript return type for the query results */
  returnType: string;
  /** Hash of the query content for change detection */
  hash: string;
  /** Source file path for distributed query generation */
  sourceFile?: string;
}

/**
 * Database schema information
 */
export interface SchemaInfo {
  tables: TableInfo[];
  relations: RelationInfo[];
}

/**
 * Database table information
 */
export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  primaryKey?: string[];
}

/**
 * Database column information
 */
export interface ColumnInfo {
  name: string;
  dbName?: string; // Actual database column name (e.g., 'created_at' for 'createdAt')
  type: string;
  nullable?: boolean;
  defaultValue?: any;
  enumValues?: string[];
  constraints?: string[];
  references?: {
    table: string;
    column: string;
  };
}

/**
 * Database relation information
 */
export interface RelationInfo {
  table: string;
  referencedTable: string;
  columns: string[];
  referencedColumns: string[];
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
}

/**
 * Response from LLM provider containing generated SQL and metadata
 */
export interface LLMResponse {
  /** Generated SQL query string */
  sql: string;
  /** Optional token usage information for cost tracking */
  tokensUsed?: {
    /** Input tokens consumed */
    input: number;
    /** Output tokens generated */
    output: number;
    /** Total tokens used */
    total: number;
  };
}

/**
 * Interface for LLM provider implementations (OpenAI, Anthropic, etc.)
 */
export interface LLMProvider {
  /**
   * Generate a SQL query based on natural language prompt and database schema
   * @param prompt - Natural language description of the desired query
   * @param schema - Database schema information for context
   * @returns Promise resolving to LLM response with generated SQL
   */
  generateQuery(prompt: string, schema: SchemaInfo): Promise<LLMResponse>;
}

/**
 * Cache entry for storing generated queries to avoid redundant LLM calls
 */
export interface CacheEntry {
  /** Hash of the original query parameters for cache key */
  hash: string;
  /** Cached generated query object */
  query: GeneratedQuery;
  /** Timestamp when the entry was created */
  timestamp: number;
}