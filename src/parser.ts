import { Project, SourceFile, Node, CallExpression, SyntaxKind } from 'ts-morph';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { CollectedQuery } from './types';

/**
 * AST parser for collecting db.llm() calls from TypeScript source files
 */
export class QueryParser {
  private project: Project;

  constructor() {
    this.project = new Project({
      useInMemoryFileSystem: true,
      compilerOptions: {
        target: 99, // ScriptTarget.Latest
        allowJs: true,
        declaration: false,
        strict: false,
      },
    });
  }

  /**
   * Collect all db.llm() calls from the specified files
   */
  collectQueries(filePaths: string[]): CollectedQuery[] {
    const queries: CollectedQuery[] = [];

    for (const filePath of filePaths) {
      try {
        const sourceFile = this.project.addSourceFileAtPath(filePath);
        const fileQueries = this.extractQueriesFromFile(sourceFile, filePath);
        queries.push(...fileQueries);
      } catch (error) {
        // If file doesn't exist, try adding it as source text
        try {
          const content = readFileSync(filePath, 'utf-8');
          const sourceFile = this.project.createSourceFile(filePath, content, { overwrite: true });
          const fileQueries = this.extractQueriesFromFile(sourceFile, filePath);
          queries.push(...fileQueries);
        } catch (innerError) {
          console.warn(`Failed to process file ${filePath}:`, innerError);
        }
      }
    }

    return queries;
  }

  private extractQueriesFromFile(sourceFile: SourceFile, filePath: string): CollectedQuery[] {
    const queries: CollectedQuery[] = [];

    // Use descendant traversal to find all function call expressions
    sourceFile.forEachDescendant((node: Node) => {
      if (Node.isCallExpression(node)) {
        const query = this.extractQueryFromCallExpression(node, filePath, sourceFile);
        if (query) {
          queries.push(query);
        }
      }
    });

    return queries;
  }

  private extractQueryFromCallExpression(node: CallExpression, filePath: string, sourceFile: SourceFile): CollectedQuery | null {
    // Check if this is a db.llm() call
    if (!this.isDbLLMCall(node)) {
      return null;
    }

    const args = node.getArguments();
    if (args.length === 0) {
      return null;
    }

    // Extract intent (first argument)
    const intentArg = args[0];
    if (!Node.isStringLiteral(intentArg)) {
      return null;
    }
    const intent = intentArg.getLiteralValue();

    // Extract parameters (second argument if present)
    let params: Record<string, any> | undefined;
    if (args.length > 1) {
      const paramsArg = args[1];
      if (Node.isObjectLiteralExpression(paramsArg)) {
        params = this.extractObjectLiteral(paramsArg);
      }
    }

    // Extract return type from type arguments
    let returnType: string | undefined;
    const typeArgs = node.getTypeArguments();
    if (typeArgs.length > 0) {
      returnType = typeArgs[0].getText();
    }

    // Get location information
    const startPos = node.getStart();
    const location = sourceFile.getLineAndColumnAtPos(startPos);

    // Generate unique ID
    const id = this.generateQueryId(intent, params);

    return {
      id,
      intent,
      params,
      returnType,
      location: {
        file: filePath,
        line: location.line,
        column: location.column,
      },
      sourceFile: filePath,
    };
  }

  private isDbLLMCall(node: CallExpression): boolean {
    const expression = node.getExpression();
    
    if (Node.isPropertyAccessExpression(expression)) {
      const name = expression.getName();
      const object = expression.getExpression();
      
      // Check if it's *.llm() call
      if (name === 'llm') {
        // Check if the object is 'db' identifier
        if (Node.isIdentifier(object)) {
          return object.getText() === 'db';
        }
      }
    }
    
    return false;
  }

  private extractObjectLiteral(node: any): Record<string, any> {
    const result: Record<string, any> = {};
    
    try {
      // This is a simplified extraction - in a real implementation,
      // you'd want to handle more complex cases
      const properties = node.getProperties();
      for (const prop of properties) {
        if (Node.isPropertyAssignment(prop)) {
          const key = prop.getName();
          const value = prop.getInitializer();
          
          if (!value) {
            result[key] = null;
          } else if (Node.isStringLiteral(value)) {
            result[key] = value.getLiteralValue();
          } else if (Node.isNumericLiteral(value)) {
            result[key] = value.getLiteralValue();
          } else if (value.getKind() === SyntaxKind.TrueKeyword) {
            result[key] = true;
          } else if (value.getKind() === SyntaxKind.FalseKeyword) {
            result[key] = false;
          } else {
            result[key] = value.getText();
          }
        }
      }
    } catch (error) {
      // If we can't parse the object literal, return empty object
      console.warn('Failed to parse object literal:', error);
    }
    
    return result;
  }

  private generateQueryId(intent: string, params?: Record<string, any>): string {
    const content = JSON.stringify({ intent, params });
    return createHash('sha256').update(content).digest('hex').substring(0, 16);
  }
}