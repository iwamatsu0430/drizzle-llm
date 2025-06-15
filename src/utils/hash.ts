import { createHash } from 'crypto';

/**
 * Generate a query ID using the same logic as build-time
 * This ensures consistency between build and runtime
 */
export function generateQueryId(intent: string, params?: Record<string, any>, location?: any): string {
  const content = JSON.stringify({ intent, params, location });
  return createHash('md5').update(content).digest('hex');
}

/**
 * Generate a query ID for runtime use (without location info)
 * This matches the build-time pattern but excludes location for runtime efficiency
 */
export function generateRuntimeQueryId(intentPattern: string): string {
  // For runtime, we don't have location info, so we use undefined
  // params are undefined for simple pattern matching
  const content = JSON.stringify({ intent: intentPattern, params: undefined, location: undefined });
  return createHash('md5').update(content).digest('hex');
}