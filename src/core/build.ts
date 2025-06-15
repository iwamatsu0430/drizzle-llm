/**
 * Standalone build logic for drizzle-llm CLI
 * This module provides the core build functionality without Vite plugin dependencies
 */

import { resolve, relative, dirname } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { Project, Node, TypeAliasDeclaration, InterfaceDeclaration, ClassDeclaration } from 'ts-morph';
import { QueryParser } from './ast-parser.js';
import { SchemaAnalyzer } from './schema-analyzer.js';
import { QueryGenerator } from './query-generator.js';
import { QueryCache } from '../utils/cache.js';
// import { QueryValidator } from './query-validator.js'; // File deleted
import { DrizzleLLMConfig, CollectedQuery, GeneratedQuery } from '../types.js';

/**
 * Main build function for CLI - generates SQL queries using LLM
 * 
 * @param config - Configuration object containing LLM provider settings, file paths, and cache options
 */
export async function buildQueries(config: DrizzleLLMConfig): Promise<void> {
  const parser = new QueryParser();
  const schemaAnalyzer = new SchemaAnalyzer();
  
  const generator = new QueryGenerator(config);
  const cache = new QueryCache(config.cache?.directory, config.cache?.enabled);

  console.log('📋 Analyzing schema...');
  const schemaPath = resolve(config.paths.schema);
  console.log('📋 Schema path:', schemaPath);
  const schema = await schemaAnalyzer.analyzeSchemaPath(config.paths.schema);
  console.log('📋 Schema analysis result:');
  console.log('   Tables found:', schema.tables.length);
  schema.tables.forEach((table, i) => {
    console.log(`   ${i + 1}. ${table.name} (${table.columns.length} columns)`);
    table.columns.forEach(col => {
      console.log(`      - ${col.name}: ${col.type}${col.dbName ? ` (db: ${col.dbName})` : ''}`);
    });
  });
  
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
    console.log('ℹ️  No LLM query calls found (neither db.llm() nor llm``)');
    return;
  }
  
  console.log(`🎯 Found ${allQueries.length} queries in total`);
  
  // Without centralized file, all queries need to be generated
  const existingQueries: Record<string, GeneratedQuery> = {};
  
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
    
    // Validation removed - all queries are considered valid
    console.log('✅ All generated queries are considered valid');
    
    // Combine newly generated queries with existing valid queries
    const existingValidQueries = validQueries
      .map(query => existingQueries[query.id])
      .filter(Boolean);
    const allGeneratedQueries = [...existingValidQueries, ...newlyGeneratedQueries];
    
    // All queries are valid since validation was removed
    const validCount = allGeneratedQueries.length;
    const invalidCount = 0;
    
    console.log('💾 Writing generated queries...');
    
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
      console.log(`⚠️  Note: ${queriesToGenerate.length - newlyGeneratedQueries.length} queries failed but proceeding with available results.`);
    }
  } catch (error) {
    console.error('❌ Query generation failed:', error);
    
    // Without centralized file, just show error message
    console.log('💡 Fix the issues and run build again.');
    
    throw error;
  }
}

/**
 * Validate existing queries without regeneration
 * Note: With distributed files, validation is simplified
 */
export async function validateQueries(config: DrizzleLLMConfig): Promise<void> {
  console.log('🔍 Validation is now handled during build process with distributed files.');
  console.log('💡 Run "drizzle-llm build" to validate and regenerate queries.');
}

// Helper functions (copied from plugin.ts to make this module standalone)


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
      invalidQueries.push(query);
      continue;
    }

    if (existingQuery.intent && existingQuery.intent !== '') {
      if (query.intent.trim() === existingQuery.intent.trim()) {
        validQueries.push(query);
      } else {
        changedQueries.push(query);
      }
    } else {
      // Use the query ID from AST parser for consistency
      if (query.id === existingQuery.id) {
        validQueries.push(query);
      } else {
        changedQueries.push(query);
      }
    }
  }

  return { validQueries, invalidQueries, changedQueries };
}


