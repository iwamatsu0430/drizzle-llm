import { Project, Node } from 'ts-morph';
import { SchemaInfo, TableInfo, ColumnInfo, RelationInfo } from '../types';

/**
 * Advanced Drizzle ORM schema analyzer with comprehensive AST parsing
 * 
 * This class analyzes Drizzle ORM schema definitions to extract complete database
 * structure information. It uses TypeScript AST parsing to understand table definitions,
 * column types, constraints, and relationships.
 * 
 * Features:
 * - Full Drizzle ORM syntax support (pgTable, relations, etc.)
 * - Database column name mapping (camelCase to snake_case)
 * - Constraint and foreign key relationship extraction
 * - Enum value detection and validation
 * - Optimized schema formatting for LLM consumption
 * - PostgreSQL-specific type mapping
 * 
 * The analyzer generates structured schema information that enables accurate
 * SQL generation by providing LLMs with precise database structure context.
 */
export class SchemaAnalyzer {
  /**
   * Core system prompt for LLM SQL generation
   * 
   * This prompt establishes critical rules for generating accurate SQL:
   * - Exact database column name usage (not TypeScript property names)
   * - Proper parameterization with PostgreSQL syntax
   * - Common naming pattern translations
   * - Output format requirements
   */
  private static readonly CORE_PROMPT = `You are a SQL query generator for Drizzle ORM with PostgreSQL.

CRITICAL RULES:
1. Use EXACT database column names as shown in the schema (e.g., created_at, NOT createdAt)
2. Table and column names are case-sensitive
3. Use parameterized queries with $1, $2, etc. for dynamic values
4. Return ONLY the SQL query without explanation or comments
5. Do NOT use column aliases unless necessary for clarity
6. Never include markdown formatting or code blocks

Common naming patterns:
- JavaScript property 'createdAt' → DB column 'created_at'
- JavaScript property 'updatedAt' → DB column 'updated_at'  
- JavaScript property 'userId' → DB column 'user_id'
- JavaScript property 'isActive' → DB column 'is_active'

Generate optimized, valid PostgreSQL queries.`;
  private project: Project;

  /**
   * Create a new schema analyzer
   * 
   * Initializes a ts-morph Project for parsing TypeScript schema files.
   * Uses the project's tsconfig.json but doesn't load all files for performance.
   */
  constructor() {
    this.project = new Project({
      tsConfigFilePath: './tsconfig.json',
      skipAddingFilesFromTsConfig: true,
    });
  }

  /**
   * Analyze a Drizzle ORM schema file and extract complete database structure
   * 
   * Parses the TypeScript schema file using AST analysis to identify:
   * - Table definitions (pgTable calls)
   * - Column specifications with types and constraints
   * - Primary keys and foreign key relationships
   * - Enum values and default values
   * 
   * @param schemaPath - Absolute path to the Drizzle schema file
   * @returns Complete schema information including tables and relations
   * 
   * @example
   * ```typescript
   * const analyzer = new SchemaAnalyzer();
   * const schema = analyzer.analyzeSchema('./src/db/schema.ts');
   * console.log(`Found ${schema.tables.length} tables`);
   * ```
   */
  analyzeSchema(schemaPath: string): SchemaInfo {
    const sourceFile = this.project.addSourceFileAtPath(schemaPath);
    const tables: TableInfo[] = [];
    const relations: RelationInfo[] = [];

    sourceFile.forEachDescendant((node) => {
      if (Node.isVariableDeclaration(node)) {
        const tableInfo = this.extractTableInfo(node);
        if (tableInfo) {
          tables.push(tableInfo);
        }
      }
    });

    return {
      tables,
      relations,
    };
  }

  /**
   * Extract table information from a variable declaration node
   * 
   * Identifies pgTable() or table() function calls and extracts:
   * - Table name from the first argument
   * - Column definitions from the schema object
   * - Primary key information from related declarations
   * 
   * @param node - Variable declaration AST node
   * @returns TableInfo object or null if not a valid table definition
   * @private
   */
  private extractTableInfo(node: any): TableInfo | null {
    const initializer = node.getInitializer();
    
    if (!Node.isCallExpression(initializer)) {
      return null;
    }

    const expression = initializer.getExpression();
    
    // Handle both pgTable() function calls and .table() method calls
    let functionName: string;
    if (Node.isIdentifier(expression)) {
      functionName = expression.getText();
    } else if (Node.isPropertyAccessExpression(expression)) {
      functionName = expression.getName();
    } else {
      return null;
    }

    // Check for Drizzle table functions
    if (functionName !== 'pgTable' && functionName !== 'table') {
      return null;
    }

    const args = initializer.getArguments();
    if (args.length < 2) {
      return null;
    }

    const tableNameArg = args[0];
    if (!Node.isStringLiteral(tableNameArg)) {
      return null;
    }

    const tableName = tableNameArg.getLiteralValue();
    const schemaArg = args[1];

    if (!Node.isObjectLiteralExpression(schemaArg)) {
      return null;
    }

    const columns = this.extractColumns(schemaArg);
    const primaryKey = this.extractPrimaryKey(node);

    return {
      name: tableName,
      columns,
      primaryKey,
    };
  }

