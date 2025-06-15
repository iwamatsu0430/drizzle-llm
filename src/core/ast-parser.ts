import { Project, CallExpression, Node, TaggedTemplateExpression } from 'ts-morph';
import { CollectedQuery } from '../types';
import { generateQueryId } from '../utils/hash.js';

/**
 * AST parser for extracting LLM query calls from TypeScript source code
 * 
 * This class uses ts-morph to parse TypeScript files and identify natural language
 * query intents written using either:
 * - Method calls: db.llm() or llmDB.llm()
 * - Template literals: llm`natural language query`
 * 
 * It extracts the intent string, parameters, return types, and source location 
 * information needed for SQL generation.
 * 
 * Features:
 * - Robust AST parsing using TypeScript compiler API
 * - Supports both db.llm() and llmDB.llm() call patterns
 * - Supports llm`` template literal syntax
 * - Extracts typed parameters and return type annotations
 * - Generates unique query IDs for change tracking
 * - Preserves source location for debugging
 */
export class QueryParser {
  private project: Project;

  /**
   * Create a new query parser
   * 
   * Initializes a ts-morph Project with TypeScript configuration for parsing
   * source files. Uses the project's tsconfig.json but doesn't automatically
   * include all files to avoid performance issues.
   */
  constructor() {
    this.project = new Project({
      tsConfigFilePath: './tsconfig.json',
      skipAddingFilesFromTsConfig: true,
    });
  }

  /**
   * Collect all LLM queries from the specified source files
   * 
   * Parses each file using AST analysis to find:
   * - db.llm() or llmDB.llm() call expressions
   * - llm`` tagged template literals
   * 
   * Extracts their parameters and metadata, and returns a comprehensive list
   * of queries that need SQL generation.
   * 
   * @param filePaths - Array of absolute file paths to analyze
   * @returns Array of collected query objects with intent, parameters, and metadata
   * 
   * @example
   * ```typescript
   * const parser = new QueryParser();
   * const queries = parser.collectQueries(['./src/queries/users.ts', './src/queries/orders.ts']);
   * console.log(`Found ${queries.length} queries`);
   * ```
   */
  collectQueries(filePaths: string[]): CollectedQuery[] {
    const queries: CollectedQuery[] = [];

    for (const filePath of filePaths) {
      const sourceFile = this.project.addSourceFileAtPath(filePath);
      
      sourceFile.forEachDescendant((node) => {
        // Check for method calls: db.llm() or llmDB.llm()
        if (Node.isCallExpression(node)) {
          if (this.isDBLLMCall(node)) {
            const query = this.extractQueryInfo(node, filePath);
            if (query) {
              queries.push(query);
            }
          }
        }
        
        // Check for template literals: llm`...`
        if (Node.isTaggedTemplateExpression(node)) {
          if (this.isLLMTemplateTag(node)) {
            const query = this.extractTemplateQueryInfo(node, filePath);
            if (query) {
              queries.push(query);
            }
          }
        }
      });
    }

    return queries;
  }

  /**
   * Check if a CallExpression node represents a db.llm() or llmDB.llm() call
   * 
   * Analyzes the AST structure to identify the specific pattern of LLM query calls.
   * Supports both 'db.llm()' and 'llmDB.llm()' naming conventions.
   * 
   * @param node - CallExpression AST node to check
   * @returns True if the node is a valid LLM query call
   * 
   * @private
   */
  private isDBLLMCall(node: CallExpression): boolean {
    const expression = node.getExpression();
    
    if (Node.isPropertyAccessExpression(expression)) {
      const name = expression.getName();
      const object = expression.getExpression();
      
      if (name === 'llm' && Node.isIdentifier(object)) {
        const objectName = object.getText();
        return objectName === 'db' || objectName === 'llmDB';
      }
    }
    
    return false;
  }

  /**
   * Extract query information from a db.llm() call expression
   * 
   * Parses the AST node to extract:
   * - Intent string (first argument)
   * - Parameters object (second argument, if present)
   * - Return type from TypeScript annotations
   * - Source location for debugging
   * 
   * @param node - CallExpression AST node representing the db.llm() call
   * @param filePath - Absolute path to the source file
   * @returns CollectedQuery object or null if extraction fails
   * 
   * @private
   */
  private extractQueryInfo(node: CallExpression, filePath: string): CollectedQuery | null {
    const args = node.getArguments();
    
    if (args.length === 0) {
      return null;
    }

    const intentArg = args[0];
    let intent: string;

    if (Node.isStringLiteral(intentArg)) {
      intent = intentArg.getLiteralValue();
    } else if (Node.isTemplateExpression(intentArg)) {
      intent = intentArg.getText();
    } else {
      return null;
    }

    const paramsArg = args[1];
    let params: Record<string, any> | undefined;

    if (paramsArg && Node.isObjectLiteralExpression(paramsArg)) {
      params = this.extractObjectLiteral(paramsArg);
    }

    const returnType = this.inferReturnType(node);
    const location = this.getSourceLocation(node, filePath);
    
    const id = this.generateQueryId(intent, params, location);

    return {
      id,
      intent,
      params,
      returnType,
      location,
      sourceFile: filePath,
    };
  }

