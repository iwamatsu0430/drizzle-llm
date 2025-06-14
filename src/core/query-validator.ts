import { SchemaInfo, GeneratedQuery } from '../types';

/**
 * Result of query validation containing validation status and detailed feedback
 */
export interface ValidationResult {
  /** Whether all validations passed without errors */
  isValid: boolean;
  /** Array of validation errors that must be fixed */
  errors: ValidationError[];
  /** Array of validation warnings that should be addressed */
  warnings: ValidationWarning[];
}

/**
 * Validation error with detailed information for debugging and LLM re-requests
 */
export interface ValidationError {
  /** Category of validation error */
  type: 'syntax' | 'schema' | 'security' | 'performance';
  /** Human-readable error message */
  message: string;
  /** Optional suggestion for fixing the error */
  suggestion?: string;
  /** ID of the query that failed validation */
  queryId: string;
  /** Optional SQL fragment where the error occurred */
  sqlFragment?: string;
  /** Detailed information for LLM re-requests and debugging */
  problemDetails?: {
    /** Specific type of problem for categorization */
    problemType: 'column_not_found' | 'table_not_found' | 'syntax_error' | 'security_issue' | 'other';
    /** The problematic column or table name */
    invalidElement?: string;
    /** Available column or table names as alternatives */
    availableOptions?: string[];
    /** Additional context information for debugging */
    context?: string;
  };
}

/**
 * Validation warning for potential issues that don't prevent query execution
 */
export interface ValidationWarning {
  /** Category of validation warning */
  type: 'performance' | 'style' | 'compatibility' | 'security';
  /** Human-readable warning message */
  message: string;
  /** Optional suggestion for improving the query */
  suggestion?: string;
  /** ID of the query that triggered the warning */
  queryId: string;
  /** Optional SQL fragment related to the warning */
  sqlFragment?: string;
}

/**
 * Comprehensive SQL query validator for generated queries
 * 
 * Performs multi-layered validation including:
 * - SQL syntax validation
 * - Database schema consistency checks
 * - Security vulnerability detection
 * - Performance optimization recommendations
 * 
 * The validator is designed to catch common issues in LLM-generated SQL
 * and provide actionable feedback for improvement.
 */
export class QueryValidator {
  private schema: SchemaInfo;
  
  /**
   * Create a new query validator
   * @param schema - Database schema information for validation
   */
  constructor(schema: SchemaInfo) {
    this.schema = schema;
  }

