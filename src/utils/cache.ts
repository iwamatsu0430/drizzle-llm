import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import type { CacheEntry, GeneratedQuery } from "../types";

/**
 * File-based cache system for generated SQL queries
 *
 * Provides persistent caching of LLM-generated queries to:
 * - Reduce API costs by avoiding regeneration of unchanged queries
 * - Improve build performance through query reuse
 * - Enable offline development when queries haven't changed
 *
 * Features:
 * - SHA-256 based cache keys for content-based lookup
 * - Automatic cache expiration (24 hours)
 * - Cache statistics and management
 * - Graceful degradation when caching is disabled
 * - File-based storage for persistence across builds
 *
 * Cache entries include the generated query, metadata, and timestamp
 * for expiration handling.
 */
export class QueryCache {
  private cacheDir: string;
  private enabled: boolean;

  /**
   * Create a new query cache
   *
   * @param cacheDir - Directory to store cache files (default: '.drizzle-llm-cache')
   * @param enabled - Whether caching is enabled (default: true)
   */
  constructor(cacheDir = ".drizzle-llm-cache", enabled = true) {
    this.cacheDir = resolve(cacheDir);
    this.enabled = enabled;

    if (this.enabled && !existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * Retrieve a cached query if available and not expired
   *
   * Performs content-based lookup using the query ID, intent, and parameters
   * to generate a cache key. Returns null if no cache entry exists or if
   * the entry has expired.
   *
   * @param queryId - Unique identifier for the query
   * @param intent - Natural language intent string
   * @param params - Query parameters (optional)
   * @returns Cached GeneratedQuery or null if not found/expired
   *
   * @example
   * ```typescript
   * const cached = cache.get('q1', 'Get active users', { limit: 10 });
   * if (cached) {
   *   console.log('Using cached query:', cached.sql);
   * }
   * ```
   */
  get(queryId: string, intent: string, params?: Record<string, any>): GeneratedQuery | null {
    if (!this.enabled) {
      return null;
    }

    const cacheKey = this.generateCacheKey(queryId, intent, params);
    const cacheFile = join(this.cacheDir, `${cacheKey}.json`);

    if (!existsSync(cacheFile)) {
      return null;
    }

    try {
      const cacheEntry: CacheEntry = JSON.parse(readFileSync(cacheFile, "utf8"));

      if (this.isExpired(cacheEntry)) {
        return null;
      }

      console.log(`📦 Cache hit for query ${queryId}`);
      return cacheEntry.query;
    } catch (error) {
      console.warn(`⚠️  Failed to read cache for ${queryId}:`, error);
      return null;
    }
  }

  /**
   * Store a generated query in the cache
   *
   * Creates a cache entry with the current timestamp for expiration tracking.
   * The cache key is generated from the query content to ensure content-based
   * invalidation.
   *
   * @param queryId - Unique identifier for the query
   * @param intent - Natural language intent string
   * @param query - Generated query object to cache
   * @param params - Query parameters (optional)
   *
   * @example
   * ```typescript
   * cache.set('q1', 'Get active users', generatedQuery, { limit: 10 });
   * ```
   */
  set(queryId: string, intent: string, query: GeneratedQuery, params?: Record<string, any>): void {
    if (!this.enabled) {
      return;
    }

    const cacheKey = this.generateCacheKey(queryId, intent, params);
    const cacheFile = join(this.cacheDir, `${cacheKey}.json`);

    const cacheEntry: CacheEntry = {
      hash: cacheKey,
      query,
      timestamp: Date.now(),
    };

    try {
      writeFileSync(cacheFile, JSON.stringify(cacheEntry, null, 2), "utf8");
      console.log(`💾 Cached query ${queryId}`);
    } catch (error) {
      console.warn(`⚠️  Failed to write cache for ${queryId}:`, error);
    }
  }

  /**
   * Check if a valid (non-expired) cache entry exists
   *
   * Useful for determining whether to attempt cache retrieval without
   * actually loading the cached data.
   *
   * @param queryId - Unique identifier for the query
   * @param intent - Natural language intent string
   * @param params - Query parameters (optional)
   * @returns True if valid cache entry exists, false otherwise
   */
  has(queryId: string, intent: string, params?: Record<string, any>): boolean {
    if (!this.enabled) {
      return false;
    }

    const cacheKey = this.generateCacheKey(queryId, intent, params);
    const cacheFile = join(this.cacheDir, `${cacheKey}.json`);

    if (!existsSync(cacheFile)) {
      return false;
    }

    try {
      const cacheEntry: CacheEntry = JSON.parse(readFileSync(cacheFile, "utf8"));
      return !this.isExpired(cacheEntry);
    } catch {
      return false;
    }
  }

  /**
   * Clear all cache entries
   *
   * Removes all .json files from the cache directory. Useful for
   * development and testing, or when forcing complete regeneration.
   *
   * @example
   * ```typescript
   * cache.clear();
   * console.log('Cache cleared');
   * ```
   */
  clear(): void {
    if (!this.enabled || !existsSync(this.cacheDir)) {
      return;
    }

    try {
      const files = require("fs").readdirSync(this.cacheDir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          require("fs").unlinkSync(join(this.cacheDir, file));
        }
      }
      console.log("🧹 Cache cleared");
    } catch (error) {
      console.warn("⚠️  Failed to clear cache:", error);
    }
  }

  /**
   * Get cache statistics
   *
   * Provides information about cache usage including total number of
   * entries and total disk space used.
   *
   * @returns Object with cache statistics
   *
   * @example
   * ```typescript
   * const stats = cache.getStats();
   * console.log(`Cache: ${stats.totalEntries} entries, ${stats.cacheSize}`);
   * ```
   */
  getStats(): { totalEntries: number; cacheSize: string } {
    if (!this.enabled || !existsSync(this.cacheDir)) {
      return { totalEntries: 0, cacheSize: "0 B" };
    }

    try {
      const files = require("fs").readdirSync(this.cacheDir);
      const jsonFiles = files.filter((file: string) => file.endsWith(".json"));

      let totalSize = 0;
      for (const file of jsonFiles) {
        const stats = require("fs").statSync(join(this.cacheDir, file));
        totalSize += stats.size;
      }

      return {
        totalEntries: jsonFiles.length,
        cacheSize: this.formatBytes(totalSize),
      };
    } catch {
      return { totalEntries: 0, cacheSize: "0 B" };
    }
  }

  /**
   * Generate a unique cache key based on query content
   *
   * Creates a SHA-256 hash from the query ID, intent, and parameters
   * to ensure content-based cache invalidation. Changes to any component
   * will result in a different cache key.
   *
   * @param queryId - Unique identifier for the query
   * @param intent - Natural language intent string
   * @param params - Query parameters
   * @returns SHA-256 hash as cache key
   * @private
   */
  private generateCacheKey(queryId: string, intent: string, params?: Record<string, any>): string {
    const content = JSON.stringify({
      queryId,
      intent: intent.trim(),
      params: params || {},
    });

    return createHash("sha256").update(content).digest("hex");
  }

  /**
   * Check if a cache entry has expired
   *
   * Cache entries are considered expired after 24 hours to ensure
   * that schema changes and other updates are reflected.
   *
   * @param cacheEntry - Cache entry to check
   * @returns True if entry is expired, false otherwise
   * @private
   */
  private isExpired(cacheEntry: CacheEntry): boolean {
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    return Date.now() - cacheEntry.timestamp > maxAge;
  }

  /**
   * Format byte count in human-readable format
   *
   * Converts byte counts to appropriate units (B, KB, MB, GB) for
   * display in cache statistics.
   *
   * @param bytes - Number of bytes
   * @returns Formatted string with appropriate unit
   * @private
   *
   * @example
   * ```typescript
   * formatBytes(1024) // Returns "1 KB"
   * formatBytes(1048576) // Returns "1 MB"
   * ```
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  }
}

/**
 * Factory function to create a new QueryCache instance
 *
 * Convenience function for creating cache instances with optional configuration.
 *
 * @param options - Optional cache configuration
 * @param options.directory - Cache directory path
 * @param options.enabled - Whether caching is enabled
 * @returns New QueryCache instance
 *
 * @example
 * ```typescript
 * const cache = createQueryCache({
 *   directory: './my-cache',
 *   enabled: process.env.NODE_ENV !== 'test'
 * });
 * ```
 */
export function createQueryCache(options?: { directory?: string; enabled?: boolean }): QueryCache {
  return new QueryCache(options?.directory, options?.enabled);
}