  /**
   * Extract values from an object literal expression in the AST
   * 
   * Converts TypeScript object literal syntax to a plain JavaScript object.
   * Handles string literals, numeric literals, boolean values, and other expressions.
   * 
   * @param node - ObjectLiteralExpression AST node
   * @returns Plain object with extracted key-value pairs
   * 
   * @private
   * 
   * @example
   * For source code: `{ userId: 123, active: true, name: 'test' }`
   * Returns: `{ userId: 123, active: true, name: 'test' }`
   */
  private extractObjectLiteral(node: any): Record<string, any> {
    const result: Record<string, any> = {};
    
    node.getProperties().forEach((prop: any) => {
      if (Node.isPropertyAssignment(prop)) {
        const name = prop.getName();
        const initializer = prop.getInitializer();
        
        if (Node.isStringLiteral(initializer) || Node.isNumericLiteral(initializer)) {
          result[name] = initializer.getLiteralValue();
        } else if (initializer && (initializer.getKind() === 109 || initializer.getKind() === 94)) { // TrueKeyword or FalseKeyword
          result[name] = initializer.getText() === 'true';
        } else {
          result[name] = initializer?.getText();
        }
      }
    });

    return result;
  }

  /**
   * Infer the return type of a db.llm() call from TypeScript annotations
   * 
   * Attempts to determine the expected return type by checking:
   * 1. Generic type arguments: db.llm<User>(...)
   * 2. Variable declaration type annotations
   * 3. Other contextual type information
   * 
   * @param node - CallExpression AST node
   * @returns TypeScript type string or undefined if not determinable
   * 
   * @private
   * 
   * @example
   * For `db.llm<User[]>('Get users')` returns 'User[]'
   * For `const users: User[] = db.llm('Get users')` returns 'User[]'
   */
  private inferReturnType(node: CallExpression): string | undefined {
    const typeArgs = node.getTypeArguments();
    if (typeArgs.length > 0) {
      return typeArgs[0].getText();
    }

    const parent = node.getParent();
    if (Node.isVariableDeclaration(parent)) {
      const typeNode = parent.getTypeNode();
      if (typeNode) {
        return typeNode.getText();
      }
    }

    return undefined;
  }

  /**
   * Get the source location (file, line, column) of a db.llm() call
   * 
   * Extracts position information from the AST node for debugging and
   * error reporting purposes.
   * 
   * @param node - CallExpression AST node
   * @param filePath - Absolute path to the source file
   * @returns Object with file path, line number, and column number
   * 
   * @private
   */
  private getSourceLocation(node: CallExpression, filePath: string) {
    const sourceFile = node.getSourceFile();
    const lineAndColumn = sourceFile.getLineAndColumnAtPos(node.getStart());
    
    return {
      file: filePath,
      line: lineAndColumn.line,
      column: lineAndColumn.column,
    };
  }

  /**
   * Generate a unique identifier for a query based on its content
   * 
   * Uses the shared hash generation logic to ensure consistency between
   * build-time and runtime.
   * 
   * @param intent - Natural language intent string
   * @param params - Parameter object (if any)
   * @param location - Source location information
   * @returns MD5 hash string as unique query identifier
   * 
   * @private
   */
  private generateQueryId(intent: string, params: Record<string, any> | undefined, location: any): string {
    return generateQueryId(intent, params, location);
  }

  /**
   * Check if a TaggedTemplateExpression node represents an llm`` template tag
   * 
   * @param node - TaggedTemplateExpression AST node to check
   * @returns True if the node is an llm template tag
   * 
   * @private
   */
  private isLLMTemplateTag(node: TaggedTemplateExpression): boolean {
    const tag = node.getTag();
    return Node.isIdentifier(tag) && tag.getText() === 'llm';
  }