  /**
   * Validate multiple queries and aggregate results
   * 
   * Processes an array of generated queries and combines all validation
   * results into a single comprehensive report. Useful for batch validation
   * during the build process.
   * 
   * @param queries - Array of generated queries to validate
   * @returns Aggregated validation result with all errors and warnings
   * 
   * @example
   * ```typescript
   * const validator = new QueryValidator(schemaInfo);
   * const result = validator.validateQueries(generatedQueries);
   * 
   * if (!result.isValid) {
   *   console.log(`Found ${result.errors.length} errors`);
   *   result.errors.forEach(error => console.log(error.message));
   * }
   * ```
   */
  validateQueries(queries: GeneratedQuery[]): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    for (const query of queries) {
      const result = this.validateSingleQuery(query);
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate a single generated query through comprehensive analysis
   * 
   * Performs a complete validation pipeline on a single query:
   * 1. **Syntax validation**: Checks for basic SQL syntax correctness
   * 2. **Schema validation**: Verifies table and column references exist
   * 3. **Security validation**: Detects potential security vulnerabilities
   * 4. **Performance validation**: Identifies potential performance issues
   * 
   * Each validation layer can contribute both errors (blocking issues) and
   * warnings (recommendations for improvement).
   * 
   * @param query - Generated query object containing SQL, parameters, and metadata
   * @returns Detailed validation result with categorized errors and warnings
   * 
   * @example
   * ```typescript
   * const result = validator.validateSingleQuery({
   *   id: 'q1',
   *   sql: 'SELECT * FROM users WHERE active = $1',
   *   parameters: ['active'],
   *   // ... other properties
   * });
   * 
   * if (result.isValid) {
   *   console.log('Query is valid!');
   * } else {
   *   result.errors.forEach(error => {
   *     console.log(`${error.type}: ${error.message}`);
   *   });
   * }
   * ```
   */
  validateSingleQuery(query: GeneratedQuery): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // 1. Basic SQL syntax validation
    const syntaxResult = this.validateSyntax(query);
    errors.push(...syntaxResult.errors);
    warnings.push(...syntaxResult.warnings);

    // 2. Schema consistency validation
    const schemaResult = this.validateSchema(query);
    errors.push(...schemaResult.errors);
    warnings.push(...schemaResult.warnings);

    // 3. Security validation
    const securityResult = this.validateSecurity(query);
    errors.push(...securityResult.errors);
    warnings.push(...securityResult.warnings);

    // 4. Performance validation
    const performanceResult = this.validatePerformance(query);
    warnings.push(...performanceResult.warnings);

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate basic SQL syntax and structure
   * 
   * Performs fundamental SQL validation including:
   * - Presence of required SQL keywords (SELECT, etc.)
   * - Detection of dangerous operations (DROP, DELETE, etc.)
   * - Parameter placeholder validation ($1, $2, etc.)
   * - Parameter count consistency
   * 
   * This is the first line of defense against malformed or dangerous SQL.
   * 
   * @param query - Generated query to validate
   * @returns Validation result with syntax-related errors and warnings
   * 
   * @private
   */
  private validateSyntax(query: GeneratedQuery): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const sql = query.sql.toLowerCase();

    // Check for required keywords
    if (!sql.includes('select')) {
      errors.push({
        type: 'syntax',
        message: 'Query must contain SELECT statement',
        queryId: query.id,
        sqlFragment: query.sql.substring(0, 50)
      });
    }

    // Check for dangerous keywords
    const dangerousKeywords = ['drop', 'delete', 'truncate', 'alter'];
    for (const keyword of dangerousKeywords) {
      if (sql.includes(keyword)) {
        errors.push({
          type: 'security',
          message: `Dangerous keyword '${keyword}' detected`,
          queryId: query.id,
          suggestion: 'Only SELECT queries are allowed'
        });
      }
    }

    // Check parameterization
    const paramMatches = query.sql.match(/\$\d+/g);
    const expectedParams = paramMatches ? paramMatches.length : 0;
    
    if (expectedParams !== query.parameters.length) {
      errors.push({
        type: 'syntax',
        message: `Parameter count mismatch: expected ${expectedParams}, got ${query.parameters.length}`,
        queryId: query.id,
        suggestion: 'Ensure all placeholders ($1, $2, etc.) have corresponding parameters'
      });
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate database schema consistency
   * 
   * Ensures that all table and column references in the generated SQL
   * actually exist in the provided database schema. This is crucial for
   * catching LLM hallucinations where non-existent database objects are referenced.
   * 
   * Validation includes:
   * - Table name existence in FROM and JOIN clauses
   * - Column name existence within referenced tables
   * - Proper table.column reference format
   * 
   * Provides detailed error information including available alternatives
   * to help with debugging and LLM prompt improvement.
   * 
   * @param query - Generated query to validate against schema
   * @returns Validation result with schema-related errors and suggestions
   * 
   * @private
   */
  private validateSchema(query: GeneratedQuery): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const sql = query.sql;

    // Validate table names
    const tableNames = this.extractTableNames(sql);
    const schemaTableNames = this.schema.tables.map(t => t.name);

    for (const tableName of tableNames) {
      if (!schemaTableNames.includes(tableName)) {
        errors.push({
          type: 'schema',
          message: `Table '${tableName}' does not exist in schema`,
          queryId: query.id,
          suggestion: `Available tables: ${schemaTableNames.join(', ')}`,
          problemDetails: {
            problemType: 'table_not_found',
            invalidElement: tableName,
            availableOptions: schemaTableNames,
            context: `Query attempted to use table "${tableName}" which does not exist in the database schema`
          }
        });
      }
    }

    // Validate column names
    const columnReferences = this.extractColumnReferences(sql);
    for (const { table, column } of columnReferences) {
      const schemaTable = this.schema.tables.find(t => t.name === table);
      if (schemaTable) {
        const columnExists = schemaTable.columns.some(c => c.name === column);
        if (!columnExists) {
          const availableColumns = schemaTable.columns.map(c => c.name);
          errors.push({
            type: 'schema',
            message: `Column '${column}' does not exist in table '${table}'`,
            queryId: query.id,
            suggestion: `Available columns in ${table}: ${availableColumns.join(', ')}`,
            problemDetails: {
              problemType: 'column_not_found',
              invalidElement: column,
              availableOptions: availableColumns,
              context: `Query attempted to use column "${column}" in table "${table}", but this column does not exist. Consider using one of the available columns instead.`
            }
          });
        }
      }
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate security aspects of the generated query
   * 
   * Scans for common security vulnerabilities and potential risks:
   * - SQL injection vulnerabilities (unparameterized string literals)
   * - Queries that could return excessive data (missing WHERE/LIMIT)
   * - Use of potentially dangerous SQL constructs
   * 
   * Most security issues are reported as warnings rather than errors,
   * allowing the query to be used but flagging potential concerns.
   * 
   * @param query - Generated query to validate for security issues
   * @returns Validation result with security warnings and recommendations
   * 
   * @private
   */
  private validateSecurity(query: GeneratedQuery): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];
    const sql = query.sql.toLowerCase();

    // Check for SQL injection vulnerabilities
    if (sql.includes("'") && !sql.match(/\$\d+/)) {
      warnings.push({
        type: 'security',
        message: 'Query contains string literals - consider using parameters',
        queryId: query.id,
        suggestion: 'Use parameterized queries ($1, $2, etc.) instead of string concatenation'
      });
    }

    // Warn about fetching all rows
    if (!sql.includes('where') && !sql.includes('limit')) {
      warnings.push({
        type: 'performance',
        message: 'Query may return all rows - consider adding WHERE clause or LIMIT',
        queryId: query.id,
        suggestion: 'Add appropriate filters to limit result set'
      });
    }

    return { isValid: errors.length === 0, errors, warnings };
  }

  /**
   * Validate performance aspects of the generated query
   * 
   * Analyzes the query for potential performance issues and provides
   * optimization recommendations. All issues are reported as warnings
   * since they don't prevent query execution.
   * 
   * Performance checks include:
   * - Detection of implicit cross joins (comma-separated tables)
   * - ORDER BY clauses without LIMIT (can be expensive on large datasets)
   * - Complex queries with many subqueries
   * - Other patterns that may impact query performance
   * 
   * @param query - Generated query to analyze for performance issues
   * @returns Validation result with performance warnings and optimization suggestions
   * 
   * @private
   */
  private validatePerformance(query: GeneratedQuery): ValidationResult {
    const warnings: ValidationWarning[] = [];
    const sql = query.sql.toLowerCase();

    // Multiple table references without JOIN
    if (sql.includes(',') && sql.includes('from') && !sql.includes('join')) {
      warnings.push({
        type: 'performance',
        message: 'Consider using explicit JOINs instead of comma-separated tables',
        queryId: query.id,
        suggestion: 'Use INNER JOIN, LEFT JOIN, etc. for better readability and performance'
      });
    }

    // ORDER BY without LIMIT
    if (sql.includes('order by') && !sql.includes('limit')) {
      warnings.push({
        type: 'performance',
        message: 'ORDER BY without LIMIT may impact performance on large datasets',
        queryId: query.id,
        suggestion: 'Consider adding LIMIT clause if you don\'t need all results'
      });
    }

    // Detect complex subqueries
    const subqueryCount = (sql.match(/select/g) || []).length;
    if (subqueryCount > 3) {
      warnings.push({
        type: 'performance',
        message: 'Complex query with multiple subqueries detected',
        queryId: query.id,
        suggestion: 'Consider breaking down into simpler queries or using CTEs'
      });
    }

    return { isValid: true, errors: [], warnings };
  }

  /**
   * Extract table names from SQL query using regex patterns
   * 
   * Parses FROM and JOIN clauses to identify all table references.
   * This is used for schema validation to ensure all referenced
   * tables actually exist in the database schema.
   * 
   * @param sql - SQL query string to analyze
   * @returns Array of unique table names found in the query
   * 
   * @private
   * 
   * @example
   * ```typescript
   * const tables = this.extractTableNames('SELECT * FROM users u JOIN orders o ON u.id = o.user_id');
   * // Returns: ['users', 'orders']
   * ```
   */
  private extractTableNames(sql: string): string[] {
    const tableNames: string[] = [];
    
    // Extract table names from FROM and JOIN clauses
    const patterns = [
      /from\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi,
      /join\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(sql)) !== null) {
        const tableName = match[1].replace(/"/g, '');
        if (!tableNames.includes(tableName)) {
          tableNames.push(tableName);
        }
      }
    }

    return tableNames;
  }