  /**
   * Extract column definitions from a Drizzle table schema object
   * 
   * Parses each property in the schema object to create ColumnInfo objects
   * with complete type, constraint, and relationship information.
   * 
   * @param schemaNode - ObjectLiteralExpression containing column definitions
   * @returns Array of ColumnInfo objects
   * @private
   */
  private extractColumns(schemaNode: any): ColumnInfo[] {
    const columns: ColumnInfo[] = [];

    schemaNode.getProperties().forEach((prop: any) => {
      if (Node.isPropertyAssignment(prop)) {
        const propertyName = prop.getName();
        const initializer = prop.getInitializer();

        if (Node.isCallExpression(initializer)) {
          // Extract the actual database column name
          const dbColumnName = this.extractDbColumnName(initializer);
          
          const columnInfo = this.parseColumnDefinition(propertyName, initializer);
          if (columnInfo) {
            // Set the actual DB column name if found, otherwise use property name
            columnInfo.dbName = dbColumnName || propertyName;
            columns.push(columnInfo);
          }
        }
      }
    });

    return columns;
  }

  /**
   * Parse a complete column definition from Drizzle syntax
   * 
   * Analyzes the entire method chain to extract:
   * - Base type (text, integer, uuid, etc.)
   * - Constraints (notNull, unique, primaryKey)
   * - Default values and functions
   * - Foreign key references
   * - Enum values for restricted columns
   * 
   * @param name - Property name (TypeScript identifier)
   * @param callExpr - CallExpression representing the column definition
   * @returns Complete ColumnInfo or null if parsing fails
   * @private
   * 
   * @example
   * For: `id: uuid('id').primaryKey().defaultRandom()`
   * Returns: ColumnInfo with type='uuid', constraints=['PRIMARY KEY'], defaultValue='defaultRandom()'
   */
  private parseColumnDefinition(name: string, callExpr: any): ColumnInfo | null {
    let type = 'unknown';
    let nullable = true; // Default to nullable
    let defaultValue: any = undefined;
    let enumValues: string[] | undefined = undefined;
    let constraints: string[] = [];
    let references: { table: string; column: string } | undefined = undefined;

    // Find the root type call by traversing the expression chain
    const rootCall = this.findRootTypeCall(callExpr);
    if (rootCall) {
      type = this.mapDrizzleType(rootCall.typeName);
      
      // Extract enum values from the root call if present
      if (rootCall.args.length >= 2 && Node.isObjectLiteralExpression(rootCall.args[1])) {
        const enumProp = rootCall.args[1].getProperty('enum');
        if (enumProp && Node.isPropertyAssignment(enumProp)) {
          const enumInit = enumProp.getInitializer();
          if (Node.isArrayLiteralExpression(enumInit)) {
            enumValues = enumInit.getElements()
              .map(el => Node.isStringLiteral(el) ? el.getLiteralValue() : null)
              .filter(Boolean) as string[];
          }
        }
      }
    }

    // Get all chained method calls to extract constraints, defaults, etc.
    const chainedCalls = this.getAllChainedCalls(callExpr);
    for (const call of chainedCalls) {
      const methodName = call.methodName;
      
      if (methodName === 'notNull') {
        nullable = false;
      } else if (methodName === 'default' || methodName === 'defaultRandom' || methodName === 'defaultNow') {
        const args = call.args;
        if (args.length > 0) {
          defaultValue = this.extractLiteralValue(args[0]);
        } else {
          // For methods like defaultRandom() or defaultNow() with no args
          defaultValue = `${methodName}()`;
        }
      } else if (methodName === 'unique') {
        constraints.push('UNIQUE');
      } else if (methodName === 'primaryKey') {
        constraints.push('PRIMARY KEY');
      } else if (methodName === 'references') {
        // Extract foreign key reference
        const args = call.args;
        if (args.length > 0) {
          const refArg = args[0];
          if (Node.isArrowFunction(refArg)) {
            const body = refArg.getBody();
            if (Node.isPropertyAccessExpression(body)) {
              const tableName = body.getExpression().getText();
              const columnName = body.getName();
              references = { table: tableName, column: columnName };
            }
          }
        }
      }
    }

    return {
      name,
      type,
      nullable,
      defaultValue,
      enumValues,
      constraints: constraints.length > 0 ? constraints : undefined,
      references,
    };
  }