  /**
   * Extract query information from an llm`` template literal
   * 
   * Parses the AST node to extract:
   * - Intent string from the template literal
   * - Any interpolated values as parameters
   * - Return type from TypeScript annotations
   * - Source location for debugging
   * 
   * @param node - TaggedTemplateExpression AST node
   * @param filePath - Absolute path to the source file
   * @returns CollectedQuery object or null if extraction fails
   * 
   * @private
   */
  private extractTemplateQueryInfo(node: TaggedTemplateExpression, filePath: string): CollectedQuery | null {
    const template = node.getTemplate();
    let intent = '';
    let params: Record<string, any> = {};
    
    if (Node.isNoSubstitutionTemplateLiteral(template)) {
      // Simple case: llm`Get all users`
      intent = template.getLiteralValue();
    } else if (Node.isTemplateExpression(template)) {
      // Complex case: llm`Get user with id ${userId}`
      const head = template.getHead();
      const spans = template.getTemplateSpans();
      
      // Get the head text without backticks and ${
      let headText = head.getText();
      if (headText.startsWith('`')) {
        headText = headText.slice(1);
      }
      // Remove trailing ${ if present (part of template interpolation syntax)
      if (headText.endsWith('${')) {
        headText = headText.slice(0, -2);
      }
      intent = headText;
      
      let paramIndex = 0;
      
      spans.forEach((span) => {
        const expression = span.getExpression();
        const literal = span.getLiteral();
        
        // Add placeholder for the parameter
        intent += `\${${paramIndex}}`;
        
        // Get the literal text without template syntax delimiters
        let literalText = literal.getText();
        
        // For TemplateMiddle or TemplateTail, we need to remove the delimiters
        // Handle different TypeScript version kind numbers
        if (literal.getKind() === 218 || literal.getKind() === 18) { // TemplateMiddle
          // Remove }...{
          if (literalText.startsWith('}')) {
            literalText = literalText.slice(1);
          }
          if (literalText.endsWith('{')) {
            literalText = literalText.slice(0, -1);
          }
        } else if (literal.getKind() === 219 || literal.getKind() === 19) { // TemplateTail  
          // Remove }...`
          if (literalText.startsWith('}')) {
            literalText = literalText.slice(1);
          }
          if (literalText.endsWith('`')) {
            literalText = literalText.slice(0, -1);
          }
        }
        
        // For any template literal ending, remove } and `
        if (literalText.startsWith('}')) {
          literalText = literalText.slice(1);
        }
        if (literalText.endsWith('`')) {
          literalText = literalText.slice(0, -1);
        }
        
        intent += literalText;
        
        // Extract parameter value if it's a simple identifier
        if (Node.isIdentifier(expression)) {
          params[`param${paramIndex}`] = expression.getText();
        } else {
          params[`param${paramIndex}`] = expression.getText();
        }
        
        paramIndex++;
      });
    } else {
      return null;
    }

    const returnType = this.inferTemplateReturnType(node);
    const location = this.getTemplateSourceLocation(node, filePath);
    const id = this.generateQueryId(intent, Object.keys(params).length > 0 ? params : undefined, location);

    return {
      id,
      intent,
      params: Object.keys(params).length > 0 ? params : undefined,
      returnType,
      location,
      sourceFile: filePath,
    };
  }

  /**
   * Infer the return type of an llm`` template literal from context
   * 
   * @param node - TaggedTemplateExpression AST node
   * @returns TypeScript type string or undefined if not determinable
   * 
   * @private
   */
  private inferTemplateReturnType(node: TaggedTemplateExpression): string | undefined {
    // Check if the template is wrapped in db.execute<T>()
    const parent = node.getParent();
    if (Node.isCallExpression(parent)) {
      const typeArgs = parent.getTypeArguments();
      if (typeArgs.length > 0) {
        return typeArgs[0].getText();
      }
    }
    
    // Check for variable declaration type
    const varDeclaration = node.getFirstAncestorByKind(384 as any); // SyntaxKind.VariableDeclaration
    if (varDeclaration && Node.isVariableDeclaration(varDeclaration)) {
      const typeNode = varDeclaration.getTypeNode();
      if (typeNode) {
        return typeNode.getText();
      }
    }
    
    return undefined;
  }

  /**
   * Get the source location of an llm`` template literal
   * 
   * @param node - TaggedTemplateExpression AST node
   * @param filePath - Absolute path to the source file
   * @returns Object with file path, line number, and column number
   * 
   * @private
   */
  private getTemplateSourceLocation(node: TaggedTemplateExpression, filePath: string) {
    const sourceFile = node.getSourceFile();
    const lineAndColumn = sourceFile.getLineAndColumnAtPos(node.getStart());
    
    return {
      file: filePath,
      line: lineAndColumn.line,
      column: lineAndColumn.column,
    };
  }
}