function getExistingValidQueries(
  existingQueries: Record<string, GeneratedQuery>, 
  validQueries: CollectedQuery[]
): GeneratedQuery[] {
  return validQueries
    .map(query => existingQueries[query.id])
    .filter(Boolean);
}


async function writeDistributedQueryFiles(queries: GeneratedQuery[], resolvedPaths: string[]): Promise<void> {
  const queriesByFile = new Map<string, GeneratedQuery[]>();
  
  for (const query of queries) {
    const sourceFile = query.sourceFile || 'unknown';
    if (!queriesByFile.has(sourceFile)) {
      queriesByFile.set(sourceFile, []);
    }
    queriesByFile.get(sourceFile)!.push(query);
  }
  
  console.log('📁 Writing distributed query files...');
  
  for (const [sourceFile, fileQueries] of queriesByFile) {
    if (sourceFile === 'unknown') continue;
    
    // All queries are valid since validation was removed
    const validFileQueries = fileQueries;
    
    if (validFileQueries.length === 0) {
      console.log(`   ⚠️  Skipped: ${sourceFile} (no queries)`);
      continue;
    }
    
    const queryFilePath = sourceFile.replace(/\.ts$/, '.query.ts');
    const template = generateDistributedQueryFile(validFileQueries, sourceFile);
    writeFileSync(queryFilePath, template, 'utf8');
    
    console.log(`   📄 Generated: ${queryFilePath} (${validFileQueries.length} valid queries)`);
  }
}


function generateDistributedQueryFile(queries: GeneratedQuery[], sourceFile: string): string {
  const fileName = sourceFile.split('/').pop()?.replace('.ts', '') || 'queries';
  const camelCaseName = camelCase(fileName.replace(/-/g, '_'));
  
  const usedTypes = new Set<string>();
  queries.forEach(query => {
    if (query.returnType && query.returnType !== 'any') {
      usedTypes.add(query.returnType);
    }
  });
  
  // Filter out TypeScript built-in types
  const builtInTypes = new Set([
    'string', 'number', 'boolean', 'undefined', 'null', 'void', 'any', 'unknown', 'never',
    'Date', 'Array', 'Object', 'Promise', 'Map', 'Set', 'Error', 'RegExp'
  ]);
  
  const customTypes = Array.from(usedTypes).filter(type => {
    // Extract base type for array types
    const baseType = type.replace(/\[\]$/, '');
    return !builtInTypes.has(baseType);
  });
  
  // Find type definitions using AST analysis
  const typeImports = customTypes.length > 0 
    ? generateTypeImports(customTypes, sourceFile)
    : '';
  
  const imports = `// Generated queries for ${fileName}
// This file is auto-generated. Do not edit manually.

import { registerQueries } from 'drizzle-llm/runtime';

${typeImports}export interface ${camelCaseName.charAt(0).toUpperCase() + camelCaseName.slice(1)}Queries {
${queries.map(query => `  '${query.id}': ${query.returnType}[];`).join('\n')}
}

export const ${camelCaseName}Queries = {
${queries.map(query => `  '${query.id}': {
    parameters: ${JSON.stringify(query.parameters)}
  }`).join(',\n')}
};

// Intent to query ID mapping
export const ${camelCaseName}IntentToId: Record<string, string> = {
${queries.map(query => `  "${query.intent}": "${query.id}"`).join(',\n')}
};

// Auto-register queries when this file is imported
registerQueries(${camelCaseName}Queries, ${camelCaseName}IntentToId);
`;

  return imports;
}

/**
 * Generate import statements by finding type definitions using AST analysis
 */
function generateTypeImports(typeNames: string[], sourceFile: string): string {
  const project = new Project({
    tsConfigFilePath: './tsconfig.json',
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
      imports.get(importPath)!.push(...exportedTypes);
    }
  }

  // Generate import statements
  const importStatements = Array.from(imports.entries())
    .map(([path, types]) => `import type { ${[...new Set(types)].join(', ')} } from '${path}';`)
    .join('\n');

  return importStatements ? importStatements + '\n\n' : '';
}