  /**
   * Extract column references from SQL query using qualified table.column syntax
   * 
   * Identifies all qualified column references (table.column format) in the SQL.
   * This is used for schema validation to ensure that referenced columns
   * actually exist in their respective tables.
   * 
   * Only processes explicitly qualified references (table.column) and does not
   * attempt to resolve unqualified column names, as that would require complex
   * SQL parsing and context analysis.
   * 
   * @param sql - SQL query string to analyze
   * @returns Array of objects containing table and column name pairs
   * 
   * @private
   * 
   * @example
   * ```typescript
   * const refs = this.extractColumnReferences('SELECT u.name, o.total FROM users u JOIN orders o');
   * // Returns: [{ table: 'u', column: 'name' }, { table: 'o', column: 'total' }]
   * ```
   */
  private extractColumnReferences(sql: string): Array<{ table: string; column: string }> {
    const references: Array<{ table: string; column: string }> = [];
    
    // Search for "table"."column" patterns
    const pattern = /"?([a-zA-Z_][a-zA-Z0-9_]*)"?\."?([a-zA-Z_][a-zA-Z0-9_]*)"?/g;
    let match;
    
    while ((match = pattern.exec(sql)) !== null) {
      const table = match[1].replace(/"/g, '');
      const column = match[2].replace(/"/g, '');
      references.push({ table, column });
    }

    return references;
  }

  /**
   * Print formatted validation results to the console
   * 
   * Provides a comprehensive, human-readable report of validation results
   * including:
   * - Overall validation status
   * - Detailed error messages with suggestions
   * - Problem details for LLM re-request scenarios
   * - Performance and security warnings
   * 
   * This is primarily used during development and debugging to understand
   * validation failures and get actionable feedback for improvement.
   * 
   * @param result - Complete validation result to format and display
   * 
   * @static
   * 
   * @example
   * ```typescript
   * const result = validator.validateQueries(queries);
   * QueryValidator.printValidationResult(result);
   * // Outputs formatted validation report to console
   * ```
   */
  static printValidationResult(result: ValidationResult): void {
    console.log('\n🔍 Query Validation Results:');
    
    if (result.isValid) {
      console.log('✅ All queries passed validation!');
    } else {
      console.log(`❌ Found ${result.errors.length} error(s)`);
    }

    if (result.warnings.length > 0) {
      console.log(`⚠️  Found ${result.warnings.length} warning(s)`);
    }

    // Display errors
    if (result.errors.length > 0) {
      console.log('\n❌ Errors:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. [${error.type.toUpperCase()}] ${error.message}`);
        console.log(`     Query ID: ${error.queryId}`);
        if (error.suggestion) {
          console.log(`     Suggestion: ${error.suggestion}`);
        }
        if (error.sqlFragment) {
          console.log(`     SQL Fragment: ${error.sqlFragment}...`);
        }
        // Display detailed information for LLM re-requests
        if (error.problemDetails) {
          console.log(`     🔧 Problem Details:`);
          console.log(`        Type: ${error.problemDetails.problemType}`);
          if (error.problemDetails.invalidElement) {
            console.log(`        Invalid Element: "${error.problemDetails.invalidElement}"`);
          }
          if (error.problemDetails.availableOptions) {
            console.log(`        Available Options: [${error.problemDetails.availableOptions.join(', ')}]`);
          }
          if (error.problemDetails.context) {
            console.log(`        Context: ${error.problemDetails.context}`);
          }
        }
        console.log('');
      });
    }

    // Display warnings
    if (result.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      result.warnings.forEach((warning, index) => {
        console.log(`  ${index + 1}. [${warning.type.toUpperCase()}] ${warning.message}`);
        console.log(`     Query ID: ${warning.queryId}`);
        if (warning.suggestion) {
          console.log(`     Suggestion: ${warning.suggestion}`);
        }
        console.log('');
      });
    }
  }
}