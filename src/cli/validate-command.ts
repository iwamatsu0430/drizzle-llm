#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { SchemaAnalyzer } from '../core/schema-analyzer.js';
import { QueryValidator } from '../core/query-validator.js';
import { GeneratedQuery } from '../types.js';

/**
 * Standalone query validation command
 * Validates generated query files and provides detailed information for LLM re-requests if issues are found
 */
async function validateQueries() {
  const args = process.argv.slice(2);
  const schemaPath = args[0] || './src/db/schema.ts';
  const queriesPath = args[1] || './src/generated/queries.ts';

  console.log('🔍 Drizzle LLM Query Validator');
  console.log(`📋 Schema: ${schemaPath}`);
  console.log(`📋 Queries: ${queriesPath}`);
  console.log('');

  // Check file existence
  if (!existsSync(schemaPath)) {
    console.error(`❌ Schema file not found: ${schemaPath}`);
    process.exit(1);
  }

  if (!existsSync(queriesPath)) {
    console.error(`❌ Generated queries file not found: ${queriesPath}`);
    console.log(`💡 Run 'npm run build' first to generate queries`);
    process.exit(1);
  }

  try {
    // Analyze schema
    console.log('📊 Analyzing database schema...');
    const schemaAnalyzer = new SchemaAnalyzer();
    const schema = await schemaAnalyzer.analyzeSchema(schemaPath);
    console.log(`   Found ${schema.tables.length} tables`);
    
    if (schema.tables.length === 0) {
      console.log('⚠️  No tables found in schema. This might indicate a parsing issue.');
      console.log('   Schema file content preview:');
      const schemaContent = readFileSync(schemaPath, 'utf-8');
      console.log('   ' + schemaContent.split('\n').slice(0, 10).join('\n   '));
    }

    // Load generated queries
    console.log('📄 Loading generated queries...');
    const queriesContent = readFileSync(queriesPath, 'utf-8');
    
    // Extract queries (using regex)
    const queries = await extractQueriesFromFile(queriesContent);
    console.log(`   Found ${queries.length} generated queries`);

    if (queries.length === 0) {
      console.log('⚠️  No queries found in the generated file');
      return;
    }

    // Execute validation
    console.log('🔍 Validating queries...');
    const validator = new QueryValidator(schema);
    const result = validator.validateQueries(queries);

    // Display results
    QueryValidator.printValidationResult(result);

    // Display consolidated information for LLM re-requests
    if (result.errors.length > 0) {
      console.log('\n🤖 Information for LLM Re-request:');
      console.log('=' .repeat(80));
      
      const problemsByType = groupProblemsByType(result.errors);
      
      for (const [problemType, errors] of Object.entries(problemsByType)) {
        console.log(`\n📋 ${problemType.toUpperCase()} Problems:`);
        errors.forEach((error, index) => {
          console.log(`   ${index + 1}. Query ${error.queryId}:`);
          console.log(`      Issue: ${error.problemDetails?.invalidElement || 'Unknown'}`);
          if (error.problemDetails?.availableOptions) {
            console.log(`      Available: [${error.problemDetails.availableOptions.join(', ')}]`);
          }
          console.log(`      Context: ${error.problemDetails?.context || error.message}`);
        });
      }

      console.log('\n💡 Recommendation:');
      console.log('   Use the above information to fix schema mismatches in your LLM prompts.');
      console.log('   Re-run LLM generation with corrected schema information.');
    }

    // Display overall statistics (shown last)
    console.log('\n📊 Validation Summary:');
    console.log('=' .repeat(60));
    
    const validQueries = queries.filter(query => {
      const queryResult = validator.validateSingleQuery(query);
      return queryResult.isValid;
    });
    const invalidQueries = queries.filter(query => {
      const queryResult = validator.validateSingleQuery(query);
      return !queryResult.isValid;
    });

    console.log(`📈 Total Queries: ${queries.length}`);
    console.log(`✅ Valid Queries: ${validQueries.length}`);
    console.log(`❌ Invalid Queries: ${invalidQueries.length}`);
    
    if (result.warnings.length > 0) {
      const warningsByQuery = new Map<string, number>();
      result.warnings.forEach(warning => {
        warningsByQuery.set(warning.queryId, (warningsByQuery.get(warning.queryId) || 0) + 1);
      });
      console.log(`⚠️  Queries with Warnings: ${warningsByQuery.size}`);
    }

    // Set exit code
    process.exit(result.isValid ? 0 : 1);

  } catch (error) {
    console.error('❌ Validation failed:', error);
    process.exit(1);
  }
}

/**
 * Extract query information from generated query file
 * @param content - File content to parse
 * @returns Array of generated queries
 */
async function extractQueriesFromFile(content: string): Promise<GeneratedQuery[]> {
  const { extractQueriesAsArray } = await import('../utils/query-extractor.js');
  return extractQueriesAsArray(content);
}

/**
 * Group errors by problem type
 * @param errors - Array of validation errors
 * @returns Errors grouped by problem type
 */
function groupProblemsByType(errors: any[]): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  
  for (const error of errors) {
    const problemType = error.problemDetails?.problemType || 'other';
    if (!groups[problemType]) {
      groups[problemType] = [];
    }
    groups[problemType].push(error);
  }
  
  return groups;
}

// Process CLI execution
if (import.meta.url === `file://${process.argv[1]}`) {
  validateQueries().catch((error) => {
    console.error('❌ Validation script failed:', error);
    process.exit(1);
  });
}

export { validateQueries };