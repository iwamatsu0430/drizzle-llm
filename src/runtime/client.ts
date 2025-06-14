/**
 * Interface for executing SQL queries against a database
 * 
 * This abstraction allows the LLM client to work with different database
 * drivers and ORMs by providing a consistent execution interface.
 */
export interface QueryExecutor {
  /**
   * Execute a SQL query with parameters
   * @param sql - SQL query string with parameter placeholders
   * @param params - Query parameters as array or object
   * @returns Promise resolving to array of result rows
   */
  execute<T = any>(sql: string, params: any[] | Record<string, any>): Promise<T[]>;
}

/**
 * Interface for the LLM extension that adds natural language query capabilities
 * 
 * This interface defines the contract for the db.llm() method that allows
 * developers to write queries using natural language intents instead of SQL.
 */
export interface LLMExtension {
  /**
   * Execute a query based on natural language intent
   * @param intent - Natural language description of the desired query
   * @param params - Optional parameters for the query
   * @returns Promise resolving to typed query results
   */
  llm<T = any>(intent: string, params?: Record<string, any>): Promise<T[]>;
}

/**
 * Runtime client for executing LLM-generated queries
 * 
 * This class provides the core functionality for the db.llm() method,
 * handling query lookup, parameter binding, validation, and execution.
 * It bridges the gap between natural language intents and actual SQL execution.
 * 
 * Features:
 * - Intent-based query lookup with exact and fuzzy matching
 * - Parameter validation and type-safe binding
 * - Query validation checking before execution
 * - Comprehensive error handling and debugging information
 */
export class DrizzleLLMClient {
  private executor: QueryExecutor;
  private generatedQueries: Record<string, { sql: string; parameters: string[]; hash: string; isValid?: boolean; validationErrors?: string[] }>;
  private intentToId: Record<string, string>;

  /**
   * Create a new Drizzle LLM client
   * @param executor - Database query executor implementation
   * @param generatedQueries - Map of query IDs to generated query configurations
   * @param intentToId - Map of intent strings to query IDs for fast lookup
   */
  constructor(executor: QueryExecutor, generatedQueries: Record<string, any>, intentToId: Record<string, string>) {
    this.executor = executor;
    this.generatedQueries = generatedQueries;
    this.intentToId = intentToId;
  }

  /**
   * Execute a query based on natural language intent
   * 
   * This is the main method that developers use to execute LLM-generated queries.
   * It performs the following steps:
   * 1. Looks up the generated SQL based on the intent string
   * 2. Validates that the query passed build-time validation
   * 3. Binds provided parameters to the SQL query
   * 4. Executes the query and returns typed results
   * 
   * @param intent - Natural language description matching a generated query
   * @param params - Parameters to bind to the query (optional)
   * @returns Promise resolving to array of typed query results
   * 
   * @throws {Error} When no matching query is found or query validation failed
   * 
   * @example
   * ```typescript
   * const users = await db.llm<User>('Get all active users');
   * const orders = await db.llm<Order>('Get orders by status', { status: 'pending' });
   * ```
   */
  async llm<T = any>(intent: string, params: Record<string, any> = {}): Promise<T[]> {
    const queryId = this.findQueryByIntent(intent);
    
    if (!queryId) {
      throw new Error(`No generated query found for intent: "${intent}". Make sure to run the build process first.`);
    }

    const queryConfig = this.generatedQueries[queryId];
    
    // Check if query is valid
    if (queryConfig.isValid === false) {
      const errors = queryConfig.validationErrors?.join(', ') || 'Query validation failed';
      throw new Error(`Invalid query for intent "${intent}": ${errors}`);
    }
    
    // Build parameter array in the correct order
    const paramValues = this.buildParameterArray(params, queryConfig.parameters);
    
    return this.executor.execute<T>(queryConfig.sql, paramValues);
  }

  /**
   * Find a query ID based on intent string using exact and fuzzy matching
   * 
   * Uses a two-tier lookup strategy:
   * 1. Exact match using the intentToId mapping (fastest)
   * 2. Fallback fuzzy match for backward compatibility
   * 
   * @param intent - Natural language intent string
   * @returns Query ID if found, null otherwise
   * 
   * @private
   */
  private findQueryByIntent(intent: string): string | null {
    // First try exact match
    if (this.intentToId[intent]) {
      return this.intentToId[intent];
    }
    
    // Fallback to old method for compatibility
    for (const [queryId, config] of Object.entries(this.generatedQueries)) {
      if (queryId.includes(this.normalizeIntent(intent))) {
        return queryId;
      }
    }
    return null;
  }

