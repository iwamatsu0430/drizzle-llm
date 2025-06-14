import { GeneratedQuery } from '../types.js';

/**
 * Extract query information from generated query files
 * Used by both validate.ts and plugin.ts
 * @param content - File content to parse
 * @returns Map of query ID to generated query
 */
export function extractQueriesFromFile(content: string): Record<string, GeneratedQuery> {
  const queries: Record<string, GeneratedQuery> = {};
  
  // Extract SQL and parameters from generatedQueries object
  const queryObjectMatch = content.match(/export const generatedQueries = \{([\s\S]*?)\};/);
  if (!queryObjectMatch) {
    return queries;
  }

  const queryObjectContent = queryObjectMatch[1];
  
  // Extract each query entry - supports multi-line SQL
  const queryEntryRegex = /'([^']+)':\s*\{\s*sql:\s*`([\s\S]*?)`,\s*parameters:\s*(\[[^\]]*\]),\s*hash:\s*'([^']+)'/g;
  let match;
  
  while ((match = queryEntryRegex.exec(queryObjectContent)) !== null) {
    const [, id, sql, parametersStr, hash] = match;
    
    try {
      const parameters = JSON.parse(parametersStr);
      queries[id] = {
        id,
        intent: '', // Intent is difficult to extract, so leave empty
        sql: sql.trim(),
        parameters,
        hash,
        returnType: 'any'
      };
    } catch (e) {
      console.warn(`⚠️  Failed to parse parameters for query ${id}: ${parametersStr}`);
    }
  }

  return queries;
}

/**
 * Extract intentToId mapping from file content
 * @param content - File content to parse
 * @returns Map of intent to query ID
 */
export function extractIntentMapping(content: string): Record<string, string> {
  const mapping: Record<string, string> = {};
  
  const intentMatch = content.match(/export const intentToId: Record<string, string> = \{([\s\S]*?)\};/);
  if (!intentMatch) {
    return mapping;
  }

  const intentContent = intentMatch[1];
  const intentRegex = /"([^"]+)":\s*"([^"]+)"/g;
  let match;
  
  while ((match = intentRegex.exec(intentContent)) !== null) {
    const [, intent, id] = match;
    mapping[intent] = id;
  }
  
  return mapping;
}

/**
 * Extract queries as array (for compatibility with validate.ts)
 * @param content - File content to parse
 * @returns Array of generated queries
 */
export function extractQueriesAsArray(content: string): GeneratedQuery[] {
  const queriesMap = extractQueriesFromFile(content);
  const intentMapping = extractIntentMapping(content);
  
  // Restore intent from mapping
  for (const [intent, id] of Object.entries(intentMapping)) {
    if (queriesMap[id]) {
      queriesMap[id].intent = intent;
    }
  }
  
  return Object.values(queriesMap);
}

/**
 * Extract queries as Record with restored intent (used by plugin.ts)
 * @param content - File content to parse
 * @returns Map of query ID to generated query with intent
 */
export function extractQueriesWithIntent(content: string): Record<string, GeneratedQuery> {
  const queriesMap = extractQueriesFromFile(content);
  const intentMapping = extractIntentMapping(content);
  
  // Restore intent from mapping
  for (const [intent, id] of Object.entries(intentMapping)) {
    if (queriesMap[id]) {
      queriesMap[id].intent = intent;
    }
  }
  
  return queriesMap;
}