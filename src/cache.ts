import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { GeneratedQuery, CacheEntry } from './types';

/**
 * File-based cache for storing generated queries to avoid redundant LLM calls
 */
export class QueryCache {
  private cacheDir: string;
  private enabled: boolean;

  constructor(cacheDir: string, enabled: boolean = true) {
    this.cacheDir = cacheDir;
    this.enabled = enabled;

    if (this.enabled && !existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Generate cache key from query ID and intent
   */
  private generateCacheKey(queryId: string, intent: string): string {
    const content = JSON.stringify({ queryId, intent });
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Get cache file path for a given cache key
   */
  private getCacheFilePath(cacheKey: string): string {
    return join(this.cacheDir, `${cacheKey}.json`);
  }

  /**
   * Check if a cached entry exists for the given query
   */
  has(queryId: string, intent: string): boolean {
    if (!this.enabled) {
      return false;
    }

    const cacheKey = this.generateCacheKey(queryId, intent);
    const cacheFile = this.getCacheFilePath(cacheKey);
    return existsSync(cacheFile);
  }

  /**
   * Retrieve a cached query result
   */
  get(queryId: string, intent: string): GeneratedQuery | null {
    if (!this.enabled) {
      return null;
    }

    const cacheKey = this.generateCacheKey(queryId, intent);
    const cacheFile = this.getCacheFilePath(cacheKey);

    if (!existsSync(cacheFile)) {
      return null;
    }

    try {
      const data = readFileSync(cacheFile, 'utf-8');
      const cacheEntry: CacheEntry = JSON.parse(data);
      return cacheEntry.query;
    } catch (error) {
      console.warn(`Failed to read cache file ${cacheFile}:`, error);
      return null;
    }
  }

  /**
   * Store a generated query in the cache
   */
  set(queryId: string, intent: string, generatedQuery: GeneratedQuery): void {
    if (!this.enabled) {
      return;
    }

    const cacheKey = this.generateCacheKey(queryId, intent);
    const cacheFile = this.getCacheFilePath(cacheKey);

    const cacheEntry: CacheEntry = {
      hash: generatedQuery.hash,
      query: generatedQuery,
      timestamp: Date.now(),
    };

    try {
      writeFileSync(cacheFile, JSON.stringify(cacheEntry, null, 2), 'utf-8');
    } catch (error) {
      console.warn(`Failed to write cache file ${cacheFile}:`, error);
    }
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    if (!this.enabled || !existsSync(this.cacheDir)) {
      return;
    }

    try {
      rmSync(this.cacheDir, { recursive: true, force: true });
      mkdirSync(this.cacheDir, { recursive: true });
    } catch (error) {
      console.warn(`Failed to clear cache directory ${this.cacheDir}:`, error);
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { totalEntries: number; cacheSize: string } {
    if (!this.enabled || !existsSync(this.cacheDir)) {
      return { totalEntries: 0, cacheSize: '0 B' };
    }

    try {
      const files = readdirSync(this.cacheDir).filter(f => f.endsWith('.json'));
      const totalEntries = files.length;

      let totalSize = 0;
      for (const file of files) {
        const filePath = join(this.cacheDir, file);
        const stats = statSync(filePath);
        totalSize += stats.size;
      }

      const cacheSize = this.formatBytes(totalSize);

      return { totalEntries, cacheSize };
    } catch (error) {
      console.warn(`Failed to get cache stats:`, error);
      return { totalEntries: 0, cacheSize: '0 B' };
    }
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
}