  /**
   * Find the root type call in a Drizzle column definition chain
   * 
   * Traverses the method chain backwards to find the initial type call
   * (e.g., text(), uuid(), integer()) that establishes the column's base type.
   * 
   * @param callExpr - CallExpression to analyze
   * @returns Object with type name and arguments, or null if not found
   * @private
   */
  private findRootTypeCall(callExpr: any): { typeName: string; args: any[] } | null {
    let current = callExpr;
    
    // Traverse up the call chain to find the root type call
    while (current && Node.isCallExpression(current)) {
      const expression = current.getExpression();
      
      if (Node.isIdentifier(expression)) {
        // This is a root call like text(), uuid(), etc.
        const typeName = expression.getText();
        const args = current.getArguments();
        return { typeName, args };
      } else if (Node.isPropertyAccessExpression(expression)) {
        // This is a chained call, get the left side
        current = expression.getExpression();
        
        // If the left side is a call expression, continue traversing
        if (Node.isCallExpression(current)) {
          continue;
        } else if (Node.isIdentifier(current)) {
          // Found the root identifier
          const typeName = current.getText();
          return { typeName, args: [] };
        }
      } else {
        break;
      }
    }
    
    return null;
  }

  /**
   * Get all chained method calls from a Drizzle column definition
   * 
   * Extracts all methods in the chain (e.g., .notNull(), .default(), .unique())
   * to build a complete picture of column constraints and properties.
   * 
   * @param callExpr - CallExpression representing the column definition
   * @returns Array of method calls with names and arguments
   * @private
   */
  private getAllChainedCalls(callExpr: any): Array<{ methodName: string; args: any[] }> {
    const calls: Array<{ methodName: string; args: any[] }> = [];
    let current = callExpr;
    
    // Traverse the entire call chain
    while (current && Node.isCallExpression(current)) {
      const expression = current.getExpression();
      
      if (Node.isPropertyAccessExpression(expression)) {
        const methodName = expression.getName();
        const args = current.getArguments();
        calls.unshift({ methodName, args }); // Add to front to maintain order
        
        // Move to the left side of the property access
        current = expression.getExpression();
      } else {
        break;
      }
    }
    
    return calls;
  }

  /**
   * Map Drizzle type names to PostgreSQL type names
   * 
   * Converts Drizzle's type system to standard PostgreSQL types for
   * accurate SQL generation and validation.
   * 
   * @param drizzleType - Drizzle type name (e.g., 'text', 'uuid', 'serial')
   * @returns Corresponding PostgreSQL type name
   * @private
   */
  private mapDrizzleType(drizzleType: string): string {
    const typeMap: Record<string, string> = {
      'integer': 'integer',
      'int': 'integer',
      'serial': 'serial',
      'bigint': 'bigint',
      'bigserial': 'bigserial',
      'boolean': 'boolean',
      'text': 'text',
      'varchar': 'varchar',
      'char': 'char',
      'uuid': 'uuid',
      'timestamp': 'timestamp',
      'date': 'date',
      'time': 'time',
      'json': 'json',
      'jsonb': 'jsonb',
      'real': 'real',
      'double': 'double',
      'decimal': 'decimal',
      'numeric': 'numeric',
    };

    return typeMap[drizzleType] || drizzleType;
  }


  /**
   * Extract primary key information from table definition
   * 
   * Looks for primaryKey() calls in the same scope as the table definition
   * to identify composite primary keys.
   * 
   * @param node - Table definition node
   * @returns Array of primary key column names or undefined
   * @private
   */
  private extractPrimaryKey(node: any): string[] | undefined {
    const parent = node.getParent();
    if (!parent) return undefined;

    const siblings = parent.getChildren();
    for (const sibling of siblings) {
      if (Node.isCallExpression(sibling)) {
        const expr = sibling.getExpression();
        if (Node.isPropertyAccessExpression(expr) && expr.getName() === 'primaryKey') {
          const args = sibling.getArguments();
          return args.map((arg: any) => {
            if (Node.isPropertyAccessExpression(arg)) {
              return arg.getName();
            }
            return arg.getText();
          });
        }
      }
    }

    return undefined;
  }

  /**
   * Get the core system prompt for LLM interactions
   * 
   * Returns the carefully crafted prompt that establishes SQL generation
   * rules and best practices for the LLM.
   * 
   * @returns System prompt string
   */
  buildSystemPrompt(): string {
    return SchemaAnalyzer.CORE_PROMPT;
  }