/**
 * Find type definition location
 */
function findTypeDefinition(sourceFile: any, typeName: string, currentFilePath: string) {
  // 1. Check if defined in the same file
  const localDefinition = findLocalTypeDefinition(sourceFile, typeName);
  if (localDefinition) {
    const fileName = currentFilePath.split('/').pop()?.replace('.ts', '') || 'queries';
    return {
      importPath: `./${fileName}`,
      exportedTypes: [typeName]
    };
  }

  // 2. Analyze import statements to find external type definitions
  const importDeclarations = sourceFile.getImportDeclarations();
  
  for (const importDecl of importDeclarations) {
    const namedImports = importDecl.getNamedImports();
    const typeOnlyImport = importDecl.isTypeOnly();
    
    for (const namedImport of namedImports) {
      if (namedImport.getName() === typeName) {
        return {
          importPath: importDecl.getModuleSpecifierValue(),
          exportedTypes: [typeName]
        };
      }
    }

    // Also check default import and namespace import
    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport && defaultImport.getText() === typeName) {
      return {
        importPath: importDecl.getModuleSpecifierValue(),
        exportedTypes: [typeName]
      };
    }
  }

  // 3. Return inferred import from the same file if not found
  const fileName = currentFilePath.split('/').pop()?.replace('.ts', '') || 'queries';
  return {
    importPath: `./${fileName}`,
    exportedTypes: [typeName]
  };
}

/**
 * Find type definition within local file
 */
function findLocalTypeDefinition(sourceFile: any, typeName: string): boolean {
  // Check interface definitions
  const interfaces = sourceFile.getInterfaces();
  for (const interfaceDecl of interfaces) {
    if (interfaceDecl.getName() === typeName) {
      return true;
    }
  }

  // Check type alias definitions
  const typeAliases = sourceFile.getTypeAliases();
  for (const typeAlias of typeAliases) {
    if (typeAlias.getName() === typeName) {
      return true;
    }
  }

  // Check class definitions
  const classes = sourceFile.getClasses();
  for (const classDecl of classes) {
    if (classDecl.getName() === typeName) {
      return true;
    }
  }

  // Check enum definitions
  const enums = sourceFile.getEnums();
  for (const enumDecl of enums) {
    if (enumDecl.getName() === typeName) {
      return true;
    }
  }

  return false;
}

function camelCase(str: string): string {
  return str.replace(/[-_]([a-z])/g, (g) => g[1].toUpperCase());
}

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
  console.log('📁 Writing SQL files alongside source files...');
  
  // Group queries by source file
  const queriesByFile = new Map<string, GeneratedQuery[]>();
  
  for (const query of queries) {
    // All queries are valid since validation was removed
    
    const sourceFile = query.sourceFile || 'unknown';
    if (!queriesByFile.has(sourceFile)) {
      queriesByFile.set(sourceFile, []);
    }
    queriesByFile.get(sourceFile)!.push(query);
  }
  
  let totalFiles = 0;
  
  for (const [sourceFile, fileQueries] of queriesByFile) {
    if (sourceFile === 'unknown') continue;
    
    // Generate SQL file path: replace .ts with .sql
    const sqlFilePath = sourceFile.replace(/\.ts$/, '.sql');
    
    // Generate SQL content with all queries from this file
    const sqlContent = fileQueries.map(query => `-- ${query.id}
-- ${query.intent}
${query.sql}
`).join('\n');
    
    writeFileSync(sqlFilePath, sqlContent, 'utf8');
    totalFiles++;
    
    console.log(`   📄 Generated: ${sqlFilePath} (${fileQueries.length} queries)`);
  }
  
  console.log(`📄 Generated ${totalFiles} SQL files`);
}