  /**
   * Normalize an intent string for fuzzy matching
   * 
   * Converts intent strings to a consistent format for comparison:
   * - Converts to lowercase
   * - Removes special characters
   * - Replaces spaces with hyphens
   * - Limits length to 50 characters
   * 
   * @param intent - Raw intent string
   * @returns Normalized intent string
   * 
   * @private
   */
  private normalizeIntent(intent: string): string {
    return intent
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '-')
      .substring(0, 50);
  }

  /**
   * Build parameter array in the correct order for SQL execution
   * 
   * Converts the parameter object to an ordered array matching the
   * SQL parameter placeholders ($1, $2, etc.). Supports both named
   * parameter matching and positional fallback.
   * 
   * @param params - Parameter object provided by the user
   * @param parameterNames - Expected parameter names in correct order
   * @returns Array of parameter values in the correct order
   * 
   * @throws {Error} When required parameters are missing
   * 
   * @private
   */
  private buildParameterArray(params: Record<string, any>, parameterNames: string[]): any[] {
    const values: any[] = [];
    const paramKeys = Object.keys(params);

    for (let i = 0; i < parameterNames.length; i++) {
      const paramName = parameterNames[i];
      let paramValue;
      
      // Try to find the parameter value
      if (params[paramName] !== undefined) {
        paramValue = params[paramName];
      } else if (paramKeys.length > i) {
        // Fallback: use parameter by position if name doesn't match
        paramValue = params[paramKeys[i]];
      } else {
        throw new Error(`Missing required parameter at position ${i + 1}. Expected: "${paramName}"`);
      }
      
      values.push(paramValue);
    }

    return values;
  }

  /**
   * Format a JavaScript value for SQL insertion (debugging/logging purposes)
   * 
   * Converts various JavaScript types to their SQL string representation.
   * This is primarily used for debugging and logging, not for actual query execution.
   * 
   * @param value - JavaScript value to format
   * @returns SQL-formatted string representation
   * 
   * @private
   * @deprecated This method is currently unused but kept for potential debugging use
   */
  private formatValue(value: any): string {
    if (value === null || value === undefined) {
      return 'NULL';
    }
    
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`;
    }
    
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    
    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }
    
    if (typeof value === 'object') {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
    }
    
    return String(value);
  }

  /**
   * Get detailed information about a query without executing it
   * 
   * Useful for debugging, introspection, and development tools.
   * Returns the SQL, parameters, and validation status for a given intent.
   * 
   * @param intent - Natural language intent string
   * @returns Query information object or null if not found
   * 
   * @example
   * ```typescript
   * const info = client.getQueryInfo('Get active users');
   * if (info) {
   *   console.log('SQL:', info.sql);
   *   console.log('Parameters:', info.parameters);
   *   console.log('Is valid:', info.isValid);
   * }
   * ```
   */
  getQueryInfo(intent: string): { sql: string; parameters: string[]; isValid: boolean; validationErrors?: string[] } | null {
    const queryId = this.findQueryByIntent(intent);
    
    if (!queryId) {
      return null;
    }

    const config = this.generatedQueries[queryId];
    return {
      sql: config.sql,
      parameters: config.parameters,
      isValid: config.isValid !== false,
      validationErrors: config.validationErrors
    };
  }

  /**
   * List all available query IDs
   * 
   * Returns an array of all query IDs that can be used for debugging
   * and introspection. Useful for development tools and testing.
   * 
   * @returns Array of query IDs
   * 
   * @example
   * ```typescript
   * const queryIds = client.listAvailableQueries();
   * console.log('Available queries:', queryIds);
   * ```
   */
  listAvailableQueries(): string[] {
    return Object.keys(this.generatedQueries);
  }
}

/**
 * Create an LLM extension for a Drizzle database instance
 * 
 * This function extends a Drizzle database instance with LLM query capabilities,
 * adding the `db.llm()` method and internal client management.
 * 
 * Features:
 * - Integrates with Drizzle ORM's SQL execution system
 * - Handles parameter binding and SQL template creation
 * - Provides comprehensive error handling and logging
 * - Maintains type safety through generics
 * 
 * @param db - Drizzle database instance to extend
 * @param generatedQueries - Map of query IDs to query configurations
 * @param intentToId - Optional map of intents to query IDs for fast lookup
 * @returns Extended database instance with LLM capabilities
 * 
 * @example
 * ```typescript
 * import { drizzle } from 'drizzle-orm/node-postgres';
 * import { createLLMExtension } from 'drizzle-llm/runtime';
 * import { generatedQueries, intentToId } from './generated/queries';
 * 
 * const db = drizzle(pool);
 * const llmDB = createLLMExtension(db, generatedQueries, intentToId);
 * 
 * // Now you can use natural language queries
 * const users = await llmDB.llm('Get all active users');
 * ```
 */
export function createLLMExtension(db: any, generatedQueries: Record<string, any>, intentToId: Record<string, string> = {}): any {
  const executor: QueryExecutor = {
    async execute<T>(sql: string, params: any[] | Record<string, any>): Promise<T[]> {
      try {
        // Import sql template literal from drizzle-orm
        const { sql: sqlTemplate } = await import('drizzle-orm');
        
        // Manually replace parameters in the SQL string
        let processedSql = sql;
        if (Array.isArray(params) && params.length > 0) {
          // Replace $1, $2, etc. with actual values
          params.forEach((param, index) => {
            const placeholder = `$${index + 1}`;
            const value = typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : String(param);
            processedSql = processedSql.replace(placeholder, value);
          });
        }
        
        // Create a raw SQL query
        const query = sqlTemplate.raw(processedSql);
        const result = await db.execute(query);
        return result.rows || result;
      } catch (error) {
        console.error('SQL execution error:', error);
        console.error('SQL:', sql);
        console.error('Params:', params);
        throw error;
      }
    }
  };

  const client = new DrizzleLLMClient(executor, generatedQueries, intentToId);

  return {
    ...db,
    llm: client.llm.bind(client),
    _llmClient: client,
  };
}

/**
 * Convenience alias for createLLMExtension
 * 
 * @param db - Drizzle database instance to extend
 * @param generatedQueries - Map of query IDs to query configurations
 * @param intentToId - Optional map of intents to query IDs
 * @returns Extended database instance with LLM capabilities
 * 
 * @deprecated Use createLLMExtension instead for better clarity
 */
export function extendDrizzle(db: any, generatedQueries: Record<string, any>, intentToId: Record<string, string> = {}) {
  return createLLMExtension(db, generatedQueries, intentToId);
}

/**
 * Create DB extension by automatically collecting distributed query files
 * 
 * This function automatically discovers and loads query files matching the
 * specified pattern, eliminating the need to manually import generated queries.
 * It's particularly useful when using the distributed query file approach.
 * 
 * Features:
 * - Automatic discovery of .query.ts files using glob patterns
 * - Combines queries from multiple files into a single client
 * - Merges intent-to-ID mappings from all discovered files
 * - Graceful handling of missing or invalid query files
 * - Node.js environment detection for safety
 * 
 * @param db - Drizzle database instance to extend
 * @param queryFilesPattern - Glob pattern for finding query files (default: '**\/*.query.ts')
 * @returns Promise resolving to extended database instance with LLM capabilities
 * 
 * @example
 * ```typescript
 * import { drizzle } from 'drizzle-orm/node-postgres';
 * import { extendDrizzleFromDistributed } from 'drizzle-llm/runtime';
 * 
 * const db = drizzle(pool);
 * const llmDB = await extendDrizzleFromDistributed(db, 'src/queries/**\/*.query.ts');
 * 
 * // Automatically includes all queries from discovered files
 * const users = await llmDB.llm('Get all active users');
 * ```
 */
export async function extendDrizzleFromDistributed(db: any, queryFilesPattern: string = '**/*.query.ts'): Promise<any> {
  try {
    // Check if we're in a Node.js environment
    if (typeof process === 'undefined' || typeof process.cwd !== 'function') {
      console.warn('extendDrizzleFromDistributed is only supported in Node.js environment');
      return db;
    }
    
    const { glob } = await import('glob');
    const queryFiles = await glob(queryFilesPattern, { cwd: process.cwd() });
    
    const allQueries: Record<string, any> = {};
    const allIntentToId: Record<string, string> = {};
    
    for (const file of queryFiles) {
      try {
        // Convert relative path to absolute path for import
        const absolutePath = file.startsWith('/') ? file : `${process.cwd()}/${file}`;
        const queryModule = await import(absolutePath);
        
        // Extract queries object (e.g., userQueriesQueries, productQueriesQueries)
        for (const [key, value] of Object.entries(queryModule)) {
          if (key.endsWith('Queries') && typeof value === 'object') {
            Object.assign(allQueries, value);
          }
          if (key.endsWith('IntentToId') && typeof value === 'object') {
            Object.assign(allIntentToId, value);
          }
        }
      } catch (error) {
        console.warn(`Failed to load query file ${file}:`, error);
      }
    }
    
    return createLLMExtension(db, allQueries, allIntentToId);
  } catch (error) {
    console.warn('Failed to load distributed query files:', error);
    return db;
  }
}