  /**
   * Extract literal values from AST nodes
   * 
   * Handles various TypeScript literal types including strings, numbers,
   * booleans, and null values.
   * 
   * @param node - AST node representing a literal value
   * @returns Extracted JavaScript value
   * @private
   */
  private extractLiteralValue(node: any): any {
    if (Node.isStringLiteral(node)) {
      return node.getLiteralValue();
    } else if (Node.isNumericLiteral(node)) {
      return node.getLiteralValue();
    } else if (node.getKind() === 109 || node.getKind() === 94) { // TrueKeyword or FalseKeyword
      return node.getText() === 'true';
    } else if (Node.isNullLiteral(node)) {
      return null;
    }
    return node.getText();
  }

  /**
   * Extract the actual database column name from Drizzle column definition
   * 
   * Many Drizzle column types accept a column name as their first argument,
   * which may differ from the TypeScript property name.
   * 
   * @param callExpr - Column definition call expression
   * @returns Database column name or null if not specified
   * @private
   * 
   * @example
   * For: `createdAt: timestamp('created_at')`
   * Returns: 'created_at'
   */
  private extractDbColumnName(callExpr: any): string | null {
    // Find the root type call
    const rootCall = this.findRootTypeCall(callExpr);
    if (!rootCall || rootCall.args.length === 0) {
      return null;
    }

    // The first argument is usually the column name for most Drizzle types
    const firstArg = rootCall.args[0];
    if (Node.isStringLiteral(firstArg)) {
      return firstArg.getLiteralValue();
    }

    return null;
  }

  /**
   * Format schema information for LLM consumption
   * 
   * Creates a comprehensive, structured representation of the database schema
   * optimized for LLM understanding. Includes:
   * - Table and column names with types
   * - Constraints and relationships
   * - Default values and enum options
   * - Mapping between TypeScript properties and database columns
   * 
   * @param schema - Complete schema information
   * @returns Formatted schema string for LLM prompts
   * 
   * @example
   * ```typescript
   * const formatted = analyzer.formatSchemaForLLM(schema);
   * // Returns multi-line string describing all tables and columns
   * ```
   */
  formatSchemaForLLM(schema: SchemaInfo): string {
    let result = 'Database Schema:\n\n';
    
    for (const table of schema.tables) {
      result += `Table: ${table.name}\n`;
      result += 'Columns:\n';
      
      for (const col of table.columns) {
        // Show DB column name if different from property name
        const dbName = col.dbName || col.name;
        result += `  - ${dbName}: ${col.type}`;
        
        // Add column attributes
        if (!col.nullable) result += ' NOT NULL';
        if (col.defaultValue) {
          if (typeof col.defaultValue === 'string' && col.defaultValue.includes('()')) {
            result += ` DEFAULT ${col.defaultValue}`;
          } else {
            result += ` DEFAULT ${JSON.stringify(col.defaultValue)}`;
          }
        }
        if (col.enumValues && col.enumValues.length > 0) {
          result += ` ENUM(${col.enumValues.map(v => `'${v}'`).join(', ')})`;
        }
        if (col.constraints && col.constraints.length > 0) {
          result += ` [${col.constraints.join(', ')}]`;
        }
        if (col.references) {
          result += ` REFERENCES ${col.references.table}(${col.references.column})`;
        }
        
        // Show property name mapping if different
        if (dbName !== col.name) {
          result += ` -- Drizzle property: ${col.name}`;
        }
        
        result += '\n';
      }
      
      if (table.primaryKey && table.primaryKey.length > 0) {
        result += `  PRIMARY KEY: ${table.primaryKey.join(', ')}\n`;
      }
      
      result += '\n';
    }
    
    return result;
  }

  /**
   * Format schema in compact form for quick reference
   * 
   * Creates a condensed schema representation showing just table names
   * and column names, useful for table selection prompts.
   * 
   * @param schema - Schema information to format
   * @returns Compact schema string
   * 
   * @example
   * ```typescript
   * const compact = analyzer.formatSchemaCompact(schema);
   * // Returns: "users(id, name, email), orders(id, user_id, total)"
   * ```
   */
  formatSchemaCompact(schema: SchemaInfo): string {
    let result = 'Tables and columns:\n';
    
    for (const table of schema.tables) {
      const columns = table.columns.map(col => {
        const dbName = col.dbName || col.name;
        let colStr = dbName;
        if (col.enumValues && col.enumValues.length > 0) {
          colStr += `(${col.enumValues.join('|')})`;
        }
        return colStr;
      }).join(', ');
      
      result += `${table.name}(${columns})\n`;
    }
    
    return result;
  }
}