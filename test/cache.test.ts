import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueryCache } from '../src/cache';
import { GeneratedQuery } from '../src/types';
import { rmSync } from 'fs';

describe('QueryCache', () => {
  let cache: QueryCache;
  const testCacheDir = './test-cache';

  beforeEach(() => {
    cache = new QueryCache(testCacheDir, true);
  });

  afterEach(() => {
    try {
      rmSync(testCacheDir, { recursive: true, force: true });
    } catch {}
  });

  it('should store and retrieve cached queries', () => {
    const queryId = 'test-query-id';
    const intent = 'Get all users';
    
    const generatedQuery: GeneratedQuery = {
      id: queryId,
      sql: 'SELECT * FROM users',
      parameters: [],
      returnType: 'User',
      hash: 'test-hash',
    };

    cache.set(queryId, intent, generatedQuery);
    
    const retrieved = cache.get(queryId, intent);
    
    expect(retrieved).toEqual(generatedQuery);
  });

  it('should return null for non-existent cache entries', () => {
    const result = cache.get('non-existent', 'test intent');
    expect(result).toBeNull();
  });

  it('should check if cache has entry', () => {
    const queryId = 'test-query-id';
    const intent = 'Get all users';
    
    const generatedQuery: GeneratedQuery = {
      id: queryId,
      sql: 'SELECT * FROM users',
      parameters: [],
      returnType: 'User',
      hash: 'test-hash',
    };

    expect(cache.has(queryId, intent)).toBe(false);
    
    cache.set(queryId, intent, generatedQuery);
    
    expect(cache.has(queryId, intent)).toBe(true);
  });

  it('should clear all cache entries', () => {
    const queryId = 'test-query-id';
    const intent = 'Get all users';
    
    const generatedQuery: GeneratedQuery = {
      id: queryId,
      sql: 'SELECT * FROM users',
      parameters: [],
      returnType: 'User',
      hash: 'test-hash',
    };

    cache.set(queryId, intent, generatedQuery);
    expect(cache.has(queryId, intent)).toBe(true);
    
    cache.clear();
    expect(cache.has(queryId, intent)).toBe(false);
  });

  it('should provide cache statistics', () => {
    const stats = cache.getStats();
    expect(stats.totalEntries).toBe(0);
    expect(stats.cacheSize).toBe('0 B');
  });

  it('should be disabled when cache is turned off', () => {
    const disabledCache = new QueryCache(testCacheDir, false);
    
    const queryId = 'test-query-id';
    const intent = 'Get all users';
    
    const generatedQuery: GeneratedQuery = {
      id: queryId,
      sql: 'SELECT * FROM users',
      parameters: [],
      returnType: 'User',
      hash: 'test-hash',
    };

    disabledCache.set(queryId, intent, generatedQuery);
    const retrieved = disabledCache.get(queryId, intent);
    
    expect(retrieved).toBeNull();
    expect(disabledCache.has(queryId, intent)).toBe(false);
  });
});